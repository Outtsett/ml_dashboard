/**
 * Backtest Orchestrator — coordinates the full backtest pipeline.
 *
 * Steps: resolve instrument -> load data -> generate signals -> run engine -> persist results.
 * Extracted from routes/backtest.ts for SRP: routes handle HTTP, this handles logic.
 */

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

// ── Orchestrator ──────────────────────────────────────────────────────────────

export async function runBacktestJob(req: BacktestRequest): Promise<BacktestResult> {
  const { symbol } = req;
  const startTime = Date.now();

  // 1. Emit Start Event to Global Bus
  //
  // NOTE: these three getEventBus().emit() calls (start/success/failure below)
  // do not conform to the real DomainEvent/PipelineEvent contract in
  // @shared/event-types.ts — 'backtest' is not a member of PipelineType
  // ('training' | 'ingestion' | 'deployment'), the metadata shape here
  // ({source, ts}) doesn't match EventMetadata ({correlationId, causationId,
  // timestamp}), and the 'pipeline.completed'/'pipeline.failed' data payloads
  // below don't match those event variants' declared data shapes either.
  // Typing these honestly means either changing what's actually emitted
  // (a runtime behavior change, out of scope for a typing-only pass) or
  // extending shared/event-types.ts (out of scope — src/shared/ is off limits
  // for this pass). Left as `any` deliberately; flagged for a follow-up
  // decision rather than forced.
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
      brokerConfig = defaults.find((c) => c.isDefault && c.assetType === assetType) || defaults.find((c) => c.assetType === assetType);
    }

    if (!brokerConfig) {
      throw new BacktestError(`No broker config found for asset type: ${assetType}`, 400);
    }

    // 3. Load OHLCV data from QuestDB
    const interval = TIMEFRAME_TO_INTERVAL[timeframe] || "INTERVAL '1 minute'";
    let whereClause = `WHERE symbol = '${symbol}'`;
    if (start) whereClause += ` AND ts >= '${start}'`;
    if (end) whereClause += ` AND ts <= '${end}'`;

    let ohlcvData: OHLCVBar[] = [];
    if (timeframe === "1m") {
      ohlcvData = await marketQuery<OHLCVBar>(`
        SELECT epoch_ms(ts)::DOUBLE AS ts, open, high, low, close, CAST(volume AS DOUBLE) AS volume
        FROM ohlcv ${whereClause}
        ORDER BY ts ASC
      `);
    } else {
      ohlcvData = await marketQuery<OHLCVBar>(`
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

    // Bulk insert trades
    //
    // NOTE: `storage.createBacktestTrades` does not exist — the real method is
    // `storage.insertBacktestTrades` (see storage/backtesting.ts /
    // storage/types.ts IBacktestStorage). This call has always thrown a
    // TypeError at runtime whenever a backtest produced any trades; the `any`
    // cast was masking a genuine pre-existing bug, not a typing gap. Renaming
    // it would change runtime behavior (throw -> succeed), which is out of
    // scope for this typing-only pass — left as-is and flagged for a
    // follow-up fix decision.
    if (backtest.trades.length > 0) {
      await (storage as any).createBacktestTrades(
        backtest.trades.map((t: any) => ({
          ...t,
          backtestRunId: run.id,
        }))
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

    // 7. Emit Success Event (see NOTE above — same contract mismatch)
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
  } catch (error) {
    // 8. Emit Failure Event (see NOTE above — same contract mismatch)
    getEventBus().emit({
      type: "pipeline.failed" as any,
      data: {
        pipelineId: symbol,
        reason: (error as Error).message
      } as any,
      metadata: { source: "backtest-orchestrator", ts: Date.now() } as any
    });
    throw error;
  }
}
