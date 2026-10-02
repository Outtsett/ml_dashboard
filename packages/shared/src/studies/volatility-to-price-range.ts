/**
 * Volatility value to price range: the body of
 * GET /api/studies/volatility-to-price-range and the pure computation behind it,
 * shared by the handler (which runs it over the lake's bars) and the page
 * (which re-uses the conversion functions for its calculator and curves).
 *
 * A volatility value here is v = ln(high − low) with the range in POINTS, so the
 * inverse is exact arithmetic: range = e^v points, e^v × point value dollars,
 * e^v ÷ tick size ticks. Two corrections sit between that identity and a
 * tradeable number, and both are measured: a head that emits a z-score must be
 * un-standardised first (v = z·σ + μ), and e^(forecast) is the MEDIAN bar, not
 * the average one (the Jensen gap).
 *
 * Every function mirrors Trading/quant/model/packages/ml-engine/src/cnn_transformer/
 * volatility_scale.py and volatility_labels.py line for line (NumPy's linear
 * percentile, the ddof=1 standard deviation inside the moment ratios, float32
 * log-range, the equal-count bins with searchsorted-left edges, AS241 for the
 * normal quantile), so the page reproduces the notebook
 * Trading/quant/model/notebooks/volatility_to_price_range.py rather than
 * approximating it.
 */

export const TIMEFRAMES = ["1m", "5m", "15m", "30m", "45m", "1h"] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

export const TIMEFRAME_MINUTES: Record<Timeframe, number> = { "1m": 1, "5m": 5, "15m": 15, "30m": 30, "45m": 45, "1h": 60 };

/** One bar as the handler reads it: epoch milliseconds and the three prices the study uses. */
export interface Bar {
  t: number;
  high: number;
  low: number;
  close: number;
}

// ---------------------------------------------------------------------------
// Primitive statistics (NumPy semantics)
// ---------------------------------------------------------------------------

/** NumPy's default (linear) quantile of an ascending-sorted array. */
export function quantileSorted(sorted: ArrayLike<number>, q: number): number {
  const n = sorted.length;
  if (n === 0) return Number.NaN;
  const position = (n - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.min(lower + 1, n - 1);
  const weight = position - lower;
  const a = sorted[lower] as number;
  const b = sorted[upper] as number;
  return a + (b - a) * weight;
}

function finiteSorted(values: ArrayLike<number>): Float64Array {
  const out: number[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index] as number;
    if (Number.isFinite(value)) out.push(value);
  }
  return Float64Array.from(out).sort();
}

export function mean(values: ArrayLike<number>): number {
  let total = 0;
  let count = 0;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index] as number;
    if (Number.isFinite(value)) {
      total += value;
      count += 1;
    }
  }
  return count === 0 ? Number.NaN : total / count;
}

/** Sample standard deviation (ddof = 1) over the finite values. */
export function standardDeviation(values: ArrayLike<number>): number {
  const average = mean(values);
  let squares = 0;
  let count = 0;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index] as number;
    if (Number.isFinite(value)) {
      squares += (value - average) ** 2;
      count += 1;
    }
  }
  return count < 2 ? Number.NaN : Math.sqrt(squares / (count - 1));
}

export function median(values: ArrayLike<number>): number {
  return quantileSorted(finiteSorted(values), 0.5);
}

/** The nine statistics the reporting rule asks for (count, then the eight numbers plus the 50th percentile). */
export interface NineStatistics {
  count: number;
  mean: number;
  median: number;
  standardDeviation: number;
  skewness: number;
  excessKurtosis: number;
  percentile25: number;
  percentile75: number;
  minimum: number;
  maximum: number;
}

/**
 * `volatility_scale.nine_stats`: moments are mean((x − x̄)^k) / s^k with s the
 * ddof = 1 standard deviation; skewness needs n ≥ 3, excess kurtosis n ≥ 4,
 * and a moment the sample cannot support is NaN rather than invented.
 */
