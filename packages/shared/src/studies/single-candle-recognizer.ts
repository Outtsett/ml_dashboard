/**
 * Recognising TA-Lib's 13 single-candle patterns: the body of
 * GET /api/studies/single-candle-recognizer, and the pure compute the page and
 * its tests share. Replaced datalake/notebooks/single_candle_recognizer.py.
 *
 * Two halves:
 *  - the study table (104 rows: 13 patterns x 4 models x 2 feature sets, built
 *    once by datalake scripts/build_single_candle_recognizer_study.py) and the
 *    summaries over it;
 *  - TA-Lib's own candle arithmetic, ported from ta_global.c and the thirteen
 *    CDL*.c sources: TA_CANDLEAVERAGE with the default settings, and the rules.
 *    `apps/api/tests/studies/single-candle-recognizer.test.ts` checks it against
 *    400 candles evaluated by the TA-Lib C library itself (python wrapper
 *    0.7.1 and 0.8.1 give identical output).
 */

// -- names -----------------------------------------------------------------

export const SINGLE_CANDLE_PATTERNS = [
  "belthold", "closingmarubozu", "doji", "dragonflydoji", "gravestonedoji", "highwave", "longleggeddoji",
  "longline", "marubozu", "rickshawman", "shortline", "spinningtop", "takuri",
] as const;
export type SingleCandlePattern = (typeof SINGLE_CANDLE_PATTERNS)[number];

export const FEATURE_SETS = ["single_bar_shape_only", "single_bar_plus_trailing_context"] as const;
export type FeatureSet = (typeof FEATURE_SETS)[number];
export const FEATURE_SET_LABEL: Record<FeatureSet, string> = {
  single_bar_shape_only: "the candle alone",
  single_bar_plus_trailing_context: "candle + 10-bar trailing averages",
};

export const METRICS = [
  { value: "balanced_accuracy", label: "balanced accuracy" },
  { value: "average_precision", label: "average precision" },
  { value: "area_under_curve", label: "area under curve" },
  { value: "f1_score", label: "F1 score" },
  { value: "precision", label: "precision" },
  { value: "recall", label: "recall" },
] as const;
export type MetricKey = (typeof METRICS)[number]["value"];

export const REAL_TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h"] as const;
export type RealTimeframe = (typeof REAL_TIMEFRAMES)[number];

/** The earliest bar, counted within its contract, a real firing may sit at. */
export const REAL_FIRST_POSITION = 20;

/** MNQ's tick in index points (packages/config/contract_specifications.json: tick_size_index_points). */
export const MNQ_TICK_POINTS = 0.25;

// -- response body ---------------------------------------------------------

export interface StudyRow {
  model_name: string;
  pattern_name: string;
  feature_set: string;
  feature_count: number | null;
  accuracy: number | null;
  balanced_accuracy: number | null;
  precision: number | null;
  recall: number | null;
  f1_score: number | null;
  area_under_curve: number | null;
  average_precision: number | null;
  prevalence: number | null;
  positive_count: number | null;
  train_positive_count: number | null;
  train_bar_count: number | null;
  test_bar_count: number | null;
  training_seconds: number | null;
  recipe: string | null;
}

export interface RealBar {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  /** TA-Lib's stored output on this bar for each of the thirteen, from the lake's candlestick_<pattern> columns. */
  stored: Partial<Record<SingleCandlePattern, number | null>>;
}

/**
 * One real MNQ candle on which the lake's TA-Lib column fired, with the ten bars before it. Only firings
 * at least REAL_FIRST_POSITION bars into their contract are offered: the lake's column was computed
 * across contract changes, so in a contract's first ~20 bars its window reached into the previous contract.
 */
export interface RealCandle {
  pattern: SingleCandlePattern;
  timeframe: RealTimeframe;
  contractSymbol: string;
  sampleSplit: string | null;
  /** Zero-based position of this firing among every firing of the pattern, in time order. */
  firedIndex: number;
  firedCount: number;
  /** Eleven bars, oldest first; the last one is the candle that fired. */
  bars: RealBar[];
}

export interface RecognizerBody {
  /** The 104 study rows (empty on a real-candle request). */
  rows: StudyRow[];
  real: RealCandle | null;
}

// -- TA-Lib candle arithmetic ----------------------------------------------

export interface CandleBar {
  open: number;
  high: number;
  low: number;
  close: number;
}

type RangeType = "realBody" | "highLow" | "shadows";

