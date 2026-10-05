/**
 * TA-Lib indicator catalogue: every TA-Lib function expanded to one column per output on front-month
 * MNQ bars (1-minute, 1-hour, 4-hour), with each column's statistics, distribution, trend and fill
 * rate, and how often each of the 61 candlestick patterns fires. Replaced
 * datalake/notebooks/mnq_talib_1m.py.
 *
 * Reads, through the dashboard's DuckDB:
 *   derived_study_talib_indicator_catalogue_{column_statistics,column_histogram,column_trend,dataset_summary}
 *       landed by packages/ml-engine/src/studies/talib_indicator_catalogue/build.py (the notebook's statistics table had
 *       no producer and lived in a standalone DuckDB file the dashboard cannot read);
 *   derived_mnq_talib_{1m,1h,4h}
 *       the bar sets themselves, for the wide-table window and the thinned line series.
 *
 * One endpoint in three parts (`part=catalogue|wide|series`) so a control on one part never refetches
 * another. Column names from the browser are matched against the landed catalogue and quoted by
 * ../sql before they reach SQL; nothing else from the browser is interpolated.
 */

import { z } from "zod";
import { ident, num, text } from "../sql";
import { missingViews } from "../views";
import type { StudyContext, StudyHandler } from "../types";
import {
  BAR_COLUMNS, DEFAULT_DRAWN_COLUMNS, HISTOGRAM_BIN_COUNT, MAXIMUM_DRAWN_COLUMNS, MAXIMUM_WINDOW_BARS, PARTS,
  POINT_BUDGETS, PRESET_KEYS, TIMEFRAMES, TREND_BUCKET_COUNT, presetColumns, thinningStride,
} from "@shared/studies/talib-indicator-catalogue";
import type {
  BarSetSummary, CatalogueBody, CatalogueColumn, ColumnHistogram, SeriesBody, TalibCatalogueBody, Timeframe, WideBody,
} from "@shared/studies/talib-indicator-catalogue";

const PREFIX = "derived_study_talib_indicator_catalogue";
const STATISTICS_VIEW = `${PREFIX}_column_statistics`;
const HISTOGRAM_VIEW = `${PREFIX}_column_histogram`;
const TREND_VIEW = `${PREFIX}_column_trend`;
const SUMMARY_VIEW = `${PREFIX}_dataset_summary`;
const SOURCE_VIEWS: Record<Timeframe, string> = {
  "1m": "derived_mnq_talib_1m",
  "1h": "derived_mnq_talib_1h",
  "4h": "derived_mnq_talib_4h",
};

const querySchema = z.object({
  part: z.enum(PARTS).default("catalogue"),
  timeframe: z.enum(TIMEFRAMES).default("1m"),
  preset: z.enum(PRESET_KEYS).default("starter"),
  windowStart: z.coerce.number().int().min(0).max(10_000_000).default(0),
  windowLength: z.coerce.number().int().min(1).max(MAXIMUM_WINDOW_BARS).default(500),
  draw: z.string().max(800).default(DEFAULT_DRAWN_COLUMNS.join(",")),
  points: z.coerce.number().int().refine((value) => (POINT_BUDGETS as readonly number[]).includes(value), "points must be 2000, 5000, 10000 or 0").default(5000),
});
type Query = z.infer<typeof querySchema>;

const STATISTIC_COLUMNS = [
  "column_name", "talib_function", "talib_output", "talib_group", "lookback_bars", "integer_output", "parameters_json",
  "bar_count", "finite_count", "finite_percent", "nonzero_bar_count", "mean", "median", "standard_deviation",
  "skewness", "kurtosis", "percentile_25", "percentile_75", "minimum", "maximum",
].map(ident).join(", ");

