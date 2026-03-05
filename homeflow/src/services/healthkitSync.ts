/**
 * HealthKit → Firestore incremental sync pipeline.
 *
 * Data model
 * ──────────
 *   users/{uid}/healthkit/{metricType}/samples/{sampleId}
 *     value, unit, startDate, endDate, sourceName?, deviceName?,
 *     metadata?, createdAt, updatedAt
 *
 *   users/{uid}/healthkitSync/{metricType}
 *     lastSyncedAt, lastRunAt, lastStatus, lastError?
 *
 * Idempotency
 * ───────────
 *   Each sample's Firestore doc ID is the HealthKit UUID, which is stable
 *   across retries.  Re-syncing the same sample overwrites the same doc
 *   (no duplicates).
 *
 * Incremental sync
 * ────────────────
 *   On each run the pipeline reads lastSyncedAt from Firestore and queries
 *   HealthKit for samples whose startDate ≥ (lastSyncedAt − 5 min overlap).
 *   After a successful write, lastSyncedAt is advanced to the max endDate
 *   of the newly written samples.
 */

import { Platform } from "react-native";
import * as Crypto from "expo-crypto";
import {
  doc,
  getDoc,
  setDoc,
  writeBatch,
  Timestamp,
  serverTimestamp,
} from "firebase/firestore";
import type { FieldValue } from "firebase/firestore";
import {
  queryQuantitySamples,
} from "@kingstinct/react-native-healthkit";
import type { QuantitySample } from "@kingstinct/react-native-healthkit";

import { db, getAuth } from "./firestore";
import { syncClinicalNotes } from "./clinicalNotesSync";
import { syncFhirPrefill } from "./fhirPrefillSync";

// ── Metric configuration ──────────────────────────────────────────────────────

const METRIC_CONFIG = {
  heartRate: {
    identifier: "HKQuantityTypeIdentifierHeartRate" as const,
    unit: "count/min",
  },
  stepCount: {
    identifier: "HKQuantityTypeIdentifierStepCount" as const,
    unit: "count",
  },
} as const;

export type MetricType = keyof typeof METRIC_CONFIG;

// ── Internal types ────────────────────────────────────────────────────────────

interface SyncState {
  lastSyncedAt: Timestamp | null;
  lastRunAt: Timestamp;
  lastStatus: "ok" | "error";
  lastError?: string;
}

/** Shape written to Firestore for each sample. */
interface FirestoreSampleData {
  value: number;
  unit: string;
  startDate: Timestamp;
  endDate: Timestamp;
  sourceName?: string;
  deviceName?: string;
  metadata?: Record<string, unknown>;
  createdAt: FieldValue;
  updatedAt: FieldValue;
}

/** Result returned by syncMetric(). */
export interface SyncMetricResult {
  ok: boolean;
  written: number;
  skipped: number;
  error?: string;
}

/** Result returned by syncAllHealthKit(). */
export interface SyncAllResult {
  ok: boolean;
  results: Record<MetricType, SyncMetricResult>;
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** Overlap window applied to the start of every incremental query.
 *  Catches samples that were recorded slightly before the last sync boundary
 *  due to device clock drift or delayed HK delivery. */
const OVERLAP_WINDOW_MS = 5 * 60 * 1_000; // 5 minutes

/** How far back to look on the very first sync for a metric. */
const DEFAULT_LOOKBACK_DAYS = 30;

/** Maximum docs per Firestore batch (hard limit is 500; leave headroom). */
const BATCH_SIZE = 400;

// ── buildSampleId ─────────────────────────────────────────────────────────────

/**
 * Returns a stable Firestore document ID for a HealthKit sample.
 *
 * Prefers the HK UUID (always present in kingstinct v13).  Falls back
 * to a SHA-1 digest of key fields to cover any edge case where UUID
 * is empty (shouldn't happen in practice).
 */
async function buildSampleId(
  metricType: MetricType,
  sample: QuantitySample,
): Promise<string> {
  if (sample.uuid) {
    // HealthKit UUIDs are lowercase hex + hyphens — safe as Firestore doc IDs.
    return sample.uuid;
  }

  // Deterministic fallback: SHA-1 of (metricType|startISO|endISO|value|unit|source)
  const toDate = (d: unknown): Date =>
    d instanceof Date ? d : new Date(String(d));

  const startISO = toDate(sample.startDate).toISOString();
  const endISO = toDate(sample.endDate).toISOString();
  const sourceName = sample.sourceRevision?.source?.name ?? "";
  const unit = METRIC_CONFIG[metricType].unit;
  const input = [metricType, startISO, endISO, String(sample.quantity), unit, sourceName].join("|");

  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA1,
    input,
    { encoding: Crypto.CryptoEncoding.HEX },
  );
}

