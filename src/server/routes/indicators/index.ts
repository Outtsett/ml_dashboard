import { Router } from "express";
import realtimeRouter from "./realtime";
import precomputedRouter from "./precomputed";
import pipelineRouter from "./pipeline";
import featuresRouter from "./features";

const router = Router();

// Combine all indicator sub-routers
// Order matters: specific routes before parameterized ones
router.use(precomputedRouter);   // /indicators/catalog, /indicators/data/:symbol, /indicators/patterns/:symbol
router.use(pipelineRouter);      // /indicators/compute-batch, /indicators/status
router.use(featuresRouter);      // /features/catalog, /features/data/:symbol, /features/sets
router.use(realtimeRouter);      // /indicators/list, /indicators/:id, /indicators/calculate, etc.

export default router;
