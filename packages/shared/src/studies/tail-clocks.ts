/**
 * The body of GET /api/studies/tail-clocks, shared by the handler and the page,
 * plus the pure arithmetic both sides use (the bell-curve tail, the density of a
 * histogram, the numbers quoted in the page's prose).
 *
 * Replaced datalake/notebooks/tails.py. The bars are built once by
 * packages/ml-engine/src/studies/tail_clocks/build.py (front-month, ratio back-adjusted 1-minute
 * bars of one futures root, sampled on three clocks calibrated to the same bar
 * count) and landed as derived_study_tail_clocks_{bar_returns,series_summary,
 * hourly_volume}. The standardisation is the notebook's: a whole-span mean and
 * standard deviation over the first 80% of each series. It is descriptive, not
 * causal, and the final 20% is never landed.
 */

export const CLOCK_NAMES = ["time", "volume", "dollar"] as const;
export type ClockName = (typeof CLOCK_NAMES)[number];

export const BAR_SIZES = ["15m", "1h", "4h", "1d"] as const;
export type BarSize = (typeof BAR_SIZES)[number];

/** The notebook's histogram: 160 bins of width 0.125 over -10..+10 standard deviations. */
export const HISTOGRAM_LOWER = -10;
export const HISTOGRAM_UPPER = 10;
export const HISTOGRAM_BIN_COUNT = 160;
export const HISTOGRAM_BIN_WIDTH = (HISTOGRAM_UPPER - HISTOGRAM_LOWER) / HISTOGRAM_BIN_COUNT;

/** The sigma gates of the ladder; the selected threshold joins them. */
export const LADDER_GATES = [1, 2, 3, 4] as const;

/** Two weeks of hourly bars, as the notebook's activity panel shows. */
export const ACTIVITY_WINDOW_HOURS = 24 * 14;

/** Fewest one-minute bars for a root to be offered (drops a stray 481-bar root in the lake). */
export const MINIMUM_ONE_MINUTE_BARS = 100_000;

export interface Moments {
  count: number;
  mean: number | null;
  median: number | null;
  standardDeviation: number | null;
  /** Population-moment skewness, scipy's default, as the notebook printed it. */
  skewness: number | null;
  /** Population-moment EXCESS kurtosis (normal = 0), scipy's default. */
  kurtosis: number | null;
  percentile25: number | null;
  percentile75: number | null;
  minimum: number | null;
  maximum: number | null;
}

export interface GateCount {
  sigma: number;
  observed: number;
  predicted: number;
  /** observed / predicted; null when the rule predicts nothing. */
  ratio: number | null;
}

export interface ClockSeries {
  clock: ClockName;
  /** Bars the clock produced over the whole history, sealed fifth included. */
  producedBarCount: number;
  /** The bar count the activity clocks were calibrated to (the calendar's own). */
  calibrationTargetBarCount: number;
  /** Bars in the first 80%. */
  developmentBarCount: number;
  /** Returns standardised and counted (one fewer than the bars). */
  returnCount: number;
  /** Contracts (volume), dollars (dollar) or seconds (time) per bar. */
  thresholdPerBar: number | null;
  thresholdUnit: string;
  firstTimestamp: number | null;
  lastTimestamp: number | null;
  /** The mean and standard deviation (ddof 1) of the bar log returns the z-scores were built with. */
  logReturnMean: number | null;
  logReturnStandardDeviation: number | null;
  standardised: Moments;
  percent: Moments;
  gates: GateCount[];
  /** Bars beyond the selected k. */
  beyond: { sigma: number; observed: number; predicted: number; ratio: number | null };
  biggestMoveSigma: number | null;
  /** Counts per 0.125-wide bin over -10..+10; |z| > 10 is counted in outsideHistogramCount. */
  histogramCounts: number[];
  outsideHistogramCount: number;
}

