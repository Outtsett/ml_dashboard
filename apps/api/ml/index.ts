import { Router } from "express";
import observatoryRouter from "./observatory.router";
import sessionsRouter from "./sessions.router";
import labelsRouter from "./labels.router";
import xaiRouter from "./xai.router";
import forecastsRouter from "./forecasts.router";

const router = Router();

// These routes were previously under /api/ml
// observatoryRouter self-prefixes its own routes with `/ml` (e.g. GET /ml/models),
// so it mounts at root here — mounting at "/ml" double-prefixed it to /api/ml/ml/*.
router.use("/", observatoryRouter);
router.use("/ml/sessions", sessionsRouter);
// labelsRouter self-prefixes `/labels` too (same shape as observatoryRouter above),
// so mounting it at "/ml/labels" produced /api/ml/labels/labels — a path no client
// ever called. Every label call site uses /api/labels/*, so mount at root.
router.use("/", labelsRouter);
router.use("/ml/xai", xaiRouter);
// Mounted at "/" because forecasts.router.ts declares FULL paths
// (`router.get("/ml/forecasts")`, forecasts.router.ts:20,51). Mounting it at
// "/ml/forecasts" prefixed those again, so the endpoint only answered at
// /api/ml/forecasts/ml/forecasts while every client call site — five of them,
// api_service.ts:54-56, forecast-visualizer/index.tsx:48, types.ts:417 — asks
// for /api/ml/forecasts and got a 404. The /forecast page has been broken by
// this.
router.use("/", forecastsRouter);

export default router;
