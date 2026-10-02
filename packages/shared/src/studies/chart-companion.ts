/**
 * Chart companion: the body of GET /api/studies/chart-companion and every pure
 * computation the page and its tests share. Replaced notebooks/chart_companion.py.
 *
 * The bars are the ones the Market chart shows (the same stamps: futures are
 * CME Pacific wall clock stored as UTC, forex is UTC) plus warm-up bars before
 * them. Everything here is CAUSAL: a bar is compared only with the bars before
 * it, an unknown is NaN (never zero), and the first bars of a window carry no
 * score until enough history exists.
 *
 * The session-gap rule differs from /analytics on purpose. The notebook did
 * not leave session gaps out of the return statistics, so this study keeps
 * them in for parity (a weekend or overnight return is scored like any other);
 * packages/shared/src/analytics/compute.ts `buildFrame` excludes gaps longer than
 * GAP_MULTIPLE typical bar intervals. The two answers differ on futures.
 */

import type { Overlay } from "../chartLink";
import { eightNumberSummary } from "../lens/stats";
import type { LensEightNumberSummary } from "../lens/types";

// ── The response body ────────────────────────────────────────────────────────

export const COMPANION_TIMEFRAMES = ["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w"] as const;
export type CompanionTimeframe = (typeof COMPANION_TIMEFRAMES)[number];

export const TIMEFRAME_MILLISECONDS: Record<CompanionTimeframe, number> = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "30m": 1_800_000,
  "1h": 3_600_000,
  "4h": 14_400_000,
  "1d": 86_400_000,
  "1w": 604_800_000,
};

/** The widest trailing window the page offers (200), so 2 x 200 + 2 bars of warm-up score every visible bar. */
export const WARMUP_BARS_DEFAULT = 402;
/** The most bars one request reads, the chart route's own limit. */
export const MAX_BARS_PER_REQUEST = 100_000;

export interface CompanionBars {
  timestamps: number[];
  open: number[];
  high: number[];
  low: number[];
  close: number[];
  volume: number[];
}

export interface ChartCompanionBody {
  symbol: string;
  timeframe: string;
  assetClass: "futures" | "forex";
  /** "ratio": a futures root's history restated so each roll has no step (as the chart draws it); "none": raw prices. */
  adjustment: "ratio" | "none";
  /** The clock the stamps are in, in words. */
  clock: string;
  /** First and last VISIBLE bar's stamp (null when no bars). */
  firstVisibleMs: number | null;
  lastVisibleMs: number | null;
  /** The first `warmupCount` rows of `bars` precede the visible range; the rest are visible. */
  warmupCount: number;
  visibleCount: number;
  warmupRequested: number;
  /** True when the read stopped at MAX_BARS_PER_REQUEST before the end of the range. */
  truncated: boolean;
  bars: CompanionBars;
}

export function emptyBars(): CompanionBars {
  return { timestamps: [], open: [], high: [], low: [], close: [], volume: [] };
}

export function clockLabel(assetClass: "futures" | "forex"): string {
  return assetClass === "futures" ? "exchange time (CME Pacific)" : "UTC";
}

export function emptyBody(symbol: string, timeframe: string, assetClass: "futures" | "forex", warmupRequested = WARMUP_BARS_DEFAULT): ChartCompanionBody {
  return {
    symbol, timeframe, assetClass, adjustment: "none", clock: clockLabel(assetClass),
    firstVisibleMs: null, lastVisibleMs: null, warmupCount: 0, visibleCount: 0, warmupRequested, truncated: false,
    bars: emptyBars(),
  };
}

// ── The seven described columns ──────────────────────────────────────────────

export type CompanionColumnKey = "open" | "high" | "low" | "close" | "volume" | "logReturn" | "trueRangePoints";

export interface CompanionColumn {
  key: CompanionColumnKey;
  /** Full name, used as the panel title and in tooltips. */
  title: string;
  /** Short heading for a table column. */
  heading: string;
  /** The notebook's column name, kept so a number can be traced back. */
  notebookName: string;
}

