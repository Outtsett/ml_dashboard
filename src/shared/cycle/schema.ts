/**
 * Model Cycle wire contract — the events `src/ml/cycle/main.py` prints, the
 * server parser validates, the accumulator stores and the client store applies.
 *
 * One source of truth for all three layers. The Python side is
 * `src/ml/shared/protocol.py` (`emit_cycle_*`); every field there has the same
 * name here. Design and CLI flags: `docs/plans/2026-09-25-model-cycle.md`.
 *
 * Conventions:
 *  - Times are epoch SECONDS (integers). The chart uses them as-is.
 *  - Keys are camelCase in full words. Metric names inside a scoreboard are
 *    snake_case in full words, matching `emit_metric` names.
 *  - A number that is undefined (too few samples, one class only, no losses)
 *    is `null`, never 0.
 *  - Every event carries the protocol envelope's `seq` (per-process counter);
 *    the client applies each event once by `seq`.
 */
import { z } from "zod";

// ─── Shared pieces ──────────────────────────────────────────────────────────

const epochSeconds = z.number().int();
const nullableNumber = z.number().nullable();

/** Envelope fields the protocol stamps on every event. All optional on read. */
export const cycleEnvelopeSchema = z.object({
  seq: z.number().int().nonnegative().optional(),
  run_id: z.string().nullable().optional(),
  ts: z.string().optional(),
});

/**
 * A model key from the Cycle's model registry (`src/config/cycle_models/`), e.g.
 * "xgboost" or "extra_trees". The registry — not this schema — decides which keys
 * exist; the server and the engine check membership. A fixed list here would make
 * the server's parser drop every plan of a model added to the registry.
 */
export const cycleModelFamilySchema = z.string().regex(/^[a-z][a-z0-9_]{1,39}$/);
export type CycleModelFamily = z.infer<typeof cycleModelFamilySchema>;

/** How a model's "Inside the model" view explains one bar (`src/shared/cycle/explain.ts`). */
export const cycleExplainKindSchema = z.enum([
  "trees",
  "oblivious_trees",
  "linear",
  "neighbors",
  "naive_bayes",
  "support_vectors",
  "calibration",
  "stacking",
  "neural",
]);
export type CycleExplainKind = z.infer<typeof cycleExplainKindSchema>;

/** "classifier": a direction model fitted on up/down labels. "from_price": the model is fitted on the price target and P(up) is read from its forecast move through a logistic curve fitted on the validation bars. */
export const cycleDirectionModeSchema = z.enum(["classifier", "from_price"]);
export type CycleDirectionMode = z.infer<typeof cycleDirectionModeSchema>;

/** What one training step is: an epoch, a boosting round, a chunk of trees, a solver pass, or one uninterruptible fit. */
export const cycleStepUnitSchema = z.enum(["epoch", "boosting_round", "tree_batch", "solver_pass", "single_fit"]);
export type CycleStepUnit = z.infer<typeof cycleStepUnitSchema>;

export const cyclePhaseSchema = z.enum([
  "loading",
  "tuning",
  "training",
  "validating",
  "testing",
  "complete",
  "stopped",
  "failed",
]);
export type CyclePhase = z.infer<typeof cyclePhaseSchema>;

const directionSchema = z.union([z.literal(1), z.literal(0), z.literal(-1)]);

// ─── cycle_plan ─────────────────────────────────────────────────────────────

export const cycleFoldPlanSchema = z.object({
  foldIndex: z.number().int().nonnegative(),
  trainStart: epochSeconds,
  trainEnd: epochSeconds,
  validationStart: epochSeconds,
  validationEnd: epochSeconds,
  testStart: epochSeconds,
  testEnd: epochSeconds,
  trainBarCount: z.number().int().nonnegative(),
  validationBarCount: z.number().int().nonnegative(),
  testBarCount: z.number().int().nonnegative(),
});
export type CycleFoldPlan = z.infer<typeof cycleFoldPlanSchema>;

