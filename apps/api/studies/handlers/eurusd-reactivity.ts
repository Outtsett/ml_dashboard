/**
 * EURUSD, what reactivity costs: a daily causal z-score of log range is the
 * brushable overview; the brushed span drives a detail candle chart (the
 * timeframe chosen so about 200 candles fit), the one-minute log-return
 * distribution of the brush against the rest of history, and every column of
 * the one-minute frame. Replaced Trading/forexmodel/notebooks/eurusd_viz.py.
 *
 * Reads `bars` (the Iceberg system of record) for forex, timeframe 1m. Days
 * are UTC days: the lake stores forex in true UTC. Four parts, one per request
 * (`?part=`): overview, brush, columns, page. Each records the milliseconds its
 * SQL took, which the page shows in place of the notebook's timing table.
 *
 * Statistic definitions follow the notebook's forexmodel.stats.describe: the
 * standard deviation uses n - 1, skewness is the mean of the cubed z-scores
 * and kurtosis the mean of the fourth powers minus 3 (excess), z-scores
 * taking that n - 1 deviation; percentiles interpolate linearly.
 */

import { performance } from "node:perf_hooks";
import { z } from "zod";
import { ident, num, text } from "../sql";
import { missingViews } from "../views";
import type { StudyContext, StudyHandler } from "../types";
import {
  DAY_MILLISECONDS, DEFAULT_PAIR, DEFAULT_TARGET_BARS, FOREX_PAIRS, chooseTimeframe,
  type BrushBody, type ColumnHistogramBin, type ColumnProfile, type ColumnsBody, type DailyRow, type DensityBin,
  type DetailCandle, type DetailTimeframe, type DistributionSummary, type EurusdReactivityBody, type MinuteRow,
  type OverviewBody, type PageBody, type StageTiming,
} from "@shared/studies/eurusd-reactivity";

const VIEW = "bars";
const RAW_SAMPLE_ROWS = 1_000;
const MAXIMUM_PAGE_SIZE = 200;

/** SQL interval literal for each detail timeframe (a fixed map: no browser text reaches SQL). */
const INTERVAL_SQL: Record<DetailTimeframe, string> = {
  "1m": "1 minute", "5m": "5 minutes", "15m": "15 minutes", "30m": "30 minutes", "1h": "1 hour", "4h": "4 hours", "1d": "1 day",
};

const COLUMN_LABELS: Array<{ column: string; label: string; unit: string }> = [
  { column: "open", label: "open price (absolute)", unit: "price" },
  { column: "high", label: "high price (absolute)", unit: "price" },
  { column: "low", label: "low price (absolute)", unit: "price" },
  { column: "close", label: "close price (absolute)", unit: "price" },
  { column: "volume", label: "volume", unit: "ticks per minute" },
  { column: "log_return_basis_points", label: "one-minute log return", unit: "basis points" },
];

const querySchema = z
  .object({
    part: z.enum(["overview", "brush", "columns", "page"]).default("overview"),
    pair: z.enum(FOREX_PAIRS).default(DEFAULT_PAIR),
    from: z.coerce.number().int().optional(),
    to: z.coerce.number().int().optional(),
    target: z.coerce.number().int().min(20).max(1000).default(DEFAULT_TARGET_BARS),
    bins: z.coerce.number().int().min(10).max(100).default(40),
    page: z.coerce.number().int().min(0).max(10_000_000).default(0),
    pageSize: z.coerce.number().int().min(1).max(MAXIMUM_PAGE_SIZE).default(8),
    startAt: z.coerce.number().int().optional(),
  })
  .superRefine((query, context) => {
    if (query.part !== "brush") return;
    if (query.from === undefined || query.to === undefined) {
      context.addIssue({ code: "custom", path: ["from"], message: "the brush part needs from and to (epoch milliseconds of the first and last day)" });
    } else if (query.to < query.from) {
      context.addIssue({ code: "custom", path: ["to"], message: "to is before from" });
    }
  });

type Query = z.infer<typeof querySchema>;

