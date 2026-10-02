/**
 * MNQ exploratory data analysis: the response types of
 * GET /api/studies/mnq-eda-30m and the pure numerics behind every section,
 * shared by the server handler and the page. It replaced the marimo notebook
 * Trading/quant/model/notebooks/eda_mnq_1d.py (the file is named 1d, its
 * content is the 30-minute bars).
 *
 * Conventions follow the notebook's own libraries so the numbers match it:
 *   - standard deviation is the POPULATION one (numpy `.std()`), skewness and
 *     excess kurtosis are the moment estimators (scipy `skew` / `kurtosis`),
 *     percentiles are linearly interpolated (numpy default);
 *   - the rolling volatility uses the SAMPLE standard deviation (pandas `.rolling().std()`);
 *   - the autocorrelation is statsmodels' `acf(fft=True)` and the partial
 *     autocorrelation its Yule-Walker `pacf(method="yw")` (sample-size adjusted);
 *   - D'Agostino-Pearson and Kruskal-Wallis are scipy's `normaltest` / `kruskal`.
 * Every function here is causal where it matters and is checked against the
 * Python in apps/api/tests/studies/mnq-eda-30m.test.ts.
 */

import { logGamma } from "../regression/student";

// ── the response ─────────────────────────────────────────────────────────────

export const TIMEFRAMES = ["5m", "15m", "30m", "1h", "4h"] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

/**
 * Which bars are read. `full` is the dedicated MNQ view (`mnq_ohlcv_<tf>`, every
 * bar since 2019-05); `notebook` is what the notebook's own loader reads today
 * (`ohlcv_<tf>` WHERE symbol = 'MNQ', history cut to 2023-03 by the shared
 * view's retention).
 */
export const SOURCES = ["full", "notebook"] as const;
export type SeriesSource = (typeof SOURCES)[number];

export const SECTIONS = [
  "summary", "price", "returns", "stationarity", "autocorrelation", "volatility",
  "weekday", "tensor", "labels", "folds", "columns",
] as const;
export type Section = (typeof SECTIONS)[number];

export const TIMEFRAME_MINUTES: Record<Timeframe, number> = { "5m": 5, "15m": 15, "30m": 30, "1h": 60, "4h": 240 };

/** The eight numbers of the house rule (plus the count), in the notebook's convention. */
export interface Moments {
  count: number;
  mean: number | null;
  median: number | null;
  standardDeviation: number | null;
  skewness: number | null;
  kurtosis: number | null;
  percentile25: number | null;
  percentile75: number | null;
  minimum: number | null;
  maximum: number | null;
}

export interface SeriesInfo {
  timeframe: Timeframe;
  source: SeriesSource;
  view: string;
  barCount: number;
  firstTimestamp: number | null;
  lastTimestamp: number | null;
  closeMinimum: number | null;
  closeMaximum: number | null;
  /** Median number of bars stamped on one calendar day (the notebook assumed 48 at 30 minutes). */
  measuredBarsPerDay: number | null;
  /** 24 hours over the bar length: the notebook's hardcoded 48 at 30 minutes. */
  nominalBarsPerDay: number;
}

export interface SourceCount {
  source: SeriesSource;
  view: string;
  barCount: number;
  firstTimestamp: number | null;
  lastTimestamp: number | null;
}

export interface Normality {
  statistic: number | null;
  pValue: number | null;
  skewnessZ: number | null;
  kurtosisZ: number | null;
}

/** One row of the landed series_provenance table: what a source holds for one timeframe. */
export interface ProvenanceRow {
  source: string;
  timeframe: string;
  view: string;
  loader: string;
  bar_count: number;
  first_bar_label: string;
  last_bar_label: string;
  close_minimum: number | null;
  close_maximum: number | null;
  median_bars_per_calendar_day: number | null;
  /** The notebook's own generate_folds at its defaults (12-month tests, 240-bar purge, 24-month minimum train). */
  default_walk_forward_fold_count: number;
}

export interface SummaryBody {
  series: SeriesInfo | null;
  sources: SourceCount[];
  /** Every timeframe x source, from the landed table (empty until it is landed). */
  provenance: ProvenanceRow[];
  returns: Moments | null;
  normality: Normality | null;
  lagOneAutocorrelation: number | null;
  lagOneSquaredAutocorrelation: number | null;
  confidenceBand: number | null;
  dayOfWeekKruskalP: number | null;
  upShareHorizonOne: number | null;
  adfReturnsP: number | null;
  kpssReturnsP: number | null;
}

