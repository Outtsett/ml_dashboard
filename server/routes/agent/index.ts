/**
 * Trading Agent Routes — Barrel
 *
 * Combines inference, pipeline, walk-forward, and management sub-routers.
 */

import { Router } from 'express';
import inferenceRouter from './inference';
import pipelineRouter from './pipeline';
import walkForwardRouter from './walkForward';
import managementRouter from './management';

const router = Router();

router.use(inferenceRouter);
router.use(pipelineRouter);
router.use(walkForwardRouter);
router.use(managementRouter);

export default router;