async function loadColumns(context: StudyContext, timeframe: Timeframe): Promise<CatalogueColumn[]> {
  return context.lake.query<CatalogueColumn>(
    `SELECT ${STATISTIC_COLUMNS} FROM ${ident(STATISTICS_VIEW)} WHERE timeframe = ${text(timeframe)} ORDER BY talib_group, column_name`,
  );
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function loadSummary(context: StudyContext, timeframe: Timeframe): Promise<BarSetSummary | null> {
  const rows = await context.lake.query<Record<string, unknown>>(
    `SELECT contract_symbol, bar_count, first_bar_index, first_timestamp, last_timestamp, talib_version, window_start, window_end
     FROM ${ident(SUMMARY_VIEW)} WHERE timeframe = ${text(timeframe)} ORDER BY first_bar_index`,
  );
  const first = rows[0];
  if (!first) return null;
  return {
    barCount: rows.reduce((sum, row) => sum + Number(row.bar_count), 0),
    contracts: rows.map((row) => ({
      contractSymbol: String(row.contract_symbol),
      barCount: Number(row.bar_count),
      firstBarIndex: Number(row.first_bar_index),
      firstTimestamp: Number(row.first_timestamp),
      lastTimestamp: Number(row.last_timestamp),
    })),
    talibVersion: String(first.talib_version),
    windowStart: Number(first.window_start),
    windowEnd: Number(first.window_end),
  };
}

async function catalogue(query: Query, context: StudyContext): Promise<CatalogueBody> {
  const empty: CatalogueBody = { part: "catalogue", timeframe: query.timeframe, summary: null, columns: [], histograms: {}, trends: {} };
  if ((await missingViews(context, [STATISTICS_VIEW, HISTOGRAM_VIEW, TREND_VIEW, SUMMARY_VIEW])).length > 0) return empty;

  const timeframe = text(query.timeframe);
  const [columns, summary, histogramRows, trendRows] = await Promise.all([
    loadColumns(context, query.timeframe),
    loadSummary(context, query.timeframe),
    context.lake.query<{ column_name: string; bin_index: number; bin_lower_value: number; bin_upper_value: number; bar_count: number }>(
      `SELECT column_name, bin_index, bin_lower_value, bin_upper_value, bar_count FROM ${ident(HISTOGRAM_VIEW)}
       WHERE timeframe = ${timeframe} ORDER BY column_name, bin_index`,
    ),
    context.lake.query<{ column_name: string; bucket_index: number; mean_value: number | null }>(
      `SELECT column_name, bucket_index, mean_value FROM ${ident(TREND_VIEW)} WHERE timeframe = ${timeframe} ORDER BY column_name, bucket_index`,
    ),
  ]);

  const histograms: Record<string, ColumnHistogram> = {};
  for (const row of histogramRows) {
    const existing = histograms[row.column_name] ?? { minimum: Number(row.bin_lower_value), maximum: Number(row.bin_upper_value), counts: new Array<number>(HISTOGRAM_BIN_COUNT).fill(0) };
    existing.maximum = Number(row.bin_upper_value);
    existing.counts[Number(row.bin_index)] = Number(row.bar_count);
    histograms[row.column_name] = existing;
  }
  const trends: Record<string, Array<number | null>> = {};
  for (const row of trendRows) {
    const series = trends[row.column_name] ?? new Array<number | null>(TREND_BUCKET_COUNT).fill(null);
    series[Number(row.bucket_index)] = numberOrNull(row.mean_value);
    trends[row.column_name] = series;
  }
  return { part: "catalogue", timeframe: query.timeframe, summary, columns, histograms, trends };
}

/** The requested columns the bar set has, at most eight, each named once; the rest are reported back. */
function drawnColumns(requested: string, known: ReadonlySet<string>): { kept: string[]; dropped: string[] } {
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const name of requested.split(",").map((piece) => piece.trim()).filter(Boolean)) {
    if (kept.includes(name) || dropped.includes(name)) continue;
    if (known.has(name) && kept.length < MAXIMUM_DRAWN_COLUMNS) kept.push(name);
    else dropped.push(name);
  }
  return { kept, dropped };
}

