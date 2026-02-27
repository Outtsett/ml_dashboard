/**
 * Realtime Indicator Calculator — business logic extracted from the indicators route.
 *
 * Responsibilities:
 *  - SQL identifier validation (injection prevention)
 *  - OHLCV bar loading from QuestDB
 *  - Bar deduplication and sorting
 *  - Indicator config resolution (preset or custom)
 *  - Indicator name list generation from config
 */

import type { OHLCVBar } from "@shared/ohlcv";

export type { OHLCVBar };

// ---------------------------------------------------------------------------
// SQL identifier validation
// ---------------------------------------------------------------------------

const SQL_IDENTIFIER_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export const ALLOWED_TABLE_NAMES = [
  "ohlcv",
  "base_data",
  "price_data",
] as const;

export const ALLOWED_COLUMN_NAMES = [
  "symbol",
  "timestamp",
  "open",
  "high",
  "low",
  "close",
  "volume",
  "time",
  "date",
] as const;

/**
 * Validate and sanitize a SQL identifier against an optional allow-list.
 * Throws if the value is empty, non-string, has disallowed characters,
 * or is not in the allow-list (when provided).
 */
export function validateSQLIdentifier(
  value: string,
  allowedList?: readonly string[]
): string {
  if (!value || typeof value !== "string") {
    throw new Error("Invalid SQL identifier");
  }
  const cleaned = value.trim().toLowerCase();
  if (!SQL_IDENTIFIER_PATTERN.test(cleaned)) {
    throw new Error(`Invalid SQL identifier format: ${value}`);
  }
  if (allowedList && !allowedList.includes(cleaned)) {
    throw new Error(`SQL identifier not in allowed list: ${value}`);
  }
  return cleaned;
}

/**
 * Sanitize SQL table/column identifiers from user input, with safe defaults.
 * Used by generate-sql and generate-bulk-sql routes.
 */
export function sanitizeSQLOptions(opts: {
  tableName?: string;
  symbolColumn?: string;
  timestampColumn?: string;
}): { tableName: string; symbolColumn: string; timestampColumn: string } {
  return {
    tableName: opts.tableName ? validateSQLIdentifier(opts.tableName, ALLOWED_TABLE_NAMES) : "ohlcv",
    symbolColumn: opts.symbolColumn ? validateSQLIdentifier(opts.symbolColumn, ALLOWED_COLUMN_NAMES) : "symbol",
    timestampColumn: opts.timestampColumn ? validateSQLIdentifier(opts.timestampColumn, ALLOWED_COLUMN_NAMES) : "timestamp",
  };
}

// ---------------------------------------------------------------------------
// Timeframe helpers
// ---------------------------------------------------------------------------

const VALID_TIMEFRAMES = [
  "1s",
  "1m",
  "5m",
  "15m",
  "30m",
  "1h",
  "4h",
  "1d",
] as const;

export type Timeframe = (typeof VALID_TIMEFRAMES)[number];

export function isValidTimeframe(tf: string): tf is Timeframe {
  return (VALID_TIMEFRAMES as readonly string[]).includes(tf);
}

// ---------------------------------------------------------------------------
// OHLCV bar loading
// ---------------------------------------------------------------------------

/** Normalize a raw QuestDB row into a typed OHLCVBar. */
function normalizeRow(r: any): OHLCVBar {
  return {
    timestamp:
      r.timestamp instanceof Date
        ? r.timestamp.getTime()
        : Number(r.timestamp),
    open: Number(r.open),
    high: Number(r.high),
    low: Number(r.low),
    close: Number(r.close),
    volume: Number(r.volume),
  };
}

/**
 * Load OHLCV bars for a symbol/timeframe from QuestDB.
 */
export async function loadOHLCVBars(
  symbol: string,
  timeframe: string,
  limit: number
): Promise<OHLCVBar[]> {
  const upperSymbol = symbol.toUpperCase();
  const effectiveLimit = Math.max(limit, 200);

  try {
    const { getOHLCVSampleBy } = await import("../../database/questdb");
    const qdbRows = await getOHLCVSampleBy(
      upperSymbol,
      timeframe,
      undefined,
      undefined,
      effectiveLimit
    );
    return qdbRows.map(normalizeRow);
  } catch {
    return [];
  }
}