export const COMPANION_COLUMNS: readonly CompanionColumn[] = [
  { key: "open", title: "Open price", heading: "Open price", notebookName: "open" },
  { key: "high", title: "High price", heading: "High price", notebookName: "high" },
  { key: "low", title: "Low price", heading: "Low price", notebookName: "low" },
  { key: "close", title: "Close price", heading: "Close price", notebookName: "close" },
  { key: "volume", title: "Volume", heading: "Volume", notebookName: "volume" },
  { key: "logReturn", title: "Log return (natural log of close over previous close)", heading: "Log return", notebookName: "log_return" },
  { key: "trueRangePoints", title: "True range (price points)", heading: "True range (points)", notebookName: "true_range_points" },
];

// ── Scoring ──────────────────────────────────────────────────────────────────

export interface ScoredBars {
  logReturn: Float64Array;
  trueRangePoints: Float64Array;
  returnTrailingMean: Float64Array;
  returnTrailingStandardDeviation: Float64Array;
  returnZscore: Float64Array;
  returnPercentileInWindow: Float64Array;
  trailingTrueRangePoints: Float64Array;
  trailingTrueRangePercentile: Float64Array;
  /** 1 when the trailing true-range percentile is at least 0.9, 0 when below, NaN while that percentile is warming up. */
  highVolatility: Float64Array;
}

export const HIGH_VOLATILITY_PERCENTILE = 0.9;

function filled(length: number): Float64Array {
  return new Float64Array(length).fill(Number.NaN);
}

/**
 * For each position, the share of the previous `window` values at or below the
 * current one (0 to 1). NaN until `window` earlier values exist, and NaN when
 * the current value or any of them is NaN.
 */
export function trailingPercentile(values: ArrayLike<number>, window: number): Float64Array {
  const result = filled(values.length);
  for (let index = window; index < values.length; index += 1) {
    const current = values[index] as number;
    if (Number.isNaN(current)) continue;
    let atOrBelow = 0;
    let usable = true;
    for (let back = index - window; back < index; back += 1) {
      const earlier = values[back] as number;
      if (Number.isNaN(earlier)) {
        usable = false;
        break;
      }
      if (earlier <= current) atOrBelow += 1;
    }
    if (usable) result[index] = atOrBelow / window;
  }
  return result;
}

/** Rolling mean over the `window` values ending at each position; NaN until full, NaN if any value in it is NaN. */
export function rollingMean(values: ArrayLike<number>, window: number): Float64Array {
  const result = filled(values.length);
  for (let index = window - 1; index < values.length; index += 1) {
    let total = 0;
    let usable = true;
    for (let back = index - window + 1; back <= index; back += 1) {
      const value = values[back] as number;
      if (Number.isNaN(value)) {
        usable = false;
        break;
      }
      total += value;
    }
    if (usable) result[index] = total / window;
  }
  return result;
}

/**
 * Score every bar. `bars` holds warm-up rows first, then the visible ones; the
 * result spans all of them and a caller slices the visible part. Definitions,
 * with r the log return and w the trailing window:
 *   log return       r[i] = ln(close[i] / close[i-1]); NaN on the first bar
 *   true range       max(high - low, |high - previous close|, |low - previous close|); NaN on the first bar
 *   trailing mean m  mean of r[i-w .. i-1]: the w returns BEFORE bar i, never r[i] itself
 *   trailing sd s    sample standard deviation (n - 1) of those same w returns
 *   z                (r[i] - m) / s, NaN when s is 0 or any of the w returns is unknown
 */
