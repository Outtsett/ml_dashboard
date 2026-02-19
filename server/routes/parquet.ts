import { Router, Request, Response } from "express";
import { queryParquetOHLCV, queryParquetOHLCVAggregated, getParquetStats, listParquetFiles } from "../duckdb";
import { getString } from "./helpers";

const router = Router();

// Parquet analytics endpoints for ML training
router.get("/parquet/files", async (req: Request, res: Response) => {
  try {
    const files = listParquetFiles();
    res.json(files);
  } catch (error) {
    console.error("Error listing parquet files:", error);
    res.status(500).json({ error: "Failed to list parquet files" });
  }
});

router.get("/parquet/:symbol/stats", async (req: Request, res: Response) => {
  try {
    const symbol = getString(req.params.symbol).toUpperCase();
    const stats = await getParquetStats(symbol);
    res.json(stats);
  } catch (error) {
    console.error("Error fetching parquet stats:", error);
    res.status(500).json({ error: "Failed to fetch parquet stats" });
  }
});

router.get("/parquet/:symbol/data", async (req: Request, res: Response) => {
  try {
    const symbol = getString(req.params.symbol).toUpperCase();
    const startTime = req.query.startTime ? parseInt(getString(req.query.startTime as string)) : undefined;
    const endTime = req.query.endTime ? parseInt(getString(req.query.endTime as string)) : undefined;
    const offset = req.query.offset ? parseInt(getString(req.query.offset as string)) : undefined;
    // Allow larger limits for time-filtered queries (more efficient)
    const hasTimeFilter = startTime !== undefined || endTime !== undefined;
    const maxLimit = hasTimeFilter ? 20000 : 5000;
    const requestedLimit = req.query.limit ? parseInt(getString(req.query.limit as string)) : 5000;
    const limit = Math.min(requestedLimit, maxLimit);

    const data = await queryParquetOHLCV(symbol, startTime, endTime, limit, offset);
    res.json(data);
  } catch (error) {
    console.error("Error fetching parquet data:", error);
    res.status(500).json({ error: "Failed to fetch parquet data" });
  }
});

// Get aggregated parquet data with server-side timeframe aggregation
// Uses pre-aggregated files if available for instant loading
router.get("/parquet/:symbol/aggregated", async (req: Request, res: Response) => {
  try {
    const symbol = getString(req.params.symbol).toUpperCase();
    const timeframe = req.query.timeframe ? parseInt(getString(req.query.timeframe as string)) : 1;
    const startTime = req.query.startTime ? parseInt(getString(req.query.startTime as string)) : undefined;
    const endTime = req.query.endTime ? parseInt(getString(req.query.endTime as string)) : undefined;
    const requestedLimit = req.query.limit ? parseInt(getString(req.query.limit as string)) : 2000;
    const limit = Math.min(requestedLimit, 5000);

    // Use pre-aggregated files if available (much faster)
    const { queryPreAggregatedParquet, hasPreAggregatedFiles } = await import("../duckdb");

    if (hasPreAggregatedFiles(symbol)) {
      const data = await queryPreAggregatedParquet(symbol, timeframe, startTime, endTime, limit);
      res.json(data);
    } else {
      // Fall back to on-the-fly aggregation
      const data = await queryParquetOHLCVAggregated(symbol, timeframe, startTime, endTime, limit, 0);
      res.json(data);
    }
  } catch (error) {
    console.error("Error fetching aggregated parquet data:", error);
    res.status(500).json({ error: "Failed to fetch aggregated parquet data" });
  }
});

// Export PostgreSQL data to Parquet file for fast DuckDB queries
router.post("/parquet/:symbol/export", async (req: Request, res: Response) => {
  try {
    const symbol = getString(req.params.symbol).toUpperCase();
    const { exportPostgresToParquet } = await import("../duckdb");
    const { db } = await import("../db");

    console.log(`[routes] Exporting ${symbol} from PostgreSQL to Parquet...`);
    const outputPath = await exportPostgresToParquet(symbol, db);

    res.json({
      success: true,
      symbol,
      path: outputPath,
      message: `Exported ${symbol} data to Parquet format for fast loading`
    });
  } catch (error: any) {
    console.error("Error exporting to parquet:", error);
    res.status(500).json({ error: error.message || "Failed to export data" });
  }
});

