/**
 * Which lake columns can be an X variable against a symbol's price, and the
 * SQL that reads them on the chart's own buckets.
 *
 * Pure functions over the series catalog — regression.router.ts only does
 * HTTP around them, and tests/server/regressionQuery.test.ts exercises them
 * without a database.
 */

import type { SeriesColumn, SeriesObject } from "../../shared/series/types";
import type { RegressionVariable } from "../../shared/regression/types";
import { TIMEFRAME_SECONDS, literal, quote } from "./bucketing";

/**
 * A catalog's `symbols` list is capped when an object carries hundreds of
 * symbols, so absence from a list this long does not mean absence from the
 * table.
 */
const SYMBOL_LIST_CAP = 500;

/** These are the chart's own bars — already the Y axis, or the derived volume variable. */
const BAR_COLUMNS = new Set(["open", "high", "low", "close", "volume"]);

/** Shapes a straight line through a scatter cannot mean anything for. */
const NON_NUMERIC_SHAPES = new Set(["timestamp", "text", "categorical"]);

export type ExclusionReason =
  | "not offered by the catalog"
  | "event table, not one row per bar"
  | "no rows for this symbol"
  | "coarser than the chart timeframe"
  | "not numeric"
  | "the chart's own bars";

export interface Eligibility {
  variables: RegressionVariable[];
  excludedReasons: Partial<Record<ExclusionReason, number>>;
  excludedCount: number;
}

export function coversSymbol(object: SeriesObject, symbol: string): boolean {
  if (!object.symbolColumn) return false;
  if (object.symbols.includes(symbol)) return true;
  return object.symbols.length >= SYMBOL_LIST_CAP;
}

function exclusionFor(
  object: SeriesObject,
  column: SeriesColumn,
  symbol: string,
  timeframeSeconds: number,
): ExclusionReason | null {
  if (column.unavailableReason) return "not offered by the catalog";
  if (object.grain !== "per_bar") return "event table, not one row per bar";
  if (!coversSymbol(object, symbol)) return "no rows for this symbol";
  const objectSeconds = object.timeframe ? TIMEFRAME_SECONDS.get(object.timeframe) : undefined;
  if (objectSeconds === undefined || objectSeconds > timeframeSeconds) return "coarser than the chart timeframe";
  if (NON_NUMERIC_SHAPES.has(column.valueShape)) return "not numeric";
  if (BAR_COLUMNS.has(column.column.toLowerCase())) return "the chart's own bars";
  return null;
}

function isSummed(column: SeriesColumn): boolean {
  return column.family === "volume" && column.valueShape === "positive_magnitude";
}

/**
 * How a chart bar takes its value from a finer table, for a regression.
 *
 * Differs from the chart overlay's bucketExpression on flags: the overlay
 * marks a bar where a flag fired anywhere inside it, which is right for an
 * event marker and wrong for a per-bar state. "Closed above its open" taken
 * as max over the minutes of an hour is 1 for every hour, so the panel had a
 * constant X. Here every non-volume column is the value on the last row in
 * the bar — the reading at the bar's close — and volume is the bar's total.
 */
export function regressionBucketExpression(column: SeriesColumn, timestampColumn: string): string {
  const name = quote(column.column);
  const numeric = column.duckdbType.toUpperCase() === "BOOLEAN" ? `CAST(${name} AS INTEGER)` : name;
  if (isSummed(column)) return `sum(${numeric})`;
  return `arg_max(${numeric}, ${quote(timestampColumn)}) FILTER (WHERE ${name} IS NOT NULL)`;
}

function timeframeLabel(seconds: number): string {
  for (const [label, value] of TIMEFRAME_SECONDS) if (value === seconds) return label;
  return `${seconds}s`;
}

export function eligibleVariables(
  objects: ReadonlyArray<SeriesObject>,
  symbol: string,
  timeframeSeconds: number,
): Eligibility {
  const variables: RegressionVariable[] = [];
  const excludedReasons: Partial<Record<ExclusionReason, number>> = {};
  let excludedCount = 0;
  for (const object of objects) {
    for (const column of object.columns) {
      const reason = exclusionFor(object, column, symbol, timeframeSeconds);
      if (reason) {
        excludedReasons[reason] = (excludedReasons[reason] ?? 0) + 1;
        excludedCount += 1;
        continue;
      }
      const objectSeconds = TIMEFRAME_SECONDS.get(object.timeframe as string) as number;
      const finer = objectSeconds < timeframeSeconds;
      const chartLabel = timeframeLabel(timeframeSeconds);
      const bucketing = !finer ? "exact" : isSummed(column) ? "summed" : "last";
      variables.push({
        id: column.id,
        object: object.object,
        column: column.column,
        label: column.label,
        family: column.family,
        valueShape: column.valueShape,
        forwardLooking: column.forwardLooking,
        priceLevel: column.valueShape === "price_level",
        objectTimeframe: object.timeframe,
        nullFraction: column.nullFraction,
        bucketing,
        bucketingNote:
          bucketing === "exact"
            ? null
            : bucketing === "summed"
              ? `summed over each ${chartLabel} bar`
              : `last ${object.timeframe} value in each ${chartLabel} bar`,
      });
    }
  }
  return { variables, excludedReasons, excludedCount };
}

export interface ObjectWindow {
  symbol: string;
  timeframeSeconds: number;
  fromSeconds: number;
  toSeconds: number;
  maxRows: number;
}

/**
 * One scan per object: every requested column of that object bucketed to the
 * chart timeframe with regressionBucketExpression, newest
 * `maxRows` buckets. Returns null when the object holds nothing in the window.
 *
 * Output columns: bucket_seconds, then c0..c{k-1} in the order of `columns`.
 */
export function objectColumnsSql(
  object: SeriesObject,
  columns: ReadonlyArray<SeriesColumn>,
  window: ObjectWindow,
): string | null {
  // No clamp to the catalog's first/last timestamps: build_series_catalog.py
  // measures those on its row SAMPLE (the newest 50,000 rows), not the table,
  // so clamping to them cut every lake column off before the sample began.
  // The window is already bounded by the bars being regressed.
  const { fromSeconds, toSeconds } = window;
  if (toSeconds <= fromSeconds || !object.symbolColumn) return null;

  const ts = quote(object.timestampColumn);
  const seconds = Math.floor(window.timeframeSeconds);
  const values = columns
    .map((column, index) => `CAST(${regressionBucketExpression(column, object.timestampColumn)} AS DOUBLE) AS ${quote(`c${index}`)}`)
    .join(", ");
  return (
    `SELECT epoch(time_bucket(INTERVAL '${seconds} seconds', ${ts}))::BIGINT AS bucket_seconds, ${values} ` +
    `FROM ${quote(object.object)} ` +
    `WHERE ${ts} >= to_timestamp(${Math.floor(fromSeconds)}) AND ${ts} < to_timestamp(${Math.ceil(toSeconds)}) ` +
    `AND ${quote(object.symbolColumn)} = ${literal(window.symbol)} ` +
    `GROUP BY 1 ORDER BY 1 DESC LIMIT ${Math.floor(window.maxRows)}`
  );
}