export function scoreBars(bars: { high: ArrayLike<number>; low: ArrayLike<number>; close: ArrayLike<number> }, window: number): ScoredBars {
  const count = bars.close.length;
  const logReturn = filled(count);
  const trueRangePoints = filled(count);
  for (let index = 1; index < count; index += 1) {
    const close = bars.close[index] as number;
    const previousClose = bars.close[index - 1] as number;
    const ratio = close / previousClose;
    const value = Math.log(ratio);
    logReturn[index] = Number.isFinite(value) ? value : Number.NaN;
    const high = bars.high[index] as number;
    const low = bars.low[index] as number;
    trueRangePoints[index] = Math.max(high - low, Math.abs(high - previousClose), Math.abs(low - previousClose));
  }

  const returnTrailingMean = filled(count);
  const returnTrailingStandardDeviation = filled(count);
  const returnZscore = filled(count);
  for (let index = window; index < count; index += 1) {
    let total = 0;
    let usable = true;
    for (let back = index - window; back < index; back += 1) {
      const value = logReturn[back] as number;
      if (Number.isNaN(value)) {
        usable = false;
        break;
      }
      total += value;
    }
    if (!usable) continue;
    const mean = total / window;
    let sumSquares = 0;
    for (let back = index - window; back < index; back += 1) {
      const delta = (logReturn[back] as number) - mean;
      sumSquares += delta * delta;
    }
    const deviation = Math.sqrt(sumSquares / (window - 1));
    returnTrailingMean[index] = mean;
    returnTrailingStandardDeviation[index] = deviation;
    const current = logReturn[index] as number;
    if (deviation > 0 && !Number.isNaN(current)) returnZscore[index] = (current - mean) / deviation;
  }

  const returnPercentileInWindow = trailingPercentile(logReturn, window);
  const trailingTrueRangePoints = rollingMean(trueRangePoints, window);
  const trailingTrueRangePercentile = trailingPercentile(trailingTrueRangePoints, window);
  const highVolatility = filled(count);
  for (let index = 0; index < count; index += 1) {
    const rank = trailingTrueRangePercentile[index] as number;
    if (!Number.isNaN(rank)) highVolatility[index] = rank >= HIGH_VOLATILITY_PERCENTILE ? 1 : 0;
  }

  return {
    logReturn, trueRangePoints, returnTrailingMean, returnTrailingStandardDeviation, returnZscore,
    returnPercentileInWindow, trailingTrueRangePoints, trailingTrueRangePercentile, highVolatility,
  };
}

/** The visible view of a scored frame: every array sliced from `from` on (zero-copy). */
export function sliceScored(scored: ScoredBars, from: number): ScoredBars {
  const out = {} as Record<string, Float64Array>;
  for (const [key, value] of Object.entries(scored)) out[key] = value.subarray(from);
  return out as unknown as ScoredBars;
}

export interface FloatBars {
  timestamps: Float64Array;
  open: Float64Array;
  high: Float64Array;
  low: Float64Array;
  close: Float64Array;
  volume: Float64Array;
}

export function toFloatBars(bars: CompanionBars): FloatBars {
  return {
    timestamps: Float64Array.from(bars.timestamps),
    open: Float64Array.from(bars.open),
    high: Float64Array.from(bars.high),
    low: Float64Array.from(bars.low),
    close: Float64Array.from(bars.close),
    volume: Float64Array.from(bars.volume),
  };
}

export interface CompanionFrame {
  /** Visible bars only. */
  bars: FloatBars;
  /** Scored over warm-up + visible, sliced to the visible bars. */
  scored: ScoredBars;
  /** The whole scored frame including warm-up, for a bar's earlier window. */
  scoredWithWarmup: ScoredBars;
  warmupCount: number;
  window: number;
}

export function buildFrame(body: ChartCompanionBody, window: number): CompanionFrame {
  const all = toFloatBars(body.bars);
  const scoredWithWarmup = scoreBars(all, window);
  const from = body.warmupCount;
  return {
    bars: {
      timestamps: all.timestamps.subarray(from), open: all.open.subarray(from), high: all.high.subarray(from),
      low: all.low.subarray(from), close: all.close.subarray(from), volume: all.volume.subarray(from),
    },
    scored: sliceScored(scoredWithWarmup, from),
    scoredWithWarmup,
    warmupCount: from,
    window,
  };
}

export function columnValues(frame: CompanionFrame, key: CompanionColumnKey): Float64Array {
  switch (key) {
    case "logReturn": return frame.scored.logReturn;
    case "trueRangePoints": return frame.scored.trueRangePoints;
    default: return frame.bars[key];
  }
}