export const cyclePlanSchema = cycleEnvelopeSchema.extend({
  symbol: z.string(),
  timeframe: z.string(),
  modelFamily: cycleModelFamilySchema,
  modelLabel: z.string(),
  /** The catalog spec this model implements (`/model-catalog?model=<id>`); null for a Cycle-only model. */
  catalogSpecId: z.string().nullable().optional(),
  /** The library that fits it: sklearn, xgboost, lightgbm, catboost, statsmodels or torch. */
  implementation: z.string().optional(),
  explainKind: cycleExplainKindSchema.optional(),
  directionMode: cycleDirectionModeSchema.optional(),
  /** False when the model has no regression form: no price model, no forecast line. */
  hasPriceModel: z.boolean().optional(),
  parameters: z.record(z.union([z.number(), z.string(), z.boolean(), z.null()])),
  device: z.enum(["cuda", "cpu"]),
  deviceName: z.string().nullable(),
  dataStart: epochSeconds,
  dataEnd: epochSeconds,
  barCount: z.number().int().nonnegative(),
  /** Bars per calendar year measured on the loaded data — the Sharpe/Sortino annualisation basis. */
  barsPerYear: z.number().positive(),
  featureNames: z.array(z.string()),
  labelHorizonBars: z.number().int().positive(),
  labelThresholdTicks: z.number().nonnegative(),
  purgeBars: z.number().int().nonnegative(),
  embargoBars: z.number().int().nonnegative(),
  costModel: z.object({
    tickSize: z.number().positive(),
    tickValueUsd: z.number().positive(),
    pointValueUsd: z.number().positive(),
    costPerSideUsd: z.number().nonnegative(),
    roundTripCostUsd: z.number().nonnegative(),
    source: z.string(),
  }),
  /** Every prediction is traded: long at P(up) >= 0.5, short below it (flat below it when `longOnly`). */
  trading: z.object({
    longOnly: z.boolean(),
    holdingBars: z.number().int().positive(),
    stopLossTicks: z.number().nonnegative(),
    takeProfitTicks: z.number().nonnegative(),
    contracts: z.number().int().positive(),
  }),
  tuning: z
    .object({
      trialCount: z.number().int().positive(),
      objective: z.enum(["sharpe_ratio", "log_loss", "f1_score"]),
      innerFoldCount: z.number().int().positive(),
      start: epochSeconds,
      end: epochSeconds,
    })
    .nullable(),
  folds: z.array(cycleFoldPlanSchema).min(1),
  barsPerSecond: z.number().nonnegative(),
  startPaused: z.boolean(),
  artifactDirectory: z.string(),
  /**
   * A stitched futures root is raw prices spliced at each contract roll; the
   * engine shifts every bar before a roll by that roll's step (additive /
   * Panama) so the splice is not booked as a price move. The newest contract's
   * prices are as traded. `none` for a single contract or a non-futures series.
   */
  priceAdjustment: z
    .object({
      method: z.enum(["none", "panama_additive"]),
      rolls: z.array(
        z.object({
          timestamp: epochSeconds,
          fromContract: z.string(),
          toContract: z.string(),
          gapPoints: z.number(),
          exact: z.boolean(),
        }),
      ),
    })
    .optional(),
});
export type CyclePlan = z.infer<typeof cyclePlanSchema>;

// ─── cycle_bars ─────────────────────────────────────────────────────────────

export const cycleBarRoleSchema = z.enum(["context", "processed"]);
export type CycleBarRole = z.infer<typeof cycleBarRoleSchema>;

export const cycleBarsSchema = cycleEnvelopeSchema
  .extend({
    role: cycleBarRoleSchema,
    foldIndex: z.number().int().nonnegative().nullable(),
    timestamps: z.array(epochSeconds),
    open: z.array(z.number()),
    high: z.array(z.number()),
    low: z.array(z.number()),
    close: z.array(z.number()),
    volume: z.array(z.number()),
    // Present (same length as timestamps) only when role === "processed".
    probabilityUp: z.array(nullableNumber).optional(),
    predictedDirection: z.array(directionSchema).optional(),
    /** Position held through this bar after acting on its prediction: 1 long, -1 short, 0 flat. */
    position: z.array(directionSchema).optional(),
    /** Cumulative marked-to-market net profit of the test walk through this bar, USD. */
    equityUsd: z.array(z.number()).optional(),
    /**
     * The price model's forecast, made at this bar, of the close `labelHorizonBars`
     * later: this bar's close plus the predicted move in points. Null when the
     * bar could not be predicted. Same (roll-adjusted) price space as the bars.
     */
    predictedClose: z.array(nullableNumber).optional(),
    /** Epoch seconds of the bar that forecast is for (this bar + labelHorizonBars); null past the loaded data. */
    forecastTimestamp: z.array(epochSeconds.nullable()).optional(),
    /**
     * Labels that became known during this frame: the bar `labelHorizonBars`
     * before each processed bar. `correct` is null when the move was inside the
     * threshold (the bar is not scored).
     */
    resolved: z
      .object({
        timestamps: z.array(epochSeconds),
        actualDirection: z.array(directionSchema),
        correct: z.array(z.boolean().nullable()),
      })
      .optional(),
  })
  .superRefine((value, ctx) => {
    const n = value.timestamps.length;
    for (const key of ["open", "high", "low", "close", "volume"] as const) {
      if (value[key].length !== n) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${key} has ${value[key].length} values for ${n} timestamps` });
      }
    }
    for (const key of ["probabilityUp", "predictedDirection", "position", "equityUsd", "predictedClose", "forecastTimestamp"] as const) {
      const column = value[key];
      if (column && column.length !== n) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${key} has ${column.length} values for ${n} timestamps` });
      }
    }
  });