export interface CandleColumns {
  /** Seconds since the epoch in the lake's stamping (Pacific wall clock stored as UTC). */
  time: number[];
  open: number[];
  high: number[];
  low: number[];
  close: number[];
  volume: number[];
  /** +1 when the bar's close is above the previous bar's close, -1 below, 0 equal or first. */
  sign: number[];
}

export interface PriceBody {
  candles: CandleColumns;
  bucket: PriceBucket;
  bucketCount: number;
  windowStartIndex: number;
  windowEndIndex: number;
}

export const PRICE_BUCKETS = ["native", "1h", "4h", "1d", "1w"] as const;
export type PriceBucket = (typeof PRICE_BUCKETS)[number];

export interface HistogramBinRow {
  lower: number;
  upper: number;
  count: number;
  /** count / (total × width): the notebook's histnorm = "probability density". */
  density: number;
}

export interface ReturnsBody {
  moments: Moments;
  normality: Normality;
  /** Bins of log_return × 100 (percent), like the notebook. */
  histogram: HistogramBinRow[];
  /** Mean and standard deviation of the percent returns, for the normal curve. */
  normalFit: { mean: number; standardDeviation: number };
  histogramRange: { lower: number; upper: number; clippedCount: number };
  /** Q-Q against the normal: theoretical quantile against the sorted sample (percent). */
  qq: { theoretical: number[]; sample: number[]; slope: number; intercept: number; correlation: number; pointCount: number };
}

export interface StationarityRow {
  source: string;
  timeframe: string;
  series: string;
  test: string;
  bar_count: number;
  statistic: number | null;
  p_value: number | null;
  p_value_is_table_edge: boolean | null;
  lags_used: number | null;
  observations_used: number | null;
  critical_value_1_percent: number | null;
  critical_value_2_5_percent: number | null;
  critical_value_5_percent: number | null;
  critical_value_10_percent: number | null;
  null_hypothesis: string;
  verdict: string;
  computed_with: string;
}

export interface StationarityBody {
  rows: StationarityRow[];
}

export interface AutocorrelationBody {
  lags: number;
  confidenceLevel: number;
  band: number;
  observationCount: number;
  /** Index 0 is lag 0 (exactly 1). */
  autocorrelation: number[];
  partialAutocorrelation: number[];
  squaredAutocorrelation: number[];
  significantLags: { autocorrelation: number; partialAutocorrelation: number; squaredAutocorrelation: number };
  /** The squared-return autocorrelations summed over lags 1..lags, a one-number measure of clustering. */
  squaredAutocorrelationSum: number;
}

export interface VolatilityBody {
  shortWindowDays: number;
  longWindowDays: number;
  barsPerDayUsed: number;
  barsPerDayBasis: BarsPerDayBasis;
  nominalBarsPerDay: number;
  measuredBarsPerDay: number | null;
  annualisationDays: number;
  annualisationFactor: number;
  overallAnnualisedPercent: number | null;
  highVolatilityPercentile: number;
  highVolatilityThresholdPercent: number | null;
  highVolatilityBarCount: number;
  barCount: number;
  shortLastPercent: number | null;
  longLastPercent: number | null;
  /** Thinned for the browser: every `stride`-th bar. */
  stride: number;
  series: { time: number[]; close: number[]; short: Array<number | null>; long: Array<number | null> };
}

export const BARS_PER_DAY_BASES = ["nominal", "measured"] as const;
export type BarsPerDayBasis = (typeof BARS_PER_DAY_BASES)[number];

export interface WeekdayRow {
  day: string;
  dayIndex: number;
  count: number;
  mean: number | null;
  standardDeviation: number | null;
  /** Mean and standard deviation in percent. */
  meanPercent: number | null;
  standardDeviationPercent: number | null;
}

export interface KruskalResult {
  h: number | null;
  pValue: number | null;
  degreesOfFreedom: number;
  groupCount: number;
  observationCount: number;
}

export const DAY_BASES = ["calendar", "session"] as const;
export type DayBasis = (typeof DAY_BASES)[number];

export interface WeekdayBody {
  dayBasis: DayBasis;
  rows: WeekdayRow[];
  /** Monday to Friday only, the notebook's test. */
  kruskalWeekdays: KruskalResult;
  /** Every day present (adds the Sunday-evening bars in the calendar basis). */
  kruskalAllDays: KruskalResult;
}

export const TENSOR_CHANNELS = [
  "open_log_change", "high_log_change", "low_log_change", "close_log_change", "volume_log_change",
] as const;

export interface TensorBody {
  window: number;
  clamp: number;
  endIndex: number;
  endTimestamp: number | null;
  startTimestamp: number | null;
  channels: readonly string[];
  /** window × 5, oldest bar first; the first row of the whole series is all zero. */
  values: number[][];
  perChannel: Array<{ name: string; mean: number; standardDeviation: number; minimum: number; maximum: number; clampedCount: number }>;
  minimum: number;
  maximum: number;
}

