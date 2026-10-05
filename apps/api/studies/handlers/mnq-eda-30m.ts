/**
 * MNQ exploratory data analysis (the study that replaced the marimo notebook
 * Trading/quant/model/notebooks/eda_mnq_1d.py, whose content is the
 * 30-minute bars despite its file name).
 *
 * One handler, eleven sections, chosen by `?section=`: each section of the page
 * asks for its own body with its own controls, so dragging a slider recomputes
 * only what it changes. Every section reads the same bars, cached per lake for
 * five minutes, from the lake views through `context.lake`:
 *
 *   full      `mnq_ohlcv_<tf>`: the dedicated MNQ view, every bar since 2019-05
 *             (78,615 at 30 minutes). This is the series the notebook's prose
 *             describes ("~78,474 bars, 2019-05-05 to 2025-12-25").
 *   notebook  `ohlcv_<tf>` WHERE symbol = 'MNQ' (`ohlcv_1h_v` at one hour): what
 *             the notebook's own loader reads today, because the lake serving
 *             layer maps "30m" to the shared view whose retention cuts MNQ at
 *             2023-03 (33,443 bars). Through it the notebook's walk-forward
 *             cell finds no fold at all.
 *
 * ADF and KPSS (statsmodels, a long autolag) are not computed here: the landing
 * job packages/ml-engine/src/studies/mnq_eda_30m/build.py wrote them to
 * `derived_study_mnq_eda_30m_stationarity_tests`, and the stationarity section
 * reads that. Everything else is computed from the bars in
 * packages/shared/src/studies/mnq-eda-30m.ts, which is checked against scipy and
 * statsmodels in apps/api/tests/studies/mnq-eda-30m.test.ts.
 */

import { z } from "zod";
import { sessionDay } from "@shared/analytics/compute";
import {
  BARS_PER_DAY_BASES, DAY_BASES, PRICE_BUCKETS, SECTIONS, SOURCES, TENSOR_CHANNELS, TIMEFRAMES, TIMEFRAME_MINUTES,
  autocorrelation, binCounts, countBelow, dAgostinoPearson, describeMoments, directionLabelCounts,
  fillibenPositions, kruskalWallis, leastSquaresLine, logReturns, modelInputChannels, modelInputTensor, normalQuantile,
  partialAutocorrelation, quantileOfSorted, rollingStandardDeviation, sortedFiniteValues, twoSidedNormalQuantile,
  walkForwardFolds,
} from "@shared/studies/mnq-eda-30m";
import type {
  AutocorrelationBody, CandleColumns, ColumnProfile, ColumnsBody, FoldsBody, HistogramBinRow, LabelConfigRow, LabelsBody,
  PriceBody, ProvenanceRow, ReturnsBody, SeriesInfo, SeriesSource, SourceCount, StationarityBody, StationarityRow, SummaryBody, TensorBody,
  Timeframe, VolatilityBody, WeekdayBody, WeekdayRow,
} from "@shared/studies/mnq-eda-30m";
import { ident, text } from "../sql";
import type { StudyContext, StudyHandler, StudyLake } from "../types";
import { missingViews } from "../views";

const STATIONARITY_VIEW = "derived_study_mnq_eda_30m_stationarity_tests";
const PROVENANCE_VIEW = "derived_study_mnq_eda_30m_series_provenance";
const STATIONARITY_COLUMNS = [
  "source", "timeframe", "series", "test", "bar_count", "statistic", "p_value", "p_value_is_table_edge", "lags_used",
  "observations_used", "critical_value_1_percent", "critical_value_2_5_percent", "critical_value_5_percent",
  "critical_value_10_percent", "null_hypothesis", "verdict", "computed_with",
].map(ident).join(", ");
const PROVENANCE_COLUMNS = [
  "source", "timeframe", "view", "loader", "bar_count", "first_bar_label", "last_bar_label", "close_minimum", "close_maximum",
  "median_bars_per_calendar_day", "default_walk_forward_fold_count",
].map(ident).join(", ");
const SYMBOL = "MNQ";
const DAY_MS = 86_400_000;
const CACHE_MS = 5 * 60_000;
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

/** The view a (source, timeframe) pair reads. */
export function viewFor(source: SeriesSource, timeframe: Timeframe): string {
  if (source === "full") return `mnq_ohlcv_${timeframe}`;
  return timeframe === "1h" ? "ohlcv_1h_v" : `ohlcv_${timeframe}`;
}

