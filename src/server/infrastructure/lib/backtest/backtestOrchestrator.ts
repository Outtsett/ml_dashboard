/**
 * Backtest Orchestrator — coordinates the full backtest pipeline.
 *
 * Steps: resolve instrument -> load data -> generate signals -> run engine -> persist results.
 * Extracted from routes/backtest.ts for SRP: routes handle HTTP, this handles logic.
 */

import { randomUUID } from "crypto";
import { storage, getAssetType } from "../../storage";
import { queryQuestDB as marketQuery } from "../../database/questdb";
import {
  runBacktest, type Signal, type InstrumentSpec, type BacktestConfig,
  type OHLCVBar, type BacktestMetrics,
} from "./tradeSimulator";
import { generateModelSignals, generateMomentumSignals } from "./modelInference";
import { executeStrategy } from "./strategyEngine";
import type { StrategyDefinition, SignalSource } from "@shared/strategyTypes";
import type { BacktestRun } from "@shared/schema";
import { getEventBus } from "../../events/event-bus";

// ── Request / Response Types ─────────────────────────────────────────────────

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
  run: BacktestRun;
  metrics: BacktestMetrics;
  tradeCount: number;
  equityCurvePoints: number;
  dataSummary: {
    totalBars: number;
    trainBars: number;
    testBars: number;
    signalCount: number;
  };
}

// ── Timeframe Mapping ───────────────────────────────────────────────────────

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

function eventMetadata() {
  const id = randomUUID().slice(0, 12);
  return { correlationId: id, causationId: id, timestamp: Date.now() };
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

export async function runBacktestJob(req: BacktestRequest): Promise<BacktestResult> {
  const { symbol } = req;
  const startTime = Date.now();

  // 1. Emit Start Event to Global Bus
  getEventBus().emit({
    type: "pipeline.started",
    data: {
      pipelineId: symbol,
      pipelineType: "backtest",
      config: {
        symbol,
        timeframe: req.timeframe ?? "1m",
        modelId: req.modelId ?? null,
        strategy: req.strategy?.name ?? null,
        start: req.start ?? null,
        end: req.end ?? null,
      },
    },
    metadata: eventMetadata(),
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
      brokerConfig = defaults.find((c) => c.isDefault && c.assetType === assetType) || defaults.find((c) => c.assetType === assetType);
    }

    if (!brokerConfig) {
      throw new BacktestError(`No broker config found for asset type: ${assetType}`, 400);
    }

    // 3. Load OHLCV data from the lake.
    // The column is `timestamp`, not `ts` — `ts` is only the output alias the
    // backtester reads.
    const interval = TIMEFRAME_TO_INTERVAL[timeframe] || "INTERVAL '1 minute'";
    let whereClause = `WHERE symbol = '${symbol}'`;
    if (start) whereClause += ` AND timestamp >= '${start}'`;
    if (end) whereClause += ` AND timestamp <= '${end}'`;

    let ohlcvData: OHLCVBar[] = [];
    if (timeframe === "1m") {
      ohlcvData = await marketQuery<OHLCVBar>(`
        SELECT epoch_ms(timestamp)::DOUBLE AS ts, open, high, low, close, CAST(volume AS DOUBLE) AS volume
        FROM ohlcv ${whereClause}
        ORDER BY 1 ASC
      `);
    } else {
      // arg_min/arg_max, not FIRST/LAST: DuckDB's FIRST and LAST are
      // order-unspecified within a group, so on a bucket spanning many rows
      // they can return any of them and the bar's open/close would drift
      // between runs without ever raising.
      ohlcvData = await marketQuery<OHLCVBar>(`
        SELECT
          epoch_ms(time_bucket(${interval}, timestamp))::DOUBLE AS ts,
          arg_min(open, timestamp) AS open,
          MAX(high) AS high,
          MIN(low) AS low,
          arg_max(close, timestamp) AS close,
          CAST(SUM(volume) AS DOUBLE) AS volume
        FROM ohlcv ${whereClause}
        GROUP BY time_bucket(${interval}, timestamp)
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

    const backtest = await runBacktest(ohlcvData, signals, instrumentSpec, brokerConfig, config);

    // 6. Persist results to SQLite
    const runName = req.strategy
      ? `Backtest ${symbol} ${req.strategy.name}`
      : resolvedModelId
        ? `Backtest ${symbol} Model#${resolvedModelId}`
        : `Backtest ${symbol} Momentum`;

    // NOTE: createBacktestRun's insert only persists the fields listed in
    // CreateBacktestRunParams (see storage/types.ts) — sharpeRatio/maxDrawdown/
    // winRate/totalTrades/totalReturn are NOT among them, so passing computed
    // metrics here was already a no-op before this file had real types (the
    // `data: any` param silently dropped anything the insert didn't name).
    // Preserved as-is (no runtime behavior change); metrics persistence would
    // need a follow-up storage.updateBacktestRun(run.id, {...}) call.
    const run = await storage.createBacktestRun({
      name: runName,
      symbol,
      modelId: resolvedModelId || null,
      brokerConfigId: brokerConfig.id,
      timeframe,
      initialCapital,
      status: "completed",
    });

    // Bulk insert trades. This called `storage.createBacktestTrades`, which has
    // never existed — every backtest that produced a trade threw here, hidden
    // behind an `any` cast. `insertBacktestTrades` is the storage method.
    if (backtest.trades.length > 0) {
      await storage.insertBacktestTrades(
        backtest.trades.map((t) => ({ ...t, backtestRunId: run.id })),
      );
    }

    const result: BacktestResult = {
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
      type: "pipeline.step.completed",
      data: {
        pipelineId: symbol,
        step: "simulation",
        stepIndex: 1,
        durationMs: Date.now() - startTime,
        result: { tradeCount: result.tradeCount, totalReturn: result.metrics.totalReturn },
      },
      metadata: eventMetadata(),
    });
    getEventBus().emit({
      type: "pipeline.completed",
      data: { pipelineId: symbol, totalDurationMs: Date.now() - startTime },
      metadata: eventMetadata(),
    });

    return result;
  } catch (error) {
    // 8. Emit Failure Event
    getEventBus().emit({
      type: "pipeline.failed",
      data: {
        pipelineId: symbol,
        error: (error as Error).message,
        failedStep: "simulation",
      },
      metadata: eventMetadata(),
    });
    throw error;
  }
}
