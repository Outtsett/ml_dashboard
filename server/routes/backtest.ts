/**
 * Backtest API routes
 *
 * POST /api/backtest/run         — launch a backtest
 * GET  /api/backtest/runs        — list backtest runs
 * GET  /api/backtest/runs/:id    — get a single run with metrics
 * GET  /api/backtest/trades/:id  — get trades for a run (chart overlay)
 * GET  /api/brokers              — list broker configs
 * GET  /api/brokers/:id          — get broker config
 */
import { Router, Request, Response } from 'express';
import { storage } from '../storage';
import { getAssetType } from '../storage';
import { marketQuery } from '../duckdb/market';
import { trainer } from '../ml/trainer';
import { runBacktest, type OHLCVBar, type Signal, type InstrumentSpec, type BacktestConfig } from '../lib/backtestEngine';
import { getString } from './helpers';

const router = Router();

// ============================================================
// BROKER CONFIG ENDPOINTS
// ============================================================

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

// ============================================================
// BACKTEST RUN ENDPOINTS
// ============================================================

/**
 * POST /api/backtest/run
 *
 * Body:
 * {
 *   symbol: string,
 *   modelId?: number,          // use saved model, or...
 *   useLastTrained?: boolean,  // use the last in-memory trained model for this symbol
 *   brokerConfigId?: number,   // specific broker, or auto-detect from asset type
 *   timeframe?: string,        // '1m', '5m', '1H', '1D', etc.
 *   splitRatio?: number,       // 0.0-1.0, train portion
 *   initialCapital?: number,
 *   positionSize?: number,
 *   stopLossTicks?: number,
 *   takeProfitTicks?: number,
 *   trailingStopTicks?: number,
 *   maxDrawdownPct?: number,
 *   minConfidence?: number,
 *   start?: string,            // ISO date for data range
 *   end?: string,
 * }
 */
