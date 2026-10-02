/**
 * How a lake column is bucketed to a chart timeframe, and the escaping every
 * interpolated name and value goes through. Shared by series.router.ts (the
 * chart's lake overlays) and regression.router.ts (the scatter tab), so a
 * column means the same thing on the chart and in a regression.
 *
 * The DuckDB client here takes SQL text, not bound parameters, so these two
 * escapers are the whole injection guard: identifiers only ever come from the
 * series catalog, and every one of them still goes through quote().
 */

import type { SeriesColumn } from "@shared/series/types";

/**
 * Seconds per chart timeframe. The chart only ever asks for one of these.
 *
 * A Map, not an object: `"constructor" in {}` is true, so an object lookup
 * accepted `timeframe=constructor` and then handed a FUNCTION to the interval
 * that is interpolated into SQL.
 */
export const TIMEFRAME_SECONDS = new Map<string, number>([
  ["1s", 1], ["5s", 5], ["15s", 15], ["30s", 30],
  ["1m", 60], ["5m", 300], ["15m", 900], ["30m", 1800],
  ["1h", 3600], ["2h", 7200], ["4h", 14400], ["1d", 86400], ["1w", 604800],
]);

/** The widest window a single request may scan, so one call cannot read a decade. */
export const MAX_WINDOW_SECONDS = 20 * 365 * 24 * 3600;

export function quote(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

export function literal(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * How a bucket collapses several rows into one value.
 *
 * Levels and states take the value at the end of the bucket, exactly as a
 * candle takes its close. Volume adds up. A flag is on if it was on anywhere
 * inside the bucket, because a flag that fired is a fact about the bucket.
 */
export function bucketExpression(column: SeriesColumn, timestampColumn: string): string {
  const name = quote(column.column);
  const ts = quote(timestampColumn);
  const numeric = column.duckdbType.toUpperCase() === "BOOLEAN" ? `CAST(${name} AS INTEGER)` : name;

  if (column.family === "volume" && column.valueShape === "positive_magnitude") {
    return `sum(${numeric})`;
  }
  if (column.valueShape === "binary") return `max(${numeric})`;
  return `arg_max(${numeric}, ${ts}) FILTER (WHERE ${name} IS NOT NULL)`;
}
