/**
 * Database Routes — OHLCV, Health, Pipeline, QuestDB, Cache
 *
 * Routes:
 *   GET  /api/ohlcv/:symbol
 *   GET  /api/health
 *   GET  /api/metrics
 *   GET  /api/rate-limits
 *   POST /api/circuit-breaker/reset/:name
 *   POST /api/circuit-breaker/reset-all
 *   GET  /api/pipeline/status|jobs
 *   POST /api/pipeline/jobs
 *   GET  /api/pipeline/sources/:symbol
 *   POST /api/questdb/:symbol/export-parquet
 *   GET  /api/questdb/symbols
 *   GET  /api/questdb/:symbol/stats
 *   GET  /api/questdb/status
 *   POST /api/questdb/start|stop|init
 *   GET  /api/questdb/ohlcv/:symbol
 *   GET  /api/cache/stats
 *   POST /api/cache/clear|invalidate/:symbol
 */

import { Router, Request, Response } from 'express';
import { queryRateLimiter } from '../../lib/rateLimiter';
import { ohlcvCache } from '../../lib/ohlcvCache';
import { queryOHLCV } from '../../lib/databaseManager';
import { getString } from '../helpers';

const router = Router();

// ============================================================
// OHLCV DATA ENDPOINT
// ============================================================

router.get('/ohlcv/:symbol', queryRateLimiter, async (req: Request, res: Response) => {
  try {
    const symbol = getString(req.params.symbol).toUpperCase();
    const timeframe = req.query.timeframe as string;
    const startTime = getString(req.query.startTime as string);
    const endTime = getString(req.query.endTime as string);
    const limit = getString(req.query.limit as string);

    const data = await queryOHLCV({
      symbol,
      timeframe,
      startTime: startTime ? parseInt(startTime) : undefined,
      endTime: endTime ? parseInt(endTime) : undefined,
      limit: limit ? parseInt(limit) : undefined,
    });

    res.json(data);
  } catch (error) {
    console.error('Error fetching OHLCV data:', error);
    res.status(500).json({ error: 'Failed to fetch data' });
  }
});

// ============================================================
// MONITORING & HEALTH
// ============================================================

router.get('/health', async (_req: Request, res: Response) => {
  try {
    const { getNestApp } = await import('../../main');
    const { HealthService } = await import('../../core/health/health.service');
    const healthService = getNestApp().get(HealthService);
    const result = await healthService.check();
    res.status(result.status === 'ok' ? 200 : 503).json(result);
  } catch (error: any) {
    // Fallback to old health checks if NestJS not ready
    const { runHealthChecks } = await import('../../lib/databaseHealth');
    const health = await runHealthChecks();
    res.json(health);
  }
});

