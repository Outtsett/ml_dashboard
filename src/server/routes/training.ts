/**
 * Training Routes
 *
 * Model-agnostic training API. Works with any model type registered in config/models.json.
 * Uses NestJS services via bridge pattern (getNestApp()).
 *
 * Routes:
 *   GET  /api/training/config           — Model registry + feature pipelines for UI
 *   POST /api/training/start            — Start training (any model type)
 *   GET  /api/training/stream/:modelId  — SSE stream (standardized events, reconnectable)
 *   GET  /api/training/status           — List active training jobs
 *   POST /api/training/stop/:modelId    — Stop a training job
 *
 * Model CRUD:
 *   GET    /api/training/models                    — List all trained models
 *   GET    /api/training/models/:id/diagnostics    — Diagnostics JSON
 *   GET    /api/training/models/:id/convergence    — Convergence JSON
 *   GET    /api/training/models/:id/assignments    — Per-bar regime assignments + OHLCV
 *   GET    /api/training/models/:id/benchmarks     — Buy-and-hold + SMA crossover benchmarks
 *   DELETE /api/training/models/:id                — Delete a model
 *   GET    /api/training/history                   — Quality score history (degradation tracking)
 */

import { Router, Request, Response } from "express";
import fs from "fs";
import path from "path";
import { z } from "zod";
import { CACHE_SEMI } from "../lib/cacheHeaders";
import { getNestApp } from "../nest-context";
import { mlRateLimiter } from "../lib/rateLimiter";
import { TrainingService } from "../training/training.service";
import { RegistryService } from "../training/registry.service";
import type { TrainingRequest, TrainingEvent } from "@shared/trainingTypes";
import {
  sanitizeModelId,
  listTrainedModels,
  getModelDiagnostics,
  getModelConvergence,
  getModelAssignments,
  getModelShap,
  getModelBenchmarks,
  deleteModel,
} from "../lib/modelResults";
import * as trainingStorage from "../storage/trainingStorage";

// ─── Zod schema for request validation (DIP — route depends on schema, not manual field copying) ──

/** ISO date: YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS */
const isoDatePattern = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2})?$/;

const VALID_TIMEFRAMES = ["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w"] as const;

const trainingRequestSchema = z.object({
  modelType: z.string().min(1, "modelType is required").max(64),
  symbol: z.string().min(1, "symbol is required").max(20)
    .regex(/^[A-Z][A-Z0-9_\-\/]{0,19}$/, "Invalid symbol format"),
  timeframe: z.enum(VALID_TIMEFRAMES).optional(),
  dateRange: z.object({
    start: z.string().regex(isoDatePattern, "dateRange.start must be YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS"),
    end: z.string().regex(isoDatePattern, "dateRange.end must be YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS"),
  }).optional(),
  // Allow string values for backward compat, but restrict to safe characters
  hyperparameters: z.record(z.union([
    z.number(),
    z.string().max(100).regex(/^[a-zA-Z0-9_.\-]+$/, "Unsafe hyperparameter value"),
    z.boolean(),
  ])).optional(),
  maxBars: z.number().int().min(0).max(10000000).optional(),
  featureCategories: z.array(z.string().max(50).regex(/^[a-z_]+$/, "Invalid category name")).optional(),
  includeIndicators: z.boolean().optional(),
  allFeatures: z.boolean().optional(),
  indicatorGroups: z.string().max(200).regex(/^[a-zA-Z0-9_,]+$/, "Invalid indicator group format").optional(),
  walkForward: z.object({
    trainMonths: z.number().int().min(1).max(120),
    testMonths: z.number().int().min(1).max(60),
    stepMonths: z.number().int().min(1).max(120).optional(),
  }).optional(),
}) satisfies z.ZodType<TrainingRequest>;

const router = Router();

// ─── Config (for client UI) ─────────────────────────────────────────────────