export interface ExtremeBar {
  clock: ClockName;
  timestamp: number;
  standardisedReturn: number;
  percentReturn: number;
  /** The stamped hour of the bar's start: Pacific wall clock for a futures root. */
  hour: number;
  year: number;
}

export interface ActivityHours {
  /** Stamped start of each calendar hour, epoch milliseconds read as wall-clock digits. */
  timestamps: number[];
  contracts: number[];
}

export interface TailClocksBody {
  roots: Array<{ root: string; oneMinuteBarCount: number }>;
  selection: { root: string; barSize: BarSize; sigma: number };
  series: ClockSeries[];
  /** Bars past the selected k, largest first, capped per clock (see extremesCapPerClock). */
  extremes: ExtremeBar[];
  extremesCapPerClock: number;
  countByHour: Array<{ clock: ClockName; hour: number; count: number }>;
  countByYear: Array<{ clock: ClockName; year: number; count: number }>;
  activity: {
    hourCount: number;
    /** Every hour of the development span, oldest first (two parallel arrays; the page scrubs a two-week window through them). */
    hours: ActivityHours;
    /** Median contracts per stamped hour of the day over the development span. */
    hourOfDayMedian: Array<{ hour: number; medianContracts: number }>;
    summary: Moments;
    /** Log10 bins of contracts per hour over the development span. */
    logHistogram: Array<{ lowerLog10: number; upperLog10: number; count: number }>;
  };
  developmentFraction: number;
}

export const EMPTY_BODY: TailClocksBody = {
  roots: [],
  selection: { root: "", barSize: "4h", sigma: 4 },
  series: [],
  extremes: [],
  extremesCapPerClock: 0,
  countByHour: [],
  countByYear: [],
  activity: { hourCount: 0, hours: { timestamps: [], contracts: [] }, hourOfDayMedian: [], summary: emptyMoments(), logHistogram: [] },
  developmentFraction: 0.8,
};

export function emptyMoments(): Moments {
  return { count: 0, mean: null, median: null, standardDeviation: null, skewness: null, kurtosis: null, percentile25: null, percentile75: null, minimum: null, maximum: null };
}

// ── the bell curve ─────────────────────────────────────────────────────────

/** Complementary error function, to about 1e-15 relative over 0..40 (series below 2.5, continued fraction above). */
export function erfc(x: number): number {
  if (x < 0) return 2 - erfc(-x);
  if (x === 0) return 1;
  if (x < 2.5) {
    // erf(x) = 2/sqrt(pi) * sum_{n>=0} (-1)^n x^(2n+1) / (n! (2n+1))
    let term = x;
    let sum = x;
    for (let n = 1; n < 200; n += 1) {
      term *= (-x * x) / n;
      const contribution = term / (2 * n + 1);
      sum += contribution;
      if (Math.abs(contribution) < 1e-17 * Math.abs(sum)) break;
    }
    return 1 - (2 / Math.sqrt(Math.PI)) * sum;
  }
  // erfc(x) = exp(-x^2)/(x sqrt(pi)) * 1/(1 + 1/(2x^2)/(1 + 2/(2x^2)/(1 + ...))) via modified Lentz on the Laplace continued fraction
  const tiny = 1e-300;
  let b = x;
  let f = b === 0 ? tiny : b;
  let c = f;
  let d = 0;
  for (let n = 1; n < 500; n += 1) {
    const a = n / 2;
    d = x + a * d;
    d = d === 0 ? tiny : 1 / d;
    c = x + a / c;
    c = c === 0 ? tiny : c;
    const delta = c * d;
    f *= delta;
    if (Math.abs(delta - 1) < 1e-16) break;
  }
  b = f;
  return Math.exp(-x * x) / (b * Math.sqrt(Math.PI));
}

/** P(|Z| > k) for a standard normal: what the 68-95-99.7 rule puts beyond k standard deviations, both sides. */
export function twoSidedTail(sigma: number): number {
  return erfc(sigma / Math.SQRT2);
}

