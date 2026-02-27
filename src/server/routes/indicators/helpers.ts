import * as path from "path";
import * as fs from "fs";

// ============================================================================
// SHARED CONSTANTS & TYPES
// ============================================================================

export const DATA_DIR = path.join(process.cwd(), "data");
export const ASSET_CLASSES = ["futures", "forex"] as const;

/** Resolve the indicator directory for a symbol by scanning asset class folders. */
export function resolveSymbolDir(symbol: string): string | null {
  for (const ac of ASSET_CLASSES) {
    const dir = path.join(DATA_DIR, ac, symbol);
    if (fs.existsSync(dir)) return dir;
  }
  return null;
}


export interface CategoryMeta {
  columns: string[];
  column_count: number;
  file_size_bytes: number;
  file_size_mb: number;
}

export interface IndicatorMeta {
  version: number;
  computed_at: string;
  symbol: string;
  timeframe: string;
  row_count: number;
  total_columns: number;
  categories: Record<string, CategoryMeta>;
}

// ============================================================================
// CACHES (cleared on server restart or compute-batch completion)
// ============================================================================

export let cachedCatalog: { categories: Record<string, string[]>; total: number; columns: string[] } | null = null;
export function clearCachedCatalog() { cachedCatalog = null; }
export function setCachedCatalog(val: typeof cachedCatalog) { cachedCatalog = val; }

export const metaCache = new Map<string, IndicatorMeta | null>();

// ============================================================================
// PARTITIONED DIRECTORY HELPERS (v2 format)
// ============================================================================

export function getPartitionedDir(symbol: string, timeframe: string): string {
  const symDir = resolveSymbolDir(symbol);
  if (symDir) return path.join(symDir, timeframe);
  // Fallback: assume futures
  return path.join(DATA_DIR, "futures", symbol, timeframe);
}

export function readMeta(symbol: string, timeframe: string): IndicatorMeta | null {
  const cacheKey = `${timeframe}/${symbol}`;
  if (metaCache.has(cacheKey)) return metaCache.get(cacheKey)!;

  const metaPath = path.join(getPartitionedDir(symbol, timeframe), "_meta.json");
  if (!fs.existsSync(metaPath)) {
    metaCache.set(cacheKey, null);
    return null;
  }

  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8")) as IndicatorMeta;
    metaCache.set(cacheKey, meta);
    return meta;
  } catch {
    metaCache.set(cacheKey, null);
    return null;
  }
}

/** Find which category files contain the requested columns. */
export function findColumnsInCategories(
  meta: IndicatorMeta,
  columns: string[],
): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const col of columns) {
    for (const [cat, catMeta] of Object.entries(meta.categories)) {
      if (catMeta.columns.includes(col)) {
        if (!result.has(cat)) result.set(cat, []);
        result.get(cat)!.push(col);
        break;
      }
    }
  }
  return result;
}

/** Build a SQL query that JOINs multiple category parquet files via read_parquet(). */
export function buildPartitionedQuery(
  partDir: string,
  categoryColMap: Map<string, string[]>,
  limit: number,
): string {
  const entries = Array.from(categoryColMap.entries());
  if (entries.length === 0) return "";

  const firstEntry = entries[0]!;
  const [firstCat, firstCols] = firstEntry;
  const firstPath = path.join(partDir, `${firstCat}.parquet`).replace(/\\/g, "/");

  let selectCols = `t0."timestamp"`;
  for (const c of firstCols) selectCols += `, t0."${c}"`;
  for (let i = 1; i < entries.length; i++) {
    for (const c of entries[i]![1]) selectCols += `, t${i}."${c}"`;
  }

  let sql = `SELECT ${selectCols}\nFROM read_parquet('${firstPath}') t0`;
  for (let i = 1; i < entries.length; i++) {
    const catPath = path.join(partDir, `${entries[i]![0]}.parquet`).replace(/\\/g, "/");
    sql += `\nJOIN read_parquet('${catPath}') t${i} ON t0."timestamp" = t${i}."timestamp"`;
  }
  sql += `\nORDER BY t0."timestamp" DESC\nLIMIT ${limit}`;
  return sql;
}

/** Find any _meta.json in the data/{futures|forex}/{symbol}/{tf}/ tree. */
export function findSampleMeta(): IndicatorMeta | null {
  for (const ac of ASSET_CLASSES) {
    const acDir = path.join(DATA_DIR, ac);
    if (!fs.existsSync(acDir)) continue;
    for (const sym of fs.readdirSync(acDir)) {
      const symDir = path.join(acDir, sym);
      if (!fs.statSync(symDir).isDirectory()) continue;
      for (const tf of fs.readdirSync(symDir)) {
        const metaPath = path.join(symDir, tf, "_meta.json");
        if (fs.existsSync(metaPath)) {
          try {
            return JSON.parse(fs.readFileSync(metaPath, "utf-8")) as IndicatorMeta;
          } catch { continue; }
        }
      }
    }
  }
  return null;
}
