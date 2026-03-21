/**
 * Pre-computed indicator business logic.
 *
 * Handles catalog generation, indicator data retrieval, and candle-pattern
 * extraction from the QuestDB `talib_features` table (153M rows).
 * Route handlers delegate here — no HTTP concerns live in this module.
 *
 * Column names are mapped bidirectionally:
 *   QuestDB (lowercase) ↔ display names (uppercase with params)
 * via talibMapping.ts.
 */

import { questdbHttpQuery } from "../../database/questdb/httpQuery";
import {
  cachedCatalog,
  setCachedCatalog,
  getIndicatorTable,
  getIndicatorColumns,
  sanitizeColumnName,
  buildIndicatorQuery,
} from "../../routes/indicators/helpers";
import {
  TALIB_CATEGORIES,
  TALIB_DISPLAY_MAP,
} from "./talibMapping";

// ============================================================================
// PURE HELPERS
// ============================================================================

/**
 * Classify indicator display names into categories using the TALIB_CATEGORIES
 * map from talibMapping.ts. Falls back to prefix matching for any display name
 * not found in the map.
 */
export function classifyColumns(displayCols: string[]): Record<string, string[]> {
  const categories: Record<string, string[]> = {};

  for (const col of displayCols) {
    const cat = TALIB_CATEGORIES[col];
    if (cat) {
      if (!categories[cat]) categories[cat] = [];
      categories[cat]!.push(col);
    } else {
      // Fallback: if not in the map, put in 'other'
      if (!categories.other) categories.other = [];
      categories.other!.push(col);
    }
  }

  return categories;
}

/** Convert BigInt values to Number for JSON serialization. */
export function serializeBigInts(data: Record<string, unknown>[]): Record<string, unknown>[] {
  return data.map(row => {
    const converted: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(row)) {
      converted[key] = typeof val === "bigint" ? Number(val) : val;
    }
    return converted;
  });
}

/** Filter rows to only those with at least one non-zero pattern value. */
export function extractActivePatterns(
  data: Record<string, unknown>[],
  patternCols: string[],
): Record<string, unknown>[] {
  return data
    .map(row => {
      const active: Record<string, number> = {};
      let hasPattern = false;
      for (const col of patternCols) {
        const val = Number(row[col]);
        if (val !== 0) {
          active[col] = val;
          hasPattern = true;
        }
      }
      if (hasPattern) {
        return {
          timestamp: typeof row.timestamp === "bigint" ? Number(row.timestamp) : row.timestamp,
          ...active,
        };
      }
      return null;
    })
    .filter(Boolean) as Record<string, unknown>[];
}

// ============================================================================
// SERVICE FUNCTIONS
// ============================================================================

export interface CatalogResult {
  categories: Record<string, string[]>;
  total: number;
  columns: string[];
}

/** Build or return cached catalog of all pre-computed indicator columns. */
export async function getCatalog(): Promise<CatalogResult> {
  if (cachedCatalog) return cachedCatalog;

  const columns = await getIndicatorColumns();
  if (columns.length === 0) {
    return { categories: {}, total: 0, columns: [] };
  }

  const categories = classifyColumns(columns);
  const result: CatalogResult = { categories, total: columns.length, columns };
  setCachedCatalog(result);
  return result;
}

export interface IndicatorDataResult {
  symbol: string;
  timeframe: string;
  count: number;
  data: Record<string, unknown>[];
}

export interface IndicatorDataNotFound {
  error: string;
  available?: string[];
  available_categories?: string[];
}

/**
 * Load pre-computed indicator data for a symbol from QuestDB.
 * Returns `{ data: ... }` on success or `{ notFound: ... }` when the
 * requested symbol/columns do not exist.
 *
 * The timeframe parameter is accepted for API compatibility but has no
 * effect on which table is queried — all data comes from talib_features.
 */