const ALL_VIEWS = [...new Set(TIMEFRAMES.flatMap((timeframe) => [viewFor("full", timeframe), viewFor("notebook", timeframe)]))];

export const querySchema = z.object({
  section: z.enum(SECTIONS).default("summary"),
  timeframe: z.enum(TIMEFRAMES).default("30m"),
  source: z.enum(SOURCES).default("full"),
  priceBucket: z.enum(PRICE_BUCKETS).default("native"),
  priceBars: z.coerce.number().int().min(50).max(3000).default(800),
  pricePosition: z.coerce.number().int().min(0).max(1000).default(1000),
  histogramBins: z.coerce.number().int().min(10).max(200).default(60),
  histogramRange: z.enum(["full", "core"]).default("full"),
  lags: z.coerce.number().int().min(5).max(100).default(40),
  confidencePercent: z.coerce.number().refine((value) => [90, 95, 99].includes(value), "90, 95 or 99").default(95),
  shortWindowDays: z.coerce.number().int().min(1).max(60).default(5),
  longWindowDays: z.coerce.number().int().min(2).max(250).default(21),
  barsPerDayBasis: z.enum(BARS_PER_DAY_BASES).default("nominal"),
  annualisationDays: z.coerce.number().int().min(200).max(365).default(252),
  highVolatilityPercentile: z.coerce.number().min(0.5).max(0.99).default(0.75),
  dayBasis: z.enum(DAY_BASES).default("calendar"),
  tensorWindow: z.coerce.number().int().min(2).max(256).default(32),
  tensorPosition: z.coerce.number().int().min(0).max(1000).default(1000),
  tensorClamp: z.coerce.number().min(0.5).max(20).default(5),
  horizon: z.coerce.number().int().min(1).max(96).default(1),
  flatThresholdPoints: z.coerce.number().min(0).max(500).default(20.5),
  foldMonths: z.coerce.number().int().min(1).max(36).default(12),
  purgeBars: z.coerce.number().int().min(0).max(5000).default(240),
  minTrainMonths: z.coerce.number().int().min(1).max(72).default(24),
});
type Query = z.infer<typeof querySchema>;

// ── the bars, cached per lake ────────────────────────────────────────────────

interface Bars {
  view: string;
  timeframe: Timeframe;
  source: SeriesSource;
  count: number;
  /** Epoch milliseconds in the lake's stamping (Pacific wall clock stored as UTC). */
  time: Float64Array;
  open: Float64Array;
  high: Float64Array;
  low: Float64Array;
  close: Float64Array;
  volume: Float64Array;
  returns: Float64Array;
}

/** The promise is cached, so the page's sections opening together share one read of the lake. */
const cache = new WeakMap<StudyLake, Map<string, { at: number; bars: Promise<Bars> }>>();

async function readBars(lake: StudyLake, source: SeriesSource, timeframe: Timeframe): Promise<Bars> {
  const view = viewFor(source, timeframe);
  const rows = await lake.query<{ t: number; open: number | null; high: number | null; low: number | null; close: number | null; volume: number | null }>(
    `SELECT epoch_ms(timestamp) AS t, open, high, low, close, volume FROM ${ident(view)} WHERE symbol = ${text(SYMBOL)} ORDER BY timestamp`,
    120_000,
  );
  const count = rows.length;
  const bars: Bars = {
    view, timeframe, source, count,
    time: new Float64Array(count), open: new Float64Array(count), high: new Float64Array(count),
    low: new Float64Array(count), close: new Float64Array(count), volume: new Float64Array(count),
    returns: new Float64Array(0),
  };
  const number = (value: number | null) => (value === null || value === undefined ? Number.NaN : Number(value));
  rows.forEach((row, index) => {
    bars.time[index] = Number(row.t);
    bars.open[index] = number(row.open);
    bars.high[index] = number(row.high);
    bars.low[index] = number(row.low);
    bars.close[index] = number(row.close);
    bars.volume[index] = number(row.volume);
  });
  bars.returns = logReturns(bars.close);
  return bars;
}

/** The object store refuses connections while the machine is short of ephemeral ports; the next attempt usually gets through. */
async function retried<T>(read: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await read();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt >= 5 || !/Could not connect|IO Error|HTTP/.test(message)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
    }
  }
}

