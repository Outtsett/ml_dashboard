/**
 * Settings Routes
 *
 * CRUD for user preferences (key/value store) and read-only server config.
 *
 * Routes:
 *   GET    /api/settings               — All preferences grouped by category
 *   GET    /api/settings/config        — Read-only server config (safe subset)
 *   PUT    /api/settings               — Upsert preferences (batch)
 *   DELETE /api/settings/:key          — Delete a single preference
 *   POST   /api/settings/test-connection — Test QuestDB or SQLite connectivity
 *
 * ML Studio "where I left off" — server-side, so it survives a different
 * browser or a different machine, not just an F5:
 *   GET    /api/settings/ml-studio-pipeline                      — resume list
 *   GET    /api/settings/ml-studio-pipeline/:symbol/:timeframe   — one blob
 *   PUT    /api/settings/ml-studio-pipeline/:symbol/:timeframe   — upsert blob
 *   DELETE /api/settings/ml-studio-pipeline/:symbol/:timeframe   — forget pair
 *
 * The sub-path routes are registered BEFORE `DELETE /settings/:key`
 * deliberately. Express matches in registration order; `/settings/:key` is a
 * single-segment pattern and cannot swallow a three-segment path, but keeping
 * them above removes the question entirely if a broader pattern is ever added.
 */

import { Router } from "express";
import { db } from "../infrastructure/database/db";
import {
  userPreferences,
  mlStudioPipelineStates,
  validateSymbol,
  type MlStudioPipelineDocument,
} from "@shared/schema";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import fs from "fs";
import path from "path";

const router = Router();

// GET /api/settings — return all user preferences grouped by category
router.get("/settings", async (_req, res) => {
  try {
    const prefs = await db.select().from(userPreferences);

    // Group by category and parse JSON values
    const grouped: Record<string, Record<string, unknown>> = {};
    for (const pref of prefs) {
      if (!grouped[pref.category]) grouped[pref.category] = {};
      const bucket = grouped[pref.category]!;
      try {
        bucket[pref.key] = JSON.parse(pref.value);
      } catch {
        bucket[pref.key] = pref.value;
      }
    }

    res.json(grouped);
  } catch (error) {
    console.error("[settings] Failed to read preferences:", error);
    res.status(500).json({ error: "Failed to read settings" });
  }
});

// GET /api/settings/config — return read-only server config (safe subset)
router.get("/settings/config", async (_req, res) => {
  try {
    const configDir = path.join(process.cwd(), "src", "config");
    const trainingJson = JSON.parse(
      fs.readFileSync(path.join(configDir, "training.json"), "utf-8"),
    );

    res.json({
      questdb: {
        host: process.env.QUESTDB_HOST || "localhost",
        httpPort: parseInt(process.env.QUESTDB_HTTP_PORT || "9000"),
        pgPort: parseInt(process.env.QUESTDB_PG_PORT || "8812"),
      },
      training: {
        pythonExe: trainingJson?.paths?.pythonExe ?? ".venv/Scripts/python.exe",
        modelsDir: trainingJson?.paths?.modelsDir ?? "data/models",
        maxConcurrentJobs: trainingJson?.limits?.maxConcurrentJobs ?? 1,
        maxBarsDefault: trainingJson?.limits?.maxBarsDefault ?? 0,
        maxTrainingDurationSec:
          trainingJson?.limits?.maxTrainingDurationSec ?? 7200,
      },
      nodeEnv: process.env.NODE_ENV || "development",
      port: parseInt(process.env.PORT || "5000"),
    });
  } catch (error) {
    console.error("[settings] Failed to read config:", error);
    res.status(500).json({ error: "Failed to read config" });
  }
});

// ── ML Studio pipeline state ─────────────────────────────────────
//
// The Workshop's six-stage document, keyed by the same natural key the client
// keys its localStorage by: (symbol, timeframe). localStorage is per-device;
// this is not. `userId` is fixed at "local" until an auth flow exists — the
// same placeholder convention `curriculum.router.ts` uses for its own user id.

