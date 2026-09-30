/**
 * Routes for the chart <-> notebook link (chartLink.ts) — HTTP layer only.
 *
 *   PUT    /chart/context            the browser's Market chart publishes what it shows
 *   GET    /chart/context            -> ChartContext | 404 before the chart has published
 *   GET    /chart/overlays           -> { sets: OverlaySet[] }
 *   PUT    /chart/overlays           { source, symbol, timeframe, overlays[] } replaces that source's set
 *   DELETE /chart/overlays/:source   removes one source's set; DELETE /chart/overlays removes all
 *   GET    /chart/stream             server-sent events: `context` and `overlays`, current
 *                                    state first, then every change; a heartbeat every 15 s
 *
 * The stream's path holds `/stream/`, exempting it from compression and the
 * request timeout (main.ts). The browser opens it through its shared connection
 * (openEventStream); a notebook opens it, or polls GET, over plain HTTP.
 */

import { Router, type Request, type Response } from "express";
import {
  ChartContextSchema,
  OverlaySetSchema,
  chartLinkEvents,
  clearAllOverlaySets,
  clearOverlaySet,
  getChartContext,
  listOverlaySets,
  putOverlaySet,
  setChartContext,
  type ChartContext,
  type OverlaySet,
} from "./chartLink";

const router = Router();
const HEARTBEAT_MS = 15_000;

router.put("/chart/context", (req: Request, res: Response) => {
  const parsed = ChartContextSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid chart context", details: parsed.error.flatten() });
    return;
  }
  const changed = setChartContext(parsed.data);
  res.json({ changed, context: getChartContext() });
});

router.get("/chart/context", (_req: Request, res: Response) => {
  const context = getChartContext();
  if (!context) {
    res.status(404).json({ error: "the Market chart has not published its context yet (open the dashboard)" });
    return;
  }
  res.json(context);
});

router.get("/chart/overlays", (_req: Request, res: Response) => {
  res.json({ sets: listOverlaySets() });
});

router.put("/chart/overlays", (req: Request, res: Response) => {
  const parsed = OverlaySetSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid overlay set", details: parsed.error.flatten() });
    return;
  }
  res.json({ set: putOverlaySet(parsed.data) });
});

router.delete("/chart/overlays/:source", (req: Request, res: Response) => {
  res.json({ removed: clearOverlaySet(String(req.params.source)) });
});

router.delete("/chart/overlays", (_req: Request, res: Response) => {
  res.json({ removed: clearAllOverlaySets() });
});

router.get("/chart/stream", (req: Request, res: Response) => {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const write = (event: string, data: unknown) => {
    if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const onContext = (context: ChartContext) => write("context", context);
  const onOverlays = (sets: OverlaySet[]) => write("overlays", sets);

  res.write("retry: 2000\n\n");
  const context = getChartContext();
  if (context) write("context", context);
  write("overlays", listOverlaySets());
  chartLinkEvents.on("context", onContext);
  chartLinkEvents.on("overlays", onOverlays);
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(": heartbeat\n\n");
  }, HEARTBEAT_MS);
  heartbeat.unref?.();

  req.on("close", () => {
    clearInterval(heartbeat);
    chartLinkEvents.off("context", onContext);
    chartLinkEvents.off("overlays", onOverlays);
  });
});

export default router;
