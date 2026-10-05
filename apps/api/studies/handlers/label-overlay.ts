/**
 * Labels on the candles: what every target marks. Replaced
 * Trading/quant/model/notebooks/label_overlay.py.
 *
 * Reads two lake views, both already served by the dashboard's DuckDB:
 *   mnq_labels_1m   the shipped label dataset (2,340,445 rows, 48 label columns)
 *   mnq_ohlcv_1m    the bars; joined one-to-one on timestamp
 *
 * Two sections, so a control that only moves the window does not recompute
 * the whole-dataset numbers:
 *   section=window   one window of bars with every label the overlays draw
 *                    (busiest / median activity / latest / from a date) plus
 *                    the two windows the notebook drew for this bar count
 *   section=dataset  class balance, exact eight numbers and a 100-bin
 *                    histogram of every continuous column, the alignment
 *                    check of the stored labels against their own bars, and
 *                    the absolute-row audit of the barrier exit column
 *
 * Window choice is the notebook's: a rolling sum of `range_pts` over the
 * bar count, busiest = its maximum, median activity = the value closest to its
 * median, both over row indices [bars, rows - 2]; the window is the `bars`
 * rows that END one row before the chosen index (the notebook's own offset).
 */

import { z } from "zod";
import { ident, num, plainRow, text } from "../sql";
import { missingViews } from "../views";
import type { StudyContext, StudyHandler } from "../types";
import {
  DIRECTION_HORIZONS,
  EMPTY_DATASET,
  EMPTY_WINDOW,
  FORWARD_RETURN_HORIZONS,
  LABEL_COLUMNS,
  VOLATILITY_HORIZONS,
  type AlignmentCheck,
  type ClassCount,
  type ColumnClassBalance,
  type ColumnProfile,
  type DatasetBody,
  type ExitBarAudit,
  type LabelColumn,
  type LabelOverlayBody,
  type WindowBody,
  type WindowChoice,
  type WindowMode,
  type WindowRow,
  WINDOW_MODES,
} from "@shared/studies/label-overlay";

export const LABELS_VIEW = "mnq_labels_1m";
export const BARS_VIEW = "mnq_ohlcv_1m";

const HISTOGRAM_BINS = 100;
const ALIGNMENT_TOLERANCE = 1e-5;

const querySchema = z.object({
  section: z.enum(["window", "dataset"]).default("window"),
  window: z.enum(WINDOW_MODES).default("busiest"),
  /** yyyy-mm-dd: with window=date, the first bar on or after this day (Pacific wall clock stored as UTC). */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  bars: z.coerce.number().int().min(60).max(2000).default(240),
});

type Query = z.infer<typeof querySchema>;

const L = ident(LABELS_VIEW);
const O = ident(BARS_VIEW);

/** A finite value or NULL: DuckDB keeps NaN as a value, and the page must see null. */
const finite = (expression: string): string => `CASE WHEN isfinite(${expression}) THEN ${expression} END`;

function columnNamed(stored: string): LabelColumn {
  const column = LABEL_COLUMNS.find((entry) => entry.stored === stored);
  if (!column) throw new Error(`unknown label column ${stored}`);
  return column;
}

// --- window section ----------------------------------------------------------

/** The busiest and median-activity window starts for `bars` (the notebook's rolling-sum rule). */
export function windowChoiceSql(bars: number): string {
  const n = num(bars);
  return `
WITH ordered AS (
  SELECT timestamp, range_pts, row_number() OVER (ORDER BY timestamp) - 1 AS row_index FROM ${L}
), rolled AS (
  SELECT row_index, SUM(range_pts) OVER (ORDER BY timestamp ROWS BETWEEN ${num(bars - 1)} PRECEDING AND CURRENT ROW) AS rolling_range_points FROM ordered
), total AS (
  SELECT count(*) AS dataset_rows FROM ordered
), valid AS (
  SELECT row_index, rolling_range_points FROM rolled, total
  WHERE row_index >= ${n} AND row_index <= dataset_rows - 2 AND isfinite(rolling_range_points)
), middle AS (
  SELECT quantile_cont(rolling_range_points, 0.5) AS median_points FROM valid
)
SELECT 'busiest' AS choice, row_index, rolling_range_points, (SELECT dataset_rows FROM total) AS dataset_rows
FROM (SELECT * FROM valid ORDER BY rolling_range_points DESC, row_index LIMIT 1)
UNION ALL
SELECT 'median', row_index, rolling_range_points, (SELECT dataset_rows FROM total)
FROM (SELECT valid.* FROM valid, middle ORDER BY abs(rolling_range_points - median_points), row_index LIMIT 1)`;
}

