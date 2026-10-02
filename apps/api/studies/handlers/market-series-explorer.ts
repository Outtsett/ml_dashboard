/**
 * Market series explorer: one futures root or forex pair at 1 hour, resampled
 * from the lake's 1-minute bars, one contract per bar, ratio roll-adjusted
 * (futures), with scale-free features and causal z-scores. Replaced
 * datalake/notebooks/lake_explorer.py, whose workspace database
 * (E:\lake\_meta\workspace.duckdb) no longer exists.
 *
 * Everything is read from the Iceberg `bars` view and computed here, in the
 * notebook's own steps (datalake src/lake/sql/analytics.sql):
 *   chain   the active contract of each day from the DAILY series (largest
 *           volume, ties to the larger symbol) and the reverse-cumulative
 *           ratio adjustment each day carries;
 *   fmadj   the minute bars of that day's contract only, prices times the
 *           adjustment (a forex pair has no daily bars and passes through
 *           unadjusted);
 *   resample to 1 hour: open of the first bar, high, low, close of the last,
 *           summed volume, the roll flag if any minute carried it;
 *   features  computed from feat_candle's maths, not feat_rel's (feat_rel's
 *           macro refers to a window it never defines).
 * The series (about 30,000 bars) is materialised once per instrument and kept
 * in this process for ten minutes, which is what made the notebook's brushing
 * instant; a span then only slices it. Columns carry full-word names (the
 * notebook's o, h, l, c, ret_z became open, high, low, close, return_zscore).
 *
 * Futures timestamps in the lake are Pacific wall clock stored as UTC, so the
 * "session" hours the page shades are hours of that stored clock.
 */

import { z } from "zod";
import { text } from "../sql";
import { missingViews } from "../views";
import type { StudyContext, StudyHandler, StudyLake } from "../types";
import {
  ASSET_CLASSES, BASE_TIMEFRAME, DEFAULT_TARGET_BARS, EMPTY_BODY, SERIES_COLUMN_NAMES, VIEW_TIMEFRAME, ZSCORE_WINDOW,
  buildOverview, causalZscore, compareHistograms, distributionSummary, logReturnStandardDeviation, positionsInSpan,
  resolveSpan, rollStartPositions, spanInstants, thinPositions, trailingWindow,
  type AssetClass, type ColumnStatistics, type ExplorerBody, type InstrumentOption, type RollEvent, type SeriesSummary,
  type WindowRow, type ZscoreExample,
} from "@shared/studies/market-series-explorer";

const VIEW = "bars";
const MEMORY_MILLISECONDS = 10 * 60_000;
const MEMORY_ENTRIES = 6;
const QUERY_TIMEOUT_MILLISECONDS = 100_000;
const DEFAULT_INSTRUMENT = "futures:MNQ";

export const querySchema = z.object({
  instrument: z.string().regex(/^(futures|forex):[A-Z0-9]{1,12}$/).default(DEFAULT_INSTRUMENT),
  /** Indices into the daily strip; -1 (either) means the last 90 days. */
  spanStart: z.coerce.number().int().min(-1).max(100_000).default(-1),
  spanEnd: z.coerce.number().int().min(-1).max(100_000).default(-1),
  targetBars: z.coerce.number().int().min(20).max(1000).default(DEFAULT_TARGET_BARS),
  statisticsColumn: z.enum(SERIES_COLUMN_NAMES as [string, ...string[]]).default("log_return"),
  bins: z.coerce.number().int().min(5).max(80).default(40),
  convention: z.enum(["notebook", "sample"]).default("notebook"),
});
export type MarketSeriesExplorerQuery = z.infer<typeof querySchema>;

// ---------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------

export function universeSql(): string {
  return `SELECT asset_class, root, count(*) AS minute_bar_count, count(DISTINCT symbol) AS symbol_count,
       epoch_ms(min(ts)) AS first_timestamp, epoch_ms(max(ts)) AS last_timestamp
FROM ${VIEW}
WHERE asset_class IN (${ASSET_CLASSES.map(text).join(", ")}) AND timeframe = ${text(BASE_TIMEFRAME)}
GROUP BY asset_class, root
ORDER BY asset_class, root`;
}

