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
router.use("/ml/forecasts", forecastsRouter);

export default router;
