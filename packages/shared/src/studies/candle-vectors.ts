/**
 * MNQ candle vectors: the body of GET /api/studies/candle-vectors, one shape
 * per `section`, and the small pure computations the page and the handler
 * share (the 64-number shape vector, the recogniser's confusion at a
 * threshold, the headline tiles, the neighbours' mean path).
 *
 * Replaced datalake/notebooks/mnq_candle_vectors.py. Its results tables were
 * landed as `derived_study_candle_vectors_<table>` by
 * packages/ml-engine/src/studies/candle_vectors/build.py; the candle windows and next-candle
 * rows come from the round's own datasets, `derived_mnq_candle_windows_<tf>`
 * and `derived_mnq_next_candles_<tf>`.
 */

// ---------------------------------------------------------------------------
// Vocabulary shared by the handler's Zod query and the page's controls
// ---------------------------------------------------------------------------

export const PATTERNS = [
  "hammer", "shooting_star", "bullish_engulfing", "bearish_engulfing", "bullish_harami", "bearish_harami", "doji",
] as const;
export type PatternName = (typeof PATTERNS)[number];

/** Pattern name -> (candle-window column, which sign fires it; 0 = any non-zero). The notebook's firing_mask. */
export const PATTERN_FIRING: Record<PatternName, { column: string; sign: -1 | 0 | 1; claimed: "up" | "down" | null }> = {
  hammer: { column: "candlestick_hammer", sign: 1, claimed: "up" },
  shooting_star: { column: "candlestick_shootingstar", sign: -1, claimed: "down" },
  bullish_engulfing: { column: "candlestick_engulfing", sign: 1, claimed: "up" },
  bearish_engulfing: { column: "candlestick_engulfing", sign: -1, claimed: "down" },
  bullish_harami: { column: "candlestick_harami", sign: 1, claimed: "up" },
  bearish_harami: { column: "candlestick_harami", sign: -1, claimed: "down" },
  doji: { column: "candlestick_doji", sign: 0, claimed: null },
};

export const VECTOR_TIMEFRAMES = ["1m", "1h", "4h"] as const;
export type VectorTimeframe = (typeof VECTOR_TIMEFRAMES)[number];
export const NEXT_TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h"] as const;
export type NextTimeframe = (typeof NEXT_TIMEFRAMES)[number];
export const HORIZONS = [1, 4, 12] as const;
export const COMPONENTS = ["open", "high", "low", "close"] as const;
export type Component = (typeof COMPONENTS)[number];
export const WINDOW_BARS = 16;
export const AVERAGE_RANGE_BARS = 10;
/** Bars of forward path stored per timeframe (candle_vectors.FORWARD_PATH_BARS). */
export const FORWARD_PATH_BARS: Record<VectorTimeframe, number> = { "1m": 30, "1h": 24, "4h": 24 };
/** Beyond this many average ranges a coordinate is treated as this many (candle_vectors.SHAPE_CLIP_AVERAGE_RANGES). */
export const SHAPE_CLIP_AVERAGE_RANGES = 10;