export function interleaveSql(assetClass: AssetClass, root: string): string {
  return `SELECT count(*)::DOUBLE / nullif(count(DISTINCT ts), 0) AS ratio
FROM ${VIEW} WHERE asset_class = ${text(assetClass)} AND root = ${text(root)} AND timeframe = ${text(BASE_TIMEFRAME)}`;
}

/** Forex pip size: the vendor's metadata gives 0.01 for every JPY cross and 0.0001 for the rest (all 18 pairs checked). */
function pipSize(root: string): string {
  return root.endsWith("JPY") ? "0.01" : "0.0001";
}

/** The whole series: contract chain, adjusted minutes, hourly bars, features. */
export function seriesSql(assetClass: AssetClass, root: string): string {
  const A = text(assetClass);
  const R = text(root);
  const forex = assetClass === "forex";
  const spreadJoin = forex
    ? `LEFT JOIN (
    SELECT time_bucket(INTERVAL 1 HOUR, ts) AS ts, median((ask_close - bid_close) / ${pipSize(root)}) AS median_spread_pips
    FROM ${VIEW} WHERE asset_class = 'forex' AND root = ${R} AND timeframe = ${text(BASE_TIMEFRAME)} AND bid_close IS NOT NULL
    GROUP BY 1) spread USING (ts)`
    : "";
  const spreadColumn = forex ? ", spread.median_spread_pips" : "";
  return `
WITH daily AS (
  SELECT ts, r.symbol AS symbol, r.c AS c FROM (
    SELECT ts, arg_max({'symbol': symbol, 'c': close}, (volume, symbol)) AS r
    FROM ${VIEW} WHERE asset_class = ${A} AND root = ${R} AND timeframe = '1d' AND symbol <> root GROUP BY ts)),
previous AS (SELECT *, lag(symbol) OVER (ORDER BY ts) AS previous_symbol FROM daily),
jumps AS (
  SELECT previous.ts, previous.symbol,
         CASE WHEN previous.previous_symbol IS NOT NULL AND previous.symbol <> previous.previous_symbol AND old.close > 0
              THEN ln(previous.c / old.close) ELSE 0.0 END AS roll_ln
  FROM previous LEFT JOIN ${VIEW} old
    ON old.asset_class = ${A} AND old.root = ${R} AND old.timeframe = '1d' AND old.ts = previous.ts AND old.symbol = previous.previous_symbol),
cumulative AS (
  SELECT *, exp(coalesce(sum(roll_ln) OVER (ORDER BY ts DESC ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0.0)) AS adj FROM jumps),
chain AS (SELECT CAST(timezone('UTC', ts) AS DATE) AS day, symbol, adj, roll_ln <> 0.0 AS is_roll FROM cumulative),
chain_size AS (SELECT count(*) AS day_count FROM chain),
adjusted AS (
  SELECT b.ts, b.symbol, b.open * coalesce(chain.adj, 1.0) AS o, b.high * coalesce(chain.adj, 1.0) AS h,
         b.low * coalesce(chain.adj, 1.0) AS l, b.close * coalesce(chain.adj, 1.0) AS c, b.volume AS v,
         coalesce(chain.adj, 1.0) AS adj, coalesce(chain.is_roll, false) AS is_roll
  FROM ${VIEW} b CROSS JOIN chain_size
  LEFT JOIN chain ON chain.day = CAST(timezone('UTC', b.ts) AS DATE) AND chain.symbol = b.symbol
  WHERE b.asset_class = ${A} AND b.root = ${R} AND b.timeframe = ${text(BASE_TIMEFRAME)}
    AND (chain_size.day_count = 0 OR chain.symbol IS NOT NULL)),
hourly AS (
  SELECT time_bucket(to_seconds(3600), ts, TIMESTAMPTZ '1970-01-05 00:00:00+00') AS ts,
         arg_min(o, ts) AS o, max(h) AS h, min(l) AS l, arg_max(c, ts) AS c, sum(v) AS v,
         arg_max(symbol, ts) AS symbol, arg_max(adj, ts) AS adj, bool_or(is_roll) AS is_roll
  FROM adjusted GROUP BY 1),
shaped AS (
  SELECT ts, o, h, l, c, v, symbol, adj, is_roll,
         CASE WHEN h > l THEN (o - l) / (h - l) ELSE 0.5 END AS open_normalized,
         CASE WHEN h > l THEN (c - l) / (h - l) ELSE 0.5 END AS close_normalized,
         CASE WHEN h > l THEN (c - o) / (h - l) ELSE 0.0 END AS body_normalized,
         CASE WHEN h > l THEN (h - greatest(o, c)) / (h - l) ELSE 0.0 END AS upper_wick_normalized,
         CASE WHEN h > l THEN (least(o, c) - l) / (h - l) ELSE 0.0 END AS lower_wick_normalized,
         ln(c / lag(c) OVER (ORDER BY ts)) AS log_return,
         ln(greatest(h - l, 1e-12)) AS log_range,
         ln(greatest(coalesce(v, 1.0), 1.0)) AS log_volume
  FROM hourly),
features AS (
  SELECT *,
         abs(body_normalized) AS body_fraction,
         upper_wick_normalized - lower_wick_normalized AS wick_difference_normalized,
         CASE WHEN count(log_return) OVER w = ${ZSCORE_WINDOW}
              THEN greatest(-5.0, least(5.0, (log_return - avg(log_return) OVER w) / nullif(stddev_pop(log_return) OVER w, 0))) END AS return_zscore,
         CASE WHEN count(log_range) OVER w = ${ZSCORE_WINDOW}
              THEN greatest(-5.0, least(5.0, (log_range - avg(log_range) OVER w) / nullif(stddev_pop(log_range) OVER w, 0))) END AS range_zscore,
         CASE WHEN count(log_volume) OVER w = ${ZSCORE_WINDOW}
              THEN greatest(-5.0, least(5.0, (log_volume - avg(log_volume) OVER w) / nullif(stddev_pop(log_volume) OVER w, 0))) END AS volume_zscore,
         sign(c - o)::TINYINT AS direction
  FROM shaped WINDOW w AS (ORDER BY ts ROWS BETWEEN ${ZSCORE_WINDOW - 1} PRECEDING AND CURRENT ROW))
SELECT epoch_ms(features.ts) AS timestamp, features.symbol AS contract_symbol, features.is_roll AS is_contract_roll_day,
       features.o AS open, features.h AS high, features.l AS low, features.c AS close, features.v AS volume,
       features.adj AS adjustment_factor, features.c / features.adj AS unadjusted_close,
       features.open_normalized, features.close_normalized, features.body_normalized, features.upper_wick_normalized,
       features.lower_wick_normalized, features.body_fraction, features.wick_difference_normalized,
       features.log_return, features.log_range, features.log_volume,
       features.return_zscore, features.range_zscore, features.volume_zscore, features.direction${spreadColumn}
FROM features ${spreadJoin}
ORDER BY features.ts`;
}