export interface LabelConfigRow {
  horizon: number;
  flatThresholdPoints: number;
  up: number;
  down: number;
  flat: number;
  /** up + down: the rows a classifier can train on. */
  usable: number;
  unavailable: number;
  upShare: number | null;
  /** max(up share, down share): the accuracy of always naming the commoner class. */
  majorityBaseline: number | null;
  notebook: boolean;
}

export interface LabelsBody {
  horizon: number;
  flatThresholdPoints: number;
  configs: LabelConfigRow[];
  deltaHistogram: { lower: number; upper: number; up: number[]; down: number[]; outsideCount: number };
  absoluteDelta: { percentile25: number | null; median: number | null; percentile75: number | null; percentile90: number | null; flatShareAtThreshold: number | null };
}

export interface FoldRow {
  fold: number;
  trainStartIndex: number;
  /** Exclusive: the trainer slices [trainStart, trainEnd). */
  trainEndIndex: number;
  testStartIndex: number;
  /** Exclusive. */
  testEndIndex: number;
  trainStart: number;
  trainEnd: number;
  testStart: number;
  testEnd: number;
  trainCount: number;
  testCount: number;
  /** Bars between the last training bar and the first test bar (the purge). */
  purgedBars: number;
  /** Test bars shared with the next fold's test window. */
  overlapWithNext: number;
}

export interface FoldsBody {
  foldMonths: number;
  purgeBars: number;
  minTrainMonths: number;
  barCount: number;
  firstTimestamp: number | null;
  lastTimestamp: number | null;
  folds: FoldRow[];
}

export interface ColumnProfile {
  name: string;
  group: string;
  unit: string;
  moments: Moments;
  /** Equal-width fine bins between the 0.5th and 99.5th percentiles; the edge bins absorb the tails. */
  histogram: { lower: number; upper: number; counts: number[] };
}

export interface ColumnsBody {
  columns: ColumnProfile[];
}

export type StudyBody =
  | SummaryBody | PriceBody | ReturnsBody | StationarityBody | AutocorrelationBody | VolatilityBody
  | WeekdayBody | TensorBody | LabelsBody | FoldsBody | ColumnsBody;

// ── small numerics ───────────────────────────────────────────────────────────

/** Linear-interpolated quantile of an ASCENDING array (numpy default). */
export function quantileOfSorted(sorted: ArrayLike<number>, quantile: number): number | null {
  const count = sorted.length;
  if (count === 0) return null;
  if (count === 1) return sorted[0] as number;
  const position = quantile * (count - 1);
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sorted[lowerIndex] as number;
  if (lowerIndex === upperIndex) return lower;
  return lower + ((sorted[upperIndex] as number) - lower) * (position - lowerIndex);
}

/** Finite values, ascending. */
export function sortedFiniteValues(values: ArrayLike<number>): Float64Array {
  const kept = new Float64Array(values.length);
  let count = 0;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index] as number;
    if (Number.isFinite(value)) kept[count++] = value;
  }
  const out = kept.slice(0, count);
  out.sort();
  return out;
}

const EMPTY_MOMENTS: Moments = {
  count: 0, mean: null, median: null, standardDeviation: null, skewness: null, kurtosis: null,
  percentile25: null, percentile75: null, minimum: null, maximum: null,
};

/** Mean, median, population standard deviation, moment skewness and excess kurtosis, quartiles, extremes. */
export function describeMoments(values: ArrayLike<number>): Moments {
  const sorted = sortedFiniteValues(values);
  const count = sorted.length;
  if (count === 0) return { ...EMPTY_MOMENTS };
  let total = 0;
  for (let index = 0; index < count; index += 1) total += sorted[index] as number;
  const mean = total / count;
  let second = 0;
  let third = 0;
  let fourth = 0;
  for (let index = 0; index < count; index += 1) {
    const delta = (sorted[index] as number) - mean;
    const squared = delta * delta;
    second += squared;
    third += squared * delta;
    fourth += squared * squared;
  }
  const variance = second / count;
  const standardDeviation = Math.sqrt(variance);
  const skewness = variance > 0 ? third / count / variance ** 1.5 : null;
  const kurtosis = variance > 0 ? fourth / count / (variance * variance) - 3 : null;
  return {
    count, mean, median: quantileOfSorted(sorted, 0.5), standardDeviation, skewness, kurtosis,
    percentile25: quantileOfSorted(sorted, 0.25), percentile75: quantileOfSorted(sorted, 0.75),
    minimum: sorted[0] as number, maximum: sorted[count - 1] as number,
  };
}