export const RECOGNIZER_MODELS = ["neural network", "gradient-boosted trees", "logistic regression"] as const;
export const EVALUATION_SETS = ["1m 2025 (held out)", "1h 2021-2025 (never seen)", "4h 2021-2025 (never seen)"] as const;
export const MAP_PROJECTIONS = ["the recogniser's 32 internal numbers", "the 64 window numbers"] as const;
export const SHAPE_MODELS = [
  "last-three-candle autoencoder", "last-three-candle vector-quantised", "autoencoder", "vector-quantised", "masked candles",
] as const;
export const SHAPE_MODEL_CANDLES: Record<(typeof SHAPE_MODELS)[number], number> = {
  "last-three-candle autoencoder": 3, "last-three-candle vector-quantised": 3, autoencoder: 16, "vector-quantised": 16, "masked candles": 16,
};
/** Hidden-candle sets the masked-candle model was run with in build.py (bars back, comma separated). */
export const MASKED_PRESETS = [
  ...Array.from({ length: 16 }, (_, k) => String(k)), "0,1", "0,1,2", "0,1,2,3", "1,2,3",
] as const;
/** Firings of each pattern (in time order) that have every masked preset; later firings have hidden = "0" only. */
export const MASKED_PRESET_FIRINGS = 100;
export const VOCABULARIES = ["last-three-candle vector-quantised", "vector-quantised"] as const;
export const EMBEDDING_METHODS = [
  "last-three-candle autoencoder (8)", "last-three-candle vector-quantised encoder (8)", "PCA of the last three candles to 8 numbers",
  "autoencoder (16)", "vector-quantised encoder (16)", "masked-candle model (16)", "PCA to 16 numbers",
] as const;
export const NEXT_FAMILIES = ["TA-Lib pattern", "three-candle shape code", "whole-window shape code"] as const;
export const NEXT_SPLITS = ["discovery", "validation", "holdout"] as const;

export const SECTIONS = [
  "overview", "anatomy", "map", "recogniser", "neighbours", "paths", "evaluation", "vectorStore", "columns",
  "learned", "learnedMap", "reconstruction", "nextSummary", "nextPattern", "nextTrades",
] as const;
export type Section = (typeof SECTIONS)[number];

// ---------------------------------------------------------------------------
// Row shapes (column names as landed)
// ---------------------------------------------------------------------------

type Numberish = number | null;

export interface RecognizerMetricRow {
  model_name: string; pattern: string; evaluation_set: string; timeframe: string;
  window_count: number; pattern_count: number; prevalence: Numberish; area_under_roc_curve: Numberish;
  average_precision: Numberish; threshold: Numberish; true_positive_count: number; false_positive_count: number;
  false_negative_count: number; precision: Numberish; recall: Numberish; f1_score: Numberish;
  area_under_roc_curve_day_block_lower_95: Numberish; area_under_roc_curve_day_block_upper_95: Numberish;
  average_precision_day_block_lower_95: Numberish; average_precision_day_block_upper_95: Numberish;
}

export interface ScoreHistogramRow { population: "pattern" | "not the pattern" | string; bin_lower: number; bin_upper: number; window_count: number }

export interface EvaluationRow {
  timeframe: string; vector: string; population: string; horizon_bars: number; nearest_k: number;
  query_count: number; usable_count: number; claimed_direction: string | null; actual_up_rate: Numberish;
  corpus_up_rate: Numberish; mean_neighbour_vote_up: Numberish; area_under_roc_curve: Numberish;
  area_under_roc_curve_day_block_lower_95: Numberish; area_under_roc_curve_day_block_upper_95: Numberish;
  area_under_roc_curve_null_95th_percentile: Numberish; area_under_roc_curve_permutation_p_value: Numberish;
  persistence_area_under_roc_curve: Numberish; last_bar_reversal_area_under_roc_curve: Numberish;
  last_bar_reversal_day_block_lower_95: Numberish; last_bar_reversal_day_block_upper_95: Numberish;
  area_under_roc_curve_interval_width: Numberish; brier_score_neighbour_vote: Numberish; brier_score_corpus_base_rate: Numberish;
  hit_rate_in_claimed_direction: Numberish; neighbour_predicted_claimed_direction: Numberish; trading_day_count: Numberish;
  benjamini_hochberg_q_value: Numberish;
  [column: string]: unknown;
}

export type Row = Record<string, unknown>;

/** One candle, in whatever unit the section uses (points, or average ranges from the last close). */
export interface Candle { open: number; high: number; low: number; close: number }

// ---------------------------------------------------------------------------
// Section bodies
// ---------------------------------------------------------------------------

export interface OverviewBody {
  landed: boolean;
  tiles: OverviewTiles | null;
}

