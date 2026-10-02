/**
 * Model Lens — the contract every layer codes against.
 *
 * The lens turns a trained model's out-of-sample record into the views that
 * make it inspectable instead of a black box: prediction + interval on price,
 * simulated trades and equity, rolling stability, prediction vs reality,
 * direction confusion, feature attribution by family, regimes, return
 * distributions and step-by-step playback.
 *
 * Layers:
 *   1. Python builder  (packages/ml-engine/src/lens)       artifact -> data/models/<id>/lens/{manifest.json,bars.parquet,attribution.parquet}
 *   2. Shared compute  (packages/shared/src/lens)   LensSeries + params -> LensEvaluation / LensBarWindow   (pure, no I/O)
 *   3. Node server     (apps/api/lens)   parquet -> LensSeries (DuckDB), HTTP, build spawn
 *   4. Client          (apps/web/src/lens)
 *
 * Rules that bind every layer:
 *   - Causal only. A value shown at bar t uses information available at t.
 *     realized returns at row s are known only at row s + horizonBars.
 *   - Unknown is null, never 0. Warmup rows carry null.
 *   - Every metric travels with its n and, where it is an estimate, its CI.
 *   - Row-index semantics: "t + H" means H rows later in the model's own
 *     ordered record, exactly as the model's evaluator counted it — not H
 *     wall-clock bars (sessions have gaps).
 */

// ─── Source artifacts ────────────────────────────────────────────────────────

/**
 * How the builder read the model's out-of-sample record.
 *  - probability_parquet : oos_predictions.parquet with (ts, prob_up, label, realized_return_bp)
 *                          — hand-written xgb_classifier writer. Newer runs of it score H BARS
 *                          ahead on the raw bar grid, so their record is laid on the lake's bars
 *                          and a bar with no prediction carries a NaN probability (never trades).
 *  - ohlc_probability_npz: oos_predictions.npz with (timestamps, open, high, low, close, probs, labels)
 *                          — cnn_transformer writer.
 *  - class_confidence_parquet: oos_predictions.parquet with (timestamp, symbol, prediction,
 *                          confidence[, probability_up, label]) — what every generated template
 *                          writes. Prices for these come from the lake, joined on the bar second.
 *  - cycle_run           : a Model Cycle run directory — predictions.parquet (every test bar with
 *                          its prices, P(up), fold and resolved direction) + config.json (label
 *                          horizon, cost model, trading rule). Read by packages/ml-engine/src/lens/runs.py; the
 *                          direction scoreboard matches the run's, the trades follow the lens rule.
 */
export type LensSourceSchema = "probability_parquet" | "ohlc_probability_npz" | "class_confidence_parquet" | "cycle_run";

/** ready: lens built and current. stale: source artifacts changed since build. */
export type LensModelStatus = "ready" | "stale" | "not_built" | "refused" | "failed";

export interface LensAvailability {
  available: boolean;
  /** Plain-words reason when not available ("no SHAP artifact for this model"). */
  reason?: string;
}

export type LensViewKey =
  | "prediction"
  | "trades"
  | "rolling"
  | "scatter"
  | "confusion"
  | "attribution"
  | "regime"
  | "equity"
  | "distribution"
  | "playback";

// ─── Manifest (written by the Python builder) ────────────────────────────────

export interface LensVerificationCheck {
  /** snake_case identifier, e.g. "rescore_probability_max_absolute_difference". */
  name: string;
  passed: boolean;
  /** Human-readable measured value with units. */
  measured: string;
  /** Human-readable expectation / tolerance. */
  expected: string;
}

export type LensFeatureFamilyKey = "momentum" | "volatility" | "volume" | "price_structure" | "macro";

export interface LensFeatureFamily {
  family: LensFeatureFamilyKey;
  /** Display label, e.g. "Momentum". */
  label: string;
  /** Feature names in this family, in the model's feature order. Empty for "macro" when none exist. */
  features: string[];
  /** packages/config/features.json categories folded into this family. */
  sourceCategories: string[];
}

/**
 * Fixed family mapping (features.json category -> family). Shared so the
 * builder, server and UI legend cannot disagree.
 */
