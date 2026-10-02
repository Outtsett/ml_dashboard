/**
 * The four analytics layers, computed from bars, news and Model Cycle runs.
 *
 * Pure functions: the server loads the inputs (apps/api/analytics/) and the
 * tests feed fixtures. Every trailing statistic is causal — a bar's volatility,
 * z-score or regime is computed from the bars before it, and a window that is
 * not yet full is null, never zero. Returns that span a session gap (a silence
 * longer than GAP_MULTIPLE typical bar intervals) are kept out of every
 * distribution and treated as events of their own.
 */

import { eightNumberSummary, quantileSorted, sortedFinite } from "../lens/stats";
import type {
  ActionName,
  ActionOutcome,
  AnalyticsBar,
  AnalyticsCost,
  AnalyticsNewsItem,
  AnalyticsResponse,
  CauseName,
  CauseShare,
  Descriptive,
  Diagnostic,
  Goal,
  GoalRecommendation,
  HistogramBin,
  HourProfileRow,
  LiftRow,
  ModelRunDetail,
  ModelRunSummary,
  MoveEvent,
  OutcomeDistribution,
  Predictive,
  Prescriptive,
  Probability,
  SessionDayRow,
  TrendRegime,
  VolatilityRegime,
} from "./types";

export const GAP_MULTIPLE = 3;
export const Z_WINDOW_BARS = 100;
export const EVENT_Z_THRESHOLD = 3;
export const LARGE_MOVE_Z = 2;
export const VOLATILITY_WINDOW_BARS = 20;
export const REGIME_LOOKBACK_BARS = 500;
export const TREND_WINDOW_BARS = 50;
export const NEWS_WINDOW_MINUTES = 60;
export const VOLUME_SURGE_RATIO = 3;
export const MIN_SEGMENT_TRADES = 20;
/** Bars each side of the news comparison needs before a ratio means anything. */
export const MIN_COMPARISON_BARS = 100;
/** Futures session day: the CME day starts 15:00 Pacific, so +9 h lands it on its trading date. */
export const FUTURES_SESSION_OFFSET_MS = 9 * 3_600_000;

const MINUTE = 60_000;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// ── primitives ─────────────────────────────────────────────────────────────

/**
 * Wilson score interval (95 %) for k successes in n trials. `effectiveTotal`
 * is the number of independent observations behind them: forward windows that
 * overlap share bars, so n overlapping h-bar windows carry about n / h
 * independent outcomes, and the interval is computed on that.
 */
export function wilson(count: number, total: number, effectiveTotal: number = total): Probability {
  const n = Math.max(0, Math.min(total, effectiveTotal));
  if (total <= 0 || n < 1) return { value: total > 0 ? count / total : null, low: null, high: null, count, total, effectiveTotal: n };
  const z = 1.959963984540054;
  const p = count / total;
  const denominator = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denominator;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denominator;
  return { value: p, low: Math.max(0, centre - half), high: Math.min(1, centre + half), count, total, effectiveTotal: n };
}

function meanOf(values: number[]): number | null {
  if (values.length === 0) return null;
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

/** Bins between the 1st and 99th percentiles; values outside fall in the edge bins. */
export function histogram(values: number[], binCount = 30): HistogramBin[] {
  const sorted = sortedFinite(values);
  if (sorted.length === 0) return [];
  let lower = quantileSorted(sorted, 0.01) as number;
  let upper = quantileSorted(sorted, 0.99) as number;
  if (!(upper > lower)) {
    lower = sorted[0] as number;
    upper = sorted[sorted.length - 1] as number;
  }
  if (!(upper > lower)) return [{ lower, upper, count: sorted.length }];
  const width = (upper - lower) / binCount;
  const bins: HistogramBin[] = Array.from({ length: binCount }, (_, i) => ({
    lower: lower + i * width,
    upper: lower + (i + 1) * width,
    count: 0,
  }));
  for (const value of sorted) {
    const index = Math.min(binCount - 1, Math.max(0, Math.floor((value - lower) / width)));
    (bins[index] as HistogramBin).count += 1;
  }
  return bins;
}

/** A window's sorted contents, updated one value in and one out: O(window) per step. */
class SortedWindow {
  private values: number[] = [];
  private readonly queue: number[] = [];
  constructor(private readonly size: number) {}
  get full(): boolean {
    return this.queue.length >= this.size;
  }
  median(): number | null {
    if (!this.full) return null;
    return quantileSorted(this.values, 0.5);
  }
  push(value: number): void {
    this.queue.push(value);
    this.values.splice(this.insertionIndex(value), 0, value);
    if (this.queue.length > this.size) {
      const gone = this.queue.shift() as number;
      this.values.splice(this.insertionIndex(gone), 1);
    }
  }
  private insertionIndex(value: number): number {
    let low = 0;
    let high = this.values.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if ((this.values[middle] as number) < value) low = middle + 1;
      else high = middle;
    }
    return low;
  }
}