export const SETTING_NAMES = [
  "BodyLong", "BodyShort", "BodyDoji", "ShadowLong", "ShadowVeryLong", "ShadowShort", "ShadowVeryShort", "Near",
] as const;
export type SettingName = (typeof SETTING_NAMES)[number];

interface CandleSetting {
  rangeType: RangeType;
  /** Bars averaged. 0 means the yardstick is the bar's own range. */
  averagePeriod: number;
  factor: number;
  /** What the yardstick is, in words. */
  meaning: string;
}

/** TA_CandleDefaultSettings in ta_global.c, the eight the thirteen functions read. */
export const CANDLE_SETTINGS: Record<SettingName, CandleSetting> = {
  BodyLong: { rangeType: "realBody", averagePeriod: 10, factor: 1.0, meaning: "a body counts as long above this" },
  BodyShort: { rangeType: "realBody", averagePeriod: 10, factor: 1.0, meaning: "a body counts as short below this" },
  BodyDoji: { rangeType: "highLow", averagePeriod: 10, factor: 0.1, meaning: "a body counts as a doji body at or below this" },
  ShadowLong: { rangeType: "realBody", averagePeriod: 0, factor: 1.0, meaning: "a shadow counts as long above this (this bar's own body)" },
  ShadowVeryLong: { rangeType: "realBody", averagePeriod: 0, factor: 2.0, meaning: "a shadow counts as very long above this (twice this bar's own body)" },
  ShadowShort: { rangeType: "shadows", averagePeriod: 10, factor: 1.0, meaning: "a shadow counts as short below this" },
  ShadowVeryShort: { rangeType: "highLow", averagePeriod: 10, factor: 0.1, meaning: "a shadow counts as very short below this" },
  Near: { rangeType: "highLow", averagePeriod: 5, factor: 0.2, meaning: "two prices count as near within this" },
};

export const RANGE_TYPE_LABEL: Record<RangeType, string> = {
  realBody: "real body |close - open|",
  highLow: "high - low",
  shadows: "upper + lower shadow",
};

export function realBody(bar: CandleBar): number {
  return Math.abs(bar.close - bar.open);
}
export function upperShadow(bar: CandleBar): number {
  return bar.high - Math.max(bar.open, bar.close);
}
export function lowerShadow(bar: CandleBar): number {
  return Math.min(bar.open, bar.close) - bar.low;
}
/** TA_CANDLECOLOR: +1 when close >= open, else -1. */
export function candleColor(bar: CandleBar): 1 | -1 {
  return bar.close >= bar.open ? 1 : -1;
}

/** TA_CANDLERANGE(set, bar). */
export function candleRange(rangeType: RangeType, bar: CandleBar): number {
  if (rangeType === "realBody") return realBody(bar);
  if (rangeType === "highLow") return bar.high - bar.low;
  return upperShadow(bar) + lowerShadow(bar);
}

export interface CandleAverageParts {
  setting: SettingName;
  rangeType: RangeType;
  averagePeriod: number;
  factor: number;
  divisor: number;
  /** Sum of the range measure over the averaged bars (0 when the period is 0). */
  trailingSum: number;
  /** The per-bar measure the average stands on: the trailing mean, or this bar's own range. */
  yardstick: number;
  value: number;
}

/**
 * TA_CANDLEAVERAGE(set, sum, i): `factor * (period != 0 ? sum / period : range(i)) / (shadows ? 2 : 1)`,
 * in that order of operations so the floating-point result equals the C library's.
 * `trailing` holds the bars before `current`, oldest first.
 */
export function candleAverage(setting: SettingName, trailing: readonly CandleBar[], current: CandleBar): CandleAverageParts {
  const { rangeType, averagePeriod, factor } = CANDLE_SETTINGS[setting];
  let trailingSum = 0;
  if (averagePeriod > 0) {
    for (const bar of trailing.slice(Math.max(0, trailing.length - averagePeriod))) trailingSum += candleRange(rangeType, bar);
  }
  const divisor = rangeType === "shadows" ? 2 : 1;
  const yardstick = averagePeriod !== 0 ? trailingSum / averagePeriod : candleRange(rangeType, current);
  return { setting, rangeType, averagePeriod, factor, divisor, trailingSum, yardstick, value: (factor * yardstick) / divisor };
}

export interface PatternRule {
  settings: SettingName[];
  /** +/-100 by the bar's colour, or always +100. */
  signed: boolean;
  text: string;
}