const resilient = new WeakMap<StudyLake, StudyLake>();

/** The same lake, each read retried on a connection error. Stable per lake, so the bar cache keeps working. */
function withRetry(lake: StudyLake): StudyLake {
  let wrapped = resilient.get(lake);
  if (!wrapped) {
    wrapped = {
      query: <T,>(sql: string, timeoutMs?: number) => retried(() => lake.query<T>(sql, timeoutMs)),
      hasView: (name: string) => retried(() => lake.hasView(name)),
      columns: (name: string) => retried(() => lake.columns(name)),
    };
    resilient.set(lake, wrapped);
  }
  return wrapped;
}

function loadBars(lake: StudyLake, source: SeriesSource, timeframe: Timeframe): Promise<Bars> {
  const view = viewFor(source, timeframe);
  let perLake = cache.get(lake);
  if (!perLake) {
    perLake = new Map();
    cache.set(lake, perLake);
  }
  const hit = perLake.get(view);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.bars;
  const bars = readBars(lake, source, timeframe);
  perLake.set(view, { at: Date.now(), bars });
  bars.catch(() => {
    if (perLake.get(view)?.bars === bars) perLake.delete(view);
  });
  while (perLake.size > 4) {
    const oldest = perLake.keys().next().value;
    if (oldest === undefined) break;
    perLake.delete(oldest);
  }
  return bars;
}

function measuredBarsPerDay(bars: Bars): number | null {
  if (bars.count === 0) return null;
  const counts: number[] = [];
  let day = Math.floor((bars.time[0] as number) / DAY_MS);
  let run = 0;
  for (let index = 0; index < bars.count; index += 1) {
    const current = Math.floor((bars.time[index] as number) / DAY_MS);
    if (current !== day) {
      counts.push(run);
      day = current;
      run = 0;
    }
    run += 1;
  }
  counts.push(run);
  return quantileOfSorted(Float64Array.from(counts).sort(), 0.5);
}

function seriesInfo(bars: Bars): SeriesInfo {
  const closes = sortedFiniteValues(bars.close);
  return {
    timeframe: bars.timeframe, source: bars.source, view: bars.view, barCount: bars.count,
    firstTimestamp: bars.count ? (bars.time[0] as number) : null,
    lastTimestamp: bars.count ? (bars.time[bars.count - 1] as number) : null,
    closeMinimum: closes.length ? (closes[0] as number) : null,
    closeMaximum: closes.length ? (closes[closes.length - 1] as number) : null,
    measuredBarsPerDay: measuredBarsPerDay(bars),
    nominalBarsPerDay: Math.round((24 * 60) / TIMEFRAME_MINUTES[bars.timeframe]),
  };
}

async function sourceCount(lake: StudyLake, source: SeriesSource, timeframe: Timeframe): Promise<SourceCount> {
  const view = viewFor(source, timeframe);
  if (!(await lake.hasView(view))) return { source, view, barCount: 0, firstTimestamp: null, lastTimestamp: null };
  const rows = await lake.query<{ n: number; first: number | null; last: number | null }>(
    `SELECT count(*) AS n, epoch_ms(min(timestamp)) AS first, epoch_ms(max(timestamp)) AS last FROM ${ident(view)} WHERE symbol = ${text(SYMBOL)}`,
  );
  const row = rows[0];
  return { source, view, barCount: Number(row?.n ?? 0), firstTimestamp: row?.first ?? null, lastTimestamp: row?.last ?? null };
}

// ── sections ─────────────────────────────────────────────────────────────────

function weekdayBody(bars: Bars, dayBasis: "calendar" | "session"): WeekdayBody {
  const groups: number[][] = [[], [], [], [], [], [], []];
  for (let index = 1; index < bars.count; index += 1) {
    const value = bars.returns[index - 1] as number;
    if (!Number.isFinite(value)) continue;
    const stamp = bars.time[index] as number;
    const dayIndex = dayBasis === "calendar" ? new Date(stamp).getUTCDay() : new Date(`${sessionDay(stamp, "futures")}T00:00:00Z`).getUTCDay();
    (groups[dayIndex] as number[]).push(value);
  }
  const order = [1, 2, 3, 4, 5, 6, 0];
  const rows: WeekdayRow[] = [];
  for (const dayIndex of order) {
    const values = groups[dayIndex] as number[];
    if (values.length === 0) continue;
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    let squares = 0;
    for (const value of values) squares += (value - mean) ** 2;
    const standardDeviation = values.length > 1 ? Math.sqrt(squares / (values.length - 1)) : null;
    rows.push({
      day: DAY_NAMES[dayIndex] as string, dayIndex, count: values.length, mean, standardDeviation,
      meanPercent: mean * 100, standardDeviationPercent: standardDeviation === null ? null : standardDeviation * 100,
    });
  }
  return {
    dayBasis,
    rows,
    kruskalWeekdays: kruskalWallis([1, 2, 3, 4, 5].map((dayIndex) => groups[dayIndex] as number[])),
    kruskalAllDays: kruskalWallis(order.map((dayIndex) => groups[dayIndex] as number[])),
  };
}