/** The first and last timestamp (epoch ms) of rows [startRow, startRow + bars - 1]. */
export function windowBoundsSql(startRow: number, bars: number): string {
  return `
SELECT epoch_ms(min(timestamp)) AS first_timestamp, epoch_ms(max(timestamp)) AS last_timestamp
FROM (SELECT timestamp, row_number() OVER (ORDER BY timestamp) - 1 AS row_index FROM ${L})
WHERE row_index BETWEEN ${num(startRow)} AND ${num(startRow + bars - 1)}`;
}

/** The window's rows under full-word names, read by timestamp so only the window's rows of each view are scanned. */
export function windowRowsSql(startRow: number, firstTimestamp: number, lastTimestamp: number): string {
  const directions = DIRECTION_HORIZONS.map((h) => `${finite(`l.dir_h${h}`)} AS ${ident(columnNamed(`dir_h${h}`).name)}`);
  const forwards = FORWARD_RETURN_HORIZONS.map((h) => `${finite(`l.fwd_ret_h${h}`)} AS ${ident(columnNamed(`fwd_ret_h${h}`).name)}`);
  const volatility = VOLATILITY_HORIZONS.map((h) => `${finite(`l.vol_logrange_h${h}`)} AS ${ident(columnNamed(`vol_logrange_h${h}`).name)}`);
  return `
SELECT
  ${num(startRow)} + row_number() OVER (ORDER BY l.timestamp) - 1 AS row_number,
  epoch_ms(l.timestamp) AS timestamp,
  o.open, o.high, o.low, o.close, o.volume,
  ${finite("l.range_pts")} AS bar_range_points,
  ${finite("l.vol_regime")} AS volatility_regime,
  ${finite("l.swing_label")} AS next_swing_pivot_direction,
  ${finite("l.tbl_label")} AS triple_barrier_outcome,
  ${finite("l.tbl_exit_bar")} AS triple_barrier_exit_row_number,
  ${finite("l.logrange")} AS log_bar_range,
  CAST(l.zero_range AS DOUBLE) AS zero_range_bar,
  ${finite("l.rng_bucket_h1")} AS next_bar_range_bucket,
  ${finite("l.dir_delta_pts_h1")} AS close_change_points_after_1_bars,
  ${[...directions, ...forwards, ...volatility].join(",\n  ")}
FROM ${L} l JOIN ${O} o ON o.timestamp = l.timestamp
WHERE l.timestamp BETWEEN to_timestamp(${num(firstTimestamp / 1000)}) AND to_timestamp(${num(lastTimestamp / 1000)})
ORDER BY l.timestamp`;
}

export function dateStartSql(date: string): string {
  const seconds = Date.parse(`${date}T00:00:00Z`) / 1000;
  if (!Number.isFinite(seconds)) throw new Error(`not a date: ${date}`);
  return `SELECT count(*) AS rows_before FROM ${L} WHERE timestamp < to_timestamp(${num(seconds)})`;
}

interface ChoiceRow {
  choice: string;
  row_index: number;
  rolling_range_points: number;
  dataset_rows: number;
}