export function nineStatistics(values: ArrayLike<number>): NineStatistics {
  const sorted = finiteSorted(values);
  const n = sorted.length;
  if (n === 0) {
    return {
      count: 0, mean: Number.NaN, median: Number.NaN, standardDeviation: Number.NaN, skewness: Number.NaN,
      excessKurtosis: Number.NaN, percentile25: Number.NaN, percentile75: Number.NaN, minimum: Number.NaN, maximum: Number.NaN,
    };
  }
  let total = 0;
  for (const value of sorted) total += value;
  const average = total / n;
  let second = 0;
  let third = 0;
  let fourth = 0;
  for (const value of sorted) {
    const deviation = value - average;
    const squared = deviation * deviation;
    second += squared;
    third += squared * deviation;
    fourth += squared * squared;
  }
  const deviationSample = n > 1 ? Math.sqrt(second / (n - 1)) : Number.NaN;
  const usable = Number.isFinite(deviationSample) && deviationSample > 0;
  return {
    count: n,
    mean: average,
    median: quantileSorted(sorted, 0.5),
    standardDeviation: deviationSample,
    skewness: n >= 3 && usable ? third / n / deviationSample ** 3 : Number.NaN,
    excessKurtosis: n >= 4 && usable ? fourth / n / deviationSample ** 4 - 3 : Number.NaN,
    percentile25: quantileSorted(sorted, 0.25),
    percentile75: quantileSorted(sorted, 0.75),
    minimum: sorted[0] as number,
    maximum: sorted[n - 1] as number,
  };
}

/** `numpy.linspace(start, stop, count)`, last element exactly `stop`. */
export function linspace(start: number, stop: number, count: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [start];
  const step = (stop - start) / (count - 1);
  const out: number[] = [];
  for (let index = 0; index < count; index += 1) out.push(index * step + start);
  out[count - 1] = stop;
  return out;
}

/**
 * The inverse standard-normal distribution function, Wichura's AS241 — the
 * algorithm Python's `statistics.NormalDist.inv_cdf` implements, so the two
 * agree to the last bit.
 */
export function inverseNormal(probability: number): number {
  if (!(probability > 0 && probability < 1)) throw new Error(`probability must lie in (0, 1); got ${probability}`);
  const q = probability - 0.5;
  if (Math.abs(q) <= 0.425) {
    const r = 0.180625 - q * q;
    const numerator = (((((((2.5090809287301226727e3 * r + 3.3430575583588128105e4) * r + 6.7265770927008700853e4) * r
      + 4.5921953931549871457e4) * r + 1.3731693765509461125e4) * r + 1.9715909503065514427e3) * r + 1.3314166789178437745e2) * r
      + 3.387132872796366608) * q;
    const denominator = ((((((5.226495278852854561e3 * r + 2.8729085735721942674e4) * r + 3.930789580009271061e4) * r
      + 2.1213794301586595867e4) * r + 5.3941960214247511077e3) * r + 6.871870074920579083e2) * r + 4.2313330701600911252e1) * r + 1.0;
    return numerator / denominator;
  }
  let r = q <= 0 ? probability : 1 - probability;
  r = Math.sqrt(-Math.log(r));
  let numerator: number;
  let denominator: number;
  if (r <= 5.0) {
    r -= 1.6;
    numerator = ((((((7.7454501427834140764e-4 * r + 2.27238449892691845833e-2) * r + 2.4178072517745061177e-1) * r
      + 1.27045825245236838258) * r + 3.64784832476320460504) * r + 5.7694972214606914055) * r + 4.6303378461565452959) * r
      + 1.42343711074968357734;
    denominator = ((((((1.05075007164441684324e-9 * r + 5.475938084995344946e-4) * r + 1.51986665636164571966e-2) * r
      + 1.4810397642748007459e-1) * r + 6.8976733498510000455e-1) * r + 1.6763848301838038494) * r + 2.05319162663775882187) * r + 1.0;
  } else {
    r -= 5.0;
    numerator = ((((((2.01033439929228813265e-7 * r + 2.71155556874348757815e-5) * r + 1.2426609473880784386e-3) * r
      + 2.6532189526576123093e-2) * r + 2.9656057182850489123e-1) * r + 1.7848265399172913358) * r + 5.4637849111641143699) * r
      + 6.6579046435011037772;
    denominator = ((((((2.04426310338993978564e-15 * r + 1.4215117583164458887e-7) * r + 1.8463183175100546818e-5) * r
      + 7.868691311456132591e-4) * r + 1.48753612908506148525e-2) * r + 1.3692988092273580531e-1) * r + 5.9983220655588793769e-1) * r + 1.0;
  }
  const x = numerator / denominator;
  return q < 0 ? -x : x;
}

