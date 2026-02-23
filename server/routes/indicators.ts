import { Router, Request, Response } from "express";
import { spawn, ChildProcess } from "child_process";
import { storage } from "../storage";
import { runQuery } from "../duckdb";
import { mlRateLimiter } from "../lib/rateLimiter";
import { getString } from "./helpers";
import * as path from "path";
import * as fs from "fs";

const router = Router();

// Allowed SQL identifier pattern (table names, column names)
const SQL_IDENTIFIER_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const ALLOWED_TABLE_NAMES = ['ohlcv', 'base_data', 'price_data'];
const ALLOWED_COLUMN_NAMES = ['symbol', 'timestamp', 'open', 'high', 'low', 'close', 'volume', 'time', 'date'];

function validateSQLIdentifier(value: string, allowedList?: string[]): string {
  if (!value || typeof value !== 'string') {
    throw new Error('Invalid SQL identifier');
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

// ============================================================================
// TECHNICAL INDICATOR ROUTES
// ============================================================================

// List all available indicators
router.get("/indicators/list", async (req: Request, res: Response) => {
  try {
    const { listIndicators, getIndicatorsByCategory } = await import("../lib/indicators");
    const category = req.query.category as string | undefined;

    if (category && ['trend', 'momentum', 'volatility', 'volume', 'overlap'].includes(category)) {
      const indicators = getIndicatorsByCategory(category as any);
      res.json({ indicators });
    } else {
      const indicators = listIndicators();
      res.json({ indicators });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to list indicators" });
  }
});

// NOTE: Specific /indicators/* routes (catalog, data, patterns) are at the bottom.
// This :id route must call next() for those paths so Express continues matching.
router.get("/indicators/:id", async (req: Request, res: Response, next) => {
  const id = String(req.params.id);
  if (['catalog', 'data', 'patterns', 'presets'].includes(id)) return next();
  try {
    const { getIndicator } = await import("../lib/indicators");
    const indicatorId = getString(req.params.id);
    const indicator = getIndicator(indicatorId);

    if (!indicator) {
      return res.status(404).json({ error: `Indicator not found: ${req.params.id}` });
    }

    res.json({ indicator });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to get indicator" });
  }
});

// Calculate indicator from Parquet data
router.post("/indicators/calculate", async (req: Request, res: Response) => {
  try {
    const { symbol, indicator, params = {}, timeframe = "1m", limit = 500 } = req.body;

    if (!symbol || !indicator) {
      return res.status(400).json({ error: "symbol and indicator are required" });
    }

    // Validate indicator exists
    const { getIndicator, calculateIndicator } = await import("../lib/indicators");
    const indicatorDef = getIndicator(indicator);
    if (!indicatorDef) {
      return res.status(400).json({ error: `Unknown indicator: ${indicator}` });
    }

    // Validate timeframe
    const validTimeframes = ['1s', '1m', '5m', '15m', '30m', '1h', '4h', '1d'];
    if (!validTimeframes.includes(timeframe)) {
      return res.status(400).json({ error: `Invalid timeframe. Valid: ${validTimeframes.join(', ')}` });
    }

    // Load OHLCV data from QuestDB (time-series → QuestDB first, DuckDB fallback)
    let rows: any[] = [];
    try {
      const { checkQuestDBHealth, getOHLCVSampleBy } = await import("../questdb");
      const healthy = await checkQuestDBHealth();
      if (healthy) {
        const qdbRows = await getOHLCVSampleBy(
          symbol.toUpperCase(), timeframe, undefined, undefined, Math.max(limit, 200)
        );
        rows = qdbRows.map((r: any) => ({
          timestamp: r.timestamp instanceof Date ? r.timestamp.getTime() : Number(r.timestamp),
          open: Number(r.open), high: Number(r.high), low: Number(r.low),
          close: Number(r.close), volume: Number(r.volume),
        }));
      }
    } catch {}
    // Fallback to DuckDB parquet if QuestDB returned nothing
    if (rows.length === 0) {
      const { queryParquetOHLCVAggregated } = await import("../duckdb");
      rows = await queryParquetOHLCVAggregated(
        symbol.toUpperCase(), timeframe, Math.max(limit, 200)
      );
    }

    if (rows.length === 0) {
      return res.status(404).json({ error: `No data found for ${symbol}` });
    }

    // Convert to OHLCV bars
    const bars = rows.map((r: any) => ({
      timestamp: r.timestamp,
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close,
      volume: r.volume
    }));

    // Calculate indicator
    const results = calculateIndicator({ indicator, bars, params });

    // Return last N results based on limit
    const startIdx = Math.max(0, results[0].values.length - limit);
    const timestamps = bars.slice(startIdx).map((b: any) => b.timestamp);

    const output = results.map(r => ({
      name: r.name,
      values: r.values.slice(startIdx)
    }));

    res.json({
      symbol: symbol.toUpperCase(),
      indicator,
      params: { ...indicatorDef.defaultParams, ...params },
      timeframe,
      timestamps,
      results: output
    });
  } catch (error: any) {
    console.error("Error calculating indicator:", error);
    res.status(500).json({ error: error.message || "Failed to calculate indicator" });
  }
});

// Generate SQL for an indicator (for batch processing)
router.post("/indicators/generate-sql", async (req: Request, res: Response) => {
  try {
    const { indicator, params = {}, tableName, symbolColumn, timestampColumn } = req.body;

    if (!indicator) {
      return res.status(400).json({ error: "indicator is required" });
    }

    const { generateIndicatorSQL, getIndicator } = await import("../lib/indicators");
    const indicatorDef = getIndicator(indicator);
    if (!indicatorDef) {
      return res.status(400).json({ error: `Unknown indicator: ${indicator}` });
    }

    // Validate SQL identifiers to prevent injection
    const safeTableName = tableName ? validateSQLIdentifier(tableName, ALLOWED_TABLE_NAMES) : 'ohlcv';
    const safeSymbolCol = symbolColumn ? validateSQLIdentifier(symbolColumn, ALLOWED_COLUMN_NAMES) : 'symbol';
    const safeTimestampCol = timestampColumn ? validateSQLIdentifier(timestampColumn, ALLOWED_COLUMN_NAMES) : 'timestamp';

    const sql = generateIndicatorSQL({
      indicator,
      params,
      options: {
        tableName: safeTableName,
        symbolColumn: safeSymbolCol,
        timestampColumn: safeTimestampCol
      }
    });

    res.json({
      indicator,
      params: { ...indicatorDef.defaultParams, ...params },
      sql
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to generate SQL" });
  }
});

// Generate bulk indicators SQL
router.post("/indicators/generate-bulk-sql", async (req: Request, res: Response) => {
  try {
    const { request, tableName, symbolColumn, timestampColumn } = req.body;

    if (!request) {
      return res.status(400).json({ error: "request object is required" });
    }

    // Validate SQL identifiers to prevent injection
    const safeTableName = tableName ? validateSQLIdentifier(tableName, ALLOWED_TABLE_NAMES) : 'ohlcv';
    const safeSymbolCol = symbolColumn ? validateSQLIdentifier(symbolColumn, ALLOWED_COLUMN_NAMES) : 'symbol';
    const safeTimestampCol = timestampColumn ? validateSQLIdentifier(timestampColumn, ALLOWED_COLUMN_NAMES) : 'timestamp';

    const { generateBulkIndicatorsSQL } = await import("../lib/indicators");

    const sql = generateBulkIndicatorsSQL(request, {
      tableName: safeTableName,
      symbolColumn: safeSymbolCol,
      timestampColumn: safeTimestampCol
    });

    res.json({ sql });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to generate bulk SQL" });
  }
});

// ============================================================================
// INDICATOR COMPUTATION API
// ============================================================================

// Compute indicators for a symbol using real-time library
router.post("/indicators/compute", mlRateLimiter, async (req: Request, res: Response) => {
  try {
    const { symbol, indicators, preset, limit = 1000 } = req.body;

    if (!symbol) {
      return res.status(400).json({ error: "Symbol is required" });
    }

    const { computeIndicatorsRealtime, INDICATOR_PRESETS } = await import('../lib/indicators/indicatorService');

    // Get OHLCV data from QuestDB (time-series)
    let ohlcvData: any[] = [];
    try {
      const { checkQuestDBHealth, getOHLCVSampleBy } = await import("../questdb");
      const healthy = await checkQuestDBHealth();
      if (healthy) {
        const qdbRows = await getOHLCVSampleBy(symbol, '1m', undefined, undefined, limit);
        ohlcvData = qdbRows.map((r: any) => ({
          timestamp: r.timestamp instanceof Date ? r.timestamp.getTime() : Number(r.timestamp),
          open: Number(r.open), high: Number(r.high), low: Number(r.low),
          close: Number(r.close), volume: Number(r.volume),
        }));
      }
    } catch {}

    if (!ohlcvData || ohlcvData.length === 0) {
      return res.status(404).json({ error: `No OHLCV data found for ${symbol}` });
    }

    // Convert to the expected format, sort by timestamp ASC, and deduplicate
    const barsRaw = ohlcvData.map((d: any) => ({
      timestamp: Number(d.timestamp),
      open: Number(d.open),
      high: Number(d.high),
      low: Number(d.low),
      close: Number(d.close),
      volume: Number(d.volume),
    }));

    // Sort ascending by timestamp
    barsRaw.sort((a, b) => a.timestamp - b.timestamp);

    // Deduplicate by timestamp (keep first occurrence)
    const seenTimestamps = new Set<number>();
    const bars = barsRaw.filter(bar => {
      if (seenTimestamps.has(bar.timestamp)) return false;
      seenTimestamps.add(bar.timestamp);
      return true;
    });

    // Use preset or custom indicators
    let indicatorConfig: any;
    if (preset && INDICATOR_PRESETS[preset as keyof typeof INDICATOR_PRESETS]) {
      indicatorConfig = INDICATOR_PRESETS[preset as keyof typeof INDICATOR_PRESETS];
    } else if (indicators) {
      indicatorConfig = indicators;
    } else {
      indicatorConfig = INDICATOR_PRESETS.full;
    }

    const results = computeIndicatorsRealtime(bars, { indicators: indicatorConfig });

    // Build indicator list from config rather than from last row
    const indicatorList: string[] = [];
    if (indicatorConfig.rsi) indicatorConfig.rsi.forEach((p: number) => indicatorList.push(`rsi_${p}`));
    if (indicatorConfig.macd) indicatorConfig.macd.forEach((m: any) => {
      indicatorList.push(`macd_${m.fast}_${m.slow}_${m.signal}`);
      indicatorList.push(`macd_signal_${m.fast}_${m.slow}_${m.signal}`);
      indicatorList.push(`macd_hist_${m.fast}_${m.slow}_${m.signal}`);
    });
    if (indicatorConfig.bollinger) indicatorConfig.bollinger.forEach((b: any) => {
      indicatorList.push(`bb_upper_${b.period}`, `bb_middle_${b.period}`, `bb_lower_${b.period}`, `bb_pct_b_${b.period}`);
    });
    if (indicatorConfig.atr) indicatorConfig.atr.forEach((p: number) => indicatorList.push(`atr_${p}`));
    if (indicatorConfig.stochastic) indicatorConfig.stochastic.forEach((s: any) => {
      indicatorList.push(`stoch_k_${s.k}`, `stoch_d_${s.k}_${s.d}`);
    });
    if (indicatorConfig.cci) indicatorConfig.cci.forEach((p: number) => indicatorList.push(`cci_${p}`));
    if (indicatorConfig.williamsR) indicatorConfig.williamsR.forEach((p: number) => indicatorList.push(`williams_r_${p}`));
    if (indicatorConfig.sma) indicatorConfig.sma.forEach((p: number) => indicatorList.push(`sma_${p}`));
    if (indicatorConfig.ema) indicatorConfig.ema.forEach((p: number) => indicatorList.push(`ema_${p}`));
    if (indicatorConfig.roc) indicatorConfig.roc.forEach((p: number) => indicatorList.push(`roc_${p}`));
    if (indicatorConfig.momentum) indicatorConfig.momentum.forEach((p: number) => indicatorList.push(`momentum_${p}`));

    res.json({
      success: true,
      symbol,
      count: results.length,
      barsAvailable: bars.length,
      indicators: indicatorList,
      data: results,
    });
  } catch (error) {
    console.error("Error computing indicators:", error);
    res.status(500).json({ error: "Failed to compute indicators", details: String(error) });
  }
});

// Get available indicator presets
router.get("/indicators/presets", (_req: Request, res: Response) => {
  import('../lib/indicators/indicatorService').then(({ INDICATOR_PRESETS }) => {
    res.json(INDICATOR_PRESETS);
  }).catch(error => {
    console.error("Error fetching presets:", error);
    res.status(500).json({ error: "Failed to fetch presets" });
  });
});

// Generate DuckDB SQL for batch indicator computation
router.post("/indicators/sql", async (req: Request, res: Response) => {
  try {
    const { symbol, indicators, tableName = 'ohlcv' } = req.body;

    if (!indicators) {
      return res.status(400).json({ error: "Indicators configuration is required" });
    }

    const { generateIndicatorSQL } = await import('../lib/indicators/indicatorService');
    const sql = generateIndicatorSQL({ indicators }, tableName, symbol);

    res.json({
      success: true,
      sql,
    });
  } catch (error) {
    console.error("Error generating SQL:", error);
    res.status(500).json({ error: "Failed to generate SQL" });
  }
});

// Compute indicators using DuckDB (batch mode for large datasets)
router.post("/indicators/batch", mlRateLimiter, async (req: Request, res: Response) => {
  try {
    const { symbol, indicators, preset, limit = 10000 } = req.body;

    if (!symbol) {
      return res.status(400).json({ error: "Symbol is required" });
    }

    const { generateIndicatorSQL, INDICATOR_PRESETS } = await import('../lib/indicators/indicatorService');

    // Use preset or custom indicators
    let indicatorConfig;
    if (preset && INDICATOR_PRESETS[preset as keyof typeof INDICATOR_PRESETS]) {
      indicatorConfig = INDICATOR_PRESETS[preset as keyof typeof INDICATOR_PRESETS];
    } else if (indicators) {
      indicatorConfig = indicators;
    } else {
      indicatorConfig = INDICATOR_PRESETS.full;
    }

    const sql = generateIndicatorSQL({ indicators: indicatorConfig }, 'ohlcv', symbol);
    const limitedSql = `${sql} LIMIT ${limit}`;

    const results = await runQuery(limitedSql);

    res.json({
      success: true,
      symbol,
      count: results.length,
      data: results,
    });
  } catch (error) {
    console.error("Error computing batch indicators:", error);
    res.status(500).json({ error: "Failed to compute batch indicators", details: String(error) });
  }
});

// ============================================================================
// PRE-COMPUTED INDICATOR DATA (from pandas-ta parquet files)
// ============================================================================

const INDICATOR_DIR = path.join(process.cwd(), "data", "indicators");

// Cache for catalog data
let cachedCatalog: { categories: Record<string, string[]>; total: number; columns: string[] } | null = null;

// ===========================================================================
// Partitioned indicator directory support (v2 format)
// ===========================================================================

interface CategoryMeta {
  columns: string[];
  column_count: number;
  file_size_bytes: number;
  file_size_mb: number;
}

interface IndicatorMeta {
  version: number;
  computed_at: string;
  symbol: string;
  timeframe: string;
  row_count: number;
  total_columns: number;
  categories: Record<string, CategoryMeta>;
}

// Cache _meta.json contents (cleared on server restart)
const metaCache = new Map<string, IndicatorMeta | null>();

function getPartitionedDir(symbol: string, timeframe: string): string {
  return path.join(INDICATOR_DIR, timeframe, symbol);
}

function readMeta(symbol: string, timeframe: string): IndicatorMeta | null {
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
function findColumnsInCategories(
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

/** Build a DuckDB query that JOINs multiple category parquet files. */
function buildPartitionedQuery(
  partDir: string,
  categoryColMap: Map<string, string[]>,
  limit: number,
): string {
  const entries = Array.from(categoryColMap.entries());
  if (entries.length === 0) return "";

  const [firstCat, firstCols] = entries[0];
  const firstPath = path.join(partDir, `${firstCat}.parquet`).replace(/\\/g, "/");

  let selectCols = `t0."timestamp"`;
  for (const c of firstCols) selectCols += `, t0."${c}"`;
  for (let i = 1; i < entries.length; i++) {
    for (const c of entries[i][1]) selectCols += `, t${i}."${c}"`;
  }

  let sql = `SELECT ${selectCols}\nFROM read_parquet('${firstPath}') t0`;
  for (let i = 1; i < entries.length; i++) {
    const catPath = path.join(partDir, `${entries[i][0]}.parquet`).replace(/\\/g, "/");
    sql += `\nJOIN read_parquet('${catPath}') t${i} ON t0."timestamp" = t${i}."timestamp"`;
  }
  sql += `\nORDER BY t0."timestamp" DESC\nLIMIT ${limit}`;
  return sql;
}

/** Find any _meta.json in the indicator directory tree. */
function findSampleMeta(): IndicatorMeta | null {
  if (!fs.existsSync(INDICATOR_DIR)) return null;
  for (const tf of fs.readdirSync(INDICATOR_DIR)) {
    const tfDir = path.join(INDICATOR_DIR, tf);
    if (!fs.statSync(tfDir).isDirectory()) continue;
    for (const sym of fs.readdirSync(tfDir)) {
      const metaPath = path.join(tfDir, sym, "_meta.json");
      if (fs.existsSync(metaPath)) {
        try {
          return JSON.parse(fs.readFileSync(metaPath, "utf-8")) as IndicatorMeta;
        } catch { continue; }
      }
    }
  }
  return null;
}

// Get catalog of all pre-computed indicator columns
router.get("/indicators/catalog", async (_req: Request, res: Response) => {
  try {
    if (cachedCatalog) {
      return res.json(cachedCatalog);
    }

    if (!fs.existsSync(INDICATOR_DIR)) {
      return res.json({ categories: {}, total: 0, columns: [] });
    }

    // Try partitioned format first (v2: _meta.json files)
    const sampleMeta = findSampleMeta();
    if (sampleMeta) {
      const categories: Record<string, string[]> = {};
      const allColumns: string[] = [];
      for (const [cat, catMeta] of Object.entries(sampleMeta.categories)) {
        categories[cat] = catMeta.columns;
        allColumns.push(...catMeta.columns);
      }
      // Remove empty categories
      for (const key of Object.keys(categories)) {
        if (categories[key].length === 0) delete categories[key];
      }
      cachedCatalog = { categories, total: allColumns.length, columns: allColumns };
      return res.json(cachedCatalog);
    }

    // Fall back to flat file introspection (v1 format)
    const files = fs.readdirSync(INDICATOR_DIR).filter(f => f.endsWith(".parquet"));
    if (files.length === 0) {
      return res.json({ categories: {}, total: 0, columns: [] });
    }

    const samplePath = path.join(INDICATOR_DIR, files[0]).replace(/\\/g, "/");

    const colResult = await runQuery<{ column_name: string }>(`
      SELECT column_name FROM (DESCRIBE SELECT * FROM read_parquet('${samplePath}'))
    `);

    const ohlcvCols = new Set(["timestamp", "open", "high", "low", "close", "volume"]);
    const indicatorCols = colResult
      .map(r => r.column_name)
      .filter(c => !ohlcvCols.has(c.toLowerCase()));

    // Categorize by prefix patterns (same order as Python classifier)
    const categories: Record<string, string[]> = {
      candle: [], trend: [], volume: [], volatility: [], momentum: [],
      cycle: [], statistics: [], performance: [], overlap: [], other: [],
    };

    const categoryPrefixes: [string, string[]][] = [
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

    for (const col of indicatorCols) {
      const upper = col.toUpperCase();
      let classified = false;
      for (const [cat, prefixes] of categoryPrefixes) {
        if (prefixes.some(p => upper.startsWith(p))) {
          categories[cat].push(col);
          classified = true;
          break;
        }
      }
      if (!classified) categories.other.push(col);
    }

    // Remove empty categories
    for (const key of Object.keys(categories)) {
      if (categories[key].length === 0) delete categories[key];
    }

    cachedCatalog = {
      categories,
      total: indicatorCols.length,
      columns: indicatorCols,
    };

    res.json(cachedCatalog);
  } catch (error: any) {
    console.error("Error fetching indicator catalog:", error);
    res.status(500).json({ error: error.message || "Failed to fetch indicator catalog" });
  }
});

// Get pre-computed indicator data for a symbol
router.get("/indicators/data/:symbol", async (req: Request, res: Response) => {
  try {
    const symbol = getString(req.params.symbol).toUpperCase();
    const timeframe = (req.query.timeframe as string) || "1m";
    const columns = req.query.columns as string | undefined;
    const limitStr = req.query.limit as string | undefined;
    const limit = limitStr ? Math.min(parseInt(limitStr), 10000) : 2000;

    // --- Try partitioned format first (v2) ---
    const meta = readMeta(symbol, timeframe);
    if (meta) {
      const partDir = getPartitionedDir(symbol, timeframe);

      if (columns) {
        const requestedCols = columns.split(",").map(c => c.trim()).filter(c => /^[a-zA-Z0-9_.]+$/.test(c));
        const categoryColMap = findColumnsInCategories(meta, requestedCols);

        if (categoryColMap.size === 0) {
          return res.status(404).json({
            error: `None of the requested columns found in ${symbol}/${timeframe}`,
            available_categories: Object.keys(meta.categories),
          });
        }

        const sql = buildPartitionedQuery(partDir, categoryColMap, limit);
        const data = await runQuery(sql);
        data.reverse();

        const serialized = data.map(row => {
          const converted: Record<string, unknown> = {};
          for (const [key, val] of Object.entries(row)) {
            converted[key] = typeof val === "bigint" ? Number(val) : val;
          }
          return converted;
        });

        return res.json({ symbol, timeframe, count: serialized.length, data: serialized });
      } else {
        // All columns — join all category files
        const allColMap = new Map<string, string[]>();
        for (const [cat, catMeta] of Object.entries(meta.categories)) {
          allColMap.set(cat, catMeta.columns);
        }

        const sql = buildPartitionedQuery(partDir, allColMap, limit);
        const data = await runQuery(sql);
        data.reverse();

        const serialized = data.map(row => {
          const converted: Record<string, unknown> = {};
          for (const [key, val] of Object.entries(row)) {
            converted[key] = typeof val === "bigint" ? Number(val) : val;
          }
          return converted;
        });

        return res.json({ symbol, timeframe, count: serialized.length, data: serialized });
      }
    }

    // --- Fall back to flat file (v1) ---
    const filePath = path.join(INDICATOR_DIR, `${symbol}_${timeframe}.parquet`);
    if (!fs.existsSync(filePath)) {
      // List what's available
      const available: string[] = [];
      if (fs.existsSync(INDICATOR_DIR)) {
        // Check partitioned dirs
        for (const tf of fs.readdirSync(INDICATOR_DIR)) {
          const symDir = path.join(INDICATOR_DIR, tf, symbol);
          if (fs.existsSync(path.join(symDir, "_meta.json"))) {
            available.push(`${symbol}_${tf} (partitioned)`);
          }
        }
        // Check flat files
        for (const f of fs.readdirSync(INDICATOR_DIR).filter(f => f.startsWith(symbol) && f.endsWith(".parquet"))) {
          available.push(f.replace(".parquet", ""));
        }
      }
      return res.status(404).json({
        error: `No pre-computed indicators for ${symbol} at ${timeframe}`,
        available,
      });
    }

    const safePath = filePath.replace(/\\/g, "/");

    let selectClause = "*";
    if (columns) {
      const requestedCols = columns.split(",").map(c => c.trim());
      const safeCols = ["timestamp", ...requestedCols.filter(c => /^[a-zA-Z0-9_.]+$/.test(c))];
      selectClause = safeCols.map(c => `"${c}"`).join(", ");
    }

    const data = await runQuery(`
      SELECT ${selectClause}
      FROM read_parquet('${safePath}')
      ORDER BY timestamp DESC
      LIMIT ${limit}
    `);

    data.reverse();

    const serialized = data.map(row => {
      const converted: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(row)) {
        converted[key] = typeof val === "bigint" ? Number(val) : val;
      }
      return converted;
    });

    res.json({ symbol, timeframe, count: serialized.length, data: serialized });
  } catch (error: any) {
    console.error("Error fetching indicator data:", error);
    res.status(500).json({ error: error.message || "Failed to fetch indicator data" });
  }
});

// Get candle pattern data only (CDL_* columns)
router.get("/indicators/patterns/:symbol", async (req: Request, res: Response) => {
  try {
    const symbol = getString(req.params.symbol).toUpperCase();
    const timeframe = (req.query.timeframe as string) || "1d";
    const limitStr = req.query.limit as string | undefined;
    const limit = limitStr ? Math.min(parseInt(limitStr), 5000) : 2000;

    // --- Try partitioned format first (v2) ---
    const meta = readMeta(symbol, timeframe);
    if (meta && meta.categories.candle) {
      const candlePath = path.join(
        getPartitionedDir(symbol, timeframe), "candle.parquet"
      ).replace(/\\/g, "/");
      const patternCols = meta.categories.candle.columns;

      if (patternCols.length === 0) {
        return res.json({ symbol, timeframe, patterns: [], data: [] });
      }

      const selectCols = ["timestamp", ...patternCols].map(c => `"${c}"`).join(", ");
      const data = await runQuery(`
        SELECT ${selectCols}
        FROM read_parquet('${candlePath}')
        ORDER BY timestamp DESC
        LIMIT ${limit}
      `);
      data.reverse();

      const activePatterns = data
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
        .filter(Boolean);

      return res.json({
        symbol, timeframe, patterns: patternCols, count: activePatterns.length, data: activePatterns,
      });
    }

    // --- Fall back to flat file (v1) ---
    const filePath = path.join(INDICATOR_DIR, `${symbol}_${timeframe}.parquet`);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: `No pre-computed data for ${symbol} at ${timeframe}` });
    }

    const safePath = filePath.replace(/\\/g, "/");

    const colResult = await runQuery<{ column_name: string }>(`
      SELECT column_name FROM (DESCRIBE SELECT * FROM read_parquet('${safePath}'))
    `);

    const patternCols = colResult
      .map(r => r.column_name)
      .filter(c => c.startsWith("CDL_"));

    if (patternCols.length === 0) {
      return res.json({ symbol, timeframe, patterns: [], data: [] });
    }

    const selectCols = ["timestamp", ...patternCols].map(c => `"${c}"`).join(", ");

    const data = await runQuery(`
      SELECT ${selectCols}
      FROM read_parquet('${safePath}')
      ORDER BY timestamp DESC
      LIMIT ${limit}
    `);

    data.reverse();

    const activePatterns = data
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
      .filter(Boolean);

    res.json({
      symbol, timeframe, patterns: patternCols, count: activePatterns.length, data: activePatterns,
    });
  } catch (error: any) {
    console.error("Error fetching pattern data:", error);
    res.status(500).json({ error: error.message || "Failed to fetch pattern data" });
  }
});

// ============================================================================
// INDICATOR COMPUTATION PIPELINE (spawn compute-indicators.py)
// ============================================================================

let activeComputeProcess: ChildProcess | null = null;

// POST /api/indicators/compute-batch — trigger indicator recomputation
router.post("/indicators/compute-batch", mlRateLimiter, (req: Request, res: Response) => {
  if (activeComputeProcess) {
    return res.status(409).json({ error: "Indicator computation already in progress" });
  }

  const { symbols, timeframes, force } = req.body as {
    symbols?: string[];
    timeframes?: string[];
    force?: boolean;
  };

  // Build CLI args
  const trainingJsonPath = path.join(process.cwd(), "config", "training.json");
  let pythonExe = ".venv/Scripts/python.exe";
  try {
    const trainingCfg = JSON.parse(fs.readFileSync(trainingJsonPath, "utf-8"));
    pythonExe = trainingCfg.paths?.pythonExe || pythonExe;
  } catch {}

  const script = path.join(process.cwd(), "scripts", "compute-indicators.py");
  const args = [script];

  if (symbols && symbols.length > 0) {
    args.push("--symbols", symbols.join(","));
  }
  if (timeframes && timeframes.length > 0) {
    args.push("--timeframes", timeframes.join(","));
  }
  if (force) {
    args.push("--force");
  }

  // SSE headers
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const sendEvent = (event: string, data: any) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  sendEvent("started", {
    message: "Indicator computation started",
    symbols: symbols || "all",
    timeframes: timeframes || "all (except 1m)",
    force: !!force,
  });

  const fullPythonExe = path.join(process.cwd(), pythonExe);
  console.log(`[indicators] Spawning: ${fullPythonExe} ${args.join(" ")}`);

  const child = spawn(fullPythonExe, args, {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
  });
  activeComputeProcess = child;

  child.stdout.on("data", (chunk) => {
    const lines = chunk.toString().split("\n").filter((l: string) => l.trim());
    for (const line of lines) {
      const trimmed = line.trim();

      // Parse progress markers like [indicators] ES done (7 computed, 0 skipped, 0 errors) [7/112]
      const progressMatch = trimmed.match(/\[(\d+)\/(\d+)\]$/);
      if (progressMatch) {
        sendEvent("progress", {
          done: parseInt(progressMatch[1]),
          total: parseInt(progressMatch[2]),
          message: trimmed,
        });
      } else {
        sendEvent("log", { message: trimmed });
      }
    }
  });

  child.stderr.on("data", (chunk) => {
    const text = chunk.toString().trim();
    if (text && !text.includes("Warning") && !text.includes("FutureWarning")) {
      sendEvent("warning", { message: text.slice(0, 500) });
    }
  });

  child.on("close", (code) => {
    activeComputeProcess = null;
    // Clear meta cache so new data is picked up
    metaCache.clear();
    cachedCatalog = null;

    if (code === 0) {
      sendEvent("done", { message: "Indicator computation complete", exitCode: 0 });
    } else {
      sendEvent("error", { message: `Computation failed (exit code ${code})`, exitCode: code });
    }
    res.end();
  });

  // Client disconnect — kill process
  req.on("close", () => {
    if (activeComputeProcess && activeComputeProcess === child) {
      console.log("[indicators] Client disconnected, killing compute process");
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
      }, 5000);
      activeComputeProcess = null;
    }
  });
});

// GET /api/indicators/status — which symbol/timeframe combos have indicators
router.get("/indicators/status", (_req: Request, res: Response) => {
  try {
    if (!fs.existsSync(INDICATOR_DIR)) {
      return res.json({ computed: [], totalSymbols: 0, totalCombinations: 0 });
    }

    const computed: Array<{
      symbol: string;
      timeframe: string;
      rowCount: number;
      totalColumns: number;
      computedAt: string;
      categories: string[];
      totalSizeMb: number;
    }> = [];

    // Walk data/indicators/{timeframe}/{symbol}/_meta.json
    for (const tf of fs.readdirSync(INDICATOR_DIR)) {
      const tfDir = path.join(INDICATOR_DIR, tf);
      if (!fs.statSync(tfDir).isDirectory()) continue;

      for (const sym of fs.readdirSync(tfDir)) {
        const metaPath = path.join(tfDir, sym, "_meta.json");
        if (!fs.existsSync(metaPath)) continue;

        try {
          const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
          const totalSizeBytes = Object.values(meta.categories || {}).reduce(
            (sum: number, c: any) => sum + (c.file_size_bytes || 0), 0
          );
          computed.push({
            symbol: meta.symbol || sym,
            timeframe: meta.timeframe || tf,
            rowCount: meta.row_count || 0,
            totalColumns: meta.total_columns || 0,
            computedAt: meta.computed_at || "",
            categories: Object.keys(meta.categories || {}),
            totalSizeMb: Math.round((totalSizeBytes as number) / (1024 * 1024) * 10) / 10,
          });
        } catch { /* skip malformed */ }
      }
    }

    const symbols = new Set(computed.map(c => c.symbol));
    res.json({
      computed,
      totalSymbols: symbols.size,
      totalCombinations: computed.length,
      computing: !!activeComputeProcess,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to read indicator status" });
  }
});

// ============================================================================
// FEATURE REGISTRY API (normalized features for model consumption)
// ============================================================================

const FEATURES_DIR = path.join(process.cwd(), "data", "features");

// GET /api/features/catalog — list all normalized features with normalization type
router.get("/features/catalog", async (_req: Request, res: Response) => {
  try {
    if (!fs.existsSync(FEATURES_DIR)) {
      return res.json({ columns: {}, totalColumns: 0 });
    }

    // Find any normalization_stats.json to build catalog
    for (const tf of fs.readdirSync(FEATURES_DIR)) {
      const tfDir = path.join(FEATURES_DIR, tf);
      if (!fs.statSync(tfDir).isDirectory()) continue;
      for (const sym of fs.readdirSync(tfDir)) {
        const statsPath = path.join(tfDir, sym, "normalization_stats.json");
        if (fs.existsSync(statsPath)) {
          try {
            const stats = JSON.parse(fs.readFileSync(statsPath, "utf-8"));
            return res.json({
              columns: stats.columns || {},
              totalColumns: stats.columns_total || 0,
              sampleSymbol: sym,
              sampleTimeframe: tf,
              rollingWindow: stats.rolling_window,
              clipRange: stats.clip_range,
            });
          } catch { continue; }
        }
      }
    }

    res.json({ columns: {}, totalColumns: 0 });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to read feature catalog" });
  }
});

// GET /api/features/data/:symbol — fetch normalized feature data
router.get("/features/data/:symbol", async (req: Request, res: Response) => {
  try {
    const symbol = getString(req.params.symbol).toUpperCase();
    const timeframe = (req.query.timeframe as string) || "1d";
    const columns = req.query.columns as string | undefined;
    const limitStr = req.query.limit as string | undefined;
    const limit = limitStr ? Math.min(parseInt(limitStr), 10000) : 2000;

    const normalizedPath = path.join(FEATURES_DIR, timeframe, symbol, "normalized.parquet");
    if (!fs.existsSync(normalizedPath)) {
      // List what's available
      const available: string[] = [];
      if (fs.existsSync(FEATURES_DIR)) {
        for (const tf of fs.readdirSync(FEATURES_DIR)) {
          const symPath = path.join(FEATURES_DIR, tf, symbol, "normalized.parquet");
          if (fs.existsSync(symPath)) {
            available.push(tf);
          }
        }
      }
      return res.status(404).json({
        error: `No normalized features for ${symbol} at ${timeframe}`,
        availableTimeframes: available,
      });
    }

    const safePath = normalizedPath.replace(/\\/g, "/");
    let selectClause = "*";
    if (columns) {
      const requestedCols = columns.split(",").map(c => c.trim()).filter(c => /^[a-zA-Z0-9_.]+$/.test(c));
      const safeCols = ["timestamp", ...requestedCols];
      selectClause = safeCols.map(c => `"${c}"`).join(", ");
    }

    const data = await runQuery(`
      SELECT ${selectClause}
      FROM read_parquet('${safePath}')
      ORDER BY timestamp DESC
      LIMIT ${limit}
    `);
    data.reverse();

    const serialized = data.map(row => {
      const converted: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(row)) {
        converted[key] = typeof val === "bigint" ? Number(val) : val;
      }
      return converted;
    });

    res.json({ symbol, timeframe, count: serialized.length, data: serialized });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to fetch feature data" });
  }
});

// GET /api/features/sets — list named feature sets
router.get("/features/sets", async (_req: Request, res: Response) => {
  try {
    const { listFeatureSets, listFeaturePipelines } = await import("../training/registry");
    res.json({
      featureSets: listFeatureSets(),
      pipelines: listFeaturePipelines(),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to list feature sets" });
  }
});

export default router;
