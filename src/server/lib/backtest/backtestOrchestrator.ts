/**
 * Backtest Orchestrator — coordinates the full backtest pipeline.
 *
 * Steps: resolve instrument ? load data ? generate signals ? run engine ? persist results.
 * Extracted from routes/backtest.ts for SRP: routes handle HTTP, this handles logic.
 */

import { storage, getAssetType } from "../../storage";
import { queryQuestDB as marketQuery } from "../../database/questdb";
import { runBacktest, type Signal, type InstrumentSpec, type BacktestConfig } from "./tradeSimulator";
import { generateModelSignals, generateMomentumSignals } from "./modelInference";
import { executeStrategy } from "./strategyEngine";
import type { StrategyDefinition, SignalSource } from "@shared/strategyTypes";
import { getEventBus } from "../../events/event-bus";

// ——— Request / Response Types ————————————————————————————————————————————————

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

// ——— Timeframe Mapping ————————————————————————————————————————————————————————

const TIMEFRAME_TO_INTERVAL: Record<string, string> = {
  "1m": "INTERVAL '1 minute'",
  "5m": "INTERVAL '5 minutes'",
  "15m": "INTERVAL '15 minutes'",
  "30m": "INTERVAL '30 minutes'",
  "1H": "INTERVAL '1 hour'",
  "4H": "INTERVAL '4 hours'",
  "1D": "INTERVAL '1 day'",
  "1W": "INTERVAL '7 days'",
};

export class BacktestError extends Error {
  constructor(message: string, public statusCode: number = 500) {
    super(message);
    this.name = "BacktestError";
  }
}

// ——— Orchestrator ————————————————————————————————————————————————————————————

export async function runBacktestJob(req: BacktestRequest): Promise<BacktestResult> {
  const { symbol } = req;
  const startTime = Date.now();
  
  // 1. Emit Start Event to Global Bus
  getEventBus().emit({ 
    type: "pipeline.started" as any, 
    data: { 
      pipelineId: symbol, 
      pipelineType: "backtest" as any, 
      config: req as any
    },
    metadata: { source: "backtest-orchestrator", ts: startTime } as any
  });

  try {
    const {
      modelId,
      brokerConfigId,
      timeframe = "1m",
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
    };

    // 2. Resolve broker config
    let brokerConfig;
    if (brokerConfigId) {
      brokerConfig = await storage.getBrokerConfig(brokerConfigId);
    } else {
      const defaults = await storage.getBrokerConfigs();
      brokerConfig = defaults.find((c: any) => c.isDefault && c.assetType === assetType) || defaults.find((c: any) => c.assetType === assetType);
    }

    if (!brokerConfig) {
      throw new BacktestError(`No broker config found for asset type: ${assetType}`, 400);
    }

    // 3. Load OHLCV data from QuestDB
    const interval = TIMEFRAME_TO_INTERVAL[timeframe] || "INTERVAL '1 minute'";
    let whereClause = `WHERE symbol = '${symbol}'`;
    if (start) whereClause += ` AND ts >= '${start}'`;
    if (end) whereClause += ` AND ts <= '${end}'`;

    let ohlcvData: any[] = [];
    if (timeframe === "1m") {
      ohlcvData = await marketQuery(`
        SELECT epoch_ms(ts)::DOUBLE AS ts, open, high, low, close, CAST(volume AS DOUBLE) AS volume
        FROM ohlcv ${whereClause}
        ORDER BY ts ASC
      `);
    } else {
      ohlcvData = await marketQuery(`
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
      `);
    }

    if (ohlcvData.length < 100) {
      throw new BacktestError(`Insufficient data: only ${ohlcvData.length} bars found. Need at least 100.`, 400);
    }

    // 4. Generate Signals
    let signals: Signal[] = [];
    let resolvedModelId = modelId;

    if (req.strategy) {
      signals = await executeStrategy(ohlcvData, req.strategy);
    } else if (modelId || req.useLastTrained) {
      // Corrected signature: bars, modelId, minConfidence
      const inferenceSignals = await generateModelSignals(ohlcvData, modelId || 0, minConfidence);
      signals = inferenceSignals;
      resolvedModelId = modelId;
    } else {
      signals = await generateMomentumSignals(ohlcvData);
    }

    // 5. Run Simulator
    const config: BacktestConfig = {
      initialCapital,
      positionSize,
      maxPositions,
      stopLossTicks,
      takeProfitTicks,
      trailingStopTicks,
      maxDrawdownPct
    };

    const backtest = await (runBacktest as any)(ohlcvData, signals, instrumentSpec, brokerConfig, config);

    // 6. Persist results to SQLite
    const runName = req.strategy 
      ? `Backtest ${symbol} ${req.strategy.name}`
      : resolvedModelId 
        ? `Backtest ${symbol} Model#${resolvedModelId}`
        : `Backtest ${symbol} Momentum`;

    const run = await storage.createBacktestRun({
      name: runName,
      symbol,
      modelId: resolvedModelId || null,
      brokerConfigId: brokerConfig.id,
      timeframe,
      initialCapital,
      totalPnl: backtest.metrics.totalReturn || 0,
      sharpeRatio: backtest.metrics.sharpeRatio,
      maxDrawdown: backtest.metrics.maxDrawdown,
      winRate: backtest.metrics.winRate,
      tradeCount: backtest.trades.length,
      config: JSON.stringify(config),
      status: "completed",
    });

    // Bulk insert trades
    if (backtest.trades.length > 0) {
      await (storage as any).createBacktestTrades(
        backtest.trades.map((t: any) => ({
          ...t,
          backtestRunId: run.id,
        }))
      );
    }

    const result = {
      run,
      metrics: backtest.metrics,
      tradeCount: backtest.trades.length,
      equityCurvePoints: backtest.equityCurve.length,
      dataSummary: {
        totalBars: ohlcvData.length,
        trainBars: Math.floor(ohlcvData.length * splitRatio),
        testBars: ohlcvData.length - Math.floor(ohlcvData.length * splitRatio),
        signalCount: signals.length,
      },
    };

    // 7. Emit Success Event
    getEventBus().emit({ 
      type: "pipeline.completed" as any, 
      data: { 
        pipelineId: symbol, 
        step: "simulation",
        stepIndex: 1,
        durationMs: Date.now() - startTime,
        result: { tradeCount: result.tradeCount, pnl: result.metrics.totalReturn } as any
      },
      metadata: { source: "backtest-orchestrator", ts: Date.now() } as any
    });

    return result;
  } catch (error: any) {
    // 8. Emit Failure Event
    getEventBus().emit({ 
      type: "pipeline.failed" as any, 
      data: { 
        pipelineId: symbol, 
        reason: error.message 
      } as any,
      metadata: { source: "backtest-orchestrator", ts: Date.now() } as any
    });
    throw error;
  }
}