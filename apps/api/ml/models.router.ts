/**
 * Model Checkpoints & Predictions API
 *
 * CRUD for model checkpoints with self-describing diagnostics.
 * Query endpoints for prediction logs (SQLite + lake).
 *
 * Routes:
 *   GET    /api/models                          — List all checkpoints (sorted by created_at desc)
 *   GET    /api/models/:id                      — Get single checkpoint with full diagnostics
 *   GET    /api/models/:id/diagnostics          — Get self-describing diagnostics JSON only
 *   POST   /api/models                          — Register a new checkpoint
 *   PATCH  /api/models/:id/activate             — Set checkpoint as active for its symbol+timeframe
 *   DELETE /api/models/:id                      — Delete checkpoint + disk files
 *
 *   GET    /api/models/:id/predictions           — Query predictions from SQLite
 *   GET    /api/models/:id/predictions/live      — Query predictions from lake (hot path)
 *   POST   /api/models/:id/predictions           — Batch insert predictions
 *   GET    /api/models/:id/predictions/summary   — Aggregated prediction stats
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { eq, desc, and, sql } from "drizzle-orm";
import { db } from "../infrastructure/database/db";
import { modelCheckpoints, predictionLog } from "@shared/schema";
import { queryLake } from "../infrastructure/database/lake/connection";
import { sanitizeModelId } from "../infrastructure/lib/modelResults";
import { CACHE_SEMI } from "../infrastructure/cache/headers";

const router = Router();

// ─── Validation Schemas ──────────────────────────────────────────────────────

const createCheckpointSchema = z.object({
  modelId: z.string().min(1).max(128).regex(/^[a-zA-Z0-9_\-]+$/),
  modelType: z.string().min(1).max(64),
  symbol: z.string().min(1).max(20).regex(/^[A-Z][A-Z0-9_\-\/]{0,19}$/),
  timeframe: z.enum(["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w"]),
  diagnosticsJson: z.string().min(2), // Must be valid JSON string
  checkpointPath: z.string().min(1),
  diagnosticsPath: z.string().optional(),
  primaryMetric: z.number().optional(),
  primaryMetricName: z.string().max(64).optional(),
  paramCount: z.number().int().optional(),
  trainingDurationSec: z.number().optional(),
  nBarsTrain: z.number().int().optional(),
  nBarsVal: z.number().int().optional(),
  sessionId: z.number().int().optional(),
});

const insertPredictionsSchema = z.object({
  predictions: z.array(z.object({
    barTimestamp: z.number().int(),
    predictedClass: z.number().int().min(0).max(10),
    actualClass: z.number().int().min(0).max(10).optional(),
    confidence: z.number().min(0).max(1).optional(),
    probabilities: z.array(z.number()).optional(),
    realizedReturn: z.number().optional(),
    exitBars: z.number().int().optional(),
    barrierHit: z.enum(["tp", "sl", "timeout"]).optional(),
    foldIndex: z.number().int().optional(),
    splitType: z.enum(["train", "val", "oos"]).optional(),
  })).min(1).max(50000),
});

// ─── List Checkpoints ────────────────────────────────────────────────────────

router.get("/models", async (_req: Request, res: Response) => {
  try {
    const modelType = _req.query.modelType as string | undefined;
    const symbol = _req.query.symbol as string | undefined;
    const timeframe = _req.query.timeframe as string | undefined;
    const active = _req.query.active as string | undefined;

    let query = db.select({
      id: modelCheckpoints.id,
      modelId: modelCheckpoints.modelId,
      modelType: modelCheckpoints.modelType,
      symbol: modelCheckpoints.symbol,
      timeframe: modelCheckpoints.timeframe,
      diagnosticsJson: modelCheckpoints.diagnosticsJson,
      primaryMetric: modelCheckpoints.primaryMetric,
      primaryMetricName: modelCheckpoints.primaryMetricName,
      paramCount: modelCheckpoints.paramCount,
      trainingDurationSec: modelCheckpoints.trainingDurationSec,
      nBarsTrain: modelCheckpoints.nBarsTrain,
      nBarsVal: modelCheckpoints.nBarsVal,
      isActive: modelCheckpoints.isActive,
      sessionId: modelCheckpoints.sessionId,
      createdAt: modelCheckpoints.createdAt,
    }).from(modelCheckpoints)
      .orderBy(desc(modelCheckpoints.createdAt))
      .$dynamic();

    // Apply filters
    const conditions = [];
    if (modelType && typeof modelType === "string") {
      conditions.push(eq(modelCheckpoints.modelType, modelType));
    }
    if (symbol && typeof symbol === "string") {
      conditions.push(eq(modelCheckpoints.symbol, symbol.toUpperCase()));
    }
    if (timeframe && typeof timeframe === "string") {
      conditions.push(eq(modelCheckpoints.timeframe, timeframe));
    }
    if (active === "true") {
      conditions.push(eq(modelCheckpoints.isActive, 1));
    }

    if (conditions.length > 0) {
      query = query.where(and(...conditions));
    }

    const results = await query;
    res.set(CACHE_SEMI).json(results);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// ─── Get Single Checkpoint ───────────────────────────────────────────────────

router.get("/models/:id", async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid checkpoint ID" });
      return;
    }

    const checkpoint = db.select().from(modelCheckpoints)
      .where(eq(modelCheckpoints.id, id))
      .get();

    if (!checkpoint) {
      res.status(404).json({ error: "Checkpoint not found" });
      return;
    }

    // Parse diagnostics JSON for response
    const result = {
      ...checkpoint,
      diagnostics: JSON.parse(checkpoint.diagnosticsJson),
    };

    res.set(CACHE_SEMI).json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// ─── Get Diagnostics Only ────────────────────────────────────────────────────

router.get("/models/:id/diagnostics", async (req: Request, res: Response) => {
  try {
    const idParam = String(req.params.id);

    // Support both numeric ID and string modelId
    let checkpoint;
    const numId = parseInt(idParam, 10);
    if (!isNaN(numId) && String(numId) === idParam) {
      checkpoint = db.select({ diagnosticsJson: modelCheckpoints.diagnosticsJson })
        .from(modelCheckpoints)
        .where(eq(modelCheckpoints.id, numId))
        .get();
    } else {
      const safeId = sanitizeModelId(idParam);
      checkpoint = db.select({ diagnosticsJson: modelCheckpoints.diagnosticsJson })
        .from(modelCheckpoints)
        .where(eq(modelCheckpoints.modelId, safeId))
        .get();
    }

    if (!checkpoint) {
      res.status(404).json({ error: "Checkpoint not found" });
      return;
    }

    res.set(CACHE_SEMI).json(JSON.parse(checkpoint.diagnosticsJson));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// ─── Register Checkpoint ─────────────────────────────────────────────────────

router.post("/models", async (req: Request, res: Response) => {
  try {
    const parsed = createCheckpointSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten().fieldErrors });
      return;
    }

    const data = parsed.data;

    // Validate diagnostics JSON is parseable
    try {
      JSON.parse(data.diagnosticsJson);
    } catch {
      res.status(400).json({ error: "diagnosticsJson must be valid JSON" });
      return;
    }

    const result = db.insert(modelCheckpoints).values({
      modelId: data.modelId,
      modelType: data.modelType,
      symbol: data.symbol,
      timeframe: data.timeframe,
      diagnosticsJson: data.diagnosticsJson,
      checkpointPath: data.checkpointPath,
      diagnosticsPath: data.diagnosticsPath,
      primaryMetric: data.primaryMetric,
      primaryMetricName: data.primaryMetricName,
      paramCount: data.paramCount,
      trainingDurationSec: data.trainingDurationSec,
      nBarsTrain: data.nBarsTrain,
      nBarsVal: data.nBarsVal,
      sessionId: data.sessionId,
    }).returning().get();

    res.status(201).json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("UNIQUE constraint") ? 409 : 500;
    res.status(status).json({ error: message });
  }
});

// ─── Activate Checkpoint ─────────────────────────────────────────────────────

router.patch("/models/:id/activate", async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid checkpoint ID" });
      return;
    }

    const checkpoint = db.select().from(modelCheckpoints)
      .where(eq(modelCheckpoints.id, id))
      .get();

    if (!checkpoint) {
      res.status(404).json({ error: "Checkpoint not found" });
      return;
    }

    // Deactivate all other checkpoints for this symbol+timeframe
    db.update(modelCheckpoints)
      .set({ isActive: 0 })
      .where(and(
        eq(modelCheckpoints.symbol, checkpoint.symbol),
        eq(modelCheckpoints.timeframe, checkpoint.timeframe),
      ))
      .run();

    // Activate this one
    db.update(modelCheckpoints)
      .set({ isActive: 1 })
      .where(eq(modelCheckpoints.id, id))
      .run();

    res.json({ message: `Checkpoint ${id} activated for ${checkpoint.symbol} ${checkpoint.timeframe}` });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// ─── Delete Checkpoint ───────────────────────────────────────────────────────

router.delete("/models/:id", async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid checkpoint ID" });
      return;
    }

    const deleted = db.delete(modelCheckpoints)
      .where(eq(modelCheckpoints.id, id))
      .returning()
      .get();

    if (!deleted) {
      res.status(404).json({ error: "Checkpoint not found" });
      return;
    }

    res.json({ message: `Checkpoint ${id} deleted`, modelId: deleted.modelId });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// ─── Query Predictions (SQLite) ──────────────────────────────────────────────

router.get("/models/:id/predictions", async (req: Request, res: Response) => {
  try {
    const safeId = sanitizeModelId(String(req.params.id));
    const limit = Math.min(parseInt(String(req.query.limit ?? "10000"), 10) || 10000, 100000);
    const offset = parseInt(String(req.query.offset ?? "0"), 10) || 0;
    const splitType = String(req.query.split ?? "");

    const conditions = [eq(predictionLog.modelId, safeId)];
    if (splitType && ["train", "val", "oos"].includes(splitType)) {
      conditions.push(eq(predictionLog.splitType, splitType as string));
    }

    const rows = db.select().from(predictionLog)
      .where(and(...conditions))
      .limit(limit)
      .offset(offset)
      .all();

    const total = db.select({ count: sql<number>`count(*)` })
      .from(predictionLog)
      .where(and(...conditions))
      .get();

    res.set(CACHE_SEMI).json({
      rows,
      total: total?.count ?? 0,
      limit,
      offset,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// ─── Query Predictions (lake live path) ───────────────────────────────────

router.get("/models/:id/predictions/live", async (req: Request, res: Response) => {
  try {
    const safeId = sanitizeModelId(String(req.params.id));
    const limit = Math.min(parseInt(String(req.query.limit ?? "1000"), 10) || 1000, 50000);
    const since = String(req.query.since ?? ""); // ISO timestamp

    let query = `
      SELECT model_id, symbol, predicted_class, actual_class, confidence,
             prob_tp, prob_sl, prob_timeout, realized_return, exit_bars,
             barrier_hit, fold_index, split_type, timestamp
      FROM prediction_log
      WHERE model_id = '${safeId}'
    `;

    if (since) {
      query += ` AND timestamp >= '${since}'`;
    }

    query += ` ORDER BY timestamp DESC LIMIT ${limit}`;

    const rows = await queryLake(query);
    res.set(CACHE_SEMI).json({ rows, count: rows.length });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// ─── Batch Insert Predictions ────────────────────────────────────────────────

router.post("/models/:id/predictions", async (req: Request, res: Response) => {
  try {
    const safeId = sanitizeModelId(String(req.params.id));

    // Verify checkpoint exists
    const checkpoint = db.select({ id: modelCheckpoints.id, symbol: modelCheckpoints.symbol })
      .from(modelCheckpoints)
      .where(eq(modelCheckpoints.modelId, safeId))
      .get();

    if (!checkpoint) {
      res.status(404).json({ error: `Checkpoint ${safeId} not found` });
      return;
    }

    const parsed = insertPredictionsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten().fieldErrors });
      return;
    }

    const { predictions } = parsed.data;

    // Batch insert into SQLite (chunks of 500 for transaction safety)
    const CHUNK_SIZE = 500;
    let inserted = 0;

    for (let i = 0; i < predictions.length; i += CHUNK_SIZE) {
      const chunk = predictions.slice(i, i + CHUNK_SIZE);
      const values = chunk.map(p => ({
        checkpointId: checkpoint.id,
        modelId: safeId,
        symbol: checkpoint.symbol,
        barTimestamp: p.barTimestamp,
        predictedClass: p.predictedClass,
        actualClass: p.actualClass,
        confidence: p.confidence,
        probabilities: p.probabilities ? JSON.stringify(p.probabilities) : undefined,
        realizedReturn: p.realizedReturn,
        exitBars: p.exitBars,
        barrierHit: p.barrierHit,
        foldIndex: p.foldIndex,
        splitType: p.splitType ?? "oos",
      }));

      db.insert(predictionLog).values(values).run();
      inserted += chunk.length;
    }

    res.status(201).json({ inserted, modelId: safeId });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// ─── Prediction Summary ──────────────────────────────────────────────────────

router.get("/models/:id/predictions/summary", async (req: Request, res: Response) => {
  try {
    const safeId = sanitizeModelId(String(req.params.id));
    const splitType = String(req.query.split ?? "");

    const conditions = [eq(predictionLog.modelId, safeId)];
    if (splitType && ["train", "val", "oos"].includes(splitType)) {
      conditions.push(eq(predictionLog.splitType, splitType as string));
    }

    const whereClause = and(...conditions);

    // Total counts and accuracy
    const stats = db.select({
      totalPredictions: sql<number>`count(*)`,
      correctPredictions: sql<number>`sum(case when predicted_class = actual_class then 1 else 0 end)`,
      avgConfidence: sql<number>`avg(confidence)`,
      avgRealizedReturn: sql<number>`avg(realized_return)`,
      totalPositiveReturn: sql<number>`sum(case when realized_return > 0 then realized_return else 0 end)`,
      totalNegativeReturn: sql<number>`sum(case when realized_return < 0 then realized_return else 0 end)`,
      tpCount: sql<number>`sum(case when barrier_hit = 'tp' then 1 else 0 end)`,
      slCount: sql<number>`sum(case when barrier_hit = 'sl' then 1 else 0 end)`,
      timeoutCount: sql<number>`sum(case when barrier_hit = 'timeout' then 1 else 0 end)`,
      pendingCount: sql<number>`sum(case when actual_class is null then 1 else 0 end)`,
    }).from(predictionLog)
      .where(whereClause)
      .get();

    if (!stats || stats.totalPredictions === 0) {
      res.status(404).json({ error: "No predictions found" });
      return;
    }

    const accuracy = stats.correctPredictions != null
      ? stats.correctPredictions / stats.totalPredictions
      : null;

    const profitFactor = (stats.totalNegativeReturn != null && stats.totalNegativeReturn < 0)
      ? (stats.totalPositiveReturn ?? 0) / Math.abs(stats.totalNegativeReturn)
      : (stats.totalPositiveReturn ?? 0) > 0 ? Infinity : 0;

    // Per-class breakdown
    const classCounts = db.select({
      predictedClass: predictionLog.predictedClass,
      count: sql<number>`count(*)`,
      avgConfidence: sql<number>`avg(confidence)`,
      correct: sql<number>`sum(case when predicted_class = actual_class then 1 else 0 end)`,
    }).from(predictionLog)
      .where(whereClause)
      .groupBy(predictionLog.predictedClass)
      .all();

    res.set(CACHE_SEMI).json({
      modelId: safeId,
      totalPredictions: stats.totalPredictions,
      accuracy,
      avgConfidence: stats.avgConfidence,
      profitFactor,
      avgRealizedReturn: stats.avgRealizedReturn,
      barriers: {
        tp: stats.tpCount ?? 0,
        sl: stats.slCount ?? 0,
        timeout: stats.timeoutCount ?? 0,
        pending: stats.pendingCount ?? 0,
      },
      perClass: classCounts.map(c => ({
        class: c.predictedClass,
        count: c.count,
        avgConfidence: c.avgConfidence,
        accuracy: c.correct != null ? c.correct / c.count : null,
      })),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

export default router;

