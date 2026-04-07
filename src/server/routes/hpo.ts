/**
 * HPO (Hyperparameter Optimization) Routes
 *
 * REST + SSE endpoints for launching, monitoring, and querying HPO sessions.
 * Uses standalone exported functions from hpo.service (no NestJS DI needed).
 *
 * Routes:
 *   POST /api/hpo/start             — Start a new HPO session
 *   GET  /api/hpo/stream/:sessionId — SSE stream (reconnectable, replays buffered events)
 *   GET  /api/hpo/status            — List active HPO sessions
 *   GET  /api/hpo/sessions          — List past HPO sessions (with filters)
 *   GET  /api/hpo/sessions/:id      — Full session + trial results
 *   POST /api/hpo/stop/:sessionId   — Stop a running HPO session
 *   POST /api/hpo/sessions/:id/apply — Extract best params for a new training run
 */

import { Router, Request, Response } from "express";
import {
  startHPO,
  stopHPO,
  getSession,
  listActiveSessions,
  getSessionResults,
  listPastSessions,
  applyBestParams,
} from "../training/hpo";
import { hpoRequestSchema } from "@shared/hpoTypes";

const router = Router();

// ─── Start HPO ───────────────────────────────────────────────────────────────

router.post("/hpo/start", async (req: Request, res: Response) => {
  try {
    console.log("[HPO] POST /hpo/start", {
      modelType: req.body?.modelType,
      optimizer: req.body?.optimizer?.type,
    });

    const request = hpoRequestSchema.parse(req.body);
    const { sessionId } = await startHPO(request);

    res.status(201).json({ sessionId });
  } catch (err: any) {
    if (err.name === "ZodError") {
      return res
        .status(400)
        .json({ error: "Invalid request", details: err.errors });
    }
    if (
      err.message?.includes("concurrency limit") ||
      err.message?.includes("Already running")
    ) {
      return res.status(429).json({ error: err.message });
    }
    console.error("[HPO] Route error:", err);
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

// ─── SSE Stream (reconnectable, replays buffered events) ─────────────────────

router.get("/hpo/stream/:sessionId", (req: Request, res: Response) => {
  const sessionId = String(req.params.sessionId);
  console.log("[HPO] GET /hpo/stream/:sessionId", { sessionId });

  const session = getSession(sessionId);
  if (!session) {
    return res
      .status(404)
      .json({ error: `No HPO session for ${sessionId}` });
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  // Heartbeat to keep proxies from killing idle connections
  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch { clearInterval(heartbeat); }
  }, 30000);

  const send = (evt: { type: string; data: any }) => {
    try {
      res.write(`event: ${evt.type}\ndata: ${JSON.stringify(evt.data)}\n\n`);
    } catch {
      /* dead connection */
    }
  };

  // Replay buffered events so reconnecting client catches up
  const fromIdx = parseInt(req.query.from as string) || 0;
  for (let i = fromIdx; i < session.events.length; i++) {
    send(session.events[i]!);
  }
  res.write(
    `event: caught_up\ndata: ${JSON.stringify({ eventCount: session.events.length })}\n\n`,
  );

  // If already finished, close stream
  if (session.finished) {
    clearInterval(heartbeat);
    res.end();
    return;
  }

  // Subscribe to live events
  const listener = (evt: { type: string; data: any }) => {
    send(evt);
    if (evt.type === "hpo-complete" || evt.type === "hpo-error") {
      clearInterval(heartbeat);
      session.listeners.delete(listener);
      try {
        res.end();
      } catch {
        /* already closed */
      }
    }
  };
  session.listeners.add(listener);

  // On disconnect: remove listener but don't kill HPO
  req.on("close", () => {
    clearInterval(heartbeat);
    session.listeners.delete(listener);
    console.log(
      `[HPO] SSE client disconnected from ${sessionId} (HPO continues, ${session.listeners.size} listeners remain)`,
    );
  });
});

// ─── Status (active sessions) ────────────────────────────────────────────────

router.get("/hpo/status", (_req: Request, res: Response) => {
  try {
    console.log("[HPO] GET /hpo/status");
    const sessions = listActiveSessions().map((s) => ({
      sessionId: s.sessionId,
      status: s.status,
      modelType: s.modelType,
      optimizer: s.optimizerType,
      completedTrials: s.completedTrials,
      bestScore: s.bestScore,
      elapsedSec: parseFloat(
        ((Date.now() - s.startedAt) / 1000).toFixed(1),
      ),
    }));
    res.json(sessions);
  } catch (err: any) {
    console.error("[HPO] Route error:", err);
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

// ─── Past Sessions ───────────────────────────────────────────────────────────

router.get("/hpo/sessions", (req: Request, res: Response) => {
  try {
    const { modelType, symbol, limit } = req.query;
    console.log("[HPO] GET /hpo/sessions", { modelType, symbol, limit });

    const sessions = listPastSessions({
      modelType: modelType as string | undefined,
      symbol: symbol as string | undefined,
      limit: limit ? Number(limit) : 50,
    });
    res.json({ sessions });
  } catch (err: any) {
    console.error("[HPO] Route error:", err);
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

// ─── Session Detail ──────────────────────────────────────────────────────────

router.get("/hpo/sessions/:id", (req: Request, res: Response) => {
  try {
    const sessionId = String(req.params.id);
    console.log("[HPO] GET /hpo/sessions/:id", { sessionId });

    const result = getSessionResults(sessionId);
    if (!result) {
      return res.status(404).json({ error: `HPO session ${sessionId} not found` });
    }
    res.json(result);
  } catch (err: any) {
    console.error("[HPO] Route error:", err);
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

// ─── Stop HPO ────────────────────────────────────────────────────────────────

router.post("/hpo/stop/:sessionId", (req: Request, res: Response) => {
  try {
    const sessionId = String(req.params.sessionId);
    console.log("[HPO] POST /hpo/stop/:sessionId", { sessionId });

    const stopped = stopHPO(sessionId);
    if (!stopped) {
      return res
        .status(404)
        .json({ error: `No active HPO session ${sessionId}` });
    }
    res.json({ stopped: true });
  } catch (err: any) {
    console.error("[HPO] Route error:", err);
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

// ─── Apply Best Params ──────────────────────────────────────────────────────

router.post("/hpo/sessions/:id/apply", (req: Request, res: Response) => {
  try {
    const sessionId = String(req.params.id);
    console.log("[HPO] POST /hpo/sessions/:id/apply", { sessionId });

    const result = applyBestParams(sessionId);
    res.json(result);
  } catch (err: any) {
    if (
      err.message?.includes("not found") ||
      err.message?.includes("no best params")
    ) {
      return res.status(404).json({ error: err.message });
    }
    console.error("[HPO] Route error:", err);
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

export default router;

// ��� Delete/Stop Trial ������������������������������������������������

router.delete("/hpo/trial/:id", async (req: Request, res: Response) => {
  try {
    const trialId = parseInt(req.params.id as string);
    if (isNaN(trialId)) {
      return res.status(400).json({ error: "Invalid trial ID" });
    }

    // Mark trial as stopped in SQLite
    const { db } = await import("../database/db");
    const { hpoTrials } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");

    const [trial] = await db.update(hpoTrials)
      .set({ 
        status: "stopped"})
      .where(eq(hpoTrials.id, trialId))
      .returning();

    if (!trial) {
      return res.status(404).json({ error: "Trial not found" });
    }

    console.log(`[HPO] Trial ${trialId} marked as stopped by user.`);
    res.json({ success: true, trial });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to stop trial", details: err.message });
  }
});
