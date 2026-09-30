/**
 * Model Lens analytics — four questions asked of one model's out-of-sample record.
 *
 *   What happened    (descriptive)  a sentence built from the numbers, the eight-number summary of the
 *                                   per-trade net result, trades by side, equity against buy-and-hold,
 *                                   and the deepest drawdown with its dates.
 *   Why              (diagnostic)   where the errors sit: hour of the session, day of the week,
 *                                   probability decile, regime (regime.ts) and calibration, the
 *                                   attribution summary, and the three largest measured causes of loss.
 *   What comes next  (predictive)   the most recent prediction with its conformal interval, the
 *                                   regime it was made in, the rolling hit-rate trend and the drift alarm.
 *   What to do       (prescriptive) the threshold that maximised net result per trade on these rows
 *                                   (with its bootstrap interval and the in-sample warning), expected
 *                                   value by conviction after costs, the break-even hit rate, a capped
 *                                   fractional Kelly size, and a recommendation from explicit rules.
 *
 * Pure: the evaluation (evaluate.ts), the manifest and — when the page has loaded them — every bar of
 * the record come in, plain objects go out. No clock is read here: the caller passes `nowSeconds`.
 *
 * Reused rather than re-derived: Wilson intervals, the session-day rule and the segment minimum come
 * from the market analytics (src/shared/analytics/compute.ts); trades are simulated by simulate.ts
 * under the lens's own rule, intervals on trade means by bootstrap.ts's moving-block bootstrap, the
 * regime table is regime.ts's, and the drift alarm is drift.ts's Page-Hinkley test.
 *
 * Sample sizes. Every rate carries the count it rests on. A rate over rows uses the INDEPENDENT count
 * (rows / horizon), because a label H rows ahead shares its price move with the next H - 1 labels;
 * trades never overlap (one at a time), so a trade count is already independent. Below these minimums a
 * value is not shown and the reason is given instead:
 *   ANALYTICS_MINIMUM_SEGMENT_TRADES   = 20  trades behind a win rate, mean or break-even rate
 *   ANALYTICS_MINIMUM_INDEPENDENT_ROWS = 20  independent rows behind a hit rate, up rate or calibration
 *   ANALYTICS_MINIMUM_DECISION_TRADES  = 30  trades behind a Kelly size or a "trade" recommendation
 */

import { MIN_SEGMENT_TRADES, histogram, sessionDay, wilson } from "../analytics/compute";
import type { HistogramBin, Probability } from "../analytics/types";
import type { Overlay } from "../chartLink";
import { blockBootstrap, BOOTSTRAP_RESAMPLE_COUNT } from "./bootstrap";
import { coverageQuantileIndices, MEDIAN_QUANTILE_INDEX, readLabel, resolveRange, type LensRowRange } from "./series";
import { simulateTrades, tradeCostUsd } from "./simulate";
import { eightNumberSummary, emptyEstimate, meanEstimate } from "./stats";
import {
  LENS_QUANTILE_LEVELS,
  type LensBar,
  type LensEightNumberSummary,
  type LensEstimate,
  type LensEvaluation,
  type LensEvaluationParams,
  type LensFeatureFamilyKey,
  type LensManifest,
  type LensRegime,
  type LensSeries,
  type LensTrade,
} from "./types";

// ─── Documented constants ────────────────────────────────────────────────────

export const ANALYTICS_MINIMUM_SEGMENT_TRADES = MIN_SEGMENT_TRADES;
export const ANALYTICS_MINIMUM_INDEPENDENT_ROWS = 20;
export const ANALYTICS_MINIMUM_DECISION_TRADES = 30;
/** Entry thresholds searched: 0.50, 0.51, ..., 0.95. */
export const ANALYTICS_THRESHOLD_GRID: readonly number[] = Array.from({ length: 46 }, (_, index) =>
  Math.round((0.5 + index * 0.01) * 100) / 100,
);
/** Fraction of full Kelly suggested, and the cap on it (the same rule as the market analytics). */
export const ANALYTICS_KELLY_FRACTION = 0.5;
export const ANALYTICS_KELLY_CAP = 0.25;
/** Conviction = max(P(up), 1 - P(up)), the probability of the side the model leaned to. */
export const ANALYTICS_CONVICTION_EDGES: readonly number[] = [0.5, 0.55, 0.6, 0.65, 0.7, 1];
export const ANALYTICS_DECILE_COUNT = 10;
export const ANALYTICS_HISTOGRAM_BIN_COUNT = 20;
/** Every overlay set the lens puts on the Market chart is named `model_lens:<modelId>`. */
export const LENS_CHART_SOURCE_PREFIX = "model_lens:";
/** Most markers one chart overlay may carry (src/shared/chartLink.ts). */
export const LENS_CHART_MAX_MARKERS = 2000;

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const WEEKDAY_ORDER = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
const REGIME_WORDS: Record<LensRegime, string> = { bull: "bull", bear: "bear", sideways: "sideways" };

// ─── Output contract ─────────────────────────────────────────────────────────

export interface LensAnalyticsInput {
  evaluation: LensEvaluation;
  manifest: LensManifest;
  /**
   * Every bar of the record, rows 0 .. barCount - 1 in order (GET /bars paged over the whole record).
   * Null when the page has not loaded them: every view that needs individual rows says so instead.
   */
  bars: LensBar[] | null;
  /** Why `bars` is null, shown in place of the row-level views. */
  barsReason?: string | null;
  /** The wall clock, epoch seconds; the age of the latest prediction is measured against it. */
  nowSeconds: number;
}

/** One slice of the record (a side, an hour, a weekday...), rows and trades counted separately. */
export interface LensAnalyticsSegment {
  key: string;
  label: string;
  /** Rows in the slice that carry a direction label. */
  labelledRowCount: number;
  /** labelledRowCount / horizon: the independent outcomes a row rate rests on. */
  independentRowCount: number;
  /** Share of labelled rows whose side at P(up) 0.5 matched the label, Wilson 95%. Null below the minimum. */
  directionHitRate: Probability | null;
  directionReason: string | null;
  tradeCount: number;
  /** Share of trades with a positive net result, Wilson 95%. Null below the minimum. */
  winRate: Probability | null;
  meanTradeNetUsd: number | null;
  tradeReason: string | null;
  /** Sum of the slice's trade net results: an accounting fact, shown at any count. */
  totalNetUsd: number;
}

export interface LensAnalyticsDrawdown {
  /** Deepest fall of model equity below its running peak, in US dollars (negative or zero). */
  maximumDrawdownUsd: number;
  /** Null when the peak is the start of the record (equity never rose above zero first). */
  peakTimestampSeconds: number | null;
  troughTimestampSeconds: number | null;
  /** Null when equity never regained the peak before the record ended. */
  recoveryTimestampSeconds: number | null;
  /** Bars from peak to trough. */
  declineBarCount: number;
  /** "every bar of the record" or "the evaluation's equity points (downsampled)". */
  basis: string;
  sentence: string;
}

export interface LensAnalyticsHappened {
  explanation: string;
  summarySentence: string;
  barCount: number;
  tradeCount: number;
  totalNetUsd: number;
  grossUsd: number;
  costPerTradeUsd: number;
  costPerTradeTicks: number;
  /** Share of trades whose price moved the traded way before costs (gross > 0). */
  directionRight: Probability | null;
  /** (average gross loss + cost) / (average gross win + average gross loss). */
  breakEvenHitRate: number | null;
  breakEvenReason: string | null;
  tradeNetSummary: LensEightNumberSummary;
  tradeNetSummaryReason: string | null;
  tradeNetHistogram: HistogramBin[];
  sides: LensAnalyticsSegment[];
  equity: {
    modelNetUsd: number;
    buyHoldNetUsd: number | null;
    differenceUsd: number | null;
    points: Array<{ timestampSeconds: number; modelCumulativeUsd: number; buyHoldCumulativeUsd: number | null }>;
    sentence: string;
  };
  drawdown: LensAnalyticsDrawdown;
  /** Where the trades came from: re-simulated over every bar, or the evaluation's own list. */
  tradesBasis: string;
}

export interface LensAnalyticsDecile {
  decile: number;
  probabilityLow: number;
  probabilityHigh: number;
  rowCount: number;
  independentRowCount: number;
  upRate: Probability | null;
  directionHitRate: Probability | null;
  reason: string | null;
}

export interface LensAnalyticsCalibrationBin {
  binLow: number;
  binHigh: number;
  rowCount: number;
  independentRowCount: number;
  meanProbability: number | null;
  observedUpRate: Probability | null;
  reason: string | null;
}

export interface LensAnalyticsLossCause {
  rank: number;
  cause: string;
  lossUsd: number;
  sampleSize: number;
  sentence: string;
}

export interface LensAnalyticsWhy {
  explanation: string;
  byHour: { segments: LensAnalyticsSegment[]; reason: string | null; clock: string };
  byWeekday: { segments: LensAnalyticsSegment[]; reason: string | null };
  byConfidence: { deciles: LensAnalyticsDecile[]; reason: string | null; basis: string };
  byRegime: {
    definition: string;
    rows: Array<{
      regime: LensRegime;
      barCount: number;
      tradeCount: number;
      /** regime.ts's hit rate (normal approximation), kept for reference. */
      hitRate: LensEstimate;
      /** The same share with a Wilson 95% interval on bars ÷ horizon. Null below the minimum. */
      directionHitRate: Probability | null;
      hitRateReason: string | null;
      meanTradeNetUsd: LensEstimate | null;
      meanReason: string | null;
      totalNetUsd: number;
    }>;
  };
  calibration: {
    bins: LensAnalyticsCalibrationBin[];
    labelledRowCount: number;
    independentRowCount: number;
    expectedCalibrationError: number | null;
    reason: string | null;
    sentence: string;
  };
  attribution: {
    available: boolean;
    reason: string | null;
    families: Array<{ family: LensFeatureFamilyKey; label: string; share: number; featureCount: number }>;
    topFeatures: Array<{ name: string; family: LensFeatureFamilyKey; meanAbsoluteShap: number; rank: number }>;
    sentence: string;
  };
  lossCauses: LensAnalyticsLossCause[];
  lossCausesReason: string | null;
}