// ── Eight numbers ────────────────────────────────────────────────────────────

/**
 * The eight numbers plus the count of finite values. As in the notebook a
 * constant column has no skewness or kurtosis (null, not zero); the shape
 * numbers need 3 and 4 observations.
 */
export function describeValues(values: ArrayLike<number>): LensEightNumberSummary {
  const summary = eightNumberSummary(values);
  if (summary.count > 0 && summary.minimum === summary.maximum) return { ...summary, skewness: null, kurtosis: null };
  return summary;
}

// ── Unusual moves ────────────────────────────────────────────────────────────

export interface UnusualMoves {
  upIndices: number[];
  downIndices: number[];
  scoredCount: number;
  unscoredCount: number;
}

export function findUnusualMoves(zscore: ArrayLike<number>, threshold: number): UnusualMoves {
  const upIndices: number[] = [];
  const downIndices: number[] = [];
  let scoredCount = 0;
  for (let index = 0; index < zscore.length; index += 1) {
    const z = zscore[index] as number;
    if (Number.isNaN(z)) continue;
    scoredCount += 1;
    if (z >= threshold) upIndices.push(index);
    else if (z <= -threshold) downIndices.push(index);
  }
  return { upIndices, downIndices, scoredCount, unscoredCount: zscore.length - scoredCount };
}

/** Two-sided share of a bell curve beyond +/- threshold standard deviations: 2 (1 - Phi(threshold)). Relative error 1.2e-7. */
export function normalTwoSidedShare(threshold: number): number {
  const x = threshold / Math.SQRT2;
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const coefficients = [-1.26551223, 1.00002368, 0.37409196, 0.09678418, -0.18628806, 0.27886807, -1.13520398, 1.48851587, -0.82215223, 0.17087277];
  let polynomial = 0;
  for (let power = coefficients.length - 1; power >= 0; power -= 1) polynomial = (coefficients[power] as number) + t * polynomial;
  const ans = t * Math.exp(-z * z + polynomial);
  return x >= 0 ? ans : 2 - ans;
}

/** The observed share of scored bars with |z| at or above each threshold. */
export function observedTailShares(zscore: ArrayLike<number>, thresholds: readonly number[]): Array<number | null> {
  const absolute: number[] = [];
  for (let index = 0; index < zscore.length; index += 1) {
    const z = zscore[index] as number;
    if (!Number.isNaN(z)) absolute.push(Math.abs(z));
  }
  absolute.sort((a, b) => a - b);
  return thresholds.map((threshold) => {
    if (absolute.length === 0) return null;
    let low = 0;
    let high = absolute.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if ((absolute[middle] as number) < threshold) low = middle + 1;
      else high = middle;
    }
    return (absolute.length - low) / absolute.length;
  });
}

// ── The selected bar ─────────────────────────────────────────────────────────

/**
 * The visible bar a selected stamp means: the exact bar when the click landed
 * on one, else the last visible bar at or before it, and nothing when the
 * stamp lies outside the visible bars (the last visible bar is not it).
 */
export function resolveSelectedIndex(visibleTimestamps: ArrayLike<number>, selectedMs: number | null): number | null {
  const count = visibleTimestamps.length;
  if (selectedMs === null || count === 0) return null;
  if (selectedMs < (visibleTimestamps[0] as number) || selectedMs > (visibleTimestamps[count - 1] as number)) return null;
  let low = 0;
  let high = count - 1;
  let found = 0;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if ((visibleTimestamps[middle] as number) <= selectedMs) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}

export interface SelectedBar {
  index: number;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  logReturn: number | null;
  trueRangePoints: number | null;
  returnZscore: number | null;
  returnPercentileInWindow: number | null;
  trailingTrueRangePercentile: number | null;
}

function known(value: number): number | null {
  return Number.isNaN(value) ? null : value;
}

