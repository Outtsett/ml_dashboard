/**
 * Database Routes — OHLCV, Health, lake, Cache
 *
 * Routes:
 *   GET  /api/ohlcv/:symbol
 *   GET  /api/health
 *   GET  /api/metrics
 *   GET  /api/rate-limits
 *   POST /api/circuit-breaker/reset/:name
 *   POST /api/circuit-breaker/reset-all
 *   GET  /api/lake/symbols
 *   GET  /api/lake/:symbol/stats
 *   GET  /api/lake/status
 *   POST /api/lake/start|stop|init|restart|maintenance
 *   GET  /api/lake/ohlcv/:symbol
 *   GET  /api/cache/stats
 *   POST /api/cache/clear|invalidate/:symbol
 */

import { Router, Request, Response } from 'express';
import { queryRateLimiter } from '../infrastructure/lib/rateLimiter';
import {
  ohlcvCache, clearAllCaches, getCacheStats,
  invalidateAnchorForSymbol, invalidatePreviewCacheForSymbol,
  clearParquetCacheForSymbol,
} from '../infrastructure/cache';
import { getQueryCache } from '../infrastructure/cache';
import { queryOHLCV } from '../infrastructure/database/lake/ohlcvQuery';
import { getString } from '../infrastructure/lib/routeHelpers';
import { CACHE_SEMI } from '../infrastructure/cache/headers';

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
    const { getNestApp } = await import('../infrastructure/lib/nest-context');
    const { HealthService } = await import('../infrastructure/core/health/health.service');
    const healthService = getNestApp().get(HealthService);
    const result = await healthService.check();
    res.status(result.status === 'ok' ? 200 : 503).json(result);
  } catch {
    // Fallback to old health checks if NestJS not ready
    const { runHealthChecks } = await import('../infrastructure/database/health');
    const health = await runHealthChecks();
    res.json(health);
  }
});

