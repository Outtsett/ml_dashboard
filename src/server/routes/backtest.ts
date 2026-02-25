/**
 * Backtest route — HTTP layer only.
 *
 * POST /api/backtest/run         — launch a backtest
 * GET  /api/backtest/runs        — list backtest runs
 * GET  /api/backtest/runs/:id    — get a single run with metrics
 * GET  /api/backtest/trades/:id  — get trades for a run (chart overlay)
 * GET  /api/brokers              — list broker configs
 * GET  /api/brokers/:id          — get broker config
 *
 * All orchestration logic lives in lib/backtest/backtestOrchestrator.ts.
 */
import { Router, Request, Response } from 'express';
import { storage } from '../storage';
import { getString } from './helpers';
import { runBacktestJob, BacktestError } from '../lib/backtest/backtestOrchestrator';

const router = Router();

// ── Broker Config Endpoints ─────────────────────────────────────────────────

router.get('/brokers', async (_req: Request, res: Response) => {
  try {
    const configs = await storage.getBrokerConfigs();
    res.json(configs);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/brokers/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid broker ID' });
    const config = await storage.getBrokerConfig(id);
    if (!config) return res.status(404).json({ error: 'Broker config not found' });
    res.json(config);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ── Backtest Run Endpoints ──────────────────────────────────────────────────

router.post('/backtest/run', async (req: Request, res: Response) => {
  try {
    if (!req.body.symbol) {
      return res.status(400).json({ error: 'symbol is required' });
    }

    const result = await runBacktestJob(req.body);
    res.json(result);
  } catch (error: any) {
    if (error instanceof BacktestError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error('[Backtest] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/backtest/runs', async (req: Request, res: Response) => {
  try {
    const symbol = getString(req.query.symbol as string) || undefined;
    const modelId = req.query.modelId ? parseInt(req.query.modelId as string) : undefined;
    const status = getString(req.query.status as string) || undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
    const runs = await storage.getBacktestRuns({ symbol, modelId, status, limit });
    res.json(runs);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/backtest/runs/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid run ID' });
    const run = await storage.getBacktestRun(id);
    if (!run) return res.status(404).json({ error: 'Backtest run not found' });
    res.json(run);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/backtest/trades/:runId', async (req: Request, res: Response) => {
  try {
    const runId = parseInt(req.params.runId as string);
    if (isNaN(runId)) return res.status(400).json({ error: 'Invalid run ID' });

    const limit = req.query.limit ? parseInt(req.query.limit as string) : 10000;
    const trades = await storage.getBacktestTrades(runId, limit);

    const chartMarkers = trades.flatMap((t: any) => {
      const markers: any[] = [];
      markers.push({
        timestamp: Number(t.entryTimestamp),
        type: 'entry',
        side: t.side,
        price: t.entryPrice,
        label: t.side === 'long' ? 'BUY' : 'SELL',
      });
      if (t.exitTimestamp) {
        markers.push({
          timestamp: Number(t.exitTimestamp),
          type: 'exit',
          side: t.side,
          price: t.exitPrice,
          label: `${t.exitReason?.toUpperCase()} ${(t.netPnl ?? 0) >= 0 ? '+' : ''}${(t.netPnl ?? 0).toFixed(2)}`,
          pnl: t.netPnl,
        });
      }
      return markers;
    });

    res.json({
      trades,
      chartMarkers,
      count: trades.length,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
