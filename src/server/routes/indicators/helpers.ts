/**
 * Indicator helpers — QuestDB-backed indicator table queries.
 *
 * All indicator data lives in per-timeframe QuestDB tables:
 *   indicators_5m, indicators_15m, indicators_30m,
 *   indicators_1h, indicators_4h, indicators_1d, indicators_1w
 *
 * Tables created by scripts/upload-indicators-questdb.py.
 */

import { questdbHttpQuery } from "../../database/questdb/httpQuery";

// ============================================================================
// SHARED CONSTANTS & TYPES
// ============================================================================

/** Valid indicator timeframes (1m excluded — too expensive to pre-compute). */
const INDICATOR_TIMEFRAMES = new Set(["5m", "15m", "30m", "1h", "4h", "1d", "1w"]);

/** Columns that are structural (not indicators). */
const STRUCTURAL_COLS = new Set([
  "timestamp", "symbol", "asset_class", "open", "high", "low", "close", "volume",
]);

// ============================================================================
// CACHES
// ============================================================================

export let cachedCatalog: { categories: Record<string, string[]>; total: number; columns: string[] } | null = null;
export function clearCachedCatalog() { cachedCatalog = null; }
export function setCachedCatalog(val: typeof cachedCatalog) { cachedCatalog = val; }

/** Column cache per timeframe — avoids repeated SHOW COLUMNS queries. */
const columnCache = new Map<string, { columns: string[]; cachedAt: number }>();
const COLUMN_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export function clearColumnCache() {
  columnCache.clear();
}

// ============================================================================
// QuestDB INDICATOR TABLE HELPERS
// ============================================================================

/** Map timeframe string to QuestDB indicator table name. Returns null for unsupported timeframes. */
export function getIndicatorTable(timeframe: string): string | null {
  if (INDICATOR_TIMEFRAMES.has(timeframe)) {
    return `indicators_${timeframe}`;
  }
  return null;
}

/**
 * Sanitize column name to match QuestDB convention.
 * The upload script replaces . → _ and % → pct.
 */
export function sanitizeColumnName(name: string): string {
  return name.replace(/\./g, "_").replace(/%/g, "pct");
}

/**
 * Get all indicator column names for a timeframe.
 * Excludes structural columns (timestamp, symbol, OHLCV, asset_class).
 */
export async function getIndicatorColumns(timeframe: string): Promise<string[]> {
  const table = getIndicatorTable(timeframe);
  if (!table) return [];

  const cacheKey = timeframe;
  const cached = columnCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < COLUMN_CACHE_TTL_MS) {
    return cached.columns;
  }

  try {
    const rows = await questdbHttpQuery<{ column: string; type: string }>(
      `SHOW COLUMNS FROM ${table}`
    );
    const columns = rows
      .map(r => r.column)
      .filter(c => !STRUCTURAL_COLS.has(c));

    columnCache.set(cacheKey, { columns, cachedAt: Date.now() });
    return columns;
  } catch {
    return [];
  }
}

/**
 * Build a SELECT query against a QuestDB indicator table.
 * Symbol and column names are sanitized to prevent SQL injection.
 */
export function buildIndicatorQuery(
  table: string,
  symbol: string,
  columns: string[],
  limit: number,
): string {
  // Escape single quotes in symbol to prevent SQL injection
  const safeSymbol = symbol.replace(/'/g, "''");
  // Escape double quotes in column names to prevent breakout
  const quotedCols = columns.map(c => `"${c.replace(/"/g, '""')}"`).join(", ");
  const safeLimit = Math.min(Math.max(1, Math.floor(limit)), 100000);
  return `SELECT "timestamp", ${quotedCols} FROM ${table} WHERE symbol = '${safeSymbol}' ORDER BY timestamp DESC LIMIT ${safeLimit}`;
}
