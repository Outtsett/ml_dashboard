/**
 * EURUSD bars, forward labels and distributions: the response bodies of
 * `GET /api/studies/eurusd-bars-and-labels?section=<section>` and the pure
 * arithmetic the handler and the page share. Replaced
 * Trading/forexmodel/notebooks/eurusd.py.
 *
 * Three sections, each cached on its own so a slider drag never recomputes
 * the distribution tables:
 *   window   the candles on screen with each bar's `dir_h<h>` and log return
 *   returns  the log-return distribution, development slice against the sealed fifth
 *   labels   the landed label tables for one timeframe (catalog, class balance, distributions)
 */

export const TIMEFRAMES = ["1m", "5m", "15m", "30m", "1h", "4h", "1d"] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

/** Seconds per bucket, for the SQL `time_bucket`; 1m is read as stored. */
export const BUCKET_INTERVAL: Record<Timeframe, string | null> = {
  "1m": null,
  "5m": "5 minutes",
  "15m": "15 minutes",
  "30m": "30 minutes",
  "1h": "1 hour",
  "4h": "4 hours",
  "1d": "1 day",
};

export const SECTIONS = ["window", "returns", "labels"] as const;
export type Section = (typeof SECTIONS)[number];

/** `split.dev_oos_split`: the first 80% of the bars is development, the last fifth is sealed. */
export const DEVELOPMENT_FRACTION = 0.8;

/** Bars drawn at most (the notebook's slider stops at 400). */
export const MAXIMUM_BARS_SHOWN = 400;
export const MINIMUM_BARS_SHOWN = 20;

/** Where a marker sits relative to its bar: `high * 1.0004` for up, `low * 0.9996` for down. */
export const MARKER_OFFSET_ABOVE = 1.0004;
export const MARKER_OFFSET_BELOW = 0.9996;

/** int(n * 0.8), as `forexmodel.split.dev_oos_split`. */
export function developmentStop(barCount: number): number {
  return Math.floor(barCount * DEVELOPMENT_FRACTION);
}

/**
 * The first bar of the window. `start < 0` means the latest window; otherwise
 * `min(start, max(n - shown, 0))`, as the notebook's `i0`.
 */
export function windowStartIndex(barCount: number, barsShown: number, start: number): number {
  const latest = Math.max(barCount - barsShown, 0);
  return start < 0 ? latest : Math.min(start, latest);
}

/** `np.diff(np.log(close)) * 1e4` for one step: a log return in basis points. */
export function logReturnBasisPoints(previousClose: number, close: number): number | null {
  if (!(previousClose > 0) || !(close > 0)) return null;
  return (Math.log(close) - Math.log(previousClose)) * 10_000;
}

export type ForwardDirection = -1 | 0 | 1;

export interface WindowBar {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** Null on the window's first bar, as the notebook prepends NaN. */
  logReturnBasisPoints: number | null;
  /** Null: the bar carries no label at this horizon (its forward window crosses a gap, or labels are not landed). */
  forwardDirection: ForwardDirection | null;
}

export interface WindowCounts {
  up: number;
  ranging: number;
  down: number;
  unlabelled: number;
}

/** The notebook's title counts: up / ranging / down / unlabelled bars in the window. */
export function windowCounts(bars: ReadonlyArray<Pick<WindowBar, "forwardDirection">>): WindowCounts {
  const counts: WindowCounts = { up: 0, ranging: 0, down: 0, unlabelled: 0 };
  for (const bar of bars) {
    if (bar.forwardDirection === 1) counts.up += 1;
    else if (bar.forwardDirection === 0) counts.ranging += 1;
    else if (bar.forwardDirection === -1) counts.down += 1;
    else counts.unlabelled += 1;
  }
  return counts;
}

export interface WindowBody {
  timeframe: Timeframe;
  barCount: number;
  /** Milliseconds since the epoch, UTC; null when the lake holds no EURUSD bars. */
  firstTimestamp: number | null;
  lastTimestamp: number | null;
  developmentBarCount: number;
  sealedBarCount: number;
  windowStartIndex: number;
  bars: WindowBar[];
  /** The horizons (in bars) `dir_h<h>` is landed for at this timeframe, ascending. */
  horizons: number[];
  /** The horizon the markers show (the smallest landed one when the request asked for none). */
  horizon: number | null;
  labelsLanded: boolean;
}

