import { Router, Request, Response } from "express";
import { runQuery } from "../../duckdb";
import { getString } from "../helpers";
import * as path from "path";
import * as fs from "fs";
import {
  INDICATOR_DIR,
  cachedCatalog, setCachedCatalog,
  readMeta, getPartitionedDir,
  findColumnsInCategories, buildPartitionedQuery, findSampleMeta,
} from "./helpers";

const router = Router();

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
        if (categories[key]?.length === 0) delete categories[key];
      }
      const result = { categories, total: allColumns.length, columns: allColumns };
      setCachedCatalog(result);
      return res.json(result);
    }

    // Fall back to flat file introspection (v1 format)
    const files = fs.readdirSync(INDICATOR_DIR).filter(f => f.endsWith(".parquet"));
    if (files.length === 0) {
      return res.json({ categories: {}, total: 0, columns: [] });
    }

    const samplePath = path.join(INDICATOR_DIR, files[0]!).replace(/\\/g, "/");

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

    const result = {
      categories,
      total: indicatorCols.length,
      columns: indicatorCols,
    };
    setCachedCatalog(result);

    res.json(result);
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

export default router;