// Trigger pre-aggregation for a symbol (creates timeframe-specific parquet files)
router.post("/parquet/:symbol/pre-aggregate", async (req: Request, res: Response) => {
  try {
    const symbol = getString(req.params.symbol).toUpperCase();
    const { createPreAggregatedParquetFiles } = await import("../duckdb");

    console.log(`[routes] Starting pre-aggregation for ${symbol}...`);
    const result = await createPreAggregatedParquetFiles(symbol);

    res.json({
      success: true,
      symbol,
      timeframes: result.timeframes,
      rollovers: result.rolloverInfo.length
    });
  } catch (error: any) {
    console.error("Error pre-aggregating parquet data:", error);
    res.status(500).json({ error: error.message || "Failed to pre-aggregate data" });
  }
});

// Fast cursor-based pagination for large datasets (optimized for infinite scroll)
router.get("/parquet/:symbol/cursor", async (req: Request, res: Response) => {
  try {
    const symbol = getString(req.params.symbol).toUpperCase();

    // Validate cursor - must be a valid integer timestamp or undefined
    let cursor: number | undefined;
    if (req.query.cursor) {
      const parsedCursor = parseInt(getString(req.query.cursor as string), 10);
      if (isNaN(parsedCursor) || parsedCursor < 0) {
        return res.status(400).json({ error: "Invalid cursor: must be a positive integer timestamp" });
      }
      cursor = parsedCursor;
    }

    // Validate limit - must be a positive integer up to 5000
    let limit = 1000;
    if (req.query.limit) {
      const parsedLimit = parseInt(getString(req.query.limit as string), 10);
      if (isNaN(parsedLimit) || parsedLimit < 1) {
        return res.status(400).json({ error: "Invalid limit: must be a positive integer" });
      }
      limit = Math.min(parsedLimit, 5000);
    }

    const direction = (req.query.direction as string) === 'backward' ? 'backward' : 'forward';

    const { queryOHLCVCursor } = await import("../duckdb");
    const result = await queryOHLCVCursor(symbol, cursor, limit, direction);

    res.json(result);
  } catch (error) {
    console.error("Error fetching cursor data:", error);
    res.status(500).json({ error: "Failed to fetch cursor data" });
  }
});

// Fast stats endpoint for dataset overview
router.get("/parquet/:symbol/quick-stats", async (req: Request, res: Response) => {
  try {
    const symbol = getString(req.params.symbol).toUpperCase();
    const { computeOHLCVStats } = await import("../duckdb");
    const stats = await computeOHLCVStats(symbol);
    res.json(stats);
  } catch (error) {
    console.error("Error computing stats:", error);
    res.status(500).json({ error: "Failed to compute stats" });
  }
});

// Get rollover info for a symbol from DuckDB rollovers table
router.get("/parquet/:symbol/rollovers", async (req: Request, res: Response) => {
  try {
    const symbol = getString(req.params.symbol).toUpperCase();
    const { marketQuery } = await import("../duckdb/market");

    const rollovers = await marketQuery(`
      SELECT
        CAST(epoch_ms(rollover_date::TIMESTAMP) AS DOUBLE) as timestamp,
        from_contract as "fromContract",
        to_contract as "toContract",
        price_gap as "priceAdjustment",
        cumulative_adjustment as "cumulativeAdjustment"
      FROM rollovers
      WHERE root = '${symbol}'
      ORDER BY rollover_date
    `);
    res.json(rollovers);
  } catch (error) {
    console.error("Error fetching rollover info:", error);
    res.status(500).json({ error: "Failed to fetch rollover info" });
  }
});

router.get("/parquet/storage", async (req: Request, res: Response) => {
  try {
    const { parquetStorage } = await import("../lib/parquetStorage");
    const [localFiles, diskUsage] = await Promise.all([
      parquetStorage.listLocalFiles(),
      Promise.resolve(parquetStorage.getLocalDiskUsage())
    ]);

    res.json({
      local: {
        files: localFiles,
        ...diskUsage
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