async function wide(query: Query, context: StudyContext): Promise<WideBody> {
  const empty: WideBody = { part: "wide", timeframe: query.timeframe, barCount: 0, start: query.windowStart, indicatorColumns: [], rows: [] };
  const source = SOURCE_VIEWS[query.timeframe];
  if ((await missingViews(context, [STATISTICS_VIEW, SUMMARY_VIEW, source])).length > 0) return empty;

  const [columns, summary] = await Promise.all([loadColumns(context, query.timeframe), loadSummary(context, query.timeframe)]);
  const indicatorColumns = presetColumns(columns, query.preset);
  const selected = ["timestamp", "contract_symbol", ...BAR_COLUMNS, ...indicatorColumns].map(ident).join(", ");
  const rows = await context.lake.query<Record<string, number | string | null>>(
    `SELECT ${num(query.windowStart)} + row_number() OVER (ORDER BY "timestamp") - 1 AS bar, *
     FROM (SELECT ${selected} FROM ${ident(source)} ORDER BY "timestamp" LIMIT ${num(query.windowLength)} OFFSET ${num(query.windowStart)})
     ORDER BY bar`,
    120_000,
  );
  return { part: "wide", timeframe: query.timeframe, barCount: summary?.barCount ?? 0, start: query.windowStart, indicatorColumns, rows };
}

async function series(query: Query, context: StudyContext): Promise<SeriesBody> {
  const empty: SeriesBody = { part: "series", timeframe: query.timeframe, barCount: 0, stride: 1, columns: [], dropped: [], rolls: [], rollContracts: [], points: [] };
  const source = SOURCE_VIEWS[query.timeframe];
  if ((await missingViews(context, [STATISTICS_VIEW, SUMMARY_VIEW, source])).length > 0) return empty;

  const [columns, summary] = await Promise.all([loadColumns(context, query.timeframe), loadSummary(context, query.timeframe)]);
  const known = new Set<string>([...columns.map((column) => column.column_name), ...BAR_COLUMNS]);
  const { kept, dropped } = drawnColumns(query.draw, known);
  const barCount = summary?.barCount ?? 0;
  const stride = thinningStride(barCount, query.points);
  if (dropped.length > 0) context.notes.push(`Not columns of the ${query.timeframe} bar set, so not drawn: ${dropped.join(", ")}.`);

  const ordering = (extraColumns: readonly string[]) =>
    `SELECT row_number() OVER (ORDER BY "timestamp") - 1 AS bar_index, "timestamp", contract_symbol, bars_since_contract_roll,
            lag(contract_symbol) OVER (ORDER BY "timestamp") AS previous_contract${extraColumns.map((name) => `, ${ident(name)}`).join("")}
     FROM ${ident(source)}`;
  const [points, rolls] = await Promise.all([
    kept.length === 0
      ? Promise.resolve([] as Array<Record<string, number | null>>)
      : context.lake.query<Record<string, number | null>>(
          `WITH ordered AS (${ordering(kept)})
           SELECT bar_index, "timestamp", ${kept.map(ident).join(", ")} FROM ordered WHERE bar_index % ${num(stride)} = 0 ORDER BY bar_index`,
          120_000,
        ),
    context.lake.query<{ bar_index: number; previous_contract: string | null; contract_symbol: string }>(
      `WITH ordered AS (${ordering([])})
       SELECT bar_index, previous_contract, contract_symbol FROM ordered WHERE bars_since_contract_roll = 0 AND bar_index > 0 ORDER BY bar_index`,
    ),
  ]);
  return {
    part: "series",
    timeframe: query.timeframe,
    barCount,
    stride,
    columns: kept,
    dropped,
    rolls: rolls.map((row) => Number(row.bar_index)),
    rollContracts: rolls.map((row) => ({ barIndex: Number(row.bar_index), from: row.previous_contract, to: row.contract_symbol })),
    points,
  };
}

const handler: StudyHandler<typeof querySchema, TalibCatalogueBody> = {
  slug: "talib-indicator-catalogue",
  datasets: [STATISTICS_VIEW, HISTOGRAM_VIEW, TREND_VIEW, SUMMARY_VIEW, ...Object.values(SOURCE_VIEWS)],
  query: querySchema,
  cacheSeconds: 600,
  timeoutMs: 180_000,
  async run(query, context) {
    if (query.part === "wide") return wide(query, context);
    if (query.part === "series") return series(query, context);
    return catalogue(query, context);
  },
};

export default handler;