/** Least-squares line y = slope·x + intercept (`numpy.polyfit(x, y, 1)`) and its R². */
export function fitLine(xs: readonly number[], ys: readonly number[]): { slope: number; intercept: number; rSquared: number } {
  const n = xs.length;
  if (n < 2) return { slope: Number.NaN, intercept: Number.NaN, rSquared: Number.NaN };
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let index = 0; index < n; index += 1) {
    const dx = (xs[index] as number) - mx;
    sxy += dx * ((ys[index] as number) - my);
    sxx += dx * dx;
  }
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  let residual = 0;
  let totalVariation = 0;
  for (let index = 0; index < n; index += 1) {
    const y = ys[index] as number;
    residual += (y - (slope * (xs[index] as number) + intercept)) ** 2;
    totalVariation += (y - my) ** 2;
  }
  return { slope, intercept, rSquared: totalVariation > 0 ? 1 - residual / totalVariation : Number.NaN };
}

// ---------------------------------------------------------------------------
// The conversion (volatility_scale.py)
// ---------------------------------------------------------------------------

/** v → range in points: the median bar e^v, or the average bar e^(v + s²/2). */
export function logRangeToPoints(logRange: number, residualSigma = 0, estimator: "median" | "mean" = "median"): number {
  return estimator === "median" ? Math.exp(logRange) : Math.exp(logRange + 0.5 * residualSigma * residualSigma);
}

/** The q-quantile of the range the value implies: e^(v + s·z_q), z_q the standard-normal quantile. */
export function logRangeToQuantilePoints(logRange: number, residualSigma: number, quantile: number): number {
  return Math.exp(logRange + residualSigma * inverseNormal(quantile));
}

/** Undo the train-fit z-scoring a head emits: v = z·σ_train + μ_train. */
export function standardizedToLogRange(zScore: number, trainMean: number, trainStandardDeviation: number): number {
  return zScore * trainStandardDeviation + trainMean;
}

// ---------------------------------------------------------------------------
// Series (volatility_labels.py)
// ---------------------------------------------------------------------------

export interface VolatilitySeries {
  /** ln(high − low) in float32, NaN on a zero-range bar (masked, not floored). */
  logRange: Float64Array;
  /** high − low in points, float32, every bar. */
  rangePoints: Float64Array;
  /** The NEXT bar's log-range (NaN at the last bar, after a zero-range bar, and across a gap when the gap rule is on). */
  nextLogRange: Float64Array;
  zeroRangeCount: number;
  forwardLabelCount: number;
  /** Labels the session-gap rule removed (0 when it is off). */
  gapLabelCount: number;
}

/**
 * `generate_volatility_labels(high, low, horizon=1)` with zero-range bars masked.
 * With `gapMultiple` set, a bar whose next bar is more than that many typical
 * intervals away gets no label — a range across a session break is not the
 * next bar's range. The notebook has no such rule; it is off by default.
 */
export function volatilitySeries(bars: readonly Bar[], gapMultiple: number | null = null): VolatilitySeries {
  const n = bars.length;
  const logRange = new Float64Array(n);
  const rangePoints = new Float64Array(n);
  let zeroRangeCount = 0;
  for (let index = 0; index < n; index += 1) {
    const bar = bars[index] as Bar;
    const range = Math.max(bar.high - bar.low, 0);
    rangePoints[index] = Math.fround(range);
    if (range === 0) {
      zeroRangeCount += 1;
      logRange[index] = Number.NaN;
    } else {
      logRange[index] = Math.fround(Math.log(Math.max(range, 1e-9)));
    }
  }
  let gapThreshold = Number.POSITIVE_INFINITY;
  if (gapMultiple !== null && n > 2) {
    const intervals: number[] = [];
    for (let index = 1; index < n; index += 1) intervals.push((bars[index] as Bar).t - (bars[index - 1] as Bar).t);
    gapThreshold = gapMultiple * median(intervals);
  }
  const nextLogRange = new Float64Array(n).fill(Number.NaN);
  let forwardLabelCount = 0;
  let gapLabelCount = 0;
  for (let index = 0; index + 1 < n; index += 1) {
    const next = logRange[index + 1] as number;
    if (!Number.isFinite(next)) continue;
    if ((bars[index + 1] as Bar).t - (bars[index] as Bar).t > gapThreshold) {
      gapLabelCount += 1;
      continue;
    }
    nextLogRange[index] = next;
    forwardLabelCount += 1;
  }
  return { logRange, rangePoints, nextLogRange, zeroRangeCount, forwardLabelCount, gapLabelCount };
}

/**
 * RiskMetrics exponentially weighted forecast of the next bar's log-range:
 * ewma[t] = λ·ewma[t−1] + (1 − λ)·v[t], a missing bar carrying the average
 * forward, bars before the first observation NaN. Index t forecasts bar t + 1.
 */