export interface OverviewTiles {
  heldOutAveragePrecision: [number, number] | null;
  transferAreaUnderCurve: [number, number] | null;
  transferAveragePrecision: [number, number] | null;
  neighbourMedianAreaUnderCurve: number | null;
  neighbourTests: number;
  neighbourSignificant: number;
  reversalAreaUnderCurve: [number, number] | null;
  worstRecallAt50: number | null;
}

export interface AnatomyBar extends Candle { timestamp_milliseconds: number; time_label: string }

export interface AnatomyBody {
  landed: boolean;
  firingCount: number;
  occurrence: number;
  /** Up to 26 bars ending at the firing: the window plus the ten bars its first candle is measured against. */
  bars: AnatomyBar[];
  /** The 64 stored numbers, [bars back 15 .. 0][open, high, low, close]. */
  storedVector: Array<Array<number | null>>;
  averageWindow: Array<{ population: string; bars_back: number; price: string; mean: number; median: number | null; window_count: number }>;
}

export interface MapPoint {
  time_label: string; pattern: string; every_pattern_on_the_bar: string | null; horizontal: number; vertical: number;
  [probability: string]: unknown;
}
export interface MapBody { landed: boolean; points: MapPoint[]; explainedVariance: [number, number] | null }

export interface RecogniserBody {
  landed: boolean;
  metrics: RecognizerMetricRow[];
  histogram: ScoreHistogramRow[];
  importance: Array<{ bars_back: number; price: string; average_precision_drop_when_shuffled: number; baseline_average_precision: number }>;
  importanceModel: string;
  trainingLog: Array<{ epoch: number; training_loss: number; validation_loss: number; learning_rate: number; selected_epoch: boolean; [column: string]: unknown }>;
}

export interface NeighbourMember {
  rank: number; squared_distance: number | null; timestamp_milliseconds: number; time_label: string;
  /** [bars back 15 .. 0][open, high, low, close], average ranges from the member's last close. */
  shape: Array<Array<number | null>>;
  /** close s bars later, s = 1..path length (average ranges from the last close). */
  path: Array<number | null>;
}
export interface NeighboursBody { landed: boolean; firingCount: number; occurrence: number; members: NeighbourMember[]; pathBars: number }

export interface PathsBody { landed: boolean; paths: Row[]; context: Row[] }
export interface EvaluationBody { landed: boolean; rows: EvaluationRow[] }
export interface VectorStoreBody { landed: boolean; recall: Row[]; corpora: Row[] }

export interface ColumnProfile {
  column_name: string; count: number; mean: number | null; median: number | null; standard_deviation: number | null;
  skewness: number | null; excess_kurtosis: number | null; percentile_25: number | null; percentile_75: number | null;
  minimum: number | null; maximum: number | null;
  bins: Array<{ lower: number; upper: number; count: number }>;
}
export interface ColumnsBody { landed: boolean; sampledRows: number | null; totalRows: number; profiles: ColumnProfile[] }

export interface LearnedBody {
  landed: boolean;
  purity: Row[]; clusters: Row[]; tracking: Row[]; probe: Row[]; trainingLog: Row[]; codes: Row[]; prototypes: Row[];
}
export interface LearnedMapBody { landed: boolean; points: Array<{ time_label: string; pattern: string; vocabulary_code: number | null; horizontal: number; vertical: number }> }

export interface ReconstructionBody {
  landed: boolean; firingCount: number; occurrence: number; time_label: string | null;
  /** The real window, clipped at ±10 average ranges, [bars back 15..0][o, h, l, c]. */
  real: Candle[];
  rebuilt: Candle[] | null;
  candlesRebuilt: number;
  reconstructionLoss: number | null;
  vocabularyCode: number | null;
  /** Hidden sets this firing was rebuilt with by the masked-candle model. */
  availableHidden: string[];
  hidden: string;
}