export const PATTERN_RULES: Record<SingleCandlePattern, PatternRule> = {
  belthold: { settings: ["BodyLong", "ShadowVeryShort"], signed: true, text: "long body, and no shadow on the side the bar opened from" },
  closingmarubozu: { settings: ["BodyLong", "ShadowVeryShort"], signed: true, text: "long body, and no shadow on the side the bar closed at" },
  doji: { settings: ["BodyDoji"], signed: false, text: "body at or below the doji ceiling" },
  dragonflydoji: { settings: ["BodyDoji", "ShadowVeryShort"], signed: false, text: "doji body, no upper shadow, a lower shadow" },
  gravestonedoji: { settings: ["BodyDoji", "ShadowVeryShort"], signed: false, text: "doji body, no lower shadow, an upper shadow" },
  highwave: { settings: ["BodyShort", "ShadowVeryLong"], signed: true, text: "short body, both shadows very long" },
  longleggeddoji: { settings: ["BodyDoji", "ShadowLong"], signed: false, text: "doji body, at least one long shadow" },
  longline: { settings: ["BodyLong", "ShadowShort"], signed: true, text: "long body, both shadows short" },
  marubozu: { settings: ["BodyLong", "ShadowVeryShort"], signed: true, text: "long body, both shadows very short" },
  rickshawman: { settings: ["BodyDoji", "ShadowLong", "Near"], signed: false, text: "doji body, both shadows long, body near the middle of the range" },
  shortline: { settings: ["BodyShort", "ShadowShort"], signed: true, text: "short body, both shadows short" },
  spinningtop: { settings: ["BodyShort"], signed: true, text: "short body, both shadows longer than the body" },
  takuri: { settings: ["BodyDoji", "ShadowVeryShort", "ShadowVeryLong"], signed: false, text: "doji body, no upper shadow, a very long lower shadow" },
};

/** CDL*_Lookback: the longest averaging period among the settings a rule reads. */
export function patternLookback(pattern: SingleCandlePattern): number {
  return Math.max(...PATTERN_RULES[pattern].settings.map((setting) => CANDLE_SETTINGS[setting].averagePeriod));
}

/** Bars a rule needs before the candle: the longest lookback of the thirteen. */
export const TRAILING_BARS = 10;

export interface CandleEvaluation {
  /** TA-Lib's integer output per pattern: 0, +100 or -100. */
  signals: Record<SingleCandlePattern, number>;
  averages: Record<SettingName, CandleAverageParts>;
  body: number;
  upper: number;
  lower: number;
  range: number;
  color: 1 | -1;
}

/**
 * The thirteen rules on the last bar of `bars` (at least 11, oldest first: ten
 * trailing bars, then the candle). Returns null with fewer.
 */
export function evaluateSingleCandlePatterns(bars: readonly CandleBar[]): CandleEvaluation | null {
  if (bars.length < TRAILING_BARS + 1) return null;
  const current = bars[bars.length - 1] as CandleBar;
  const trailing = bars.slice(0, bars.length - 1);
  const averages = {} as Record<SettingName, CandleAverageParts>;
  for (const setting of SETTING_NAMES) averages[setting] = candleAverage(setting, trailing, current);
  const avg = (setting: SettingName) => averages[setting].value;

  const body = realBody(current);
  const upper = upperShadow(current);
  const lower = lowerShadow(current);
  const color = candleColor(current);
  const range = current.high - current.low;
  const signedBy = (condition: boolean) => (condition ? 100 * color : 0);
  const flag = (condition: boolean) => (condition ? 100 : 0);

  const bodyLong = body > avg("BodyLong");
  const bodyShort = body < avg("BodyShort");
  const bodyDoji = body <= avg("BodyDoji");
  const veryShort = avg("ShadowVeryShort");
  const shortShadow = avg("ShadowShort");
  const longShadow = avg("ShadowLong");
  const veryLong = avg("ShadowVeryLong");
  const middle = current.low + range / 2;

  const signals: Record<SingleCandlePattern, number> = {
    belthold: signedBy(bodyLong && ((color === 1 && lower < veryShort) || (color === -1 && upper < veryShort))),
    closingmarubozu: signedBy(bodyLong && ((color === 1 && upper < veryShort) || (color === -1 && lower < veryShort))),
    doji: flag(bodyDoji),
    dragonflydoji: flag(bodyDoji && upper < veryShort && lower > veryShort),
    gravestonedoji: flag(bodyDoji && lower < veryShort && upper > veryShort),
    highwave: signedBy(bodyShort && upper > veryLong && lower > veryLong),
    longleggeddoji: flag(bodyDoji && (lower > longShadow || upper > longShadow)),
    longline: signedBy(bodyLong && upper < shortShadow && lower < shortShadow),
    marubozu: signedBy(bodyLong && upper < veryShort && lower < veryShort),
    rickshawman: flag(
      bodyDoji && lower > longShadow && upper > longShadow
        && Math.min(current.open, current.close) <= middle + avg("Near")
        && Math.max(current.open, current.close) >= middle - avg("Near"),
    ),
    shortline: signedBy(bodyShort && upper < shortShadow && lower < shortShadow),
    spinningtop: signedBy(bodyShort && upper > body && lower > body),
    takuri: flag(bodyDoji && upper < veryShort && lower > veryLong),
  };
  return { signals, averages, body, upper, lower, range, color };
}

