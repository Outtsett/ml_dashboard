/**
 * Market series explorer: the response body, the column catalogue and the pure
 * computations the server handler and the page share. Replaced
 * datalake/notebooks/lake_explorer.py.
 *
 * The series is one futures root or forex pair at 1 hour, resampled from the
 * lake's 1-minute bars, one contract per bar, ratio roll-adjusted for futures,
 * with scale-free features whose rolling statistics are causal (a trailing
 * window of 100 bars, unknown until it is full). Everything here is pure: no
 * lake, no DOM.
 */

import { eightNumberSummary } from "../lens/stats";
import type { EightNumberSummary } from "../analytics/types";

// ---------------------------------------------------------------------------
// Constants the notebook fixed
// ---------------------------------------------------------------------------

export const BASE_TIMEFRAME = "1m";
export const VIEW_TIMEFRAME = "1h";
/** Candles the detail panel aims for, whatever the span (notebook TARGET_BARS). */
export const DEFAULT_TARGET_BARS = 200;
/** Trailing window of the causal z-scores and the clip applied to them. */
export const ZSCORE_WINDOW = 100;
export const ZSCORE_CLIP = 5;
/** The span opens on the last 90 daily steps (the notebook's slider default). */
export const DEFAULT_SPAN_DAYS = 90;
export const DAY_MILLISECONDS = 86_400_000;
/** A span's end is pushed to the last second of its day (notebook: hour=23, minute=59, second=59). */
export const END_OF_DAY_OFFSET_MILLISECONDS = DAY_MILLISECONDS - 1000;
/** The notebook's session overlay: stored-clock hours 13 up to (not including) 20. */
export const DEFAULT_SESSION_HOURS = { start: 13, end: 20 } as const;

export const ASSET_CLASSES = ["futures", "forex"] as const;
export type AssetClass = (typeof ASSET_CLASSES)[number];

// ---------------------------------------------------------------------------
// Column catalogue
// ---------------------------------------------------------------------------

export interface SeriesColumn {
  name: string;
  /** Short name for a pane title or an axis. */
  label: string;
  /** What the number is, in plain words. */
  definition: string;
  /** How a pane draws it: bars from zero for signed discrete things, a line otherwise. */
  kind: "bar" | "line";
  unit: string;
}

/** Price and size columns: drawn as the candles, never offered as a pane (notebook: not o, h, l, c, v). */
export const PRICE_COLUMNS = ["open", "high", "low", "close", "volume"] as const;

/** Every numeric feature column, in the order the notebook's table lists them. */
export const SERIES_COLUMNS: readonly SeriesColumn[] = [
  { name: "adjustment_factor", label: "adjustment factor", kind: "line", unit: "ratio", definition: "The ratio back-adjustment multiplied into this bar's prices: 1 after the last roll, larger for older bars." },
  { name: "open_normalized", label: "open in range", kind: "line", unit: "fraction of range", definition: "Where the open sits in the bar's range: (open - low) / (high - low); 0.5 when high equals low." },
  { name: "close_normalized", label: "close in range", kind: "line", unit: "fraction of range", definition: "Where the close sits in the bar's range: (close - low) / (high - low); 0.5 when high equals low." },
  { name: "body_normalized", label: "body", kind: "bar", unit: "fraction of range", definition: "Signed body as a share of the range: (close - open) / (high - low); 0 when high equals low." },
  { name: "upper_wick_normalized", label: "upper wick", kind: "line", unit: "fraction of range", definition: "Upper wick as a share of the range: (high - max(open, close)) / (high - low)." },
  { name: "lower_wick_normalized", label: "lower wick", kind: "line", unit: "fraction of range", definition: "Lower wick as a share of the range: (min(open, close) - low) / (high - low)." },
  { name: "body_fraction", label: "body fraction", kind: "line", unit: "fraction of range", definition: "Absolute body as a share of the range." },
  { name: "wick_difference_normalized", label: "wick difference", kind: "bar", unit: "fraction of range", definition: "Upper wick minus lower wick, as a share of the range: positive when the bar rejected higher prices." },
  { name: "log_return", label: "log return", kind: "bar", unit: "natural log", definition: "Natural log of this close over the previous close. Unknown on the first bar." },
  { name: "log_range", label: "log range", kind: "line", unit: "natural log of price points", definition: "Natural log of the bar's high minus low (floored at 1e-12)." },
  { name: "log_volume", label: "log volume", kind: "line", unit: "natural log of contracts", definition: "Natural log of the bar's volume (floored at 1)." },
  { name: "return_zscore", label: "return z-score", kind: "line", unit: "standard deviations", definition: "Causal z-score of the log return over the trailing 100 bars, clipped to plus or minus 5; unknown until 100 bars exist." },
  { name: "range_zscore", label: "range z-score", kind: "line", unit: "standard deviations", definition: "Causal z-score of the log range over the trailing 100 bars, clipped to plus or minus 5; unknown until 100 bars exist." },
  { name: "volume_zscore", label: "volume z-score", kind: "line", unit: "standard deviations", definition: "Causal z-score of the log volume over the trailing 100 bars, clipped to plus or minus 5; unknown until 100 bars exist." },
  { name: "direction", label: "direction", kind: "bar", unit: "sign", definition: "Sign of close minus open: +1 up, -1 down, 0 flat." },
  { name: "median_spread_pips", label: "median spread", kind: "line", unit: "pips", definition: "Forex only: the hour's median of (ask close - bid close) / pip size over the minute bars that carry quotes." },
];