export function selectedBar(frame: CompanionFrame, index: number): SelectedBar {
  return {
    index,
    timestamp: frame.bars.timestamps[index] as number,
    open: frame.bars.open[index] as number,
    high: frame.bars.high[index] as number,
    low: frame.bars.low[index] as number,
    close: frame.bars.close[index] as number,
    volume: frame.bars.volume[index] as number,
    logReturn: known(frame.scored.logReturn[index] as number),
    trueRangePoints: known(frame.scored.trueRangePoints[index] as number),
    returnZscore: known(frame.scored.returnZscore[index] as number),
    returnPercentileInWindow: known(frame.scored.returnPercentileInWindow[index] as number),
    trailingTrueRangePercentile: known(frame.scored.trailingTrueRangePercentile[index] as number),
  };
}

/** The selected bar in a sentence, exactly as the notebook words it (bold markers removed: the page styles the numbers). */
export function describeSelectedBar(bar: SelectedBar, window: number): { sentence: string; volatility: string | null } {
  let sentence: string;
  if (bar.returnZscore === null) {
    sentence = `This bar has no z-score yet: fewer than ${window} earlier returns exist for it.`;
  } else {
    const direction = bar.returnZscore > 0 ? "above" : "below";
    sentence = `This bar's return sat ${Math.abs(bar.returnZscore).toFixed(2)} standard deviations ${direction} the average of the ${window} bars before it, and was at or above ${bar.returnPercentileInWindow === null ? "?" : (100 * bar.returnPercentileInWindow).toFixed(0)}% of them.`;
  }
  const volatility = bar.trailingTrueRangePercentile === null
    ? null
    : `Its trailing true range was at or above ${(100 * bar.trailingTrueRangePercentile).toFixed(0)}% of the previous ${window} values${bar.trailingTrueRangePercentile >= HIGH_VOLATILITY_PERCENTILE ? " (high volatility)." : "."}`;
  return { sentence, volatility };
}

/** The `window` log returns before bar `index` of the visible frame (fewer when warm-up runs out), for the rank picture. */
export function earlierReturns(frame: CompanionFrame, index: number): number[] {
  const absolute = frame.warmupCount + index;
  const out: number[] = [];
  for (let back = Math.max(0, absolute - frame.window); back < absolute; back += 1) {
    const value = frame.scoredWithWarmup.logReturn[back] as number;
    if (!Number.isNaN(value)) out.push(value);
  }
  return out;
}

// ── Bins (Vega-Lite's "nice" bins, as the notebook's altair histograms drew them) ──

export interface CountBin {
  lower: number;
  upper: number;
}

/**
 * Bin edges over [minimum, maximum] at a nice step, as Vega's `bin` picks them
 * for `maxbins`: a power-of-ten step refined by 5 and 2 while the count of bins
 * stays within `maxBins`. A constant column is one bin.
 */
export function niceBins(minimum: number, maximum: number, maxBins: number): CountBin[] {
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) return [];
  const span = maximum - minimum;
  if (!(span > 0)) return [{ lower: minimum, upper: minimum }];
  const base = 10;
  const logBase = Math.log(base);
  const level = Math.ceil(Math.log(maxBins) / logBase);
  let step = Math.pow(base, Math.round(Math.log(span) / logBase) - level);
  while (Math.ceil(span / step) > maxBins) step *= base;
  for (const divisor of [5, 2]) {
    const candidate = step / divisor;
    if (span / candidate <= maxBins) step = candidate;
  }
  const start = Math.floor(minimum / step) * step;
  const binCount = Math.floor((maximum - start) / step) + 1;
  return Array.from({ length: binCount }, (_, index) => ({ lower: start + index * step, upper: start + (index + 1) * step }));
}

/** Counts per bin (half-open [lower, upper)) of the finite values whose stamp lies in [from, to] (whole range when null). */
export function countInBins(bins: readonly CountBin[], values: ArrayLike<number>, stamps?: ArrayLike<number>, range?: { from: number; to: number } | null): number[] {
  const counts = new Array<number>(bins.length).fill(0);
  if (bins.length === 0) return counts;
  const first = bins[0] as CountBin;
  const step = (bins[0] as CountBin).upper - first.lower;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index] as number;
    if (!Number.isFinite(value)) continue;
    if (range && stamps) {
      const stamp = stamps[index] as number;
      if (stamp < range.from || stamp > range.to) continue;
    }
    const position = step > 0 ? Math.min(bins.length - 1, Math.max(0, Math.floor((value - first.lower) / step))) : 0;
    counts[position] = (counts[position] as number) + 1;
  }
  return counts;
}

