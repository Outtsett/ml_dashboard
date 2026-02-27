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
 *   DELETE /api/training/models/:id                — Delete a model
 */

import { Router, Request, Response } from "express";
import path from "path";
import { z } from "zod";
import { CACHE_SEMI } from "../lib/cacheHeaders";
import { getNestApp } from "../main";
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
  deleteModel,
} from "../lib/modelResults";

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
  includeIndicators: z.boolean().optional(),
  allFeatures: z.boolean().optional(),
  indicatorGroups: z.string().max(200).regex(/^[a-zA-Z0-9_,]+$/, "Invalid indicator group format").optional(),
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

// ─── Start Training ──────────────────────────────────────────────────────────

router.post("/training/start", async (req: Request, res: Response) => {
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
      limit: Number(req.query.limit) || undefined,
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
      limit: Number(req.query.limit) || undefined,
      offset: Number(req.query.offset) || undefined,
    });
    if (!result) return res.status(404).json({ error: `SHAP data not found for '${id}'` });
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

export default router;