// ---------------------------------------------------------------------------
// The series, materialised once per instrument
// ---------------------------------------------------------------------------

const TEXT_COLUMNS = new Set(["contract_symbol", "is_contract_roll_day"]);

export interface LoadedSeries {
  key: string;
  length: number;
  timestamps: Float64Array;
  contracts: string[];
  rollFlags: boolean[];
  /** Every numeric column, unknown as NaN. */
  numeric: Map<string, Float64Array>;
  summary: SeriesSummary;
}

function toColumns(rows: Array<Record<string, unknown>>): Omit<LoadedSeries, "key" | "summary"> {
  const length = rows.length;
  const names = length > 0 ? Object.keys(rows[0] as object).filter((name) => name !== "timestamp" && !TEXT_COLUMNS.has(name)) : [];
  const numeric = new Map<string, Float64Array>();
  for (const name of names) numeric.set(name, new Float64Array(length));
  const timestamps = new Float64Array(length);
  const contracts: string[] = new Array<string>(length);
  const rollFlags: boolean[] = new Array<boolean>(length);
  for (let i = 0; i < length; i += 1) {
    const row = rows[i] as Record<string, unknown>;
    timestamps[i] = Number(row.timestamp);
    contracts[i] = String(row.contract_symbol ?? "");
    rollFlags[i] = row.is_contract_roll_day === true;
    for (const name of names) {
      const value = row[name];
      (numeric.get(name) as Float64Array)[i] = value === null || value === undefined ? Number.NaN : Number(value);
    }
  }
  return { length, timestamps, contracts, rollFlags, numeric };
}