// -- the calculator's synthetic candle -------------------------------------

export interface CalculatorSpec {
  /** Signed body as a fraction of the range, -1..1. */
  bodyFraction: number;
  /** Upper shadow as a fraction of the range, 0..1. */
  upperFraction: number;
  candleRangeTicks: number;
  /** Average high - low of the previous ten bars, in ticks. */
  trailingRangeTicks: number;
  /** Their average body as a fraction of their range; null ties it to this candle's (the notebook's rule). */
  trailingBodyFraction: number | null;
}

export const DEFAULT_CALCULATOR: CalculatorSpec = {
  bodyFraction: 0.04, upperFraction: 0.45, candleRangeTicks: 40, trailingRangeTicks: 40, trailingBodyFraction: null,
};

/** The candle the sliders draw, low at 0, in ticks. Mirrors the notebook's construction. */
export function buildCandle(spec: CalculatorSpec): CandleBar {
  const range = spec.candleRangeTicks;
  const body = spec.bodyFraction * range;
  const upper = Math.max(0, Math.min(spec.upperFraction, 1 - Math.abs(spec.bodyFraction))) * range;
  const lower = Math.max(0, range - Math.abs(body) - upper);
  const open = lower + (body >= 0 ? 0 : Math.abs(body));
  return { open, high: range, low: 0, close: open + body };
}

/** Ten identical bars of the stated range and body, shadows split evenly: what the context slider stands for. */
export function buildTrailingBars(spec: CalculatorSpec): CandleBar[] {
  const range = spec.trailingRangeTicks;
  const tied = spec.bodyFraction !== 0 ? Math.abs(spec.bodyFraction) : 0.3;
  const fraction = spec.trailingBodyFraction === null ? tied : Math.min(1, Math.max(0, spec.trailingBodyFraction));
  const body = fraction * range;
  const lower = (range - body) / 2;
  const bar: CandleBar = { open: lower, high: range, low: 0, close: lower + body };
  return Array.from({ length: TRAILING_BARS }, () => ({ ...bar }));
}

/**
 * The notebook's shortcut for the same sliders, kept so the page can show where
 * it differs from TA-Lib's arithmetic: the trailing body is range x |body
 * fraction| (0.3 x range when that is 0), and the short-shadow yardstick is
 * half the trailing range, as if the previous bars had no body.
 */
