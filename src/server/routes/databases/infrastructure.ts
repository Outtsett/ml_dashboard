/**
 * Database Routes — OHLCV, Health, QuestDB, Cache
 *
 * Routes:
 *   GET  /api/ohlcv/:symbol
 *   GET  /api/health
 *   GET  /api/metrics
 *   GET  /api/rate-limits
 *   POST /api/circuit-breaker/reset/:name
 *   POST /api/circuit-breaker/reset-all
 *   GET  /api/questdb/symbols
 *   GET  /api/questdb/:symbol/stats
 *   GET  /api/questdb/status
 *   POST /api/questdb/start|stop|init|restart|maintenance
 *   GET  /api/questdb/ohlcv/:symbol
 *   GET  /api/cache/stats
 *   POST /api/cache/clear|invalidate/:symbol
 */

import { Router, Request, Response } from 'express';
import { queryRateLimiter } from '../../lib/rateLimiter';
import {
  ohlcvCache, clearAllCaches, getCacheStats,
  invalidateAnchorForSymbol, invalidatePreviewCacheForSymbol,
  clearParquetCacheForSymbol,
} from '../../cache';
import { getQueryCache } from '../../cache';
import { queryOHLCV } from '../../database/questdb/ohlcvQuery';
import { getString } from '../helpers';
import { CACHE_SEMI } from '../../cache/headers';

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

router.get('/health', CACHE_SEMI, async (_req: Request, res: Response) => {
  try {
    const { getNestApp } = await import('../../nest-context');
    const { HealthService } = await import('../../core/health/health.service');
    const healthService = getNestApp().get(HealthService);
    const result = await healthService.check();
    res.status(result.status === 'ok' ? 200 : 503).json(result);
  } catch (error: any) {
    // Fallback to old health checks if NestJS not ready
    const { runHealthChecks } = await import('../../database/health');
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
// QUESTDB INTEGRATION
// ============================================================

router.get('/questdb/symbols', async (_req: Request, res: Response) => {
  try {
    const { getSymbolsInQuestDB } = await import('../../database/questdb');
    const symbols = await getSymbolsInQuestDB();
    res.json({ symbols });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to get symbols' });
  }
});

router.get('/questdb/:symbol/stats', async (req: Request, res: Response) => {
  try {
    const symbol = getString(req.params.symbol).toUpperCase();
    const { getSymbolStats } = await import('../../database/questdb');
    const stats = await getSymbolStats(symbol);
    res.json(stats);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to get symbol stats' });
  }
});

router.get('/questdb/status', async (_req: Request, res: Response) => {
  try {
    const { getQuestDBIntegrationStatus } = await import('../../database/questdb/integration');
    const { getQuestDBProcessStatus } = await import('../../database/questdb/lifecycle');
    const [integrationStatus, processStatus] = await Promise.all([
      getQuestDBIntegrationStatus(),
      Promise.resolve(getQuestDBProcessStatus()),
    ]);
    res.json({ ...integrationStatus, process: processStatus });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/questdb/start', async (_req: Request, res: Response) => {
  try {
    const { startQuestDB } = await import('../../database/questdb/lifecycle');
    const result = await startQuestDB();
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/questdb/stop', async (_req: Request, res: Response) => {
  try {
    const { stopQuestDB } = await import('../../database/questdb/lifecycle');
    stopQuestDB();
    res.json({ stopped: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/questdb/init', async (_req: Request, res: Response) => {
  try {
    const { initializeQuestDB } = await import('../../database/questdb/integration');
    const result = await initializeQuestDB();
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Institutional Restart: Kills and restarts the QuestDB process
 * via the QuestDBAutomationService.
 */
router.post('/questdb/restart', async (_req: Request, res: Response) => {
  try {
    const { getNestApp } = await import('../../nest-context');
    const { QuestDBAutomationService } = await import('../../database/questdb/automation.service');
    const automation = getNestApp().get(QuestDBAutomationService);
    const result = await automation.restartQuestDB();
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Triggers manual database maintenance (view refresh).
 */
router.post('/questdb/maintenance', async (_req: Request, res: Response) => {
  try {
    const { getNestApp } = await import('../../nest-context');
    const { QuestDBAutomationService } = await import('../../database/questdb/automation.service');
    const automation = getNestApp().get(QuestDBAutomationService);
    await automation.runDailyMaintenance();
    res.json({ success: true, message: 'Maintenance tasks triggered' });
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

    const { queryOHLCVFromQuestDB } = await import('../../database/questdb/integration');
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
  res.json(getCacheStats());
});

router.post('/cache/clear', (_req: Request, res: Response) => {
  clearAllCaches();
  res.json({ message: 'All caches cleared (OHLCV, query, anchor, symbols, model, labels, parquet)' });
});

router.post('/cache/invalidate/:symbol', (req: Request, res: Response) => {
  const symbol = getString(req.params.symbol);
  const ohlcvRemoved = ohlcvCache.invalidateSymbol(symbol);
  invalidateAnchorForSymbol(symbol);
  invalidatePreviewCacheForSymbol(symbol);
  getQueryCache().invalidateBySymbol(symbol);
  const parquetRemoved = clearParquetCacheForSymbol(symbol);

  res.json({
    symbol,
    invalidated: ['ohlcv', 'query', 'anchor', 'labels', 'parquet'],
    ohlcvEntriesRemoved: ohlcvRemoved,
    parquetFilesRemoved: parquetRemoved,
  });
});

export default router;