function column(series: LoadedSeries, name: string): Float64Array {
  return series.numeric.get(name) ?? new Float64Array(series.length).fill(Number.NaN);
}

const memories = new WeakMap<StudyLake, Map<string, { at: number; series: Promise<LoadedSeries> }>>();

async function loadSeries(lake: StudyLake, option: InstrumentOption): Promise<LoadedSeries> {
  const started = performance.now();
  const [rows, interleave] = await Promise.all([
    lake.query<Record<string, unknown>>(seriesSql(option.assetClass, option.root), QUERY_TIMEOUT_MILLISECONDS),
    lake.query<{ ratio: number | null }>(interleaveSql(option.assetClass, option.root), QUERY_TIMEOUT_MILLISECONDS),
  ]);
  const columns = toColumns(rows);
  const returnZ = columns.numeric.get("return_zscore");
  let warmup = 0;
  if (returnZ) for (let i = 0; i < returnZ.length; i += 1) if (Number.isNaN(returnZ[i] as number)) warmup += 1;
  const adjustment = columns.numeric.get("adjustment_factor");
  const summary: SeriesSummary = {
    key: option.key,
    barCount: columns.length,
    firstTimestamp: columns.length > 0 ? (columns.timestamps[0] as number) : 0,
    lastTimestamp: columns.length > 0 ? (columns.timestamps[columns.length - 1] as number) : 0,
    contractCount: new Set(columns.contracts).size,
    rollCount: rollStartPositions(columns.rollFlags).length,
    cumulativeAdjustmentFactor: adjustment && adjustment.length > 0 ? (adjustment[0] as number) : 1,
    interleaveRatio: interleave[0]?.ratio ?? null,
    returnStandardDeviationAdjusted: logReturnStandardDeviation(columns.numeric.get("close") ?? []),
    returnStandardDeviationUnadjusted: logReturnStandardDeviation(columns.numeric.get("unadjusted_close") ?? []),
    warmupBarCount: warmup,
    loadSeconds: (performance.now() - started) / 1000,
    fromMemory: false,
  };
  return { key: option.key, ...columns, summary };
}