export type CycleBars = z.infer<typeof cycleBarsSchema>;

// ─── cycle_cursor ───────────────────────────────────────────────────────────

export const cycleCursorSchema = cycleEnvelopeSchema.extend({
  phase: cyclePhaseSchema,
  foldIndex: z.number().int().nonnegative().nullable(),
  foldCount: z.number().int().nonnegative(),
  /** The bars the model is working on right now (a training block, the validation span, the tuning block). */
  spanStart: epochSeconds.nullable(),
  spanEnd: epochSeconds.nullable(),
  /** Testing: the bar just predicted. */
  barTimestamp: epochSeconds.nullable(),
  barIndex: z.number().int().nonnegative().nullable(),
  barCount: z.number().int().nonnegative().nullable(),
  epoch: z.number().int().nonnegative().nullable(),
  epochCount: z.number().int().nonnegative().nullable(),
  batch: z.number().int().nonnegative().nullable(),
  batchCount: z.number().int().nonnegative().nullable(),
  /** What one training step is for this model. */
  stepUnit: cycleStepUnitSchema.nullable(),
  /** Which of the fold's two models is being fitted: the direction classifier or the price model. */
  modelRole: z.enum(["direction", "price"]).nullable().optional(),
  trial: z.number().int().nonnegative().nullable(),
  trialCount: z.number().int().nonnegative().nullable(),
  phaseFraction: z.number().min(0).max(1),
  overallFraction: z.number().min(0).max(1),
  barsPerSecond: z.number().nonnegative(),
  paused: z.boolean(),
  elapsedSeconds: z.number().nonnegative(),
});
export type CycleCursor = z.infer<typeof cycleCursorSchema>;

// ─── cycle_epoch ────────────────────────────────────────────────────────────

export const cycleEpochSchema = cycleEnvelopeSchema.extend({
  foldIndex: z.number().int().nonnegative().nullable(),
  trial: z.number().int().nonnegative().nullable(),
  epoch: z.number().int().nonnegative(),
  epochCount: z.number().int().nonnegative(),
  stepUnit: cycleStepUnitSchema,
  /**
   * "direction": losses are log loss, accuracy / F1 of the predicted class.
   * "price": losses are mean absolute error of the VOLATILITY-SCALED move (the
   * forward move divided by the trailing volatility of h-bar moves — the target
   * the price model is fitted on), accuracy is the sign of the predicted move.
   */
  modelRole: z.enum(["direction", "price"]).optional(),
  trainLoss: nullableNumber,
  validationLoss: nullableNumber,
  validationAccuracy: nullableNumber,
  validationF1Score: nullableNumber,
  learningRate: nullableNumber,
  gradientNorm: nullableNumber,
  isBest: z.boolean(),
  secondsElapsed: z.number().nonnegative(),
});
export type CycleEpoch = z.infer<typeof cycleEpochSchema>;

// ─── cycle_trial ────────────────────────────────────────────────────────────

export const cycleTrialSchema = cycleEnvelopeSchema.extend({
  trial: z.number().int().nonnegative(),
  trialCount: z.number().int().positive(),
  state: z.enum(["running", "complete", "pruned", "failed"]),
  parameters: z.record(z.union([z.number(), z.string(), z.boolean()])),
  objectiveName: z.enum(["sharpe_ratio", "log_loss", "f1_score"]),
  objectiveValue: nullableNumber,
  bestValue: nullableNumber,
  bestTrial: z.number().int().nonnegative().nullable(),
});
export type CycleTrial = z.infer<typeof cycleTrialSchema>;

// ─── cycle_trade ────────────────────────────────────────────────────────────

export const cycleTradeSchema = cycleEnvelopeSchema.extend({
  tradeNumber: z.number().int().positive(),
  foldIndex: z.number().int().nonnegative(),
  side: z.enum(["long", "short"]),
  status: z.enum(["open", "closed"]),
  contracts: z.number().int().positive(),
  entryTimestamp: epochSeconds,
  entryPrice: z.number(),
  exitTimestamp: epochSeconds.nullable(),
  exitPrice: nullableNumber,
  barsHeld: z.number().int().nonnegative(),
  probabilityUpAtEntry: z.number().min(0).max(1),
  grossProfitUsd: nullableNumber,
  costUsd: nullableNumber,
  netProfitUsd: nullableNumber,
  exitReason: z.enum(["holding_period", "opposite_signal", "stop_loss", "take_profit", "fold_end", "stopped"]).nullable(),
});
export type CycleTrade = z.infer<typeof cycleTradeSchema>;