export function typicalIntervalMs(bars: AnalyticsBar[]): number {
  const gaps: number[] = [];
  for (let i = 1; i < bars.length; i += 1) gaps.push((bars[i] as AnalyticsBar).timestamp - (bars[i - 1] as AnalyticsBar).timestamp);
  const median = quantileSorted(sortedFinite(gaps), 0.5);
  return median !== null && median > 0 ? median : MINUTE;
}

export function sessionDay(timestamp: number, assetClass: "futures" | "forex"): string {
  if (assetClass === "forex") return new Date(timestamp).toISOString().slice(0, 10);
  const shifted = new Date(timestamp + FUTURES_SESSION_OFFSET_MS);
  const weekday = shifted.getUTCDay();
  // A bar landing on a Saturday or Sunday belongs to Monday's session.
  if (weekday === 6) shifted.setUTCDate(shifted.getUTCDate() + 2);
  else if (weekday === 0) shifted.setUTCDate(shifted.getUTCDate() + 1);
  return shifted.toISOString().slice(0, 10);
}

/** Minutes after midnight on the chart's clock. */
function minuteOfDay(timestamp: number): number {
  const date = new Date(timestamp);
  return date.getUTCHours() * 60 + date.getUTCMinutes();
}

const LOCAL_MINUTE = new Map<string, Intl.DateTimeFormat>();

/** Minutes after local midnight in `zone` for a true-UTC instant. */
function localMinute(utcMs: number, zone: string): number {
  let format = LOCAL_MINUTE.get(zone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-GB", { timeZone: zone, hourCycle: "h23", hour: "2-digit", minute: "2-digit" });
    LOCAL_MINUTE.set(zone, format);
  }
  const parts = Object.fromEntries(format.formatToParts(new Date(utcMs)).map((part) => [part.type, part.value]));
  return Number(parts.hour) * 60 + Number(parts.minute);
}

function overlaps(start: number, length: number, openMinute: number, openLength = 15): boolean {
  return start < openMinute + openLength && start + length > openMinute;
}

/**
 * Whether the bar [timestamp, timestamp + interval) contains the first 15
 * minutes of a session open: the 06:30 Pacific cash open for futures (the bars'
 * own clock), London 08:00 and New York 09:30 local for forex (true UTC bars,
 * so daylight saving moves with the city). A daily or longer bar contains
 * every open, so it is never credited to one.
 */
export function isSessionOpen(timestamp: number, assetClass: "futures" | "forex", intervalMs = 5 * MINUTE): boolean {
  if (intervalMs >= 86_400_000) return false;
  const length = intervalMs / MINUTE;
  if (assetClass === "futures") return overlaps(minuteOfDay(timestamp), length, 390);
  return overlaps(localMinute(timestamp, "Europe/London"), length, 480) || overlaps(localMinute(timestamp, "America/New_York"), length, 570);
}

// ── the per-bar frame every layer reads ────────────────────────────────────

export interface BarFrame {
  bars: AnalyticsBar[];
  intervalMs: number;
  /** Log return into bar i, percent; null for the first bar. */
  returnPercent: Array<number | null>;
  /** The silence before bar i crossed a session gap. */
  gapBefore: boolean[];
  gapMinutes: Array<number | null>;
  /** Return into bar i over the trailing standard deviation of the previous Z_WINDOW_BARS in-session returns. */
  zScore: Array<number | null>;
  volumeRatio: Array<number | null>;
  volatility: Array<VolatilityRegime | null>;
  trend: Array<TrendRegime | null>;
}