async function seriesFor(context: StudyContext, option: InstrumentOption): Promise<LoadedSeries> {
  let memory = memories.get(context.lake);
  if (!memory) {
    memory = new Map();
    memories.set(context.lake, memory);
  }
  const now = Date.now();
  for (const [key, entry] of memory) if (now - entry.at > MEMORY_MILLISECONDS) memory.delete(key);
  const hit = memory.get(option.key);
  if (hit) {
    const series = await hit.series;
    return { ...series, summary: { ...series.summary, loadSeconds: 0, fromMemory: true } };
  }
  while (memory.size >= MEMORY_ENTRIES) {
    const oldest = memory.keys().next().value;
    if (oldest === undefined) break;
    memory.delete(oldest);
  }
  const pending = loadSeries(context.lake, option);
  memory.set(option.key, { at: now, series: pending });
  try {
    return await pending;
  } catch (error) {
    memory.delete(option.key);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// The universe (which roots have minute bars), kept a little longer
// ---------------------------------------------------------------------------

const universes = new WeakMap<StudyLake, { at: number; options: Promise<InstrumentOption[]> }>();

async function instrumentOptions(lake: StudyLake): Promise<InstrumentOption[]> {
  const cached = universes.get(lake);
  if (cached && Date.now() - cached.at < MEMORY_MILLISECONDS) return cached.options;
  const pending = lake
    .query<{ asset_class: string; root: string; minute_bar_count: number; symbol_count: number; first_timestamp: number; last_timestamp: number }>(universeSql(), QUERY_TIMEOUT_MILLISECONDS)
    .then((rows) =>
      rows
        .filter((row) => (ASSET_CLASSES as readonly string[]).includes(row.asset_class))
        .map((row): InstrumentOption => ({
          key: `${row.asset_class}:${row.root}`,
          assetClass: row.asset_class as AssetClass,
          root: String(row.root),
          symbolCount: Number(row.symbol_count),
          minuteBarCount: Number(row.minute_bar_count),
          firstTimestamp: Number(row.first_timestamp),
          lastTimestamp: Number(row.last_timestamp),
        })),
    );
  universes.set(lake, { at: Date.now(), options: pending });
  try {
    return await pending;
  } catch (error) {
    universes.delete(lake);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// The response
// ---------------------------------------------------------------------------

const ZSCORES = [
  { column: "return_zscore", source: "log_return" },
  { column: "range_zscore", source: "log_range" },
  { column: "volume_zscore", source: "log_volume" },
] as const;

function windowRow(series: LoadedSeries, position: number, names: readonly string[]): WindowRow {
  const row: WindowRow = {
    timestamp: series.timestamps[position] as number,
    contract_symbol: series.contracts[position] as string,
    is_contract_roll_day: series.rollFlags[position] as boolean,
    open: 0, high: 0, low: 0, close: 0, volume: 0,
  };
  for (const name of names) {
    const value = (series.numeric.get(name) as Float64Array)[position] as number;
    row[name] = Number.isFinite(value) ? value : null;
  }
  return row;
}

export function buildBody(series: LoadedSeries, query: MarketSeriesExplorerQuery, instruments: InstrumentOption[]): ExplorerBody {
  const overview = buildOverview(series.timestamps, column(series, "range_zscore"), column(series, "close"));
  const dayCount = overview.dayTimestamps.length;
  if (dayCount === 0) {
    return { ...EMPTY_BODY, instruments, summary: series.summary, convention: query.convention };
  }
  const resolved = resolveSpan(dayCount, query.spanStart, query.spanEnd);
  const instants = spanInstants(overview.dayTimestamps, resolved.startIndex, resolved.endIndex);
  const inSpan = positionsInSpan(series.timestamps, instants.start, instants.end);
  const thinned = thinPositions(inSpan, query.targetBars);

  const names = [...series.numeric.keys()];
  const rows = thinned.positions.map((position) => windowRow(series, position, names));
  const featureNames = SERIES_COLUMN_NAMES.filter((name) => series.numeric.has(name));

  // Rolls: every roll day of the series, from the full series (a thinned window
  // may have skipped the bar the day began on); the page keeps those in the span.
  const rolls: RollEvent[] = [];
  const adjustment = column(series, "adjustment_factor");
  for (const position of rollStartPositions(series.rollFlags)) {
    const at = series.timestamps[position] as number;
    const before = adjustment[position - 1] as number;
    const after = adjustment[position] as number;
    const ratio = position > 0 && Number.isFinite(before) && Number.isFinite(after) && after > 0 ? before / after : null;
    rolls.push({
      timestamp: at,
      fromContract: position > 0 ? (series.contracts[position - 1] as string) : "",
      toContract: series.contracts[position] as string,
      priceRatio: ratio,
      logJump: ratio !== null && ratio > 0 ? Math.log(ratio) : null,
    });
  }

  // Brushed span against the rest of history, every feature column.
  const inside = new Uint8Array(series.length);
  for (const position of inSpan) inside[position] = 1;
  const statistics: ColumnStatistics[] = featureNames.map((name) => {
    const values = column(series, name);
    const brushed: number[] = [];
    const rest: number[] = [];
    for (let i = 0; i < series.length; i += 1) {
      const value = values[i] as number;
      if (!Number.isFinite(value)) continue;
      (inside[i] ? brushed : rest).push(value);
    }
    return { column: name, brushed: distributionSummary(brushed, query.convention), rest: distributionSummary(rest, query.convention) };
  });

  let histogram: ExplorerBody["histogram"] = null;
  if (series.numeric.has(query.statisticsColumn)) {
    const values = column(series, query.statisticsColumn);
    const brushed: number[] = [];
    const rest: number[] = [];
    for (let i = 0; i < series.length; i += 1) {
      const value = values[i] as number;
      if (!Number.isFinite(value)) continue;
      (inside[i] ? brushed : rest).push(value);
    }
    histogram = compareHistograms(query.statisticsColumn, brushed, rest, query.bins);
  }

  // The numbers behind each causal z-score at the last drawn bar.
  const zscoreExamples: ZscoreExample[] = [];
  const lastPosition = thinned.positions[thinned.positions.length - 1];
  if (lastPosition !== undefined) {
    for (const { column: zscoreColumn, source } of ZSCORES) {
      const values = column(series, source);
      const stats = trailingWindow(values, lastPosition, ZSCORE_WINDOW);
      const observation = values[lastPosition] as number;
      zscoreExamples.push({
        column: zscoreColumn,
        source,
        timestamp: series.timestamps[lastPosition] as number,
        observation: Number.isFinite(observation) ? observation : null,
        windowMean: stats?.mean ?? null,
        windowStandardDeviation: stats?.standardDeviation ?? null,
        windowLength: ZSCORE_WINDOW,
        zscore: causalZscore(values, lastPosition),
        windowValues: stats ? Array.from(values.subarray(lastPosition - ZSCORE_WINDOW + 1, lastPosition + 1)) : [],
      });
    }
  }

  return {
    instruments,
    summary: series.summary,
    overview,
    span: {
      startIndex: resolved.startIndex,
      endIndex: resolved.endIndex,
      dayCount: resolved.endIndex - resolved.startIndex + 1,
      startTimestamp: instants.start,
      endTimestamp: instants.end,
      barsInSpan: inSpan.length,
      stride: thinned.stride,
      barsDrawn: rows.length,
      isDefault: resolved.isDefault,
    },
    columns: names,
    rows,
    rolls,
    statistics,
    histogram,
    zscoreExamples,
    convention: query.convention,
  };
}

const handler: StudyHandler<typeof querySchema, ExplorerBody> = {
  slug: "market-series-explorer",
  datasets: [VIEW],
  query: querySchema,
  cacheSeconds: 300,
  timeoutMs: 180_000,
  async run(query, context) {
    if ((await missingViews(context, [VIEW])).length > 0) return { ...EMPTY_BODY, convention: query.convention };
    const instruments = await instrumentOptions(context.lake);
    if (instruments.length === 0) {
      context.notes.push(`${VIEW} holds no ${BASE_TIMEFRAME} futures or forex bars.`);
      return { ...EMPTY_BODY, convention: query.convention };
    }
    const chosen = instruments.find((option) => option.key === query.instrument)
      ?? instruments.find((option) => option.key === DEFAULT_INSTRUMENT)
      ?? (instruments[0] as InstrumentOption);
    if (chosen.key !== query.instrument) {
      context.notes.push(`${query.instrument} has no ${BASE_TIMEFRAME} bars in the lake; showing ${chosen.key}.`);
    }
    const series = await seriesFor(context, chosen);
    if (series.length === 0) {
      context.notes.push(`${chosen.key} produced no ${VIEW_TIMEFRAME} bars.`);
      return { ...EMPTY_BODY, instruments, summary: series.summary, convention: query.convention };
    }
    return buildBody(series, query, instruments);
  },
};

export default handler;