// ── toFirestoreSample ─────────────────────────────────────────────────────────

/**
 * Converts a raw HealthKit QuantitySample into the shape stored in Firestore.
 * Omits createdAt/updatedAt — those are added at the write site.
 */
function toFirestoreSample(
  metricType: MetricType,
  sample: QuantitySample,
): Omit<FirestoreSampleData, "createdAt" | "updatedAt"> {
  const toDate = (d: unknown): Date =>
    d instanceof Date ? d : new Date(String(d));

  const result: Omit<FirestoreSampleData, "createdAt" | "updatedAt"> = {
    value: sample.quantity,
    unit: METRIC_CONFIG[metricType].unit,
    startDate: Timestamp.fromDate(toDate(sample.startDate)),
    endDate: Timestamp.fromDate(toDate(sample.endDate)),
  };

  const sourceName = sample.sourceRevision?.source?.name;
  if (sourceName) result.sourceName = sourceName;

  const deviceName = sample.device?.name;
  if (deviceName) result.deviceName = deviceName;

  if (sample.metadata && Object.keys(sample.metadata).length > 0) {
    result.metadata = sample.metadata as Record<string, unknown>;
  }

  return result;
}

// ── fetchHealthKitSamples ─────────────────────────────────────────────────────

/**
 * Queries HealthKit for samples of the given metric type starting from
 * sinceDate (minus the overlap window).
 *
 * Returns an empty array on non-iOS platforms.
 */
async function fetchHealthKitSamples(
  metricType: MetricType,
  sinceDate: Date,
): Promise<readonly QuantitySample[]> {
  if (Platform.OS !== "ios") return [];

  const config = METRIC_CONFIG[metricType];

  // Subtract the overlap window so we don't miss samples at the boundary.
  const startDate = new Date(sinceDate.getTime() - OVERLAP_WINDOW_MS);
  const endDate = new Date();

  return queryQuantitySamples(config.identifier as any, {
    limit: 0, // 0 = no limit — fetch every sample in the window
    unit: config.unit,
    filter: {
      date: { startDate, endDate },
    },
  });
}

// ── writeSamplesBatch ─────────────────────────────────────────────────────────

/**
 * Writes sample documents to Firestore in batches of BATCH_SIZE.
 * Uses set() (overwrite) so repeated runs are idempotent given a stable doc ID.
 */
async function writeSamplesBatch(
  uid: string,
  metricType: MetricType,
  entries: { id: string; data: FirestoreSampleData }[],
): Promise<void> {
  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const chunk = entries.slice(i, i + BATCH_SIZE);
    const batch = writeBatch(db);
    const basePath = `users/${uid}/healthkit/${metricType}/samples`;
    console.log(`[HealthKit] Writing ${chunk.length} docs → ${basePath}/`);

    for (const { id, data } of chunk) {
      const ref = doc(db, `${basePath}/${id}`);
      // Full overwrite — idempotency is guaranteed by the stable doc ID.
      batch.set(ref, data);
    }

    await batch.commit();
    console.log(`[HealthKit] Batch committed (${chunk.length} docs) for ${metricType}`);
  }
}

// ── Sync state helpers ────────────────────────────────────────────────────────

/**
 * Reads the last successful sync timestamp for a metric.
 * Returns null if this metric has never been synced.
 */
export async function getLastSync(
  uid: string,
  metricType: MetricType,
): Promise<Date | null> {
  const ref = doc(db, `users/${uid}/healthkitSync/${metricType}`);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;

  const state = snap.data() as Partial<SyncState>;
  return state.lastSyncedAt?.toDate() ?? null;
}

/**
 * Merges a partial sync-state update into Firestore.
 * Always stamps lastRunAt with the server timestamp.
 */
export async function setSyncState(
  uid: string,
  metricType: MetricType,
  patch: {
    lastSyncedAt?: Timestamp;
    lastStatus: "ok" | "error";
    lastError?: string;
  },
): Promise<void> {
  const path = `users/${uid}/healthkitSync/${metricType}`;
  console.log(`[HealthKit] setSyncState → ${path} status=${patch.lastStatus}`);
  const ref = doc(db, path);
  await setDoc(
    ref,
    { ...patch, lastRunAt: serverTimestamp() },
    { merge: true },
  ).then(() => {
    console.log(`[HealthKit] setSyncState written OK → ${path}`);
  }).catch((err) => {
    console.error(`[HealthKit] setSyncState write failed → ${path}:`, err);
    throw err;
  });
}

// ── syncMetric ────────────────────────────────────────────────────────────────

/**
 * Syncs a single HealthKit metric for the signed-in user.
 *
 * @param metricType  One of the keys in METRIC_CONFIG.
 * @param options.dryRun  If true, fetches and transforms samples but skips
 *                        all Firestore writes (useful for testing).
 */