export function notebookApproximation(spec: CalculatorSpec): SingleCandlePattern[] {
  const range = spec.candleRangeTicks;
  const trailingRange = spec.trailingRangeTicks;
  const body = spec.bodyFraction * range;
  const upper = Math.max(0, Math.min(spec.upperFraction, 1 - Math.abs(spec.bodyFraction))) * range;
  const lower = Math.max(0, range - Math.abs(body) - upper);
  const open = lower + (body >= 0 ? 0 : Math.abs(body));
  const close = open + body;
  const white = close >= open;
  const absoluteBody = Math.abs(body);
  const trailingBody = spec.bodyFraction ? trailingRange * Math.abs(spec.bodyFraction) : trailingRange * 0.3;
  const bodyLong = trailingBody;
  const bodyShort = trailingBody;
  const bodyDoji = 0.1 * trailingRange;
  const veryShort = 0.1 * trailingRange;
  const shortShadow = trailingRange / 2;
  const longShadow = absoluteBody;
  const veryLong = 2 * absoluteBody;
  const near = 0.2 * trailingRange;
  const fired: SingleCandlePattern[] = [];
  if (absoluteBody > bodyLong && ((white && lower < veryShort) || (!white && upper < veryShort))) fired.push("belthold");
  if (absoluteBody > bodyLong && ((white && upper < veryShort) || (!white && lower < veryShort))) fired.push("closingmarubozu");
  if (absoluteBody <= bodyDoji) fired.push("doji");
  if (absoluteBody <= bodyDoji && upper < veryShort && lower > veryShort) fired.push("dragonflydoji");
  if (absoluteBody <= bodyDoji && lower < veryShort && upper > veryShort) fired.push("gravestonedoji");
  if (absoluteBody < bodyShort && upper > veryLong && lower > veryLong) fired.push("highwave");
  if (absoluteBody <= bodyDoji && (lower > longShadow || upper > longShadow)) fired.push("longleggeddoji");
  if (absoluteBody > bodyLong && upper < shortShadow && lower < shortShadow) fired.push("longline");
  if (absoluteBody > bodyLong && upper < veryShort && lower < veryShort) fired.push("marubozu");
  if (absoluteBody <= bodyDoji && lower > longShadow && upper > longShadow && Math.abs((Math.max(open, close) + Math.min(open, close)) / 2 - range / 2) < near) fired.push("rickshawman");
  if (absoluteBody < bodyShort && upper < shortShadow && lower < shortShadow) fired.push("shortline");
  if (upper > absoluteBody && lower > absoluteBody && absoluteBody < bodyShort) fired.push("spinningtop");
  if (absoluteBody <= bodyDoji && upper < veryShort && lower > veryLong) fired.push("takuri");
  return fired;
}

// -- the study table --------------------------------------------------------

