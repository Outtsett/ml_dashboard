/**
 * The body of GET /api/studies/timescaledb-load-monitor, shared by the handler
 * and the page, and the pure compute both read: load progress, the marginal
 * against the cumulative bytes per row, and the seconds-against-rows fit.
 *
 * The rows are the loader's measurement log (`timescaledb_load_batches`, one
 * per monthly INSERT commit), landed by
 * packages/ml-engine/src/studies/timescaledb_load_monitor/build.py. The notebook's live half
 * (PostgreSQL's planner row estimate and hypertable_size) needs a superuser
 * password and is not read here: the serving-copy state is the last logged
 * batch's cumulative row count and size.
 */

import { fitSimpleRegression } from "../regression/fit";
import type { RegressionFit } from "../regression/types";

export interface BatchRow {
  batch_number: number;
  recorded_at_epoch_milliseconds: number;
  month_start_epoch_milliseconds: number;
  asset_class: string;
  timeframe: string;
  lake_row_count: number;
  elapsed_seconds: number;
  rows_per_second: number;
  hypertable_bytes: number;
  hypertable_row_count: number;
  bytes_per_row: number;
  /** Bytes the batch added over the rows it added; null on the first batch of the log. */
  marginal_bytes_per_row: number | null;
}

export interface LoadMonitorBody {
  batches: BatchRow[];
  /** The notebook's constants by name (see the `load_facts` table), empty when not landed. */
  facts: Record<string, number>;
  recipe: string | null;
}

/** The numeric columns a panel can draw, with the notebook's full-word labels. */
export const PANEL_COLUMNS = [
  { key: "lake_row_count", label: "Rows in the month (from the lake)" },
  { key: "elapsed_seconds", label: "Elapsed seconds for the INSERT" },
  { key: "rows_per_second", label: "Rows inserted per second" },
  { key: "hypertable_bytes", label: "Hypertable size on disk (bytes)" },
  { key: "hypertable_row_count", label: "Total rows in the hypertable" },
  { key: "bytes_per_row", label: "Bytes per row, cumulative" },
] as const;

export type PanelColumn = (typeof PANEL_COLUMNS)[number]["key"];

/** The four columns the notebook summarises with the eight numbers. */
export const SUMMARY_COLUMNS: PanelColumn[] = ["lake_row_count", "elapsed_seconds", "rows_per_second", "bytes_per_row"];

/** Batches with `lower <= batch_number <= upper`. */
export function windowBatches(rows: readonly BatchRow[], lower: number, upper: number): BatchRow[] {
  return rows.filter((row) => row.batch_number >= lower && row.batch_number <= upper);
}

/**
 * Marginal bytes per row inside a window: (Δ bytes) / (Δ rows) between
 * consecutive batches of the window, so the window's first batch has none (the
 * notebook's `shift(1)` then `drop_nulls`).
 */
export function marginalWithinWindow(windowed: readonly BatchRow[]): Array<BatchRow & { marginal_bytes_per_row: number }> {
  const out: Array<BatchRow & { marginal_bytes_per_row: number }> = [];
  for (let index = 1; index < windowed.length; index += 1) {
    const previous = windowed[index - 1] as BatchRow;
    const current = windowed[index] as BatchRow;
    const rowsAdded = current.hypertable_row_count - previous.hypertable_row_count;
    if (rowsAdded === 0) continue;
    out.push({ ...current, marginal_bytes_per_row: (current.hypertable_bytes - previous.hypertable_bytes) / rowsAdded });
  }
  return out;
}

export interface Progress {
  servingRows: number;
  remainingRows: number;
  completePercent: number;
  bytesPerRow: number;
  servingBytes: number;
  measuredMonths: number;
  elapsedMinutes: number;
  meanRowsPerSecond: number;
  etaMinutes: number;
}

/**
 * The KPI strip. Completion and size come from the LAST logged batch's
 * cumulative hypertable row count and bytes (the notebook read them from
 * PostgreSQL); throughput comes from the log.
 */
export function loadProgress(rows: readonly BatchRow[], lakeTotalRows: number): Progress {
  const last = rows[rows.length - 1];
  const servingRows = last?.hypertable_row_count ?? 0;
  const servingBytes = last?.hypertable_bytes ?? 0;
  const remainingRows = Math.max(lakeTotalRows - servingRows, 0);
  const meanRowsPerSecond = rows.length > 0 ? rows.reduce((sum, row) => sum + row.rows_per_second, 0) / rows.length : 0;
  const elapsedMinutes = rows.reduce((sum, row) => sum + row.elapsed_seconds, 0) / 60;
  return {
    servingRows,
    remainingRows,
    completePercent: lakeTotalRows > 0 ? (servingRows / lakeTotalRows) * 100 : 0,
    bytesPerRow: servingRows > 0 ? servingBytes / servingRows : 0,
    servingBytes,
    measuredMonths: rows.length,
    elapsedMinutes,
    meanRowsPerSecond,
    etaMinutes: meanRowsPerSecond > 0 ? remainingRows / meanRowsPerSecond / 60 : 0,
  };
}

/** Full-table size in decimal gigabytes at a bytes-per-row density. */
export function projectedGigabytes(totalRows: number, bytesPerRow: number): number {
  return (totalRows * bytesPerRow) / 1e9;
}

/** Mean and sample standard deviation of a list, null when empty (n = 1 gives a null deviation). */
export function meanAndDeviation(values: readonly number[]): { mean: number | null; deviation: number | null; count: number } {
  const count = values.length;
  if (count === 0) return { mean: null, deviation: null, count };
  const mean = values.reduce((sum, value) => sum + value, 0) / count;
  if (count < 2) return { mean, deviation: null, count };
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (count - 1);
  return { mean, deviation: Math.sqrt(variance), count };
}

export interface ThroughputFit {
  fit: RegressionFit;
  /** Months whose elapsed seconds sit furthest above the fitted line, largest first. */
  slowest: Array<{ batch_number: number; month_start_epoch_milliseconds: number; lake_row_count: number; elapsed_seconds: number; fitted_seconds: number; residual_seconds: number }>;
}

/** Elapsed seconds on rows in the month by ordinary least squares (the shared regression module's fit), in batch order. */
export function throughputFit(windowed: readonly BatchRow[], slowestCount = 5): ThroughputFit | null {
  const result = fitSimpleRegression(
    windowed.map((row) => row.lake_row_count),
    windowed.map((row) => row.elapsed_seconds),
  );
  if (!result.ok) return null;
  const { fit } = result;
  const slowest = windowed
    .map((row, index) => ({
      batch_number: row.batch_number,
      month_start_epoch_milliseconds: row.month_start_epoch_milliseconds,
      lake_row_count: row.lake_row_count,
      elapsed_seconds: row.elapsed_seconds,
      fitted_seconds: fit.fitted[index] as number,
      residual_seconds: fit.residuals[index] as number,
    }))
    .sort((a, b) => b.residual_seconds - a.residual_seconds)
    .slice(0, slowestCount);
  return { fit, slowest };
}
