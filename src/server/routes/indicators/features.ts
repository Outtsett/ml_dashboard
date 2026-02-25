import { Router, Request, Response } from "express";
import { runQuery } from "../../duckdb";
import { getString } from "../helpers";
import { FEATURES_DIR } from "./helpers";
import * as path from "path";
import * as fs from "fs";

const router = Router();

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
    const { listFeatureSets, listFeaturePipelines } = await import("../../training/registry");
    res.json({
      featureSets: listFeatureSets(),
      pipelines: listFeaturePipelines(),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to list feature sets" });
  }
});

export default router;