export const LENS_FAMILY_CATEGORIES: Record<LensFeatureFamilyKey, string[]> = {
  momentum: ["returns", "momentum", "ma_distance"],
  volatility: ["volatility", "parkinson"],
  volume: ["volume"],
  price_structure: ["price_structure", "anatomy", "microstructure", "swing", "mean_reversion"],
  macro: [],
};

export const LENS_FAMILY_LABELS: Record<LensFeatureFamilyKey, string> = {
  momentum: "Momentum",
  volatility: "Volatility",
  volume: "Volume",
  price_structure: "Price structure",
  macro: "Macro",
};

export interface LensManifest {
  modelId: string;
  builderVersion: number;
  builtAtIso: string;
  sourceSchema: LensSourceSchema;
  sourceFiles: Array<{ path: string; sha256: string; bytes: number; modifiedAtIso: string }>;
  symbol: string;
  timeframe: string;
  barSeconds: number;
  /** Forward horizon in rows the model predicts over. */
  horizonBars: number;
  /** Where horizonBars came from, e.g. "checkpoint.json params.label_horizon_bars". */
  horizonSource: string;
  /** Plain words: what the label means. */
  labelDefinition: string;
  /** The threshold the model's own evaluator used (e.g. pnl_threshold 0.55). */
  defaultThreshold: number;
  cost: {
    roundTripPoints: number;
    pointValueUsd: number;
    tickSize: number;
    /** e.g. "packages/config/cost_model.json MNQ". */
    source: string;
  };
  barCount: number;
  firstTimestampSeconds: number;
  lastTimestampSeconds: number;
  /** Causal conformal mapping probability_up -> forward return quantiles. */
  interval: {
    method: string;
    binCount: number;
    recalibrationStepBars: number;
    historyBars: number;
    minimumBinObservations: number;
    /** Always [0.05, 0.10, 0.25, 0.50, 0.75, 0.90, 0.95]. */
    quantiles: number[];
    /** Rows with a non-null interval. */
    coveredBarCount: number;
  };
  attribution: LensAvailability & {
    method?: string;
    featureCount?: number;
    families?: LensFeatureFamily[];
  };
  /**
   * Reference numbers from the model's own diagnostics.json, used by the
   * shared compute parity checks. Null fields = the artifact does not carry it.
   */
  reference: {
    tradeCount: number | null;
    cumulativeNetUsd: number | null;
    longCount: number | null;
    shortCount: number | null;
    hitRateAtHalf: number | null;
    areaUnderCurve: number | null;
  };
  verification: LensVerificationCheck[];
  /**
   * Bar-to-bar price jumps across a break in trading, in an unadjusted
   * front-month series: a contract roll pricing in carry (kind
   * "date_boundary") or a weekend/holiday reopen ("session_gap"). Buy-and-hold
   * contains every one of them, and so does any trade held across one.
   */
  priceDiscontinuities?: Array<{
    rowIndex: number;
    timestampSeconds: number;
    gapPoints: number;
    hoursClosed: number;
    kind: "date_boundary" | "session_gap";
  }>;
  /** Model-authored notes (e.g. deprecation) and builder caveats. */
  notes: string[];
}

// ─── Parquet tables (column names are the on-disk contract) ──────────────────

/**
 * data/models/<id>/lens/bars.parquet — one row per out-of-sample record, ordered by row_index.
 *   row_index                                   INT32   0..n-1, the model's record order
 *   timestamp_seconds                           INT64   bar open, epoch seconds UTC
 *   open, high, low, close                      DOUBLE  the prices the model's evaluator used
 *   volume                                      DOUBLE  nullable
 *   probability_up                              FLOAT
 *   label                                       TINYINT nullable (0/1)
 *   realized_return_basis_points                FLOAT   nullable; ln(close[row+H]/close[row])*1e4
 *   predicted_return_quantile_05_basis_points   FLOAT   nullable (warmup)
 *   predicted_return_quantile_10_basis_points   FLOAT   nullable
 *   predicted_return_quantile_25_basis_points   FLOAT   nullable
 *   predicted_return_quantile_50_basis_points   FLOAT   nullable
 *   predicted_return_quantile_75_basis_points   FLOAT   nullable
 *   predicted_return_quantile_90_basis_points   FLOAT   nullable
 *   predicted_return_quantile_95_basis_points   FLOAT   nullable
 *
 * data/models/<id>/lens/attribution.parquet — long form, only when SHAP exists.
 *   row_index        INT32
 *   feature_name     VARCHAR
 *   feature_family   VARCHAR  (LensFeatureFamilyKey)
 *   shap_value       FLOAT    contribution to the log-odds of up
 *   feature_value    FLOAT    the value the model scored on (post-normalisation)
 */