export const SERIES_COLUMN_NAMES: readonly string[] = SERIES_COLUMNS.map((column) => column.name);
/** Signed or discrete columns a pane draws as bars from zero (the notebook: log_ret, body_norm, wick_axis, dir). */
export const BAR_COLUMNS: readonly string[] = SERIES_COLUMNS.filter((column) => column.kind === "bar").map((column) => column.name);
export const DEFAULT_PANES = ["log_return", "return_zscore", "range_zscore"] as const;

export function columnSpec(name: string): SeriesColumn | undefined {
  return SERIES_COLUMNS.find((column) => column.name === name);
}

/** The numeric columns of a window row (the notebook's `numeric - o, h, l, c, v`). */
export function paneCandidates(available: readonly string[]): string[] {
  return SERIES_COLUMN_NAMES.filter((name) => available.includes(name));
}

// ---------------------------------------------------------------------------
// Response body
// ---------------------------------------------------------------------------

export interface InstrumentOption {
  /** "futures:MNQ", the notebook's dropdown value. */
  key: string;
  assetClass: AssetClass;
  root: string;
  symbolCount: number;
  minuteBarCount: number;
  firstTimestamp: number;
  lastTimestamp: number;
}

export interface SeriesSummary {
  key: string;
  barCount: number;
  firstTimestamp: number;
  lastTimestamp: number;
  /** Distinct contract symbols across the hourly bars (forex: 1). */
  contractCount: number;
  /** Distinct roll days (days the chain changes contract). */
  rollCount: number;
  /** Adjustment carried by the oldest bar; the level error an unadjusted series would carry. */
  cumulativeAdjustmentFactor: number;
  /** Minute rows per distinct minute timestamp in the lake: 1 for a clean series, above 1 for interleaved contracts. */
  interleaveRatio: number | null;
  /** Sample standard deviation of the hourly log return on the adjusted close. */
  returnStandardDeviationAdjusted: number | null;
  /** The same on the unadjusted close, which carries the roll jumps. */
  returnStandardDeviationUnadjusted: number | null;
  /** Bars whose return z-score is unknown (the warmup). */
  warmupBarCount: number;
  /** Seconds the series took to read from the lake; 0 when it came from the handler's memory. */
  loadSeconds: number;
  fromMemory: boolean;
}

/** One entry per day that has a known daily mean range z-score (the notebook's `daily`). */
export interface Overview {
  dayTimestamps: number[];
  rangeZscoreMean: number[];
  lastClose: number[];
}

export interface SpanInfo {
  /** Indices into `overview` (the slider's units). */
  startIndex: number;
  endIndex: number;
  dayCount: number;
  startTimestamp: number;
  /** Inclusive: the last second of the last day. */
  endTimestamp: number;
  barsInSpan: number;
  /** Every stride-th bar is drawn. */
  stride: number;
  barsDrawn: number;
  /** True when the span was not asked for and opened on the default. */
  isDefault: boolean;
}

/** One drawn bar with every column; unknown values are null. */
export interface WindowRow {
  timestamp: number;
  contract_symbol: string;
  is_contract_roll_day: boolean;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  [column: string]: number | string | boolean | null;
}