/**
 * Load OHLCV bars from QuestDB with explicit health check.
 * Used by the /indicators/compute endpoint.
 */
export async function loadOHLCVBarsQuestDBOnly(
  symbol: string,
  timeframe: string,
  limit: number
): Promise<OHLCVBar[]> {
  try {
    const { checkQuestDBHealth, getOHLCVSampleBy } = await import(
      "../../database/questdb"
    );
    const healthy = await checkQuestDBHealth();
    if (healthy) {
      const qdbRows = await getOHLCVSampleBy(
        symbol,
        timeframe,
        undefined,
        undefined,
        limit
      );
      return qdbRows.map(normalizeRow);
    }
  } catch {
    // QuestDB unavailable
  }
  return [];
}

// ---------------------------------------------------------------------------
// Bar deduplication
// ---------------------------------------------------------------------------

/**
 * Sort bars ascending by timestamp and deduplicate, keeping the first
 * occurrence of each timestamp.
 */
export function deduplicateBars(bars: OHLCVBar[]): OHLCVBar[] {
  const sorted = [...bars].sort((a, b) => a.timestamp - b.timestamp);
  const seen = new Set<number>();
  return sorted.filter((bar) => {
    if (seen.has(bar.timestamp)) return false;
    seen.add(bar.timestamp);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Indicator config resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the indicator configuration from a preset name, an explicit config
 * object, or fall back to the `full` preset.
 */
export async function resolveIndicatorConfig(
  preset?: string,
  indicators?: any
): Promise<any> {
  const { INDICATOR_PRESETS } = await import("./indicatorService");

  if (preset && INDICATOR_PRESETS[preset as keyof typeof INDICATOR_PRESETS]) {
    return INDICATOR_PRESETS[preset as keyof typeof INDICATOR_PRESETS];
  }
  if (indicators) {
    return indicators;
  }
  return INDICATOR_PRESETS.full;
}

// ---------------------------------------------------------------------------
// Indicator name list builder
// ---------------------------------------------------------------------------

/**
 * Build a flat list of indicator column names from a config object.
 * Matches the naming convention used by `computeIndicatorsRealtime`.
 */
export function buildIndicatorNameList(config: any): string[] {
  const names: string[] = [];

  if (config.rsi) {
    config.rsi.forEach((p: number) => names.push(`rsi_${p}`));
  }
  if (config.macd) {
    config.macd.forEach((m: any) => {
      names.push(`macd_${m.fast}_${m.slow}_${m.signal}`);
      names.push(`macd_signal_${m.fast}_${m.slow}_${m.signal}`);
      names.push(`macd_hist_${m.fast}_${m.slow}_${m.signal}`);
    });
  }
  if (config.bollinger) {
    config.bollinger.forEach((b: any) => {
      names.push(
        `bb_upper_${b.period}`,
        `bb_middle_${b.period}`,
        `bb_lower_${b.period}`,
        `bb_pct_b_${b.period}`
      );
    });
  }
  if (config.atr) {
    config.atr.forEach((p: number) => names.push(`atr_${p}`));
  }
  if (config.stochastic) {
    config.stochastic.forEach((s: any) => {
      names.push(`stoch_k_${s.k}`, `stoch_d_${s.k}_${s.d}`);
    });
  }
  if (config.cci) {
    config.cci.forEach((p: number) => names.push(`cci_${p}`));
  }
  if (config.williamsR) {
    config.williamsR.forEach((p: number) => names.push(`williams_r_${p}`));
  }
  if (config.sma) {
    config.sma.forEach((p: number) => names.push(`sma_${p}`));
  }
  if (config.ema) {
    config.ema.forEach((p: number) => names.push(`ema_${p}`));
  }
  if (config.roc) {
    config.roc.forEach((p: number) => names.push(`roc_${p}`));
  }
  if (config.momentum) {
    config.momentum.forEach((p: number) => names.push(`momentum_${p}`));
  }

  return names;
}