/**
 * Natural-log returns between consecutive closes, length n - 1, as numpy
 * `np.diff(np.log(close))`: the difference of the two logs, not the log of the
 * ratio. The two differ in the last bit, which decides which returns are EXACTLY
 * equal, and the Kruskal-Wallis tie correction counts exactly those.
 */
export function logReturns(close: ArrayLike<number>): Float64Array {
  const out = new Float64Array(Math.max(0, close.length - 1));
  for (let index = 1; index < close.length; index += 1) {
    out[index - 1] = Math.log(close[index] as number) - Math.log(close[index - 1] as number);
  }
  return out;
}

// ── distributions ────────────────────────────────────────────────────────────

/** Regularised upper incomplete gamma Q(a, x), by series below a + 1 and continued fraction above. */
export function regularizedUpperGamma(a: number, x: number): number {
  if (x <= 0) return 1;
  if (!Number.isFinite(x)) return 0;
  const logFront = -x + a * Math.log(x) - logGamma(a);
  if (x < a + 1) {
    let term = 1 / a;
    let total = term;
    for (let step = 1; step < 10_000; step += 1) {
      term *= x / (a + step);
      total += term;
      if (Math.abs(term) < Math.abs(total) * 1e-16) break;
    }
    return Math.max(0, 1 - total * Math.exp(logFront));
  }
  const tiny = 1e-300;
  let b = x + 1 - a;
  let c = 1 / tiny;
  let d = 1 / b;
  let h = d;
  for (let step = 1; step < 10_000; step += 1) {
    const an = -step * (step - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < tiny) d = tiny;
    c = b + an / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 1e-16) break;
  }
  return Math.exp(logFront) * h;
}

/** P(chi-square with `degreesOfFreedom` > x). */
export function chiSquareSurvival(x: number, degreesOfFreedom: number): number {
  if (!Number.isFinite(x)) return Number.NaN;
  if (degreesOfFreedom === 2) return Math.exp(-Math.max(x, 0) / 2);
  return regularizedUpperGamma(degreesOfFreedom / 2, x / 2);
}

