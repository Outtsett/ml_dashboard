/**
 * EURUSD bars, forward labels and distributions. Replaced
 * Trading/forexmodel/notebooks/eurusd.py.
 *
 * Three sections of one endpoint, each cached on its own so dragging the
 * window never recomputes the distributions:
 *
 *   window   the candles on screen: EURUSD 1-minute bars from `bars` (the lake's
 *            market.bars, as forexmodel.data.load_ohlcv reads them), bucketed
 *            with time_bucket / arg_min / arg_max to the timeframe (the notebook
 *            resampled with polars group_by_dynamic, closed left), each bar's
 *            log return and its `dir_h<h>` from the landed labels.
 *   returns  the log return in basis points, development slice (first
 *            int(n * 0.8) bars) against the sealed fifth, with the notebook's
 *            `stats.describe_by` numbers computed in SQL and a shared-bin histogram.
 *   labels   the landed label tables for one timeframe: catalog, class balance,
 *            the `stats.describe_frame` set per continuous column, 60-bin
 *            histograms, and the class boundary per horizon.
 *
 * The label tables are landed by packages/ml-engine/src/studies/eurusd_bars_and_labels/build.py
 * (the repo's `scripts/trend_labels.py` code path, re-run on the lake's bars)
 * as `derived_study_eurusd_bars_and_labels_<table>`.
 */

import { z } from "zod";
import { ident, num, text } from "../sql";
import { missingViews } from "../views";
import type { StudyContext, StudyHandler } from "../types";
import {
  BUCKET_INTERVAL, DEVELOPMENT_FRACTION, MAXIMUM_BARS_SHOWN, MINIMUM_BARS_SHOWN, SECTIONS, TIMEFRAMES,
  type ClassBalanceRow, type ForwardDirection, type HorizonGridRow, type LabelColumn, type LabelDistribution,
  type LabelRunInformation, type LabelsBody, type ReturnHistogramBin, type ReturnStatistics, type ReturnsBody,
  type Timeframe, type WindowBar, type WindowBody,
} from "@shared/studies/eurusd-bars-and-labels";

const BARS_VIEW = "bars";
const PREFIX = "derived_study_eurusd_bars_and_labels_";
const DIRECTION_VIEW = `${PREFIX}forward_direction_bars`;
const CATALOG_VIEW = `${PREFIX}label_catalog`;
const CLASS_VIEW = `${PREFIX}label_class_balance`;
const DISTRIBUTION_VIEW = `${PREFIX}label_distributions`;
const HISTOGRAM_VIEW = `${PREFIX}label_histograms`;
const GRID_VIEW = `${PREFIX}label_horizon_grid`;
const RUN_VIEW = `${PREFIX}label_run_information`;
const LABEL_VIEWS = [DIRECTION_VIEW, CATALOG_VIEW, CLASS_VIEW, DISTRIBUTION_VIEW, HISTOGRAM_VIEW, GRID_VIEW, RUN_VIEW];

const HISTOGRAM_BINS = 60;
const HISTOGRAM_LOWER_QUANTILE = 0.005;
const HISTOGRAM_UPPER_QUANTILE = 0.995;

const querySchema = z.object({
  section: z.enum(SECTIONS).default("window"),
  timeframe: z.enum(TIMEFRAMES).default("1h"),
  barsShown: z.coerce.number().int().min(MINIMUM_BARS_SHOWN).max(MAXIMUM_BARS_SHOWN).default(120),
  /** First bar of the window; -1 is the latest window. */
  start: z.coerce.number().int().min(-1).max(10_000_000).default(-1),
  /** Horizon in bars for the markers; 0 picks the smallest landed one. */
  horizon: z.coerce.number().int().min(0).max(1_000_000).default(0),
});
type Query = z.infer<typeof querySchema>;
type Row = Record<string, unknown>;

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function count(value: unknown): number {
  return number(value) ?? 0;
}

/**
 * The timeframe's bars, one row per bucket: the notebook's `load_ohlcv`. Open is
 * the first 1-minute open and close the last (arg_min / arg_max on the bar
 * time, never first() / last()); a bucket with no 1-minute bar does not exist.
 */