router.get("/training/config", CACHE_SEMI, (_req: Request, res: Response) => {
  try {
    const registry = getNestApp().get(RegistryService);
    res.json(registry.getClientConfig());
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/training/config/reload", (_req: Request, res: Response) => {
  try {
    const registry = getNestApp().get(RegistryService);
    registry.reload();
    res.json(registry.getClientConfig());
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Metric Descriptions (config-driven metric annotations for UI) ──────────

router.get("/training/metric-descriptions", CACHE_SEMI, async (_req: Request, res: Response) => {
  try {
    const configPath = path.resolve(process.cwd(), "src", "config", "metric-descriptions.json");
    const raw = await fs.promises.readFile(configPath, "utf-8");
    res.json(JSON.parse(raw));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Start Training ──────────────────────────────────────────────────────────

router.post("/training/start", mlRateLimiter, async (req: Request, res: Response) => {
  try {
    // Validate + parse request body via Zod schema (DIP — single source of truth)
    const parseResult = trainingRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      const errors = parseResult.error.issues.map(i => i.message).join(", ");
      return res.status(400).json({ error: errors });
    }
    const request: TrainingRequest = parseResult.data;

    const training = getNestApp().get(TrainingService);
    const result = await training.start(request);
    res.status(202).json({
      ...result,
      message: `Training started for ${result.modelId} (${request.modelType})`,
    });
  } catch (err: any) {
    const status = err.message.includes("Already training") ? 409
      : err.message.includes("Maximum concurrent") ? 429
      : err.message.includes("Unknown model") ? 400
      : 500;
    res.status(status).json({ error: err.message });
  }
});

// ─── SSE Stream (reconnectable, replays buffered events) ─────────────────────

router.get("/training/stream/:modelId", (req: Request, res: Response) => {
  const modelId = String(req.params.modelId);
  const training = getNestApp().get(TrainingService);
  const session = training.getSession(modelId);

  if (!session) {
    return res.status(404).json({ error: `No training session for ${modelId}` });
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const send = (evt: TrainingEvent) => {
    try {
      res.write(`event: ${evt.type}\ndata: ${JSON.stringify(evt.data)}\n\n`);
    } catch { /* dead connection */ }
  };

  // Replay buffered events so reconnecting client catches up
  const fromIdx = parseInt(req.query.from as string) || 0;
  for (let i = fromIdx; i < session.events.length; i++) {
    send(session.events[i]!);
  }
  res.write(`event: caught_up\ndata: ${JSON.stringify({ eventCount: session.events.length })}\n\n`);

  // If already finished, close stream
  if (session.finished) {
    res.end();
    return;
  }

  // Subscribe to live events
  const listener = (evt: TrainingEvent) => {
    send(evt);
    if (evt.type === "done" || evt.type === "error") {
      session.listeners.delete(listener);
      try { res.end(); } catch { /* already closed */ }
    }
  };
  session.listeners.add(listener);

  // On disconnect: remove listener but don't kill training
  req.on("close", () => {
    session.listeners.delete(listener);
    console.log(`[training] SSE client disconnected from ${modelId} (training continues, ${session.listeners.size} listeners remain)`);
  });
});

// ─── Status ──────────────────────────────────────────────────────────────────

router.get("/training/status", (_req: Request, res: Response) => {
  const training = getNestApp().get(TrainingService);
  res.json({ sessions: training.listSessions() });
});

// ─── Stop Training ───────────────────────────────────────────────────────────

router.post("/training/stop/:modelId", (req: Request, res: Response) => {
  const modelId = String(req.params.modelId);
  const training = getNestApp().get(TrainingService);
  const stopped = training.stop(modelId);

  if (stopped) {
    res.json({ message: `Stopped training ${modelId}` });
  } else {
    res.status(404).json({ error: `No active training for ${modelId}` });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Model CRUD (replaces legacy /api/regime/models, diagnostics, etc.)
// ═══════════════════════════════════════════════════════════════════════════

const MODELS_DIR = path.join(process.cwd(), "data", "models");

// ─── List trained models ─────────────────────────────────────────────────────

router.get("/training/models", (_req: Request, res: Response) => {
  try {
    res.json({ models: listTrainedModels(MODELS_DIR) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Diagnostics ─────────────────────────────────────────────────────────────

router.get("/training/models/:id/diagnostics", (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const diag = getModelDiagnostics(MODELS_DIR, id);
    if (!diag) return res.status(404).json({ error: `Model '${id}' not found` });
    res.json(diag);
  } catch (err: any) {
    const status = err.message.includes("Invalid model ID") ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

// ─── Convergence ─────────────────────────────────────────────────────────────

router.get("/training/models/:id/convergence", (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const conv = getModelConvergence(MODELS_DIR, id);
    if (!conv) return res.status(404).json({ error: `Convergence data for '${id}' not found` });
    res.json(conv);
  } catch (err: any) {
    const status = err.message.includes("Invalid model ID") ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

// ─── Assignments (QuestDB model_regimes table) ──────────────────────────────

router.get("/training/models/:id/assignments", async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const result = await getModelAssignments(MODELS_DIR, id, {
      limit: Math.min(Number(req.query.limit) || 10000, 10000),
      offset: Number(req.query.offset) || undefined,
    });
    if (!result) return res.status(404).json({ error: `Assignments not found for '${id}'` });
    res.json(result);
  } catch (err: any) {
    const status = err.message.includes("Invalid model ID") ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

// ─── SHAP values (per-bar feature importance) ───────────────────────────────

router.get("/training/models/:id/shap", async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const result = await getModelShap(MODELS_DIR, id, {
      regime: req.query.regime !== undefined ? Number(req.query.regime) : undefined,
      limit: Math.min(Number(req.query.limit) || 10000, 10000),
      offset: Number(req.query.offset) || undefined,
    });
    if (!result) return res.status(404).json({ error: `SHAP data not found for '${id}'` });
    res.json(result);
  } catch (err: any) {
    const status = err.message.includes("Invalid model ID") ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

// ─── Benchmarks (buy-and-hold + SMA crossover comparison) ────────────────────

router.get("/training/models/:id/benchmarks", async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const result = await getModelBenchmarks(MODELS_DIR, id);
    if (!result) return res.status(404).json({ error: "Benchmark data unavailable" });
    res.json(result);
  } catch (err: any) {
    const status = err.message.includes("Invalid model ID") ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

// ─── Delete model ────────────────────────────────────────────────────────────

router.delete("/training/models/:id", async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const deleted = await deleteModel(MODELS_DIR, id);
    if (!deleted) return res.status(404).json({ error: `Model '${id}' not found` });
    res.json({ message: `Deleted model '${id}'` });
  } catch (err: any) {
    const status = err.message.includes("Invalid model ID") ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Persisted Sessions + Metrics + Evaluation (Phase 1 Analytics)
// ═══════════════════════════════════════════════════════════════════════════

// ─── Persisted Sessions ──────────────────────────────────────────────────────

router.get("/training/sessions", (_req: Request, res: Response) => {
  try {
    const { symbol, modelType, status, limit } = _req.query;
    const sessions = trainingStorage.listSessions({
      symbol: symbol as string | undefined,
      modelType: modelType as string | undefined,
      status: status as string | undefined,
      limit: limit ? Math.min(Number(limit), 10000) : 50,
    });
    res.json({ sessions });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/training/sessions/:id", (req: Request, res: Response) => {
  try {
    const session = trainingStorage.getSession(Number(req.params.id));
    if (!session) return res.status(404).json({ error: "Session not found" });
    res.json(session);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Quality History (degradation tracking) ─────────────────────────────────

router.get("/training/history", (req: Request, res: Response) => {
  try {
    const { symbol, modelType } = req.query;
    if (!symbol || !modelType) {
      return res.status(400).json({ error: "symbol and modelType query params required" });
    }
    const sessions = trainingStorage.getQualityHistory(
      String(symbol),
      String(modelType),
    );
    res.json({ sessions });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Per-Iteration Metrics ───────────────────────────────────────────────────

router.get("/training/sessions/:id/metrics", (req: Request, res: Response) => {
  try {
    const { metricName } = req.query;
    const metrics = trainingStorage.getMetrics(
      Number(req.params.id),
      metricName as string | undefined,
    );
    res.json({ metrics });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/training/sessions/:id/metrics/names", (req: Request, res: Response) => {
  try {
    const names = trainingStorage.getMetricNames(Number(req.params.id));
    res.json({ names });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Evaluation Results ──────────────────────────────────────────────────────

router.get("/training/sessions/:id/evaluation", (req: Request, res: Response) => {
  try {
    const { stage } = req.query;
    const results = trainingStorage.getEvaluations(
      Number(req.params.id),
      stage as string | undefined,
    );
    res.json({ results });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/training/sessions/:id/evaluation/summary", (req: Request, res: Response) => {
  try {
    const summary = trainingStorage.getEvaluationSummary(Number(req.params.id));
    res.json({ summary });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Walk-Forward Group ──────────────────────────────────────────────────────

router.get("/training/walk-forward/:groupId", (req: Request, res: Response) => {
  try {
    const windows = trainingStorage.getWalkForwardGroup(String(req.params.groupId));
    if (windows.length === 0) {
      return res.status(404).json({ error: "Walk-forward group not found" });
    }
    res.json({
      groupId: req.params.groupId,
      windows,
      totalWindows: windows.length,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Visualization Registry (config-driven component resolution — OCP)
// ═══════════════════════════════════════════════════════════════════════════

router.get("/training/visualizations", CACHE_SEMI, (_req: Request, res: Response) => {
  try {
    const configPath = path.join(process.cwd(), "src", "config", "visualizations.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    res.json(config);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/training/visualizations/:category", CACHE_SEMI, (req: Request, res: Response) => {
  try {
    const configPath = path.join(process.cwd(), "src", "config", "visualizations.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    const { category } = req.params;

    const universal: string[] = config.universal || [];
    let groupComponents: string[] = [];
    let conditional: Record<string, string[]> = {};

    for (const [, groupDef] of Object.entries(config.groups)) {
      const def = groupDef as any;
      if (def.subcategories?.includes(category)) {
        groupComponents = def.components || [];
        conditional = def.conditional || {};
        break;
      }
    }

    res.json({ universal, components: groupComponents, conditional });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