export const LENS_QUANTILE_LEVELS = [0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95] as const;
export const LENS_QUANTILE_COLUMNS = [
  "predicted_return_quantile_05_basis_points",
  "predicted_return_quantile_10_basis_points",
  "predicted_return_quantile_25_basis_points",
  "predicted_return_quantile_50_basis_points",
  "predicted_return_quantile_75_basis_points",
  "predicted_return_quantile_90_basis_points",
  "predicted_return_quantile_95_basis_points",
] as const;

// ─── In-memory series (server loads parquet into this) ───────────────────────

/** Columnar, typed. NaN encodes null for floats; -1 encodes null label. */
export interface LensSeries {
  modelId: string;
  length: number;
  timestampSeconds: Float64Array;
  open: Float64Array;
  high: Float64Array;
  low: Float64Array;
  close: Float64Array;
  volume: Float64Array;
  probabilityUp: Float32Array;
  label: Int8Array;
  realizedReturnBasisPoints: Float32Array;
  /** 7 arrays in LENS_QUANTILE_LEVELS order. */
  predictedQuantilesBasisPoints: Float32Array[];
  horizonBars: number;
  cost: LensManifest["cost"];
}

/** Long-form attribution loaded into columnar arrays, rows aligned to LensSeries. */
export interface LensAttributionSeries {
  featureNames: string[];
  featureFamilies: LensFeatureFamilyKey[];
  /** shap[featureIndex][rowIndex] */
  shap: Float32Array[];
  /** value[featureIndex][rowIndex] */
  value: Float32Array[];
}

// ─── Evaluation parameters (the dashboard's controls) ────────────────────────

export type LensIntervalCoverage = 0.5 | 0.8 | 0.9;

export interface LensEvaluationParams {
  /** Long when probability_up >= threshold, short when <= 1 - threshold. 0.5..0.95. */
  threshold: number;
  /** Multiplies the round-trip cost. 0..3. */
  costMultiplier: number;
  /** Prediction-level rolling window, in rows. */
  rollingWindowBars: number;
  /** Trade-level rolling window, in trades. */
  rollingWindowTrades: number;
  /** Regime lookback N, in rows. */
  regimeLookbackBars: number;
  /** Regime threshold k, in trailing-volatility units. */
  regimeThreshold: number;
  intervalCoverage: LensIntervalCoverage;
  /** Optional evaluation window (inclusive), epoch seconds. Omitted = full record. */
  startTimestampSeconds?: number;
  endTimestampSeconds?: number;
}

export const LENS_PARAM_BOUNDS = {
  threshold: { min: 0.5, max: 0.95, step: 0.005 },
  costMultiplier: { min: 0, max: 3, step: 0.05 },
  rollingWindowBars: { min: 20, max: 20000, step: 10 },
  rollingWindowTrades: { min: 10, max: 2000, step: 5 },
  regimeLookbackBars: { min: 10, max: 5000, step: 5 },
  regimeThreshold: { min: 0.25, max: 3, step: 0.05 },
} as const;

// ─── Evaluation result ───────────────────────────────────────────────────────

/** Point estimate with a 95% interval and the n it rests on. */
export interface LensEstimate {
  value: number | null;
  ciLow: number | null;
  ciHigh: number | null;
  n: number;
  /** "block bootstrap, 1000 resamples, block 7" / "normal approx, n_eff = n / H". */
  method: string;
}

export interface LensEightNumberSummary {
  count: number;
  mean: number | null;
  median: number | null;
  standardDeviation: number | null;
  skewness: number | null;
  /** Excess kurtosis. null when count < 4. */
  kurtosis: number | null;
  percentile25: number | null;
  percentile75: number | null;
  minimum: number | null;
  maximum: number | null;
}