export function buildFrame(bars: AnalyticsBar[]): BarFrame {
  const count = bars.length;
  const intervalMs = typicalIntervalMs(bars);
  const returnPercent: Array<number | null> = new Array(count).fill(null);
  const gapBefore: boolean[] = new Array(count).fill(false);
  const gapMinutes: Array<number | null> = new Array(count).fill(null);
  const zScore: Array<number | null> = new Array(count).fill(null);
  const volumeRatio: Array<number | null> = new Array(count).fill(null);
  const volatility: Array<VolatilityRegime | null> = new Array(count).fill(null);
  const trend: Array<TrendRegime | null> = new Array(count).fill(null);

  // Trailing in-session returns for the z-score (sum and sum of squares).
  const zQueue: number[] = [];
  let zSum = 0;
  let zSquares = 0;
  // Trailing in-session returns for the volatility regime, and the median of that volatility.
  const volatilityQueue: number[] = [];
  let volatilitySum = 0;
  let volatilitySquares = 0;
  const volatilityHistory = new SortedWindow(REGIME_LOOKBACK_BARS);
  const volumeHistory = new SortedWindow(Z_WINDOW_BARS);

  for (let i = 0; i < count; i += 1) {
    const bar = bars[i] as AnalyticsBar;
    const previous = i > 0 ? (bars[i - 1] as AnalyticsBar) : null;
    const volumeMedian = volumeHistory.median();
    volumeRatio[i] = volumeMedian !== null && volumeMedian > 0 ? bar.volume / volumeMedian : null;
    volumeHistory.push(bar.volume);

    if (previous && previous.close > 0 && bar.close > 0) {
      const silence = bar.timestamp - previous.timestamp;
      // A silence of 3+ bar intervals, or an hour-long halt that is 1.5+ intervals
      // (the CME 14:00-15:00 Pacific break at 1h reads as one missing bar).
      const gap = silence > GAP_MULTIPLE * intervalMs || (silence >= 45 * MINUTE && silence > 1.5 * intervalMs);
      gapBefore[i] = gap;
      gapMinutes[i] = gap ? silence / MINUTE : null;
      const value = Math.log(bar.close / previous.close) * 100;
      returnPercent[i] = value;

      if (zQueue.length >= Z_WINDOW_BARS) {
        const average = zSum / zQueue.length;
        const variance = zSquares / zQueue.length - average * average;
        zScore[i] = variance > 0 ? (value - average) / Math.sqrt(variance) : null;
      }
      if (!gap) {
        zQueue.push(value);
        zSum += value;
        zSquares += value * value;
        if (zQueue.length > Z_WINDOW_BARS) {
          const gone = zQueue.shift() as number;
          zSum -= gone;
          zSquares -= gone * gone;
        }
        volatilityQueue.push(value);
        volatilitySum += value;
        volatilitySquares += value * value;
        if (volatilityQueue.length > VOLATILITY_WINDOW_BARS) {
          const gone = volatilityQueue.shift() as number;
          volatilitySum -= gone;
          volatilitySquares -= gone * gone;
        }
      }
    }

    if (volatilityQueue.length >= VOLATILITY_WINDOW_BARS) {
      const average = volatilitySum / volatilityQueue.length;
      const current = Math.sqrt(Math.max(0, volatilitySquares / volatilityQueue.length - average * average));
      const median = volatilityHistory.median();
      if (median !== null) volatility[i] = current > median ? "high" : "low";
      volatilityHistory.push(current);
    }
    if (i >= TREND_WINDOW_BARS) {
      const past = (bars[i - TREND_WINDOW_BARS] as AnalyticsBar).close;
      if (past > 0) trend[i] = bar.close >= past ? "up" : "down";
    }
  }
  return { bars, intervalMs, returnPercent, gapBefore, gapMinutes, zScore, volumeRatio, volatility, trend };
}

function inSessionReturns(frame: BarFrame): number[] {
  const out: number[] = [];
  frame.returnPercent.forEach((value, i) => {
    if (value !== null && !frame.gapBefore[i]) out.push(value);
  });
  return out;
}

// ── news alignment ─────────────────────────────────────────────────────────

/** Articles known in (from, to], by binary search on the sorted news. */
export function newsBetween(news: AnalyticsNewsItem[], from: number, to: number): AnalyticsNewsItem[] {
  let low = 0;
  let high = news.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((news[middle] as AnalyticsNewsItem).seenAt <= from) low = middle + 1;
    else high = middle;
  }
  const out: AnalyticsNewsItem[] = [];
  for (let i = low; i < news.length && (news[i] as AnalyticsNewsItem).seenAt <= to; i += 1) out.push(news[i] as AnalyticsNewsItem);
  return out;
}

function meanScore(items: AnalyticsNewsItem[]): number | null {
  return meanOf(items.map((item) => item.score).filter((score): score is number => score !== null));
}

// ── descriptive ────────────────────────────────────────────────────────────