export async function syncMetric(
  metricType: MetricType,
  options?: { dryRun?: boolean },
): Promise<SyncMetricResult> {
  const uid = getAuth().currentUser?.uid;
  if (!uid) {
    return {
      ok: false,
      written: 0,
      skipped: 0,
      error: "no-auth: user is not signed in",
    };
  }

  try {
    // 1. Determine the time window for this incremental run.
    const lastSync = await getLastSync(uid, metricType);
    const sinceDate =
      lastSync ??
      new Date(Date.now() - DEFAULT_LOOKBACK_DAYS * 24 * 60 * 60 * 1_000);

    // 2. Pull samples from HealthKit.
    const hkSamples = await fetchHealthKitSamples(metricType, sinceDate);
    if (hkSamples.length === 0) {
      return { ok: true, written: 0, skipped: 0 };
    }

    // 3. Transform each sample into a { id, data } pair.
    const entries: { id: string; data: FirestoreSampleData }[] =
      await Promise.all(
        hkSamples.map(async (sample) => {
          const id = await buildSampleId(metricType, sample);
          const data: FirestoreSampleData = {
            ...toFirestoreSample(metricType, sample),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          };
          return { id, data };
        }),
      );

    if (!options?.dryRun) {
      // 4. Write to Firestore in batches.
      await writeSamplesBatch(uid, metricType, entries);

      // 5. Advance lastSyncedAt to the maximum endDate in this batch.
      const toDate = (d: unknown): Date =>
        d instanceof Date ? d : new Date(String(d));

      const maxEndDate = hkSamples.reduce<Date>((max, s) => {
        const end = toDate(s.endDate);
        return end > max ? end : max;
      }, new Date(0));

      await setSyncState(uid, metricType, {
        lastSyncedAt: Timestamp.fromDate(maxEndDate),
        lastStatus: "ok",
      });
    }

    return { ok: true, written: entries.length, skipped: 0 };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    // Best-effort: record the error in sync state so it's visible in Firestore.
    await setSyncState(uid, metricType, {
      lastStatus: "error",
      lastError: message,
    }).catch(() => {
      // Don't let the state-write failure shadow the original error.
    });

    return { ok: false, written: 0, skipped: 0, error: message };
  }
}

// ── syncAllHealthKit ──────────────────────────────────────────────────────────

/**
 * Syncs all configured HealthKit metrics for the signed-in user.
 *
 * Metrics are processed sequentially to avoid hammering HealthKit with
 * simultaneous queries, which can cause spurious empty results.
 *
 * Returns { ok: true } only if every metric sync succeeded.
 */
export async function syncAllHealthKit(): Promise<SyncAllResult> {
  const metricTypes = Object.keys(METRIC_CONFIG) as MetricType[];
  const results = {} as Record<MetricType, SyncMetricResult>;
  let allOk = true;

  for (const metricType of metricTypes) {
    results[metricType] = await syncMetric(metricType);
    if (!results[metricType].ok) allOk = false;
  }

  return { ok: allOk, results };
}

// ── bootstrapHealthKitSync ────────────────────────────────────────────────────

/**
 * Initiates a full HealthKit sync after login.
 * Designed to be called fire-and-forget from the auth gate.
 * All errors are caught internally and logged — this never throws.
 */
export async function bootstrapHealthKitSync(): Promise<void> {
  console.log("[HealthKit] bootstrapHealthKitSync: starting");
  try {
    // All three pipelines use separate HealthKit APIs — run in parallel.
    const [hkResult, clinicalResult, fhirResult] = await Promise.all([
      syncAllHealthKit(),
      syncClinicalNotes(),
      syncFhirPrefill(),
    ]);

    if (hkResult.ok) {
      console.log("[HealthKit] bootstrapHealthKitSync: quantity metrics synced OK", hkResult.results);
    } else {
      console.warn("[HealthKit] bootstrapHealthKitSync: quantity metrics had errors", hkResult.results);
    }

    if (clinicalResult.ok) {
      console.log(
        `[HealthKit] bootstrapHealthKitSync: clinical notes synced OK — uploaded: ${clinicalResult.uploaded}, skipped: ${clinicalResult.skipped}`,
      );
    } else {
      console.warn("[HealthKit] bootstrapHealthKitSync: clinical notes sync error:", clinicalResult.error);
    }

    if (fhirResult.ok) {
      console.log(
        "[HealthKit] bootstrapHealthKitSync: FHIR prefill synced OK",
        fhirResult.sourceRecordCounts,
      );
    } else {
      console.warn("[HealthKit] bootstrapHealthKitSync: FHIR prefill sync error:", fhirResult.error);
    }
  } catch (err) {
    console.error("[HealthKit] bootstrapHealthKitSync: unexpected error:", err);
  }
}