function thin<T>(values: ArrayLike<T>, stride: number): T[] {
  const out: T[] = [];
  for (let index = stride - 1; index < values.length; index += stride) out.push(values[index] as T);
  return out;
}

async function summary(bars: Bars, query: Query, context: StudyContext): Promise<SummaryBody> {
  const moments = describeMoments(bars.returns);
  const squared = bars.returns.map((value) => value * value);
  const lagOne = autocorrelation(bars.returns, 1);
  const lagOneSquared = autocorrelation(squared, 1);
  const weekday = weekdayBody(bars, "calendar");
  let adf: number | null = null;
  let kpss: number | null = null;
  if (await context.lake.hasView(STATIONARITY_VIEW)) {
    const rows = await context.lake.query<{ test: string; series: string; p_value: number | null }>(
      `SELECT test, series, p_value FROM ${ident(STATIONARITY_VIEW)} WHERE source = ${text(query.source)} AND timeframe = ${text(query.timeframe)} AND series = 'log_return'`,
    );
    adf = rows.find((row) => row.test === "augmented_dickey_fuller")?.p_value ?? null;
    kpss = rows.find((row) => row.test === "kpss")?.p_value ?? null;
  }
  const provenance = (await context.lake.hasView(PROVENANCE_VIEW))
    ? await context.lake.query<ProvenanceRow>(`SELECT ${PROVENANCE_COLUMNS} FROM ${ident(PROVENANCE_VIEW)} ORDER BY timeframe, source`)
    : [];
  return {
    series: seriesInfo(bars),
    sources: [await sourceCount(context.lake, "full", query.timeframe), await sourceCount(context.lake, "notebook", query.timeframe)],
    provenance,
    returns: moments,
    normality: dAgostinoPearson(bars.returns),
    lagOneAutocorrelation: lagOne[1] ?? null,
    lagOneSquaredAutocorrelation: lagOneSquared[1] ?? null,
    confidenceBand: bars.returns.length > 0 ? 1.96 / Math.sqrt(bars.returns.length) : null,
    dayOfWeekKruskalP: weekday.kruskalWeekdays.pValue,
    upShareHorizonOne: directionLabelCounts(bars.close, 1, 0).upShare,
    adfReturnsP: adf,
    kpssReturnsP: kpss,
  };
}

function bucketKey(stamp: number, bucket: "1h" | "4h" | "1d" | "1w"): number {
  if (bucket === "1h") return Math.floor(stamp / 3_600_000) * 3_600;
  if (bucket === "4h") return Math.floor(stamp / 14_400_000) * 14_400;
  const day = Date.parse(`${sessionDay(stamp, "futures")}T00:00:00Z`);
  if (bucket === "1d") return day / 1000;
  const weekday = new Date(day).getUTCDay();
  return (day - ((weekday + 6) % 7) * DAY_MS) / 1000;
}