export function barsSql(timeframe: Timeframe): string {
  const interval = BUCKET_INTERVAL[timeframe];
  const base = `SELECT timezone('UTC', ts) AS bar_time, open, high, low, close, volume
      FROM ${ident(BARS_VIEW)}
     WHERE asset_class = 'forex' AND timeframe = '1m' AND root = 'EURUSD'`;
  if (interval === null) return `SELECT bar_time AS bucket_start, open, high, low, close, volume FROM (${base})`;
  return `SELECT time_bucket(INTERVAL '${interval}', bar_time) AS bucket_start,
                 arg_min(open, bar_time) AS open, max(high) AS high, min(low) AS low,
                 arg_max(close, bar_time) AS close, sum(volume) AS volume
            FROM (${base}) GROUP BY 1`;
}

/** The window's rows with bar index, series size and the optional label join. */
export function windowSql(query: Query, horizon: number | null): string {
  const shown = num(query.barsShown);
  const start = num(query.start);
  const first = `GREATEST(CASE WHEN ${start} < 0 THEN bar_count - ${shown} ELSE LEAST(${start}, bar_count - ${shown}) END, 0)`;
  const join =
    horizon === null
      ? `CAST(NULL AS TINYINT) AS forward_direction FROM picked w`
      : `d.forward_direction AS forward_direction
           FROM picked w
           LEFT JOIN ${ident(DIRECTION_VIEW)} d
             ON d.timeframe = ${text(query.timeframe)} AND d.horizon_bars = ${num(horizon)} AND d.timestamp = w.bucket_start`;
  return `WITH bars_tf AS (${barsSql(query.timeframe)}),
    numbered AS (
      SELECT bucket_start, open, high, low, close, volume,
             row_number() OVER (ORDER BY bucket_start) - 1 AS bar_index,
             count(*) OVER () AS bar_count,
             epoch_ms(min(bucket_start) OVER ()) AS first_timestamp,
             epoch_ms(max(bucket_start) OVER ()) AS last_timestamp
        FROM bars_tf),
    picked AS (
      SELECT * FROM numbered
       WHERE bar_index >= ${first} AND bar_index < ${first} + ${shown})
    SELECT epoch_ms(w.bucket_start) AS timestamp, w.open, w.high, w.low, w.close, w.volume,
           w.bar_index, w.bar_count, w.first_timestamp, w.last_timestamp,
           ${join}
     ORDER BY w.bar_index`;
}

function toDirection(value: unknown): ForwardDirection | null {
  const direction = number(value);
  return direction === 1 || direction === 0 || direction === -1 ? direction : null;
}

function emptyWindow(query: Query): WindowBody {
  return {
    timeframe: query.timeframe, barCount: 0, firstTimestamp: null, lastTimestamp: null, developmentBarCount: 0,
    sealedBarCount: 0, windowStartIndex: 0, bars: [], horizons: [], horizon: null, labelsLanded: false,
  };
}

/** The horizons `dir_h<h>` is landed for at this timeframe, from the one-row-per-timeframe run table. */
async function landedHorizons(context: StudyContext, timeframe: Timeframe): Promise<number[]> {
  if (!(await context.lake.hasView(RUN_VIEW))) return [];
  const [row] = await context.lake.query<Row>(
    `SELECT label_horizons_bars FROM ${ident(RUN_VIEW)} WHERE timeframe = ${text(timeframe)}`,
  );
  const listed = typeof row?.label_horizons_bars === "string" ? row.label_horizons_bars : "";
  return listed
    .split(",")
    .map((piece) => Number(piece))
    .filter((value) => Number.isInteger(value) && value > 0)
    .sort((a, b) => a - b);
}

