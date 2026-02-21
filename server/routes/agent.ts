/**
 * Trading Agent API Routes
 *
 * Exposes the full inference → signal → strategy → backtest pipeline.
 *
 * Routes:
 *   POST /api/agent/predict         — single prediction (latest bar)
 *   POST /api/agent/predict/batch   — batch predictions over time range
 *   POST /api/agent/signals         — generate signals from batch predictions
 *   POST /api/agent/walk-forward    — run walk-forward validation
 *   POST /api/agent/walk-forward/stop — stop walk-forward
 *   GET  /api/agent/walk-forward/stream — SSE for walk-forward progress
 *   GET  /api/agent/models          — list available models for inference
 *   POST /api/agent/models/unload   — unload a cached model
 *   POST /api/agent/full-pipeline   — run the full loop: predict → signal → backtest
 *   GET  /api/agent/strategy/config — get current strategy config
 *   PUT  /api/agent/strategy/config — update strategy config
 */

import { Router, Request, Response } from 'express';
import { mlRateLimiter } from '../lib/rateLimiter';
import { getString } from './helpers';
import {
  predictLatest,
  predictBatch,
  listAvailableModels,
  unloadModel,
  unloadAllModels,
  type InferenceConfig,
  type BatchInferenceConfig,
} from '../ml/inferenceService';
import {
  SignalGenerator,
  signalGenerator,
  DEFAULT_SIGNAL_CONFIG,
  type SignalGeneratorConfig,
} from '../ml/signalGenerator';
import {
  StrategyEngine,
  strategyEngine,
  DEFAULT_STRATEGY_CONFIG,
  type StrategyConfig,
} from '../ml/strategyEngine';
import {
  walkForwardValidator,
  type WalkForwardConfig,
} from '../ml/walkForward';
import { marketQuery } from '../duckdb/market';
import { storage, getAssetType } from '../storage';
import {
  runBacktest,
  type OHLCVBar,
  type Signal,
  type InstrumentSpec,
  type BacktestConfig,
} from '../lib/backtestEngine';

const router = Router();

// ============================================================
// INFERENCE ENDPOINTS
// ============================================================

/**
 * POST /api/agent/predict
 * Single prediction on the latest available data.
 *
 * Body: { modelName: string, symbol: string, timeframeSec?: number, includeFeatures?: boolean }
 */