const ML_STUDIO_PIPELINE_USER_ID = "local";

/** Same set every other router validates a timeframe against (see
 *  `ml/models.router.ts`, `ml/registry.router.ts`, `deployments.router.ts`). */
const MlStudioTimeframeSchema = z.enum([
  "1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w",
]);

const MlStudioPipelinePutSchema = z.object({
  /** The whole client reducer state. Stored opaquely; never reached into. */
  pipelineState: z.record(z.unknown()),
  schemaVersion: z.number().int().positive().optional(),
  /** Opaque browser/tab id, so a later conflict can name the other device. */
  clientId: z.string().max(128).optional(),
  /** The revision the client believes it is editing. Omit to force-overwrite. */
  expectedRevision: z.number().int().nonnegative().optional(),
});

/** Normalize + validate the pair in the path. Returns null on a bad pair. */
function parsePipelinePair(
  rawSymbol: string,
  rawTimeframe: string,
): { symbol: string; timeframe: string } | null {
  let symbol: string;
  try {
    symbol = validateSymbol(rawSymbol);
  } catch {
    return null;
  }
  const timeframe = MlStudioTimeframeSchema.safeParse(rawTimeframe);
  if (!timeframe.success) return null;
  return { symbol, timeframe: timeframe.data };
}

/** The (user, symbol, timeframe) predicate every one of these routes uses. */
function pipelinePairWhere(symbol: string, timeframe: string) {
  return and(
    eq(mlStudioPipelineStates.userId, ML_STUDIO_PIPELINE_USER_ID),
    eq(mlStudioPipelineStates.symbol, symbol),
    eq(mlStudioPipelineStates.timeframe, timeframe),
  );
}

// GET /api/settings/ml-studio-pipeline — every saved pair, newest first.
// Deliberately omits `pipeline_state`: this is the resume picker, and the blob
// is the one column that can be megabytes.
router.get("/settings/ml-studio-pipeline", async (_req, res) => {
  try {
    const rows = await db
      .select({
        symbol: mlStudioPipelineStates.symbol,
        timeframe: mlStudioPipelineStates.timeframe,
        schemaVersion: mlStudioPipelineStates.schemaVersion,
        activeStage: mlStudioPipelineStates.activeStage,
        experimentCount: mlStudioPipelineStates.experimentCount,
        stateByteCount: mlStudioPipelineStates.stateByteCount,
        clientRevision: mlStudioPipelineStates.clientRevision,
        updatedByClientId: mlStudioPipelineStates.updatedByClientId,
        updatedAt: mlStudioPipelineStates.updatedAt,
      })
      .from(mlStudioPipelineStates)
      .where(eq(mlStudioPipelineStates.userId, ML_STUDIO_PIPELINE_USER_ID))
      .orderBy(desc(mlStudioPipelineStates.updatedAt));

    res.json({ pairs: rows });
  } catch (error) {
    console.error("[settings] Failed to list ML Studio pipeline states:", error);
    res.status(500).json({ error: "Failed to list ML Studio pipeline states" });
  }
});

// GET /api/settings/ml-studio-pipeline/:symbol/:timeframe — one full document.
// 404 carries `{ found: false }` so a caller can fall back to its local copy
// without treating a never-saved pair as an error.
router.get("/settings/ml-studio-pipeline/:symbol/:timeframe", async (req, res) => {
  try {
    const pair = parsePipelinePair(req.params.symbol, req.params.timeframe);
    if (!pair) {
      return res.status(400).json({ error: "Invalid symbol or timeframe" });
    }

    const [row] = await db
      .select()
      .from(mlStudioPipelineStates)
      .where(pipelinePairWhere(pair.symbol, pair.timeframe))
      .limit(1);

    if (!row) {
      return res.status(404).json({ found: false, ...pair });
    }

    res.json({
      found: true,
      symbol: row.symbol,
      timeframe: row.timeframe,
      schemaVersion: row.schemaVersion,
      activeStage: row.activeStage,
      experimentCount: row.experimentCount,
      stateByteCount: row.stateByteCount,
      clientRevision: row.clientRevision,
      updatedByClientId: row.updatedByClientId,
      updatedAt: row.updatedAt,
      pipelineState: row.pipelineState,
    });
  } catch (error) {
    console.error("[settings] Failed to read ML Studio pipeline state:", error);
    res.status(500).json({ error: "Failed to read ML Studio pipeline state" });
  }
});