export function describe(
  frame: BarFrame,
  news: AnalyticsNewsItem[],
  runs: ModelRunSummary[],
  assetClass: "futures" | "forex",
): Descriptive {
  const { bars } = frame;
  const first = bars[0] as AnalyticsBar;
  const last = bars[bars.length - 1] as AnalyticsBar;
  const returns = inSessionReturns(frame);

  const thinEvery = Math.max(1, Math.ceil(bars.length / 1200));
  const closeSeries = bars
    .filter((_, i) => i % thinEvery === 0 || i === bars.length - 1)
    .map((bar) => ({ timestamp: bar.timestamp, close: bar.close }));

  const hours = new Map<number, { count: number; returns: number[]; volumes: number[] }>();
  bars.forEach((bar, i) => {
    const hour = new Date(bar.timestamp).getUTCHours();
    const slot = hours.get(hour) ?? { count: 0, returns: [], volumes: [] };
    slot.count += 1;
    slot.volumes.push(bar.volume);
    const value = frame.returnPercent[i];
    if (value !== null && value !== undefined && !frame.gapBefore[i]) slot.returns.push(value);
    hours.set(hour, slot);
  });
  const hourProfile: HourProfileRow[] = [...hours.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([hour, slot]) => ({
      hour,
      barCount: slot.count,
      meanReturnPercent: meanOf(slot.returns),
      meanAbsoluteReturnPercent: meanOf(slot.returns.map(Math.abs)),
      meanVolume: meanOf(slot.volumes),
    }));

  const days = new Map<string, AnalyticsBar[]>();
  for (const bar of bars) {
    const day = sessionDay(bar.timestamp, assetClass);
    const list = days.get(day) ?? [];
    list.push(bar);
    days.set(day, list);
  }
  const newsByDay = new Map<string, AnalyticsNewsItem[]>();
  for (const item of news) {
    const day = sessionDay(item.seenAt, assetClass);
    const list = newsByDay.get(day) ?? [];
    list.push(item);
    newsByDay.set(day, list);
  }
  const sessionDays: SessionDayRow[] = [...days.entries()].map(([day, list]) => {
    const open = (list[0] as AnalyticsBar).open;
    const close = (list[list.length - 1] as AnalyticsBar).close;
    const items = newsByDay.get(day) ?? [];
    return {
      day,
      open,
      close,
      high: Math.max(...list.map((bar) => bar.high)),
      low: Math.min(...list.map((bar) => bar.low)),
      returnPercent: open > 0 ? (close / open - 1) * 100 : 0,
      rangePoints: Math.max(...list.map((bar) => bar.high)) - Math.min(...list.map((bar) => bar.low)),
      volume: list.reduce((sum, bar) => sum + bar.volume, 0),
      articleCount: items.length,
      meanSentiment: meanScore(items),
    };
  });
  const lastDay = sessionDays[sessionDays.length - 1];

  return {
    firstBar: first.timestamp,
    lastBar: last.timestamp,
    barCount: bars.length,
    lastClose: last.close,
    windowChangePoints: last.close - first.open,
    windowChangePercent: first.open > 0 ? (last.close / first.open - 1) * 100 : 0,
    lastDayChangePercent: lastDay ? lastDay.returnPercent : null,
    returnPercent: eightNumberSummary(returns),
    rangePoints: eightNumberSummary(bars.map((bar) => bar.high - bar.low)),
    volume: eightNumberSummary(bars.map((bar) => bar.volume)),
    returnHistogram: histogram(returns, 40),
    closeSeries,
    hourProfile,
    sessionDays: sessionDays.slice(-90),
    news: {
      articleCount: news.length,
      daysWithNews: newsByDay.size,
      meanSentiment: meanScore(news),
      latest: news.slice(-12).reverse(),
    },
    runs,
  };
}

// ── diagnostic ─────────────────────────────────────────────────────────────