export interface RollEvent {
  /** First hourly bar of the roll day. */
  timestamp: number;
  fromContract: string;
  toContract: string;
  /** New contract's close over the old contract's on that day. */
  priceRatio: number | null;
  /** Natural log of that ratio: the jump an unadjusted series would show. */
  logJump: number | null;
}

export type DistributionSummary = EightNumberSummary;

export interface ColumnStatistics {
  column: string;
  brushed: DistributionSummary;
  rest: DistributionSummary;
}

export interface HistogramComparison {
  column: string;
  /** Bin edges: bins + 1 values, clipped to the 0.5th to 99.5th percentile of everything (tails sit in the end bins). */
  edges: number[];
  /** Share of each group's values per bin (sums to 1). */
  brushedShare: number[];
  restShare: number[];
  brushedCount: number;
  restCount: number;
}

/** The numbers behind one causal z-score, read at the last drawn bar. */
export interface ZscoreExample {
  column: "return_zscore" | "range_zscore" | "volume_zscore";
  source: "log_return" | "log_range" | "log_volume";
  timestamp: number;
  observation: number | null;
  windowMean: number | null;
  windowStandardDeviation: number | null;
  windowLength: number;
  zscore: number | null;
  /** The trailing window's observations, oldest first (empty until the window is full), so the page can step through the sums. */
  windowValues: number[];
}

export interface ExplorerBody {
  instruments: InstrumentOption[];
  summary: SeriesSummary | null;
  overview: Overview;
  span: SpanInfo | null;
  /** Columns present on the drawn bars (forex adds the spread). */
  columns: string[];
  rows: WindowRow[];
  /** Every roll of the whole series, oldest first, with the contracts it changed between (the page keeps those inside the span). */
  rolls: RollEvent[];
  /** Brushed-versus-rest summaries for every numeric column. */
  statistics: ColumnStatistics[];
  histogram: HistogramComparison | null;
  zscoreExamples: ZscoreExample[];
  convention: StatisticsConvention;
}

export const EMPTY_BODY: ExplorerBody = {
  instruments: [],
  summary: null,
  overview: { dayTimestamps: [], rangeZscoreMean: [], lastClose: [] },
  span: null,
  columns: [],
  rows: [],
  rolls: [],
  statistics: [],
  histogram: null,
  zscoreExamples: [],
  convention: "notebook",
};

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

/**
 * "notebook": the conventions polars' Series methods use, which is what the
 * notebook printed: standard deviation with n - 1, skewness and excess
 * kurtosis from the population moments (no small-sample correction), the
 * median interpolated, quartiles by nearest rank.
 * "sample": the dashboard's lens convention (sample-adjusted skewness and
 * excess kurtosis, linearly interpolated quartiles).
 */
export type StatisticsConvention = "notebook" | "sample";

const EMPTY_SUMMARY: DistributionSummary = {
  count: 0, mean: null, median: null, standardDeviation: null, skewness: null, kurtosis: null,
  percentile25: null, percentile75: null, minimum: null, maximum: null,
};

function finiteSorted(values: ArrayLike<number>): Float64Array {
  let count = 0;
  const copy = new Float64Array(values.length);
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i] as number;
    if (Number.isFinite(value)) {
      copy[count] = value;
      count += 1;
    }
  }
  const sorted = copy.subarray(0, count);
  sorted.sort();
  return sorted;
}

function nearestRank(sorted: Float64Array, quantile: number): number {
  const index = Math.round((sorted.length - 1) * quantile);
  return sorted[index] as number;
}

function interpolated(sorted: Float64Array, quantile: number): number {
  const position = quantile * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const low = sorted[lower] as number;
  return lower === upper ? low : low + ((sorted[upper] as number) - low) * (position - lower);
}

