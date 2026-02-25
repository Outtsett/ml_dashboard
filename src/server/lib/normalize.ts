/**
 * Server-side OHLCV normalization utilities.
 *
 * Centralizes the timestamp / BigInt / type coercion that was previously
 * copy-pasted across charts.ts, databases.ts, indicators.ts, etc.
 */

import type { OHLCVBar, QuestDBOHLCVRow, DuckDBOHLCVRow } from "@shared/ohlcv";

// ─── Timestamp normalization ────────────────────────────────

/**
 * Coerce any timestamp representation into epoch-ms number.
 *
 * Handles:
 *  - Date objects (QuestDB pg driver)
 *  - ISO strings
 *  - Epoch-ms numbers
 *  - Epoch-seconds numbers (< 2×10¹⁰)
 *  - BigInt epoch-ms (DuckDB)
 */
export function normalizeTimestamp(ts: unknown): number {
  if (ts instanceof Date) return ts.getTime();
  if (typeof ts === "bigint") return Number(ts);
  if (typeof ts === "number") return ts < 2e10 ? ts * 1000 : ts;
  if (typeof ts === "string") {
    const n = Number(ts);
    if (!isNaN(n)) return n < 2e10 ? n * 1000 : n;
    const d = new Date(ts);
    return isNaN(d.getTime()) ? 0 : d.getTime();
  }
  return 0;
}

/**
 * Parse a user-supplied timestamp param (query string value).
 * Returns undefined if the value is falsy or unparseable.
 */
export function parseTimestampParam(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const n = Number(v);
  if (!isNaN(n)) return n < 2e10 ? n * 1000 : n;
  const d = new Date(v);
  return isNaN(d.getTime()) ? undefined : d.getTime();
}

// ─── Row normalization ──────────────────────────────────────

/**
 * Normalize a raw QuestDB OHLCV row → standard OHLCVBar.
 * Strips `symbol`, coerces Date timestamps, ensures Number types.
 */
export function normalizeQuestDBRow(row: QuestDBOHLCVRow): OHLCVBar {
  return {
    timestamp: normalizeTimestamp(row.timestamp),
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    volume: Number(row.volume),
  };
}

/**
 * Normalize a raw DuckDB OHLCV row → standard OHLCVBar.
 * Handles BigInt values from COUNT / SUM / epoch columns.
 */
export function normalizeDuckDBRow(row: DuckDBOHLCVRow): OHLCVBar {
  return {
    timestamp: typeof row.timestamp === "bigint" ? Number(row.timestamp) : row.timestamp,
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    volume: typeof row.volume === "bigint" ? Number(row.volume) : Number(row.volume),
  };
}

/**
 * Convert any DuckDB result row to plain JS (BigInt → Number).
 * Use when the row may contain arbitrary columns, not just OHLCV.
 */
export function coerceBigInts<T extends Record<string, unknown>>(row: T): T {
  const out = { ...row };
  for (const key of Object.keys(out)) {
    if (typeof out[key] === "bigint") {
      (out as Record<string, unknown>)[key] = Number(out[key]);
    }
  }
  return out;
}