export function diagnose(
  frame: BarFrame,
  news: AnalyticsNewsItem[],
  assetClass: "futures" | "forex",
  model: ModelRunDetail | null,
): Diagnostic {
  const { bars } = frame;
  const events: MoveEvent[] = [];
  bars.forEach((bar, i) => {
    const z = frame.zScore[i];
    const value = frame.returnPercent[i];
    if (z === null || z === undefined || value === null || value === undefined || Math.abs(z) < EVENT_Z_THRESHOLD) return;
    // Known before the bar CLOSED: an article known later cannot have moved it.
    const nearby = newsBetween(news, bar.timestamp + frame.intervalMs - NEWS_WINDOW_MINUTES * MINUTE, bar.timestamp + frame.intervalMs - 1);
    const sentiment = meanScore(nearby);
    const loudest = [...nearby].sort((a, b) => Math.abs(b.score ?? 0) - Math.abs(a.score ?? 0))[0] ?? null;
    const ratio = frame.volumeRatio[i] ?? null;
    const evidence: string[] = [];
    const matched: CauseName[] = [];
    if (frame.gapBefore[i]) {
      matched.push("session_gap");
      evidence.push(`first bar after ${Math.round(frame.gapMinutes[i] ?? 0)} minutes without trading`);
    }
    if (nearby.length > 0) {
      const agrees = sentiment !== null && Math.sign(sentiment) === Math.sign(value);
      // News is named the cause only when its tone points the way the price moved
      // (or it was never scored); news against the move is evidence, not a cause.
      if (agrees || sentiment === null) matched.push("news");
      evidence.push(
        `${nearby.length} article${nearby.length === 1 ? "" : "s"} known in the ${NEWS_WINDOW_MINUTES} minutes before the bar closed` +
          (sentiment !== null ? `, mean FinBERT ${sentiment.toFixed(2)} (${agrees ? "same direction as the move" : "opposite to the move"})` : ""),
      );
    }
    if (isSessionOpen(bar.timestamp, assetClass, frame.intervalMs)) {
      matched.push("session_open");
      evidence.push(assetClass === "futures" ? "inside the 06:30-06:45 Pacific cash open" : "inside the London or New York open");
    }
    if (ratio !== null && ratio >= VOLUME_SURGE_RATIO) {
      matched.push("volume_surge");
      evidence.push(`volume ${ratio.toFixed(1)}x the median of the previous ${Z_WINDOW_BARS} bars`);
    }
    events.push({
      timestamp: bar.timestamp,
      returnPercent: value,
      zScore: z,
      cause: matched[0] ?? "no_recorded_cause",
      evidence,
      gapMinutes: frame.gapMinutes[i] ?? null,
      volumeRatio: ratio,
      newsCount: nearby.length,
      newsMeanSentiment: sentiment,
      headline: loudest?.title ?? null,
    });
  });

  const causeCounts = new Map<CauseName, number>();
  for (const event of events) causeCounts.set(event.cause, (causeCounts.get(event.cause) ?? 0) + 1);
  const causes: CauseShare[] = (["session_gap", "news", "session_open", "volume_surge", "no_recorded_cause"] as CauseName[]).map((cause) => ({
    cause,
    eventCount: causeCounts.get(cause) ?? 0,
    share: events.length ? (causeCounts.get(cause) ?? 0) / events.length : 0,
  }));

  // Lift: how much more often a large move happens in each hour / weekday than on any bar.
  const scored: Array<{ i: number; large: boolean; absolute: number }> = [];
  bars.forEach((_, i) => {
    const z = frame.zScore[i];
    const value = frame.returnPercent[i];
    if (z === null || z === undefined || value === null || value === undefined || frame.gapBefore[i]) return;
    scored.push({ i, large: Math.abs(z) >= LARGE_MOVE_Z, absolute: Math.abs(value) });
  });
  const baseRate = scored.length ? scored.filter((row) => row.large).length / scored.length : 0;
  const lift = (keyOf: (timestamp: number) => string, order: string[]): LiftRow[] => {
    const groups = new Map<string, typeof scored>();
    for (const row of scored) {
      const key = keyOf((bars[row.i] as AnalyticsBar).timestamp);
      const list = groups.get(key) ?? [];
      list.push(row);
      groups.set(key, list);
    }
    return order
      .filter((key) => groups.has(key))
      .map((key) => {
        const list = groups.get(key) as typeof scored;
        const large = list.filter((row) => row.large).length;
        return {
          key,
          barCount: list.length,
          largeMoveCount: large,
          lift: baseRate > 0 ? large / list.length / baseRate : null,
          meanAbsoluteReturnPercent: meanOf(list.map((row) => row.absolute)),
        };
      });
  };
  const hourLift = lift(
    (timestamp) => String(new Date(timestamp).getUTCHours()).padStart(2, "0"),
    Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, "0")),
  );
  const weekdayLift = lift((timestamp) => WEEKDAYS[new Date(timestamp).getUTCDay()] as string, WEEKDAYS);

  // News effect, on the days the news record covers only.
  // Covered = inside the span the news record spans, not merely the same day:
  // a weekend's articles mapped onto Monday would mark Monday covered.
  const firstKnown = news.length ? (news[0] as AnalyticsNewsItem).seenAt : Infinity;
  const lastKnown = news.length ? (news[news.length - 1] as AnalyticsNewsItem).seenAt : -Infinity;
  const after: number[] = [];
  const without: number[] = [];
  for (const row of scored) {
    const bar = bars[row.i] as AnalyticsBar;
    if (bar.timestamp < firstKnown || bar.timestamp > lastKnown + NEWS_WINDOW_MINUTES * MINUTE) continue;
    const recent = newsBetween(news, bar.timestamp - NEWS_WINDOW_MINUTES * MINUTE, bar.timestamp);
    (recent.length > 0 ? after : without).push(row.absolute);
  }
  const afterMean = meanOf(after);
  const withoutMean = meanOf(without);
  const comparable = after.length >= MIN_COMPARISON_BARS && without.length >= MIN_COMPARISON_BARS;
  let newsNote: string | null = null;
  if (news.length === 0) newsNote = "No news in the window.";
  else if (!comparable)
    newsNote =
      `Too few bars on one side to compare (${after.length} within ${NEWS_WINDOW_MINUTES} minutes after an article, ${without.length} without; ` +
      `each side needs ${MIN_COMPARISON_BARS}). GDELT sweeps every 15 minutes, so while it covers a stretch almost every bar follows an article.`;

  return {
    zThreshold: EVENT_Z_THRESHOLD,
    eventCount: events.length,
    largestMoves: [...events].sort((a, b) => Math.abs(b.zScore) - Math.abs(a.zScore)).slice(0, 25),
    causes,
    hourLift,
    weekdayLift,
    newsEffect: {
      coveredBarCount: after.length + without.length,
      afterNews: { barCount: after.length, meanAbsoluteReturnPercent: afterMean },
      withoutNews: { barCount: without.length, meanAbsoluteReturnPercent: withoutMean },
      ratio: comparable && afterMean !== null && withoutMean !== null && withoutMean > 0 ? afterMean / withoutMean : null,
      note: newsNote,
    },
    model,
  };
}

// ── predictive ─────────────────────────────────────────────────────────────

interface ForwardSample {
  volatility: VolatilityRegime | null;
  trend: TrendRegime | null;
  movePoints: number;
}