/** The eight distribution numbers plus the count; unknown (too few values, zero spread) is null, never 0. */
export function distributionSummary(values: ArrayLike<number>, convention: StatisticsConvention = "notebook"): DistributionSummary {
  if (convention === "sample") return eightNumberSummary(values);
  const sorted = finiteSorted(values);
  const count = sorted.length;
  if (count === 0) return { ...EMPTY_SUMMARY };
  let total = 0;
  for (let i = 0; i < count; i += 1) total += sorted[i] as number;
  const mean = total / count;
  let m2 = 0;
  let m3 = 0;
  let m4 = 0;
  for (let i = 0; i < count; i += 1) {
    const delta = (sorted[i] as number) - mean;
    const squared = delta * delta;
    m2 += squared;
    m3 += squared * delta;
    m4 += squared * squared;
  }
  const populationVariance = m2 / count;
  const hasSpread = populationVariance > 0 && Number.isFinite(populationVariance);
  return {
    count,
    mean,
    median: interpolated(sorted, 0.5),
    standardDeviation: count >= 2 ? Math.sqrt(m2 / (count - 1)) : null,
    skewness: hasSpread ? m3 / count / populationVariance ** 1.5 : null,
    kurtosis: hasSpread ? m4 / count / (populationVariance * populationVariance) - 3 : null,
    percentile25: nearestRank(sorted, 0.25),
    percentile75: nearestRank(sorted, 0.75),
    minimum: sorted[0] as number,
    maximum: sorted[count - 1] as number,
  };
}

/** Shared-edge histogram of two groups as shares of each group, edges clipped to the pooled 0.5th to 99.5th percentile. */
export function compareHistograms(column: string, brushed: ArrayLike<number>, rest: ArrayLike<number>, bins: number): HistogramComparison | null {
  const first = finiteSorted(brushed);
  const second = finiteSorted(rest);
  const pooled = finiteSorted([...first, ...second]);
  if (pooled.length === 0 || bins < 1) return null;
  let lower = interpolated(pooled, 0.005);
  let upper = interpolated(pooled, 0.995);
  if (!(upper > lower)) {
    lower = pooled[0] as number;
    upper = pooled[pooled.length - 1] as number;
  }
  if (!(upper > lower)) {
    lower -= 0.5;
    upper += 0.5;
  }
  const width = (upper - lower) / bins;
  const edges = Array.from({ length: bins + 1 }, (_unused, i) => lower + i * width);
  const share = (sorted: Float64Array): number[] => {
    const counts = new Array<number>(bins).fill(0);
    for (let i = 0; i < sorted.length; i += 1) {
      const slot = Math.min(bins - 1, Math.max(0, Math.floor(((sorted[i] as number) - lower) / width)));
      counts[slot] = (counts[slot] as number) + 1;
    }
    return sorted.length === 0 ? counts : counts.map((count) => count / sorted.length);
  };
  return { column, edges, brushedShare: share(first), restShare: share(second), brushedCount: first.length, restCount: second.length };
}

/** Mean and population standard deviation of the `window` values ending at `endIndex` (inclusive); null until the window is full of finite values. */
export function trailingWindow(values: ArrayLike<number>, endIndex: number, window: number): { mean: number; standardDeviation: number } | null {
  const start = endIndex - window + 1;
  if (start < 0 || endIndex >= values.length) return null;
  let total = 0;
  for (let i = start; i <= endIndex; i += 1) {
    const value = values[i] as number;
    if (!Number.isFinite(value)) return null;
    total += value;
  }
  const mean = total / window;
  let squares = 0;
  for (let i = start; i <= endIndex; i += 1) squares += ((values[i] as number) - mean) ** 2;
  return { mean, standardDeviation: Math.sqrt(squares / window) };
}

/** The causal z-score of the notebook's feature block: clip((x - mean) / population sd, plus or minus 5). Null when the window is not full or has no spread. */
export function causalZscore(values: ArrayLike<number>, endIndex: number, window = ZSCORE_WINDOW, clip = ZSCORE_CLIP): number | null {
  const stats = trailingWindow(values, endIndex, window);
  if (!stats || !(stats.standardDeviation > 0)) return null;
  const z = ((values[endIndex] as number) - stats.mean) / stats.standardDeviation;
  return Math.max(-clip, Math.min(clip, z));
}

// ---------------------------------------------------------------------------
// Overview, span, thinning, rolls
// ---------------------------------------------------------------------------

export function dayStart(timestamp: number): number {
  return Math.floor(timestamp / DAY_MILLISECONDS) * DAY_MILLISECONDS;
}

/**
 * The daily strip: for every UTC day that has bars, the mean of the days's
 * known range z-scores and the day's last close; days with no known z-score
 * are dropped (the notebook's group_by_dynamic("ts", every="1d") then
 * drop_nulls("range_z")). `timestamps` must be ascending.
 */