async function choiceFor(context: StudyContext, startRow: number, bars: number, rolling: number | null): Promise<WindowChoice | null> {
  const [bounds] = await context.lake.query<{ first_timestamp: number | null; last_timestamp: number | null }>(windowBoundsSql(startRow, bars));
  if (!bounds || bounds.first_timestamp === null || bounds.last_timestamp === null) return null;
  return { startRow, startTimestamp: Number(bounds.first_timestamp), endTimestamp: Number(bounds.last_timestamp), rollingRangePoints: rolling };
}

async function runWindow(query: Query, context: StudyContext): Promise<WindowBody> {
  if ((await missingViews(context, [LABELS_VIEW, BARS_VIEW])).length > 0) return { ...EMPTY_WINDOW, barsPerWindow: query.bars, mode: query.window };
  const bars = query.bars;
  const choices = await context.lake.query<ChoiceRow>(windowChoiceSql(bars));
  const datasetRows = Number(choices[0]?.dataset_rows ?? (await context.lake.query<{ n: number }>(`SELECT count(*) AS n FROM ${L}`))[0]?.n ?? 0);
  if (datasetRows < bars) {
    context.notes.push(`The label dataset holds ${datasetRows} rows, fewer than the ${bars} bars of one window.`);
    return { ...EMPTY_WINDOW, datasetRows, barsPerWindow: bars, mode: query.window };
  }
  // The notebook's _slice: the window ends one row before the chosen rolling-sum index.
  const startOf = (row: ChoiceRow | undefined): number | null => (row ? Math.max(Number(row.row_index) - bars, 0) : null);
  const busyRow = choices.find((row) => row.choice === "busiest");
  const medianRow = choices.find((row) => row.choice === "median");
  const busiest = busyRow ? await choiceFor(context, startOf(busyRow) as number, bars, Number(busyRow.rolling_range_points)) : null;
  const median = medianRow ? await choiceFor(context, startOf(medianRow) as number, bars, Number(medianRow.rolling_range_points)) : null;

  let startRow: number | null = null;
  if (query.window === "busiest") startRow = busiest?.startRow ?? null;
  else if (query.window === "median") startRow = median?.startRow ?? null;
  else if (query.window === "latest") startRow = datasetRows - bars;
  else {
    const day = query.date;
    if (!day) {
      context.notes.push("Pick a date for the from-a-date window; showing the busiest window instead.");
      startRow = busiest?.startRow ?? null;
    } else {
      const [before] = await context.lake.query<{ rows_before: number }>(dateStartSql(day));
      startRow = Math.min(Number(before?.rows_before ?? 0), datasetRows - bars);
    }
  }
  if (startRow === null) return { ...EMPTY_WINDOW, datasetRows, barsPerWindow: bars, mode: query.window, busiest, median };
  const window = query.window === "busiest" && busiest ? busiest : query.window === "median" && median ? median : await choiceFor(context, startRow, bars, null);
  if (!window) return { ...EMPTY_WINDOW, datasetRows, barsPerWindow: bars, mode: query.window, busiest, median };
  const rows = (await context.lake.query<WindowRow>(windowRowsSql(window.startRow, window.startTimestamp, window.endTimestamp))).map((row) => plainRow(row));
  return { datasetRows, barsPerWindow: bars, mode: query.window as WindowMode, window, rows, busiest, median };
}

// --- dataset section ---------------------------------------------------------

interface AlignmentRule {
  stored: string;
  rule: string;
  tolerance: number | null;
  /** SQL over the `w` relation giving a boolean "stored disagrees with recomputed" and the "both known" test. */
  known: string;
  mismatch: string;
}