function price(bars: Bars, query: Query): PriceBody {
  const barMs = TIMEFRAME_MINUTES[bars.timeframe] * 60_000;
  const bucketMs = { native: 0, "1h": 3_600_000, "4h": 14_400_000, "1d": DAY_MS, "1w": 7 * DAY_MS }[query.priceBucket];
  const bucket = query.priceBucket === "native" || bucketMs <= barMs ? "native" : query.priceBucket;
  const all: CandleColumns = { time: [], open: [], high: [], low: [], close: [], volume: [], sign: [] };
  let previousClose = Number.NaN;
  const push = (time: number, open: number, high: number, low: number, close: number, volume: number) => {
    all.time.push(time);
    all.open.push(open);
    all.high.push(high);
    all.low.push(low);
    all.close.push(close);
    all.volume.push(volume);
    all.sign.push(Number.isFinite(previousClose) ? Math.sign(close - previousClose) : 0);
    previousClose = close;
  };
  if (bucket === "native") {
    for (let index = 0; index < bars.count; index += 1) {
      push((bars.time[index] as number) / 1000, bars.open[index] as number, bars.high[index] as number, bars.low[index] as number, bars.close[index] as number, bars.volume[index] as number);
    }
  } else {
    let key = Number.NaN;
    let open = 0, high = 0, low = 0, close = 0, volume = 0;
    for (let index = 0; index < bars.count; index += 1) {
      const current = bucketKey(bars.time[index] as number, bucket);
      if (current !== key) {
        if (Number.isFinite(key)) push(key, open, high, low, close, volume);
        key = current;
        open = bars.open[index] as number;
        high = bars.high[index] as number;
        low = bars.low[index] as number;
        volume = 0;
      }
      high = Math.max(high, bars.high[index] as number);
      low = Math.min(low, bars.low[index] as number);
      close = bars.close[index] as number;
      volume += bars.volume[index] as number;
    }
    if (Number.isFinite(key)) push(key, open, high, low, close, volume);
  }
  const total = all.time.length;
  const end = Math.min(total - 1, Math.max(0, Math.round(((total - 1) * query.pricePosition) / 1000)));
  const start = Math.max(0, end - query.priceBars + 1);
  const slice = <T,>(values: T[]) => values.slice(start, end + 1);
  return {
    candles: { time: slice(all.time), open: slice(all.open), high: slice(all.high), low: slice(all.low), close: slice(all.close), volume: slice(all.volume), sign: slice(all.sign) },
    bucket,
    bucketCount: total,
    windowStartIndex: start,
    windowEndIndex: end,
  };
}

function returnsBody(bars: Bars, query: Query): ReturnsBody {
  const moments = describeMoments(bars.returns);
  const percent = sortedFiniteValues(bars.returns.map((value) => value * 100));
  const n = percent.length;
  let lower = percent[0] as number;
  let upper = percent[n - 1] as number;
  if (query.histogramRange === "core") {
    lower = quantileOfSorted(percent, 0.005) as number;
    upper = quantileOfSorted(percent, 0.995) as number;
  }
  const inside = percent.filter((value) => value >= lower && value <= upper);
  const { counts } = binCounts(inside, lower, upper, query.histogramBins);
  const width = (upper - lower) / query.histogramBins;
  const histogram: HistogramBinRow[] = counts.map((count, index) => ({
    lower: lower + index * width,
    upper: lower + (index + 1) * width,
    count,
    density: n > 0 && width > 0 ? count / (n * width) : 0,
  }));

  const positions = fillibenPositions(n);
  const theoretical = positions.map((position) => normalQuantile(position));
  const line = leastSquaresLine(theoretical, percent);
  const indices: number[] = [];
  const tail = 40;
  const interior = 400;
  for (let index = 0; index < n; index += 1) {
    if (index < tail || index >= n - tail || index % Math.max(1, Math.floor(n / interior)) === 0) indices.push(index);
  }
  return {
    moments,
    normality: dAgostinoPearson(bars.returns),
    histogram,
    normalFit: { mean: (moments.mean ?? 0) * 100, standardDeviation: (moments.standardDeviation ?? 0) * 100 },
    histogramRange: { lower, upper, clippedCount: n - inside.length },
    qq: {
      theoretical: indices.map((index) => theoretical[index] as number),
      sample: indices.map((index) => percent[index] as number),
      slope: line.slope, intercept: line.intercept, correlation: line.correlation, pointCount: n,
    },
  };
}

async function stationarity(query: Query, context: StudyContext): Promise<StationarityBody | { unavailable: true }> {
  if ((await missingViews(context, [STATIONARITY_VIEW])).length > 0) return { unavailable: true };
  const rows = await context.lake.query<StationarityRow>(
    `SELECT ${STATIONARITY_COLUMNS} FROM ${ident(STATIONARITY_VIEW)} WHERE source = ${text(query.source)} AND timeframe = ${text(query.timeframe)} ORDER BY series DESC, test`,
  );
  if (rows.length === 0) context.notes.push(`No stationarity rows landed for ${query.source} ${query.timeframe}; run packages/ml-engine/src/studies/mnq_eda_30m/build.py.`);
  return { rows };
}