/**
 * Every bar whose forward window of `horizon` bars has closed and crosses no
 * session gap: its state then, and the move that followed.
 */
export function forwardSamples(frame: BarFrame, horizon: number): ForwardSample[] {
  const { bars } = frame;
  const out: ForwardSample[] = [];
  for (let i = 0; i + horizon < bars.length; i += 1) {
    let crosses = false;
    for (let j = i + 1; j <= i + horizon; j += 1) {
      if (frame.gapBefore[j]) {
        crosses = true;
        break;
      }
    }
    if (crosses) continue;
    out.push({
      volatility: frame.volatility[i] ?? null,
      trend: frame.trend[i] ?? null,
      movePoints: (bars[i + horizon] as AnalyticsBar).close - (bars[i] as AnalyticsBar).close,
    });
  }
  return out;
}

export function outcomeDistribution(
  label: string,
  moves: number[],
  costPoints: number | null,
  largeMovePoints: number | null,
  horizon = 1,
): OutcomeDistribution {
  const sorted = sortedFinite(moves);
  const total = sorted.length;
  const effective = total / Math.max(1, horizon);
  const count = (predicate: (move: number) => boolean) => moves.filter(predicate).length;
  const wilsonOf = (successes: number) => wilson(successes, total, effective);
  const cost = costPoints ?? 0;
  const large = largeMovePoints ?? Infinity;
  const q = (quantile: number) => quantileSorted(sorted, quantile);
  return {
    label,
    sampleCount: total,
    probabilityUp: wilsonOf(count((move) => move > 0)),
    probabilityBeatsCostUp: wilsonOf(count((move) => move > cost)),
    probabilityBeatsCostDown: wilsonOf(count((move) => move < -cost)),
    probabilityLargeUp: wilsonOf(count((move) => move >= large)),
    probabilityLargeDown: wilsonOf(count((move) => move <= -large)),
    quantilesPoints: { p10: q(0.1), p25: q(0.25), p50: q(0.5), p75: q(0.75), p90: q(0.9) },
    meanPoints: meanOf(moves),
    histogram: histogram(moves, 30),
  };
}

export function stateLabel(volatility: VolatilityRegime | null, trend: TrendRegime | null): string {
  if (!volatility || !trend) return "state not yet known (warming up)";
  return `${volatility} volatility, trending ${trend}`;
}

export function predict(
  frame: BarFrame,
  horizon: number,
  cost: AnalyticsCost | null,
  model: ModelRunDetail | null,
): { predictive: Predictive; currentMoves: number[] } {
  const { bars } = frame;
  const last = bars.length - 1;
  const volatility = frame.volatility[last] ?? null;
  const trend = frame.trend[last] ?? null;
  const samples = forwardSamples(frame, horizon);
  const allMoves = samples.map((sample) => sample.movePoints);
  const largeMovePoints = eightNumberSummary(allMoves).standardDeviation;
  const costPoints = cost ? cost.roundTripCostPoints : null;
  const currentMoves = samples
    .filter((sample) => sample.volatility === volatility && sample.trend === trend && volatility !== null && trend !== null)
    .map((sample) => sample.movePoints);

  const byState: OutcomeDistribution[] = [];
  for (const v of ["low", "high"] as VolatilityRegime[]) {
    for (const t of ["up", "down"] as TrendRegime[]) {
      const moves = samples.filter((sample) => sample.volatility === v && sample.trend === t).map((sample) => sample.movePoints);
      byState.push(outcomeDistribution(stateLabel(v, t), moves, costPoints, largeMovePoints, horizon));
    }
  }

  let modelView: Predictive["model"] = null;
  if (model?.lastPrediction) {
    const p = model.lastPrediction.probabilityUp;
    const bin = model.calibration.find((row) => p >= row.probabilityLower && p <= row.probabilityUpper) ?? null;
    modelView = {
      modelId: model.run.modelId,
      modelLabel: model.run.modelLabel,
      probabilityUp: p,
      timestamp: model.lastPrediction.timestamp,
      calibratedUpFraction: bin?.observedUpFraction ?? null,
      calibrationBin: bin ? `${bin.probabilityLower.toFixed(2)}-${bin.probabilityUpper.toFixed(2)} (${bin.scoredBarCount} bars)` : null,
    };
  }

  return {
    currentMoves,
    predictive: {
      horizonBars: horizon,
      asOf: (bars[last] as AnalyticsBar).timestamp,
      state: { volatility, trend, label: stateLabel(volatility, trend) },
      largeMovePoints,
      costPoints,
      current: outcomeDistribution(stateLabel(volatility, trend), currentMoves, costPoints, largeMovePoints, horizon),
      unconditional: outcomeDistribution("every state", allMoves, costPoints, largeMovePoints, horizon),
      byState,
      model: modelView,
    },
  };
}

// ── prescriptive ───────────────────────────────────────────────────────────