function alignmentRules(): AlignmentRule[] {
  const rules: AlignmentRule[] = [];
  for (const h of DIRECTION_HORIZONS) {
    rules.push({
      stored: `dir_h${h}`,
      rule: `1 when the close ${h} bar${h === 1 ? "" : "s"} ahead is above this close`,
      tolerance: null,
      known: `isfinite(dir_h${h}) AND close_ahead_${h} IS NOT NULL`,
      mismatch: `dir_h${h} <> CAST(close_ahead_${h} > close AS DOUBLE)`,
    });
  }
  for (const h of VOLATILITY_HORIZONS) {
    rules.push({
      stored: `vol_logrange_h${h}`,
      rule: `ln(high - low) of the bar ${h} bar${h === 1 ? "" : "s"} ahead (no value when that bar has zero range)`,
      tolerance: ALIGNMENT_TOLERANCE,
      known: `isfinite(vol_logrange_h${h}) AND log_range_ahead_${h} IS NOT NULL`,
      mismatch: `abs(vol_logrange_h${h} - log_range_ahead_${h}) > ${ALIGNMENT_TOLERANCE}`,
    });
  }
  for (const h of FORWARD_RETURN_HORIZONS) {
    rules.push({
      stored: `fwd_ret_h${h}`,
      rule: `ln(close ${h} bars ahead) - ln(this close)`,
      tolerance: ALIGNMENT_TOLERANCE,
      known: `isfinite(fwd_ret_h${h}) AND close_ahead_${h} IS NOT NULL`,
      mismatch: `abs(fwd_ret_h${h} - (ln(close_ahead_${h}) - ln(close))) > ${ALIGNMENT_TOLERANCE}`,
    });
  }
  return rules;
}

const NEGATIVE_CONTROL_HORIZON = 15;

/** Every alignment check, and the negative control, in one pass over the joined bars and labels. */
export function alignmentSql(): string {
  const closeHorizons = [...new Set([...DIRECTION_HORIZONS, ...FORWARD_RETURN_HORIZONS])];
  const columns = [
    ...DIRECTION_HORIZONS.map((h) => `l.dir_h${h}`),
    ...VOLATILITY_HORIZONS.map((h) => `l.vol_logrange_h${h}`),
    ...FORWARD_RETURN_HORIZONS.map((h) => `l.fwd_ret_h${h}`),
  ];
  const leads = [
    ...closeHorizons.map((h) => `LEAD(close, ${h}) OVER bars AS close_ahead_${h}`),
    ...VOLATILITY_HORIZONS.map((h) => `LEAD(log_range, ${h}) OVER bars AS log_range_ahead_${h}`),
    `LAG(dir_h${NEGATIVE_CONTROL_HORIZON}, 1) OVER bars AS dir_h${NEGATIVE_CONTROL_HORIZON}_shifted`,
  ];
  const aggregates = alignmentRules().flatMap((rule) => [
    `count(*) FILTER (WHERE ${rule.known}) AS ${ident(`${rule.stored}__compared`)}`,
    `count(*) FILTER (WHERE ${rule.known} AND ${rule.mismatch}) AS ${ident(`${rule.stored}__mismatches`)}`,
  ]);
  const knownControl = `isfinite(dir_h${NEGATIVE_CONTROL_HORIZON}_shifted) AND close_ahead_${NEGATIVE_CONTROL_HORIZON} IS NOT NULL`;
  aggregates.push(
    `count(*) FILTER (WHERE ${knownControl}) AS control__compared`,
    `count(*) FILTER (WHERE ${knownControl} AND dir_h${NEGATIVE_CONTROL_HORIZON}_shifted <> CAST(close_ahead_${NEGATIVE_CONTROL_HORIZON} > close AS DOUBLE)) AS control__mismatches`,
    "count(*) AS joined_rows",
  );
  return `
WITH joined AS (
  SELECT l.timestamp, o.close, CASE WHEN o.high - o.low > 0 THEN ln(greatest(o.high - o.low, 1e-12)) END AS log_range,
    ${columns.join(", ")}
  FROM ${L} l JOIN ${O} o ON o.timestamp = l.timestamp
), w AS (
  SELECT *, ${leads.join(",\n    ")}
  FROM joined WINDOW bars AS (ORDER BY timestamp)
)
SELECT ${aggregates.join(",\n  ")} FROM w`;
}

