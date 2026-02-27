/**
 * Pre-computed indicator business logic.
 *
 * Handles catalog generation, indicator data retrieval, and candle-pattern
 * extraction from category-partitioned parquets in data/{futures|forex}/{symbol}/{tf}/.
 * Route handlers delegate here — no HTTP concerns live in this module.
 */

import * as path from "path";
import * as fs from "fs";
import { questdbHttpQuery } from "../../questdb/httpQuery";
import {
  DATA_DIR,
  ASSET_CLASSES,
  resolveSymbolDir,
  cachedCatalog,
  setCachedCatalog,
  readMeta,
  getPartitionedDir,
  findColumnsInCategories,
  buildPartitionedQuery,
  findSampleMeta,
} from "../../routes/indicators/helpers";

// ============================================================================
// CONSTANTS
// ============================================================================

/** Category-to-prefix map used by the v1 flat-file classifier. */
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

const OHLCV_COLS = new Set(["timestamp", "open", "high", "low", "close", "volume"]);

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

  // Remove empty categories
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

  const sampleMeta = findSampleMeta();
  if (!sampleMeta) {
    return { categories: {}, total: 0, columns: [] };
  }

  const categories: Record<string, string[]> = {};
  const allColumns: string[] = [];
  for (const [cat, catMeta] of Object.entries(sampleMeta.categories)) {
    categories[cat] = catMeta.columns;
    allColumns.push(...catMeta.columns);
  }
  for (const key of Object.keys(categories)) {
    if (categories[key]?.length === 0) delete categories[key];
  }
  const result: CatalogResult = { categories, total: allColumns.length, columns: allColumns };
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
 * Load pre-computed indicator data for a symbol.
 * Returns `{ data: ... }` on success or `{ notFound: ... }` when the
 * requested symbol/timeframe/columns do not exist.
 */
export async function getIndicatorData(
  symbol: string,
  timeframe: string,
  columns?: string,
  limit: number = 2000,
): Promise<{ data: IndicatorDataResult } | { notFound: IndicatorDataNotFound }> {
  const meta = readMeta(symbol, timeframe);
  if (!meta) {
    const available = listAvailableIndicators(symbol);
    return {
      notFound: {
        error: `No pre-computed indicators for ${symbol} at ${timeframe}`,
        available,
      },
    };
  }

  const partDir = getPartitionedDir(symbol, timeframe);

  if (columns) {
    const requestedCols = columns.split(",").map(c => c.trim()).filter(c => /^[a-zA-Z0-9_.]+$/.test(c));
    const categoryColMap = findColumnsInCategories(meta, requestedCols);

    if (categoryColMap.size === 0) {
      return {
        notFound: {
          error: `None of the requested columns found in ${symbol}/${timeframe}`,
          available_categories: Object.keys(meta.categories),
        },
      };
    }

    const sql = buildPartitionedQuery(partDir, categoryColMap, limit);
    const raw = await questdbHttpQuery(sql);
    raw.reverse();
    const serialized = serializeBigInts(raw);
    return { data: { symbol, timeframe, count: serialized.length, data: serialized } };
  }

  // All columns -- join all category files
  const allColMap = new Map<string, string[]>();
  for (const [cat, catMeta] of Object.entries(meta.categories)) {
    allColMap.set(cat, catMeta.columns);
  }

  const sql = buildPartitionedQuery(partDir, allColMap, limit);
  const raw = await questdbHttpQuery(sql);
  raw.reverse();
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
  const meta = readMeta(symbol, timeframe);
  if (!meta || !meta.categories.candle) {
    return { notFound: { error: `No pre-computed data for ${symbol} at ${timeframe}` } };
  }

  const candlePath = path.join(
    getPartitionedDir(symbol, timeframe), "candle.parquet",
  ).replace(/\\/g, "/");
  const patternCols = meta.categories.candle.columns;

  if (patternCols.length === 0) {
    return { data: { symbol, timeframe, patterns: [], count: 0, data: [] } };
  }

  const selectCols = ["timestamp", ...patternCols].map(c => `"${c}"`).join(", ");
  const raw = await questdbHttpQuery(`
    SELECT ${selectCols}
    FROM read_parquet('${candlePath}')
    ORDER BY timestamp DESC
    LIMIT ${limit}
  `);
  raw.reverse();

  const activePatterns = extractActivePatterns(raw, patternCols);
  return {
    data: { symbol, timeframe, patterns: patternCols, count: activePatterns.length, data: activePatterns },
  };
}

/** List available indicator timeframes for a symbol. */
export function listAvailableIndicators(symbol: string): string[] {
  const available: string[] = [];
  const symDir = resolveSymbolDir(symbol);
  if (!symDir || !fs.existsSync(symDir)) return available;

  for (const tf of fs.readdirSync(symDir)) {
    const tfDir = path.join(symDir, tf);
    if (!fs.statSync(tfDir).isDirectory()) continue;
    if (fs.existsSync(path.join(tfDir, "_meta.json"))) {
      available.push(`${symbol}/${tf}`);
    }
  }

  return available;
}
