/**
 * Universal Training Routes
 *
 * Model-agnostic training API. Works with any model type registered in config/models.json.
 *
 * Routes:
 *   GET  /api/training/config           — Model registry + feature pipelines for UI
 *   POST /api/training/start            — Start training (any model type)
 *   GET  /api/training/stream/:modelId  — SSE stream (standardized events, reconnectable)
 *   GET  /api/training/status           — List active training jobs
 *   POST /api/training/stop/:modelId    — Stop a training job
 */

import { Router, Request, Response } from "express";
import { getClientConfig } from "../training/registry";
import {
  startTraining,
  stopTraining,
  getTrainingSession,
  listTrainingSessions,
} from "../training/orchestrator";
import type { TrainingRequest, TrainingEvent } from "@shared/trainingTypes";

const router = Router();

// ─── Config (for client UI) ─────────────────────────────────────────────────

router.get("/training/config", (_req: Request, res: Response) => {
  try {
    res.json(getClientConfig());
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Start Training ──────────────────────────────────────────────────────────

router.post("/training/start", async (req: Request, res: Response) => {
  try {
    const request: TrainingRequest = {
      modelType: req.body.modelType,
      symbol: req.body.symbol,        // optional — orchestrator resolves from registry
      timeframe: req.body.timeframe,  // optional — orchestrator resolves from registry
      dateRange: req.body.dateRange,
      hyperparameters: req.body.hyperparameters,
      includeIndicators: req.body.includeIndicators,
      allFeatures: req.body.allFeatures,
      indicatorGroups: req.body.indicatorGroups,
    };

    if (!request.modelType) {
      return res.status(400).json({ error: "modelType is required" });
    }

    const result = await startTraining(request);
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
  const session = getTrainingSession(modelId);

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
  res.json({ sessions: listTrainingSessions() });
});

// ─── Stop Training ───────────────────────────────────────────────────────────

router.post("/training/stop/:modelId", (req: Request, res: Response) => {
  const modelId = String(req.params.modelId);
  const stopped = stopTraining(modelId);

  if (stopped) {
    res.json({ message: `Stopped training ${modelId}` });
  } else {
    res.status(404).json({ error: `No active training for ${modelId}` });
  }
});

export default router;