export function alignmentFrom(row: Record<string, unknown>): { checks: AlignmentCheck[]; control: AlignmentCheck; joinedRows: number } {
  const count = (key: string): number => Number(row[key] ?? 0);
  const checks = alignmentRules().map((rule) => {
    const column = columnNamed(rule.stored);
    return { stored: rule.stored, name: column.name, rule: rule.rule, tolerance: rule.tolerance, compared: count(`${rule.stored}__compared`), mismatches: count(`${rule.stored}__mismatches`) };
  });
  const control: AlignmentCheck = {
    stored: `dir_h${NEGATIVE_CONTROL_HORIZON}`,
    name: `direction_up_after_${NEGATIVE_CONTROL_HORIZON}_bars_shifted_one_bar`,
    rule: "the same direction column moved one bar: a check that cannot fail proves nothing",
    tolerance: null,
    compared: count("control__compared"),
    mismatches: count("control__mismatches"),
  };
  return { checks, control, joinedRows: count("joined_rows") };
}

export function classBalanceSql(): string {
  const parts = LABEL_COLUMNS.filter((column) => column.kind === "discrete").map(
    (column) => `SELECT ${text(column.stored)} AS stored, ${finite(`CAST(${ident(column.stored)} AS DOUBLE)`)} AS value, count(*) AS count FROM ${L} GROUP BY 2`,
  );
  return parts.join("\nUNION ALL\n");
}

const CONTINUOUS = LABEL_COLUMNS.filter((column) => column.kind === "continuous" && column.stored !== "tbl_exit_bar");

/**
 * Exact count, eight numbers and the histogram range of one continuous column
 * over the whole dataset. One query per column: a single statement carrying
 * every column's quantiles took 140 s, against 0.2 s per column on its own.
 */
export function profileSql(column: LabelColumn): string {
  const c = ident(column.stored);
  const known = `FILTER (WHERE isfinite(${c}))`;
  return `SELECT count(${c}) ${known} AS value_count,
  avg(${c}) ${known} AS mean,
  stddev_samp(${c}) ${known} AS standard_deviation,
  skewness(${c}) ${known} AS skewness,
  kurtosis(${c}) ${known} AS kurtosis,
  min(${c}) ${known} AS minimum,
  max(${c}) ${known} AS maximum,
  quantile_cont(${c}, [0.005, 0.25, 0.5, 0.75, 0.995]) ${known} AS quantiles
FROM ${L}`;
}

export function histogramSql(ranges: ReadonlyMap<string, { low: number; high: number }>): string {
  const parts = CONTINUOUS.map((column) => {
    const range = ranges.get(column.stored);
    if (!range) return null;
    const c = ident(column.stored);
    const width = (range.high - range.low) / HISTOGRAM_BINS;
    return `SELECT ${text(column.stored)} AS stored,
  CASE WHEN ${c} < ${num(range.low)} THEN -1 WHEN ${c} > ${num(range.high)} THEN ${HISTOGRAM_BINS}
       ELSE least(CAST(floor((${c} - ${num(range.low)}) / ${num(width)}) AS INTEGER), ${HISTOGRAM_BINS - 1}) END AS bin,
  count(*) AS count
FROM ${L} WHERE isfinite(${c}) GROUP BY 2`;
  }).filter((part): part is string => part !== null);
  return parts.join("\nUNION ALL\n");
}

export function exitBarAuditSql(): string {
  return `
WITH ordered AS (SELECT tbl_exit_bar, row_number() OVER (ORDER BY timestamp) - 1 AS row_index FROM ${L})
SELECT
  count(*) FILTER (WHERE tbl_exit_bar >= 0) AS resolved_rows,
  count(*) FILTER (WHERE tbl_exit_bar >= 0 AND tbl_exit_bar <= row_index) AS exit_not_after_entry,
  min(tbl_exit_bar - row_index) FILTER (WHERE tbl_exit_bar >= 0) AS minimum_bars_to_exit,
  max(tbl_exit_bar - row_index) FILTER (WHERE tbl_exit_bar >= 0) AS maximum_bars_to_exit,
  count(*) FILTER (WHERE NOT isfinite(tbl_exit_bar) OR tbl_exit_bar < 0) AS unresolved_rows
FROM ordered`;
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "bigint") return Number(value);
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export type ColumnSummary = Record<string, unknown>;