function autocorrelationBody(bars: Bars, query: Query): AutocorrelationBody {
  const squared = bars.returns.map((value) => value * value);
  const acf = autocorrelation(bars.returns, query.lags);
  const pacf = partialAutocorrelation(bars.returns, query.lags);
  const acfSquared = autocorrelation(squared, query.lags);
  const confidenceLevel = query.confidencePercent / 100;
  const band = bars.returns.length > 0 ? twoSidedNormalQuantile(confidenceLevel) / Math.sqrt(bars.returns.length) : 0;
  const beyond = (values: Float64Array) => {
    let count = 0;
    for (let lag = 1; lag < values.length; lag += 1) if (Math.abs(values[lag] as number) > band) count += 1;
    return count;
  };
  let squaredSum = 0;
  for (let lag = 1; lag < acfSquared.length; lag += 1) squaredSum += acfSquared[lag] as number;
  return {
    lags: query.lags, confidenceLevel, band, observationCount: bars.returns.length,
    autocorrelation: Array.from(acf), partialAutocorrelation: Array.from(pacf), squaredAutocorrelation: Array.from(acfSquared),
    significantLags: { autocorrelation: beyond(acf), partialAutocorrelation: beyond(pacf), squaredAutocorrelation: beyond(acfSquared) },
    squaredAutocorrelationSum: squaredSum,
  };
}

function annualisedRolling(returnsFull: Float64Array, windowBars: number, factor: number): Float64Array {
  const std = rollingStandardDeviation(returnsFull, windowBars);
  for (let index = 0; index < std.length; index += 1) std[index] = (std[index] as number) * factor * 100;
  return std;
}

function volatilityBody(bars: Bars, query: Query): VolatilityBody {
  const info = seriesInfo(bars);
  const measured = info.measuredBarsPerDay;
  const perDay = query.barsPerDayBasis === "measured" && measured !== null ? Math.round(measured) : info.nominalBarsPerDay;
  const factor = Math.sqrt(query.annualisationDays * perDay);
  const full = new Float64Array(bars.count);
  full[0] = Number.NaN;
  full.set(bars.returns, 1);
  const shortVol = annualisedRolling(full, Math.max(2, query.shortWindowDays * perDay), factor);
  const longVol = annualisedRolling(full, Math.max(2, query.longWindowDays * perDay), factor);
  const finiteShort = sortedFiniteValues(shortVol);
  const threshold = quantileOfSorted(finiteShort, query.highVolatilityPercentile);
  let high = 0;
  if (threshold !== null) for (let index = 0; index < shortVol.length; index += 1) if ((shortVol[index] as number) > threshold) high += 1;
  const moments = describeMoments(bars.returns);
  const stride = Math.max(1, Math.ceil(bars.count / 1200));
  const nullable = (values: Float64Array) => thin(values, stride).map((value) => (Number.isFinite(value) ? value : null));
  const last = (values: Float64Array) => {
    const value = values[values.length - 1] as number | undefined;
    return value !== undefined && Number.isFinite(value) ? value : null;
  };
  return {
    shortWindowDays: query.shortWindowDays, longWindowDays: query.longWindowDays, barsPerDayUsed: perDay, barsPerDayBasis: query.barsPerDayBasis,
    nominalBarsPerDay: info.nominalBarsPerDay, measuredBarsPerDay: measured, annualisationDays: query.annualisationDays, annualisationFactor: factor,
    overallAnnualisedPercent: moments.standardDeviation === null ? null : moments.standardDeviation * factor * 100,
    highVolatilityPercentile: query.highVolatilityPercentile, highVolatilityThresholdPercent: threshold,
    highVolatilityBarCount: high, barCount: bars.count, shortLastPercent: last(shortVol), longLastPercent: last(longVol),
    stride,
    series: { time: thin(bars.time, stride).map((value) => value / 1000), close: thin(bars.close, stride), short: nullable(shortVol), long: nullable(longVol) },
  };
}

