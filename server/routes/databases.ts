import { Router, Request, Response } from "express";
import { storage } from "../storage";
import * as path from "path";
import { queryRateLimiter } from "../lib/rateLimiter";
import { getString } from "./helpers";

const DATA_DIR = path.join(process.cwd(), "data");

const router = Router();

// ============================================================
// DATABASE EXPLORER API ENDPOINTS
// ============================================================

// PostgreSQL Stats
router.get("/databases/postgres/stats", async (req: Request, res: Response) => {
  try {
    const pool = (await import("../db")).pool;

    // Get all tables with row counts
    const tablesResult = await pool.query(`
      SELECT
        table_name,
        (SELECT count(*) FROM information_schema.columns WHERE table_name = t.table_name) as column_count
      FROM information_schema.tables t
      WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);

    const tableDetails = [];
    for (const table of tablesResult.rows) {
      try {
        const countResult = await pool.query(`SELECT count(*) as count FROM "${table.table_name}"`);
        const columnsResult = await pool.query(`
          SELECT column_name, data_type, is_nullable
          FROM information_schema.columns
          WHERE table_name = $1
          ORDER BY ordinal_position
        `, [table.table_name]);

        tableDetails.push({
          name: table.table_name,
          rowCount: parseInt(countResult.rows[0]?.count || "0"),
          type: "table",
          columns: columnsResult.rows.map((c: any) => ({
            name: c.column_name,
            type: c.data_type,
            nullable: c.is_nullable === "YES",
          })),
        });
      } catch (e) {
        tableDetails.push({
          name: table.table_name,
          rowCount: 0,
          error: String(e),
        });
      }
    }

    // Also get views
    const viewsResult = await pool.query(`
      SELECT table_name
      FROM information_schema.views
      WHERE table_schema = 'public'
    `);

    for (const view of viewsResult.rows) {
      try {
        const countResult = await pool.query(`SELECT count(*) as count FROM "${view.table_name}"`);
        tableDetails.push({
          name: view.table_name,
          rowCount: parseInt(countResult.rows[0]?.count || "0"),
          type: "view",
        });
      } catch (e) {
        tableDetails.push({
          name: view.table_name,
          rowCount: 0,
          type: "view",
          error: String(e),
        });
      }
    }

    // Get materialized views
    const matViewsResult = await pool.query(`
      SELECT matviewname as name FROM pg_matviews WHERE schemaname = 'public'
    `);

    for (const mv of matViewsResult.rows) {
      try {
        const countResult = await pool.query(`SELECT count(*) as count FROM "${mv.name}"`);
        tableDetails.push({
          name: mv.name,
          rowCount: parseInt(countResult.rows[0]?.count || "0"),
          type: "materialized view",
        });
      } catch (e) {
        tableDetails.push({
          name: mv.name,
          rowCount: 0,
          type: "materialized view",
          error: String(e),
        });
      }
    }

    res.json({
      connected: true,
      tables: tableDetails.length,
      tableDetails,
    });
  } catch (error: any) {
    res.json({
      connected: false,
      tables: 0,
      tableDetails: [],
      error: error.message,
    });
  }
});

// QuestDB Stats
router.get("/databases/questdb/stats", async (req: Request, res: Response) => {
  try {
    const { getQuestDBStats } = await import("../questdb");
    const stats = await getQuestDBStats();
    res.json(stats);
  } catch (error: any) {
    res.json({
      connected: false,
      tables: 0,
      tableDetails: [],
      error: error.message,
    });
  }
});

// DuckDB Stats
router.get("/databases/duckdb/stats", async (req: Request, res: Response) => {
  try {
    const { getDuckDBStats, listParquetFiles } = await import("../duckdb");
    const parquetFiles = await listParquetFiles();

    // Get DuckDB stats if the function exists, otherwise return basic info
    let stats;
    if (typeof getDuckDBStats === 'function') {
      stats = await getDuckDBStats();
    } else {
      stats = {
        connected: true,
        tables: parquetFiles.length,
        tableDetails: parquetFiles.map((f: any) => ({
          name: f.filename || f,
          rowCount: f.rowCount || 0,
          type: "parquet",
        })),
      };
    }

    res.json(stats);
  } catch (error: any) {
    res.json({
      connected: false,
      tables: 0,
      tableDetails: [],
      error: error.message,
    });
  }
});

// Helper function to validate table/identifier names (prevent SQL injection)
const isValidIdentifier = (name: string): boolean => {
  // Only allow alphanumeric, underscore, dot (for schema.table), and hyphen
  // Max length 128 characters
  return /^[a-zA-Z_][a-zA-Z0-9_.\-]{0,127}$/.test(name);
};

// Helper to sanitize SQL for read-only operations
const isSafeReadOnlyQuery = (sql: string): { safe: boolean; error?: string } => {
  const normalizedSql = sql.trim().toUpperCase();

  // Must start with SELECT, SHOW, DESCRIBE, or EXPLAIN
  if (!normalizedSql.startsWith('SELECT') &&
      !normalizedSql.startsWith('SHOW') &&
      !normalizedSql.startsWith('DESCRIBE') &&
      !normalizedSql.startsWith('EXPLAIN')) {
    return { safe: false, error: "Only SELECT, SHOW, DESCRIBE, and EXPLAIN queries are allowed" };
  }

  // Block dangerous keywords anywhere in query
  const dangerousPatterns = /\b(DROP|DELETE|TRUNCATE|ALTER|GRANT|REVOKE|INSERT|UPDATE|CREATE|EXEC|EXECUTE|CALL|SET|INTO)\b/i;
  if (dangerousPatterns.test(sql)) {
    return { safe: false, error: "Destructive or modifying queries are not allowed" };
  }

  // Block multiple statements (semicolon followed by non-whitespace)
  if (/;\s*[^\s]/.test(sql)) {
    return { safe: false, error: "Multiple statements are not allowed" };
  }

  // Block filesystem functions in DuckDB (read_csv, read_parquet with arbitrary paths)
  // Only allow reading from the local parquet data directory
  const parquetDataDir = path.join(DATA_DIR, "parquet-data").replace(/\\/g, '/');
  const filePatterns = new RegExp(`\\b(read_csv|read_json|read_parquet)\\s*\\(\\s*['"](?!${parquetDataDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'i');
  if (filePatterns.test(sql)) {
    return { safe: false, error: `Filesystem access is restricted to ${parquetDataDir} directory` };
  }

  return { safe: true };
};

// Table preview with proper validation
router.get("/databases/preview/:db/:table", async (req: Request, res: Response) => {
  try {
    const db = getString(req.params.db);
    const table = getString(req.params.table);
    const limit = Math.min(Math.max(1, parseInt(req.query.limit as string) || 100), 1000);

    // Validate database parameter
    if (!['postgres', 'questdb', 'duckdb'].includes(db)) {
      return res.status(400).json({ error: "Invalid database specified" });
    }

    // Validate table name to prevent SQL injection
    if (!isValidIdentifier(table)) {
      return res.status(400).json({ error: "Invalid table name" });
    }

    let rows: any[] = [];

    if (db === "postgres") {
      const pool = (await import("../db")).pool;
      // Use parameterized query for limit, escape table name properly
      const escapedTable = table.replace(/"/g, '""');
      const result = await pool.query(`SELECT * FROM "${escapedTable}" LIMIT $1`, [limit]);
      rows = result.rows;
    } else if (db === "questdb") {
      const { queryQuestDB } = await import("../questdb");
      // QuestDB table names validated above
      const escapedTable = table.replace(/'/g, "''");
      rows = await queryQuestDB(`SELECT * FROM '${escapedTable}' LIMIT ${limit}`);
    } else if (db === "duckdb") {
      const { queryParquet } = await import("../duckdb");
      if (typeof queryParquet === 'function') {
        // For DuckDB, only allow accessing files in the local parquet data dir
        const safePath = path.join(DATA_DIR, "parquet-data", table);
        if (!table.endsWith('.parquet')) {
          return res.status(400).json({ error: "Only .parquet files can be previewed in DuckDB" });
        }
        rows = await queryParquet(`SELECT * FROM read_parquet('${safePath.replace(/'/g, "''")}') LIMIT ${limit}`);
      }
    }

    res.json({ rows, count: rows.length });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Execute custom query with strict validation
router.post("/databases/query", async (req: Request, res: Response) => {
  try {
    const { db, sql } = req.body;

    if (!sql || typeof sql !== "string") {
      return res.status(400).json({ error: "SQL query required" });
    }

    if (sql.length > 10000) {
      return res.status(400).json({ error: "Query too long (max 10000 characters)" });
    }

    // Validate database parameter
    if (!['postgres', 'questdb', 'duckdb'].includes(db)) {
      return res.status(400).json({ error: "Invalid database specified" });
    }

    // Validate query is safe (read-only)
    const validation = isSafeReadOnlyQuery(sql);
    if (!validation.safe) {
      return res.status(403).json({ error: validation.error });
    }

    let rows: any[] = [];
    let rowCount = 0;

    if (db === "postgres") {
      const pool = (await import("../db")).pool;
      const client = await pool.connect();
      try {
        await client.query('BEGIN TRANSACTION READ ONLY');
        const result = await client.query(sql);
        rows = result.rows;
        rowCount = result.rowCount || 0;
        await client.query('COMMIT');
      } catch (pgErr) {
        await client.query('ROLLBACK').catch(() => {});
        throw pgErr;
      } finally {
        client.release();
      }
    } else if (db === "questdb") {
      const { queryQuestDB } = await import("../questdb");
      rows = await queryQuestDB(sql);
      rowCount = rows.length;
    } else if (db === "duckdb") {
      const { executeDuckDBQuery } = await import("../duckdb");
      if (typeof executeDuckDBQuery === 'function') {
        rows = await executeDuckDBQuery(sql);
        rowCount = rows.length;
      } else {
        return res.status(400).json({ error: "DuckDB query execution not available" });
      }
    }

    // Limit result size
    if (rows.length > 10000) {
      rows = rows.slice(0, 10000);
      rowCount = rows.length;
    }

    res.json({ rows, rowCount });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Initialize QuestDB OHLCV table
router.post("/databases/questdb/init", async (req: Request, res: Response) => {
  try {
    const { createOHLCVTable } = await import("../questdb");
    await createOHLCVTable();
    res.json({ success: true, message: "QuestDB OHLCV table created" });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// OHLCV DATA ENDPOINT
// ============================================================

// Get OHLCV data for a symbol within a time range (query rate limited)
router.get("/ohlcv/:symbol", queryRateLimiter, async (req: Request, res: Response) => {
  try {
    const symbol = getString(req.params.symbol);
    const startTime = getString(req.query.startTime as string);
    const endTime = getString(req.query.endTime as string);
    const limit = getString(req.query.limit as string);
    const timeframe = req.query.timeframe as string; // e.g., "1m", "5m", "1h"

    // Parse timeframe to seconds (default 60 = 1 minute)
    let timeframeSec = 60;
    if (timeframe) {
      const match = timeframe.match(/^(\d+)(s|m|h|d)?$/);
      if (match) {
        const val = parseInt(match[1]);
        const unit = match[2] || 'm';
        timeframeSec = unit === 's' ? val : unit === 'm' ? val * 60 : unit === 'h' ? val * 3600 : val * 86400;
      }
    }

    const limitNum = limit ? parseInt(limit) : 500;

    // Check asset type to route to correct table directly (forex in legacy, futures in partitioned)
    // Forex pairs are 6 characters made of currency codes - detect dynamically
    const forexCurrencies = ['EUR', 'USD', 'GBP', 'JPY', 'AUD', 'NZD', 'CAD', 'CHF'];
    const isForex = symbol.length === 6 &&
      forexCurrencies.includes(symbol.slice(0, 3)) &&
      forexCurrencies.includes(symbol.slice(3, 6));

    // Handle range queries with server-side aggregation for infinite scroll
    if (startTime || endTime) {
      let data;
      const rangeOpts = {
        startTime: startTime ? parseInt(startTime) : undefined,
        endTime: endTime ? parseInt(endTime) : undefined,
        limit: limitNum,
        timeframeSeconds: timeframeSec
      };

      if (isForex) {
        // Try TimescaleDB forex_1m first, fall back to legacy
        data = await storage.getForexTimescaleRange(symbol, rangeOpts);
        if (data.length === 0) {
          data = await storage.getOhlcvAggregatedRange(symbol, rangeOpts);
        }
      } else {
        // Try TimescaleDB ohlcv_1s first, fall back to partitioned, then legacy
        data = await storage.getFuturesTimescaleRange(symbol, rangeOpts);
        if (data.length === 0) {
          data = await storage.getOhlcvPartitionedRange(symbol, rangeOpts);
        }
        if (data.length === 0) {
          data = await storage.getOhlcvAggregatedRange(symbol, rangeOpts);
        }
      }

      return res.json(data);
    }

    // No time params - get latest data
    let data;
    if (isForex) {
      // Try TimescaleDB forex_1m first, fall back to legacy
      data = await storage.getForexTimescale(symbol, limitNum, timeframeSec);
      if (data.length === 0) {
        data = await storage.getOhlcvAggregated(symbol, limitNum, timeframeSec);
      }
    } else {
      // Try TimescaleDB ohlcv_1s first, fall back to partitioned, then legacy
      data = await storage.getFuturesTimescale(symbol, limitNum, timeframeSec);
      if (data.length === 0) {
        data = await storage.getOhlcvPartitioned(symbol, limitNum, timeframeSec);
      }
      if (data.length === 0) {
        data = await storage.getOhlcvAggregated(symbol, limitNum, timeframeSec);
      }
    }
    res.json(data.reverse());
  } catch (error) {
    console.error("Error fetching OHLCV data:", error);
    res.status(500).json({ error: "Failed to fetch data" });
  }
});

// ============================================================
// MONITORING & HEALTH ENDPOINTS
// ============================================================

router.get("/health", async (req: Request, res: Response) => {
  try {
    const { runHealthChecks } = await import("../lib/databaseHealth");
    const health = await runHealthChecks();
    res.json(health);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/metrics", async (req: Request, res: Response) => {
  try {
    const { pipelineMetrics } = await import("../lib/metrics");
    const { getAllCircuitBreakerStats } = await import("../lib/circuitBreaker");

    res.json({
      pipeline: pipelineMetrics.getSnapshot(),
      circuitBreakers: getAllCircuitBreakerStats(),
      timestamp: Date.now()
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/rate-limits", async (req: Request, res: Response) => {
  try {
    const { getRateLimitStats } = await import("../lib/rateLimiter");
    res.json(getRateLimitStats());
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/circuit-breaker/reset/:name", async (req: Request, res: Response) => {
  try {
    const name = getString(req.params.name);
    const { resetCircuitBreaker } = await import("../lib/circuitBreaker");
    const success = resetCircuitBreaker(name);
    res.json({ success, name });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/circuit-breaker/reset-all", async (req: Request, res: Response) => {
  try {
    const { resetAllCircuitBreakers } = await import("../lib/circuitBreaker");
    const reset = resetAllCircuitBreakers();
    res.json({ success: true, reset });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// DATA PIPELINE ENDPOINTS
// ============================================================

router.get("/pipeline/status", async (req: Request, res: Response) => {
  try {
    const { dataPipeline } = await import("../lib/dataPipeline");
    res.json({
      config: dataPipeline.getConfig(),
      stats: dataPipeline.getStats(),
      activeJobs: dataPipeline.getActiveJobs(),
      queuedJobs: dataPipeline.getQueuedJobs()
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/pipeline/jobs", async (req: Request, res: Response) => {
  try {
    const { dataPipeline } = await import("../lib/dataPipeline");
    const limit = parseInt(req.query.limit as string) || 20;
    res.json(dataPipeline.getRecentJobs(limit));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/pipeline/jobs", async (req: Request, res: Response) => {
  try {
    const { dataPipeline } = await import("../lib/dataPipeline");
    const { type, symbol } = req.body;
    if (!type || !symbol) {
      return res.status(400).json({ error: "type and symbol required" });
    }
    const job = dataPipeline.createJob(type, symbol);
    res.json(job);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/pipeline/sources/:symbol", async (req: Request, res: Response) => {
  try {
    const { dataPipeline } = await import("../lib/dataPipeline");
    const symbol = req.params.symbol as string;
    const sources = await dataPipeline.checkDataSources(symbol);
    res.json(sources);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// QUESTDB INTEGRATION ENDPOINTS
// ============================================================

router.post("/questdb/:symbol/export-parquet", async (req: Request, res: Response) => {
  try {
    const symbol = getString(req.params.symbol).toUpperCase();
    const timeframe = req.body?.timeframe || "1m";

    const { exportQuestDBToParquet } = await import("../questdb");

    console.log(`[routes] Exporting ${symbol} (${timeframe}) from QuestDB to Parquet...`);
    const result = await exportQuestDBToParquet(symbol, timeframe);

    res.json({
      success: true,
      symbol,
      timeframe,
      path: result.path,
      rowCount: result.rowCount
    });
  } catch (error: any) {
    console.error("Error exporting QuestDB to parquet:", error);
    res.status(500).json({ error: error.message || "Failed to export QuestDB data" });
  }
});

// Get symbols available in QuestDB
router.get("/questdb/symbols", async (req: Request, res: Response) => {
  try {
    const { getSymbolsInQuestDB } = await import("../questdb");
    const symbols = await getSymbolsInQuestDB();
    res.json({ symbols });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to get symbols" });
  }
});

// Get symbol stats from QuestDB
router.get("/questdb/:symbol/stats", async (req: Request, res: Response) => {
  try {
    const symbol = getString(req.params.symbol).toUpperCase();
    const { getSymbolStats } = await import("../questdb");
    const stats = await getSymbolStats(symbol);
    res.json(stats);
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to get symbol stats" });
  }
});

router.get("/questdb/status", async (req: Request, res: Response) => {
  try {
    const { getQuestDBStatus } = await import("../lib/questdbIntegration");
    const { getQuestDBStatus: getProcessStatus } = await import("../lib/questdbProcess");
    const [integrationStatus, processStatus] = await Promise.all([
      getQuestDBStatus(),
      Promise.resolve(getProcessStatus())
    ]);
    res.json({ ...integrationStatus, process: processStatus });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/questdb/start", async (req: Request, res: Response) => {
  try {
    const { startQuestDB } = await import("../lib/questdbProcess");
    const result = await startQuestDB();
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/questdb/stop", async (req: Request, res: Response) => {
  try {
    const { stopQuestDB } = await import("../lib/questdbProcess");
    stopQuestDB();
    res.json({ stopped: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/questdb/init", async (req: Request, res: Response) => {
  try {
    const { initializeQuestDB } = await import("../lib/questdbIntegration");
    const result = await initializeQuestDB();
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/questdb/ohlcv/:symbol", queryRateLimiter, async (req: Request, res: Response) => {
  try {
    const symbol = getString(req.params.symbol).toUpperCase();
    const timeframe = getString(req.query.timeframe as string) || '1m';
    const startTime = req.query.startTime ? parseInt(getString(req.query.startTime as string)) : undefined;
    const endTime = req.query.endTime ? parseInt(getString(req.query.endTime as string)) : undefined;
    const limit = req.query.limit ? parseInt(getString(req.query.limit as string)) : undefined;

    const { queryOHLCVFromQuestDB } = await import("../lib/questdbIntegration");
    const result = await queryOHLCVFromQuestDB(symbol, timeframe, startTime || 0, endTime || Date.now(), limit);

    if (!result.success) {
      const pgData = await storage.getOhlcvData(symbol, startTime || 0, endTime || Date.now(), limit || 10000);
      return res.json({ data: pgData, source: 'postgres', questdbError: result.error });
    }

    res.json({ data: result.data, source: result.source });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
