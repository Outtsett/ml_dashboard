/**
 * Trading Agent — Full Pipeline Route
 *
 * Routes:
 *   POST /api/agent/full-pipeline — run the full loop: predict → signal → backtest
 */

import { Router, Request, Response } from 'express';
import { mlRateLimiter } from '../../lib/rateLimiter';
import { predictBatch } from '../../../ml/inference/inferenceService';
import { SignalGenerator } from '../../../ml/inference/signalGenerator';
import { strategyEngine } from '../../../ml/inference/strategyEngine';
import { questdbMarketQuery as marketQuery } from '../../lib/questdbMarketQuery';
import { storage, getAssetType } from '../../storage';
import {
  runBacktest,
  type OHLCVBar,
  type InstrumentSpec,
  type BacktestConfig,
} from '../../lib/backtestEngine';

const router = Router();

/**
 * POST /api/agent/full-pipeline
 * Run the complete trading agent loop:
 * 1. Load saved model
 * 2. Generate predictions over time range
 * 3. Apply signal filters
 * 4. Run backtest with cost model
 * 5. Return results + metrics
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

    // 3. Load OHLCV data
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
    const testStartTs = testBars[0]!.ts;
    const testEndTs = testBars[testBars.length - 1]!.ts;

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
        trainStartTimestamp: ohlcvData[0]!.ts,
        trainEndTimestamp: ohlcvData[splitIdx]!.ts,
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
      equityCurve: backtestResult.equityCurve.slice(-500),
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

export default router;