// PUT /api/settings/ml-studio-pipeline/:symbol/:timeframe — upsert the blob.
// Optimistic concurrency: send `expectedRevision` and a write from a stale
// device comes back 409 with the winning row, rather than silently clobbering
// the other machine's ledger. Omit it and it is last-write-wins.
router.put("/settings/ml-studio-pipeline/:symbol/:timeframe", async (req, res) => {
  try {
    const pair = parsePipelinePair(req.params.symbol, req.params.timeframe);
    if (!pair) {
      return res.status(400).json({ error: "Invalid symbol or timeframe" });
    }

    const parsed = MlStudioPipelinePutSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error:
          "Body must be { pipelineState, schemaVersion?, clientId?, expectedRevision? }",
        details: parsed.error.issues,
      });
    }

    const document = parsed.data.pipelineState as MlStudioPipelineDocument;
    const serialized = JSON.stringify(document);
    const activeStage =
      typeof document.activeStage === "string" ? document.activeStage : null;
    const experimentCount = Array.isArray(document.experiments)
      ? document.experiments.length
      : 0;

    const [existing] = await db
      .select({
        clientRevision: mlStudioPipelineStates.clientRevision,
        updatedByClientId: mlStudioPipelineStates.updatedByClientId,
        updatedAt: mlStudioPipelineStates.updatedAt,
      })
      .from(mlStudioPipelineStates)
      .where(pipelinePairWhere(pair.symbol, pair.timeframe))
      .limit(1);

    const currentRevision = existing?.clientRevision ?? 0;
    if (
      parsed.data.expectedRevision !== undefined &&
      parsed.data.expectedRevision !== currentRevision
    ) {
      return res.status(409).json({
        error: "Stale revision - another device saved this pair first",
        ...pair,
        clientRevision: currentRevision,
        updatedByClientId: existing?.updatedByClientId ?? null,
        updatedAt: existing?.updatedAt ?? null,
      });
    }

    const nextRevision = currentRevision + 1;
    const values = {
      userId: ML_STUDIO_PIPELINE_USER_ID,
      symbol: pair.symbol,
      timeframe: pair.timeframe,
      schemaVersion: parsed.data.schemaVersion ?? 2,
      activeStage,
      experimentCount,
      stateByteCount: Buffer.byteLength(serialized, "utf8"),
      pipelineState: document,
      clientRevision: nextRevision,
      updatedByClientId: parsed.data.clientId ?? null,
    };

    db.insert(mlStudioPipelineStates)
      .values(values)
      .onConflictDoUpdate({
        target: [
          mlStudioPipelineStates.userId,
          mlStudioPipelineStates.symbol,
          mlStudioPipelineStates.timeframe,
        ],
        set: {
          schemaVersion: values.schemaVersion,
          activeStage: values.activeStage,
          experimentCount: values.experimentCount,
          stateByteCount: values.stateByteCount,
          pipelineState: values.pipelineState,
          clientRevision: values.clientRevision,
          updatedByClientId: values.updatedByClientId,
          updatedAt: sql`(unixepoch() * 1000)`,
        },
      })
      .run();

    res.json({
      saved: true,
      ...pair,
      clientRevision: nextRevision,
      experimentCount,
      stateByteCount: values.stateByteCount,
    });
  } catch (error) {
    console.error("[settings] Failed to save ML Studio pipeline state:", error);
    res.status(500).json({ error: "Failed to save ML Studio pipeline state" });
  }
});