function finite(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function selectModels(rows: readonly StudyRow[], models: readonly string[]): StudyRow[] {
  if (models.length === 0) return [...rows];
  const wanted = new Set(models);
  return rows.filter((row) => wanted.has(row.model_name));
}

export function metricOf(row: StudyRow, metric: MetricKey): number | null {
  const value = row[metric];
  return finite(value) ? value : null;
}

export interface PatternBest {
  pattern: string;
  alone: number | null;
  context: number | null;
  /** context - alone: what ten bars of context are worth. */
  gap: number | null;
}

/** Best metric over the given rows per pattern and feature set, then the context gap (the notebook's pivot). */
export function bestPerPattern(rows: readonly StudyRow[], metric: MetricKey): PatternBest[] {
  const best = new Map<string, { alone: number | null; context: number | null }>();
  for (const row of rows) {
    const value = metricOf(row, metric);
    const entry = best.get(row.pattern_name) ?? { alone: null, context: null };
    const key = row.feature_set === "single_bar_shape_only" ? "alone" : row.feature_set === "single_bar_plus_trailing_context" ? "context" : null;
    if (key && value !== null && (entry[key] === null || value > (entry[key] as number))) entry[key] = value;
    best.set(row.pattern_name, entry);
  }
  return [...best.entries()]
    .map(([pattern, { alone, context }]) => ({ pattern, alone, context, gap: alone !== null && context !== null ? context - alone : null }))
    .sort((a, b) => a.pattern.localeCompare(b.pattern));
}

export function sortPatternBest(best: readonly PatternBest[], byGap: boolean): PatternBest[] {
  const copy = [...best];
  if (byGap) copy.sort((a, b) => (b.gap ?? -Infinity) - (a.gap ?? -Infinity) || a.pattern.localeCompare(b.pattern));
  else copy.sort((a, b) => a.pattern.localeCompare(b.pattern));
  return copy;
}

function meanOf(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
}

export interface ContextSummary {
  aloneMean: number | null;
  contextMean: number | null;
  gapMean: number | null;
  hardest: { pattern: string; alone: number } | null;
}

export function summariseContext(best: readonly PatternBest[]): ContextSummary {
  const alone = best.map((row) => row.alone).filter(finite);
  const context = best.map((row) => row.context).filter(finite);
  const gaps = best.map((row) => row.gap).filter(finite);
  let hardest: ContextSummary["hardest"] = null;
  for (const row of best) {
    if (row.alone !== null && (hardest === null || row.alone < hardest.alone)) hardest = { pattern: row.pattern, alone: row.alone };
  }
  return { aloneMean: meanOf(alone), contextMean: meanOf(context), gapMean: meanOf(gaps), hardest };
}

export interface LeaderRow {
  model: string;
  featureSet: string;
  meanMetric: number;
  meanSeconds: number | null;
  patterns: number;
}

/** Mean metric and mean training seconds per (model, feature set), best first. */
export function leaderboard(rows: readonly StudyRow[], metric: MetricKey): LeaderRow[] {
  const groups = new Map<string, { model: string; featureSet: string; metrics: number[]; seconds: number[] }>();
  for (const row of rows) {
    const value = metricOf(row, metric);
    if (value === null) continue;
    const key = `${row.model_name}|${row.feature_set}`;
    const group = groups.get(key) ?? { model: row.model_name, featureSet: row.feature_set, metrics: [], seconds: [] };
    group.metrics.push(value);
    if (finite(row.training_seconds)) group.seconds.push(row.training_seconds);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((group) => ({ model: group.model, featureSet: group.featureSet, meanMetric: meanOf(group.metrics) as number, meanSeconds: meanOf(group.seconds), patterns: group.metrics.length }))
    .sort((a, b) => b.meanMetric - a.meanMetric);
}

/** The best and second-best model on the context feature set, the notebook's "Takeaway" source. */
export function contextWinners(board: readonly LeaderRow[]): { winner: LeaderRow | null; runnerUp: LeaderRow | null } {
  const onContext = board.filter((row) => row.featureSet === "single_bar_plus_trailing_context");
  return { winner: onContext[0] ?? null, runnerUp: onContext[1] ?? null };
}

// -- the notebook's eight numbers ------------------------------------------

export interface NotebookEightNumbers {
  count: number;
  mean: number;
  median: number;
  standardDeviation: number | null;
  skewness: number | null;
  excessKurtosis: number | null;
  percentile25: number;
  percentile75: number;
  minimum: number;
  maximum: number;
}

/** numpy.percentile, linear interpolation, on an ascending array. */
export function percentileLinear(sorted: readonly number[], percent: number): number {
  const position = ((sorted.length - 1) * percent) / 100;
  const below = Math.floor(position);
  const above = Math.ceil(position);
  const lower = sorted[below] as number;
  const upper = sorted[above] as number;
  return lower + (upper - lower) * (position - below);
}

/**
 * The notebook's eight numbers: standard deviation with ddof = 1, skewness as
 * mean(z^3) and excess kurtosis as mean(z^4) - 3 with z from that deviation;
 * both shape numbers are null below four values or at zero deviation.
 */
export function notebookEightNumbers(values: readonly (number | null | undefined)[]): NotebookEightNumbers | null {
  const sorted = values.filter(finite).sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return null;
  const mean = sorted.reduce((a, b) => a + b, 0) / n;
  const deviation = n > 1 ? Math.sqrt(sorted.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : null;
  let skewness: number | null = null;
  let excessKurtosis: number | null = null;
  if (n >= 4 && deviation !== null && deviation !== 0) {
    let cubed = 0;
    let fourth = 0;
    for (const value of sorted) {
      const z = (value - mean) / deviation;
      cubed += z ** 3;
      fourth += z ** 4;
    }
    skewness = cubed / n;
    excessKurtosis = fourth / n - 3;
  }
  return {
    count: n, mean, median: percentileLinear(sorted, 50), standardDeviation: deviation, skewness, excessKurtosis,
    percentile25: percentileLinear(sorted, 25), percentile75: percentileLinear(sorted, 75),
    minimum: sorted[0] as number, maximum: sorted[n - 1] as number,
  };
}

/** Histogram over [min, max] in `bins` equal bins (altair's bin=maxbins shape, without its "nice" rounding). */
export function equalBins(values: readonly number[], bins: number): Array<{ lower: number; upper: number; count: number }> {
  const clean = values.filter(finite);
  if (clean.length === 0) return [];
  const low = Math.min(...clean);
  const high = Math.max(...clean);
  if (!(high > low)) return [{ lower: low, upper: high, count: clean.length }];
  const width = (high - low) / bins;
  const out = Array.from({ length: bins }, (_, index) => ({ lower: low + index * width, upper: low + (index + 1) * width, count: 0 }));
  for (const value of clean) {
    const index = Math.min(bins - 1, Math.floor((value - low) / width));
    (out[index] as { count: number }).count += 1;
  }
  return out;
}

export const NUMERIC_COLUMNS = [
  "accuracy", "balanced_accuracy", "precision", "recall", "f1_score", "area_under_curve", "average_precision",
  "prevalence", "positive_count", "train_positive_count", "feature_count", "training_seconds",
] as const satisfies ReadonlyArray<keyof StudyRow>;
export const CATEGORICAL_COLUMNS = ["model_name", "feature_set", "pattern_name"] as const satisfies ReadonlyArray<keyof StudyRow>;
