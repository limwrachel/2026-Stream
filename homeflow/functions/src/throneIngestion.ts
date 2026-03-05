/**
 * Throne Research API Ingestion Module
 *
 * Fetches uroflow session data from Throne Research API,
 * normalizes sessions + metrics, and writes to Firestore.
 *
 * Firestore schema:
 *   sessions/{sessionId}   — NormalizedSession + studyId
 *   metrics/{metricId}     — NormalizedMetric + studyId
 *   throneSync/{studyId}   — SyncState (lastRunAt, lastLtTs, etc.)
 */

import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ThroneMetricRaw {
  id: string;
  ts: string;
  created: string;
  updated: string;
  deleted: string | null;
  sessionId: string;
  type: string;
  value: string;
  series: string;
  durationMicros: string;
}

interface ThroneSessionRaw {
  id: string;
  tags: string[];
  created: string;
  updated: string;
  startTs: string;
  endTs: string;
  deviceId: string;
  userId: string;
  status: string;
  metrics: ThroneMetricRaw[];
}

interface ExportResponse {
  studyId: string;
  sessions: ThroneSessionRaw[];
  page: number;
  count: number;
  hasMore: boolean;
}

export interface NormalizedSession {
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

export interface NormalizedMetric {
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

interface SyncState {
  lastRunAt: string;
  lastLtTs: string;
  lastStatus: "success" | "error";
  lastError: string | null;
  sessionCount: number;
  metricCount: number;
}

// ─── Config ──────────────────────────────────────────────────────────────────

export interface ThroneConfig {
  apiKey: string;
  baseUrl: string;
  timezone: string;
  studyId: string;
}

// ─── API Helpers ─────────────────────────────────────────────────────────────

function apiHeaders(config: ThroneConfig): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "api-key": config.apiKey,
    "x-throne-tz": config.timezone,
  };
}

async function fetchExportPage(
  config: ThroneConfig,
  page: number,
  gtTs: string,
  ltTs: string,
): Promise<ExportResponse> {
  const url = `${config.baseUrl}/api.Research/Export`;
  logger.info(`Throne Export page=${page}`, {gtTs, ltTs});

  const res = await fetch(url, {
    method: "POST",
    headers: apiHeaders(config),
    body: JSON.stringify({
      studyId: config.studyId,
      gtTs,
      ltTs,
      page,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Throne Export page ${page} failed: ${res.status} ${body}`);
  }

  return res.json() as Promise<ExportResponse>;
}

// ─── Normalization ───────────────────────────────────────────────────────────

function normalizeValue(val: string): number | string {
  if (val === "" || val === null || val === undefined) return val;
  const n = Number(val);
  return Number.isFinite(n) ? n : val;
}

function normalizeSessions(
  pages: ExportResponse[],
  studyId: string,
): { sessions: NormalizedSession[]; metrics: NormalizedMetric[] } {
  const sessionMap = new Map<string, NormalizedSession>();
  const metricMap = new Map<string, NormalizedMetric>();

  for (const page of pages) {
    for (const s of page.sessions) {
      if (!sessionMap.has(s.id)) {
        sessionMap.set(s.id, {
          id: s.id,
          studyId,
          tags: s.tags,
          created: s.created,
          updated: s.updated,
          startTs: s.startTs,
          endTs: s.endTs,
          deviceId: s.deviceId,
          userId: s.userId,
          status: s.status,
          metricCount: s.metrics.length,
        });
      }

      for (const m of s.metrics) {
        if (!metricMap.has(m.id)) {
          metricMap.set(m.id, {
            id: m.id,
            studyId,
            sessionId: m.sessionId || s.id,
            ts: m.ts,
            created: m.created,
            updated: m.updated,
            deleted: m.deleted,
            type: m.type,
            value: normalizeValue(m.value),
            series: m.series,
            durationMicros: Number(m.durationMicros) || 0,
          });
        }
      }
    }
  }

  return {
    sessions: Array.from(sessionMap.values()),
    metrics: Array.from(metricMap.values()),
  };
}

// ─── Firestore Writer ────────────────────────────────────────────────────────

const BATCH_LIMIT = 400; // Firestore limit is 500; leave headroom

async function writeToFirestore(
  db: admin.firestore.Firestore,
  sessions: NormalizedSession[],
  metrics: NormalizedMetric[],
): Promise<void> {
  // Write sessions in batches
  for (let i = 0; i < sessions.length; i += BATCH_LIMIT) {
    const batch = db.batch();
    const chunk = sessions.slice(i, i + BATCH_LIMIT);
    for (const s of chunk) {
      batch.set(db.collection("sessions").doc(s.id), s, {merge: true});
    }
    await batch.commit();
    logger.info(`Wrote sessions batch ${i}-${i + chunk.length}`);
  }

  // Write metrics in batches
  for (let i = 0; i < metrics.length; i += BATCH_LIMIT) {
    const batch = db.batch();
    const chunk = metrics.slice(i, i + BATCH_LIMIT);
    for (const m of chunk) {
      batch.set(db.collection("metrics").doc(m.id), m, {merge: true});
    }
    await batch.commit();
    logger.info(`Wrote metrics batch ${i}-${i + chunk.length}`);
  }
}

// ─── Main Ingestion Logic ────────────────────────────────────────────────────

export async function runThroneIngestion(
  config: ThroneConfig,
  opts?: { fullSync?: boolean },
): Promise<{ sessionCount: number; metricCount: number }> {
  const db = admin.firestore();
  const studyId = config.studyId;

  // Determine time window: check last sync state or default to last 7 days
  const syncRef = db.collection("throneSync").doc(studyId);
  const syncDoc = await syncRef.get();

  const now = new Date();
  let gtTs: string;
  const ltTs = now.toISOString();

  if (opts?.fullSync) {
    // Full sync: go back 1 year to capture all historical data
    const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
    gtTs = oneYearAgo.toISOString();
    logger.info(`Full sync requested, fetching from ${gtTs}`);
  } else if (syncDoc.exists) {
    const data = syncDoc.data() as SyncState;
    // Use last ltTs as the new gtTs for incremental sync
    gtTs = data.lastLtTs;
    logger.info(`Incremental sync from ${gtTs}`);
  } else {
    // First run: default to last 7 days
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    gtTs = sevenDaysAgo.toISOString();
    logger.info(`Initial sync from ${gtTs}`);
  }

  // Fetch all pages
  const allPages: ExportResponse[] = [];
  let page = 0;
  let hasMore = true;

  while (hasMore) {
    const data = await fetchExportPage(config, page, gtTs, ltTs);
    allPages.push(data);
    logger.info(`Page ${page}: ${data.count} sessions, hasMore=${data.hasMore}`);
    hasMore = data.hasMore;
    page++;

    // Safety: cap at 100 pages
    if (page > 100) {
      logger.warn("Exceeded 100 pages, stopping pagination");
      break;
    }
  }

  // Normalize
  const {sessions, metrics} = normalizeSessions(allPages, studyId);
  logger.info(`Normalized: ${sessions.length} sessions, ${metrics.length} metrics`);

  // Write to Firestore
  if (sessions.length > 0 || metrics.length > 0) {
    await writeToFirestore(db, sessions, metrics);
  }

  // Update sync state
  const syncState: SyncState = {
    lastRunAt: now.toISOString(),
    lastLtTs: ltTs,
    lastStatus: "success",
    lastError: null,
    sessionCount: sessions.length,
    metricCount: metrics.length,
  };
  await syncRef.set(syncState, {merge: true});

  return {sessionCount: sessions.length, metricCount: metrics.length};
}