export function buildOverview(timestamps: ArrayLike<number>, rangeZscore: ArrayLike<number>, close: ArrayLike<number>): Overview {
  const overview: Overview = { dayTimestamps: [], rangeZscoreMean: [], lastClose: [] };
  let index = 0;
  const count = timestamps.length;
  while (index < count) {
    const day = dayStart(timestamps[index] as number);
    let total = 0;
    let known = 0;
    let last = close[index] as number;
    while (index < count && dayStart(timestamps[index] as number) === day) {
      const z = rangeZscore[index] as number;
      if (Number.isFinite(z)) {
        total += z;
        known += 1;
      }
      last = close[index] as number;
      index += 1;
    }
    if (known > 0) {
      overview.dayTimestamps.push(day);
      overview.rangeZscoreMean.push(total / known);
      overview.lastClose.push(last);
    }
  }
  return overview;
}

export interface ResolvedSpan {
  startIndex: number;
  endIndex: number;
  isDefault: boolean;
}

/**
 * Slider indices into the overview. A negative `requestedStart` or
 * `requestedEnd` means "not chosen": the last 90 daily steps, the notebook's
 * default ([max(n - 90, 0), n - 1]). Values are clamped to the overview and
 * put in order.
 */
export function resolveSpan(dayCount: number, requestedStart: number, requestedEnd: number): ResolvedSpan {
  const last = Math.max(dayCount - 1, 0);
  if (requestedStart < 0 || requestedEnd < 0) {
    return { startIndex: Math.max(dayCount - DEFAULT_SPAN_DAYS, 0), endIndex: last, isDefault: true };
  }
  const a = Math.min(Math.max(Math.trunc(requestedStart), 0), last);
  const b = Math.min(Math.max(Math.trunc(requestedEnd), 0), last);
  return { startIndex: Math.min(a, b), endIndex: Math.max(a, b), isDefault: false };
}

/** The span as instants: the start day's first instant to the end day's last second, both inclusive. */
export function spanInstants(dayTimestamps: ArrayLike<number>, startIndex: number, endIndex: number): { start: number; end: number } {
  return {
    start: dayTimestamps[startIndex] as number,
    end: (dayTimestamps[endIndex] as number) + END_OF_DAY_OFFSET_MILLISECONDS,
  };
}

/** Positions of the series (ascending timestamps) inside [start, end], both inclusive. */
export function positionsInSpan(timestamps: ArrayLike<number>, start: number, end: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < timestamps.length; i += 1) {
    const value = timestamps[i] as number;
    if (value >= start && value <= end) out.push(i);
  }
  return out;
}

/** Every stride-th position, stride = max(floor(count / target), 1): thinning, never re-aggregating, so the causal windows stay on the grid the candles were drawn from. */
export function thinPositions(positions: readonly number[], target: number): { positions: number[]; stride: number } {
  const stride = Math.max(Math.floor(positions.length / Math.max(target, 1)), 1);
  if (stride === 1) return { positions: [...positions], stride };
  const thinned: number[] = [];
  for (let i = 0; i < positions.length; i += stride) thinned.push(positions[i] as number);
  return { positions: thinned, stride };
}

/** Positions where a roll day begins: the flag is true and the bar before it is not. */
export function rollStartPositions(flags: ArrayLike<boolean>): number[] {
  const starts: number[] = [];
  for (let i = 0; i < flags.length; i += 1) {
    if (flags[i] && (i === 0 || !flags[i - 1])) starts.push(i);
  }
  return starts;
}

/** The hour of day of a stored timestamp (UTC digits). */
export function storedHour(timestamp: number): number {
  return new Date(timestamp).getUTCHours();
}

/** Whether a bar sits inside the session overlay: start <= hour < end, like the notebook's shading. */
export function inSession(timestamp: number, startHour: number, endHour: number): boolean {
  const hour = storedHour(timestamp);
  return hour >= startHour && hour < endHour;
}

/** Sample standard deviation of the log of consecutive ratios of `level`; null below two returns. */
export function logReturnStandardDeviation(level: ArrayLike<number>): number | null {
  const returns: number[] = [];
  for (let i = 1; i < level.length; i += 1) {
    const previous = level[i - 1] as number;
    const current = level[i] as number;
    if (previous > 0 && current > 0) returns.push(Math.log(current / previous));
  }
  if (returns.length < 2) return null;
  let total = 0;
  for (const value of returns) total += value;
  const mean = total / returns.length;
  let squares = 0;
  for (const value of returns) squares += (value - mean) ** 2;
  return Math.sqrt(squares / (returns.length - 1));
}