export function finiteExtent(values: ArrayLike<number>): { minimum: number; maximum: number } | null {
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index] as number;
    if (!Number.isFinite(value)) continue;
    if (value < minimum) minimum = value;
    if (value > maximum) maximum = value;
  }
  return minimum <= maximum ? { minimum, maximum } : null;
}

// ── Thinning a long series for a line chart ──────────────────────────────────

/**
 * At most about `maxPoints` indices of a series, keeping each bucket's lowest
 * and highest value so a spike survives the thinning. Unknown (NaN) values are
 * skipped. Indices come back ascending.
 */
export function thinIndices(values: ArrayLike<number>, maxPoints: number): number[] {
  const known: number[] = [];
  for (let index = 0; index < values.length; index += 1) {
    if (!Number.isNaN(values[index] as number)) known.push(index);
  }
  if (known.length <= maxPoints) return known;
  const buckets = Math.max(1, Math.floor(maxPoints / 2));
  const size = known.length / buckets;
  const keep = new Set<number>([known[0] as number, known[known.length - 1] as number]);
  for (let bucket = 0; bucket < buckets; bucket += 1) {
    const from = Math.floor(bucket * size);
    const to = Math.min(known.length, Math.floor((bucket + 1) * size));
    let lowest = known[from] as number;
    let highest = lowest;
    for (let position = from; position < to; position += 1) {
      const index = known[position] as number;
      if ((values[index] as number) < (values[lowest] as number)) lowest = index;
      if ((values[index] as number) > (values[highest] as number)) highest = index;
    }
    keep.add(lowest);
    keep.add(highest);
  }
  return [...keep].sort((a, b) => a - b);
}

// ── What would be drawn on the chart ─────────────────────────────────────────

export const OVERLAY_SOURCE = "chart_companion";
const MAX_ITEMS = 2_000;

export interface OverlayChoices {
  markers: boolean;
  levels: boolean;
  zones: boolean;
  selectedLine: boolean;
}

/** Stamps are drawn as the chart's own clock; this is the one place the drawn colours are chosen (Okabe-Ito, readable on the dark chart). */
export const OVERLAY_COLORS = {
  up: "#E69F00",
  down: "#0072B2",
  high: "#CC79A7",
  low: "#009E73",
  volumeWeightedAveragePrice: "#F0E442",
  zone: "#56B4E9",
  selected: "#D55E00",
} as const;