export function actionOutcome(action: ActionName, moves: number[], cost: AnalyticsCost | null, horizon = 1): ActionOutcome {
  const effective = moves.length / Math.max(1, horizon);
  if (action === "flat") {
    return {
      action,
      expectedNetUsd: cost ? 0 : null,
      expectedNetPoints: 0,
      probabilityProfit: wilson(0, moves.length, effective),
      downsideP10Usd: cost ? 0 : null,
      upsideP90Usd: cost ? 0 : null,
      rewardToRisk: null,
      kellyFraction: null,
    };
  }
  const sign = action === "long" ? 1 : -1;
  const costPoints = cost?.roundTripCostPoints ?? 0;
  const netPoints = moves.map((move) => sign * move - costPoints);
  const sorted = sortedFinite(netPoints);
  const expectedNetPoints = meanOf(netPoints);
  const wins = netPoints.filter((value) => value > 0);
  const losses = netPoints.filter((value) => value <= 0);
  const probability = wilson(wins.length, netPoints.length, effective);
  const p10 = quantileSorted(sorted, 0.1);
  const p90 = quantileSorted(sorted, 0.9);
  const toUsd = (points: number | null) => (points === null || !cost ? null : points * cost.pointValueUsd);

  let kellyFraction: number | null = null;
  const averageWin = meanOf(wins);
  const averageLoss = meanOf(losses.map(Math.abs));
  if (probability.value !== null && averageWin !== null && averageLoss !== null && averageLoss > 0) {
    const payoff = averageWin / averageLoss;
    const kelly = probability.value - (1 - probability.value) / payoff;
    kellyFraction = Math.min(0.25, Math.max(0, kelly / 2));
  }
  return {
    action,
    expectedNetUsd: toUsd(expectedNetPoints),
    expectedNetPoints,
    probabilityProfit: probability,
    downsideP10Usd: toUsd(p10),
    upsideP90Usd: toUsd(p90),
    rewardToRisk: expectedNetPoints !== null && p10 !== null && p10 < 0 ? expectedNetPoints / Math.abs(p10) : null,
    kellyFraction,
  };
}

/** The run that best serves the goal among runs that finished with metrics. */
export function pickRun(runs: ModelRunSummary[], goal: Goal): { run: ModelRunSummary; metric: string; value: number | null } | null {
  // A run with a handful of trades wins every ranking by luck.
  const scored = runs.filter((run) => run.netProfitUsd !== null && (run.tradeCount ?? 0) >= MIN_SEGMENT_TRADES);
  if (scored.length === 0) return null;
  const valueOf = (run: ModelRunSummary): number | null => {
    if (goal === "profit") return run.netProfitUsd;
    if (goal === "win_rate") return run.winRate;
    if (run.netProfitUsd === null || run.maximumDrawdownUsd === null || run.maximumDrawdownUsd === 0) return null;
    return run.netProfitUsd / Math.abs(run.maximumDrawdownUsd);
  };
  const metric = goal === "profit" ? "net profit (USD)" : goal === "win_rate" ? "win rate" : "net profit / maximum drawdown";
  const ranked = scored
    .map((run) => ({ run, value: valueOf(run) }))
    .filter((row) => row.value !== null)
    .sort((a, b) => (b.value as number) - (a.value as number));
  const best = ranked[0];
  return best ? { run: best.run, metric, value: best.value } : null;
}

function modelAdvice(detail: ModelRunDetail | undefined): Pick<GoalRecommendation, "confidenceBuckets" | "hoursToAvoid"> {
  if (!detail) return { confidenceBuckets: { keep: [], skip: [] }, hoursToAvoid: [] };
  const keep: string[] = [];
  const skip: string[] = [];
  for (const row of detail.segments.filter((segment) => segment.segmentKind === "entry_confidence")) {
    if ((row.tradeCount ?? 0) >= MIN_SEGMENT_TRADES && (row.expectancyUsd ?? 0) > 0) keep.push(row.segmentValue);
    else skip.push(row.segmentValue);
  }
  const hoursToAvoid = detail.hours
    .filter((row) => row.exposedBarCount >= MIN_SEGMENT_TRADES && row.netProfitUsd < 0)
    .sort((a, b) => a.netProfitUsd - b.netProfitUsd)
    .map((row) => row.hour);
  return { confidenceBuckets: { keep, skip }, hoursToAvoid };
}

function formatUsd(value: number | null): string {
  if (value === null) return "n/a";
  return `${value < 0 ? "-" : ""}$${Math.abs(value).toFixed(2)}`;
}