async function windowSection(query: Query, context: StudyContext): Promise<WindowBody> {
  if (!(await context.lake.hasView(BARS_VIEW))) {
    context.notes.push("The lake's bars view is not defined, so no EURUSD bars can be read.");
    return emptyWindow(query);
  }
  const directionLanded = await context.lake.hasView(DIRECTION_VIEW);
  if (!directionLanded) {
    await missingViews(context, [DIRECTION_VIEW]);
  }
  const horizons = directionLanded ? await landedHorizons(context, query.timeframe) : [];
  const horizon = horizons.includes(query.horizon) ? query.horizon : (horizons[0] ?? null);
  const rows = await context.lake.query<Row>(windowSql(query, directionLanded ? horizon : null));
  if (rows.length === 0) {
    context.notes.push("The lake holds no EURUSD 1-minute bars.");
    return emptyWindow(query);
  }
  const first = rows[0] as Row;
  const barCount = count(first.bar_count);
  const developmentBarCount = Math.floor(barCount * DEVELOPMENT_FRACTION);
  const bars: WindowBar[] = rows.map((row, index) => {
    const previous = index > 0 ? number((rows[index - 1] as Row).close) : null;
    const close = count(row.close);
    return {
      timestamp: count(row.timestamp),
      open: count(row.open),
      high: count(row.high),
      low: count(row.low),
      close,
      volume: count(row.volume),
      // The notebook prepends NaN: the window's first bar has no return, however many bars precede it.
      logReturnBasisPoints: previous !== null && previous > 0 && close > 0 ? (Math.log(close) - Math.log(previous)) * 10_000 : null,
      forwardDirection: toDirection(row.forward_direction),
    };
  });
  if (directionLanded && horizons.length === 0) {
    context.notes.push(`No trend labels are landed at ${query.timeframe}: no horizon there labels at least 20% of the bars.`);
  }
  return {
    timeframe: query.timeframe,
    barCount,
    firstTimestamp: number(first.first_timestamp),
    lastTimestamp: number(first.last_timestamp),
    developmentBarCount,
    sealedBarCount: barCount - developmentBarCount,
    windowStartIndex: count(first.bar_index),
    bars,
    horizons,
    horizon,
    labelsLanded: directionLanded && horizons.length > 0,
  };
}

/**
 * The log returns in basis points with their split. Return j is the step into
 * bar j + 1, and it is development when j < int(n * 0.8): the notebook's
 * `np.arange(len(logret)) < dev_stop` with dev_stop taken from the bar count.
 */
export function returnsSql(timeframe: Timeframe): string {
  return `WITH bars_tf AS (${barsSql(timeframe)}),
    stepped AS (
      SELECT row_number() OVER (ORDER BY bucket_start) - 1 AS bar_index,
             count(*) OVER () AS bar_count,
             CASE WHEN close > 0 THEN ln(close) END AS log_close
        FROM bars_tf),
    returns AS (
      SELECT bar_count,
             CASE WHEN bar_index - 1 < CAST(floor(bar_count * ${num(DEVELOPMENT_FRACTION)}) AS BIGINT) THEN 'development' ELSE 'sealed' END AS group_name,
             (log_close - lag(log_close) OVER (ORDER BY bar_index)) * 10000 AS basis_points
        FROM stepped)`;
}

export function returnStatisticsSql(timeframe: Timeframe): string {
  return `${returnsSql(timeframe)},
    usable AS (SELECT group_name, basis_points, bar_count FROM returns WHERE isfinite(basis_points)),
    moments AS (
      SELECT group_name, max(bar_count) AS bar_count, count(*) AS observation_count, avg(basis_points) AS mean_value,
             stddev_samp(basis_points) AS standard_deviation, min(basis_points) AS minimum_value,
             max(basis_points) AS maximum_value,
             quantile_cont(basis_points, [0.01, 0.05, 0.25, 0.5, 0.75, 0.95, 0.99]) AS quantiles
        FROM usable GROUP BY group_name),
    central AS (
      SELECT u.group_name,
             avg(power((u.basis_points - m.mean_value) / m.standard_deviation, 3)) AS skewness,
             avg(power((u.basis_points - m.mean_value) / m.standard_deviation, 4)) - 3 AS excess_kurtosis
        FROM usable u JOIN moments m USING (group_name)
       WHERE m.standard_deviation > 0 AND m.observation_count > 2
       GROUP BY u.group_name),
    dropped AS (
      SELECT group_name, count(*) FILTER (WHERE basis_points IS NOT NULL AND NOT isfinite(basis_points)) AS dropped_count
        FROM returns GROUP BY group_name)
    SELECT m.group_name, m.bar_count, m.observation_count, m.mean_value, m.standard_deviation, m.minimum_value, m.maximum_value,
           m.quantiles[1] AS percentile_1, m.quantiles[2] AS percentile_5, m.quantiles[3] AS percentile_25,
           m.quantiles[4] AS median_value, m.quantiles[5] AS percentile_75, m.quantiles[6] AS percentile_95,
           m.quantiles[7] AS percentile_99, c.skewness, c.excess_kurtosis, COALESCE(d.dropped_count, 0) AS dropped_count
      FROM moments m LEFT JOIN central c USING (group_name) LEFT JOIN dropped d USING (group_name)`;
}