// DELETE /api/settings/ml-studio-pipeline/:symbol/:timeframe — forget one pair.
router.delete("/settings/ml-studio-pipeline/:symbol/:timeframe", async (req, res) => {
  try {
    const pair = parsePipelinePair(req.params.symbol, req.params.timeframe);
    if (!pair) {
      return res.status(400).json({ error: "Invalid symbol or timeframe" });
    }

    db.delete(mlStudioPipelineStates)
      .where(pipelinePairWhere(pair.symbol, pair.timeframe))
      .run();

    res.json({ deleted: true, ...pair });
  } catch (error) {
    console.error("[settings] Failed to delete ML Studio pipeline state:", error);
    res.status(500).json({ error: "Failed to delete ML Studio pipeline state" });
  }
});

// PUT /api/settings — upsert user preferences
router.put("/settings", async (req, res) => {
  try {
    const updates: Array<{ key: string; value: unknown; category?: string }> =
      req.body;

    if (!Array.isArray(updates)) {
      return res
        .status(400)
        .json({ error: 'Body must be an array of { key, value, category? }' });
    }

    const results: Array<{ key: string; status: string }> = [];

    for (const { key, value, category } of updates) {
      if (!key) continue;

      const jsonValue = JSON.stringify(value);
      const cat = category || "general";

      // Upsert: try insert, on conflict update
      db.insert(userPreferences)
        .values({ key, value: jsonValue, category: cat })
        .onConflictDoUpdate({
          target: userPreferences.key,
          set: {
            value: jsonValue,
            category: cat,
            updatedAt: sql`(unixepoch() * 1000)`,
          },
        })
        .run();

      results.push({ key, status: "saved" });
    }

    res.json({ updated: results.length, results });
  } catch (error) {
    console.error("[settings] Failed to save preferences:", error);
    res.status(500).json({ error: "Failed to save settings" });
  }
});

// DELETE /api/settings/:key — delete a single preference
router.delete("/settings/:key", async (req, res) => {
  try {
    const { key } = req.params;
    db.delete(userPreferences).where(eq(userPreferences.key, key)).run();
    res.json({ deleted: key });
  } catch (error) {
    console.error("[settings] Failed to delete preference:", error);
    res.status(500).json({ error: "Failed to delete setting" });
  }
});

// POST /api/settings/test-connection — test QuestDB or SQLite connectivity
router.post("/settings/test-connection", async (req, res) => {
  try {
    const { type } = req.body; // "questdb" or "sqlite"

    if (type === "questdb") {
      const host = process.env.QUESTDB_HOST || "localhost";
      const httpPort = parseInt(process.env.QUESTDB_HTTP_PORT || "9000");
      const url = `http://${host}:${httpPort}/exec?query=${encodeURIComponent("SELECT 1")}`;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      try {
        const qdbRes = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);
        res.json({
          connected: qdbRes.ok,
          type: "questdb",
          host,
          port: httpPort,
        });
      } catch {
        clearTimeout(timeout);
        res.json({
          connected: false,
          type: "questdb",
          host,
          port: httpPort,
          error: "Connection refused",
        });
      }
    } else if (type === "sqlite") {
      try {
        db.select({ one: sql`1` }).from(userPreferences).limit(1);
        res.json({ connected: true, type: "sqlite" });
      } catch {
        // Table might not exist yet, but connection works
        res.json({
          connected: true,
          type: "sqlite",
          note: "Table may not exist yet",
        });
      }
    } else {
      res
        .status(400)
        .json({ error: "Unknown connection type. Use 'questdb' or 'sqlite'" });
    }
  } catch (error) {
    console.error("[settings] Connection test failed:", error);
    res.status(500).json({ error: "Connection test failed" });
  }
});

export default router;
