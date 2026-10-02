/**
 * Routes for the per-tab multiplexed event stream (mux.ts) — HTTP layer only.
 *
 *   GET  /stream/mux                              the tab's one stream; first event `ready` { connection }
 *   POST /stream/mux/:connection/subscribe        { subscription, url, lastEventId? } -> 202
 *   POST /stream/mux/:connection/unsubscribe      { subscription } -> 200
 *   GET  /stream/mux/statistics                   { connections, subscriptions, urls }
 *
 * The path holds `/stream/`, which main.ts already exempts from compression
 * (it would buffer the events) and from the 30 s request timeout.
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { muxStatistics, openConnection, subscribe, unsubscribe } from "./mux";
import { isInternalRequest } from "../infrastructure/lib/internalRequest";

const router = Router();

const subscribeBody = z.object({
  subscription: z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/),
  url: z.string().min(5).max(2048),
  lastEventId: z.string().max(256).optional(),
});

const unsubscribeBody = z.object({
  subscription: z.string().min(1).max(64),
});

router.get("/stream/mux/statistics", (_req: Request, res: Response) => {
  res.json(muxStatistics());
});

router.get("/stream/mux", (req: Request, res: Response) => {
  // The mux never opens itself (normalizeStreamUrl refuses the path); refuse an
  // internal request here as well, in case a route ever forwards one.
  if (isInternalRequest(req)) {
    res.status(400).json({ error: "the stream mux cannot be opened through itself" });
    return;
  }
  openConnection(res);
});

router.post("/stream/mux/:connection/subscribe", (req: Request, res: Response) => {
  const parsed = subscribeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid request body", details: parsed.error.flatten() });
    return;
  }
  const headers: Record<string, string> = {};
  if (typeof req.headers.cookie === "string") headers.cookie = req.headers.cookie;
  if (parsed.data.lastEventId) headers["last-event-id"] = parsed.data.lastEventId;
  const port = req.socket.localPort ?? Number(process.env.PORT ?? 5000);
  const result = subscribe(String(req.params.connection), parsed.data.subscription, parsed.data.url, port, headers);
  if (result === "unknown_connection") {
    res.status(404).json({ error: "unknown stream connection (it closed; reconnect and subscribe again)" });
    return;
  }
  if (result === "bad_url") {
    res.status(400).json({ error: `"${parsed.data.url}" is not an API path this stream can open` });
    return;
  }
  if (result === "too_many") {
    res.status(429).json({ error: "too many streams on one connection" });
    return;
  }
  res.status(202).json({ subscription: parsed.data.subscription });
});

router.post("/stream/mux/:connection/unsubscribe", (req: Request, res: Response) => {
  const parsed = unsubscribeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid request body", details: parsed.error.flatten() });
    return;
  }
  res.json({ unsubscribed: unsubscribe(String(req.params.connection), parsed.data.subscription) });
});

export default router;