export type LensRegime = "bull" | "bear" | "sideways";

export interface LensTrade {
  entryRowIndex: number;
  exitRowIndex: number;
  entryTimestampSeconds: number;
  exitTimestampSeconds: number;
  direction: 1 | -1;
  entryPrice: number;
  exitPrice: number;
  probabilityUp: number;
  grossUsd: number;
  netUsd: number;
  cumulativeNetUsd: number;
  /** Regime at entry (causal), null during regime warmup. */
  regime: LensRegime | null;
}

export interface LensHeadline {
  barCount: number;
  /** barCount / horizonBars — overlapping labels. */
  effectiveSampleSize: number;
  tradeCount: number;
  longCount: number;
  shortCount: number;
  /** Direction hit rate at 0.5 over labelled rows. */
  hitRate: LensEstimate;
  /** Share of taken trades with net PnL > 0. */
  winRate: LensEstimate;
  profitFactor: LensEstimate;
  meanTradeNetUsd: LensEstimate;
  totalNetUsd: number;
  buyHoldNetUsd: number | null;
  maxDrawdownUsd: number;
  areaUnderCurve: number | null;
  brierScore: number | null;
  /** Share of rows the simulated strategy held a position. */
  exposureShare: number;
  /** One plain-words sentence: what the numbers say, with the CI. */
  verdict: string;
}

export interface LensEquityPoint {
  timestampSeconds: number;
  rowIndex: number;
  /** Realised + mark-to-market, net of cost. */
  modelCumulativeUsd: number;
  buyHoldCumulativeUsd: number | null;
  modelDrawdownUsd: number;
  /** 1 long, -1 short, 0 flat. */
  position: 1 | 0 | -1;
}

export interface LensRollingPoint {
  timestampSeconds: number;
  rowIndex: number;
  hitRate: number | null;
  brierScore: number | null;
  logLoss: number | null;
  /** Rows with a label inside the window. */
  labelledCount: number;
}

export interface LensRollingTradePoint {
  timestampSeconds: number;
  tradeIndex: number;
  meanNetUsd: number | null;
  winRate: number | null;
  sharpe: number | null;
}

export interface LensDriftAlarm {
  timestampSeconds: number;
  tradeIndex: number;
  /** Page-Hinkley statistic at the alarm. */
  statistic: number;
  direction: "deterioration" | "improvement";
}

export interface LensRolling {
  windowBars: number;
  windowTrades: number;
  /** windowBars / horizonBars. */
  effectiveSampleSizePerWindow: number;
  /** Coin-flip 95% band for rolling hit rate using n_eff. */
  nullBand: { lower: number; upper: number };
  points: LensRollingPoint[];
  tradePoints: LensRollingTradePoint[];
  drift: {
    method: string;
    delta: number;
    lambda: number;
    alarms: LensDriftAlarm[];
  };
  /** True when points were bucketed for transport. */
  downsampled: boolean;
}

export interface LensScatterPoint {
  rowIndex: number;
  probabilityUp: number;
  predictedReturnBasisPoints: number | null;
  realizedReturnBasisPoints: number;
}

export interface LensDecile {
  decile: number;
  probabilityLow: number;
  probabilityHigh: number;
  count: number;
  upRate: number | null;
  meanRealizedBasisPoints: LensEstimate;
  meanPredictedBasisPoints: number | null;
}

export interface LensScatter {
  points: LensScatterPoint[];
  sampled: boolean;
  /** Deciles by rank of probability_up. */
  deciles: LensDecile[];
  /** realized = intercept + slope * predicted, over rows with both. */
  fit: {
    n: number;
    bias: LensEstimate;
    slope: number | null;
    intercept: number | null;
    residualStandardDeviationBasisPoints: number | null;
    rSquared: number | null;
  } | null;
  /** Classification reliability: equal-width probability bins. */
  reliability: Array<{
    binLow: number;
    binHigh: number;
    count: number;
    meanProbability: number | null;
    observedUpRate: number | null;
  }>;
}

export interface LensConfusionCounts {
  truePositive: number;
  falsePositive: number;
  trueNegative: number;
  falseNegative: number;
}