export function buildOverlays(frame: CompanionFrame, threshold: number, selectedIndex: number | null, choices: OverlayChoices): Overlay[] {
  const overlays: Overlay[] = [];
  const { bars, scored } = frame;
  const count = bars.timestamps.length;
  if (count === 0) return overlays;

  if (choices.markers) {
    const moves = findUnusualMoves(scored.returnZscore, threshold);
    const groups: Array<{ indices: number[]; id: string; label: string; position: "above" | "below"; shape: "arrowUp" | "arrowDown"; color: string }> = [
      { indices: moves.upIndices, id: "unusual_up_moves", label: "Unusual up move (return z-score)", position: "below", shape: "arrowUp", color: OVERLAY_COLORS.up },
      { indices: moves.downIndices, id: "unusual_down_moves", label: "Unusual down move (return z-score)", position: "above", shape: "arrowDown", color: OVERLAY_COLORS.down },
    ];
    for (const group of groups) {
      // The chart takes 2,000 markers per overlay: keep the largest moves, then put them in time order.
      const largest = [...group.indices].sort((a, b) => Math.abs(scored.returnZscore[b] as number) - Math.abs(scored.returnZscore[a] as number)).slice(0, MAX_ITEMS).sort((a, b) => a - b);
      if (largest.length === 0) continue;
      overlays.push({
        kind: "marker", id: group.id, label: group.label, color: group.color,
        markers: largest.map((index) => ({ time: bars.timestamps[index] as number, position: group.position, shape: group.shape, text: (scored.returnZscore[index] as number).toFixed(1) })),
      });
    }
  }

  if (choices.levels) {
    let highest = Number.NEGATIVE_INFINITY;
    let lowest = Number.POSITIVE_INFINITY;
    let weighted = 0;
    let volumeTotal = 0;
    for (let index = 0; index < count; index += 1) {
      const high = bars.high[index] as number;
      const low = bars.low[index] as number;
      const volume = bars.volume[index] as number;
      if (high > highest) highest = high;
      if (low < lowest) lowest = low;
      weighted += ((high + low + (bars.close[index] as number)) / 3) * volume;
      volumeTotal += volume;
    }
    overlays.push({ kind: "level", id: "visible_high", label: "Visible high", color: OVERLAY_COLORS.high, price: highest, style: "dashed" });
    overlays.push({ kind: "level", id: "visible_low", label: "Visible low", color: OVERLAY_COLORS.low, price: lowest, style: "dashed" });
    if (volumeTotal > 0) {
      overlays.push({
        kind: "level", id: "visible_volume_weighted_average_price", label: "Visible volume-weighted average price",
        color: OVERLAY_COLORS.volumeWeightedAveragePrice, price: weighted / volumeTotal, style: "dashed",
      });
    }
  }

  if (choices.zones) {
    const spans: Array<{ start: number; end: number; text: string }> = [];
    let runStart = -1;
    for (let index = 0; index <= count; index += 1) {
      const hot = index < count && scored.highVolatility[index] === 1;
      if (hot && runStart < 0) runStart = index;
      if (!hot && runStart >= 0) {
        spans.push({ start: bars.timestamps[runStart] as number, end: bars.timestamps[index - 1] as number, text: "high volatility" });
        runStart = -1;
      }
    }
    if (spans.length > 0) overlays.push({ kind: "zone", id: "high_volatility", label: "high volatility", color: OVERLAY_COLORS.zone, zones: spans.slice(0, MAX_ITEMS) });
  }

  if (choices.selectedLine && selectedIndex !== null) {
    overlays.push({ kind: "vline", id: "selected_bar", label: "Selected bar", color: OVERLAY_COLORS.selected, times: [bars.timestamps[selectedIndex] as number] });
  }
  return overlays;
}

export interface OverlayManifestRow {
  overlay: string;
  drawnAs: string;
  color: string;
  itemCount: number;
  price: number | null;
}

const KIND_WORDS: Record<string, string> = { marker: "arrows", level: "horizontal line", zone: "shaded spans", vline: "vertical line", line: "line", band: "shaded boxes" };

export function overlayManifest(overlays: readonly Overlay[]): OverlayManifestRow[] {
  return overlays.map((overlay) => {
    let itemCount = 1;
    let price: number | null = null;
    if (overlay.kind === "marker") itemCount = overlay.markers.length;
    else if (overlay.kind === "zone") itemCount = overlay.zones.length;
    else if (overlay.kind === "vline") itemCount = overlay.times.length;
    else if (overlay.kind === "level") price = overlay.price;
    return { overlay: overlay.label ?? overlay.id, drawnAs: KIND_WORDS[overlay.kind] ?? overlay.kind, color: overlay.color ?? "", itemCount, price };
  });
}

// ── Display helpers ──────────────────────────────────────────────────────────

/** The stamped instant as wall-clock digits, `YYYY-MM-DD HH:MM`. */
export function barTimeText(milliseconds: number): string {
  return new Date(milliseconds).toISOString().slice(0, 16).replace("T", " ");
}

/** Six significant digits, the notebook's ",.6g". */
export function sixSignificant(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (value === 0) return "0";
  const absolute = Math.abs(value);
  if (absolute >= 1e-4 && absolute < 1e6) {
    const text = Number(value.toPrecision(6)).toString();
    return absolute >= 1_000 ? Number(text).toLocaleString("en-US", { maximumFractionDigits: 6 }) : text;
  }
  return value.toPrecision(6);
}
