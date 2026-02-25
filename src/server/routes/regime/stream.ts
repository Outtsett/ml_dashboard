/**
 * HDP-HMM Regime Detection — SSE Stream & Control Routes
 *
 * Routes:
 *   GET  /api/regime/train/stream/:id  — SSE stream of training events (reconnectable)
 *   GET  /api/regime/train/status      — list active training jobs
 *   POST /api/regime/train/stop        — stop a training job
 */

import { Router, Request, Response } from "express";
import { activeJobs, emitEvent, type TrainingEvent } from "./jobManager";

const router = Router();

// ─── SSE Stream (GET — reconnectable, replays buffered events) ──────────────

router.get("/regime/train/stream/:modelId", (req: Request, res: Response) => {
  const modelId = String(req.params.modelId);
  const job = activeJobs.get(modelId);

  if (!job) {
    return res.status(404).json({ error: `No training job for ${modelId}` });
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const send = (evt: TrainingEvent) => {
    try { res.write(`event: ${evt.event}\ndata: ${JSON.stringify(evt.data)}\n\n`); } catch { /* dead */ }
  };

  // Replay all buffered events so client catches up
  const fromIdx = parseInt(req.query.from as string) || 0;
  for (let i = fromIdx; i < job.events.length; i++) {
    send(job.events[i]!);
  }
  res.write(`event: caught_up\ndata: ${JSON.stringify({ eventCount: job.events.length })}\n\n`);

  if (job.finished) {
    res.end();
    return;
  }

  // Subscribe to live events — close stream on terminal events so client can exit
  const listener = (evt: TrainingEvent) => {
    send(evt);
    if (evt.event === 'done' || evt.event === 'error') {
      job.listeners.delete(listener);
      try { res.end(); } catch { /* already closed */ }
    }
  };
  job.listeners.add(listener);

  // On disconnect: remove listener but DON'T kill the training
  req.on("close", () => {
    job.listeners.delete(listener);
    console.log(`[regime] SSE client disconnected from ${modelId} (training continues, ${job.listeners.size} listeners remain)`);
  });
});

// ─── Stop training ───────────────────────────────────────────────────────────

router.post("/regime/train/stop", async (req: Request, res: Response) => {
  try {
    const { symbol, timeframe } = req.body;
    const modelId = `${(symbol || "ES").toUpperCase()}_${timeframe || "30m"}`;

    const job = activeJobs.get(modelId);
    if (!job) {
      return res.status(404).json({ error: `No active training for ${modelId}` });
    }

    job.child.kill("SIGTERM");
    emitEvent(job, "error", { message: "Training stopped by user" });
    job.finished = true;
    job.exitCode = -1;
    setTimeout(() => activeJobs.delete(modelId), 10000);

    res.json({ message: `Stopped training ${modelId}` });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Training status ─────────────────────────────────────────────────────────

router.get("/regime/train/status", async (_req: Request, res: Response) => {
  const active: Array<{ modelId: string; elapsed: number; finished: boolean; eventCount: number }> = [];
  activeJobs.forEach((job, id) => {
    active.push({
      modelId: id,
      elapsed: (Date.now() - job.startedAt) / 1000,
      finished: job.finished,
      eventCount: job.events.length,
    });
  });
  res.json({ active });
});

export default router;
