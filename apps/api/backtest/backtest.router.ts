/**
 * Backtest route — HTTP layer only.
 *
 * POST /api/backtest/run            — launch a backtest
 * POST /api/backtest/walk-forward   — run walk-forward analysis
 * POST /api/backtest/monte-carlo    — run Monte Carlo on a completed backtest
 * POST /api/backtest/benchmark      — compute benchmark comparison
 * GET  /api/backtest/runs           — list backtest runs
 * GET  /api/backtest/runs/:id       — get a single run with metrics
 * GET  /api/backtest/trades/:id     — get trades for a run (chart overlay)
 * GET  /api/brokers                 — list broker configs
 * GET  /api/brokers/:id             — get broker config
 *
 * All orchestration logic lives in lib/backtest/backtestOrchestrator.ts.
 */
import { Router, Request, Response } from 'express';
import { storage, getAssetType } from '../infrastructure/storage';
import { runBacktestJob, BacktestError } from '../infrastructure/lib/backtest/backtestOrchestrator';
import { runWalkForwardBacktest } from '../infrastructure/lib/backtest/walkForwardBacktest';
import { runMonteCarloAnalysis } from '../infrastructure/lib/backtest/monteCarloAnalysis';
import { computeBenchmark } from '../infrastructure/lib/backtest/benchmarkComparison';
import { type InstrumentSpec, type BacktestConfig, type Signal } from '../infrastructure/lib/backtest/tradeSimulator';
import { queryLake as marketQuery } from '../infrastructure/database/lake';
import { backtestEmitter, type BacktestProgress } from '../infrastructure/lib/backtest/backtestSSE';
import { isValidSymbol } from '@shared/validation';
import { getString } from '../infrastructure/lib/routeHelpers';

const router = Router();

// ── Broker Config Endpoints ─────────────────────────────────────────────────