export interface NextSummaryBody {
  landed: boolean;
  screen: Row[]; placebo: Row[]; rules: Row[]; ruleTrades: Row[]; runInformation: Row | null;
  testableCounts: Array<{ timeframe: string; cells: number }>;
  baselineFit: Row[]; detectable: Row[];
}
export interface NextPatternOption { pattern: string; side: string; testable: boolean; firings: number }
export interface NextPatternBody {
  landed: boolean; options: NextPatternOption[]; pattern: string; side: string;
  averageCandles: Row[]; effects: Row[]; bars: Row | null; shares: Row[]; grid: Row[]; rangeEffects: Row[];
}
export interface TradeSummary {
  population: "firings" | "every bar"; finite_count: number; mean: number | null; median: number | null;
  standard_deviation: number | null; skewness: number | null; excess_kurtosis: number | null;
  percentile_25: number | null; percentile_75: number | null; minimum: number | null; maximum: number | null;
  share_net_positive: number | null;
}
export interface NextTradesBody {
  landed: boolean; enoughTrades: boolean; direction: 1 | -1; costTicks: number | null; firingTrades: number;
  histogram: Array<{ population: "firings" | "every bar"; net_ticks: number; share_of_trades: number }>;
  summary: TradeSummary[];
}

// ---------------------------------------------------------------------------
// Pure computations
// ---------------------------------------------------------------------------

/**
 * Section 1: the 64 numbers x = (P - C_t) / R_t recomputed from the last 16 of
 * `bars` after every price is rescaled and shifted. R_t is the mean high-low
 * range of the ten bars before the last. A rescale and shift change every
 * price and none of the 64 numbers.
 */
export function shapeVector(bars: readonly Candle[], scale = 1, shift = 0): { lastClose: number; averageRange: number; vector: number[][] } | null {
  if (bars.length < AVERAGE_RANGE_BARS + 1 || bars.length < WINDOW_BARS) return null;
  const moved = bars.map((bar) => ({
    open: bar.open * scale + shift, high: bar.high * scale + shift, low: bar.low * scale + shift, close: bar.close * scale + shift,
  }));
  const before = moved.slice(-AVERAGE_RANGE_BARS - 1, -1);
  const averageRange = before.reduce((sum, bar) => sum + (bar.high - bar.low), 0) / before.length;
  const lastClose = (moved[moved.length - 1] as Candle).close;
  const vector = moved.slice(-WINDOW_BARS).map((bar) => COMPONENTS.map((component) => (bar[component] - lastClose) / averageRange));
  return { lastClose, averageRange, vector };
}

/** Largest |recomputed - stored| over the 64 numbers (the notebook's "check" row). */
export function largestGap(vector: readonly number[][], stored: ReadonlyArray<ReadonlyArray<number | null>>): number | null {
  let largest: number | null = null;
  vector.forEach((row, i) => row.forEach((value, j) => {
    const other = stored[i]?.[j];
    if (typeof other !== "number" || !Number.isFinite(other)) return;
    const gap = Math.abs(value - other);
    largest = largest === null ? gap : Math.max(largest, gap);
  }));
  return largest;
}

/** Section 3: what the recogniser does at an alarm threshold, from its score histogram. */
export function confusionAtThreshold(rows: readonly ScoreHistogramRow[], threshold: number) {
  let truePositive = 0, positives = 0, falsePositive = 0, negatives = 0;
  for (const row of rows) {
    if (row.population === "pattern") {
      positives += row.window_count;
      if (row.bin_lower >= threshold) truePositive += row.window_count;
    } else {
      negatives += row.window_count;
      if (row.bin_lower >= threshold) falsePositive += row.window_count;
    }
  }
  const falseNegative = positives - truePositive;
  const trueNegative = negatives - falsePositive;
  return {
    truePositive, falseNegative, falsePositive, trueNegative,
    precision: truePositive + falsePositive > 0 ? truePositive / (truePositive + falsePositive) : null,
    recall: truePositive + falseNegative > 0 ? truePositive / (truePositive + falseNegative) : null,
  };
}

function finite(values: Array<unknown>): number[] {
  return values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
}