// ─── cycle_scoreboard ───────────────────────────────────────────────────────

/** Every metric the scoreboard carries, in display order. */
export const CYCLE_METRIC_NAMES = [
  "net_profit_usd",
  "sharpe_ratio",
  "sortino_ratio",
  "calmar_ratio",
  "maximum_drawdown_usd",
  "profit_factor",
  "win_rate",
  "trade_count",
  "average_trade_usd",
  "expectancy_usd",
  "exposure_fraction",
  "gross_profit_usd",
  "gross_loss_usd",
  "total_cost_usd",
  "accuracy",
  "balanced_accuracy",
  "precision",
  "recall",
  "f1_score",
  "macro_f1_score",
  "roc_auc",
  "log_loss",
  "brier_score",
  "majority_class_accuracy",
  "buy_and_hold_net_profit_usd",
  "price_forecast_mean_absolute_error_points",
  "persistence_mean_absolute_error_points",
  "price_forecast_skill",
  "price_forecast_root_mean_square_error_points",
  "price_forecast_direction_accuracy",
] as const;
export type CycleMetricName = (typeof CYCLE_METRIC_NAMES)[number];

export const cycleDistributionSchema = z.object({
  count: z.number().int().nonnegative(),
  mean: nullableNumber,
  median: nullableNumber,
  standardDeviation: nullableNumber,
  skewness: nullableNumber,
  kurtosis: nullableNumber,
  percentile25: nullableNumber,
  percentile75: nullableNumber,
  minimum: nullableNumber,
  maximum: nullableNumber,
});
export type CycleDistribution = z.infer<typeof cycleDistributionSchema>;

export const cycleScoreboardSchema = cycleEnvelopeSchema.extend({
  scope: z.enum(["running", "fold", "final"]),
  foldIndex: z.number().int().nonnegative().nullable(),
  /** Test bars walked so far in this scope. */
  barsEvaluated: z.number().int().nonnegative(),
  /** Of those, bars whose label is known and outside the threshold (the classification denominator). */
  barsScored: z.number().int().nonnegative(),
  metrics: z.record(nullableNumber),
  /** Eight-number summary of closed-trade net profit in USD. */
  tradeDistribution: cycleDistributionSchema,
  notes: z.array(z.string()),
});
export type CycleScoreboard = z.infer<typeof cycleScoreboardSchema>;

// ─── Event registry ─────────────────────────────────────────────────────────

export const CYCLE_EVENT_SCHEMAS = {
  cycle_plan: cyclePlanSchema,
  cycle_bars: cycleBarsSchema,
  cycle_cursor: cycleCursorSchema,
  cycle_epoch: cycleEpochSchema,
  cycle_trial: cycleTrialSchema,
  cycle_trade: cycleTradeSchema,
  cycle_scoreboard: cycleScoreboardSchema,
} as const;

export type CycleEventType = keyof typeof CYCLE_EVENT_SCHEMAS;
export const CYCLE_EVENT_TYPES = Object.keys(CYCLE_EVENT_SCHEMAS) as CycleEventType[];

export interface CycleEventPayloads {
  cycle_plan: CyclePlan;
  cycle_bars: CycleBars;
  cycle_cursor: CycleCursor;
  cycle_epoch: CycleEpoch;
  cycle_trial: CycleTrial;
  cycle_trade: CycleTrade;
  cycle_scoreboard: CycleScoreboard;
}

export function isCycleEventType(type: string): type is CycleEventType {
  return Object.prototype.hasOwnProperty.call(CYCLE_EVENT_SCHEMAS, type);
}

// ─── Control (stdin) ────────────────────────────────────────────────────────

export const cycleControlSchema = z.discriminatedUnion("command", [
  z.object({ command: z.literal("pause") }),
  z.object({ command: z.literal("resume") }),
  z.object({ command: z.literal("pace"), barsPerSecond: z.number().min(0).max(100000) }),
  z.object({ command: z.literal("stop") }),
]);
export type CycleControl = z.infer<typeof cycleControlSchema>;

// ─── Snapshot (GET /api/training/cycle/:modelId) ────────────────────────────

export type CycleRunStatus = "running" | "complete" | "failed" | "stopped";