export interface LensAnalyticsNext {
  explanation: string;
  available: boolean;
  reason: string | null;
  latest: {
    rowIndex: number;
    timestampSeconds: number;
    probabilityUp: number;
    leaning: "up" | "down";
    /** The side the entry threshold opens, or null when the probability does not clear it. */
    signal: "long" | "short" | null;
    threshold: number;
    close: number;
    regime: LensRegime | null;
    ageSeconds: number;
    horizonSeconds: number;
    /** True when the forecast horizon has already passed (age > horizon). */
    isOld: boolean;
    ageText: string;
  } | null;
  interval: {
    coverage: number;
    horizonBars: number;
    lowerBasisPoints: number;
    medianBasisPoints: number;
    upperBasisPoints: number;
    lowerPrice: number;
    medianPrice: number;
    upperPrice: number;
  } | null;
  intervalReason: string | null;
  rollingHitRate: {
    windowBars: number;
    latest: number;
    latestLabelledCount: number;
    earlier: number | null;
    change: number | null;
    /** "flat" when the change is inside the coin-flip band's half-width. */
    trend: "rising" | "falling" | "flat" | "unknown";
    nullBandLower: number;
    nullBandUpper: number;
    insideNullBand: boolean;
  } | null;
  rollingReason: string | null;
  drift: {
    alarmOn: boolean;
    alarmCount: number;
    lastAlarmTradeIndex: number | null;
    lastAlarmTimestampSeconds: number | null;
    tradesSinceLastAlarm: number | null;
    tradeCount: number;
    windowTrades: number;
    rule: string;
  };
  sentences: string[];
}

export interface LensAnalyticsThresholdPoint {
  threshold: number;
  tradeCount: number;
  meanTradeNetUsd: number | null;
  totalNetUsd: number;
  eligible: boolean;
}

export interface LensAnalyticsRule {
  name: string;
  question: string;
  input: string;
  triggered: boolean;
  /** What the rule decides when it is the first one triggered. */
  verdictWhenTriggered: LensAnalyticsVerdict;
}

export type LensAnalyticsVerdict = "trade" | "do_not_trade" | "gather_more_data";

export interface LensAnalyticsToDo {
  explanation: string;
  thresholdSearch: {
    grid: LensAnalyticsThresholdPoint[];
    currentThreshold: number;
    minimumTrades: number;
    best: { threshold: number; tradeCount: number; totalNetUsd: number; meanTradeNetUsd: LensEstimate } | null;
    reason: string | null;
    warning: string;
    sentence: string;
  };
  convictionBuckets: {
    definition: string;
    reason: string | null;
    buckets: Array<{
      label: string;
      convictionLow: number;
      convictionHigh: number;
      rowCount: number;
      independentRowCount: number;
      meanNetUsd: LensEstimate | null;
      profitableShare: Probability | null;
      reason: string | null;
    }>;
  };
  breakEven: {
    tradeCount: number;
    averageGrossWinUsd: number | null;
    averageGrossLossUsd: number | null;
    costPerTradeUsd: number;
    breakEvenHitRate: number | null;
    observedHitRate: Probability | null;
    reason: string | null;
    sentence: string;
  };
  kelly: {
    tradeCount: number;
    winShare: number | null;
    averageNetWinUsd: number | null;
    averageNetLossUsd: number | null;
    payoffRatio: number | null;
    fullKellyFraction: number | null;
    suggestedFraction: number | null;
    fraction: number;
    cap: number;
    reason: string | null;
    sentence: string;
  };
  recommendation: {
    verdict: LensAnalyticsVerdict;
    decidingRule: string;
    sentence: string;
    rules: LensAnalyticsRule[];
  };
}

export interface LensAnalytics {
  modelId: string;
  happened: LensAnalyticsHappened;
  why: LensAnalyticsWhy;
  next: LensAnalyticsNext;
  toDo: LensAnalyticsToDo;
  /** Plain words on what the row-level views could use. */
  recordNote: string;
}

// ─── Formatting (sentences are part of the output, so they are pure too) ─────

function usd(value: number): string {
  const magnitude = Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${value < 0 ? "-" : ""}$${magnitude}`;
}

function signedUsd(value: number): string {
  return value > 0 ? `+${usd(value)}` : usd(value);
}

function percent(fraction: number, decimals = 1): string {
  return `${(fraction * 100).toFixed(decimals)}%`;
}

function count(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

function trimmed(value: number, decimals: number): string {
  return Number(value.toFixed(decimals)).toString();
}

function basisPoints(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}`;
}