/** Inverse standard normal CDF (Acklam, relative error about 1e-9), for the Q-Q abscissae. */
export function normalQuantile(probability: number): number {
  if (!(probability > 0 && probability < 1)) return probability <= 0 ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const low = 0.02425;
  if (probability < low) {
    const q = Math.sqrt(-2 * Math.log(probability));
    return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  if (probability > 1 - low) {
    const q = Math.sqrt(-2 * Math.log(1 - probability));
    return -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  const q = probability - 0.5;
  const r = q * q;
  return ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) / (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
}

/** scipy.stats.normaltest: D'Agostino-Pearson K² = Zs² + Zk², p = chi-square(2) survival. */
export function dAgostinoPearson(values: ArrayLike<number>): Normality {
  const sorted = sortedFiniteValues(values);
  const n = sorted.length;
  const moments = describeMoments(sorted);
  if (n < 20 || moments.skewness === null || moments.kurtosis === null) return { statistic: null, pValue: null, skewnessZ: null, kurtosisZ: null };

  const b1 = moments.skewness;
  let y = b1 * Math.sqrt(((n + 1) * (n + 3)) / (6 * (n - 2)));
  const beta2 = (3 * (n * n + 27 * n - 70) * (n + 1) * (n + 3)) / ((n - 2) * (n + 5) * (n + 7) * (n + 9));
  const w2 = -1 + Math.sqrt(2 * (beta2 - 1));
  const delta = 1 / Math.sqrt(0.5 * Math.log(w2));
  const alpha = Math.sqrt(2 / (w2 - 1));
  if (y === 0) y = 1;
  const scaled = y / alpha;
  const skewnessZ = delta * Math.log(scaled + Math.sqrt(scaled * scaled + 1));

  const b2 = moments.kurtosis + 3;
  const expected = (3 * (n - 1)) / (n + 1);
  const varianceB2 = (24 * n * (n - 2) * (n - 3)) / ((n + 1) * (n + 1) * (n + 3) * (n + 5));
  const x = (b2 - expected) / Math.sqrt(varianceB2);
  const sqrtBeta1 = ((6 * (n * n - 5 * n + 2)) / ((n + 7) * (n + 9))) * Math.sqrt((6 * (n + 3) * (n + 5)) / (n * (n - 2) * (n - 3)));
  const aa = 6 + (8 / sqrtBeta1) * (2 / sqrtBeta1 + Math.sqrt(1 + 4 / (sqrtBeta1 * sqrtBeta1)));
  const term1 = 1 - 2 / (9 * aa);
  const denominator = 1 + x * Math.sqrt(2 / (aa - 4));
  const term2 = denominator === 0 ? Number.NaN : Math.sign(denominator) * Math.cbrt((1 - 2 / aa) / Math.abs(denominator));
  const kurtosisZ = (term1 - term2) / Math.sqrt(2 / (9 * aa));

  const statistic = skewnessZ * skewnessZ + kurtosisZ * kurtosisZ;
  return { statistic, pValue: chiSquareSurvival(statistic, 2), skewnessZ, kurtosisZ };
}

/** scipy.stats.kruskal: tie-corrected H and its chi-square(k - 1) survival. */
export function kruskalWallis(groups: ReadonlyArray<ArrayLike<number>>): KruskalResult {
  const usable = groups.filter((group) => group.length > 0);
  const total = usable.reduce((sum, group) => sum + group.length, 0);
  const empty: KruskalResult = { h: null, pValue: null, degreesOfFreedom: Math.max(0, usable.length - 1), groupCount: usable.length, observationCount: total };
  if (usable.length < 2 || total < 3) return empty;

  const values = new Float64Array(total);
  const owner = new Int32Array(total);
  let cursor = 0;
  usable.forEach((group, groupIndex) => {
    for (let index = 0; index < group.length; index += 1) {
      values[cursor] = group[index] as number;
      owner[cursor] = groupIndex;
      cursor += 1;
    }
  });
  const order = new Uint32Array(total);
  for (let index = 0; index < total; index += 1) order[index] = index;
  order.sort((left, right) => (values[left] as number) - (values[right] as number));

  const rankSums = new Float64Array(usable.length);
  let tieTerm = 0;
  let start = 0;
  while (start < total) {
    let end = start;
    const value = values[order[start] as number] as number;
    while (end + 1 < total && values[order[end + 1] as number] === value) end += 1;
    const tied = end - start + 1;
    const averageRank = (start + end + 2) / 2;
    for (let index = start; index <= end; index += 1) {
      const group = owner[order[index] as number] as number;
      rankSums[group] = (rankSums[group] as number) + averageRank;
    }
    if (tied > 1) tieTerm += tied * tied * tied - tied;
    start = end + 1;
  }
  let sum = 0;
  usable.forEach((group, groupIndex) => {
    const rankSum = rankSums[groupIndex] as number;
    sum += (rankSum * rankSum) / group.length;
  });
  const uncorrected = (12 / (total * (total + 1))) * sum - 3 * (total + 1);
  const correction = 1 - tieTerm / (total * total * total - total);
  if (correction <= 0) return empty;
  const h = uncorrected / correction;
  const degreesOfFreedom = usable.length - 1;
  return { h, pValue: chiSquareSurvival(h, degreesOfFreedom), degreesOfFreedom, groupCount: usable.length, observationCount: total };
}

// ── autocorrelation ──────────────────────────────────────────────────────────

/** statsmodels acf(x, nlags, fft=True): sum of centred products over the sum of squares, lag 0 = 1. */
export function autocorrelation(values: ArrayLike<number>, lags: number): Float64Array {
  const n = values.length;
  const out = new Float64Array(lags + 1);
  if (n === 0) return out;
  let total = 0;
  for (let index = 0; index < n; index += 1) total += values[index] as number;
  const mean = total / n;
  const centred = new Float64Array(n);
  let energy = 0;
  for (let index = 0; index < n; index += 1) {
    const delta = (values[index] as number) - mean;
    centred[index] = delta;
    energy += delta * delta;
  }
  out[0] = 1;
  if (!(energy > 0)) return out;
  for (let lag = 1; lag <= lags; lag += 1) {
    let cross = 0;
    for (let index = 0; index + lag < n; index += 1) cross += (centred[index] as number) * (centred[index + lag] as number);
    out[lag] = cross / energy;
  }
  return out;
}

/** Solves A x = b by Gaussian elimination with partial pivoting (A is n × n, row-major, destroyed). */
function solveLinear(matrix: Float64Array, rhs: Float64Array, n: number): Float64Array {
  for (let column = 0; column < n; column += 1) {
    let pivot = column;
    let best = Math.abs(matrix[column * n + column] as number);
    for (let row = column + 1; row < n; row += 1) {
      const candidate = Math.abs(matrix[row * n + column] as number);
      if (candidate > best) {
        best = candidate;
        pivot = row;
      }
    }
    if (pivot !== column) {
      for (let k = 0; k < n; k += 1) {
        const swap = matrix[column * n + k] as number;
        matrix[column * n + k] = matrix[pivot * n + k] as number;
        matrix[pivot * n + k] = swap;
      }
      const swapped = rhs[column] as number;
      rhs[column] = rhs[pivot] as number;
      rhs[pivot] = swapped;
    }
    const diagonal = matrix[column * n + column] as number;
    for (let row = column + 1; row < n; row += 1) {
      const factor = (matrix[row * n + column] as number) / diagonal;
      if (factor === 0) continue;
      for (let k = column; k < n; k += 1) matrix[row * n + k] = (matrix[row * n + k] as number) - factor * (matrix[column * n + k] as number);
      rhs[row] = (rhs[row] as number) - factor * (rhs[column] as number);
    }
  }
  const solution = new Float64Array(n);
  for (let row = n - 1; row >= 0; row -= 1) {
    let sum = rhs[row] as number;
    for (let k = row + 1; k < n; k += 1) sum -= (matrix[row * n + k] as number) * (solution[k] as number);
    solution[row] = sum / (matrix[row * n + row] as number);
  }
  return solution;
}

/**
 * statsmodels pacf(x, nlags, method="yw"): for each k solve the order-k
 * Yule-Walker system with the sample-size adjusted autocovariances
 * r_j = Σ x_t x_{t+j} / (n - j) (x demeaned, r_0 over n) and keep the last coefficient.
 */
export function partialAutocorrelation(values: ArrayLike<number>, lags: number): Float64Array {
  const n = values.length;
  const out = new Float64Array(lags + 1);
  out[0] = 1;
  if (n <= lags + 1) return out;
  let total = 0;
  for (let index = 0; index < n; index += 1) total += values[index] as number;
  const mean = total / n;
  const centred = new Float64Array(n);
  for (let index = 0; index < n; index += 1) centred[index] = (values[index] as number) - mean;
  const covariance = new Float64Array(lags + 1);
  let energy = 0;
  for (let index = 0; index < n; index += 1) energy += (centred[index] as number) ** 2;
  covariance[0] = energy / n;
  for (let lag = 1; lag <= lags; lag += 1) {
    let cross = 0;
    for (let index = 0; index + lag < n; index += 1) cross += (centred[index] as number) * (centred[index + lag] as number);
    covariance[lag] = cross / (n - lag);
  }
  for (let order = 1; order <= lags; order += 1) {
    const matrix = new Float64Array(order * order);
    const rhs = new Float64Array(order);
    for (let row = 0; row < order; row += 1) {
      for (let column = 0; column < order; column += 1) matrix[row * order + column] = covariance[Math.abs(row - column)] as number;
      rhs[row] = covariance[row + 1] as number;
    }
    const solution = solveLinear(matrix, rhs, order);
    out[order] = solution[order - 1] as number;
  }
  return out;
}

/** Two-sided normal quantile for a confidence level such as 0.95. */
export function twoSidedNormalQuantile(confidenceLevel: number): number {
  if (Math.abs(confidenceLevel - 0.95) < 1e-12) return 1.96;
  return normalQuantile(1 - (1 - confidenceLevel) / 2);
}

// ── volatility ───────────────────────────────────────────────────────────────

/**
 * pandas `series.rolling(window).std()` (sample standard deviation, NaN until
 * `window` non-NaN values are in view) of `values`, whose NaN entries (the
 * first bar's missing return) are skipped the way pandas does.
 */
export function rollingStandardDeviation(values: ArrayLike<number>, window: number): Float64Array {
  const n = values.length;
  const out = new Float64Array(n).fill(Number.NaN);
  if (window < 2 || n < window) return out;
  let centre = 0;
  let counted = 0;
  for (let index = 0; index < n; index += 1) {
    const value = values[index] as number;
    if (Number.isFinite(value)) {
      centre += value;
      counted += 1;
    }
  }
  centre = counted > 0 ? centre / counted : 0;
  const sum = new Float64Array(n + 1);
  const squares = new Float64Array(n + 1);
  const valid = new Int32Array(n + 1);
  for (let index = 0; index < n; index += 1) {
    const value = values[index] as number;
    const finite = Number.isFinite(value);
    const shifted = finite ? value - centre : 0;
    sum[index + 1] = (sum[index] as number) + shifted;
    squares[index + 1] = (squares[index] as number) + shifted * shifted;
    valid[index + 1] = (valid[index] as number) + (finite ? 1 : 0);
  }
  for (let index = window - 1; index < n; index += 1) {
    const from = index + 1 - window;
    if ((valid[index + 1] as number) - (valid[from] as number) !== window) continue;
    const windowSum = (sum[index + 1] as number) - (sum[from] as number);
    const windowSquares = (squares[index + 1] as number) - (squares[from] as number);
    const variance = (windowSquares - (windowSum * windowSum) / window) / (window - 1);
    out[index] = Math.sqrt(Math.max(0, variance));
  }
  return out;
}

// ── the model's input tensor ─────────────────────────────────────────────────

/**
 * cnn_transformer.model.build_log_return_tensor over the `window` bars ending
 * at `endIndex` (inclusive): five channels, each log(field[t] / field[t - 1])
 * of its OWN field (not of the previous close), a non-positive previous value
 * replaced by 1, the window's first bar zero, every value clamped to ±clamp.
 * Note the notebook labels these channels "O/Cp … V/Vp" while the code divides
 * each field by its own previous value.
 */
export function modelInputTensor(
  fields: { open: ArrayLike<number>; high: ArrayLike<number>; low: ArrayLike<number>; close: ArrayLike<number>; volume: ArrayLike<number> },
  endIndex: number,
  window: number,
  clamp: number,
): { values: number[][]; clampedCount: number[] } {
  const names = ["open", "high", "low", "close", "volume"] as const;
  const start = Math.max(0, endIndex + 1 - window);
  const rows: number[][] = [];
  const clampedCount = [0, 0, 0, 0, 0];
  for (let index = start; index <= endIndex; index += 1) {
    const row: number[] = [];
    names.forEach((name, channel) => {
      if (index === start) {
        row.push(0);
        return;
      }
      const series = fields[name];
      const previous = series[index - 1] as number;
      const safePrevious = previous > 0 ? previous : 1;
      const raw = Math.log((series[index] as number) / safePrevious);
      const clipped = Math.min(clamp, Math.max(-clamp, raw));
      if (clipped !== raw) clampedCount[channel] = (clampedCount[channel] as number) + 1;
      row.push(clipped);
    });
    rows.push(row);
  }
  return { values: rows, clampedCount };
}

/** The same channels over every bar (first bar zero), for the per-column profile. */
export function modelInputChannels(
  fields: { open: ArrayLike<number>; high: ArrayLike<number>; low: ArrayLike<number>; close: ArrayLike<number>; volume: ArrayLike<number> },
  clamp: number,
): Float64Array[] {
  const names = ["open", "high", "low", "close", "volume"] as const;
  return names.map((name) => {
    const series = fields[name];
    const out = new Float64Array(series.length);
    for (let index = 1; index < series.length; index += 1) {
      const previous = series[index - 1] as number;
      const raw = Math.log((series[index] as number) / (previous > 0 ? previous : 1));
      out[index] = Math.min(clamp, Math.max(-clamp, raw));
    }
    return out;
  });
}

// ── direction labels ─────────────────────────────────────────────────────────

/**
 * cnn_transformer.direction_labels.generate_direction_labels counts: the
 * change close[i+H] - close[i] (float32 in the Python), 1 if above zero, 0 if
 * not, unavailable for the last H bars, and — with a positive threshold —
 * excluded ("flat") when |change| < threshold.
 */
export function directionLabelCounts(close: ArrayLike<number>, horizon: number, flatThresholdPoints: number): Pick<LabelConfigRow, "up" | "down" | "flat" | "usable" | "unavailable" | "upShare" | "majorityBaseline"> {
  const n = close.length;
  let up = 0;
  let down = 0;
  let flat = 0;
  for (let index = 0; index + horizon < n; index += 1) {
    const change = Math.fround((close[index + horizon] as number) - (close[index] as number));
    if (!Number.isFinite(change)) continue;
    if (flatThresholdPoints > 0 && Math.abs(change) < flatThresholdPoints) {
      flat += 1;
    } else if (change > 0) up += 1;
    else down += 1;
  }
  const usable = up + down;
  const upShare = usable > 0 ? up / usable : null;
  return { up, down, flat, usable, unavailable: Math.min(n, horizon), upShare, majorityBaseline: upShare === null ? null : Math.max(upShare, 1 - upShare) };
}

// ── walk-forward folds ───────────────────────────────────────────────────────

export interface FoldIndices {
  fold: number;
  trainStart: number;
  trainEnd: number;
  purgeBars: number;
  testStart: number;
  testEnd: number;
}

/**
 * cnn_transformer.walk_forward.generate_folds, ported line for line: an
 * expanding window whose first test month is `minTrainMonths` after the first
 * bar's month, test windows of `foldMonths`, `purgeBars` bars between the
 * train's last index and the test's first, bar indices found by date prefix
 * (so a test window includes every bar stamped on its last day, and the next
 * window includes the same day again). `timestamps` are epoch milliseconds in
 * the lake's stamping; only the calendar date of each is used.
 */
export function walkForwardFolds(timestamps: ArrayLike<number>, foldMonths: number, purgeBars: number, minTrainMonths: number): FoldIndices[] {
  const n = timestamps.length;
  if (n === 0) return [];
  const dayOf = (index: number) => Math.floor((timestamps[index] as number) / 86_400_000);
  const dayOfDate = (year: number, month: number) => Math.floor(Date.UTC(year, month - 1, 1) / 86_400_000);

  const first = new Date(timestamps[0] as number);
  const lastMs = timestamps[n - 1] as number;
  let currentMonth = first.getUTCMonth() + 1 + minTrainMonths;
  let currentYear = first.getUTCFullYear() + Math.floor((currentMonth - 1) / 12);
  currentMonth = ((currentMonth - 1) % 12) + 1;

  const atOrAfter = (targetDay: number): number | null => {
    let low = 0;
    let high = n - 1;
    let result: number | null = null;
    while (low <= high) {
      const middle = (low + high) >> 1;
      if (dayOf(middle) >= targetDay) {
        result = middle;
        high = middle - 1;
      } else low = middle + 1;
    }
    return result;
  };
  const atOrBefore = (targetDay: number): number | null => {
    let low = 0;
    let high = n - 1;
    let result: number | null = null;
    while (low <= high) {
      const middle = (low + high) >> 1;
      if (dayOf(middle) <= targetDay) {
        result = middle;
        low = middle + 1;
      } else high = middle - 1;
    }
    return result;
  };

  const folds: FoldIndices[] = [];
  let foldNumber = 0;
  for (let guard = 0; guard < 1000; guard += 1) {
    const testStartDay = dayOfDate(currentYear, currentMonth);
    let endMonth = currentMonth + foldMonths;
    const endYear = currentYear + Math.floor((endMonth - 1) / 12);
    endMonth = ((endMonth - 1) % 12) + 1;
    const testEndDay = dayOfDate(endYear, endMonth);
    if (testEndDay * 86_400_000 > lastMs) break;
    const testStart = atOrAfter(testStartDay);
    const testEnd = atOrBefore(testEndDay);
    if (testStart === null || testEnd === null) break;
    if (testStart >= testEnd) break;
    const trainEnd = testStart - purgeBars - 1;
    if (trainEnd < 0) break;
    foldNumber += 1;
    folds.push({ fold: foldNumber, trainStart: 0, trainEnd, purgeBars, testStart, testEnd });
    currentMonth += foldMonths;
    currentYear += Math.floor((currentMonth - 1) / 12);
    currentMonth = ((currentMonth - 1) % 12) + 1;
  }
  return folds;
}

// ── histograms ───────────────────────────────────────────────────────────────

/** Equal-width bins over [lower, upper] with the edge bins absorbing values outside; returns counts. */
export function binCounts(sortedValues: ArrayLike<number>, lower: number, upper: number, binCount: number): { counts: number[]; clipped: number } {
  const counts = new Array<number>(binCount).fill(0);
  let clipped = 0;
  const width = (upper - lower) / binCount;
  for (let index = 0; index < sortedValues.length; index += 1) {
    const value = sortedValues[index] as number;
    if (value < lower || value > upper) clipped += 1;
    const slot = width > 0 ? Math.min(binCount - 1, Math.max(0, Math.floor((value - lower) / width))) : 0;
    counts[slot] = (counts[slot] as number) + 1;
  }
  return { counts, clipped };
}

/** Bars below `value` in an ascending array (binary search). */
export function countBelow(sorted: ArrayLike<number>, value: number): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((sorted[middle] as number) < value) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** Plotting positions for probplot: the Filliben medians of the uniform order statistics. */
export function fillibenPositions(count: number): Float64Array {
  const out = new Float64Array(count);
  if (count === 0) return out;
  const last = 0.5 ** (1 / count);
  out[count - 1] = last;
  out[0] = 1 - last;
  for (let index = 1; index < count - 1; index += 1) out[index] = (index + 1 - 0.3175) / (count + 0.365);
  return out;
}

/** Ordinary least squares of y on x: slope, intercept and correlation (scipy.stats.probplot's line). */
export function leastSquaresLine(x: ArrayLike<number>, y: ArrayLike<number>): { slope: number; intercept: number; correlation: number } {
  const n = x.length;
  let sumX = 0;
  let sumY = 0;
  for (let index = 0; index < n; index += 1) {
    sumX += x[index] as number;
    sumY += y[index] as number;
  }
  const meanX = sumX / n;
  const meanY = sumY / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let index = 0; index < n; index += 1) {
    const dx = (x[index] as number) - meanX;
    const dy = (y[index] as number) - meanY;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  const slope = sxy / sxx;
  return { slope, intercept: meanY - slope * meanX, correlation: sxy / Math.sqrt(sxx * syy) };
}