export interface LensConfusionBlock {
  counts: LensConfusionCounts;
  n: number;
  precisionUp: number | null;
  recallUp: number | null;
  precisionDown: number | null;
  recallDown: number | null;
  accuracy: LensEstimate;
}

export interface LensConfusion {
  /** Every labelled row, predicted up when probability_up >= 0.5. */
  allRows: LensConfusionBlock;
  /** Only rows whose conviction clears the threshold (up >= t, down <= 1 - t). */
  gatedRows: LensConfusionBlock;
  winRate: LensEstimate;
  /** Why win rate and precision differ, with this model's numbers filled in. */
  explanation: string;
}

export interface LensRegimeSegment {
  startTimestampSeconds: number;
  endTimestampSeconds: number;
  startRowIndex: number;
  endRowIndex: number;
  regime: LensRegime | null;
}

export interface LensRegimePerformance {
  regime: LensRegime;
  barCount: number;
  tradeCount: number;
  hitRate: LensEstimate;
  meanTradeNetUsd: LensEstimate;
  profitFactor: number | null;
  totalNetUsd: number;
}

export interface LensRegimes {
  lookbackBars: number;
  threshold: number;
  definition: string;
  segments: LensRegimeSegment[];
  share: Record<LensRegime, number>;
  performance: LensRegimePerformance[];
}

export interface LensDistribution {
  realized: LensEightNumberSummary;
  /** Conformal median forward return. null when the interval is unavailable. */
  predicted: LensEightNumberSummary | null;
  histogram: {
    edgesBasisPoints: number[];
    realizedCounts: number[];
    predictedCounts: number[] | null;
  };
  /** Coverage of the selected interval against realized returns. */
  tailCoverage: {
    coverage: LensIntervalCoverage;
    nominalOutsideShare: number;
    observedOutsideShare: number;
    belowLowerShare: number;
    aboveUpperShare: number;
    n: number;
  } | null;
  /** Mean interval width per probability decile — flat widths expose "confidence theatre". */
  intervalWidthByDecile: Array<{ decile: number; meanWidthBasisPoints: number | null; count: number }>;
}

export interface LensAttribution extends LensAvailability {
  families: Array<{
    family: LensFeatureFamilyKey;
    label: string;
    featureCount: number;
    meanAbsoluteShap: number;
    share: number;
    features: string[];
  }>;
  features: Array<{
    name: string;
    family: LensFeatureFamilyKey;
    meanAbsoluteShap: number;
    rank: number;
  }>;
  /** Signed family contribution per (bucketed) time step. */
  timeline: Array<{
    timestampSeconds: number;
    contributions: Record<LensFeatureFamilyKey, number>;
  }>;
  /** Top features: sampled (shap, feature value) pairs. */
  beeswarm: Array<{
    feature: string;
    family: LensFeatureFamilyKey;
    /** featureValue is null when the artifact stores contributions without the values behind them. */
    points: Array<{ shap: number; featureValue: number | null }>;
  }>;
}

export interface LensEvaluation {
  modelId: string;
  params: LensEvaluationParams;
  range: {
    firstRowIndex: number;
    lastRowIndex: number;
    firstTimestampSeconds: number;
    lastTimestampSeconds: number;
    barCount: number;
  };
  headline: LensHeadline;
  trades: LensTrade[];
  /** True when trades were capped for transport (headline still covers all). */
  tradesTruncated: boolean;
  equity: LensEquityPoint[];
  equityDownsampled: boolean;
  rolling: LensRolling;
  scatter: LensScatter;
  confusion: LensConfusion;
  regimes: LensRegimes;
  distribution: LensDistribution;
  attribution: LensAttribution;
  availability: Record<LensViewKey, LensAvailability>;
  /** Shared-compute parity checks against manifest.reference (default params only). */
  verification: LensVerificationCheck[];
}

// ─── Bar window (price chart + playback) ─────────────────────────────────────

export type LensDecision = "enter_long" | "enter_short" | "hold" | "exit" | "flat" | "skip";

