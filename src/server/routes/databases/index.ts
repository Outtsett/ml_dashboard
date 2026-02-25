/**
 * Database Routes — Barrel
 *
 * Combines explorer (stats/preview/query) and infrastructure (OHLCV/health/pipeline/QuestDB/cache).
 */

import { Router } from 'express';
import explorerRouter from './explorer';
import infrastructureRouter from './infrastructure';

const router = Router();

router.use(explorerRouter);
router.use(infrastructureRouter);

export default router;