export function prescribe(
  currentMoves: number[],
  horizon: number,
  cost: AnalyticsCost | null,
  runs: ModelRunSummary[],
  details: Map<string, ModelRunDetail>,
  asOf = 0,
): Prescriptive {
  const actions = (["long", "short", "flat"] as ActionName[]).map((action) => actionOutcome(action, currentMoves, cost, horizon));
  const effective = currentMoves.length / Math.max(1, horizon);
  const trades = actions.filter((row) => row.action !== "flat");
  const net = (row: ActionOutcome) => row.expectedNetPoints ?? -Infinity;
  const describeNet = (row: ActionOutcome) =>
    cost ? `${formatUsd(row.expectedNetUsd)} per contract` : `${(row.expectedNetPoints ?? 0).toFixed(5)} points (costs not priced)`;

  const recommendations: GoalRecommendation[] = (["profit", "win_rate", "risk"] as Goal[]).map((goal) => {
    let chosen: ActionOutcome | undefined;
    let reason: string;
    if (!cost) {
      // Without a cost model no side can be shown to beat its costs: the
      // expected moves are kept for reading, the action is not chosen from them.
      reason = "No cost model for this symbol, so no side can be shown to beat its costs; no trade is recommended. The expected moves below are before costs.";
    } else if (goal === "profit") {
      chosen = [...trades].sort((a, b) => net(b) - net(a))[0];
      if (!chosen || net(chosen) <= 0) {
        reason = `Neither side has a positive expected result after costs over ${horizon} bars in this state; stay flat.`;
        chosen = undefined;
      } else {
        reason = `Going ${chosen.action} averaged ${describeNet(chosen)} over ${horizon} bars in this state (${currentMoves.length} past cases, about ${Math.round(effective)} independent).`;
      }
    } else if (goal === "win_rate") {
      chosen = [...trades].sort((a, b) => (b.probabilityProfit.value ?? 0) - (a.probabilityProfit.value ?? 0))[0];
      const p = chosen?.probabilityProfit.value ?? 0;
      if (!chosen || p <= 0.5 || net(chosen) <= 0) {
        reason = `No side wins more than half the time with a positive expected result after costs; stay flat.`;
        chosen = undefined;
      } else {
        reason = `Going ${chosen.action} won after costs ${(p * 100).toFixed(1)}% of the time (95% interval ${((chosen.probabilityProfit.low ?? 0) * 100).toFixed(1)}-${((chosen.probabilityProfit.high ?? 0) * 100).toFixed(1)}%).`;
      }
    } else {
      chosen = [...trades].filter((row) => (row.rewardToRisk ?? -Infinity) > 0).sort((a, b) => (b.rewardToRisk ?? 0) - (a.rewardToRisk ?? 0))[0];
      if (!chosen || net(chosen) <= 0) {
        reason = `No side's expected result outweighs its bad-case (10th percentile) loss; stay flat.`;
        chosen = undefined;
      } else {
        reason = `Going ${chosen.action} returned ${(chosen.rewardToRisk ?? 0).toFixed(2)} of expected result per unit of 10th-percentile loss; half-Kelly size ${((chosen.kellyFraction ?? 0) * 100).toFixed(1)}% of risk capital.`;
      }
    }
    const picked = pickRun(runs, goal);
    return {
      goal,
      action: chosen?.action ?? "flat",
      reason,
      run: picked ? { modelId: picked.run.modelId, modelLabel: picked.run.modelLabel, metric: picked.metric, value: picked.value } : null,
      ...modelAdvice(picked ? details.get(picked.run.recipe) : undefined),
    };
  });

  const caveats = [
    `Probabilities are how often each outcome followed the same state in this symbol's own history (${currentMoves.length} overlapping cases, about ${Math.round(effective)} independent ones); they are frequencies, not guarantees.`,
    "Each 95% interval is computed on the independent cases only (windows of the horizon overlap and share bars), so it is as wide as the evidence really allows.",
    "A state that recurs rarely gives wide intervals: read the 95% range before the point value.",
  ];
  if (!cost) caveats.push("No cost model for this symbol (forex has none in packages/config/cost_model.json): results are in points before costs.");
  if (effective < 30) caveats.push("Fewer than 30 independent past cases in this state: treat every number here as indicative only.");

  return { horizonBars: horizon, asOf, costPriced: cost !== null, actions, recommendations, caveats };
}

/** All four layers from one set of inputs. */
export function analyse(input: {
  bars: AnalyticsBar[];
  news: AnalyticsNewsItem[];
  runs: ModelRunSummary[];
  details: Map<string, ModelRunDetail>;
  latestDetail: ModelRunDetail | null;
  cost: AnalyticsCost | null;
  assetClass: "futures" | "forex";
  horizon: number;
}): Pick<AnalyticsResponse, "descriptive" | "diagnostic" | "predictive" | "prescriptive"> {
  const frame = buildFrame(input.bars);
  const { predictive, currentMoves } = predict(frame, input.horizon, input.cost, input.latestDetail);
  return {
    descriptive: describe(frame, input.news, input.runs, input.assetClass),
    diagnostic: diagnose(frame, input.news, input.assetClass, input.latestDetail),
    predictive,
    prescriptive: prescribe(
      currentMoves,
      input.horizon,
      input.cost,
      input.runs,
      input.details,
      (input.bars[input.bars.length - 1] as AnalyticsBar).timestamp,
    ),
  };
}