router.post('/backtest/run', async (req: Request, res: Response) => {
  try {
    const {
      symbol,
      modelId,
      useLastTrained,
      brokerConfigId,
      timeframe = '1m',
      splitRatio = 0.8,
      initialCapital = 10000,
      positionSize = 1,
      maxPositions = 1,
      stopLossTicks,
      takeProfitTicks,
      trailingStopTicks,
      maxDrawdownPct,
      minConfidence = 0.5,
      start,
      end,
    } = req.body;

    if (!symbol) {
      return res.status(400).json({ error: 'symbol is required' });
    }

    // 1. Resolve instrument
    const instrument = await storage.getInstrument(symbol);
    if (!instrument) {
      return res.status(404).json({ error: `Instrument not found: ${symbol}` });
    }

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

    // 2. Resolve broker config
    let brokerConfig;
    if (brokerConfigId) {
      brokerConfig = await storage.getBrokerConfig(brokerConfigId);
    } else {
      brokerConfig = await storage.getDefaultBrokerConfig(assetType);
    }
    if (!brokerConfig) {
      return res.status(400).json({ error: `No broker config found for asset type: ${assetType}` });
    }

    // 3. Load OHLCV data from DuckDB
    const timeframeMap: Record<string, string> = {
      '1m': "INTERVAL '1 minute'",
      '5m': "INTERVAL '5 minutes'",
      '15m': "INTERVAL '15 minutes'",
      '30m': "INTERVAL '30 minutes'",
      '1H': "INTERVAL '1 hour'",
      '4H': "INTERVAL '4 hours'",
      '1D': "INTERVAL '1 day'",
      '1W': "INTERVAL '7 days'",
    };

    const interval = timeframeMap[timeframe] || timeframeMap['1m'];
    let whereClause = `WHERE symbol = '${symbol}'`;
    if (start) whereClause += ` AND ts >= '${start}'`;
    if (end) whereClause += ` AND ts <= '${end}'`;

    let ohlcvSql: string;
    if (timeframe === '1m') {
      // No aggregation needed for 1m
      ohlcvSql = `
        SELECT epoch_ms(ts)::DOUBLE AS ts, open, high, low, close, CAST(volume AS DOUBLE) AS volume
        FROM ohlcv ${whereClause}
        ORDER BY ts ASC
      `;
    } else {
      ohlcvSql = `
        SELECT
          epoch_ms(time_bucket(${interval}, ts))::DOUBLE AS ts,
          FIRST(open) AS open,
          MAX(high) AS high,
          MIN(low) AS low,
          LAST(close) AS close,
          CAST(SUM(volume) AS DOUBLE) AS volume
        FROM ohlcv ${whereClause}
        GROUP BY time_bucket(${interval}, ts)
        ORDER BY 1 ASC
      `;
    }

    const ohlcvData = await marketQuery<{ ts: number; open: number; high: number; low: number; close: number; volume: number }>(ohlcvSql);

    if (ohlcvData.length < 100) {
      return res.status(400).json({ error: `Insufficient data: only ${ohlcvData.length} bars found. Need at least 100.` });
    }

    // 4. Split into train/test
    const splitIdx = Math.floor(ohlcvData.length * splitRatio);
    const trainBars = ohlcvData.slice(0, splitIdx);
    const testBars = ohlcvData.slice(splitIdx);

    // 5. Generate signals (from trained model or synthetic)
    let signals: Signal[] = [];
    let resolvedModelId: number | undefined = modelId;

    // Check if we have a trained in-memory model
    const lastSession = trainer.getLastTrainedModel(symbol);
    if (useLastTrained && lastSession?.model) {
      console.log(`[Backtest] Using last trained model for ${symbol}`);
      // Generate predictions on test data using sliding window
      const windowSize = lastSession.dataConfig.sequenceLength;
      for (let i = windowSize; i < testBars.length; i++) {
        const window = testBars.slice(i - windowSize, i).map(b => [b.open, b.high, b.low, b.close, b.volume]);
        try {
          const preds = await trainer.predict(symbol, window);
          if (preds.length > 0) {
            signals.push({
              timestamp: testBars[i].ts,
              prediction: preds[0].prediction,
              confidence: Math.max(...preds[0].probabilities),
              probabilities: preds[0].probabilities,
            });
          }
        } catch {
          // Skip bars where prediction fails
        }
      }
      resolvedModelId = lastSession.savedModelId;
    } else {
      // Generate synthetic direction signals from simple momentum
      // This allows testing the backtest engine even without ML models
      console.log(`[Backtest] No trained model — using momentum-based signals for ${symbol}`);
      const lookback = 20;
      for (let i = lookback; i < testBars.length; i++) {
        const returns = (testBars[i].close - testBars[i - lookback].close) / testBars[i - lookback].close;
        const absReturn = Math.abs(returns);
        let prediction: number;
        if (returns > 0.001) prediction = 2; // up/long
        else if (returns < -0.001) prediction = 0; // down/short
        else prediction = 1; // neutral

        signals.push({
          timestamp: testBars[i].ts,
          prediction,
          confidence: Math.min(0.5 + absReturn * 10, 0.99),
        });
      }
    }

    if (signals.length === 0) {
      return res.status(400).json({ error: 'No signals generated. Check model or data.' });
    }

    // 6. Create backtest run record
    const backtestName = resolvedModelId
      ? `Backtest ${symbol} Model#${resolvedModelId}`
      : `Backtest ${symbol} Momentum`;

    const run = await storage.createBacktestRun({
      name: backtestName,
      modelId: resolvedModelId,
      symbol,
      brokerConfigId: brokerConfig.id,
      timeframe,
      trainStartTimestamp: trainBars.length > 0 ? trainBars[0].ts : null,
      trainEndTimestamp: trainBars.length > 0 ? trainBars[trainBars.length - 1].ts : null,
      testStartTimestamp: testBars.length > 0 ? testBars[0].ts : null,
      testEndTimestamp: testBars.length > 0 ? testBars[testBars.length - 1].ts : null,
      splitRatio,
      initialCapital,
      positionSize,
      maxPositions,
      stopLossTicks,
      takeProfitTicks,
      trailingStopTicks,
      maxDrawdownPct,
    });

    // 7. Update status to running
    await storage.updateBacktestRun(run.id, { status: 'running', startedAt: new Date() });

    // 8. Run backtest engine
    const backtestConfig: BacktestConfig = {
      initialCapital,
      positionSize,
      maxPositions,
      stopLossTicks,
      takeProfitTicks,
      trailingStopTicks,
      maxDrawdownPct,
      minConfidence,
    };

    const result = runBacktest(testBars, signals, instrumentSpec, brokerConfig, backtestConfig);

    // 9. Persist trades
    const tradeRecords = result.trades.map(t => ({
      backtestRunId: run.id,
      symbol: t.symbol,
      side: t.side,
      entryTimestamp: t.entryTimestamp,
      exitTimestamp: t.exitTimestamp,
      entryPrice: t.entryPrice,
      exitPrice: t.exitPrice,
      quantity: t.quantity,
      pnl: t.pnl,
      netPnl: t.netPnl,
      commission: t.commission,
      slippage: t.slippage,
      spreadCost: t.spreadCost,
      entrySignal: t.entrySignal,
      exitReason: t.exitReason,
      barsHeld: t.barsHeld,
      maxFavorableExcursion: t.maxFavorableExcursion,
      maxAdverseExcursion: t.maxAdverseExcursion,
      runningPnl: t.runningPnl,
    }));

    await storage.insertBacktestTrades(tradeRecords);

    // 10. Sample equity curve (max 2000 points for JSON storage)
    const maxCurvePoints = 2000;
    let sampledCurve = result.equityCurve;
    if (sampledCurve.length > maxCurvePoints) {
      const step = Math.ceil(sampledCurve.length / maxCurvePoints);
      sampledCurve = sampledCurve.filter((_, i) => i % step === 0 || i === sampledCurve.length - 1);
    }

    // 11. Update run with results
    await storage.updateBacktestRun(run.id, {
      status: 'completed',
      completedAt: new Date(),
      totalTrades: result.metrics.totalTrades,
      winRate: result.metrics.winRate,
      profitFactor: result.metrics.profitFactor,
      sharpeRatio: result.metrics.sharpeRatio,
      sortinoRatio: result.metrics.sortinoRatio,
      maxDrawdown: result.metrics.maxDrawdown,
      totalReturn: result.metrics.totalReturn,
      totalReturnPct: result.metrics.totalReturnPct,
      avgWin: result.metrics.avgWin,
      avgLoss: result.metrics.avgLoss,
      largestWin: result.metrics.largestWin,
      largestLoss: result.metrics.largestLoss,
      avgHoldingTimeMs: result.metrics.avgHoldingTimeMs,
      expectancy: result.metrics.expectancy,
      totalCommissions: result.metrics.totalCommissions,
      totalSlippage: result.metrics.totalSlippage,
      equityCurve: JSON.stringify(sampledCurve),
    });

    // 12. Return result
    const updatedRun = await storage.getBacktestRun(run.id);
    res.json({
      run: updatedRun,
      metrics: result.metrics,
      tradeCount: result.trades.length,
      equityCurvePoints: sampledCurve.length,
      dataSummary: {
        totalBars: ohlcvData.length,
        trainBars: trainBars.length,
        testBars: testBars.length,
        signalCount: signals.length,
      },
    });
  } catch (error: any) {
    console.error('[Backtest] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/backtest/runs
 */
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

/**
 * GET /api/backtest/runs/:id
 */
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

/**
 * GET /api/backtest/trades/:runId
 * Returns trades formatted for chart overlay
 */
router.get('/backtest/trades/:runId', async (req: Request, res: Response) => {
  try {
    const runId = parseInt(req.params.runId as string);
    if (isNaN(runId)) return res.status(400).json({ error: 'Invalid run ID' });

    const limit = req.query.limit ? parseInt(req.query.limit as string) : 10000;
    const trades = await storage.getBacktestTrades(runId, limit);

    // Also format for chart markers
    const chartMarkers = trades.flatMap((t: any) => {
      const markers: any[] = [];
      markers.push({
        timestamp: Number(t.entry_timestamp),
        type: 'entry',
        side: t.side,
        price: t.entry_price,
        label: t.side === 'long' ? 'BUY' : 'SELL',
      });
      if (t.exit_timestamp) {
        markers.push({
          timestamp: Number(t.exit_timestamp),
          type: 'exit',
          side: t.side,
          price: t.exit_price,
          label: `${t.exit_reason?.toUpperCase()} ${(t.net_pnl ?? 0) >= 0 ? '+' : ''}${(t.net_pnl ?? 0).toFixed(2)}`,
          pnl: t.net_pnl,
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