function price(value: number): string {
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function barDate(seconds: number, barSeconds: number): string {
  const iso = new Date(seconds * 1000).toISOString();
  return barSeconds >= 86_400 ? iso.slice(0, 10) : `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

export function describeAge(seconds: number): string {
  const magnitude = Math.max(0, seconds);
  const day = 86_400;
  if (magnitude >= 2 * day) return `${count(Math.floor(magnitude / day))} days`;
  if (magnitude >= 2 * 3600) return `${count(Math.floor(magnitude / 3600))} hours`;
  if (magnitude >= 120) return `${count(Math.floor(magnitude / 60))} minutes`;
  return `${count(Math.floor(magnitude))} seconds`;
}

const PACIFIC_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** Pacific wall clock minus UTC, in seconds, at a true-UTC instant (-28,800 in winter). */
function pacificOffsetSeconds(utcSeconds: number): number {
  const parts = Object.fromEntries(PACIFIC_PARTS.formatToParts(new Date(utcSeconds * 1000)).map((part) => [part.type, part.value]));
  const wall = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second)) / 1000;
  return wall - utcSeconds;
}

/** The true-UTC instant of a stamp. The lake stores futures as CME Pacific wall
 *  clock labelled UTC (forex is true UTC), so a futures stamp compared with
 *  Date.now() would read ~8 hours old the moment it is made. */
export function trueUtcSeconds(stampSeconds: number, assetClass: "futures" | "forex"): number {
  if (assetClass !== "futures") return stampSeconds;
  const guess = stampSeconds - pacificOffsetSeconds(stampSeconds);
  return stampSeconds - pacificOffsetSeconds(guess);
}

function plural(value: number, noun: string): string {
  return `${count(value)} ${noun}${value === 1 ? "" : "s"}`;
}

function changeWords(change: number, trend: "flat" | "rising" | "falling" | "unknown"): string {
  const points = `${trimmed(Math.abs(change) * 100, 1)} percentage points`;
  if (trend === "flat") return `a change of ${change >= 0 ? "+" : "-"}${points} from`;
  return change > 0 ? `up ${points} from` : `down ${points} from`;
}

function tooFewTrades(tradeCount: number, minimum: number): string {
  return `only ${count(tradeCount)} trade${tradeCount === 1 ? "" : "s"}; at least ${minimum} are needed`;
}

function tooFewRows(independent: number, rows: number): string {
  if (rows === 0) return "no bar falls here";
  return (
    `only about ${plural(Math.floor(independent), "independent outcome")} (${plural(rows, "bar")} ÷ the horizon); ` +
    `at least ${ANALYTICS_MINIMUM_INDEPENDENT_ROWS} are needed`
  );
}

// ─── The record: every bar as a LensSeries, trades re-simulated over it ──────

interface AnalyticsRecord {
  series: LensSeries;
  range: LensRowRange;
  regimes: Array<LensRegime | null>;
  cumulativeNetUsd: Float64Array;
}

/**
 * Rebuild the LensSeries the evaluation was computed from out of the bars the page loaded. Refused
 * (null) unless the bars are the whole record in row order, because a partial record would silently
 * move every row-level number.
 */
export function seriesFromBars(bars: LensBar[], manifest: LensManifest): LensSeries | null {
  const length = bars.length;
  if (length === 0 || length !== manifest.barCount) return null;
  for (let index = 0; index < length; index += 1) {
    if ((bars[index] as LensBar).rowIndex !== index) return null;
  }
  const quantiles = LENS_QUANTILE_LEVELS.map(() => new Float32Array(length).fill(Number.NaN));
  const series: LensSeries = {
    modelId: manifest.modelId,
    length,
    timestampSeconds: new Float64Array(length),
    open: new Float64Array(length),
    high: new Float64Array(length),
    low: new Float64Array(length),
    close: new Float64Array(length),
    volume: new Float64Array(length),
    probabilityUp: new Float32Array(length),
    label: new Int8Array(length),
    realizedReturnBasisPoints: new Float32Array(length),
    predictedQuantilesBasisPoints: quantiles,
    horizonBars: manifest.horizonBars,
    cost: manifest.cost,
  };
  for (let index = 0; index < length; index += 1) {
    const bar = bars[index] as LensBar;
    series.timestampSeconds[index] = bar.timestampSeconds;
    series.open[index] = bar.open;
    series.high[index] = bar.high;
    series.low[index] = bar.low;
    series.close[index] = bar.close;
    series.volume[index] = bar.volume ?? Number.NaN;
    series.probabilityUp[index] = bar.probabilityUp ?? Number.NaN;
    series.label[index] = bar.label ?? -1;
    series.realizedReturnBasisPoints[index] = bar.realizedReturnBasisPoints ?? Number.NaN;
    const known = bar.predictedQuantilesBasisPoints;
    if (known) {
      for (let q = 0; q < quantiles.length; q += 1) (quantiles[q] as Float32Array)[index] = known[q] ?? Number.NaN;
    }
  }
  return series;
}

function buildRecord(bars: LensBar[] | null, manifest: LensManifest, params: LensEvaluationParams): AnalyticsRecord | null {
  if (!bars) return null;
  const series = seriesFromBars(bars, manifest);
  if (!series) return null;
  const range = resolveRange(series, params);
  const regimes = bars.map((bar) => bar.regime);
  const cumulativeNetUsd = new Float64Array(bars.map((bar) => bar.cumulativeNetUsd));
  return { series, range, regimes, cumulativeNetUsd };
}

function simulateOver(record: AnalyticsRecord, params: LensEvaluationParams): LensTrade[] {
  const trades = simulateTrades(record.series, params, record.range).trades;
  for (const trade of trades) trade.regime = record.regimes[trade.entryRowIndex] ?? null;
  return trades;
}

// ─── Segments ────────────────────────────────────────────────────────────────

interface SegmentKey {
  key: string;
  label: string;
}

function buildSegments(
  keys: SegmentKey[],
  record: AnalyticsRecord | null,
  rowKey: ((row: number) => string | null) | null,
  trades: LensTrade[],
  tradeKey: (trade: LensTrade) => string | null,
  horizon: number,
  recordReason: string,
): LensAnalyticsSegment[] {
  const rows = new Map<string, { labelled: number; hits: number }>();
  if (record && rowKey) {
    const { series, range } = record;
    for (let row = range.firstRowIndex; row <= range.lastRowIndex; row += 1) {
      const label = readLabel(series, row);
      const probability = series.probabilityUp[row] as number;
      if (label === null || !Number.isFinite(probability)) continue;
      const key = rowKey(row);
      if (key === null) continue;
      const entry = rows.get(key) ?? { labelled: 0, hits: 0 };
      entry.labelled += 1;
      if ((probability >= 0.5) === (label === 1)) entry.hits += 1;
      rows.set(key, entry);
    }
  }
  const tradeGroups = new Map<string, number[]>();
  for (const trade of trades) {
    const key = tradeKey(trade);
    if (key === null) continue;
    const list = tradeGroups.get(key) ?? [];
    list.push(trade.netUsd);
    tradeGroups.set(key, list);
  }
  return keys.map(({ key, label }) => {
    const row = rows.get(key) ?? { labelled: 0, hits: 0 };
    const independent = row.labelled / Math.max(1, horizon);
    const nets = tradeGroups.get(key) ?? [];
    const wins = nets.filter((net) => net > 0).length;
    const total = nets.reduce((sum, net) => sum + net, 0);
    const enoughRows = record !== null && rowKey !== null && independent >= ANALYTICS_MINIMUM_INDEPENDENT_ROWS;
    const enoughTrades = nets.length >= ANALYTICS_MINIMUM_SEGMENT_TRADES;
    return {
      key,
      label,
      labelledRowCount: row.labelled,
      independentRowCount: independent,
      directionHitRate: enoughRows ? wilson(row.hits, row.labelled, independent) : null,
      directionReason: enoughRows ? null : record === null || rowKey === null ? recordReason : tooFewRows(independent, row.labelled),
      tradeCount: nets.length,
      winRate: enoughTrades ? wilson(wins, nets.length) : null,
      meanTradeNetUsd: enoughTrades ? total / nets.length : null,
      tradeReason: enoughTrades ? null : tooFewTrades(nets.length, ANALYTICS_MINIMUM_SEGMENT_TRADES),
      totalNetUsd: total,
    };
  });
}

function assetClassOf(symbol: string): "futures" | "forex" {
  return /^[A-Z]{6}$/.test(symbol) ? "forex" : "futures";
}

function hourOf(seconds: number): number {
  return new Date(seconds * 1000).getUTCHours();
}

function weekdayOf(seconds: number, assetClass: "futures" | "forex"): string {
  const day = sessionDay(seconds * 1000, assetClass);
  return WEEKDAY_NAMES[new Date(`${day}T00:00:00Z`).getUTCDay()] as string;
}

function convictionBand(probabilityUp: number): number {
  const conviction = Math.max(probabilityUp, 1 - probabilityUp);
  for (let band = 0; band < ANALYTICS_CONVICTION_EDGES.length - 1; band += 1) {
    if (conviction < (ANALYTICS_CONVICTION_EDGES[band + 1] as number) || band === ANALYTICS_CONVICTION_EDGES.length - 2) return band;
  }
  return 0;
}

function convictionLabel(band: number): string {
  const low = ANALYTICS_CONVICTION_EDGES[band] as number;
  const high = ANALYTICS_CONVICTION_EDGES[band + 1] as number;
  return high >= 1 ? `${low.toFixed(2)} and above` : `${low.toFixed(2)} to ${high.toFixed(2)}`;
}

// ─── Descriptive ─────────────────────────────────────────────────────────────

function computeDrawdown(
  timestamps: ArrayLike<number>,
  cumulative: ArrayLike<number>,
  barSeconds: number,
  basis: string,
): LensAnalyticsDrawdown {
  let peak = 0;
  let peakIndex = -1;
  let maximum = 0;
  let maximumPeakIndex = -1;
  let maximumPeakValue = 0;
  let troughIndex = -1;
  for (let index = 0; index < cumulative.length; index += 1) {
    const value = cumulative[index] as number;
    if (value > peak) {
      peak = value;
      peakIndex = index;
    }
    const drawdown = value - peak;
    if (drawdown < maximum) {
      maximum = drawdown;
      troughIndex = index;
      maximumPeakIndex = peakIndex;
      maximumPeakValue = peak;
    }
  }
  let recoveryIndex = -1;
  if (troughIndex >= 0) {
    for (let index = troughIndex + 1; index < cumulative.length; index += 1) {
      if ((cumulative[index] as number) >= maximumPeakValue) {
        recoveryIndex = index;
        break;
      }
    }
  }
  const peakTimestampSeconds = maximumPeakIndex >= 0 ? (timestamps[maximumPeakIndex] as number) : null;
  const troughTimestampSeconds = troughIndex >= 0 ? (timestamps[troughIndex] as number) : null;
  const recoveryTimestampSeconds = recoveryIndex >= 0 ? (timestamps[recoveryIndex] as number) : null;
  let sentence: string;
  if (troughTimestampSeconds === null) {
    sentence = "Model equity never fell below its running peak, so there was no drawdown.";
  } else {
    const from = peakTimestampSeconds === null ? "the start of the record" : `a peak on ${barDate(peakTimestampSeconds, barSeconds)}`;
    const recovered =
      recoveryTimestampSeconds === null
        ? "and had not recovered by the end of the record"
        : `and recovered on ${barDate(recoveryTimestampSeconds, barSeconds)}`;
    sentence =
      `The deepest drawdown was ${usd(maximum)}, from ${from} to a trough on ` +
      `${barDate(troughTimestampSeconds, barSeconds)}, ${recovered}.`;
  }
  return {
    maximumDrawdownUsd: maximum,
    peakTimestampSeconds,
    troughTimestampSeconds,
    recoveryTimestampSeconds,
    declineBarCount: troughIndex >= 0 ? troughIndex - Math.max(0, maximumPeakIndex) : 0,
    basis,
    sentence,
  };
}

interface TradeFacts {
  tradeCount: number;
  totalNetUsd: number;
  grossUsd: number;
  costPerTradeUsd: number;
  rightCount: number;
  averageGrossWinUsd: number | null;
  averageGrossLossUsd: number | null;
  breakEvenHitRate: number | null;
}

function tradeFacts(trades: LensTrade[], costPerTradeUsd: number): TradeFacts {
  let totalNetUsd = 0;
  let grossUsd = 0;
  let rightCount = 0;
  let winSum = 0;
  let lossSum = 0;
  for (const trade of trades) {
    totalNetUsd += trade.netUsd;
    grossUsd += trade.grossUsd;
    if (trade.grossUsd > 0) {
      rightCount += 1;
      winSum += trade.grossUsd;
    } else {
      lossSum += -trade.grossUsd;
    }
  }
  const wrongCount = trades.length - rightCount;
  const averageGrossWinUsd = rightCount > 0 ? winSum / rightCount : null;
  const averageGrossLossUsd = wrongCount > 0 ? lossSum / wrongCount : null;
  const breakEvenHitRate =
    averageGrossWinUsd !== null && averageGrossLossUsd !== null && averageGrossWinUsd + averageGrossLossUsd > 0
      ? Math.min(1, (averageGrossLossUsd + costPerTradeUsd) / (averageGrossWinUsd + averageGrossLossUsd))
      : null;
  return {
    tradeCount: trades.length,
    totalNetUsd,
    grossUsd,
    costPerTradeUsd,
    rightCount,
    averageGrossWinUsd,
    averageGrossLossUsd,
    breakEvenHitRate,
  };
}

function breakEvenReasonOf(facts: TradeFacts): string | null {
  if (facts.tradeCount < ANALYTICS_MINIMUM_SEGMENT_TRADES) return tooFewTrades(facts.tradeCount, ANALYTICS_MINIMUM_SEGMENT_TRADES);
  if (facts.breakEvenHitRate === null) return "it needs at least one trade that moved the traded way and one that did not";
  return null;
}

function computeHappened(
  input: LensAnalyticsInput,
  record: AnalyticsRecord | null,
  trades: LensTrade[],
  facts: TradeFacts,
  tradesBasis: string,
  recordReason: string,
): LensAnalyticsHappened {
  const { evaluation, manifest } = input;
  const params = evaluation.params;
  const headline = evaluation.headline;
  const barCount = evaluation.range.barCount;
  const costPerTradeTicks = (Math.max(0, manifest.cost.roundTripPoints) * params.costMultiplier) / manifest.cost.tickSize;
  const tradeCount = headline.tradeCount;
  const totalNetUsd = headline.totalNetUsd;
  const breakEvenReason = breakEvenReasonOf(facts);
  const directionRight = facts.tradeCount > 0 ? wilson(facts.rightCount, facts.tradeCount) : null;

  let summarySentence: string;
  if (barCount === 0) {
    summarySentence = "The evaluated window holds no bars of this model's record.";
  } else if (tradeCount === 0) {
    summarySentence =
      `Over ${count(barCount)} test bars no prediction reached the ${params.threshold.toFixed(3)} entry threshold, ` +
      "so the model took no trades" +
      (headline.buyHoldNetUsd === null ? "." : `; buying and holding one contract over the same bars returned ${usd(headline.buyHoldNetUsd)} after one round trip.`);
  } else {
    const verb = totalNetUsd > 0 ? "made" : totalNetUsd < 0 ? "lost" : "broke even with";
    const amount = totalNetUsd === 0 ? "" : ` ${usd(Math.abs(totalNetUsd))}`;
    const right = directionRight?.value ?? 0;
    const opening = `Over ${count(barCount)} test bars the model took ${plural(tradeCount, "trade")} and ${verb}${amount} after costs`;
    if (facts.tradeCount < ANALYTICS_MINIMUM_SEGMENT_TRADES) {
      // A rate on a handful of trades (or on a transport-capped subset) is not stated.
      summarySentence = `${opening}; how often it was right is not stated: ${tooFewTrades(facts.tradeCount, ANALYTICS_MINIMUM_SEGMENT_TRADES)}` +
        (facts.tradeCount < tradeCount ? ` in the list read (${tradesBasis})` : "") + ".";
    } else {
      const tail =
        facts.breakEvenHitRate !== null && breakEvenReason === null
          ? `, which after costs of ${trimmed(costPerTradeTicks, 1)} ticks per round trip is ` +
            `${right >= facts.breakEvenHitRate ? "above" : "below"} the ${percent(facts.breakEvenHitRate)} it needed to break even.`
          : ` (the break-even rate is not stated: ${breakEvenReason ?? "not available"}).`;
      summarySentence = `${opening}; it was right ${percent(right)} of the time${tail}`;
    }
  }

  const netValues = trades.map((trade) => trade.netUsd);
  const tradeNetSummary = eightNumberSummary(netValues);
  const tradeNetSummaryReason =
    tradeNetSummary.count === 0
      ? "no trades were taken"
      : tradeNetSummary.count < 4
        ? `only ${tradeNetSummary.count} trades: skewness needs 3 and kurtosis 4`
        : null;

  const horizon = manifest.horizonBars;
  const sides = buildSegments(
    [
      { key: "long", label: "Long" },
      { key: "short", label: "Short" },
    ],
    record,
    record
      ? (row) => {
          const probability = record.series.probabilityUp[row] as number;
          return probability >= 0.5 ? "long" : "short";
        }
      : null,
    trades,
    (trade) => (trade.direction === 1 ? "long" : "short"),
    horizon,
    recordReason,
  );

  const buyHoldNetUsd = headline.buyHoldNetUsd;
  const differenceUsd = buyHoldNetUsd === null ? null : totalNetUsd - buyHoldNetUsd;
  const equitySentence =
    buyHoldNetUsd === null
      ? `The model ended ${signedUsd(totalNetUsd)} after costs; no buy-and-hold benchmark is available for these bars.`
      : `The model ended ${signedUsd(totalNetUsd)} after costs against ${signedUsd(buyHoldNetUsd)} for buying and holding ` +
        `one contract over the same ${count(barCount)} bars, a difference of ${signedUsd(differenceUsd as number)}.`;

  const drawdown = record
    ? computeDrawdown(
        record.series.timestampSeconds.subarray(record.range.firstRowIndex, record.range.lastRowIndex + 1),
        record.cumulativeNetUsd.subarray(record.range.firstRowIndex, record.range.lastRowIndex + 1),
        manifest.barSeconds,
        "every bar of the record (mark-to-market, net of costs)",
      )
    : computeDrawdown(
        evaluation.equity.map((point) => point.timestampSeconds),
        evaluation.equity.map((point) => point.modelCumulativeUsd),
        manifest.barSeconds,
        evaluation.equityDownsampled ? "the evaluation's equity points (downsampled, extremes kept)" : "the evaluation's equity points",
      );

  return {
    explanation:
      "What the model did over its test bars: the trades it took, what each one earned after costs, and how its equity compared with simply holding the contract.",
    summarySentence,
    barCount,
    tradeCount,
    totalNetUsd,
    grossUsd: facts.grossUsd,
    costPerTradeUsd: facts.costPerTradeUsd,
    costPerTradeTicks,
    directionRight,
    breakEvenHitRate: breakEvenReason === null ? facts.breakEvenHitRate : null,
    breakEvenReason,
    tradeNetSummary,
    tradeNetSummaryReason,
    tradeNetHistogram: histogram(netValues, ANALYTICS_HISTOGRAM_BIN_COUNT),
    sides,
    equity: {
      modelNetUsd: totalNetUsd,
      buyHoldNetUsd,
      differenceUsd,
      points: evaluation.equity.map((point) => ({
        timestampSeconds: point.timestampSeconds,
        modelCumulativeUsd: point.modelCumulativeUsd,
        buyHoldCumulativeUsd: point.buyHoldCumulativeUsd,
      })),
      sentence: equitySentence,
    },
    drawdown,
    tradesBasis,
  };
}

// ─── Diagnostic ──────────────────────────────────────────────────────────────

function computeDeciles(record: AnalyticsRecord | null, evaluation: LensEvaluation, horizon: number): LensAnalyticsWhy["byConfidence"] {
  if (!record) {
    // Without the bars, the scatter's deciles (rows with a realised return) still give the up rate.
    const deciles: LensAnalyticsDecile[] = evaluation.scatter.deciles.map((decile) => {
      const independent = decile.count / Math.max(1, horizon);
      const enough = independent >= ANALYTICS_MINIMUM_INDEPENDENT_ROWS && decile.upRate !== null;
      return {
        decile: decile.decile,
        probabilityLow: decile.probabilityLow,
        probabilityHigh: decile.probabilityHigh,
        rowCount: decile.count,
        independentRowCount: independent,
        upRate: enough ? wilson(Math.round((decile.upRate as number) * decile.count), decile.count, independent) : null,
        directionHitRate: null,
        reason: enough ? "hit rate needs every bar of the record" : tooFewRows(independent, decile.count),
      };
    });
    return { deciles, reason: null, basis: "deciles of the evaluation's scatter (rows with a realised forward return)" };
  }
  const { series, range } = record;
  const rows: number[] = [];
  for (let row = range.firstRowIndex; row <= range.lastRowIndex; row += 1) {
    if (readLabel(series, row) !== null && Number.isFinite(series.probabilityUp[row] as number)) rows.push(row);
  }
  if (rows.length < ANALYTICS_DECILE_COUNT) {
    return { deciles: [], reason: `only ${rows.length} labelled bars; ten deciles need at least ten`, basis: "labelled bars" };
  }
  rows.sort((a, b) => (series.probabilityUp[a] as number) - (series.probabilityUp[b] as number) || a - b);
  const deciles: LensAnalyticsDecile[] = [];
  for (let decile = 0; decile < ANALYTICS_DECILE_COUNT; decile += 1) {
    const start = Math.floor((decile * rows.length) / ANALYTICS_DECILE_COUNT);
    const end = Math.floor(((decile + 1) * rows.length) / ANALYTICS_DECILE_COUNT);
    let ups = 0;
    let hits = 0;
    for (let k = start; k < end; k += 1) {
      const row = rows[k] as number;
      const label = readLabel(series, row) as 0 | 1;
      const probability = series.probabilityUp[row] as number;
      if (label === 1) ups += 1;
      if ((probability >= 0.5) === (label === 1)) hits += 1;
    }
    const size = end - start;
    const independent = size / Math.max(1, horizon);
    const enough = independent >= ANALYTICS_MINIMUM_INDEPENDENT_ROWS;
    deciles.push({
      decile: decile + 1,
      probabilityLow: series.probabilityUp[rows[start] as number] as number,
      probabilityHigh: series.probabilityUp[rows[end - 1] as number] as number,
      rowCount: size,
      independentRowCount: independent,
      upRate: enough ? wilson(ups, size, independent) : null,
      directionHitRate: enough ? wilson(hits, size, independent) : null,
      reason: enough ? null : tooFewRows(independent, size),
    });
  }
  return { deciles, reason: null, basis: "equal-count deciles of every labelled bar, ranked by P(up)" };
}

function computeCalibration(evaluation: LensEvaluation, horizon: number): LensAnalyticsWhy["calibration"] {
  const reliability = evaluation.scatter.reliability;
  const labelledRowCount = reliability.reduce((sum, bin) => sum + bin.count, 0);
  const independentRowCount = labelledRowCount / Math.max(1, horizon);
  const bins: LensAnalyticsCalibrationBin[] = reliability.map((bin) => {
    const independent = bin.count / Math.max(1, horizon);
    const enough = independent >= ANALYTICS_MINIMUM_INDEPENDENT_ROWS && bin.observedUpRate !== null;
    return {
      binLow: bin.binLow,
      binHigh: bin.binHigh,
      rowCount: bin.count,
      independentRowCount: independent,
      meanProbability: bin.meanProbability,
      observedUpRate: enough ? wilson(Math.round((bin.observedUpRate as number) * bin.count), bin.count, independent) : null,
      reason: bin.count === 0 ? "no bar's probability fell in this bin" : enough ? null : tooFewRows(independent, bin.count),
    };
  });
  if (independentRowCount < ANALYTICS_MINIMUM_INDEPENDENT_ROWS) {
    const reason = tooFewRows(independentRowCount, labelledRowCount);
    return { bins, labelledRowCount, independentRowCount, expectedCalibrationError: null, reason, sentence: `Calibration is not stated: ${reason}.` };
  }
  let error = 0;
  for (const bin of reliability) {
    if (bin.count === 0 || bin.meanProbability === null || bin.observedUpRate === null) continue;
    error += (bin.count / labelledRowCount) * Math.abs(bin.meanProbability - bin.observedUpRate);
  }
  const occupied = reliability.filter((bin) => bin.count > 0).length;
  const sentence =
    `Expected calibration error is ${(error * 100).toFixed(2)} percentage points: on average a stated probability of up is ` +
    `${(error * 100).toFixed(2)} points away from ` +
    `how often the bars in its bin actually went up (${count(labelledRowCount)} labelled bars in ${occupied} of 10 equal-width bins).`;
  return { bins, labelledRowCount, independentRowCount, expectedCalibrationError: error, reason: null, sentence };
}

function computeAttributionSummary(evaluation: LensEvaluation): LensAnalyticsWhy["attribution"] {
  const attribution = evaluation.attribution;
  if (!attribution.available) {
    const reason = attribution.reason ?? "no attribution artifact for this model";
    return { available: false, reason, families: [], topFeatures: [], sentence: `No feature attribution: ${reason}.` };
  }
  const families = attribution.families
    .map((family) => ({ family: family.family, label: family.label, share: family.share, featureCount: family.featureCount }))
    .sort((a, b) => b.share - a.share);
  const topFeatures = [...attribution.features].sort((a, b) => a.rank - b.rank).slice(0, 5);
  const leader = families[0];
  const feature = topFeatures[0];
  const sentence =
    leader && feature
      ? `${leader.label} features carry ${percent(leader.share)} of the model's mean absolute SHAP contribution; ` +
        `the single largest feature is ${feature.name} (mean absolute SHAP ${feature.meanAbsoluteShap.toFixed(4)}).`
      : "The attribution artifact holds no feature contributions.";
  return { available: true, reason: null, families, topFeatures, sentence };
}

function computeLossCauses(
  trades: LensTrade[],
  facts: TradeFacts,
  dimensions: Array<{ phrase: (label: string) => string; segments: Array<{ label: string; nets: number[] }> }>,
): { causes: LensAnalyticsLossCause[]; reason: string | null } {
  const candidates: Array<Omit<LensAnalyticsLossCause, "rank">> = [];
  if (facts.tradeCount > 0 && facts.costPerTradeUsd > 0) {
    const paid = facts.costPerTradeUsd * facts.tradeCount;
    candidates.push({
      cause: "costs",
      lossUsd: paid,
      sampleSize: facts.tradeCount,
      sentence:
        `Costs: the ${count(facts.tradeCount)} trades paid ${usd(paid)} in commission and slippage (${usd(facts.costPerTradeUsd)} ` +
        `per round trip); before costs the same trades ${facts.grossUsd >= 0 ? "made" : "lost"} ${usd(Math.abs(facts.grossUsd))}.`,
    });
  }
  for (const dimension of dimensions) {
    for (const segment of dimension.segments) {
      const n = segment.nets.length;
      // A segment holding every trade separates nothing; a thin one is not a measurement.
      if (n < ANALYTICS_MINIMUM_SEGMENT_TRADES || n === trades.length) continue;
      const total = segment.nets.reduce((sum, net) => sum + net, 0);
      if (total >= 0) continue;
      candidates.push({
        cause: dimension.phrase(segment.label),
        lossUsd: -total,
        sampleSize: n,
        sentence: `${dimension.phrase(segment.label)} lost ${usd(-total)} over ${count(n)} trades (mean ${usd(total / n)} per trade).`,
      });
    }
  }
  candidates.sort((a, b) => b.lossUsd - a.lossUsd);
  const causes = candidates.slice(0, 3).map((cause, index) => ({ ...cause, rank: index + 1 }));
  return {
    causes,
    reason:
      causes.length > 0
        ? null
        : trades.length === 0
          ? "no trades were taken, so nothing was lost"
          : `no cost was charged and no slice with at least ${ANALYTICS_MINIMUM_SEGMENT_TRADES} trades (and fewer than all of them) lost money`,
  };
}

function groupNets(trades: LensTrade[], keyOf: (trade: LensTrade) => string | null, labels: SegmentKey[]): Array<{ label: string; nets: number[] }> {
  const groups = new Map<string, number[]>();
  for (const trade of trades) {
    const key = keyOf(trade);
    if (key === null) continue;
    const list = groups.get(key) ?? [];
    list.push(trade.netUsd);
    groups.set(key, list);
  }
  return labels.map(({ key, label }) => ({ label, nets: groups.get(key) ?? [] }));
}

function hourKeys(): SegmentKey[] {
  return Array.from({ length: 24 }, (_, hour) => ({
    key: String(hour),
    label: `${String(hour).padStart(2, "0")}:00–${String(hour).padStart(2, "0")}:59`,
  }));
}

function computeWhy(
  input: LensAnalyticsInput,
  record: AnalyticsRecord | null,
  trades: LensTrade[],
  facts: TradeFacts,
  recordReason: string,
): LensAnalyticsWhy {
  const { evaluation, manifest } = input;
  const horizon = manifest.horizonBars;
  const assetClass = assetClassOf(manifest.symbol);
  const daily = manifest.barSeconds >= 86_400;

  const presentHours = new Set(trades.map((trade) => String(hourOf(trade.entryTimestampSeconds))));
  if (record) {
    for (let row = record.range.firstRowIndex; row <= record.range.lastRowIndex; row += 1) {
      presentHours.add(String(hourOf(record.series.timestampSeconds[row] as number)));
    }
  }
  const hours = hourKeys().filter(({ key }) => presentHours.has(key));
  const byHour: LensAnalyticsWhy["byHour"] = daily
    ? { segments: [], reason: "each bar is a whole day, so the hour of the session does not apply", clock: "" }
    : {
        segments: buildSegments(
          hours,
          record,
          record ? (row) => String(hourOf(record.series.timestampSeconds[row] as number)) : null,
          trades,
          (trade) => String(hourOf(trade.entryTimestampSeconds)),
          horizon,
          recordReason,
        ),
        reason: null,
        clock:
          assetClass === "futures"
            ? "hour of the bar's own time stamp (the lake stamps futures in CME Pacific wall-clock time)"
            : "hour of the bar's time stamp, UTC",
      };

  const weekdayKeys = WEEKDAY_ORDER.map((name) => ({ key: name, label: name }));
  const weekdaySegments = buildSegments(
    weekdayKeys,
    record,
    record ? (row) => weekdayOf(record.series.timestampSeconds[row] as number, assetClass) : null,
    trades,
    (trade) => weekdayOf(trade.entryTimestampSeconds, assetClass),
    horizon,
    recordReason,
  ).filter((segment) => segment.labelledRowCount > 0 || segment.tradeCount > 0);

  const regimeRows = evaluation.regimes.performance.map((row) => {
    const independent = row.hitRate.n / Math.max(1, horizon);
    const enoughRows = independent >= ANALYTICS_MINIMUM_INDEPENDENT_ROWS;
    const enoughTrades = row.tradeCount >= ANALYTICS_MINIMUM_SEGMENT_TRADES;
    return {
      regime: row.regime,
      barCount: row.barCount,
      tradeCount: row.tradeCount,
      hitRate: row.hitRate,
      directionHitRate:
        enoughRows && row.hitRate.value !== null ? wilson(Math.round(row.hitRate.value * row.hitRate.n), row.hitRate.n, independent) : null,
      hitRateReason: enoughRows ? null : tooFewRows(independent, row.hitRate.n),
      meanTradeNetUsd: enoughTrades ? row.meanTradeNetUsd : null,
      meanReason: enoughTrades ? null : tooFewTrades(row.tradeCount, ANALYTICS_MINIMUM_SEGMENT_TRADES),
      totalNetUsd: row.totalNetUsd,
    };
  });

  const regimeKeys: SegmentKey[] = (["bull", "bear", "sideways"] as LensRegime[]).map((regime) => ({ key: regime, label: REGIME_WORDS[regime] }));
  const convictionKeys: SegmentKey[] = Array.from({ length: ANALYTICS_CONVICTION_EDGES.length - 1 }, (_, band) => ({
    key: String(band),
    label: convictionLabel(band),
  }));
  const loss = computeLossCauses(trades, facts, [
    {
      phrase: (label) => `${label} trades`,
      segments: groupNets(trades, (trade) => (trade.direction === 1 ? "long" : "short"), [
        { key: "long", label: "Long" },
        { key: "short", label: "Short" },
      ]),
    },
    ...(daily ? [] : [{ phrase: (label: string) => `Trades entered ${label}`, segments: groupNets(trades, (trade) => String(hourOf(trade.entryTimestampSeconds)), hourKeys()) }]),
    {
      phrase: (label) => `Trades entered on a ${label}`,
      segments: groupNets(trades, (trade) => weekdayOf(trade.entryTimestampSeconds, assetClass), weekdayKeys),
    },
    { phrase: (label) => `Trades entered in a ${label} regime`, segments: groupNets(trades, (trade) => trade.regime, regimeKeys) },
    {
      phrase: (label) => `Trades entered with conviction ${label}`,
      segments: groupNets(trades, (trade) => String(convictionBand(trade.probabilityUp)), convictionKeys),
    },
  ]);

  return {
    explanation:
      "Where the model's errors and losses sit: by hour, weekday, how confident it was, the market regime, whether its probabilities can be taken at face value, which inputs drove it, and the biggest measured sources of loss.",
    byHour,
    byWeekday: { segments: weekdaySegments, reason: weekdaySegments.length === 0 ? "no bars or trades to group" : null },
    byConfidence: computeDeciles(record, evaluation, horizon),
    byRegime: { definition: evaluation.regimes.definition, rows: regimeRows },
    calibration: computeCalibration(evaluation, horizon),
    attribution: computeAttributionSummary(evaluation),
    lossCauses: loss.causes,
    lossCausesReason: loss.reason,
  };
}

// ─── Predictive ──────────────────────────────────────────────────────────────

function computeNext(input: LensAnalyticsInput, record: AnalyticsRecord | null, recordReason: string): LensAnalyticsNext {
  const { evaluation, manifest, nowSeconds } = input;
  const params = evaluation.params;
  const horizon = manifest.horizonBars;
  const rolling = evaluation.rolling;
  const tradeCount = evaluation.headline.tradeCount;

  // Drift: the alarm is "on" when the latest Page-Hinkley alarm fell inside the last rolling trade window.
  const alarms = rolling.drift.alarms;
  const lastAlarm = alarms.length > 0 ? alarms[alarms.length - 1] : undefined;
  const tradesSinceLastAlarm = lastAlarm ? tradeCount - 1 - lastAlarm.tradeIndex : null;
  const alarmOn = lastAlarm !== undefined && (tradesSinceLastAlarm as number) < rolling.windowTrades;
  const drift: LensAnalyticsNext["drift"] = {
    alarmOn,
    alarmCount: alarms.length,
    lastAlarmTradeIndex: lastAlarm?.tradeIndex ?? null,
    lastAlarmTimestampSeconds: lastAlarm?.timestampSeconds ?? null,
    tradesSinceLastAlarm,
    tradeCount,
    windowTrades: rolling.windowTrades,
    rule: `on when the latest Page-Hinkley deterioration alarm fell within the last ${rolling.windowTrades} trades (the rolling trade window)`,
  };

  // Rolling hit-rate trend: the latest full window against the window that ended one window earlier.
  const points = rolling.points.filter((point) => point.hitRate !== null);
  let rollingHitRate: LensAnalyticsNext["rollingHitRate"] = null;
  let rollingReason: string | null = null;
  const latestPoint = points[points.length - 1];
  if (!latestPoint) {
    rollingReason = "the record is shorter than one full rolling window";
  } else {
    let earlierPoint: (typeof points)[number] | undefined;
    for (let index = points.length - 1; index >= 0; index -= 1) {
      const point = points[index] as (typeof points)[number];
      if (point.rowIndex <= latestPoint.rowIndex - rolling.windowBars) {
        earlierPoint = point;
        break;
      }
    }
    const latestIndependent = latestPoint.labelledCount / horizon;
    const earlierIndependent = earlierPoint ? earlierPoint.labelledCount / horizon : 0;
    if (latestIndependent < ANALYTICS_MINIMUM_INDEPENDENT_ROWS) {
      rollingReason = tooFewRows(latestIndependent, latestPoint.labelledCount);
    } else {
    const latestRate = latestPoint.hitRate as number;
    const earlierRate = earlierPoint && earlierIndependent >= ANALYTICS_MINIMUM_INDEPENDENT_ROWS ? (earlierPoint.hitRate as number) : null;
    const change = earlierRate === null ? null : latestRate - earlierRate;
    // Difference of two proportions: its standard error is about sqrt(2) times one
    // window's, so a move that one window's coin-flip band would call large can
    // still be what chance produces between two windows.
    let trend: "flat" | "rising" | "falling" | "unknown" = "unknown";
    if (change !== null && earlierRate !== null) {
      const pooled = (latestRate + earlierRate) / 2;
      const standardError = Math.sqrt(Math.max(1e-12, pooled * (1 - pooled)) * (1 / latestIndependent + 1 / earlierIndependent));
      trend = Math.abs(change) <= 1.96 * standardError ? "flat" : change > 0 ? "rising" : "falling";
    }
    rollingHitRate = {
      windowBars: rolling.windowBars,
      latest: latestRate,
      latestLabelledCount: latestPoint.labelledCount,
      earlier: earlierRate,
      change,
      trend,
      nullBandLower: rolling.nullBand.lower,
      nullBandUpper: rolling.nullBand.upper,
      insideNullBand: latestRate >= rolling.nullBand.lower && latestRate <= rolling.nullBand.upper,
    };
    }
  }

  const base = {
    explanation:
      "The model's most recent forecast, how uncertain it is, the conditions it was made in, and whether the model's accuracy has been holding up.",
    rollingHitRate,
    rollingReason,
    drift,
  };
  const driftSentence = alarmOn
    ? `The Page-Hinkley drift alarm is on: it last fired ${count(tradesSinceLastAlarm as number)} trades before the end of the record, inside the last ${rolling.windowTrades}.`
    : lastAlarm
      ? `The Page-Hinkley drift alarm is off: it last fired ${count(tradesSinceLastAlarm as number)} trades before the end of the record, outside the last ${rolling.windowTrades}.`
      : `The Page-Hinkley drift alarm is off: it never fired over ${count(tradeCount)} trades.`;
  const rollingSentence = rollingHitRate
    ? `Over the last ${count(rollingHitRate.windowBars)} bars the model was right ${percent(rollingHitRate.latest)} of the time ` +
      `(${count(rollingHitRate.latestLabelledCount)} labelled bars)` +
      (rollingHitRate.earlier === null
        ? "; the record holds no earlier full window to compare with"
        : `, ${changeWords(rollingHitRate.change as number, rollingHitRate.trend)} ${percent(rollingHitRate.earlier)} one window earlier` +
          (rollingHitRate.trend === "flat" ? ", within what chance produces between two windows" : "")) +
      `; a coin flip lands between ${percent(rollingHitRate.nullBandLower)} and ${percent(rollingHitRate.nullBandUpper)}, so this is ` +
      `${rollingHitRate.insideNullBand ? "inside" : "outside"} what chance produces.`
    : `No rolling hit rate: ${rollingReason}.`;

  if (!record) {
    return {
      ...base,
      available: false,
      reason: recordReason,
      latest: null,
      interval: null,
      intervalReason: recordReason,
      sentences: [`The latest prediction is not stated: ${recordReason}.`, rollingSentence, driftSentence],
    };
  }

  const { series, range, regimes } = record;
  let latestRow = -1;
  for (let row = range.lastRowIndex; row >= range.firstRowIndex; row -= 1) {
    if (Number.isFinite(series.probabilityUp[row] as number)) {
      latestRow = row;
      break;
    }
  }
  if (latestRow < 0) {
    const reason = "no bar in the evaluated window carries a probability";
    return { ...base, available: false, reason, latest: null, interval: null, intervalReason: reason, sentences: [`No latest prediction: ${reason}.`, rollingSentence, driftSentence] };
  }

  const probabilityUp = series.probabilityUp[latestRow] as number;
  const timestampSeconds = series.timestampSeconds[latestRow] as number;
  const ageSeconds = Math.max(0, nowSeconds - trueUtcSeconds(timestampSeconds, assetClassOf(manifest.symbol)));
  // Bars are trading bars: weekends, holidays and session breaks are not in the
  // count, so horizon x bar length is not when the forecast resolves. It has
  // resolved when the bar `horizon` rows later is in the record; otherwise only
  // once it is older than the horizon plus the longest break the record holds.
  const resolvedInRecord = latestRow + horizon < series.length && Number.isFinite(series.timestampSeconds[latestRow + horizon] as number);
  let longestGapSeconds = manifest.barSeconds;
  for (let row = range.firstRowIndex + 1; row <= range.lastRowIndex; row += 1) {
    const gap = (series.timestampSeconds[row] as number) - (series.timestampSeconds[row - 1] as number);
    if (gap > longestGapSeconds) longestGapSeconds = gap;
  }
  const horizonSeconds = horizon * manifest.barSeconds + Math.max(0, longestGapSeconds - manifest.barSeconds);
  const isOld = resolvedInRecord || ageSeconds > horizonSeconds;
  const signal: "long" | "short" | null =
    probabilityUp >= params.threshold ? "long" : probabilityUp <= 1 - params.threshold ? "short" : null;
  const close = series.close[latestRow] as number;
  const regime = regimes[latestRow] ?? null;
  const latest: NonNullable<LensAnalyticsNext["latest"]> = {
    rowIndex: latestRow,
    timestampSeconds,
    probabilityUp,
    leaning: probabilityUp >= 0.5 ? "up" : "down",
    signal,
    threshold: params.threshold,
    close,
    regime,
    ageSeconds,
    horizonSeconds,
    isOld,
    ageText: describeAge(ageSeconds),
  };

  const { lower, upper } = coverageQuantileIndices(params.intervalCoverage);
  const lowerValue = series.predictedQuantilesBasisPoints[lower]?.[latestRow] ?? Number.NaN;
  const upperValue = series.predictedQuantilesBasisPoints[upper]?.[latestRow] ?? Number.NaN;
  const medianValue = series.predictedQuantilesBasisPoints[MEDIAN_QUANTILE_INDEX]?.[latestRow] ?? Number.NaN;
  let interval: LensAnalyticsNext["interval"] = null;
  let intervalReason: string | null = null;
  if (Number.isFinite(lowerValue) && Number.isFinite(upperValue) && Number.isFinite(medianValue)) {
    interval = {
      coverage: params.intervalCoverage,
      horizonBars: horizon,
      lowerBasisPoints: lowerValue,
      medianBasisPoints: medianValue,
      upperBasisPoints: upperValue,
      lowerPrice: close * Math.exp(lowerValue / 1e4),
      medianPrice: close * Math.exp(medianValue / 1e4),
      upperPrice: close * Math.exp(upperValue / 1e4),
    };
  } else {
    intervalReason =
      `this bar has no conformal interval: the causal fit needs ${count(manifest.interval.historyBars)} bars of history and ` +
      `${manifest.interval.minimumBinObservations} observations in the bar's probability bin, and it covers ` +
      `${count(manifest.interval.coveredBarCount)} of ${count(manifest.barCount)} bars`;
  }

  const oldClause = resolvedInRecord
    ? `; the record already holds the bar ${horizon} bars later, so that forecast has resolved`
    : isOld
      ? `, longer than its ${horizon}-bar horizon can last even across the longest break in the record, so that forecast has resolved`
      : `, possibly still inside the ${horizon}-bar horizon it forecasts`;
  const signalClause = signal
    ? `, and that clears the ${params.threshold.toFixed(3)} entry threshold for a ${signal}`
    : `, which does not clear the ${params.threshold.toFixed(3)} entry threshold (long at or above it, short at or below ${(1 - params.threshold).toFixed(3)})`;
  const sentences = [
    `The most recent prediction is from ${barDate(timestampSeconds, manifest.barSeconds)} (${latest.ageText} ago${oldClause}): ` +
      `probability of up ${probabilityUp.toFixed(3)}, so the model leaned ${latest.leaning}${signalClause}.`,
    interval
      ? `Its ${Math.round(interval.coverage * 100)}% conformal interval for the move over the next ${horizon} bars runs from ` +
        `${basisPoints(interval.lowerBasisPoints)} to ${basisPoints(interval.upperBasisPoints)} basis points ` +
        `(${price(interval.lowerPrice)} to ${price(interval.upperPrice)} from a close of ${price(close)}), median ${basisPoints(interval.medianBasisPoints)} basis points.`
      : `No interval is stated: ${intervalReason}.`,
    regime === null
      ? "The regime at that bar is unknown: it sits inside the regime lookback warmup."
      : `The market regime at that bar was ${REGIME_WORDS[regime]}.`,
    rollingSentence,
    driftSentence,
  ];

  return { ...base, available: true, reason: null, latest, interval, intervalReason, sentences };
}

// ─── Prescriptive ────────────────────────────────────────────────────────────

function meanNetEstimate(nets: number[]): LensEstimate {
  if (nets.length === 0) return emptyEstimate("no trades");
  const bootstrap = blockBootstrap(nets.length, {
    meanNetUsd: (indices) => {
      let sum = 0;
      for (let i = 0; i < indices.length; i += 1) sum += nets[indices[i] as number] as number;
      return sum / indices.length;
    },
  });
  return {
    value: nets.reduce((sum, net) => sum + net, 0) / nets.length,
    ciLow: bootstrap.statistics.meanNetUsd?.ciLow ?? null,
    ciHigh: bootstrap.statistics.meanNetUsd?.ciHigh ?? null,
    n: nets.length,
    method: `moving-block bootstrap, ${BOOTSTRAP_RESAMPLE_COUNT} resamples, block length ${bootstrap.blockLength} trades`,
  };
}

function formatInterval(estimate: LensEstimate): string {
  return estimate.ciLow === null || estimate.ciHigh === null ? "no interval" : `[${usd(estimate.ciLow)}, ${usd(estimate.ciHigh)}]`;
}

function computeToDo(
  input: LensAnalyticsInput,
  record: AnalyticsRecord | null,
  trades: LensTrade[],
  facts: TradeFacts,
  next: LensAnalyticsNext,
  recordReason: string,
): LensAnalyticsToDo {
  const { evaluation, manifest } = input;
  const params = evaluation.params;
  const horizon = manifest.horizonBars;
  const minimumTrades = ANALYTICS_MINIMUM_SEGMENT_TRADES;
  const warning =
    `Chosen on the same rows it is scored on: this is the best of ${ANALYTICS_THRESHOLD_GRID.length} thresholds on this record, ` +
    "and neither the value nor its interval accounts for that search, so expect less on data the model has not seen.";

  // Threshold search: the lens's own trade rule re-run at every threshold on the grid.
  const grid: LensAnalyticsThresholdPoint[] = [];
  let best: LensAnalyticsToDo["thresholdSearch"]["best"] = null;
  let thresholdReason: string | null = null;
  let thresholdSentence: string;
  if (!record) {
    thresholdReason = recordReason;
    thresholdSentence = `The threshold search is not run: ${recordReason}.`;
  } else {
    let bestNets: number[] = [];
    let bestPoint: LensAnalyticsThresholdPoint | null = null;
    for (const threshold of ANALYTICS_THRESHOLD_GRID) {
      const nets = simulateTrades(record.series, { ...params, threshold }, record.range).trades.map((trade) => trade.netUsd);
      const total = nets.reduce((sum, net) => sum + net, 0);
      const point: LensAnalyticsThresholdPoint = {
        threshold,
        tradeCount: nets.length,
        meanTradeNetUsd: nets.length > 0 ? total / nets.length : null,
        totalNetUsd: total,
        eligible: nets.length >= minimumTrades,
      };
      grid.push(point);
      if (point.eligible && (bestPoint === null || (point.meanTradeNetUsd as number) > (bestPoint.meanTradeNetUsd as number))) {
        bestPoint = point;
        bestNets = nets;
      }
    }
    if (bestPoint) {
      best = {
        threshold: bestPoint.threshold,
        tradeCount: bestPoint.tradeCount,
        totalNetUsd: bestPoint.totalNetUsd,
        meanTradeNetUsd: meanNetEstimate(bestNets),
      };
      const current = evaluation.headline.meanTradeNetUsd;
      thresholdSentence =
        `Of ${ANALYTICS_THRESHOLD_GRID.length} entry thresholds from 0.50 to 0.95, ${best.threshold.toFixed(2)} gave the highest expected ` +
        `net result per trade after costs: ${usd(best.meanTradeNetUsd.value as number)} ${formatInterval(best.meanTradeNetUsd)} over ` +
        `${count(best.tradeCount)} trades${(best.meanTradeNetUsd.value as number) < 0 ? ", and even that is a loss" : ""}` +
        (current.value === null
          ? `; the current threshold ${params.threshold.toFixed(3)} takes no trades.`
          : current.n < minimumTrades
            ? `; the current threshold ${params.threshold.toFixed(3)} is not stated: ${tooFewTrades(current.n, minimumTrades)}.`
            : `; the current threshold ${params.threshold.toFixed(3)} gives ${usd(current.value)} ${formatInterval(current)} over ${count(current.n)} trades.`);
    } else {
      thresholdReason = `no threshold on the grid produced at least ${minimumTrades} trades`;
      thresholdSentence = `No threshold is recommended: ${thresholdReason}.`;
    }
  }

  // Expected value by conviction: every bar treated as a trade in the direction the model leaned.
  const definition =
    `Every bar with a probability is treated as if a trade were entered at its close in the direction the model leaned ` +
    `(long at P(up) 0.5 or above) and closed ${horizon} bars later, net of ${usd(facts.costPerTradeUsd)} per round trip. ` +
    "Conviction is the probability of the side it leaned to. Neighbouring bars share most of their move, so intervals use bars ÷ horizon.";
  const bandCount = ANALYTICS_CONVICTION_EDGES.length - 1;
  const bandNets: number[][] = Array.from({ length: bandCount }, () => []);
  let convictionReason: string | null = null;
  if (!record) {
    convictionReason = recordReason;
  } else {
    const { series, range } = record;
    const pointValue = series.cost.pointValueUsd;
    const cost = tradeCostUsd(series, params);
    for (let row = range.firstRowIndex; row + horizon <= range.lastRowIndex; row += 1) {
      const probability = series.probabilityUp[row] as number;
      if (!Number.isFinite(probability)) continue;
      const direction = probability >= 0.5 ? 1 : -1;
      const net = direction * ((series.close[row + horizon] as number) - (series.close[row] as number)) * pointValue - cost;
      (bandNets[convictionBand(probability)] as number[]).push(net);
    }
  }
  const buckets = bandNets.map((nets, band) => {
    const independent = nets.length / Math.max(1, horizon);
    const enough = record !== null && independent >= ANALYTICS_MINIMUM_INDEPENDENT_ROWS;
    const profitable = nets.filter((net) => net > 0).length;
    return {
      label: convictionLabel(band),
      convictionLow: ANALYTICS_CONVICTION_EDGES[band] as number,
      convictionHigh: ANALYTICS_CONVICTION_EDGES[band + 1] as number,
      rowCount: nets.length,
      independentRowCount: independent,
      meanNetUsd: enough ? meanEstimate(nets, horizon) : null,
      profitableShare: enough ? wilson(profitable, nets.length, independent) : null,
      reason: enough ? null : record === null ? recordReason : tooFewRows(independent, nets.length),
    };
  });

  // Break-even hit rate at the current threshold.
  const breakEvenReason = breakEvenReasonOf(facts);
  const observedHitRate = facts.tradeCount > 0 && breakEvenReason === null ? wilson(facts.rightCount, facts.tradeCount) : null;
  const breakEvenSentence =
    breakEvenReason === null && observedHitRate && facts.breakEvenHitRate !== null
      ? `A trade that moved the right way averaged ${usd(facts.averageGrossWinUsd as number)} before costs and one that did not ` +
        `lost ${usd(facts.averageGrossLossUsd as number)}; with ${usd(facts.costPerTradeUsd)} of cost per round trip the model must be ` +
        `right ${percent(facts.breakEvenHitRate)} of the time to break even, and it was right ${percent(observedHitRate.value as number)} ` +
        `[${percent(observedHitRate.low ?? 0)}, ${percent(observedHitRate.high ?? 0)}] over ${count(facts.tradeCount)} trades.`
      : `The break-even hit rate is not stated: ${breakEvenReason ?? "not available"}.`;

  // Capped fractional Kelly from the net outcomes at the current threshold.
  const nets = trades.map((trade) => trade.netUsd);
  const netWins = nets.filter((net) => net > 0);
  const netLosses = nets.filter((net) => net <= 0).map((net) => -net);
  const winShare = nets.length > 0 ? netWins.length / nets.length : null;
  const averageNetWinUsd = netWins.length > 0 ? netWins.reduce((a, b) => a + b, 0) / netWins.length : null;
  const averageNetLossUsd = netLosses.length > 0 ? netLosses.reduce((a, b) => a + b, 0) / netLosses.length : null;
  const payoffRatio = averageNetWinUsd !== null && averageNetLossUsd !== null && averageNetLossUsd > 0 ? averageNetWinUsd / averageNetLossUsd : null;
  let kellyReason: string | null = null;
  let fullKellyFraction: number | null = null;
  let suggestedFraction: number | null = null;
  if (nets.length < ANALYTICS_MINIMUM_DECISION_TRADES) {
    kellyReason = tooFewTrades(nets.length, ANALYTICS_MINIMUM_DECISION_TRADES);
  } else if (winShare === null || payoffRatio === null) {
    kellyReason = "it needs at least one winning and one losing trade";
  } else {
    fullKellyFraction = winShare - (1 - winShare) / payoffRatio;
    suggestedFraction = Math.min(ANALYTICS_KELLY_CAP, Math.max(0, fullKellyFraction * ANALYTICS_KELLY_FRACTION));
  }
  const kellySentence =
    kellyReason !== null || fullKellyFraction === null || winShare === null || payoffRatio === null
      ? `No size is suggested: ${kellyReason ?? "not available"}.`
      : `Full Kelly = p − (1 − p) ÷ b = ${winShare.toFixed(3)} − ${(1 - winShare).toFixed(3)} ÷ ${payoffRatio.toFixed(3)} = ${fullKellyFraction.toFixed(3)}` +
        (fullKellyFraction <= 0
          ? "; it is not positive, so the record gives no reason to put capital at risk (suggested size 0%)."
          : `; half of it, capped at ${percent(ANALYTICS_KELLY_CAP, 0)}, suggests risking ${percent(suggestedFraction as number)} of risk capital per trade.`);

  // Recommendation: explicit rules in order; the first one triggered decides.
  const current = evaluation.headline.meanTradeNetUsd;
  const latest = next.latest;
  const rules: LensAnalyticsRule[] = [
    {
      name: "record_loaded",
      question: "Is every bar of the record loaded, so the current signal can be read?",
      input: record ? `${count(manifest.barCount)} of ${count(manifest.barCount)} bars loaded` : recordReason,
      triggered: record === null,
      verdictWhenTriggered: "gather_more_data",
    },
    {
      name: "enough_trades",
      question: `Did the current threshold take at least ${ANALYTICS_MINIMUM_DECISION_TRADES} trades?`,
      input: `${count(evaluation.headline.tradeCount)} trades at threshold ${params.threshold.toFixed(3)}`,
      triggered: evaluation.headline.tradeCount < ANALYTICS_MINIMUM_DECISION_TRADES,
      verdictWhenTriggered: "gather_more_data",
    },
    {
      name: "edge_negative",
      question: "Is the whole 95% interval on mean net result per trade below zero?",
      input: current.value === null ? "no trades" : `mean ${usd(current.value)} ${formatInterval(current)} over ${count(current.n)} trades`,
      triggered: current.ciHigh !== null && current.ciHigh < 0,
      verdictWhenTriggered: "do_not_trade",
    },
    {
      name: "edge_unproven",
      question: "Does that interval include zero (no edge the record can separate from none)?",
      input: current.value === null ? "no trades" : formatInterval(current),
      triggered: current.ciLow === null || current.ciHigh === null || (current.ciLow <= 0 && current.ciHigh >= 0),
      verdictWhenTriggered: "gather_more_data",
    },
    {
      name: "signal_expired",
      question: "Is the latest prediction older than the horizon it forecasts?",
      input: latest ? `made ${latest.ageText} ago; horizon ${horizon} bars (${describeAge(latest.horizonSeconds)})` : (next.reason ?? recordReason),
      triggered: latest === null || latest.isOld,
      verdictWhenTriggered: "do_not_trade",
    },
    {
      name: "signal_below_threshold",
      question: "Does the latest probability fail to clear the entry threshold?",
      input: latest ? `P(up) ${latest.probabilityUp.toFixed(3)} against long ≥ ${params.threshold.toFixed(3)}, short ≤ ${(1 - params.threshold).toFixed(3)}` : "no latest prediction",
      triggered: latest === null || latest.signal === null,
      verdictWhenTriggered: "do_not_trade",
    },
    {
      name: "drift_alarm",
      question: "Is the drift alarm on?",
      input: next.drift.alarmOn ? `on (${next.drift.rule})` : "off",
      triggered: next.drift.alarmOn,
      verdictWhenTriggered: "do_not_trade",
    },
    {
      name: "kelly_not_positive",
      question: "Is the suggested Kelly size zero or unavailable?",
      input: suggestedFraction === null ? (kellyReason ?? "not available") : `suggested ${percent(suggestedFraction)}`,
      triggered: suggestedFraction === null || suggestedFraction <= 0,
      verdictWhenTriggered: "do_not_trade",
    },
  ];
  const deciding = rules.find((rule) => rule.triggered);
  const verdict: LensAnalyticsVerdict = deciding ? deciding.verdictWhenTriggered : "trade";
  const decidingRule = deciding?.name ?? "none";
  const verdictWords: Record<LensAnalyticsVerdict, string> = {
    trade: "Trade the current signal",
    do_not_trade: "Do not trade the current signal",
    gather_more_data: "Gather more data",
  };
  const because: Record<string, string> = {
    record_loaded: `the record's bars are not loaded (${recordReason})`,
    enough_trades: `the threshold took only ${plural(evaluation.headline.tradeCount, "trade")}, fewer than the ${ANALYTICS_MINIMUM_DECISION_TRADES} a decision needs`,
    edge_negative: `the 95% interval on mean net result per trade, ${formatInterval(current)} over ${count(current.n)} trades, lies entirely below zero`,
    edge_unproven: `the 95% interval on mean net result per trade, ${formatInterval(current)} over ${count(current.n)} trades, includes zero, so the record cannot tell this model from no edge`,
    signal_expired: latest ? `the latest prediction was made ${latest.ageText} ago, past its ${horizon}-bar horizon` : "there is no latest prediction",
    signal_below_threshold: latest ? `the latest P(up) ${latest.probabilityUp.toFixed(3)} does not clear the ${params.threshold.toFixed(3)} threshold` : "there is no latest prediction",
    drift_alarm: "the drift alarm is on",
    kelly_not_positive: `the Kelly size is not positive (${kellyReason ?? "full Kelly at or below zero"})`,
    none: `every rule passed; size ${percent(suggestedFraction ?? 0)} of risk capital per trade`,
  };
  const recommendationSentence = `${verdictWords[verdict]}: ${because[decidingRule] ?? ""}.`;

  return {
    explanation:
      "What the record supports doing: the best entry threshold on these rows, where the expected value after costs is, the hit rate needed to break even, a position size, and a recommendation from fixed rules.",
    thresholdSearch: {
      grid,
      currentThreshold: params.threshold,
      minimumTrades,
      best,
      reason: thresholdReason,
      warning,
      sentence: thresholdSentence,
    },
    convictionBuckets: { definition, reason: convictionReason, buckets },
    breakEven: {
      tradeCount: facts.tradeCount,
      averageGrossWinUsd: facts.averageGrossWinUsd,
      averageGrossLossUsd: facts.averageGrossLossUsd,
      costPerTradeUsd: facts.costPerTradeUsd,
      breakEvenHitRate: breakEvenReason === null ? facts.breakEvenHitRate : null,
      observedHitRate,
      reason: breakEvenReason,
      sentence: breakEvenSentence,
    },
    kelly: {
      tradeCount: nets.length,
      winShare,
      averageNetWinUsd,
      averageNetLossUsd,
      payoffRatio,
      fullKellyFraction,
      suggestedFraction,
      fraction: ANALYTICS_KELLY_FRACTION,
      cap: ANALYTICS_KELLY_CAP,
      reason: kellyReason,
      sentence: kellySentence,
    },
    recommendation: { verdict, decidingRule, sentence: recommendationSentence, rules },
  };
}

// ─── Entry point ─────────────────────────────────────────────────────────────

export function computeLensAnalytics(input: LensAnalyticsInput): LensAnalytics {
  const { evaluation, manifest } = input;
  const params = evaluation.params;
  const record = buildRecord(input.bars, manifest, params);
  let recordReason: string;
  if (record) recordReason = "";
  else if (input.bars && input.bars.length > 0) recordReason = `the loaded bars (${count(input.bars.length)}) are not the whole ${count(manifest.barCount)}-bar record in row order`;
  else recordReason = input.barsReason ?? "the record's bars are not loaded";

  let trades: LensTrade[];
  let tradesBasis: string;
  if (record) {
    trades = simulateOver(record, params);
    tradesBasis =
      trades.length === evaluation.headline.tradeCount
        ? `all ${count(trades.length)} trades, re-simulated over every bar with the lens rule`
        : `re-simulated over every bar: ${count(trades.length)} trades against the evaluation's ${count(evaluation.headline.tradeCount)}`;
  } else {
    // A capped list (first and last N) is not a sample of the record: every rate,
    // mean, side split and Kelly size taken from it disagrees with the headline.
    // So no trade-list statistic is computed from it; each shows its reason.
    trades = evaluation.tradesTruncated ? [] : evaluation.trades;
    tradesBasis = evaluation.tradesTruncated
      ? `the trade list is capped at ${count(evaluation.trades.length)} of ${count(evaluation.headline.tradeCount)} for transport and ${recordReason}`
      : `the evaluation's ${count(trades.length)} trades`;
  }
  const costPerTradeUsd = Math.max(0, manifest.cost.roundTripPoints) * manifest.cost.pointValueUsd * params.costMultiplier;
  const facts = tradeFacts(trades, costPerTradeUsd);

  const happened = computeHappened(input, record, trades, facts, tradesBasis, recordReason);
  const why = computeWhy(input, record, trades, facts, recordReason);
  const next = computeNext(input, record, recordReason);
  const toDo = computeToDo(input, record, trades, facts, next, recordReason);
  return {
    modelId: evaluation.modelId,
    happened,
    why,
    next,
    toDo,
    recordNote: record ? `every one of the ${count(manifest.barCount)} bars of the record is loaded` : recordReason,
  };
}

// ─── Market chart overlay (src/shared/chartLink.ts contract) ────────────────

export interface LensChartOverlaySet {
  source: string;
  symbol: string;
  timeframe: string;
  overlays: Overlay[];
}

export function lensChartSource(modelId: string): string {
  return `${LENS_CHART_SOURCE_PREFIX}${modelId}`.slice(0, 120);
}

/**
 * The lens's trades and evaluation span as a Market-chart overlay set, drawn only when the chart shows
 * the model's own symbol and timeframe. Chart times are epoch milliseconds in the lake's own stamps,
 * which are the stamps the lens record carries. Each marker list keeps the latest 2,000 entries.
 */
export function buildLensChartOverlaySet(
  modelId: string,
  manifest: Pick<LensManifest, "symbol" | "timeframe">,
  trades: LensTrade[],
  span: { firstTimestampSeconds: number; lastTimestampSeconds: number },
): LensChartOverlaySet {
  const milliseconds = (seconds: number) => Math.round(seconds * 1000);
  function latest<T>(items: T[]): T[] {
    return items.slice(Math.max(0, items.length - LENS_CHART_MAX_MARKERS));
  }
  // One common window (the latest trades), split afterwards, so no entry is drawn
  // without its exit and no exit without its entry.
  const window = latest(trades);
  const longs = window.filter((trade) => trade.direction === 1);
  const shorts = window.filter((trade) => trade.direction === -1);
  const exits = window;
  const overlays: Overlay[] = [
    {
      kind: "zone",
      id: "evaluation_span",
      label:
        window.length < trades.length
          ? `Model Lens evaluation span (bluish-green shading); the latest ${count(window.length)} of ${count(trades.length)} trades are marked`
          : "Model Lens evaluation span (bluish-green shading)",
      color: "#009E7326",
      zones: [{ start: milliseconds(span.firstTimestampSeconds), end: milliseconds(span.lastTimestampSeconds), text: "lens test bars" }],
    },
  ];
  if (longs.length > 0) {
    overlays.push({
      kind: "marker",
      id: "long_entries",
      label: "Model Lens long entries (orange up arrow)",
      color: "#E69F00",
      markers: longs.map((trade) => ({
        time: milliseconds(trade.entryTimestampSeconds),
        position: "below",
        shape: "arrowUp",
        text: `long ${trade.probabilityUp.toFixed(2)}`,
      })),
    });
  }
  if (shorts.length > 0) {
    overlays.push({
      kind: "marker",
      id: "short_entries",
      label: "Model Lens short entries (blue down arrow)",
      color: "#0072B2",
      markers: shorts.map((trade) => ({
        time: milliseconds(trade.entryTimestampSeconds),
        position: "above",
        shape: "arrowDown",
        text: `short ${trade.probabilityUp.toFixed(2)}`,
      })),
    });
  }
  if (exits.length > 0) {
    overlays.push({
      kind: "marker",
      id: "exits",
      label: "Model Lens exits (sky square, net after costs)",
      color: "#56B4E9",
      markers: exits.map((trade) => ({
        time: milliseconds(trade.exitTimestampSeconds),
        position: "on",
        shape: "square",
        text: `exit ${signedUsd(trade.netUsd)}`.slice(0, 40),
      })),
    });
  }
  return { source: lensChartSource(modelId), symbol: manifest.symbol, timeframe: manifest.timeframe, overlays };
}

/** The trades the chart overlay should carry: re-simulated over every bar when loaded, else the evaluation's list. */
export function lensChartTrades(input: Pick<LensAnalyticsInput, "evaluation" | "manifest" | "bars">): LensTrade[] {
  const record = buildRecord(input.bars, input.manifest, input.evaluation.params);
  return record ? simulateOver(record, input.evaluation.params) : input.evaluation.trades;
}
