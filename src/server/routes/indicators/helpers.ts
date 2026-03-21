/**
 * Indicator helpers — QuestDB-backed indicator queries.
 *
 * All indicator data lives in the `talib_features` QuestDB table (153M rows).
 * Column names are lowercase in QuestDB and mapped to display names via
 * talibMapping.ts for the frontend.
 */

import { questdbHttpQuery } from "../../database/questdb/httpQuery";
import {
  TALIB_COLUMN_MAP,
  talibToDisplay,
  displayToTalib,
} from "../../lib/indicators/talibMapping";

// ============================================================================
// SHARED CONSTANTS & TYPES
// ============================================================================

/** The single QuestDB table holding all pre-computed TA-Lib indicators. */
const TALIB_TABLE = "talib_features";

/** Columns that are structural (not indicators). */
const STRUCTURAL_COLS = new Set(["timestamp", "symbol"]);

// ============================================================================
// CACHES
// ============================================================================

export let cachedCatalog: { categories: Record<string, string[]>; total: number; columns: string[] } | null = null;
export function clearCachedCatalog() { cachedCatalog = null; }
export function setCachedCatalog(val: typeof cachedCatalog) { cachedCatalog = val; }

/** Column cache — avoids repeated SHOW COLUMNS queries. */
let columnCache: { displayNames: string[]; cachedAt: number } | null = null;
const COLUMN_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export function clearColumnCache() {
  columnCache = null;
}

// ============================================================================
// QuestDB INDICATOR TABLE HELPERS
// ============================================================================

/**
 * Return the QuestDB table name for indicator queries.
 * Always returns 'talib_features' — timeframe param accepted for API compat
 * but ignored since the table is not timeframe-specific.
 */
export function getIndicatorTable(_timeframe?: string): string {
  return TALIB_TABLE;
}

/**
 * Sanitize column name to match QuestDB convention.
 * The upload script replaces . → _ and % → pct.
 */
export function sanitizeColumnName(name: string): string {
  return name.replace(/\./g, "_").replace(/%/g, "pct");
}

/**
 * Get all indicator display names from the talib_features table.
 * Queries QuestDB for actual columns, filters structural ones, and maps
 * each to its display name. Only columns present in TALIB_COLUMN_MAP are
 * returned — unknown columns are silently skipped.
 *
 * The _timeframe parameter is accepted for API compat but ignored.
 */
export async function getIndicatorColumns(_timeframe?: string): Promise<string[]> {
  if (columnCache && Date.now() - columnCache.cachedAt < COLUMN_CACHE_TTL_MS) {
    return columnCache.displayNames;
  }

  try {
    const rows = await questdbHttpQuery<{ column: string; type: string }>(
      `SHOW COLUMNS FROM ${TALIB_TABLE}`
    );

    const displayNames: string[] = [];
    for (const row of rows) {
      const col = row.column;
      if (STRUCTURAL_COLS.has(col)) continue;
      // Only include columns we have a mapping for
      if (col in TALIB_COLUMN_MAP) {
        displayNames.push(talibToDisplay(col));
      }
    }

    columnCache = { displayNames, cachedAt: Date.now() };
    return displayNames;
  } catch {
    return [];
  }
}

/**
 * Build a SELECT query against the talib_features table.
 * Accepts display-name columns, converts them to talib column names for
 * the SQL, and aliases them back to display names in the result set.
 *
 * Symbol and column names are sanitized to prevent SQL injection.
 */
export function buildIndicatorQuery(
  table: string,
  symbol: string,
  displayColumns: string[],
  limit: number,
  opts?: { startTime?: number; endTime?: number },
): string {
  const safeSymbol = symbol.replace(/'/g, "''");
  const safeLimit = Math.min(Math.max(1, Math.floor(limit)), 100000);

  // Build column select: "talib_col" AS "DisplayName" for each
  const colExprs: string[] = [];
  for (const display of displayColumns) {
    let talibCol: string;
    try {
      talibCol = displayToTalib(display);
    } catch {
      // If display name can't be mapped, try using it as-is (it may already
      // be a raw talib column name)
      talibCol = display;
    }
    const safeCol = talibCol.replace(/"/g, '""');
    const safeDisplay = display.replace(/"/g, '""');
    // If talib col and display name differ, alias; otherwise just quote
    if (talibCol !== display) {
      colExprs.push(`"${safeCol}" AS "${safeDisplay}"`);
    } else {
      colExprs.push(`"${safeCol}"`);
    }
  }

  // Build WHERE clause with optional time range filters
  const conditions = [`symbol = '${safeSymbol}'`];
  if (opts?.startTime) {
    // Convert ms epoch to ISO for QuestDB designated timestamp filter
    const startISO = new Date(opts.startTime).toISOString();
    conditions.push(`timestamp >= '${startISO}'`);
  }
  if (opts?.endTime) {
    const endISO = new Date(opts.endTime).toISOString();
    conditions.push(`timestamp <= '${endISO}'`);
  }

  const whereClause = conditions.join(' AND ');
  return `SELECT "timestamp", ${colExprs.join(", ")} FROM ${table} WHERE ${whereClause} ORDER BY timestamp DESC LIMIT ${safeLimit}`;
}
