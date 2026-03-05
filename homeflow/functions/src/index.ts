/**
 * StreamSync Cloud Functions
 *
 * - throneIngestDaily: Scheduled daily at 3 AM PT, syncs Throne data to Firestore
 * - syncThroneNow: HTTP trigger for manual/dev sync (requires x-admin-token header)
 *
 * Config is read from functions/.env (deployed with the function bundle).
 * Required env vars:
 *   THRONE_API_KEY, THRONE_BASE_URL, THRONE_STUDY_ID, ADMIN_TOKEN
 * Optional:
 *   THRONE_TIMEZONE (defaults to America/Los_Angeles)
 */

import {setGlobalOptions} from "firebase-functions/v2";
import {onRequest} from "firebase-functions/v2/https";
import {onSchedule} from "firebase-functions/v2/scheduler";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import {runThroneIngestion, ThroneConfig} from "./throneIngestion";

// Initialize Firebase Admin
admin.initializeApp();

// setGlobalOptions must be called before any function definitions
setGlobalOptions({maxInstances: 10});

// ─── Config from .env ────────────────────────────────────────────────────────

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

function getThroneConfig(): ThroneConfig {
  return {
    apiKey: requireEnv("THRONE_API_KEY"),
    baseUrl: requireEnv("THRONE_BASE_URL"),
    timezone: process.env.THRONE_TIMEZONE || "America/Los_Angeles",
    studyId: requireEnv("THRONE_STUDY_ID"),
  };
}

// ─── Scheduled Daily Ingestion ───────────────────────────────────────────────

export const throneIngestDaily = onSchedule(
  {
    schedule: "0 3 * * *", // 3:00 AM every day
    timeZone: "America/Los_Angeles",
  },
  async () => {
    logger.info("Starting scheduled Throne ingestion");
    const studyId = process.env.THRONE_STUDY_ID || "unknown";

    try {
      const config = getThroneConfig();
      const result = await runThroneIngestion(config);
      logger.info("Throne ingestion complete", result);
    } catch (err) {
      logger.error("Throne ingestion failed", err);

      // Record error in sync state
      const db = admin.firestore();
      await db.collection("throneSync").doc(studyId).set({
        lastRunAt: new Date().toISOString(),
        lastStatus: "error",
        lastError: err instanceof Error ? err.message : String(err),
      }, {merge: true});

      throw err;
    }
  },
);

// ─── Manual HTTP Trigger (dev/admin) ─────────────────────────────────────────

export const syncThroneNow = onRequest(async (req, res) => {
  // Only accept POST
  if (req.method !== "POST") {
    res.status(405).send("Method not allowed");
    return;
  }

  // Verify admin token
  const expected = process.env.ADMIN_TOKEN;
  const token = req.headers["x-admin-token"];
  if (!expected || !token || token !== expected) {
    res.status(401).send("Unauthorized: invalid or missing x-admin-token");
    return;
  }

  logger.info("Manual Throne sync triggered");

  try {
    const config = getThroneConfig();
    const fullSync = req.body?.fullSync === true;
    const result = await runThroneIngestion(config, {fullSync});
    res.status(200).json({
      status: "ok",
      fullSync,
      ...result,
    });
  } catch (err) {
    logger.error("Manual Throne sync failed", err);
    res.status(500).json({
      status: "error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});