router.get('/metrics', async (_req: Request, res: Response) => {
  try {
    const { pipelineMetrics } = await import('../infrastructure/lib/metrics');
    const { getAllCircuitBreakerStats } = await import('../infrastructure/lib/circuitBreaker');
    res.json({
      pipeline: pipelineMetrics.getSnapshot(),
      circuitBreakers: getAllCircuitBreakerStats(),
      timestamp: Date.now(),
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/rate-limits', async (_req: Request, res: Response) => {
  try {
    const { getRateLimitStats } = await import('../infrastructure/lib/rateLimiter');
    res.json(getRateLimitStats());
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post('/circuit-breaker/reset/:name', async (req: Request, res: Response) => {
  try {
    const name = getString(req.params.name);
    const { resetCircuitBreaker } = await import('../infrastructure/lib/circuitBreaker');
    const success = resetCircuitBreaker(name);
    res.json({ success, name });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post('/circuit-breaker/reset-all', async (_req: Request, res: Response) => {
  try {
    const { resetAllCircuitBreakers } = await import('../infrastructure/lib/circuitBreaker');
    const reset = resetAllCircuitBreakers();
    res.json({ success: true, reset });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// ============================================================
// lake INTEGRATION
// ============================================================

router.get('/lake/symbols', async (_req: Request, res: Response) => {
  try {
    const { getSymbolsInlake } = await import('../infrastructure/database/lake');
    const symbols = await getSymbolsInlake();
    res.json({ symbols });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message || 'Failed to get symbols' });
  }
});

router.get('/lake/:symbol/stats', async (req: Request, res: Response) => {
  try {
    const symbol = getString(req.params.symbol).toUpperCase();
    const { getSymbolStats } = await import('../infrastructure/database/lake');
    const stats = await getSymbolStats(symbol);
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message || 'Failed to get symbol stats' });
  }
});

router.get('/lake/status', async (_req: Request, res: Response) => {
  try {
    const { getLakeIntegrationStatus } = await import('../infrastructure/database/lake/integration');
    const { getLakeProcessStatus } = await import('../infrastructure/database/lake/lifecycle');
    const [integrationStatus, processStatus] = await Promise.all([
      getLakeIntegrationStatus(),
      getLakeProcessStatus(),
    ]);
    res.json({ ...integrationStatus, process: processStatus });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post('/lake/start', async (_req: Request, res: Response) => {
  try {
    const { startLake } = await import('../infrastructure/database/lake/lifecycle');
    const result = await startLake();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post('/lake/stop', async (_req: Request, res: Response) => {
  try {
    const { stopLake } = await import('../infrastructure/database/lake/lifecycle');
    stopLake();
    res.json({ stopped: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post('/lake/init', async (_req: Request, res: Response) => {
  try {
    const { initializeLake } = await import('../infrastructure/database/lake/integration');
    const result = await initializeLake();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * Institutional Restart: Kills and restarts the lake process
 * via the LakeAutomationService.
 */
router.post('/lake/restart', async (_req: Request, res: Response) => {
  try {
    const { getNestApp } = await import('../infrastructure/lib/nest-context');
    const { LakeAutomationService } = await import('../infrastructure/database/lake/automation.service');
    const automation = getNestApp().get(LakeAutomationService);
    const result = await automation.restartLake();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * Triggers manual database maintenance (view refresh).
 */
router.post('/lake/maintenance', async (_req: Request, res: Response) => {
  try {
    const { getNestApp } = await import('../infrastructure/lib/nest-context');
    const { LakeAutomationService } = await import('../infrastructure/database/lake/automation.service');
    const automation = getNestApp().get(LakeAutomationService);
    await automation.runDailyMaintenance();
    res.json({ success: true, message: 'Maintenance tasks triggered' });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/lake/ohlcv/:symbol', queryRateLimiter, async (req: Request, res: Response) => {
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

    const { queryOHLCVFromLake } = await import('../infrastructure/database/lake/integration');
    const result = await queryOHLCVFromLake(
      symbol,
      timeframe,
      startTime || 0,
      endTime || Date.now(),
      limit,
    );

    if (!result.success) {
      return res.json({ data: [], source: 'none', lakeError: result.error });
    }

    res.json({ data: result.data, source: result.source });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
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

// ============================================================
// PGADMIN 4 SUPERVISOR (ZERO-LOGIN DESKTOP INTEGRATION)
// ============================================================

type PgAdminSupervisor = typeof import('../infrastructure/database/pgadmin.supervisor');

/** The supervisor's functions, whether the loader returns them as named exports or under `default`. */
async function loadPgAdminSupervisor(): Promise<PgAdminSupervisor> {
  const loaded = (await import('../infrastructure/database/pgadmin.supervisor')) as PgAdminSupervisor & { default?: PgAdminSupervisor };
  return typeof loaded.getPgAdminStatus === 'function' ? loaded : (loaded.default ?? loaded);
}

const handlePgAdminStatus = async (_req: Request, res: Response) => {
  try {
    const mod = await loadPgAdminSupervisor();
    const getStatus = mod.getPgAdminStatus;
    const status = await getStatus();
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};

const handlePgAdminStart = async (_req: Request, res: Response) => {
  try {
    const mod = await loadPgAdminSupervisor();
    const start = mod.startPgAdminSupervisor;
    const getStatus = mod.getPgAdminStatus;
    await start();
    const status = await getStatus();
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};

const handlePgAdminRestart = async (_req: Request, res: Response) => {
  try {
    const mod = await loadPgAdminSupervisor();
    const restart = mod.restartPgAdmin;
    const getStatus = mod.getPgAdminStatus;
    await restart();
    const status = await getStatus();
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};


router.get('/pgadmin/status', handlePgAdminStatus);
router.get('/database/pgadmin/status', handlePgAdminStatus);

router.post('/pgadmin/start', handlePgAdminStart);
router.post('/database/pgadmin/start', handlePgAdminStart);

router.post('/pgadmin/restart', handlePgAdminRestart);
router.post('/database/pgadmin/restart', handlePgAdminRestart);

export default router;


