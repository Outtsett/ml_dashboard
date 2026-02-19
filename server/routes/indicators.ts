import { Router, Request, Response } from "express";
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

    // Load OHLCV data from parquet
    const { queryParquetOHLCVAggregated } = await import("../duckdb");
    const rows = await queryParquetOHLCVAggregated(
      symbol.toUpperCase(),
      timeframe,
      Math.max(limit, 200) // Ensure enough data for lookback
    );

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

    // Get OHLCV data
    const ohlcvData = await storage.getOhlcvPartitioned(symbol, limit);

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

// Get catalog of all pre-computed indicator columns
router.get("/indicators/catalog", async (_req: Request, res: Response) => {
  try {
    if (cachedCatalog) {
      return res.json(cachedCatalog);
    }

    if (!fs.existsSync(INDICATOR_DIR)) {
      return res.json({ categories: {}, total: 0, columns: [] });
    }

    // Find a sample parquet file
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

    // Categorize by prefix patterns
    const categories: Record<string, string[]> = {
      candle: [],
      overlap: [],
      momentum: [],
      volatility: [],
      volume: [],
      trend: [],
      statistics: [],
      cycle: [],
      performance: [],
      other: [],
    };

    const candlePrefixes = ["CDL_"];
    const overlapPrefixes = ["SMA", "EMA", "WMA", "DEMA", "TEMA", "T3", "KAMA", "FWMA", "HMA", "ALMA", "LINREG", "MIDPOINT", "MIDPRICE", "PWMA", "RMA", "SINWMA", "SWMA", "TRIMA", "VIDYA", "VWMA", "HWMA", "MCGD", "SMMA", "JMA", "ZLMA", "ZL", "HT", "HILO", "ISA", "ISB", "ITS", "IKS", "ICS", "MAMA", "FAMA", "SSF", "SSF3", "ACCB", "BBL", "BBM", "BBU", "BBB", "BBP", "KCL", "KCB", "KCU", "DCL", "DCM", "DCU", "SUPERT", "ALPHAT", "AMAT", "AGj", "AGt", "AGl"];
    const momentumPrefixes = ["RSI", "MACD", "STOCH", "CCI", "WILLR", "MOM", "ROC", "AO", "APO", "PPO", "BIAS", "BOP", "AR", "BR", "CFO", "CG", "CMO", "COPC", "CRSI", "CTI", "ER", "FISHER", "INERTIA", "K", "D", "J", "KST", "PGO", "PSL", "QQE", "RSX", "RVGI", "STC", "TRIX", "TSI", "UO", "SMI", "TMO", "SQZ", "SQZPRO"];
    const volatilityPrefixes = ["ATR", "NATR", "TRUERANGE", "ABER", "THERMO", "UI", "RVI", "MASSI", "HW", "TOS", "PDIST"];
    const volumePrefixes = ["OBV", "AD", "ADOSC", "CMF", "EFI", "EOM", "KVO", "MFI", "NVI", "PVI", "PVOL", "PVR", "PVT", "VWAP", "TSV", "AOBV", "VP", "VHM"];
    const trendPrefixes = ["ADX", "ADXR", "DMP", "DMN", "AROON", "CHOP", "CKSP", "DPO", "PSAR", "QS", "VTXP", "VTXM", "VHF", "EBSW", "REFLEX", "TRENDFLEX", "RWI", "LDECAY", "DEC", "INC", "ZIGZAG", "SMC", "EXHC", "CHDLREXTl", "CHDLREXTs", "CHDLREXTd"];
    const statsPrefixes = ["ENTP", "KURT", "MAD", "MEDIAN", "QTL", "SKEW", "STDEV", "VAR", "ZS", "SLOPE"];
    const perfPrefixes = ["LOGRET", "PCTRET"];
    const cyclePrefixes = ["EBSW", "REFLEX"];

    for (const col of indicatorCols) {
      const upper = col.toUpperCase();
      if (candlePrefixes.some(p => upper.startsWith(p))) categories.candle.push(col);
      else if (perfPrefixes.some(p => upper.startsWith(p))) categories.performance.push(col);
      else if (statsPrefixes.some(p => upper.startsWith(p))) categories.statistics.push(col);
      else if (volumePrefixes.some(p => upper.startsWith(p))) categories.volume.push(col);
      else if (volatilityPrefixes.some(p => upper.startsWith(p))) categories.volatility.push(col);
      else if (trendPrefixes.some(p => upper.startsWith(p))) categories.trend.push(col);
      else if (momentumPrefixes.some(p => upper.startsWith(p))) categories.momentum.push(col);
      else if (overlapPrefixes.some(p => upper.startsWith(p))) categories.overlap.push(col);
      else categories.other.push(col);
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

    const filePath = path.join(INDICATOR_DIR, `${symbol}_${timeframe}.parquet`);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        error: `No pre-computed indicators for ${symbol} at ${timeframe}`,
        available: fs.existsSync(INDICATOR_DIR)
          ? fs.readdirSync(INDICATOR_DIR).filter(f => f.startsWith(symbol)).map(f => f.replace(".parquet", ""))
          : [],
      });
    }

    const safePath = filePath.replace(/\\/g, "/");

    // Select specific columns or all
    let selectClause = "*";
    if (columns) {
      const requestedCols = columns.split(",").map(c => c.trim());
      // Always include timestamp
      const safeCols = ["timestamp", ...requestedCols.filter(c => /^[a-zA-Z0-9_]+$/.test(c))];
      selectClause = safeCols.map(c => `"${c}"`).join(", ");
    }

    const data = await runQuery(`
      SELECT ${selectClause}
      FROM read_parquet('${safePath}')
      ORDER BY timestamp DESC
      LIMIT ${limit}
    `);

    // Reverse to ascending
    data.reverse();

    // Convert BigInt values to Number for JSON serialization
    const serialized = data.map(row => {
      const converted: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(row)) {
        converted[key] = typeof val === "bigint" ? Number(val) : val;
      }
      return converted;
    });

    res.json({
      symbol,
      timeframe,
      count: serialized.length,
      data: serialized,
    });
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

    const filePath = path.join(INDICATOR_DIR, `${symbol}_${timeframe}.parquet`);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: `No pre-computed data for ${symbol} at ${timeframe}` });
    }

    const safePath = filePath.replace(/\\/g, "/");

    // Get CDL_* columns dynamically
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

    // Filter to only rows where at least one pattern is non-zero
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
      symbol,
      timeframe,
      patterns: patternCols,
      count: activePatterns.length,
      data: activePatterns,
    });
  } catch (error: any) {
    console.error("Error fetching pattern data:", error);
    res.status(500).json({ error: error.message || "Failed to fetch pattern data" });
  }
});

export default router;
