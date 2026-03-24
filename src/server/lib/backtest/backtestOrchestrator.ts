/**
 * Backtest Orchestrator — coordinates the full backtest pipeline.
 *
 * Steps: resolve instrument → load data → generate signals → run engine → persist results.
 * Extracted from routes/backtest.ts for SRP: routes handle HTTP, this handles logic.
 */

import { storage, getAssetType } from '../../storage';
import { queryQuestDB as marketQuery } from '../../database/questdb';
import { runBacktest, type Signal, type InstrumentSpec, type BacktestConfig } from './tradeSimulator';
import { generateModelSignals, generateMomentumSignals } from './modelInference';
import { executeStrategy } from './strategyEngine';
import type { StrategyDefinition, SignalSource } from '@shared/strategyTypes';

// ─── Request / Response Types ───────────────────────────────────────────────

export interface BacktestRequest {
  symbol: string;
  modelId?: number;
  useLastTrained?: boolean;
  brokerConfigId?: number;
  timeframe?: string;
  splitRatio?: number;
  initialCapital?: number;
  positionSize?: number;
  maxPositions?: number;
  stopLossTicks?: number;
  takeProfitTicks?: number;
  trailingStopTicks?: number;
  maxDrawdownPct?: number;
  minConfidence?: number;
  start?: string;
  end?: string;
  /** Full strategy definition — takes precedence over bare modelId. */
  strategy?: StrategyDefinition;
  /** Override signal source label for the run record. */
  signalSource?: SignalSource;
}

export interface BacktestResult {
  run: any;
  metrics: any;
  tradeCount: number;
  equityCurvePoints: number;
  dataSummary: {
    totalBars: number;
    trainBars: number;
    testBars: number;
    signalCount: number;
  };
}

// ─── Timeframe Mapping ──────────────────────────────────────────────────────

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

// ─── Orchestrator ───────────────────────────────────────────────────────────

export async function runBacktestJob(req: BacktestRequest): Promise<BacktestResult> {
  const {
    symbol,
    modelId,
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
  } = req;

  // 1. Resolve instrument
  const instrument = await storage.getInstrument(symbol);
  if (!instrument) {
    throw new BacktestError(`Instrument not found: ${symbol}`, 404);
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
    throw new BacktestError(`No broker config found for asset type: ${assetType}`, 400);
  }

  // 3. Load OHLCV data
  const interval = TIMEFRAME_TO_INTERVAL[timeframe] || TIMEFRAME_TO_INTERVAL['1m'];
  let whereClause = `WHERE symbol = '${symbol}'`;
  if (start) whereClause += ` AND ts >= '${start}'`;
  if (end) whereClause += ` AND ts <= '${end}'`;

  let ohlcvSql: string;
  if (timeframe === '1m') {
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
    throw new BacktestError(`Insufficient data: only ${ohlcvData.length} bars found. Need at least 100.`, 400);
  }

  // 4. Split into train/test
  const splitIdx = Math.floor(ohlcvData.length * splitRatio);
  const trainBars = ohlcvData.slice(0, splitIdx);
  const testBars = ohlcvData.slice(splitIdx);

  // 5. Generate signals based on strategy / model / fallback
  let signals: Signal[];
  let signalSource: SignalSource;

  if (req.strategy) {
    signals = await executeStrategy(testBars, req.strategy);
    signalSource = req.strategy.type === 'hybrid'
      ? 'hybrid'
      : req.strategy.type === 'ml_prediction'
        ? 'model'
        : req.strategy.type === 'indicator'
          ? 'indicator'
          : 'momentum';
  } else if (modelId) {
    signals = await generateModelSignals(testBars, modelId, minConfidence);
    signalSource = 'model';
  } else {
    console.log(`[Backtest] Using momentum-based signals for ${symbol}`);
    signals = generateMomentumSignals(testBars);
    signalSource = 'momentum';
  }
  const resolvedModelId: number | undefined = req.strategy?.modelId ?? modelId;

  if (signals.length === 0) {
    throw new BacktestError('No signals generated. Check model or data.', 400);
  }

  // 6. Create backtest run record
  const backtestName = req.strategy
    ? `Backtest ${symbol} ${req.strategy.name}`
    : resolvedModelId
      ? `Backtest ${symbol} Model#${resolvedModelId}`
      : `Backtest ${symbol} Momentum`;

  const run = await storage.createBacktestRun({
    name: backtestName,
    modelId: resolvedModelId,
    symbol,
    brokerConfigId: brokerConfig.id,
    timeframe,
    trainStartTimestamp: trainBars.length > 0 ? trainBars[0]!.ts : null,
    trainEndTimestamp: trainBars.length > 0 ? trainBars[trainBars.length - 1]!.ts : null,
    testStartTimestamp: testBars.length > 0 ? testBars[0]!.ts : null,
    testEndTimestamp: testBars.length > 0 ? testBars[testBars.length - 1]!.ts : null,
    splitRatio,
    initialCapital,
    positionSize,
    maxPositions,
    stopLossTicks,
    takeProfitTicks,
    trailingStopTicks,
    maxDrawdownPct,
    signalSource,
    strategyConfig: req.strategy ? JSON.stringify(req.strategy) : null,
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
    sampledCurve = sampledCurve.filter((_: any, i: number) => i % step === 0 || i === sampledCurve.length - 1);
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
  return {
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
  };
}

// ─── Error Type ─────────────────────────────────────────────────────────────

export class BacktestError extends Error {
  constructor(message: string, public statusCode: number) {
    super(message);
    this.name = 'BacktestError';
  }
}