router.get('/metrics', async (_req: Request, res: Response) => {
  try {
    const { pipelineMetrics } = await import('../../lib/metrics');
    const { getAllCircuitBreakerStats } = await import('../../lib/circuitBreaker');
    res.json({
      pipeline: pipelineMetrics.getSnapshot(),
      circuitBreakers: getAllCircuitBreakerStats(),
      timestamp: Date.now(),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/rate-limits', async (_req: Request, res: Response) => {
  try {
    const { getRateLimitStats } = await import('../../lib/rateLimiter');
    res.json(getRateLimitStats());
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/circuit-breaker/reset/:name', async (req: Request, res: Response) => {
  try {
    const name = getString(req.params.name);
    const { resetCircuitBreaker } = await import('../../lib/circuitBreaker');
    const success = resetCircuitBreaker(name);
    res.json({ success, name });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/circuit-breaker/reset-all', async (_req: Request, res: Response) => {
  try {
    const { resetAllCircuitBreakers } = await import('../../lib/circuitBreaker');
    const reset = resetAllCircuitBreakers();
    res.json({ success: true, reset });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// DATA PIPELINE
// ============================================================

router.get('/pipeline/status', async (_req: Request, res: Response) => {
  try {
    const { dataPipeline } = await import('../../lib/dataPipeline');
    res.json({
      config: dataPipeline.getConfig(),
      stats: dataPipeline.getStats(),
      activeJobs: dataPipeline.getActiveJobs(),
      queuedJobs: dataPipeline.getQueuedJobs(),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/pipeline/jobs', async (req: Request, res: Response) => {
  try {
    const { dataPipeline } = await import('../../lib/dataPipeline');
    const limit = parseInt(req.query.limit as string) || 20;
    res.json(dataPipeline.getRecentJobs(limit));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/pipeline/jobs', async (req: Request, res: Response) => {
  try {
    const { dataPipeline } = await import('../../lib/dataPipeline');
    const { type, symbol } = req.body;
    if (!type || !symbol) {
      return res.status(400).json({ error: 'type and symbol required' });
    }
    const job = dataPipeline.createJob(type, symbol);
    res.json(job);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/pipeline/sources/:symbol', async (req: Request, res: Response) => {
  try {
    const { dataPipeline } = await import('../../lib/dataPipeline');
    const symbol = req.params.symbol as string;
    const sources = await dataPipeline.checkDataSources(symbol);
    res.json(sources);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// QUESTDB INTEGRATION
// ============================================================

router.post('/questdb/:symbol/export-parquet', async (req: Request, res: Response) => {
  try {
    const symbol = getString(req.params.symbol).toUpperCase();
    const timeframe = req.body?.timeframe || '1m';

    const { exportQuestDBToParquet } = await import('../../questdb');
    console.log(`[routes] Exporting ${symbol} (${timeframe}) from QuestDB to Parquet...`);
    const result = await exportQuestDBToParquet(symbol, timeframe);

    res.json({ success: true, symbol, timeframe, path: result.path, rowCount: result.rowCount });
  } catch (error: any) {
    console.error('Error exporting QuestDB to parquet:', error);
    res.status(500).json({ error: error.message || 'Failed to export QuestDB data' });
  }
});

router.get('/questdb/symbols', async (_req: Request, res: Response) => {
  try {
    const { getSymbolsInQuestDB } = await import('../../questdb');
    const symbols = await getSymbolsInQuestDB();
    res.json({ symbols });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to get symbols' });
  }
});

router.get('/questdb/:symbol/stats', async (req: Request, res: Response) => {
  try {
    const symbol = getString(req.params.symbol).toUpperCase();
    const { getSymbolStats } = await import('../../questdb');
    const stats = await getSymbolStats(symbol);
    res.json(stats);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to get symbol stats' });
  }
});

router.get('/questdb/status', async (_req: Request, res: Response) => {
  try {
    const { getQuestDBStatus } = await import('../../lib/questdbIntegration');
    const { getQuestDBStatus: getProcessStatus } = await import('../../lib/questdbProcess');
    const [integrationStatus, processStatus] = await Promise.all([
      getQuestDBStatus(),
      Promise.resolve(getProcessStatus()),
    ]);
    res.json({ ...integrationStatus, process: processStatus });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/questdb/start', async (_req: Request, res: Response) => {
  try {
    const { startQuestDB } = await import('../../lib/questdbProcess');
    const result = await startQuestDB();
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/questdb/stop', async (_req: Request, res: Response) => {
  try {
    const { stopQuestDB } = await import('../../lib/questdbProcess');
    stopQuestDB();
    res.json({ stopped: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/questdb/init', async (_req: Request, res: Response) => {
  try {
    const { initializeQuestDB } = await import('../../lib/questdbIntegration');
    const result = await initializeQuestDB();
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/questdb/ohlcv/:symbol', queryRateLimiter, async (req: Request, res: Response) => {
  try {
    const symbol = getString(req.params.symbol).toUpperCase();
    const timeframe = getString(req.query.timeframe as string) || '1m';
    const startTime = req.query.startTime
      ? parseInt(getString(req.query.startTime as string))
      : undefined;
    const endTime = req.query.endTime
      ? parseInt(getString(req.query.endTime as string))
      : undefined;
    const limit = req.query.limit
      ? parseInt(getString(req.query.limit as string))
      : undefined;

    const { queryOHLCVFromQuestDB } = await import('../../lib/questdbIntegration');
    const result = await queryOHLCVFromQuestDB(
      symbol,
      timeframe,
      startTime || 0,
      endTime || Date.now(),
      limit,
    );

    if (!result.success) {
      return res.json({ data: [], source: 'none', questdbError: result.error });
    }

    res.json({ data: result.data, source: result.source });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// CACHE MANAGEMENT
// ============================================================

router.get('/cache/stats', (_req: Request, res: Response) => {
  res.json(ohlcvCache.getStats());
});

router.post('/cache/clear', (_req: Request, res: Response) => {
  ohlcvCache.clear();
  res.json({ message: 'Cache cleared' });
});

router.post('/cache/invalidate/:symbol', (req: Request, res: Response) => {
  const symbol = getString(req.params.symbol);
  const removed = ohlcvCache.invalidateSymbol(symbol);
  res.json({ symbol, entriesRemoved: removed });
});

export default router;