export interface LensBar {
  rowIndex: number;
  timestampSeconds: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
  /** null on a bar the model made no prediction for (it never trades there). */
  probabilityUp: number | null;
  label: 0 | 1 | null;
  realizedReturnBasisPoints: number | null;
  /** LENS_QUANTILE_LEVELS order; null in warmup. */
  predictedQuantilesBasisPoints: number[] | null;
  /** Interval for the selected coverage, as prices for row + H. */
  intervalLowerPrice: number | null;
  intervalUpperPrice: number | null;
  intervalMedianPrice: number | null;
  regime: LensRegime | null;
  /** What the simulated strategy did at this row. */
  decision: LensDecision;
  position: 1 | 0 | -1;
  /** Mark-to-market change of the open position into this row, net of cost at entry. */
  barPnlUsd: number;
  cumulativeNetUsd: number;
}

/**
 * Row window for GET /bars, inclusive. Query keys: startRowIndex, endRowIndex,
 * maxBars (<= LENS_MAX_WINDOW_BARS), alongside the LensEvaluationParams keys.
 * Derived per-bar state (regime, decision, position, PnL) is computed over the
 * FULL record and then sliced, so a window never restarts a trade or a regime.
 */
export interface LensRowWindow {
  startRowIndex: number;
  endRowIndex: number;
}

export const LENS_MAX_WINDOW_BARS = 5000;

export interface LensBarWindow {
  modelId: string;
  params: LensEvaluationParams;
  rowWindow: LensRowWindow;
  bars: LensBar[];
  totalBarsInRange: number;
  truncated: boolean;
  /** Present only when attribution exists; arrays aligned to `bars`. */
  features: {
    names: string[];
    families: LensFeatureFamilyKey[];
    /** values[barIndex][featureIndex] */
    values: Array<Array<number | null>>;
    /** shap[barIndex][featureIndex] */
    shap: Array<Array<number | null>>;
  } | null;
}

// ─── Model list ──────────────────────────────────────────────────────────────

export interface LensModelEntry {
  modelId: string;
  status: LensModelStatus;
  reason?: string;
  sourceSchema: LensSourceSchema | null;
  symbol: string | null;
  timeframe: string | null;
  barCount: number | null;
  firstTimestampSeconds: number | null;
  lastTimestampSeconds: number | null;
  /** Another model whose prediction artifact is byte-identical (sha256). */
  duplicateOf: string | null;
  notes: string[];
  /** Headline at default params when status is ready. */
  headline: LensHeadline | null;
}

export interface LensModelList {
  models: LensModelEntry[];
}

export const LENS_BUILDER_VERSION = 1;

// ─── Parameter defaults + transport ──────────────────────────────────────────

/**
 * Defaults are fixed a priori, never tuned on the record being evaluated:
 * the model's own evaluator threshold, full cost, a rolling window holding
 * 20 independent horizons, and a 50-row / 1.0-sigma regime rule.
 */
export function defaultLensParams(manifest: Pick<LensManifest, "defaultThreshold" | "horizonBars">): LensEvaluationParams {
  const b = LENS_PARAM_BOUNDS;
  return {
    threshold: manifest.defaultThreshold,
    costMultiplier: 1,
    rollingWindowBars: Math.min(b.rollingWindowBars.max, Math.max(100, 20 * manifest.horizonBars)),
    rollingWindowTrades: 30,
    regimeLookbackBars: 50,
    regimeThreshold: 1,
    intervalCoverage: 0.9,
  };
}

const PARAM_KEYS = [
  "threshold",
  "costMultiplier",
  "rollingWindowBars",
  "rollingWindowTrades",
  "regimeLookbackBars",
  "regimeThreshold",
  "intervalCoverage",
  "startTimestampSeconds",
  "endTimestampSeconds",
] as const satisfies ReadonlyArray<keyof LensEvaluationParams>;

/** Query-string keys are exactly the LensEvaluationParams field names. */
export function lensParamsToSearch(params: LensEvaluationParams, extra: Record<string, string | number> = {}): string {
  const search = new URLSearchParams();
  for (const key of PARAM_KEYS) {
    const value = params[key];
    if (value !== undefined && value !== null) search.set(key, String(value));
  }
  for (const [key, value] of Object.entries(extra)) search.set(key, String(value));
  return search.toString();
}