export function returnHistogramSql(timeframe: Timeframe): string {
  return `${returnsSql(timeframe)},
    usable AS (SELECT group_name, basis_points FROM returns WHERE isfinite(basis_points)),
    span AS (
      SELECT quantile_cont(basis_points, ${num(HISTOGRAM_LOWER_QUANTILE)}) AS lower_edge,
             quantile_cont(basis_points, ${num(HISTOGRAM_UPPER_QUANTILE)}) AS upper_edge
        FROM usable),
    placed AS (
      SELECT u.group_name, r.lower_edge, r.upper_edge,
             CASE WHEN u.basis_points < r.lower_edge THEN -1
                  WHEN u.basis_points > r.upper_edge THEN ${HISTOGRAM_BINS}
                  ELSE LEAST(CAST(floor((u.basis_points - r.lower_edge) / ((r.upper_edge - r.lower_edge) / ${HISTOGRAM_BINS})) AS INTEGER), ${HISTOGRAM_BINS - 1})
             END AS bin_position
        FROM usable u CROSS JOIN span r)
    SELECT bin_position, group_name, count(*) AS bin_count, any_value(lower_edge) AS lower_edge, any_value(upper_edge) AS upper_edge
      FROM placed GROUP BY bin_position, group_name ORDER BY bin_position, group_name`;
}

async function returnsSection(query: Query, context: StudyContext): Promise<ReturnsBody> {
  const empty: ReturnsBody = {
    timeframe: query.timeframe, barCount: 0, developmentBarCount: 0, sealedBarCount: 0, statistics: [], histogram: [],
    histogramLower: null, histogramUpper: null, belowRangeCount: { development: 0, sealed: 0 }, aboveRangeCount: { development: 0, sealed: 0 },
  };
  if (!(await context.lake.hasView(BARS_VIEW))) {
    context.notes.push("The lake's bars view is not defined, so no EURUSD bars can be read.");
    return empty;
  }
  const statisticRows = await context.lake.query<Row>(returnStatisticsSql(query.timeframe));
  if (statisticRows.length === 0) {
    context.notes.push("The lake holds no EURUSD 1-minute bars.");
    return empty;
  }
  const statistics: ReturnStatistics[] = (["development", "sealed"] as const).flatMap((group) => {
    const row = statisticRows.find((candidate) => candidate.group_name === group);
    if (!row) return [];
    return [{
      group,
      count: count(row.observation_count),
      mean: number(row.mean_value),
      median: number(row.median_value),
      standardDeviation: number(row.standard_deviation),
      skewness: number(row.skewness),
      excessKurtosis: number(row.excess_kurtosis),
      percentile25: number(row.percentile_25),
      percentile75: number(row.percentile_75),
      minimum: number(row.minimum_value),
      maximum: number(row.maximum_value),
      droppedCount: count(row.dropped_count),
      percentile1: number(row.percentile_1),
      percentile5: number(row.percentile_5),
      percentile95: number(row.percentile_95),
      percentile99: number(row.percentile_99),
    }];
  });
  const developmentCount = statistics.find((row) => row.group === "development")?.count ?? 0;
  const sealedCount = statistics.find((row) => row.group === "sealed")?.count ?? 0;

  const binRows = await context.lake.query<Row>(returnHistogramSql(query.timeframe));
  const lower = number(binRows[0]?.lower_edge);
  const upper = number(binRows[0]?.upper_edge);
  const below = { development: 0, sealed: 0 };
  const above = { development: 0, sealed: 0 };
  const bins: ReturnHistogramBin[] = [];
  if (lower !== null && upper !== null && upper > lower) {
    const width = (upper - lower) / HISTOGRAM_BINS;
    for (let position = 0; position < HISTOGRAM_BINS; position += 1) {
      bins.push({ lower: lower + position * width, upper: lower + (position + 1) * width, developmentCount: 0, sealedCount: 0, developmentShare: 0, sealedShare: 0 });
    }
    for (const row of binRows) {
      const position = count(row.bin_position);
      const group = row.group_name === "development" ? "development" : "sealed";
      const amount = count(row.bin_count);
      if (position < 0) below[group] += amount;
      else if (position >= HISTOGRAM_BINS) above[group] += amount;
      else {
        const bin = bins[position];
        if (!bin) continue;
        if (group === "development") bin.developmentCount += amount;
        else bin.sealedCount += amount;
      }
    }
    for (const bin of bins) {
      bin.developmentShare = developmentCount > 0 ? bin.developmentCount / developmentCount : 0;
      bin.sealedShare = sealedCount > 0 ? bin.sealedCount / sealedCount : 0;
    }
  }
  const barCount = Math.max(...statisticRows.map((row) => count(row.bar_count)), developmentCount + sealedCount + 1);
  return {
    timeframe: query.timeframe,
    barCount,
    developmentBarCount: Math.floor(barCount * DEVELOPMENT_FRACTION),
    sealedBarCount: barCount - Math.floor(barCount * DEVELOPMENT_FRACTION),
    statistics,
    histogram: bins,
    histogramLower: lower,
    histogramUpper: upper,
    belowRangeCount: below,
    aboveRangeCount: above,
  };
}