export async function getIndicatorData(
  symbol: string,
  timeframe: string,
  columns?: string,
  limit: number = 2000,
): Promise<{ data: IndicatorDataResult } | { notFound: IndicatorDataNotFound }> {
  const table = getIndicatorTable(timeframe);

  const allColumns = await getIndicatorColumns();
  if (allColumns.length === 0) {
    return {
      notFound: {
        error: `Indicator table ${table} has no data or no mapped columns.`,
      },
    };
  }

  let queryCols: string[];
  if (columns) {
    const requested = columns
      .split(",")
      .map(c => sanitizeColumnName(c.trim()))
      .filter(c => /^[a-zA-Z0-9_]+$/.test(c));

    // The caller may pass either display names (e.g. RSI_14) or talib column
    // names (e.g. rsi). Normalise everything to display names so
    // buildIndicatorQuery can produce the right SQL aliases.
    const colSet = new Set(allColumns);
    queryCols = [];
    for (const req of requested) {
      if (colSet.has(req)) {
        // Already a valid display name
        queryCols.push(req);
      } else if (TALIB_DISPLAY_MAP[req]) {
        // It's a display name that exists in the reverse map — but check
        // that the underlying talib col is in the available set via its
        // display counterpart. Since allColumns are display names and we
        // already checked, this shouldn't match, but guard anyway.
        queryCols.push(req);
      } else {
        // Maybe it's a raw talib column name — look up its display name
        // and check if that display name is in our available set.
        const upperReq = req.toUpperCase();
        const matchedDisplay = allColumns.find(d => d === upperReq || d === req);
        if (matchedDisplay) {
          queryCols.push(matchedDisplay);
        }
        // else: skip unknown column
      }
    }

    if (queryCols.length === 0) {
      const categories = classifyColumns(allColumns);
      return {
        notFound: {
          error: `None of the requested columns found in ${table}`,
          available_categories: Object.keys(categories),
        },
      };
    }
  } else {
    queryCols = allColumns;
  }

  const sql = buildIndicatorQuery(table, symbol, queryCols, limit);
  const raw = await questdbHttpQuery(sql);
  raw.reverse(); // QuestDB returns DESC, we want ASC
  const serialized = serializeBigInts(raw);
  return { data: { symbol, timeframe, count: serialized.length, data: serialized } };
}

export interface PatternDataResult {
  symbol: string;
  timeframe: string;
  patterns: string[];
  count: number;
  data: Record<string, unknown>[];
}

/** Extract candle pattern data (CDL_* display-name columns) for a symbol. */
export async function getPatternData(
  symbol: string,
  timeframe: string,
  limit: number = 2000,
): Promise<{ data: PatternDataResult } | { notFound: { error: string } }> {
  const table = getIndicatorTable(timeframe);

  const allColumns = await getIndicatorColumns();
  const patternCols = allColumns.filter(c => c.startsWith("CDL_"));

  if (patternCols.length === 0) {
    return { notFound: { error: `No candle pattern columns in ${table}` } };
  }

  const sql = buildIndicatorQuery(table, symbol, patternCols, limit);
  const raw = await questdbHttpQuery(sql);
  raw.reverse();

  const activePatterns = extractActivePatterns(raw, patternCols);
  return {
    data: { symbol, timeframe, patterns: patternCols, count: activePatterns.length, data: activePatterns },
  };
}

/** Check whether a symbol has data in talib_features. */
export async function listAvailableIndicators(symbol: string): Promise<string[]> {
  const safeSymbol = symbol.replace(/'/g, "''");
  const table = getIndicatorTable();

  try {
    const rows = await questdbHttpQuery<{ cnt: number }>(
      `SELECT count() as cnt FROM ${table} WHERE symbol = '${safeSymbol}' LIMIT 0, 1`
    );
    if (rows.length > 0 && rows[0]!.cnt > 0) {
      return [`${symbol}/talib_features`];
    }
  } catch {
    // Table might not exist yet
  }

  return [];
}