router.post('/agent/predict', mlRateLimiter, async (req: Request, res: Response) => {
  try {
    const { modelName, symbol, timeframeSec, includeFeatures } = req.body;

    if (!modelName || !symbol) {
      return res.status(400).json({ error: 'modelName and symbol are required' });
    }

    const config: InferenceConfig = {
      modelName,
      symbol: symbol.toUpperCase(),
      timeframeSec,
      includeFeatures: includeFeatures ?? true,
    };

    const prediction = await predictLatest(config);
    res.json(prediction);
  } catch (error: any) {
    console.error('[Agent] Prediction error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/agent/predict/batch
 * Batch predictions over a time range for backtesting or analysis.
 *
 * Body: { modelName, symbol, startTimestamp?, endTimestamp?, maxBars?, stepSize?, includeFeatures? }
 */
router.post('/agent/predict/batch', mlRateLimiter, async (req: Request, res: Response) => {
  try {
    const {
      modelName,
      symbol,
      timeframeSec,
      startTimestamp,
      endTimestamp,
      maxBars,
      stepSize,
      includeFeatures,
    } = req.body;

    if (!modelName || !symbol) {
      return res.status(400).json({ error: 'modelName and symbol are required' });
    }

    const config: BatchInferenceConfig = {
      modelName,
      symbol: symbol.toUpperCase(),
      timeframeSec,
      startTimestamp,
      endTimestamp,
      maxBars: maxBars || 20000,
      stepSize: stepSize || 1,
      includeFeatures: includeFeatures ?? false,
    };

    const result = await predictBatch(config);
    res.json(result);
  } catch (error: any) {
    console.error('[Agent] Batch prediction error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// SIGNAL GENERATION ENDPOINTS
// ============================================================

/**
 * POST /api/agent/signals
 * Generate trade signals from batch predictions.
 *
 * Body: {
 *   modelName, symbol, timeframeSec?, maxBars?,
 *   signalConfig?: Partial<SignalGeneratorConfig>,
 *   startTimestamp?, endTimestamp?,
 * }
 */
router.post('/agent/signals', mlRateLimiter, async (req: Request, res: Response) => {
  try {
    const {
      modelName,
      symbol,
      timeframeSec,
      maxBars,
      signalConfig,
      startTimestamp,
      endTimestamp,
    } = req.body;

    if (!modelName || !symbol) {
      return res.status(400).json({ error: 'modelName and symbol are required' });
    }

    // 1. Get batch predictions
    const batchResult = await predictBatch({
      modelName,
      symbol: symbol.toUpperCase(),
      timeframeSec,
      startTimestamp,
      endTimestamp,
      maxBars: maxBars || 20000,
      includeFeatures: true, // Need features for regime detection
    });

    // 2. Generate signals
    const sg = new SignalGenerator(signalConfig);
    const signals = sg.processBatch(batchResult.predictions);
    const stats = sg.getStats(signals);

    res.json({
      signals: signals.filter(s => s.direction !== 'no_signal'), // Only actionable signals
      allSignals: signals.length,
      stats,
      modelName,
      symbol: symbol.toUpperCase(),
      timeRange: batchResult.timeRange,
      barsProcessed: batchResult.barsProcessed,
    });
  } catch (error: any) {
    console.error('[Agent] Signal generation error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// FULL PIPELINE: PREDICT → SIGNAL → BACKTEST
// ============================================================

/**
 * POST /api/agent/full-pipeline
 * Run the complete trading agent loop:
 * 1. Load saved model
 * 2. Generate predictions over time range
 * 3. Apply signal filters
 * 4. Run backtest with cost model
 * 5. Return results + metrics
 *
 * Body: {
 *   modelName: string,
 *   symbol: string,
 *   timeframeSec?: number,
 *   splitRatio?: number,
 *   signalConfig?: Partial<SignalGeneratorConfig>,
 *   strategyConfig?: Partial<StrategyConfig>,
 *   backtestConfig?: Partial<BacktestConfig>,
 *   brokerConfigId?: number,
 *   start?: string,
 *   end?: string,
 * }
 */
router.post('/agent/full-pipeline', mlRateLimiter, async (req: Request, res: Response) => {
  try {
    const {
      modelName,
      symbol,
      timeframeSec = 300,
      splitRatio = 0.8,
      signalConfig,
      strategyConfig: stratConfig,
      backtestConfig: btConfig,
      brokerConfigId,
      start,
      end,
    } = req.body;

    if (!modelName || !symbol) {
      return res.status(400).json({ error: 'modelName and symbol are required' });
    }

    const upperSymbol = symbol.toUpperCase();
    const startTime = Date.now();

    console.log(`[Agent] Full pipeline: ${modelName} on ${upperSymbol}`);

    // 1. Resolve instrument
    const instrument = await storage.getInstrument(upperSymbol);
    if (!instrument) {
      return res.status(404).json({ error: `Instrument not found: ${upperSymbol}` });
    }

    const assetType = getAssetType(upperSymbol);
    const instrumentSpec: InstrumentSpec = {
      symbol: upperSymbol,
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
      return res.status(400).json({ error: `No broker config for asset type: ${assetType}` });
    }

    // 3. Load OHLCV data from DuckDB
    const interval = `${timeframeSec} seconds`;
    let whereClause = `WHERE symbol = '${upperSymbol}'`;
    if (start) whereClause += ` AND ts >= '${start}'`;
    if (end) whereClause += ` AND ts <= '${end}'`;

    const ohlcvSql = timeframeSec === 60
      ? `SELECT epoch_ms(ts)::DOUBLE AS ts, open, high, low, close, CAST(volume AS DOUBLE) AS volume
         FROM ohlcv ${whereClause} ORDER BY ts ASC`
      : `SELECT epoch_ms(time_bucket(INTERVAL '${interval}', ts))::DOUBLE AS ts,
           FIRST(open) AS open, MAX(high) AS high, MIN(low) AS low, LAST(close) AS close,
           CAST(SUM(volume) AS DOUBLE) AS volume
         FROM ohlcv ${whereClause}
         GROUP BY time_bucket(INTERVAL '${interval}', ts) ORDER BY 1 ASC`;

    const ohlcvData = await marketQuery<OHLCVBar>(ohlcvSql);

    if (ohlcvData.length < 200) {
      return res.status(400).json({ error: `Insufficient data: ${ohlcvData.length} bars (need 200+)` });
    }

    // 4. Split into train/test
    const splitIdx = Math.floor(ohlcvData.length * splitRatio);
    const testBars = ohlcvData.slice(splitIdx);

    // 5. Generate batch predictions on test data
    const testStartTs = testBars[0].ts;
    const testEndTs = testBars[testBars.length - 1].ts;

    const batchResult = await predictBatch({
      modelName,
      symbol: upperSymbol,
      timeframeSec,
      startTimestamp: testStartTs,
      endTimestamp: testEndTs,
      maxBars: testBars.length + 200,
      includeFeatures: true,
    });

    // 6. Generate signals with filters
    const sg = new SignalGenerator(signalConfig);
    const tradeSignals = sg.processBatch(batchResult.predictions);
    const signalStats = sg.getStats(tradeSignals);

    // 7. Convert signals to backtest format
    const backtestSignals = sg.toBacktestSignals(tradeSignals);

    // 8. Run backtest
    const backtestCfg: BacktestConfig = {
      initialCapital: btConfig?.initialCapital || 100000,
      positionSize: btConfig?.positionSize || 1,
      maxPositions: btConfig?.maxPositions || 1,
      stopLossTicks: btConfig?.stopLossTicks,
      takeProfitTicks: btConfig?.takeProfitTicks,
      trailingStopTicks: btConfig?.trailingStopTicks,
      maxDrawdownPct: btConfig?.maxDrawdownPct,
      minConfidence: btConfig?.minConfidence || 0.3,
    };

    const backtestResult = runBacktest(testBars, backtestSignals, instrumentSpec, brokerConfig, backtestCfg);

    // 9. Save backtest run to database
    const runName = `Agent-${modelName}-${upperSymbol}`;
    let savedRun: any;
    try {
      savedRun = await storage.createBacktestRun({
        name: runName,
        symbol: upperSymbol,
        brokerConfigId: brokerConfig.id,
        timeframe: `${timeframeSec}s`,
        trainStartTimestamp: ohlcvData[0].ts,
        trainEndTimestamp: ohlcvData[splitIdx].ts,
        testStartTimestamp: testStartTs,
        testEndTimestamp: testEndTs,
        splitRatio,
        initialCapital: backtestCfg.initialCapital,
        positionSize: backtestCfg.positionSize,
        maxPositions: backtestCfg.maxPositions,
        stopLossTicks: backtestCfg.stopLossTicks,
        takeProfitTicks: backtestCfg.takeProfitTicks,
        trailingStopTicks: backtestCfg.trailingStopTicks,
        maxDrawdownPct: backtestCfg.maxDrawdownPct,
      });

      // Save metrics
      const maxCurvePoints = 2000;
      let sampledCurve = backtestResult.equityCurve;
      if (sampledCurve.length > maxCurvePoints) {
        const step = Math.ceil(sampledCurve.length / maxCurvePoints);
        sampledCurve = sampledCurve.filter((_, i) => i % step === 0 || i === sampledCurve.length - 1);
      }

      await storage.updateBacktestRun(savedRun.id, {
        status: 'completed',
        completedAt: new Date(),
        totalTrades: backtestResult.metrics.totalTrades,
        winRate: backtestResult.metrics.winRate,
        profitFactor: backtestResult.metrics.profitFactor,
        sharpeRatio: backtestResult.metrics.sharpeRatio,
        sortinoRatio: backtestResult.metrics.sortinoRatio,
        maxDrawdown: backtestResult.metrics.maxDrawdown,
        totalReturn: backtestResult.metrics.totalReturn,
        totalReturnPct: backtestResult.metrics.totalReturnPct,
        avgWin: backtestResult.metrics.avgWin,
        avgLoss: backtestResult.metrics.avgLoss,
        largestWin: backtestResult.metrics.largestWin,
        largestLoss: backtestResult.metrics.largestLoss,
        avgHoldingTimeMs: backtestResult.metrics.avgHoldingTimeMs,
        expectancy: backtestResult.metrics.expectancy,
        totalCommissions: backtestResult.metrics.totalCommissions,
        totalSlippage: backtestResult.metrics.totalSlippage,
        equityCurve: JSON.stringify(sampledCurve),
      });

      // Save trades
      const tradeRecords = backtestResult.trades.map(t => ({
        backtestRunId: savedRun.id,
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
    } catch (dbErr: any) {
      console.error('[Agent] Error saving backtest results:', dbErr.message);
    }

    const totalTimeMs = Date.now() - startTime;
    console.log(`[Agent] Full pipeline complete: ${backtestResult.metrics.totalTrades} trades, ` +
      `return ${backtestResult.metrics.totalReturnPct.toFixed(2)}%, ${(totalTimeMs / 1000).toFixed(1)}s`);

    // 10. Return everything
    res.json({
      run: savedRun,
      metrics: backtestResult.metrics,
      signalStats,
      predictions: {
        total: batchResult.predictions.length,
        timeRange: batchResult.timeRange,
        computeTimeMs: batchResult.computeTimeMs,
      },
      trades: backtestResult.trades.length,
      equityCurve: backtestResult.equityCurve.slice(-500), // Last 500 points for chart
      dataSummary: {
        totalBars: ohlcvData.length,
        trainBars: splitIdx,
        testBars: testBars.length,
        signalCount: backtestSignals.length,
        actionableSignals: signalStats.longs + signalStats.shorts,
      },
      pipelineTimeMs: totalTimeMs,
    });
  } catch (error: any) {
    console.error('[Agent] Full pipeline error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// WALK-FORWARD VALIDATION
// ============================================================

/**
 * POST /api/agent/walk-forward
 * Run walk-forward validation (async with SSE progress).
 */
router.post('/agent/walk-forward', mlRateLimiter, async (req: Request, res: Response) => {
  try {
    const {
      symbol,
      mode = 'anchored',
      numFolds = 5,
      testSize = 0.1,
      gapBars = 0,
      epochsPerFold = 15,
      batchSize = 32,
      universalConfig,
      cnnConfig,
    } = req.body;

    if (!symbol) {
      return res.status(400).json({ error: 'symbol is required' });
    }

    const config: WalkForwardConfig = {
      symbol: symbol.toUpperCase(),
      mode,
      numFolds,
      testSize,
      gapBars,
      epochsPerFold,
      batchSize,
      universalConfig,
      cnnConfig,
    };

    // Run asynchronously — client gets progress via SSE
    const resultPromise = walkForwardValidator.run(config);

    // Return immediately with confirmation
    res.json({
      status: 'started',
      message: `Walk-forward validation started: ${numFolds} folds, ${mode} mode`,
      config,
    });

    // The result will be available via SSE stream
    resultPromise.catch(err => {
      console.error('[WalkForward] Error:', err.message);
    });
  } catch (error: any) {
    console.error('[Agent] Walk-forward error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/** POST /api/agent/walk-forward/stop — Stop walk-forward validation */
router.post('/agent/walk-forward/stop', async (_req: Request, res: Response) => {
  walkForwardValidator.stop();
  res.json({ message: 'Walk-forward stop requested' });
});

/** GET /api/agent/walk-forward/stream — SSE for walk-forward progress */
router.get('/agent/walk-forward/stream', async (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const onStatus = (data: any) => {
    res.write(`event: status\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const onFoldStart = (data: any) => {
    res.write(`event: fold-start\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const onFoldProgress = (data: any) => {
    res.write(`event: fold-progress\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const onFoldComplete = (data: any) => {
    res.write(`event: fold-complete\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const onComplete = (data: any) => {
    // Send final results (without predictions array to keep size down)
    const summary = {
      ...data,
      folds: data.folds?.map((f: any) => ({
        ...f,
        predictions: f.predictions?.length || 0, // Just count, not full array
      })),
    };
    res.write(`event: complete\ndata: ${JSON.stringify(summary)}\n\n`);
    cleanup();
    res.end();
  };

  function cleanup() {
    walkForwardValidator.off('status', onStatus);
    walkForwardValidator.off('fold-start', onFoldStart);
    walkForwardValidator.off('fold-progress', onFoldProgress);
    walkForwardValidator.off('fold-complete', onFoldComplete);
    walkForwardValidator.off('complete', onComplete);
  }

  walkForwardValidator.on('status', onStatus);
  walkForwardValidator.on('fold-start', onFoldStart);
  walkForwardValidator.on('fold-progress', onFoldProgress);
  walkForwardValidator.on('fold-complete', onFoldComplete);
  walkForwardValidator.on('complete', onComplete);

  // Send connection confirmation
  res.write(`event: connected\ndata: ${JSON.stringify({ time: Date.now() })}\n\n`);

  _req.on('close', cleanup);
});

// ============================================================
// MODEL MANAGEMENT
// ============================================================

/** GET /api/agent/models — List models available for inference */
router.get('/agent/models', async (_req: Request, res: Response) => {
  try {
    const models = listAvailableModels();
    res.json({ models, count: models.length });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/** POST /api/agent/models/unload — Unload a cached model */
router.post('/agent/models/unload', async (req: Request, res: Response) => {
  try {
    const { modelName } = req.body;
    if (modelName === '*') {
      unloadAllModels();
      res.json({ message: 'All models unloaded' });
    } else if (modelName) {
      const success = unloadModel(modelName);
      res.json({ message: success ? `Model ${modelName} unloaded` : `Model ${modelName} not cached` });
    } else {
      res.status(400).json({ error: 'modelName required (or "*" to unload all)' });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// STRATEGY CONFIGURATION
// ============================================================

/** GET /api/agent/strategy/config — Get current strategy config */
router.get('/agent/strategy/config', async (_req: Request, res: Response) => {
  res.json({
    signalConfig: DEFAULT_SIGNAL_CONFIG,
    strategyConfig: DEFAULT_STRATEGY_CONFIG,
    state: strategyEngine.getState(),
  });
});

/** PUT /api/agent/strategy/config — Update strategy config */
router.put('/agent/strategy/config', async (req: Request, res: Response) => {
  try {
    const { signalConfig, strategyConfig: stratCfg } = req.body;

    if (signalConfig) {
      signalGenerator.updateConfig(signalConfig);
    }
    if (stratCfg) {
      strategyEngine.updateConfig(stratCfg);
    }

    res.json({
      message: 'Strategy config updated',
      signalConfig: { ...DEFAULT_SIGNAL_CONFIG, ...signalConfig },
      strategyConfig: { ...DEFAULT_STRATEGY_CONFIG, ...stratCfg },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