/** The 0.5th-99.5th percentile range a histogram is drawn over, widened to the min-max range when those percentiles coincide. */
export function histogramRanges(summaries: ReadonlyMap<string, ColumnSummary>): Map<string, { low: number; high: number }> {
  const ranges = new Map<string, { low: number; high: number }>();
  for (const column of CONTINUOUS) {
    const summary = summaries.get(column.stored);
    const quantiles = summary?.quantiles;
    const low = Array.isArray(quantiles) ? numberOrNull(quantiles[0]) : null;
    const high = Array.isArray(quantiles) ? numberOrNull(quantiles[4]) : null;
    if (low === null || high === null) {
      // A column with no known value still gets a panel, empty, rather than vanishing.
      ranges.set(column.stored, { low: 0, high: 1 });
      continue;
    }
    let lo = low;
    let hi = high;
    const minimum = numberOrNull(summary?.minimum);
    const maximum = numberOrNull(summary?.maximum);
    if (hi <= lo && minimum !== null && maximum !== null) {
      lo = minimum;
      hi = maximum;
    }
    if (hi <= lo) hi = lo + 1;
    ranges.set(column.stored, { low: lo, high: hi });
  }
  return ranges;
}

export function profilesFrom(
  summaries: ReadonlyMap<string, ColumnSummary>,
  histogramRows: Array<{ stored: string; bin: number; count: number }>,
  ranges: ReadonlyMap<string, { low: number; high: number }>,
): ColumnProfile[] {
  const byColumn = new Map<string, { bins: number[]; below: number; above: number }>();
  for (const row of histogramRows) {
    const entry = byColumn.get(row.stored) ?? { bins: new Array<number>(HISTOGRAM_BINS).fill(0), below: 0, above: 0 };
    const bin = Number(row.bin);
    const count = Number(row.count);
    if (bin < 0) entry.below += count;
    else if (bin >= HISTOGRAM_BINS) entry.above += count;
    else entry.bins[bin] = (entry.bins[bin] ?? 0) + count;
    byColumn.set(row.stored, entry);
  }
  const profiles: ColumnProfile[] = [];
  for (const column of CONTINUOUS) {
    const summary = summaries.get(column.stored);
    const range = ranges.get(column.stored);
    if (!summary || !range) continue;
    const quantiles = Array.isArray(summary.quantiles) ? (summary.quantiles as unknown[]).map(numberOrNull) : [];
    const histogram = byColumn.get(column.stored) ?? { bins: new Array<number>(HISTOGRAM_BINS).fill(0), below: 0, above: 0 };
    profiles.push({
      stored: column.stored,
      name: column.name,
      meaning: column.meaning,
      unit: column.unit,
      count: Number(numberOrNull(summary.value_count) ?? 0),
      mean: numberOrNull(summary.mean),
      median: quantiles[2] ?? null,
      standardDeviation: numberOrNull(summary.standard_deviation),
      skewness: numberOrNull(summary.skewness),
      kurtosis: numberOrNull(summary.kurtosis),
      percentile25: quantiles[1] ?? null,
      percentile75: quantiles[3] ?? null,
      minimum: numberOrNull(summary.minimum),
      maximum: numberOrNull(summary.maximum),
      histogramLow: range.low,
      histogramHigh: range.high,
      bins: histogram.bins,
      belowRange: histogram.below,
      aboveRange: histogram.above,
    });
  }
  return profiles;
}

const PROFILE_CONCURRENCY = 6;