function span(values: number[]): [number, number] | null {
  return values.length ? [Math.min(...values), Math.max(...values)] : null;
}

/** Polars' median (the mean of the middle two for an even count). */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[middle] as number) : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

/** The notebook's headline tiles, from the recogniser metrics, the k = 50 neighbour tests and the recall check. */
export function overviewTiles(metrics: readonly RecognizerMetricRow[], evaluation: readonly EvaluationRow[], recall: readonly Row[]): OverviewTiles {
  const network = metrics.filter((row) => row.model_name === "neural network");
  const held = network.filter((row) => row.evaluation_set === "1m 2025 (held out)");
  const transfer = network.filter((row) => row.evaluation_set !== "1m 2025 (held out)");
  const tests = evaluation.filter((row) => row.nearest_k === 50 && typeof row.area_under_roc_curve === "number");
  const reversal = evaluation.filter((row) => row.timeframe === "1m" && row.population === "random 2025 bars" && row.horizon_bars === 1 && row.nearest_k === 50);
  const recallValues = finite(recall.map((row) => row.recall_at_50_mean));
  return {
    heldOutAveragePrecision: span(finite(held.map((row) => row.average_precision))),
    transferAreaUnderCurve: span(finite(transfer.map((row) => row.area_under_roc_curve))),
    transferAveragePrecision: span(finite(transfer.map((row) => row.average_precision))),
    neighbourMedianAreaUnderCurve: median(finite(tests.map((row) => row.area_under_roc_curve))),
    neighbourTests: tests.length,
    neighbourSignificant: tests.filter((row) => typeof row.benjamini_hochberg_q_value === "number" && row.benjamini_hochberg_q_value < 0.1).length,
    reversalAreaUnderCurve: span(finite(reversal.map((row) => row.last_bar_reversal_area_under_roc_curve))),
    worstRecallAt50: recallValues.length ? Math.min(...recallValues) : null,
  };
}

/** Section 4: the neighbours' average close s bars later (the dashed line), over neighbours with a value there. */
export function meanPath(paths: ReadonlyArray<ReadonlyArray<number | null>>, length: number): Array<number | null> {
  const out: Array<number | null> = [0];
  for (let step = 1; step <= length; step += 1) {
    const values = finite(paths.map((path) => path[step - 1]));
    out.push(values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);
  }
  return out;
}

/** Axis domain spanning the middle `share` percent of values (the notebook's "axes span the middle %" slider). */
export function middleSpan(values: readonly number[], share: number): [number, number] | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const tail = (100 - share) / 2 / 100;
  const at = (q: number) => {
    const position = q * (sorted.length - 1);
    const lower = Math.floor(position), upper = Math.ceil(position);
    return (sorted[lower] as number) + ((sorted[upper] as number) - (sorted[lower] as number)) * (position - lower);
  };
  return [at(tail), at(1 - tail)];
}

/** Shape column name for bars back k and a price (candle_vectors.shape_column). */
export function shapeColumn(barsBack: number, component: Component): string {
  return `bar_minus_${barsBack}_${component}_from_last_close_in_average_ranges`;
}

/** Forward path column (candle_vectors.forward_path_column). */
export function forwardPathColumn(steps: number): string {
  return `close_${steps}_bars_later_from_last_close_in_average_ranges`;
}

/** The market columns section 8 profiles (candle_vectors.MARKET_COLUMNS) and the last two candles' shape numbers. */
export const PROFILED_COLUMNS: readonly string[] = [
  "prior_trend_zscore_10_bars", "prior_trend_zscore_20_bars", "average_directional_index_14", "directional_indicator_spread_14",
  "close_minus_sma_30_in_atr", "position_in_prior_20_bar_range", "rsi_14", "atr_14_trailing_percentile_rank",
  "relative_volume_same_time_of_day", "eastern_time_of_day_sine", "eastern_time_of_day_cosine",
  ...[1, 0].flatMap((barsBack) => COMPONENTS.map((component) => shapeColumn(barsBack, component))),
];