function tensorBody(bars: Bars, query: Query): TensorBody {
  const endIndex = Math.min(bars.count - 1, Math.max(0, Math.round(((bars.count - 1) * query.tensorPosition) / 1000)));
  const { values, clampedCount } = modelInputTensor(bars, endIndex, query.tensorWindow, query.tensorClamp);
  const perChannel = TENSOR_CHANNELS.map((name, channel) => {
    const column = values.map((row) => row[channel] as number);
    const moments = describeMoments(column);
    return {
      name, mean: moments.mean ?? 0, standardDeviation: moments.standardDeviation ?? 0,
      minimum: moments.minimum ?? 0, maximum: moments.maximum ?? 0, clampedCount: clampedCount[channel] as number,
    };
  });
  const flat = values.flat();
  const startIndex = Math.max(0, endIndex + 1 - query.tensorWindow);
  return {
    window: query.tensorWindow, clamp: query.tensorClamp, endIndex,
    endTimestamp: bars.count ? (bars.time[endIndex] as number) : null, startTimestamp: bars.count ? (bars.time[startIndex] as number) : null,
    channels: TENSOR_CHANNELS, values, perChannel,
    minimum: flat.length ? Math.min(...flat) : 0, maximum: flat.length ? Math.max(...flat) : 0,
  };
}

const NOTEBOOK_LABEL_CONFIGS: Array<[number, number]> = [[1, 0], [1, 5], [1, 10], [1, 20.5], [3, 0]];

function labelsBody(bars: Bars, query: Query): LabelsBody {
  const row = (horizon: number, flatThresholdPoints: number, notebook: boolean): LabelConfigRow => ({
    horizon, flatThresholdPoints, notebook, ...directionLabelCounts(bars.close, horizon, flatThresholdPoints),
  });
  const configs = NOTEBOOK_LABEL_CONFIGS.map(([horizon, threshold]) => row(horizon, threshold, true));
  if (!NOTEBOOK_LABEL_CONFIGS.some(([horizon, threshold]) => horizon === query.horizon && threshold === query.flatThresholdPoints)) {
    configs.push(row(query.horizon, query.flatThresholdPoints, false));
  }

  const changes: number[] = [];
  for (let index = 0; index + query.horizon < bars.count; index += 1) {
    changes.push(Math.fround((bars.close[index + query.horizon] as number) - (bars.close[index] as number)));
  }
  const absolute = sortedFiniteValues(changes.map((change) => Math.abs(change)));
  const valid = changes.filter((change) => Number.isFinite(change) && !(query.flatThresholdPoints > 0 && Math.abs(change) < query.flatThresholdPoints));
  const binCount = 40;
  const keptSorted = sortedFiniteValues(valid);
  const lower = quantileOfSorted(keptSorted, 0.005) ?? 0;
  const upper = quantileOfSorted(keptSorted, 0.995) ?? 0;
  const width = (upper - lower) / binCount;
  const up = new Array<number>(binCount).fill(0);
  const down = new Array<number>(binCount).fill(0);
  let outsideCount = 0;
  for (const change of valid) {
    if (change < lower || change > upper) {
      outsideCount += 1;
      continue;
    }
    const slot = width > 0 ? Math.min(binCount - 1, Math.max(0, Math.floor((change - lower) / width))) : 0;
    if (change > 0) up[slot] = (up[slot] as number) + 1;
    else down[slot] = (down[slot] as number) + 1;
  }
  return {
    horizon: query.horizon, flatThresholdPoints: query.flatThresholdPoints, configs,
    deltaHistogram: { lower, upper, up, down, outsideCount },
    absoluteDelta: {
      percentile25: quantileOfSorted(absolute, 0.25), median: quantileOfSorted(absolute, 0.5), percentile75: quantileOfSorted(absolute, 0.75),
      percentile90: quantileOfSorted(absolute, 0.9),
      flatShareAtThreshold: absolute.length > 0 ? countBelow(absolute, query.flatThresholdPoints) / absolute.length : null,
    },
  };
}

function foldsBody(bars: Bars, query: Query): FoldsBody {
  const indices = walkForwardFolds(bars.time, query.foldMonths, query.purgeBars, query.minTrainMonths);
  const at = (index: number) => (bars.time[Math.max(0, Math.min(bars.count - 1, index))] as number);
  const folds = indices.map((fold, position) => {
    const next = indices[position + 1];
    return {
      fold: fold.fold,
      trainStartIndex: fold.trainStart, trainEndIndex: fold.trainEnd, testStartIndex: fold.testStart, testEndIndex: fold.testEnd,
      trainStart: at(fold.trainStart), trainEnd: at(fold.trainEnd - 1), testStart: at(fold.testStart), testEnd: at(fold.testEnd - 1),
      trainCount: fold.trainEnd - fold.trainStart, testCount: fold.testEnd - fold.testStart,
      purgedBars: fold.testStart - fold.trainEnd,
      overlapWithNext: next ? Math.max(0, fold.testEnd - next.testStart) : 0,
    };
  });
  return {
    foldMonths: query.foldMonths, purgeBars: query.purgeBars, minTrainMonths: query.minTrainMonths,
    barCount: bars.count, firstTimestamp: bars.count ? (bars.time[0] as number) : null, lastTimestamp: bars.count ? (bars.time[bars.count - 1] as number) : null,
    folds,
  };
}