router.get('/brokers', async (_req: Request, res: Response) => {
  try {
    const configs = await storage.getBrokerConfigs();
    res.json(configs);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/brokers/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid broker ID' });
    const config = await storage.getBrokerConfig(id);
    if (!config) return res.status(404).json({ error: 'Broker config not found' });
    res.json(config);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// ── Backtest Run Endpoints ──────────────────────────────────────────────────

router.post('/backtest/run', async (req: Request, res: Response) => {
  try {
    if (!req.body.symbol) {
      return res.status(400).json({ error: 'symbol is required' });
    }
    if (!isValidSymbol(req.body.symbol)) {
      return res.status(400).json({ error: 'Invalid symbol format' });
    }

    const result = await runBacktestJob(req.body);
    res.json(result);
  } catch (error) {
    if (error instanceof BacktestError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error('[Backtest] Error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/backtest/runs', async (req: Request, res: Response) => {
  try {
    const symbol = getString(req.query.symbol as string) || undefined;
    const modelId = req.query.modelId ? parseInt(req.query.modelId as string) : undefined;
    const status = getString(req.query.status as string) || undefined;
    const limit = Math.min(req.query.limit ? parseInt(req.query.limit as string) : 50, 10000);
    const runs = await storage.getBacktestRuns({ symbol, modelId, status, limit });
    res.json(runs);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/backtest/runs/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid run ID' });
    const run = await storage.getBacktestRun(id);
    if (!run) return res.status(404).json({ error: 'Backtest run not found' });
    res.json(run);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/backtest/trades/:runId', async (req: Request, res: Response) => {
  try {
    const runId = parseInt(req.params.runId as string);
    if (isNaN(runId)) return res.status(400).json({ error: 'Invalid run ID' });

    const limit = Math.min(req.query.limit ? parseInt(req.query.limit as string) : 10000, 10000);
    const trades = await storage.getBacktestTrades(runId, limit);

    interface ChartMarker {
      timestamp: number;
      type: 'entry' | 'exit';
      side: string;
      price: number | null;
      label: string;
      pnl?: number | null;
    }

    const chartMarkers = trades.flatMap((t): ChartMarker[] => {
      const markers: ChartMarker[] = [];
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
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// ── SSE Progress Streaming ──────────────────────────────────────────────────

router.get('/backtest/stream/:runId', (req: Request, res: Response) => {
  const runId = parseInt(req.params.runId as string);
  if (isNaN(runId)) {
    res.status(400).json({ error: 'Invalid run ID' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const handler = (progress: BacktestProgress) => {
    res.write(`data: ${JSON.stringify(progress)}\n\n`);
    if (progress.phase === 'persisting' && progress.progress >= 100) {
      res.end();
    }
  };

  backtestEmitter.on(`progress:${runId}`, handler);
  req.on('close', () => backtestEmitter.off(`progress:${runId}`, handler));
});

// ── Timeframe Helper ────────────────────────────────────────────────────────

const TIMEFRAME_TO_INTERVAL: Record<string, string> = {
  '1m': "INTERVAL '1 minute'",
  '5m': "INTERVAL '5 minutes'",
  '15m': "INTERVAL '15 minutes'",
  '30m': "INTERVAL '30 minutes'",
  '1H': "INTERVAL '1 hour'",
  '4H': "INTERVAL '4 hours'",
  '1D': "INTERVAL '1 day'",
  '1W': "INTERVAL '7 days'",
};

// ── Walk-Forward Endpoint ───────────────────────────────────────────────────

router.post('/backtest/walk-forward', async (req: Request, res: Response) => {
  try {
    const {
      symbol,
      brokerConfigId,
      timeframe = '1m',
      initialCapital = 10000,
      positionSize = 1,
      maxPositions = 1,
      stopLossTicks,
      takeProfitTicks,
      trailingStopTicks,
      maxDrawdownPct,
      minConfidence = 0.5,
      walkForwardConfig,
      start,
      end,
    } = req.body;

    if (!symbol) return res.status(400).json({ error: 'symbol is required' });
    if (!isValidSymbol(symbol)) return res.status(400).json({ error: 'Invalid symbol format' });
    if (!walkForwardConfig || !walkForwardConfig.trainMonths || !walkForwardConfig.testMonths) {
      return res.status(400).json({ error: 'walkForwardConfig with trainMonths and testMonths is required' });
    }

    // Resolve instrument
    const instrument = await storage.getInstrument(symbol);
    if (!instrument) return res.status(404).json({ error: `Instrument not found: ${symbol}` });

    const assetType = getAssetType(symbol);
    const instrumentSpec: InstrumentSpec = {
      symbol,
      assetType,
      tickSize: instrument.tickSize ?? 0.01,
      tickValue: instrument.tickValue ?? 1,
      pointValue: instrument.pointValue ?? 1,
      contractSize: instrument.contractSize ?? 1,
      pipSize: instrument.pipSize ?? undefined,
      marginRequirement: instrument.marginRequirement ?? undefined,
    };

    // Resolve broker config
    let brokerConfig;
    if (brokerConfigId) {
      brokerConfig = await storage.getBrokerConfig(brokerConfigId);
    } else {
      brokerConfig = await storage.getDefaultBrokerConfig(assetType);
    }
    if (!brokerConfig) return res.status(400).json({ error: `No broker config for: ${assetType}` });

    // Load OHLCV data
    const interval = TIMEFRAME_TO_INTERVAL[timeframe] || TIMEFRAME_TO_INTERVAL['1m'];
    // The column is `timestamp`, not `ts` — `ts` is only the output alias these
    // queries hand the backtester.
    let whereClause = `WHERE symbol = '${symbol}'`;
    if (start) whereClause += ` AND timestamp >= '${start}'`;
    if (end) whereClause += ` AND timestamp <= '${end}'`;

    // arg_min/arg_max, not FIRST/LAST: DuckDB's FIRST and LAST are
    // order-unspecified within a group, so a bucket spanning many rows can
    // return any of them and the bar's open would drift between runs without
    // ever raising. arg_min(open, timestamp) is "the open at the earliest
    // timestamp in this bucket", which is what a bar means.
    let ohlcvSql: string;
    if (timeframe === '1m') {
      ohlcvSql = `SELECT epoch_ms(timestamp)::DOUBLE AS ts, open, high, low, close, CAST(volume AS DOUBLE) AS volume FROM ohlcv ${whereClause} ORDER BY 1 ASC`;
    } else {
      ohlcvSql = `SELECT epoch_ms(time_bucket(${interval}, timestamp))::DOUBLE AS ts, arg_min(open, timestamp) AS open, MAX(high) AS high, MIN(low) AS low, arg_max(close, timestamp) AS close, CAST(SUM(volume) AS DOUBLE) AS volume FROM ohlcv ${whereClause} GROUP BY time_bucket(${interval}, timestamp) ORDER BY 1 ASC`;
    }

    const bars = await marketQuery<{ ts: number; open: number; high: number; low: number; close: number; volume: number }>(ohlcvSql);
    if (bars.length < 100) return res.status(400).json({ error: `Insufficient data: ${bars.length} bars` });

    // Generate momentum signals for all bars
    const signals: Signal[] = [];
    const lookback = 20;
    for (let i = lookback; i < bars.length; i++) {
      const returns = (bars[i]!.close - bars[i - lookback]!.close) / bars[i - lookback]!.close;
      const absReturn = Math.abs(returns);
      let prediction: number;
      if (returns > 0.001) prediction = 2;
      else if (returns < -0.001) prediction = 0;
      else prediction = 1;
      signals.push({
        timestamp: bars[i]!.ts,
        prediction,
        confidence: Math.min(0.5 + absReturn * 10, 0.99),
      });
    }

    const backtestConfig: BacktestConfig = {
      initialCapital, positionSize, maxPositions,
      stopLossTicks, takeProfitTicks, trailingStopTicks,
      maxDrawdownPct, minConfidence,
    };

    const result = runWalkForwardBacktest({
      bars, signals, instrument: instrumentSpec,
      broker: brokerConfig, config: backtestConfig,
      walkForwardConfig,
    });

    res.json(result);
  } catch (error) {
    console.error('[WalkForward] Error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// ── Monte Carlo Endpoint ────────────────────────────────────────────────────

router.post('/backtest/monte-carlo', async (req: Request, res: Response) => {
  try {
    const { backtestRunId, numSimulations = 1000, confidenceLevels, seed } = req.body;

    if (!backtestRunId) return res.status(400).json({ error: 'backtestRunId is required' });

    const runId = parseInt(backtestRunId);
    if (isNaN(runId)) return res.status(400).json({ error: 'Invalid backtestRunId' });

    // Load the backtest run to get initial capital
    const run = await storage.getBacktestRun(runId);
    if (!run) return res.status(404).json({ error: 'Backtest run not found' });

    // Load trades for this run
    const trades = await storage.getBacktestTrades(runId, 100000);
    if (trades.length === 0) return res.status(400).json({ error: 'No trades found for this run' });

    const result = runMonteCarloAnalysis(
      trades,
      run.initialCapital ?? 10000,
      {
        numSimulations,
        confidenceLevels: confidenceLevels ?? [0.05, 0.25, 0.50, 0.75, 0.95],
        seed,
      },
    );

    res.json(result);
  } catch (error) {
    console.error('[MonteCarlo] Error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// ── Benchmark Comparison Endpoint ───────────────────────────────────────────

router.post('/backtest/benchmark', async (req: Request, res: Response) => {
  try {
    const { backtestRunId } = req.body;

    if (!backtestRunId) return res.status(400).json({ error: 'backtestRunId is required' });

    const runId = parseInt(backtestRunId);
    if (isNaN(runId)) return res.status(400).json({ error: 'Invalid backtestRunId' });

    // Load the backtest run
    const run = await storage.getBacktestRun(runId);
    if (!run) return res.status(404).json({ error: 'Backtest run not found' });

    // Parse equity curve from the stored JSON
    let equityCurve: { timestamp: number; equity: number }[] = [];
    if (run.equityCurve) {
      try {
        equityCurve = JSON.parse(run.equityCurve as string);
      } catch {
        return res.status(400).json({ error: 'Invalid equity curve data' });
      }
    }
    if (equityCurve.length === 0) {
      return res.status(400).json({ error: 'No equity curve data for this run' });
    }

    // Load OHLCV bars for the test period
    const symbol = run.symbol;
    const testStart = run.testStartTimestamp;
    const testEnd = run.testEndTimestamp;

    let whereClause = `WHERE symbol = '${symbol}'`;
    if (testStart) whereClause += ` AND timestamp >= epoch_ms(${testStart})`;
    if (testEnd) whereClause += ` AND timestamp <= epoch_ms(${testEnd})`;

    const ohlcvSql = `SELECT epoch_ms(timestamp)::DOUBLE AS ts, open, high, low, close, CAST(volume AS DOUBLE) AS volume FROM ohlcv ${whereClause} ORDER BY 1 ASC`;
    const bars = await marketQuery<{ ts: number; open: number; high: number; low: number; close: number; volume: number }>(ohlcvSql);

    if (bars.length === 0) {
      return res.status(400).json({ error: 'No market data found for this run period' });
    }

    const result = computeBenchmark(bars, equityCurve, run.initialCapital ?? 10000);
    res.json(result);
  } catch (error) {
    console.error('[Benchmark] Error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

export default router;