/** One-minute bars for a pair as a naive UTC timestamp `t` (the lake stores true UTC; `AT TIME ZONE 'UTC'` makes the day boundary independent of the session zone). */
function minuteSource(pair: string): string {
  return (
    "SELECT CAST(ts AT TIME ZONE 'UTC' AS TIMESTAMP) AS t, open, high, low, close, volume FROM bars " +
    `WHERE asset_class = 'forex' AND timeframe = '1m' AND root = ${text(pair)}`
  );
}

function ms(start: number): number {
  return performance.now() - start;
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toCount(value: unknown): number {
  return toNumber(value) ?? 0;
}

/** Bytes of one JSON-encoded row per megabyte of the whole frame: the notebook's "un-aggregated payload" estimate. */
function megabytes(rows: readonly object[], total: number): number {
  if (rows.length === 0) return 0;
  return (JSON.stringify(rows).length / rows.length) * total / 1e6;
}

// ---------------------------------------------------------------------------
// overview

async function overview(query: Query, context: StudyContext): Promise<OverviewBody> {
  const timings: StageTiming[] = [];
  const empty: OverviewBody = {
    part: "overview", pair: query.pair, rows: [], minuteCount: 0, firstMinute: null, lastMinute: null,
    dayBoundary: "UTC midnight", overviewKilobytes: 0, rawMegabytesEstimate: 0, timings, computedAt: Date.now(),
  };
  if ((await missingViews(context, [VIEW])).length > 0) return empty;

  const started = performance.now();
  const daysQuery = context.lake
    .query<Record<string, unknown>>(
      `WITH minute AS (${minuteSource(query.pair)}),
     day AS (
       SELECT date_trunc('day', t) AS day, count(*) AS minute_count, min(t) AS first_minute, max(t) AS last_minute,
              arg_min(open, t) AS open, max(high) AS high, min(low) AS low, arg_max(close, t) AS close
       FROM minute GROUP BY 1
     ),
     totals AS (
       SELECT *, sum(minute_count) OVER () AS total_minutes, min(first_minute) OVER () AS first_minute_overall,
              max(last_minute) OVER () AS last_minute_overall
       FROM day
     ),
     ranged AS (SELECT * FROM totals WHERE high > low)
     SELECT epoch_ms(day) AS date, open, high, low, close, minute_count, ln(high - low) AS log_range,
            (ln(close) - lag(ln(close)) OVER (ORDER BY day)) * 1e4 AS log_return_basis_points,
            total_minutes, epoch_ms(first_minute_overall) AS first_minute, epoch_ms(last_minute_overall) AS last_minute
     FROM ranged ORDER BY day`,
    )
    .then((result) => ({ result, milliseconds: ms(started) }));
  const sampleQuery = context.lake
    .query<MinuteRow>(`SELECT epoch_ms(t) AS timestamp, open, high, low, close, volume FROM (${minuteSource(query.pair)}) LIMIT ${num(RAW_SAMPLE_ROWS)}`)
    .then((result) => ({ result, milliseconds: ms(started) }));
  const [{ result: days, milliseconds: dailyMilliseconds }, { result: sample, milliseconds: sampleMilliseconds }] = await Promise.all([daysQuery, sampleQuery]);
  const rows: DailyRow[] = days.map((row) => ({
    date: toCount(row.date),
    open: toCount(row.open),
    high: toCount(row.high),
    low: toCount(row.low),
    close: toCount(row.close),
    minute_count: toCount(row.minute_count),
    log_range: toCount(row.log_range),
    log_return_basis_points: toNumber(row.log_return_basis_points),
  }));
  const minuteCount = toCount(days[0]?.total_minutes);
  timings.push({
    stage: "aggregate one-minute bars to UTC days",
    milliseconds: dailyMilliseconds,
    rows: rows.length,
    detail: `${minuteCount.toLocaleString("en-US")} one-minute bars to ${rows.length.toLocaleString("en-US")} days with a range (days with high equal to low dropped)`,
  });
  timings.push({
    stage: "sample rows to size the un-aggregated frame",
    milliseconds: sampleMilliseconds,
    rows: sample.length,
    detail: "run alongside the daily aggregate; bytes per JSON-encoded row, multiplied by every row",
  });

  return {
    ...empty,
    rows,
    minuteCount,
    firstMinute: toNumber(days[0]?.first_minute),
    lastMinute: toNumber(days[0]?.last_minute),
    overviewKilobytes: JSON.stringify(rows.map((row) => ({ date: row.date, log_range: row.log_range }))).length / 1024,
    rawMegabytesEstimate: megabytes(sample, minuteCount),
    timings,
    computedAt: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// brush

const QUANTILES_SQL =
  "quantile_cont(r, 0.01) AS percentile_1, quantile_cont(r, 0.05) AS percentile_5, quantile_cont(r, 0.25) AS percentile_25, " +
  "quantile_cont(r, 0.5) AS median, quantile_cont(r, 0.75) AS percentile_75, quantile_cont(r, 0.95) AS percentile_95, " +
  "quantile_cont(r, 0.99) AS percentile_99, quantile_cont(r, 0.005) AS range_low, quantile_cont(r, 0.995) AS range_high";

function summaryFrom(row: Record<string, unknown>, group: string): DistributionSummary {
  return {
    group,
    count: toCount(row.n),
    mean: toNumber(row.mean),
    median: toNumber(row.median),
    standard_deviation: toNumber(row.standard_deviation),
    skewness: toNumber(row.skewness),
    excess_kurtosis: toNumber(row.excess_kurtosis),
    percentile_1: toNumber(row.percentile_1),
    percentile_5: toNumber(row.percentile_5),
    percentile_25: toNumber(row.percentile_25),
    percentile_75: toNumber(row.percentile_75),
    percentile_95: toNumber(row.percentile_95),
    percentile_99: toNumber(row.percentile_99),
    minimum: toNumber(row.minimum),
    maximum: toNumber(row.maximum),
  };
}

/** The returns CTE: each one-minute bar's log return in basis points, tagged brushed or not. */
function returnsCte(pair: string, from: number, sliceEnd: number): string {
  return (
    `WITH minute AS (SELECT ts, close FROM bars WHERE asset_class = 'forex' AND timeframe = '1m' AND root = ${text(pair)}),
     step AS (SELECT CAST(ts AT TIME ZONE 'UTC' AS TIMESTAMP) AS t, (ln(close) - ln(lag(close) OVER (ORDER BY ts))) * 1e4 AS r FROM minute),
     returns AS (
       SELECT r, CASE WHEN t >= epoch_ms(${num(from)}) AND t < epoch_ms(${num(sliceEnd)}) THEN 'brushed' ELSE 'rest of history' END AS grp
       FROM step WHERE r IS NOT NULL AND isfinite(r)
     )`
  );
}

async function brush(query: Query, context: StudyContext): Promise<BrushBody> {
  const from = query.from as number;
  const to = query.to as number;
  const sliceEnd = to + DAY_MILLISECONDS;
  const spanMinutes = Math.max(Math.floor((sliceEnd - from) / 60_000), 1);
  const timeframe = chooseTimeframe(spanMinutes, query.target);
  const timings: StageTiming[] = [];
  const empty: BrushBody = {
    part: "brush", pair: query.pair, from, to, sliceEnd, spanMinutes, targetBars: query.target, timeframe, minuteBarCount: 0,
    candles: [], summaries: [], densityRange: null, density: [], timings, computedAt: Date.now(),
  };
  if ((await missingViews(context, [VIEW])).length > 0) return empty;

  let started = performance.now();
  const bucketed = await context.lake.query<Record<string, unknown>>(
    `SELECT epoch_ms(time_bucket(INTERVAL '${INTERVAL_SQL[timeframe]}', t)) AS time, arg_min(open, t) AS open, max(high) AS high,
            min(low) AS low, arg_max(close, t) AS close, sum(volume) AS volume, count(*) AS minute_count
     FROM (${minuteSource(query.pair)})
     WHERE t >= epoch_ms(${num(from)}) AND t < epoch_ms(${num(sliceEnd)})
     GROUP BY 1 ORDER BY 1`,
  );
  const candles: DetailCandle[] = bucketed.map((row, index) => {
    const close = toCount(row.close);
    const previous = index > 0 ? toCount(bucketed[index - 1]?.close) : null;
    return {
      time: toCount(row.time),
      open: toCount(row.open),
      high: toCount(row.high),
      low: toCount(row.low),
      close,
      volume: toCount(row.volume),
      minute_count: toCount(row.minute_count),
      log_return_basis_points: previous !== null && previous > 0 && close > 0 ? (Math.log(close) - Math.log(previous)) * 1e4 : null,
    };
  });
  const minuteBarCount = candles.reduce((total, candle) => total + candle.minute_count, 0);
  timings.push({
    stage: "brush to filter and resample",
    milliseconds: ms(started),
    rows: candles.length,
    detail: `${spanMinutes.toLocaleString("en-US")} minute span, ${minuteBarCount.toLocaleString("en-US")} one-minute bars, ${candles.length.toLocaleString("en-US")} ${timeframe} candles`,
  });

  started = performance.now();
  const statistics = await context.lake.query<Record<string, unknown>>(
    `${returnsCte(query.pair, from, sliceEnd)},
     g AS (
       SELECT grp, count(*) AS n, avg(r) AS mean, stddev_samp(r) AS standard_deviation, min(r) AS minimum, max(r) AS maximum, ${QUANTILES_SQL}
       FROM returns GROUP BY grp
     ),
     m AS (
       SELECT returns.grp, avg(pow((returns.r - g.mean) / g.standard_deviation, 3)) AS skewness,
              avg(pow((returns.r - g.mean) / g.standard_deviation, 4)) - 3 AS excess_kurtosis
       FROM returns JOIN g USING (grp) WHERE g.standard_deviation > 0 GROUP BY returns.grp
     )
     SELECT g.*, m.skewness, m.excess_kurtosis FROM g LEFT JOIN m USING (grp) ORDER BY grp`,
  );
  const summaries = statistics.map((row) => summaryFrom(row, String(row.grp)));
  timings.push({
    stage: "nine-statistic describe, both groups",
    milliseconds: ms(started),
    rows: summaries.reduce((total, summary) => total + summary.count, 0),
    detail: "over every one-minute bar in the history, brushed and rest: the percentiles sort the whole history",
  });

  let densityRange: [number, number] | null = null;
  let density: DensityBin[] = [];
  const lows = statistics.map((row) => toNumber(row.range_low)).filter((value): value is number => value !== null);
  const highs = statistics.map((row) => toNumber(row.range_high)).filter((value): value is number => value !== null);
  if (lows.length > 0 && highs.length > 0 && Math.max(...highs) > Math.min(...lows)) {
    const low = Math.min(...lows);
    const high = Math.max(...highs);
    densityRange = [low, high];
    started = performance.now();
    const counts = await context.lake.query<Record<string, unknown>>(
      `${returnsCte(query.pair, from, sliceEnd)}
       SELECT grp, bucket, count(*) AS n FROM (
         SELECT grp, CASE WHEN r < ${num(low)} THEN -1 WHEN r >= ${num(high)} THEN ${num(query.bins)}
                          ELSE CAST(floor((r - ${num(low)}) / ${num((high - low) / query.bins)}) AS INTEGER) END AS bucket
         FROM returns
       ) GROUP BY grp, bucket`,
    );
    density = densityBins(counts, summaries, low, high, query.bins);
    timings.push({
      stage: "density of brushed against rest",
      milliseconds: ms(started),
      rows: counts.length,
      detail: `${query.bins} bins between the 0.5th and 99.5th percentile; the tails are outside the plot`,
    });
  }

  return { ...empty, minuteBarCount, candles, summaries, densityRange, density, timings, computedAt: Date.now() };
}

/** Histogram counts to densities (area 1 over the plotted range) for the two groups. */
function densityBins(counts: Array<Record<string, unknown>>, summaries: DistributionSummary[], low: number, high: number, bins: number): DensityBin[] {
  const width = (high - low) / bins;
  const brushed = new Array<number>(bins).fill(0);
  const rest = new Array<number>(bins).fill(0);
  for (const row of counts) {
    const bucket = toCount(row.bucket);
    if (bucket < 0 || bucket >= bins) continue;
    (String(row.grp) === "brushed" ? brushed : rest)[bucket] = toCount(row.n);
  }
  const brushedTotal = summaries.find((summary) => summary.group === "brushed")?.count ?? 0;
  const restTotal = summaries.find((summary) => summary.group === "rest of history")?.count ?? 0;
  return brushed.map((brushedCount, index) => ({
    lower: low + index * width,
    upper: low + (index + 1) * width,
    brushed_count: brushedCount,
    rest_count: rest[index] as number,
    brushed_density: brushedTotal > 0 ? brushedCount / brushedTotal / width : 0,
    rest_density: restTotal > 0 ? (rest[index] as number) / restTotal / width : 0,
  }));
}

// ---------------------------------------------------------------------------
// columns

/** The unpivoted one-minute frame, finite values only, with each column's statistics. */
function columnsCte(pair: string): string {
  const names = COLUMN_LABELS.map((entry) => ident(entry.column)).join(", ");
  return (
    `WITH minute AS (
       SELECT open, high, low, close, volume, (ln(close) - ln(lag(close) OVER (ORDER BY ts))) * 1e4 AS log_return_basis_points
       FROM bars WHERE asset_class = 'forex' AND timeframe = '1m' AND root = ${text(pair)}
     ),
     long AS (SELECT * FROM (UNPIVOT minute ON ${names} INTO NAME column_name VALUE r) WHERE r IS NOT NULL AND isfinite(r)),
     g AS (
       SELECT column_name, count(*) AS n, avg(r) AS mean, stddev_samp(r) AS standard_deviation, min(r) AS minimum, max(r) AS maximum, ${QUANTILES_SQL}
       FROM long GROUP BY column_name
     )`
  );
}

async function columns(query: Query, context: StudyContext): Promise<ColumnsBody> {
  const timings: StageTiming[] = [];
  const empty: ColumnsBody = { part: "columns", pair: query.pair, bins: query.bins, minuteCount: 0, columns: [], timings, computedAt: Date.now() };
  if ((await missingViews(context, [VIEW])).length > 0) return empty;

  let started = performance.now();
  const statistics = await context.lake.query<Record<string, unknown>>(
    `${columnsCte(query.pair)},
     m AS (
       SELECT long.column_name, avg(pow((long.r - g.mean) / g.standard_deviation, 3)) AS skewness,
              avg(pow((long.r - g.mean) / g.standard_deviation, 4)) - 3 AS excess_kurtosis
       FROM long JOIN g USING (column_name) WHERE g.standard_deviation > 0 GROUP BY long.column_name
     )
     SELECT g.*, m.skewness, m.excess_kurtosis FROM g LEFT JOIN m USING (column_name)`,
    240_000,
  );
  timings.push({
    stage: "statistics of every column",
    milliseconds: ms(started),
    rows: statistics.reduce((total, row) => total + toCount(row.n), 0),
    detail: "six columns of the one-minute frame, each over every bar",
  });

  started = performance.now();
  const ranges = new Map<string, { low: number; high: number }>();
  for (const row of statistics) {
    const low = toNumber(row.range_low);
    const high = toNumber(row.range_high);
    if (low !== null && high !== null && high > low) ranges.set(String(row.column_name), { low, high });
  }
  const rangeSql = [...ranges.entries()]
    .map(([column, range]) => `SELECT ${text(column)} AS column_name, ${num(range.low)} AS low, ${num(range.high)} AS high`)
    .join(" UNION ALL ");
  const counts = ranges.size === 0
    ? []
    : await context.lake.query<Record<string, unknown>>(
        `${columnsCte(query.pair)},
         r AS (${rangeSql})
         SELECT column_name, bucket, count(*) AS n FROM (
           SELECT long.column_name, CASE WHEN long.r < r.low THEN -1 WHEN long.r >= r.high THEN ${num(query.bins)}
                                         ELSE CAST(floor((long.r - r.low) / ((r.high - r.low) / ${num(query.bins)})) AS INTEGER) END AS bucket
           FROM long JOIN r USING (column_name)
         ) GROUP BY column_name, bucket`,
        240_000,
      );
  timings.push({
    stage: "histogram of every column",
    milliseconds: ms(started),
    rows: counts.length,
    detail: `${query.bins} bins between each column's 0.5th and 99.5th percentile; the tails are counted beside it`,
  });

  const profiles: ColumnProfile[] = [];
  for (const entry of COLUMN_LABELS) {
    const row = statistics.find((candidate) => String(candidate.column_name) === entry.column);
    const range = ranges.get(entry.column);
    if (!row || !range) continue;
    const width = (range.high - range.low) / query.bins;
    const histogram: ColumnHistogramBin[] = Array.from({ length: query.bins }, (_unused, index) => ({
      lower: range.low + index * width, upper: range.low + (index + 1) * width, count: 0,
    }));
    let below = 0;
    let above = 0;
    for (const count of counts) {
      if (String(count.column_name) !== entry.column) continue;
      const bucket = toCount(count.bucket);
      if (bucket < 0) below = toCount(count.n);
      else if (bucket >= query.bins) above = toCount(count.n);
      else (histogram[bucket] as ColumnHistogramBin).count = toCount(count.n);
    }
    const { group: _group, ...summary } = summaryFrom(row, entry.column);
    profiles.push({
      column: entry.column, label: entry.label, unit: entry.unit, summary,
      rangeLow: range.low, rangeHigh: range.high, belowRange: below, aboveRange: above, histogram,
    });
  }
  return { ...empty, minuteCount: toCount(statistics.find((row) => String(row.column_name) === "open")?.n), columns: profiles, timings, computedAt: Date.now() };
}

// ---------------------------------------------------------------------------
// page

async function page(query: Query, context: StudyContext): Promise<PageBody> {
  const timings: StageTiming[] = [];
  const empty: PageBody = {
    part: "page", pair: query.pair, page: 0, pageSize: query.pageSize, pageCount: 0, totalRows: 0, rows: [], timings, computedAt: Date.now(),
  };
  if ((await missingViews(context, [VIEW])).length > 0) return empty;

  const started = performance.now();
  const counted = await context.lake.query<Record<string, unknown>>(
    `SELECT count(*) AS total_rows, count(*) FILTER (WHERE t < epoch_ms(${num(query.startAt ?? 0)})) AS before_start FROM (${minuteSource(query.pair)})`,
  );
  const totalRows = toCount(counted[0]?.total_rows);
  const pageCount = Math.max(1, Math.ceil(totalRows / query.pageSize));
  const requested = query.startAt === undefined ? query.page : Math.floor(toCount(counted[0]?.before_start) / query.pageSize);
  const pageIndex = Math.min(requested, pageCount - 1);
  const rows = await context.lake.query<MinuteRow>(
    `SELECT epoch_ms(t) AS timestamp, open, high, low, close, volume FROM (${minuteSource(query.pair)})
     ORDER BY t LIMIT ${num(query.pageSize)} OFFSET ${num(pageIndex * query.pageSize)}`,
  );
  timings.push({
    stage: "one page of the one-minute frame",
    milliseconds: ms(started),
    rows: rows.length,
    detail: `page ${pageIndex + 1} of ${pageCount.toLocaleString("en-US")}; only this page is sent to the browser`,
  });
  return { ...empty, page: pageIndex, pageCount, totalRows, rows, timings, computedAt: Date.now() };
}

// ---------------------------------------------------------------------------

const handler: StudyHandler<typeof querySchema, EurusdReactivityBody> = {
  slug: "eurusd-reactivity",
  datasets: [VIEW],
  query: querySchema,
  cacheSeconds: 300,
  timeoutMs: 300_000,
  async run(query, context) {
    switch (query.part) {
      case "brush":
        return brush(query, context);
      case "columns":
        return columns(query, context);
      case "page":
        return page(query, context);
      default:
        return overview(query, context);
    }
  },
};

export default handler;