function profile(name: string, group: string, unit: string, values: ArrayLike<number>): ColumnProfile {
  const sorted = sortedFiniteValues(values);
  const lower = quantileOfSorted(sorted, 0.005) ?? 0;
  const upper = quantileOfSorted(sorted, 0.995) ?? 0;
  const { counts } = binCounts(sorted, lower, upper > lower ? upper : lower + 1, 240);
  return { name, group, unit, moments: describeMoments(sorted), histogram: { lower, upper: upper > lower ? upper : lower + 1, counts } };
}

function columnsBody(bars: Bars): ColumnsBody {
  const info = seriesInfo(bars);
  const perDay = info.nominalBarsPerDay;
  const factor = Math.sqrt(252 * perDay);
  const full = new Float64Array(bars.count);
  full[0] = Number.NaN;
  full.set(bars.returns, 1);
  const channels = modelInputChannels(bars, 5);
  const changes = new Float64Array(bars.count).fill(Number.NaN);
  for (let index = 0; index + 1 < bars.count; index += 1) changes[index] = Math.fround((bars.close[index + 1] as number) - (bars.close[index] as number));
  return {
    columns: [
      profile("open", "bar frame", "points", bars.open),
      profile("high", "bar frame", "points", bars.high),
      profile("low", "bar frame", "points", bars.low),
      profile("close", "bar frame", "points", bars.close),
      profile("volume", "bar frame", "contracts", bars.volume),
      profile("log_return", "bar frame", "natural log", bars.returns),
      ...TENSOR_CHANNELS.map((name, channel) => profile(name, "model input, every bar", "log change, clamped to ±5", channels[channel] as Float64Array)),
      profile("rolling_volatility_short_percent", "rolling volatility (5 days)", "annualised percent", annualisedRolling(full, 5 * perDay, factor)),
      profile("rolling_volatility_long_percent", "rolling volatility (21 days)", "annualised percent", annualisedRolling(full, 21 * perDay, factor)),
      profile("next_bar_close_change_points", "direction label input", "points", changes),
    ],
  };
}

// ── the handler ──────────────────────────────────────────────────────────────

type Unavailable = { unavailable: true };

const handler: StudyHandler<typeof querySchema, unknown> = {
  slug: "mnq-eda-30m",
  datasets: [...ALL_VIEWS, STATIONARITY_VIEW, PROVENANCE_VIEW],
  query: querySchema,
  cacheSeconds: 600,
  timeoutMs: 180_000,
  async run(query, rawContext): Promise<unknown> {
    const context: StudyContext = { lake: withRetry(rawContext.lake), notes: rawContext.notes };
    const { section } = query;
    if (section === "stationarity") return stationarity(query, context);

    const view = viewFor(query.source, query.timeframe);
    if ((await missingViews(context, [view])).length > 0) return { unavailable: true } satisfies Unavailable;
    const bars = await loadBars(context.lake, query.source, query.timeframe);
    if (bars.count < 100) {
      context.notes.push(`${view} holds ${bars.count} MNQ bars, too few to analyse.`);
      return { unavailable: true } satisfies Unavailable;
    }
    switch (section) {
      case "summary": return summary(bars, query, context);
      case "price": return price(bars, query);
      case "returns": return returnsBody(bars, query);
      case "autocorrelation": return autocorrelationBody(bars, query);
      case "volatility": return volatilityBody(bars, query);
      case "weekday": return weekdayBody(bars, query.dayBasis);
      case "tensor": return tensorBody(bars, query);
      case "labels": return labelsBody(bars, query);
      case "folds": return foldsBody(bars, query);
      case "columns": return columnsBody(bars);
      default: return { unavailable: true } satisfies Unavailable;
    }
  },
};

export default handler;