export function ewmaForecast(logRange: ArrayLike<number>, lambda: number): Float64Array {
  if (!(lambda > 0 && lambda < 1)) throw new Error(`lambda must lie in (0, 1); got ${lambda}`);
  const out = new Float64Array(logRange.length).fill(Number.NaN);
  let average = Number.NaN;
  for (let index = 0; index < logRange.length; index += 1) {
    const value = logRange[index] as number;
    if (Number.isFinite(value)) average = Number.isFinite(average) ? lambda * average + (1 - lambda) * value : value;
    out[index] = average;
  }
  return out;
}

/** Standard deviation (ddof = 1) of actual − forecast over the pairs where both are finite, within [from, to). */
export function residualSigma(forecast: ArrayLike<number>, actual: ArrayLike<number>, from = 0, to = forecast.length): number {
  const differences: number[] = [];
  for (let index = from; index < to; index += 1) {
    const difference = (actual[index] as number) - (forecast[index] as number);
    if (Number.isFinite(difference)) differences.push(difference);
  }
  if (differences.length < 2) return Number.NaN;
  return standardDeviation(differences);
}

// ---------------------------------------------------------------------------
// Calibration (empirical_range_calibration)
// ---------------------------------------------------------------------------

export interface CalibrationBin {
  timeframe: Timeframe;
  /** 0-based decile index; 0 is the calmest forecast. */
  bin: number;
  volatilityLow: number;
  volatilityHigh: number;
  volatilityMean: number;
  /** e^(bin mean forecast): what the formula says the median next bar will be. */
  analyticMedianPoints: number;
  rangeCount: number;
  rangeMean: number;
  rangeMedian: number;
  rangeStandardDeviation: number;
  rangeSkewness: number;
  rangeExcessKurtosis: number;
  rangePercentile25: number;
  rangePercentile75: number;
  rangeMinimum: number;
  rangeMaximum: number;
  rangeMedianUsd: number;
  rangeMeanUsd: number;
  meanOverMedian: number;
  /** (analytic ÷ realised median − 1) × 100. */
  biasPercent: number;
}

/**
 * Equal-count bins of the forecast (NumPy quantile edges, lowest edge nudged
 * down by 1e−12, searchsorted-left − 1), and the realised next-bar range inside
 * each bin with all nine statistics.
 */
