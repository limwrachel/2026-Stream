/**
 * Clinical Notes → Firebase Storage sync pipeline.
 *
 * Pulls HKClinicalTypeIdentifierClinicalNoteRecord documents from Apple
 * HealthKit, extracts the embedded FHIR DocumentReference attachment
 * (typically a PDF or plain text), uploads the raw file to Firebase Storage,
 * and writes lightweight metadata to Firestore.
 *
 * Data model
 * ──────────
 *   Firebase Storage:
 *     users/{uid}/clinical-notes/{noteId}
 *       — raw document bytes (content-type preserved from FHIR attachment)
 *
 *   Firestore:
 *     users/{uid}/clinicalNotes/{noteId}
 *       displayName, startDate, endDate, contentType, title?,
 *       storageRef, fhirResourceType?, fhirSourceURL?,
 *       medgemmaStatus, uploadedAt
 *
 * Idempotency
 * ───────────
 *   Before uploading, the pipeline checks whether the Firestore metadata doc
 *   already exists (keyed on the HealthKit UUID). Re-running is safe and cheap.
 *
 * MedGemma pipeline hook
 * ──────────────────────
 *   Every uploaded note is written with medgemmaStatus = 'pending'.
 *   The end-of-study batch job queries:
 *     where('medgemmaStatus', '==', 'pending')
 *   downloads from Storage, runs MedGemma, and updates to 'complete'.
 */

import { Platform } from 'react-native';
import { getApp } from 'firebase/app';
import { getStorage, ref, uploadString } from 'firebase/storage';
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';

import { getClinicalNotes } from '@/lib/services/healthkit';
import type { ClinicalRecord } from '@/lib/services/healthkit';
import { db, getAuth } from './firestore';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SyncClinicalNotesResult {
  ok: boolean;
  uploaded: number;
  skipped: number;
  error?: string;
}

interface FhirAttachment {
  data?: string;        // base64-encoded document bytes
  contentType?: string; // e.g. "application/pdf", "text/plain"
  title?: string;
  size?: number;        // bytes (unencoded)
  url?: string;         // present when data is not embedded
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Extracts the first attachment from a FHIR DocumentReference resource.
 * Returns null if the resource is missing or malformed.
 */
function extractAttachment(
  fhirResource: Record<string, unknown> | undefined,
): FhirAttachment | null {
  if (!fhirResource) return null;

  const content = fhirResource['content'] as
    | { attachment?: Record<string, unknown> }[]
    | undefined;

  if (!Array.isArray(content) || content.length === 0) return null;

  const raw = content[0]?.attachment;
  if (!raw) return null;

  return {
    data: raw['data'] as string | undefined,
    contentType: raw['contentType'] as string | undefined,
    title: raw['title'] as string | undefined,
    size: raw['size'] as number | undefined,
    url: raw['url'] as string | undefined,
  };
}

// ── syncClinicalNotes ─────────────────────────────────────────────────────────

/**
 * Syncs all available clinical notes for the signed-in user.
 *
 * Every note gets a Firestore metadata document regardless of whether inline
 * attachment data is available. Storage upload only happens when the FHIR
 * attachment carries base64-encoded `data`; url-only references are recorded
 * in Firestore with storageRef: null so they still appear in the collection.
 */
export async function syncClinicalNotes(): Promise<SyncClinicalNotesResult> {
  if (Platform.OS !== 'ios') {
    return { ok: true, uploaded: 0, skipped: 0 };
  }

  const uid = getAuth().currentUser?.uid;
  if (!uid) {
    return {
      ok: false,
      uploaded: 0,
      skipped: 0,
      error: 'no-auth: user is not signed in',
    };
  }

  try {
    console.log('[ClinicalNotes] Starting sync…');
    const notes: ClinicalRecord[] = await getClinicalNotes();
    console.log(`[ClinicalNotes] Found ${notes.length} note(s) in HealthKit`);

    if (notes.length === 0) {
      return { ok: true, uploaded: 0, skipped: 0 };
    }

    const storage = getStorage(getApp());
    let uploaded = 0;
    let skipped = 0;

    for (const note of notes) {
      // ── Idempotency check ────────────────────────────────────────────────
      const metaRef = doc(db, `users/${uid}/clinicalNotes/${note.id}`);
      const existing = await getDoc(metaRef);
      if (existing.exists()) {
        skipped++;
        continue;
      }

      // ── Extract attachment ───────────────────────────────────────────────
      const attachment = extractAttachment(note.fhirResource);
      const contentType = attachment?.contentType ?? 'application/pdf';

      // ── Upload to Firebase Storage (only when inline data is available) ──
      let storagePath: string | null = null;

      if (attachment?.data) {
        storagePath = `users/${uid}/clinical-notes/${note.id}`;
        const storageRef = ref(storage, storagePath);

        await uploadString(storageRef, attachment.data, 'base64', {
          contentType,
          customMetadata: {
            noteId: note.id,
            displayName: note.displayName,
            fhirSourceURL: note.fhirSourceURL ?? '',
          },
        });

        console.log(
          `[ClinicalNotes] Uploaded ${storagePath} (${contentType}, ~${attachment.size ?? '?'} bytes)`,
        );
        uploaded++;
      } else {
        console.log(
          `[ClinicalNotes] Note ${note.id} ("${note.displayName}") has no inline data — recording metadata only`,
        );
      }

      // ── Write metadata to Firestore (always, for every note) ────────────
      // storageRef is null when the attachment was url-only; the MedGemma
      // batch job should skip docs where storageRef === null.
      await setDoc(metaRef, {
        displayName: note.displayName,
        startDate: Timestamp.fromDate(new Date(note.startDate)),
        endDate: Timestamp.fromDate(new Date(note.endDate)),
        contentType,
        title: attachment?.title ?? null,
        storageRef: storagePath,          // null → no inline data available
        attachmentUrl: attachment?.url ?? null,
        fhirResourceType: note.fhirResourceType ?? null,
        fhirSourceURL: note.fhirSourceURL ?? null,
        // End-of-study MedGemma pipeline reads all docs where this == 'pending'
        // and storageRef != null (has uploadable content)
        medgemmaStatus: storagePath ? 'pending' : 'no-data',
        uploadedAt: serverTimestamp(),
      });
    }

    console.log(
      `[ClinicalNotes] Sync complete — uploaded to Storage: ${uploaded}, already-existed (skipped): ${skipped}`,
    );
    return { ok: true, uploaded, skipped };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[ClinicalNotes] syncClinicalNotes error:', message);
    return { ok: false, uploaded: 0, skipped: 0, error: message };
  }
}
