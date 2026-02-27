/**
 * Pre-computed indicator business logic.
 *
 * Handles catalog generation, indicator data retrieval, and candle-pattern
 * extraction from QuestDB indicator tables (indicators_5m through indicators_1w).
 * Route handlers delegate here — no HTTP concerns live in this module.
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

// ============================================================================
// CONSTANTS
// ============================================================================

/** Category-to-prefix map used by the column classifier. */
export const CATEGORY_PREFIXES: readonly [string, string[]][] = [
  ["candle", ["CDL_"]],
  ["trend", ["ADX", "DMP_", "DMN_", "AROON", "CHOP_", "CKSP_", "DPO_", "PSAR", "QS_", "VTXP_", "VTXM_", "VHF_", "RWI_", "LDECAY_", "DEC_", "INC_", "ZIGZAG", "SMC_", "EXHC_", "CHDLREXT"]],
  ["volume", ["OBV", "ADOSC_", "AD", "CMF_", "EFI_", "EOM", "KVO_", "MFI_", "NVI_", "PVI_", "PVOL_", "PVR_", "PVT_", "VWAP_", "TSV_", "AOBV_", "VP_", "VHM_"]],
  ["volatility", ["ATR", "NATR_", "TRUERANGE", "ABER", "THERMO", "UI_", "PDIST_", "MASSI_", "HWU_", "HWM_", "HWL_", "TOS_", "BBW_", "KCW_", "RVI_"]],
  ["momentum", ["RSI_", "MACD", "STOCH", "CCI_", "WILLR_", "MOM_", "ROC_", "AO_", "APO_", "PPO_", "BIAS_", "BOP", "CFO_", "CG_", "CMO_", "COPC_", "CRSI_", "CTI_", "ER_", "FISHER", "INERTIA_", "KST_", "PGO_", "PSL_", "QQE", "RSX_", "RVGI_", "STC_", "TRIX_", "TSI_", "UO_", "SMI_", "TMO_", "SQZ", "K_", "D_", "J_"]],
  ["cycle", ["EBSW_", "REFLEX_"]],
  ["statistics", ["ENTP", "KURT", "MAD_", "MEDIAN_", "QTL_", "SKEW_", "STDEV_", "VAR_", "ZS_", "SLOPE_"]],
  ["performance", ["LOGRET_", "PCTRET_", "CUMLOGRET_", "CUMPCTRET_"]],
  ["overlap", ["SMA_", "EMA_", "WMA_", "DEMA_", "TEMA_", "T3_", "KAMA_", "FWMA_", "HMA_", "ALMA_", "LINREG_", "MIDPOINT_", "MIDPRICE_", "PWMA_", "RMA_", "SINWMA_", "SWMA_", "TRIMA_", "VIDYA_", "VWMA_", "HWMA_", "MCGD_", "SMMA_", "JMA_", "ZLMA_", "ZL_", "HT_", "HILO", "ISA_", "ISB_", "ITS_", "IKS_", "ICS_", "MAMA_", "FAMA_", "SSF", "BBL_", "BBM_", "BBU_", "BBB_", "BBP_", "KCL", "KCB", "KCU", "DCL_", "DCM_", "DCU_", "SUPERT", "ALPHAT", "AMAT", "ACCB"]],
];

// ============================================================================
// PURE HELPERS
// ============================================================================

/** Classify indicator column names into categories by prefix matching. */
export function classifyColumns(indicatorCols: string[]): Record<string, string[]> {
  const categories: Record<string, string[]> = {
    candle: [], trend: [], volume: [], volatility: [], momentum: [],
    cycle: [], statistics: [], performance: [], overlap: [], other: [],
  };

  for (const col of indicatorCols) {
    const upper = col.toUpperCase();
    let classified = false;
    for (const [cat, prefixes] of CATEGORY_PREFIXES) {
      if (prefixes.some(p => upper.startsWith(p))) {
        categories[cat]?.push(col);
        classified = true;
        break;
      }
    }
    if (!classified) categories.other?.push(col);
  }

  for (const key of Object.keys(categories)) {
    if (categories[key]?.length === 0) delete categories[key];
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

  // Use 1d table as reference — all timeframes have the same column set
  const columns = await getIndicatorColumns("1d");
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
 * requested symbol/timeframe/columns do not exist.
 */
export async function getIndicatorData(
  symbol: string,
  timeframe: string,
  columns?: string,
  limit: number = 2000,
): Promise<{ data: IndicatorDataResult } | { notFound: IndicatorDataNotFound }> {
  const table = getIndicatorTable(timeframe);
  if (!table) {
    const available = await listAvailableIndicators(symbol);
    return {
      notFound: {
        error: `No indicator table for timeframe ${timeframe}. Available: 5m, 15m, 30m, 1h, 4h, 1d, 1w`,
        available,
      },
    };
  }

  const allColumns = await getIndicatorColumns(timeframe);
  if (allColumns.length === 0) {
    return {
      notFound: {
        error: `Indicator table ${table} has no data. Run upload-indicators-questdb.py to populate.`,
      },
    };
  }

  let queryCols: string[];
  if (columns) {
    const requested = columns.split(",").map(c => sanitizeColumnName(c.trim())).filter(c => /^[a-zA-Z0-9_]+$/.test(c));
    // Filter to only columns that exist in the table
    const colSet = new Set(allColumns);
    queryCols = requested.filter(c => colSet.has(c));

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

/** Extract candle pattern data (CDL_* columns) for a symbol. */
export async function getPatternData(
  symbol: string,
  timeframe: string,
  limit: number = 2000,
): Promise<{ data: PatternDataResult } | { notFound: { error: string } }> {
  const table = getIndicatorTable(timeframe);
  if (!table) {
    return { notFound: { error: `No indicator table for timeframe ${timeframe}` } };
  }

  const allColumns = await getIndicatorColumns(timeframe);
  const patternCols = allColumns.filter(c => c.toUpperCase().startsWith("CDL_"));

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

/** List available indicator timeframes for a symbol by checking QuestDB tables. */
export async function listAvailableIndicators(symbol: string): Promise<string[]> {
  const available: string[] = [];
  const timeframes = ["5m", "15m", "30m", "1h", "4h", "1d", "1w"];
  const safeSymbol = symbol.replace(/'/g, "''");

  for (const tf of timeframes) {
    const table = getIndicatorTable(tf);
    if (!table) continue;

    try {
      const rows = await questdbHttpQuery<{ cnt: number }>(
        `SELECT count() as cnt FROM ${table} WHERE symbol = '${safeSymbol}' LIMIT 0, 1`
      );
      if (rows.length > 0 && rows[0]!.cnt > 0) {
        available.push(`${symbol}/${tf}`);
      }
    } catch {
      // Table might not exist yet
    }
  }

  return available;
}