export function rangeCalibration(
  timeframe: Timeframe,
  forecast: ArrayLike<number>,
  realizedPoints: ArrayLike<number>,
  binCount: number,
  pointValue: number,
): CalibrationBin[] {
  const volatility: number[] = [];
  const realized: number[] = [];
  for (let index = 0; index < forecast.length; index += 1) {
    const v = forecast[index] as number;
    const r = realizedPoints[index] as number;
    if (Number.isFinite(v) && Number.isFinite(r)) {
      volatility.push(v);
      realized.push(r);
    }
  }
  if (volatility.length < binCount) return [];
  const sorted = Float64Array.from(volatility).sort();
  const edges = linspace(0, 1, binCount + 1).map((q) => quantileSorted(sorted, q));
  edges[0] = (edges[0] as number) - 1e-12;
  const members: number[][] = Array.from({ length: binCount }, () => []);
  const memberVolatility: number[][] = Array.from({ length: binCount }, () => []);
  for (let index = 0; index < volatility.length; index += 1) {
    const v = volatility[index] as number;
    // searchsorted(edges, v, side="left"): first edge >= v.
    let low = 0;
    let high = edges.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if ((edges[middle] as number) < v) low = middle + 1;
      else high = middle;
    }
    const bin = Math.min(Math.max(low - 1, 0), binCount - 1);
    (members[bin] as number[]).push(realized[index] as number);
    (memberVolatility[bin] as number[]).push(v);
  }
  const out: CalibrationBin[] = [];
  for (let bin = 0; bin < binCount; bin += 1) {
    const ranges = members[bin] as number[];
    if (ranges.length === 0) continue;
    const volatilityMean = mean(memberVolatility[bin] as number[]);
    const stats = nineStatistics(ranges);
    const analyticMedianPoints = Math.exp(volatilityMean);
    out.push({
      timeframe,
      bin,
      volatilityLow: edges[bin] as number,
      volatilityHigh: edges[bin + 1] as number,
      volatilityMean,
      analyticMedianPoints,
      rangeCount: stats.count,
      rangeMean: stats.mean,
      rangeMedian: stats.median,
      rangeStandardDeviation: stats.standardDeviation,
      rangeSkewness: stats.skewness,
      rangeExcessKurtosis: stats.excessKurtosis,
      rangePercentile25: stats.percentile25,
      rangePercentile75: stats.percentile75,
      rangeMinimum: stats.minimum,
      rangeMaximum: stats.maximum,
      rangeMedianUsd: stats.median * pointValue,
      rangeMeanUsd: stats.mean * pointValue,
      meanOverMedian: stats.median > 0 ? stats.mean / stats.median : Number.NaN,
      biasPercent: (analyticMedianPoints / stats.median - 1) * 100,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The response body
// ---------------------------------------------------------------------------

export interface Instrument {
  symbol: string;
  pointValue: number;
  tickSize: number;
  tickValue: number;
}

export interface StudyParameters {
  symbol: string;
  start: string;
  end: string | null;
  lambda: number;
  binCount: number;
  lowerQuantile: number;
  upperQuantile: number;
  /** "window": residual σ over the whole window (the notebook); "train": over the first `trainFraction` of bars only. */
  sigmaFit: "window" | "train";
  trainFraction: number;
  /** Labels across a gap wider than this many typical intervals are dropped; null = off (the notebook). */
  gapMultiple: number | null;
  quantilePlotPoints: number;
}

export interface LoadRow {
  timeframe: Timeframe;
  source: string;
  barCount: number;
  zeroRangeBarCount: number;
  forwardLabelCount: number;
  gapLabelCount: number;
  firstBar: number;
  lastBar: number;
  lastClose: number;
}

export interface DistributionRow extends NineStatistics {
  timeframe: Timeframe;
  series: "range_points" | "log_range";
}

export interface QuantilePlot {
  timeframe: Timeframe;
  /** Theoretical normal quantiles, scaled to the sample's mean and standard deviation. */
  normalQuantile: number[];
  observedLogRange: number[];
  logRangeExcessKurtosis: number;
}

export interface ResidualRow {
  timeframe: Timeframe;
  residualSigma: number;
  /** e^(s²/2): the Gaussian mean-over-median factor. */
  jensenFactor: number;
  meanBarWiderPercent: number;
  /** Forecast/label pairs the σ was fitted on. */
  fittedPairCount: number;
}

export interface LadderRow {
  timeframe: Timeframe;
  percentileLabel: string;
  percentile: number;
  logRange: number;
  medianPoints: number;
  meanPoints: number;
  medianTicks: number;
  medianUsd: number;
  meanUsd: number;
  lowerQuantilePoints: number;
  lowerQuantileUsd: number;
  upperQuantilePoints: number;
  upperQuantileUsd: number;
  medianPercentOfPrice: number;
}

/** Where each timeframe sits on the one e^v curve: its 5th, 50th and 95th log-range percentiles. */
export interface CurveSpan {
  timeframe: Timeframe;
  logRangePercentile05: number;
  logRangeMedian: number;
  logRangePercentile95: number;
}

export interface BiasRow {
  timeframe: Timeframe;
  medianBiasPercent: number;
  minimumBiasPercent: number;
  maximumBiasPercent: number;
  barsPerBin: number;
}

export interface JensenRow {
  timeframe: Timeframe;
  residualSigma: number;
  lognormalFactor: number;
  measuredFactor: number;
  understatedByPercent: number;
  medianBinExcessKurtosis: number;
  maximumBinExcessKurtosis: number;
}

export interface ScalingRow {
  timeframe: Timeframe;
  minutes: number;
  meanLogRange: number;
  standardDeviationLogRange: number;
  measuredMedianPoints: number;
  fittedMeanLogRange: number;
  residualLogUnits: number;
  predictedSquareRootPoints: number;
  errorSquareRootPercent: number;
  predictedFittedPoints: number;
  errorFittedPercent: number;
}

export interface Scaling {
  /** Slope of mean log-range on ln(minutes): range ∝ T^H. */
  exponentOnMean: number;
  interceptOnMean: number;
  rSquaredOnMean: number;
  /** Slope of ln(median range) on ln(minutes). */
  exponentOnMedian: number;
  interceptOnMedian: number;
  rSquaredOnMedian: number;
  rows: ScalingRow[];
}

export interface SummaryRow {
  timeframe: Timeframe;
  barCount: number;
  meanLogRange: number;
  standardDeviationLogRange: number;
  medianPoints: number;
  meanPoints: number;
  medianUsd: number;
  meanUsd: number;
  medianTicks: number;
  medianPercentOfPrice: number;
  residualSigma: number;
  jensenFactor: number;
  usdPerTenthOfVolatilityAtMedian: number;
}

/** The columns of the sampled bar frame, full-word names as the page shows them. */
export const SAMPLE_COLUMNS = ["timestamp", "close", "range_points", "log_range", "next_bar_log_range", "ewma_forecast", "forecast_error"] as const;
export type SampleColumn = (typeof SAMPLE_COLUMNS)[number];

/**
 * An evenly thinned sample of one timeframe's bar frame, for the per-column
 * graphics. Column-oriented (one array per column) so the keys are not
 * repeated on every row; `sampleRows` turns it back into rows.
 */
export interface SampleFrame {
  timeframe: Timeframe;
  totalBars: number;
  columns: Record<SampleColumn, Array<number | null>>;
}

export function sampleRows(frame: SampleFrame): Array<Record<SampleColumn, number | null>> {
  const length = frame.columns.timestamp.length;
  const rows: Array<Record<SampleColumn, number | null>> = [];
  for (let index = 0; index < length; index += 1) {
    const row = {} as Record<SampleColumn, number | null>;
    for (const column of SAMPLE_COLUMNS) row[column] = frame.columns[column][index] ?? null;
    rows.push(row);
  }
  return rows;
}

export interface VolatilityStudyBody {
  instrument: Instrument;
  parameters: StudyParameters;
  availableSymbols: string[];
  timeframes: Timeframe[];
  load: LoadRow[];
  distributions: DistributionRow[];
  quantilePlots: QuantilePlot[];
  residuals: ResidualRow[];
  ladder: LadderRow[];
  curve: { gridLow: number; gridHigh: number; spans: CurveSpan[] };
  calibration: CalibrationBin[];
  bias: BiasRow[];
  jensen: JensenRow[];
  scaling: Scaling | null;
  summary: SummaryRow[];
  samples: SampleFrame[];
}

export const LADDER_PERCENTILES = linspace(0.05, 0.95, 10);

function percentileLabel(q: number): string {
  return `p${String(Math.round(q * 100)).padStart(2, "0")}`;
}

function pick(values: ArrayLike<number>, mask: (index: number) => boolean): number[] {
  const out: number[] = [];
  for (let index = 0; index < values.length; index += 1) if (mask(index)) out.push(values[index] as number);
  return out;
}

/** Seven significant digits: plenty for a picture, and a third of the bytes of a full double. */
function compact(value: number): number {
  return Number.isFinite(value) ? Number(value.toPrecision(7)) : value;
}

function finiteOrNull(value: number): number | null {
  return Number.isFinite(value) ? compact(value) : null;
}

export interface AnalyseOptions {
  instrument: Instrument;
  parameters: StudyParameters;
  availableSymbols: string[];
  /** Human-readable source per timeframe ("ohlcv_5m", "ohlcv_1m in 45-minute buckets"). */
  sources: Partial<Record<Timeframe, string>>;
  sampleRows?: number;
}

/** Everything the page draws, from the bars of each timeframe. Timeframes with no bars are skipped. */
export function analyse(barsByTimeframe: Partial<Record<Timeframe, readonly Bar[]>>, options: AnalyseOptions): VolatilityStudyBody {
  const { instrument, parameters } = options;
  const sampleSize = options.sampleRows ?? 800;
  const body: VolatilityStudyBody = {
    instrument,
    parameters,
    availableSymbols: options.availableSymbols,
    timeframes: [],
    load: [],
    distributions: [],
    quantilePlots: [],
    residuals: [],
    ladder: [],
    curve: { gridLow: Number.NaN, gridHigh: Number.NaN, spans: [] },
    calibration: [],
    bias: [],
    jensen: [],
    scaling: null,
    summary: [],
    samples: [],
  };
  const allLogRanges: number[] = [];
  const scalingInputs: Array<{ timeframe: Timeframe; minutes: number; meanLogRange: number; sdLogRange: number; medianAll: number }> = [];

  for (const timeframe of TIMEFRAMES) {
    const bars = barsByTimeframe[timeframe];
    if (!bars || bars.length < parameters.binCount + 2) continue;
    body.timeframes.push(timeframe);
    const series = volatilitySeries(bars, parameters.gapMultiple);
    const n = bars.length;
    const lastClose = (bars[n - 1] as Bar).close;
    body.load.push({
      timeframe,
      source: options.sources[timeframe] ?? "",
      barCount: n,
      zeroRangeBarCount: series.zeroRangeCount,
      forwardLabelCount: series.forwardLabelCount,
      gapLabelCount: series.gapLabelCount,
      firstBar: (bars[0] as Bar).t,
      lastBar: (bars[n - 1] as Bar).t,
      lastClose,
    });

    const finite = (index: number) => Number.isFinite(series.logRange[index] as number);
    const logRangeFinite = pick(series.logRange, finite);
    const rangeFinite = pick(series.rangePoints, finite);
    for (const value of logRangeFinite) allLogRanges.push(value);
    const logStats = nineStatistics(logRangeFinite);
    const rangeStats = nineStatistics(rangeFinite);
    body.distributions.push({ timeframe, series: "range_points", ...rangeStats }, { timeframe, series: "log_range", ...logStats });

    // Q-Q: evenly spaced positions of the sorted sample against the normal it is assumed to be.
    const sortedLog = Float64Array.from(logRangeFinite).sort();
    const size = sortedLog.length;
    const positions = linspace(0, size - 1, Math.min(parameters.quantilePlotPoints, size)).map((value) => Math.trunc(value));
    const picked = positions.map((position) => sortedLog[position] as number);
    const pickedMean = mean(picked);
    const pickedSd = standardDeviation(picked);
    body.quantilePlots.push({
      timeframe,
      normalQuantile: positions.map((position) => compact(inverseNormal((position + 0.5) / size) * pickedSd + pickedMean)),
      observedLogRange: picked.map(compact),
      logRangeExcessKurtosis: logStats.excessKurtosis,
    });

    // Residual σ of the causal EWMA forecast.
    const forecast = ewmaForecast(series.logRange, parameters.lambda);
    const fitTo = parameters.sigmaFit === "train" ? Math.floor(n * parameters.trainFraction) : n;
    const sigma = residualSigma(forecast, series.nextLogRange, 0, fitTo);
    let fittedPairCount = 0;
    for (let index = 0; index < fitTo; index += 1) {
      if (Number.isFinite((series.nextLogRange[index] as number) - (forecast[index] as number))) fittedPairCount += 1;
    }
    const jensenFactor = Math.exp(0.5 * sigma * sigma);
    body.residuals.push({ timeframe, residualSigma: sigma, jensenFactor, meanBarWiderPercent: 100 * (jensenFactor - 1), fittedPairCount });

    // The conversion ladder at ten log-range percentiles.
    for (const q of LADDER_PERCENTILES) {
      const v = quantileSorted(sortedLog, q);
      const medianPoints = logRangeToPoints(v);
      const meanPoints = logRangeToPoints(v, sigma, "mean");
      const lowerPoints = logRangeToQuantilePoints(v, sigma, parameters.lowerQuantile);
      const upperPoints = logRangeToQuantilePoints(v, sigma, parameters.upperQuantile);
      body.ladder.push({
        timeframe,
        percentileLabel: percentileLabel(q),
        percentile: q,
        logRange: v,
        medianPoints,
        meanPoints,
        medianTicks: medianPoints / instrument.tickSize,
        medianUsd: medianPoints * instrument.pointValue,
        meanUsd: meanPoints * instrument.pointValue,
        lowerQuantilePoints: lowerPoints,
        lowerQuantileUsd: lowerPoints * instrument.pointValue,
        upperQuantilePoints: upperPoints,
        upperQuantileUsd: upperPoints * instrument.pointValue,
        medianPercentOfPrice: (100 * medianPoints) / lastClose,
      });
    }
    body.curve.spans.push({
      timeframe,
      logRangePercentile05: quantileSorted(sortedLog, 0.05),
      logRangeMedian: quantileSorted(sortedLog, 0.5),
      logRangePercentile95: quantileSorted(sortedLog, 0.95),
    });

    // Calibration against the realised NEXT-bar range.
    // The label is float32 in the notebook, and so is its exponential.
    const realizedNext = Float64Array.from(series.nextLogRange, (value) => Math.fround(Math.exp(value)));
    const bins = rangeCalibration(timeframe, forecast, realizedNext, parameters.binCount, instrument.pointValue);
    body.calibration.push(...bins);
    if (bins.length > 0) {
      const bias = bins.map((bin) => bin.biasPercent);
      body.bias.push({
        timeframe,
        medianBiasPercent: median(bias),
        minimumBiasPercent: Math.min(...bias),
        maximumBiasPercent: Math.max(...bias),
        barsPerBin: Math.trunc(median(bins.map((bin) => bin.rangeCount))),
      });
      const measured = median(bins.map((bin) => bin.meanOverMedian));
      const kurtoses = bins.map((bin) => bin.rangeExcessKurtosis);
      body.jensen.push({
        timeframe,
        residualSigma: sigma,
        lognormalFactor: jensenFactor,
        measuredFactor: measured,
        understatedByPercent: 100 * (measured / jensenFactor - 1),
        medianBinExcessKurtosis: median(kurtoses),
        maximumBinExcessKurtosis: Math.max(...kurtoses.filter((value) => Number.isFinite(value))),
      });
    }

    // Summary; the scaling law reads the median over every bar, zero-range included (as the notebook does).
    const medianPoints = rangeStats.median;
    body.summary.push({
      timeframe,
      barCount: logStats.count,
      meanLogRange: logStats.mean,
      standardDeviationLogRange: logStats.standardDeviation,
      medianPoints,
      meanPoints: rangeStats.mean,
      medianUsd: medianPoints * instrument.pointValue,
      meanUsd: rangeStats.mean * instrument.pointValue,
      medianTicks: medianPoints / instrument.tickSize,
      medianPercentOfPrice: (100 * medianPoints) / lastClose,
      residualSigma: sigma,
      jensenFactor,
      usdPerTenthOfVolatilityAtMedian: medianPoints * (Math.exp(0.1) - 1) * instrument.pointValue,
    });
    scalingInputs.push({
      timeframe,
      minutes: TIMEFRAME_MINUTES[timeframe],
      meanLogRange: logStats.mean,
      sdLogRange: logStats.standardDeviation,
      medianAll: median(series.rangePoints),
    });

    // An evenly thinned sample of the frame for the per-column graphics.
    const step = Math.max(1, Math.ceil(n / sampleSize));
    const columns = Object.fromEntries(SAMPLE_COLUMNS.map((column) => [column, [] as Array<number | null>])) as SampleFrame["columns"];
    for (let index = 0; index < n; index += step) {
      const bar = bars[index] as Bar;
      const f = forecast[index] as number;
      const next = series.nextLogRange[index] as number;
      columns.timestamp.push(bar.t);
      columns.close.push(bar.close);
      columns.range_points.push(compact(series.rangePoints[index] as number));
      columns.log_range.push(finiteOrNull(series.logRange[index] as number));
      columns.next_bar_log_range.push(finiteOrNull(next));
      columns.ewma_forecast.push(finiteOrNull(f));
      columns.forecast_error.push(finiteOrNull(next - f));
    }
    body.samples.push({ timeframe, totalBars: n, columns });
  }

  if (allLogRanges.length > 0) {
    const sortedAll = Float64Array.from(allLogRanges).sort();
    body.curve.gridLow = quantileSorted(sortedAll, 0.001);
    body.curve.gridHigh = quantileSorted(sortedAll, 0.999);
  }

  if (scalingInputs.length >= 2) {
    const logMinutes = scalingInputs.map((row) => Math.log(row.minutes));
    const onMean = fitLine(logMinutes, scalingInputs.map((row) => row.meanLogRange));
    const onMedian = fitLine(logMinutes, scalingInputs.map((row) => Math.log(row.medianAll)));
    const anchor = scalingInputs[0]!;
    body.scaling = {
      exponentOnMean: onMean.slope,
      interceptOnMean: onMean.intercept,
      rSquaredOnMean: onMean.rSquared,
      exponentOnMedian: onMedian.slope,
      interceptOnMedian: onMedian.intercept,
      rSquaredOnMedian: onMedian.rSquared,
      rows: scalingInputs.map((row, index) => {
        const fitted = onMean.slope * (logMinutes[index] as number) + onMean.intercept;
        const squareRoot = (anchor.medianAll * Math.sqrt(row.minutes)) / Math.sqrt(anchor.minutes);
        const power = Math.exp(onMedian.intercept) * row.minutes ** onMedian.slope;
        return {
          timeframe: row.timeframe,
          minutes: row.minutes,
          meanLogRange: row.meanLogRange,
          standardDeviationLogRange: row.sdLogRange,
          measuredMedianPoints: row.medianAll,
          fittedMeanLogRange: fitted,
          residualLogUnits: row.meanLogRange - fitted,
          predictedSquareRootPoints: squareRoot,
          errorSquareRootPercent: 100 * (squareRoot / row.medianAll - 1),
          predictedFittedPoints: power,
          errorFittedPercent: 100 * (power / row.medianAll - 1),
        };
      }),
    };
  }
  return body;
}

/** The empty body a handler returns when the bars are not in the lake. */
export function emptyBody(instrument: Instrument, parameters: StudyParameters, availableSymbols: string[]): VolatilityStudyBody {
  return analyse({}, { instrument, parameters, availableSymbols, sources: {} });
}
