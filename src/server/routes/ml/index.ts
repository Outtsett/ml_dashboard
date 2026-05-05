import { Router } from "express";
import observatoryRouter from "./observatory";
import sessionsRouter from "./sessions";
import labelsRouter from "./labels";
import xaiRouter from "./xai";
import forecastsRouter from "./forecasts";

const router = Router();

router.use(observatoryRouter);
router.use(sessionsRouter);
router.use(labelsRouter);
router.use(xaiRouter);
router.use(forecastsRouter);

export default router;