export interface ReturnStatistics {
  group: "development" | "sealed";
  count: number;
  mean: number | null;
  median: number | null;
  standardDeviation: number | null;
  skewness: number | null;
  excessKurtosis: number | null;
  percentile25: number | null;
  percentile75: number | null;
  minimum: number | null;
  maximum: number | null;
  droppedCount: number;
  percentile1: number | null;
  percentile5: number | null;
  percentile95: number | null;
  percentile99: number | null;
}

export interface ReturnHistogramBin {
  lower: number;
  upper: number;
  developmentCount: number;
  sealedCount: number;
  /** Share of each group's returns, so a fifth and four fifths compare. */
  developmentShare: number;
  sealedShare: number;
}

export interface ReturnsBody {
  timeframe: Timeframe;
  barCount: number;
  developmentBarCount: number;
  sealedBarCount: number;
  statistics: ReturnStatistics[];
  histogram: ReturnHistogramBin[];
  /** The histogram covers this percentile range of all returns; the rest is counted in the tails. */
  histogramLower: number | null;
  histogramUpper: number | null;
  belowRangeCount: { development: number; sealed: number };
  aboveRangeCount: { development: number; sealed: number };
}

export interface LabelColumn {
  labelColumn: string;
  displayName: string;
  family: string;
  role: string;
  dataType: string;
  valueSet: string;
  horizonOrWindowBars: number | null;
  rowCount: number;
  knownCount: number;
  knownShare: number | null;
  distinctCount: number;
  meaning: string;
}

export interface ClassBalanceRow {
  labelColumn: string;
  displayName: string;
  classValue: number;
  classCount: number;
  knownCount: number;
  classShare: number;
}

export interface LabelDistribution {
  labelColumn: string;
  displayName: string;
  count: number;
  mean: number | null;
  median: number | null;
  standardDeviation: number | null;
  skewness: number | null;
  excessKurtosis: number | null;
  percentile25: number | null;
  percentile75: number | null;
  minimum: number | null;
  maximum: number | null;
  droppedCount: number;
  percentile1: number | null;
  percentile5: number | null;
  percentile95: number | null;
  percentile99: number | null;
  countBelowHistogramRange: number;
  countAboveHistogramRange: number;
  /** The 60 bins the page draws this column with. */
  bins: Array<{ lower: number; upper: number; count: number }>;
}

export interface HorizonGridRow {
  horizonBars: number;
  horizonTradingDays: number;
  upperBoundaryTStatistic: number | null;
  lowerBoundaryTStatistic: number | null;
  magnitudeBoundary: number | null;
  abstainShare: number | null;
  largeMoveShare: number | null;
  labelledBarShare: number | null;
  upShare: number | null;
  rangingShare: number | null;
  downShare: number | null;
  trendingShare: number | null;
  shuffledTrendingShare: number | null;
  trendingExcessOverShuffle: number | null;
  kept: boolean;
}

export interface LabelRunInformation {
  barCount: number;
  firstBarTimestamp: number | null;
  lastBarTimestamp: number | null;
  developmentBarCount: number;
  labelColumnCount: number;
  horizons: number[];
  builtAt: number | null;
}

export interface LabelsBody {
  timeframe: Timeframe;
  landed: boolean;
  run: LabelRunInformation | null;
  catalog: LabelColumn[];
  classBalance: ClassBalanceRow[];
  distributions: LabelDistribution[];
  grid: HorizonGridRow[];
}

/** The description of a horizon for a control: "360 bars (0.25 trading days)". */
export function horizonLabel(horizonBars: number, tradingDays: number | null | undefined): string {
  return tradingDays && Number.isFinite(tradingDays) ? `${horizonBars} bars (${tradingDays} trading days)` : `${horizonBars} bars`;
}
