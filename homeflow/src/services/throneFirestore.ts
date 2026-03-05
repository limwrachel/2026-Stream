/**
 * Firestore read service for Throne uroflow data.
 *
 * Reads sessions and metrics from Firestore collections
 * written by the Cloud Function ingestion pipeline.
 */

import {
  collection,
  query,
  where,
  getDocs,
  QueryConstraint,
  doc,
  getDoc,
  setDoc,
} from "firebase/firestore";
import {db} from "./firebase";

// Re-export the same types the mock module used, for compatibility
export interface ThroneSession {
  id: string;
  studyId: string;
  tags: string[];
  created: string;
  updated: string;
  startTs: string;
  endTs: string;
  deviceId: string;
  userId: string;
  status: string;
  metricCount: number;
}

export interface ThroneMetric {
  id: string;
  studyId: string;
  sessionId: string;
  ts: string;
  created: string;
  updated: string;
  deleted: string | null;
  type: string;
  value: number | string;
  series: string;
  durationMicros: number;
}

/**
 * Fetch sessions from Firestore.
 * Sorting and date range filtering done client-side.
 * By default only returns sessions that have at least one metric (metricCount > 0).
 */
export async function fetchSessions(opts?: {
  userId?: string;
  startDate?: Date;
  endDate?: Date;
}): Promise<ThroneSession[]> {
  const constraints: QueryConstraint[] = [];

  if (opts?.userId) {
    constraints.push(where("userId", "==", opts.userId));
  }

  // Only return sessions that have actual recorded metric data
  constraints.push(where("metricCount", ">", 0));

  const q = query(collection(db, "sessions"), ...constraints);
  const snap = await getDocs(q);

  let sessions = snap.docs.map((doc) => doc.data() as ThroneSession);

  // Client-side date filtering
  if (opts?.startDate || opts?.endDate) {
    const startMs = opts.startDate?.getTime() ?? 0;
    const endMs = opts.endDate?.getTime() ?? Infinity;
    sessions = sessions.filter((s) => {
      const ts = new Date(s.startTs).getTime();
      return ts >= startMs && ts <= endMs;
    });
  }

  // Sort descending by startTs
  sessions.sort((a, b) => new Date(b.startTs).getTime() - new Date(a.startTs).getTime());

  return sessions;
}

/**
 * Batch-fetch metrics for multiple sessions in a single (or few) Firestore
 * queries. Firestore "in" supports up to 30 values, so large arrays are
 * automatically split into parallel batches.
 */
export async function fetchMetricsBatch(sessionIds: string[]): Promise<ThroneMetric[]> {
  if (sessionIds.length === 0) return [];

  const BATCH_SIZE = 30;
  const batches: string[][] = [];
  for (let i = 0; i < sessionIds.length; i += BATCH_SIZE) {
    batches.push(sessionIds.slice(i, i + BATCH_SIZE));
  }

  const snapshots = await Promise.all(
    batches.map(batch =>
      getDocs(query(collection(db, 'metrics'), where('sessionId', 'in', batch))),
    ),
  );

  return snapshots.flatMap(snap => snap.docs.map(d => d.data() as ThroneMetric));
}

// ─── Surgery Date ─────────────────────────────────────────────────────────────

/**
 * Read surgery date from Firestore.
 * Tries: users/{uid}/profile.surgeryDate → users/{uid}/settings.surgeryDate
 * Returns an ISO date string (YYYY-MM-DD) or null if not set.
 */
export async function fetchSurgeryDate(uid: string): Promise<string | null> {
  const paths = [
    `users/${uid}/profile`,
    `users/${uid}`,
    `users/${uid}/settings`,
  ];

  for (const path of paths) {
    try {
      const snap = await getDoc(doc(db, path));
      if (snap.exists()) {
        const data = snap.data();
        const sd = data?.surgeryDate;
        if (sd) {
          // Handle Firestore Timestamp objects and ISO strings
          if (typeof sd === 'string') return sd.slice(0, 10);
          if (sd?.toDate) return (sd.toDate() as Date).toISOString().slice(0, 10);
        }
      }
    } catch {
      // Path may not exist — try next
    }
  }

  return null;
}

/**
 * Persist surgery date to Firestore at users/{uid}/settings.
 * Uses merge so existing fields are not overwritten.
 */
export async function saveSurgeryDate(uid: string, dateStr: string): Promise<void> {
  await setDoc(
    doc(db, 'users', uid, 'settings'),
    { surgeryDate: dateStr },
    { merge: true },
  );
}

/**
 * Fetch all metrics for a given session, sorted by timestamp ascending.
 */
export async function fetchMetricsForSession(
  sessionId: string,
): Promise<ThroneMetric[]> {
  const q = query(
    collection(db, "metrics"),
    where("sessionId", "==", sessionId),
  );

  const snap = await getDocs(q);
  const metrics = snap.docs.map((doc) => doc.data() as ThroneMetric);

  // Sort ascending by timestamp client-side
  metrics.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

  return metrics;
}