/** Every continuous column's summary, six queries at a time. */
async function summarise(context: StudyContext): Promise<Map<string, ColumnSummary>> {
  const summaries = new Map<string, ColumnSummary>();
  for (let start = 0; start < CONTINUOUS.length; start += PROFILE_CONCURRENCY) {
    const batch = CONTINUOUS.slice(start, start + PROFILE_CONCURRENCY);
    const rows = await Promise.all(batch.map((column) => context.lake.query<ColumnSummary>(profileSql(column))));
    batch.forEach((column, index) => {
      const row = rows[index]?.[0];
      if (row) summaries.set(column.stored, row);
    });
  }
  return summaries;
}

async function runDataset(_query: Query, context: StudyContext): Promise<DatasetBody> {
  if ((await missingViews(context, [LABELS_VIEW, BARS_VIEW])).length > 0) return EMPTY_DATASET;
  const [counts, alignmentRows, balanceRows, audit, summaries] = await Promise.all([
    context.lake.query<{ label_rows: number; first_timestamp: number | null; last_timestamp: number | null }>(
      `SELECT count(*) AS label_rows, epoch_ms(min(timestamp)) AS first_timestamp, epoch_ms(max(timestamp)) AS last_timestamp FROM ${L}`,
    ),
    context.lake.query<Record<string, unknown>>(alignmentSql()),
    context.lake.query<{ stored: string; value: number | null; count: number }>(classBalanceSql()),
    context.lake.query<Record<string, unknown>>(exitBarAuditSql()),
    summarise(context),
  ]);
  const ranges = histogramRanges(summaries);
  const histogramRows = await context.lake.query<{ stored: string; bin: number; count: number }>(histogramSql(ranges));
  const [barCount] = await context.lake.query<{ bar_rows: number }>(`SELECT count(*) AS bar_rows FROM ${O}`);
  const alignment = alignmentFrom(alignmentRows[0] ?? {});

  const balances = new Map<string, ClassCount[]>();
  for (const row of balanceRows) {
    const list = balances.get(row.stored) ?? [];
    list.push({ value: numberOrNull(row.value), count: Number(row.count) });
    balances.set(row.stored, list);
  }
  const classBalance: ColumnClassBalance[] = LABEL_COLUMNS.filter((column) => column.kind === "discrete").map((column) => ({
    stored: column.stored,
    name: column.name,
    meaning: column.meaning,
    counts: (balances.get(column.stored) ?? []).sort((a, b) => (a.value ?? Infinity) - (b.value ?? Infinity)),
  }));

  const auditRow = audit[0];
  const exitBarAudit: ExitBarAudit | null = auditRow
    ? {
        resolvedRows: Number(auditRow.resolved_rows ?? 0),
        exitNotAfterEntry: Number(auditRow.exit_not_after_entry ?? 0),
        minimumBarsToExit: numberOrNull(auditRow.minimum_bars_to_exit),
        maximumBarsToExit: numberOrNull(auditRow.maximum_bars_to_exit),
        unresolvedRows: Number(auditRow.unresolved_rows ?? 0),
      }
    : null;

  return {
    datasetRows: Number(counts[0]?.label_rows ?? 0),
    barRows: Number(barCount?.bar_rows ?? 0),
    joinedRows: alignment.joinedRows,
    firstTimestamp: numberOrNull(counts[0]?.first_timestamp),
    lastTimestamp: numberOrNull(counts[0]?.last_timestamp),
    classBalance,
    profiles: profilesFrom(summaries, histogramRows, ranges),
    alignmentChecks: alignment.checks,
    negativeControl: alignment.control,
    exitBarAudit,
  };
}

const handler: StudyHandler<typeof querySchema, LabelOverlayBody> = {
  slug: "label-overlay",
  datasets: [LABELS_VIEW, BARS_VIEW],
  query: querySchema,
  cacheSeconds: 3600,
  timeoutMs: 300_000,
  async run(query, context) {
    if (query.section === "dataset") return { section: "dataset", dataset: await runDataset(query, context) };
    return { section: "window", window: await runWindow(query, context) };
  },
};

export default handler;