/** Columnar bar store; every column has one entry per bar, in timestamp order. */
export interface CycleBarColumns {
  timestamps: number[];
  open: number[];
  high: number[];
  low: number[];
  close: number[];
  volume: number[];
  role: CycleBarRole[];
  foldIndex: (number | null)[];
  probabilityUp: (number | null)[];
  predictedDirection: (1 | 0 | -1 | null)[];
  position: (1 | 0 | -1 | null)[];
  equityUsd: (number | null)[];
  predictedClose: (number | null)[];
  forecastTimestamp: (number | null)[];
  actualDirection: (1 | 0 | -1 | null)[];
  correct: (boolean | null)[];
}

export interface CycleLogLine {
  seq: number | null;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  receivedAt: number;
}

export interface CycleSnapshot {
  modelId: string;
  modelType: string;
  status: CycleRunStatus;
  startedAt: number;
  finishedAt: number | null;
  error: string | null;
  /** Highest envelope `seq` folded into this snapshot. */
  lastSequence: number;
  plan: CyclePlan | null;
  cursor: CycleCursor | null;
  bars: CycleBarColumns;
  trades: CycleTrade[];
  scoreboards: { running: CycleScoreboard | null; folds: CycleScoreboard[]; final: CycleScoreboard | null };
  epochs: CycleEpoch[];
  trials: CycleTrial[];
  logs: CycleLogLine[];
}

export interface CycleRunSummary {
  modelId: string;
  modelType: string;
  symbol: string | null;
  timeframe: string | null;
  modelFamily: CycleModelFamily | null;
  status: CycleRunStatus;
  startedAt: number;
  finishedAt: number | null;
  barCount: number;
  tradeCount: number;
}

export function emptyBarColumns(): CycleBarColumns {
  return {
    timestamps: [],
    open: [],
    high: [],
    low: [],
    close: [],
    volume: [],
    role: [],
    foldIndex: [],
    probabilityUp: [],
    predictedDirection: [],
    position: [],
    equityUsd: [],
    predictedClose: [],
    forecastTimestamp: [],
    actualDirection: [],
    correct: [],
  };
}

/**
 * Append a `cycle_bars` event to a column store IN PLACE. Shared by the server
 * accumulator and the client store so both hold identical bars.
 *
 * Bars must arrive in strictly increasing time; a bar at or before the last
 * stored timestamp is skipped (a replayed event), never inserted out of order.
 * `resolved` labels are written onto bars already in the store.
 *
 * Returns the number of bars appended.
 */
export function appendBars(columns: CycleBarColumns, event: CycleBars): number {
  let appended = 0;
  let last = columns.timestamps.length > 0 ? columns.timestamps[columns.timestamps.length - 1]! : -Infinity;
  const processed = event.role === "processed";
  for (let i = 0; i < event.timestamps.length; i += 1) {
    const t = event.timestamps[i]!;
    if (t <= last) continue;
    last = t;
    columns.timestamps.push(t);
    columns.open.push(event.open[i]!);
    columns.high.push(event.high[i]!);
    columns.low.push(event.low[i]!);
    columns.close.push(event.close[i]!);
    columns.volume.push(event.volume[i]!);
    columns.role.push(event.role);
    columns.foldIndex.push(event.foldIndex);
    columns.probabilityUp.push(processed ? (event.probabilityUp?.[i] ?? null) : null);
    columns.predictedDirection.push(processed ? (event.predictedDirection?.[i] ?? null) : null);
    columns.position.push(processed ? (event.position?.[i] ?? null) : null);
    columns.equityUsd.push(processed ? (event.equityUsd?.[i] ?? null) : null);
    columns.predictedClose.push(processed ? (event.predictedClose?.[i] ?? null) : null);
    columns.forecastTimestamp.push(processed ? (event.forecastTimestamp?.[i] ?? null) : null);
    columns.actualDirection.push(null);
    columns.correct.push(null);
    appended += 1;
  }
  if (event.resolved) {
    const { timestamps, actualDirection, correct } = event.resolved;
    for (let i = 0; i < timestamps.length; i += 1) {
      const index = findBarIndex(columns.timestamps, timestamps[i]!);
      if (index >= 0) {
        columns.actualDirection[index] = actualDirection[i]!;
        columns.correct[index] = correct[i]!;
      }
    }
  }
  return appended;
}

/** Binary search for an exact bar timestamp; -1 when absent. */
export function findBarIndex(timestamps: readonly number[], target: number): number {
  let low = 0;
  let high = timestamps.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const value = timestamps[middle]!;
    if (value === target) return middle;
    if (value < target) low = middle + 1;
    else high = middle - 1;
  }
  return -1;
}
