/**
 * Sidecar status and control.
 *
 *   GET  /api/sidecars                  every sidecar's runtime state + its /health body
 *   POST /api/sidecars/:slug/start      start or adopt
 *   POST /api/sidecars/:slug/stop       stop (the watchdog leaves it down)
 *   POST /api/sidecars/:slug/restart    stop + start (picks up code edits)
 *   GET  /api/sidecars/:slug/log        tail of logs/sidecar-<slug>.log
 */

import { Router, type Request, type Response } from "express";
import { findSidecar } from "./config";
import { ensureSidecar, listSidecars, logTail, restartSidecar, stopSidecar } from "./supervisor";

const router = Router();

function known(req: Request, res: Response): string | null {
  const slug = String(req.params.slug ?? "");
  if (!findSidecar(slug)) {
    res.status(404).json({ error: `unknown sidecar "${slug}"` });
    return null;
  }
  return slug;
}

router.get("/sidecars", async (_req, res) => {
  res.json({ sidecars: await listSidecars() });
});

router.post("/sidecars/:slug/start", async (req, res) => {
  const slug = known(req, res);
  if (slug) res.json(await ensureSidecar(slug));
});

router.post("/sidecars/:slug/stop", async (req, res) => {
  const slug = known(req, res);
  if (slug) res.json(await stopSidecar(slug));
});

router.post("/sidecars/:slug/restart", async (req, res) => {
  const slug = known(req, res);
  if (slug) res.json(await restartSidecar(slug));
});

router.get("/sidecars/:slug/log", (req, res) => {
  const slug = known(req, res);
  if (!slug) return;
  const bytes = Math.min(Math.max(Number(req.query.bytes ?? 20_000) || 20_000, 1_000), 500_000);
  res.type("text/plain").send(logTail(slug, bytes));
});

export default router;