async function labelsSection(query: Query, context: StudyContext): Promise<LabelsBody> {
  const empty: LabelsBody = { timeframe: query.timeframe, landed: false, run: null, catalog: [], classBalance: [], distributions: [], grid: [] };
  if ((await missingViews(context, LABEL_VIEWS)).length > 0) return empty;
  const timeframe = text(query.timeframe);
  const [runRows, catalogRows, classRows, distributionRows, histogramRows, gridRows] = await Promise.all([
    context.lake.query<Row>(`SELECT *, epoch_ms(first_bar_timestamp) AS first_ms, epoch_ms(last_bar_timestamp) AS last_ms, epoch_ms(built_at) AS built_ms FROM ${ident(RUN_VIEW)} WHERE timeframe = ${timeframe}`),
    context.lake.query<Row>(`SELECT * FROM ${ident(CATALOG_VIEW)} WHERE timeframe = ${timeframe} ORDER BY label_column`),
    context.lake.query<Row>(`SELECT * FROM ${ident(CLASS_VIEW)} WHERE timeframe = ${timeframe} ORDER BY label_column, class_value`),
    context.lake.query<Row>(`SELECT * FROM ${ident(DISTRIBUTION_VIEW)} WHERE timeframe = ${timeframe} ORDER BY label_column`),
    context.lake.query<Row>(`SELECT label_column, bin_position, bin_lower_edge, bin_upper_edge, bin_count FROM ${ident(HISTOGRAM_VIEW)} WHERE timeframe = ${timeframe} ORDER BY label_column, bin_position`),
    context.lake.query<Row>(`SELECT * FROM ${ident(GRID_VIEW)} WHERE timeframe = ${timeframe} ORDER BY horizon_bars`),
  ]);
  const runRow = runRows[0];
  const run: LabelRunInformation | null = runRow
    ? {
        barCount: count(runRow.bar_count),
        firstBarTimestamp: number(runRow.first_ms),
        lastBarTimestamp: number(runRow.last_ms),
        developmentBarCount: count(runRow.development_bar_count),
        labelColumnCount: count(runRow.label_column_count),
        horizons: String(runRow.label_horizons_bars ?? "").split(",").map(Number).filter((value) => Number.isInteger(value) && value > 0),
        builtAt: number(runRow.built_ms),
      }
    : null;
  const catalog: LabelColumn[] = catalogRows.map((row) => ({
    labelColumn: String(row.label_column),
    displayName: String(row.label_display_name),
    family: String(row.label_family),
    role: String(row.label_role),
    dataType: String(row.data_type),
    valueSet: String(row.value_set ?? ""),
    horizonOrWindowBars: number(row.horizon_or_window_bars),
    rowCount: count(row.row_count),
    knownCount: count(row.known_count),
    knownShare: number(row.known_share),
    distinctCount: count(row.distinct_count),
    meaning: String(row.meaning ?? ""),
  }));
  const classBalance: ClassBalanceRow[] = classRows.map((row) => ({
    labelColumn: String(row.label_column),
    displayName: String(row.label_display_name),
    classValue: count(row.class_value),
    classCount: count(row.class_count),
    knownCount: count(row.known_count),
    classShare: count(row.class_share),
  }));
  const binsByColumn = new Map<string, Array<{ lower: number; upper: number; count: number }>>();
  for (const row of histogramRows) {
    const column = String(row.label_column);
    const list = binsByColumn.get(column) ?? [];
    list.push({ lower: count(row.bin_lower_edge), upper: count(row.bin_upper_edge), count: count(row.bin_count) });
    binsByColumn.set(column, list);
  }
  const distributions: LabelDistribution[] = distributionRows.map((row) => ({
    labelColumn: String(row.label_column),
    displayName: String(row.label_display_name),
    count: count(row.count),
    mean: number(row.mean),
    median: number(row.median),
    standardDeviation: number(row.standard_deviation),
    skewness: number(row.skewness),
    excessKurtosis: number(row.excess_kurtosis),
    percentile25: number(row.percentile_25),
    percentile75: number(row.percentile_75),
    minimum: number(row.minimum),
    maximum: number(row.maximum),
    droppedCount: count(row.dropped_count),
    percentile1: number(row.percentile_1),
    percentile5: number(row.percentile_5),
    percentile95: number(row.percentile_95),
    percentile99: number(row.percentile_99),
    countBelowHistogramRange: count(row.count_below_histogram_range),
    countAboveHistogramRange: count(row.count_above_histogram_range),
    bins: binsByColumn.get(String(row.label_column)) ?? [],
  }));
  const grid: HorizonGridRow[] = gridRows.map((row) => ({
    horizonBars: count(row.horizon_bars),
    horizonTradingDays: count(row.horizon_trading_days),
    upperBoundaryTStatistic: number(row.class_boundary_t_statistic_upper),
    lowerBoundaryTStatistic: number(row.class_boundary_t_statistic_lower),
    magnitudeBoundary: number(row.magnitude_boundary_volatility_units),
    abstainShare: number(row.abstain_share),
    largeMoveShare: number(row.large_move_share),
    labelledBarShare: number(row.labelled_bar_share),
    upShare: number(row.up_share),
    rangingShare: number(row.ranging_share),
    downShare: number(row.down_share),
    trendingShare: number(row.trending_share),
    shuffledTrendingShare: number(row.shuffled_series_trending_share),
    trendingExcessOverShuffle: number(row.trending_share_excess_over_shuffle),
    kept: row.horizon_kept === true,
  }));
  if (catalog.length === 0) {
    context.notes.push(`No trend labels are landed at ${query.timeframe}: no horizon there labels at least 20% of the bars.`);
  }
  return { timeframe: query.timeframe, landed: catalog.length > 0, run, catalog, classBalance, distributions, grid };
}

type Body = WindowBody | ReturnsBody | LabelsBody;

const handler: StudyHandler<typeof querySchema, Body> = {
  slug: "eurusd-bars-and-labels",
  datasets: [BARS_VIEW, ...LABEL_VIEWS],
  query: querySchema,
  cacheSeconds: 600,
  timeoutMs: 120_000,
  async run(query, context) {
    if (query.section === "returns") return returnsSection(query, context);
    if (query.section === "labels") return labelsSection(query, context);
    return windowSection(query, context);
  },
};

export default handler;