/** The standard normal density at z. */
export function normalDensity(z: number): number {
  return Math.exp(-(z * z) / 2) / Math.sqrt(2 * Math.PI);
}

/** The count of bars the rule predicts beyond k among `count` bars. */
export function predictedBeyond(count: number, sigma: number): number {
  return count * twoSidedTail(sigma);
}

/** "The rule says one bar in N" for a threshold of k sigma. */
export function ruleSaysOneEvery(sigma: number): number {
  return Math.round(1 / twoSidedTail(sigma));
}

/** observed / predicted, null when nothing is predicted. */
export function observedOverPredicted(observed: number, predicted: number): number | null {
  return predicted > 0 ? observed / predicted : null;
}

/** "Seen one bar in N"; null when none was seen. */
export function seenOneBarEvery(count: number, observed: number): number | null {
  return observed > 0 ? Math.round(count / observed) : null;
}

/**
 * numpy/matplotlib `density=True`: counts over (in-range total x bin width), so the
 * area of the drawn steps is 1 over -10..+10. Null for an empty bin (a log axis cannot draw 0).
 */
export function histogramDensity(counts: readonly number[]): Array<number | null> {
  const total = counts.reduce((sum, value) => sum + value, 0);
  if (total === 0) return counts.map(() => null);
  return counts.map((count) => (count > 0 ? count / (total * HISTOGRAM_BIN_WIDTH) : null));
}

/** The middle of histogram bin i. */
export function histogramBinCentre(index: number): number {
  return HISTOGRAM_LOWER + (index + 0.5) * HISTOGRAM_BIN_WIDTH;
}

/** Which bin a standardised return falls in; null outside -10..+10 (numpy: the last bin is closed on the right). */
export function histogramBinIndex(z: number): number | null {
  if (!Number.isFinite(z) || z < HISTOGRAM_LOWER || z > HISTOGRAM_UPPER) return null;
  return Math.min(HISTOGRAM_BIN_COUNT - 1, Math.floor((z - HISTOGRAM_LOWER) / HISTOGRAM_BIN_WIDTH));
}

/** Population skewness and excess kurtosis from central moments, scipy's defaults. */
export function shapeFromMoments(secondMoment: number, thirdMoment: number, fourthMoment: number, count: number): { skewness: number | null; kurtosis: number | null } {
  if (!(secondMoment > 0)) return { skewness: null, kurtosis: null };
  return {
    skewness: count > 2 ? thirdMoment / Math.pow(secondMoment, 1.5) : null,
    kurtosis: count > 3 ? fourthMoment / (secondMoment * secondMoment) - 3 : null,
  };
}

/** The numbers the page's closing prose quotes, from the selection on screen (the notebook hard-coded one MNQ 4h run). */
export function consequenceNumbers(series: ClockSeries | undefined) {
  if (!series || series.returnCount === 0) return null;
  const { observed, predicted, sigma } = series.beyond;
  return {
    sigma,
    bars: series.returnCount,
    observed,
    predicted,
    shareOfBars: observed / series.returnCount,
  };
}

/** First hour of the two-week window: `position` percent through the span; 50 is the notebook's len // 2. */
export function activityWindowStart(hourCount: number, positionPercent: number): number {
  const wanted = Math.floor((hourCount * positionPercent) / 100);
  return Math.max(0, Math.min(wanted, hourCount - ACTIVITY_WINDOW_HOURS));
}

/**
 * The notebook's activity line: a bar that follows a gap of more than two hours is unknown (NaN there),
 * so the line breaks across the weekend halt instead of joining Friday's close to Sunday's open.
 */
export function breakAtGaps(timestamps: readonly number[], contracts: readonly number[], gapHours = 2): Array<number | null> {
  return contracts.map((value, index) => {
    if (index > 0 && ((timestamps[index] as number) - (timestamps[index - 1] as number)) / 3_600_000 > gapHours) return null;
    return value;
  });
}
