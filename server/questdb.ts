import { Sender } from "@questdb/nodejs-client";
import pg from "pg";
import * as path from "path";
import { validateSymbol } from "@shared/schema";

const { Pool } = pg;

const QUESTDB_HOST = process.env.QUESTDB_HOST || "localhost";
const QUESTDB_ILP_PORT = process.env.QUESTDB_ILP_PORT || "9009";
const QUESTDB_PG_PORT = process.env.QUESTDB_PG_PORT || "8812";
const QUESTDB_HTTP_PORT = process.env.QUESTDB_HTTP_PORT || "9000";

let sender: Sender | null = null;
let queryPool: pg.Pool | null = null;

export async function getQuestDBSender(): Promise<Sender> {
  if (!sender) {
    const configStr = `http::addr=${QUESTDB_HOST}:${QUESTDB_HTTP_PORT};`;
    sender = await Sender.fromConfig(configStr);
  }
  return sender;
}

export function getQuestDBQueryPool(): pg.Pool {
  if (!queryPool) {
    queryPool = new Pool({
      host: QUESTDB_HOST,
      port: parseInt(QUESTDB_PG_PORT),
      database: "qdb",
      user: "admin",
      password: "quest",
      max: 10,
      connectionTimeoutMillis: 3000,
      idleTimeoutMillis: 30000,
      statement_timeout: 10000,
    });
    queryPool.on("error", (err) => {
      console.error("[questdb] Idle client error:", err.message);
    });
  }
  return queryPool;
}

export async function queryQuestDB<T = any>(sql: string): Promise<T[]> {
  const pool = getQuestDBQueryPool();
  const result = await pool.query(sql);
  return result.rows as T[];
}

export interface OHLCVRow {
  symbol: string;
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export async function insertOHLCVBatch(rows: OHLCVRow[]): Promise<void> {
  const sender = await getQuestDBSender();
  
  for (const row of rows) {
    await sender
      .table("ohlcv")
      .symbol("symbol", row.symbol)
      .floatColumn("open", row.open)
      .floatColumn("high", row.high)
      .floatColumn("low", row.low)
      .floatColumn("close", row.close)
      .floatColumn("volume", row.volume)
      .at(row.timestamp.getTime(), "ms");
  }
  
  await sender.flush();
}

export async function insertOHLCVStream(
  symbol: string,
  timestamp: number,
  open: number,
  high: number,
  low: number,
  close: number,
  volume: number
): Promise<void> {
  const sender = await getQuestDBSender();
  
  await sender
    .table("ohlcv")
    .symbol("symbol", symbol)
    .floatColumn("open", open)
    .floatColumn("high", high)
    .floatColumn("low", low)
    .floatColumn("close", close)
    .floatColumn("volume", volume)
    .at(timestamp, "ms");
  
  await sender.flush();
}

// Validate table name to prevent SQL injection
function validateTableName(tableName: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/.test(tableName)) {
    throw new Error("Invalid table name format");
  }
  return tableName;
}

// Validate positive integer
function validatePositiveInt(value: number | undefined, maxValue: number = 1000000): number {
  if (value === undefined) return 0;
  const intVal = Math.floor(value);
  if (isNaN(intVal) || intVal < 0 || intVal > maxValue) {
    throw new Error("Invalid numeric value");
  }
  return intVal;
}

/**
 * Materialized view lookup — pre-computed SAMPLE BY aggregations.
 * For these timeframes we query the view directly (no SAMPLE BY needed).
 * Views auto-refresh on new inserts into the base ohlcv table.
 */
const MATERIALIZED_VIEWS: Record<string, string> = {
  "5m": "ohlcv_5m",
  "15m": "ohlcv_15m",
  "30m": "ohlcv_30m",
  "1h": "ohlcv_1h",
  "4h": "ohlcv_4h",
  "1d": "ohlcv_1d",
  "1w": "ohlcv_1w",
};

export async function getOHLCVSampleBy(
  symbol: string,
  timeframe: string,
  startTime?: number,
  endTime?: number,
  limit?: number
): Promise<any[]> {
  // Validate inputs to prevent SQL injection
  const safeSymbol = validateSymbol(symbol);
  const safeStartTime = startTime ? validatePositiveInt(startTime, Number.MAX_SAFE_INTEGER) : undefined;
  const safeEndTime = endTime ? validatePositiveInt(endTime, Number.MAX_SAFE_INTEGER) : undefined;
  const safeLimit = limit ? validatePositiveInt(limit, 100000) : undefined;

  // Build WHERE clause with escaped symbol
  const escapedSymbol = safeSymbol.replace(/'/g, "''");
  let whereClause = `WHERE symbol = '${escapedSymbol}'`;
  if (safeStartTime) {
    whereClause += ` AND timestamp >= '${new Date(safeStartTime).toISOString()}'`;
  }
  if (safeEndTime) {
    whereClause += ` AND timestamp <= '${new Date(safeEndTime).toISOString()}'`;
  }

  const limitClause = safeLimit ? `LIMIT ${safeLimit}` : "";

  // Check if a materialized view exists for this timeframe
  const matView = MATERIALIZED_VIEWS[timeframe];
  if (matView) {
    // Query pre-computed materialized view directly — no SAMPLE BY needed
    const sql = `
      SELECT symbol, timestamp, open, high, low, close, volume
      FROM ${matView}
      ${whereClause}
      ORDER BY timestamp
      ${limitClause}
    `;
    const rows = await queryQuestDB(sql);
    // If view is still backfilling and returned 0 rows, fall back to SAMPLE BY
    if (rows.length > 0) return rows;
  }

  // Fallback: SAMPLE BY on the base ohlcv table (used for 1s, 1m, or when views are empty)
  const validTimeframes: Record<string, string> = {
    "1s": "SAMPLE BY 1s",
    "1m": "SAMPLE BY 1m",
    "5m": "SAMPLE BY 5m",
    "15m": "SAMPLE BY 15m",
    "30m": "SAMPLE BY 30m",
    "1h": "SAMPLE BY 1h",
    "4h": "SAMPLE BY 4h",
    "1d": "SAMPLE BY 1d",
    "1w": "SAMPLE BY 7d",
  };

  const sampleByClause = validTimeframes[timeframe] || "SAMPLE BY 1m";

  const sql = `
    SELECT
      symbol,
      timestamp,
      first(open) as open,
      max(high) as high,
      min(low) as low,
      last(close) as close,
      sum(volume) as volume
    FROM ohlcv
    ${whereClause}
    ${sampleByClause}
    ALIGN TO CALENDAR
    ${limitClause}
  `;

  return await queryQuestDB(sql);
}

export async function createOHLCVTable(): Promise<void> {
  const sql = `
    CREATE TABLE IF NOT EXISTS ohlcv (
      symbol SYMBOL CAPACITY 50 CACHE INDEX,
      timestamp TIMESTAMP,
      open DOUBLE,
      high DOUBLE,
      low DOUBLE,
      close DOUBLE,
      volume DOUBLE
    ) timestamp(timestamp) PARTITION BY DAY WAL
    DEDUP UPSERT KEYS(symbol, timestamp);
  `;

  await queryQuestDB(sql);
}

export async function createTradesTable(): Promise<void> {
  await queryQuestDB(`
    CREATE TABLE IF NOT EXISTS trades (
      ts_event TIMESTAMP,
      rtype SHORT,
      publisher_id INT,
      instrument_id LONG,
      action SYMBOL CAPACITY 10 CACHE,
      side SYMBOL CAPACITY 10 CACHE,
      depth SHORT,
      price DOUBLE,
      size LONG,
      flags SHORT,
      ts_in_delta INT,
      sequence LONG,
      symbol SYMBOL CAPACITY 200 CACHE INDEX,
      ts_recv TIMESTAMP
    ) timestamp(ts_event) PARTITION BY DAY WAL
    DEDUP UPSERT KEYS(symbol, ts_event, sequence);
  `);
}

export async function createMBP10Table(): Promise<void> {
  const bookLevels = Array.from({ length: 10 }, (_, i) => {
    const pad = String(i).padStart(2, '0');
    return `bid_px_${pad} DOUBLE, ask_px_${pad} DOUBLE, bid_sz_${pad} LONG, ask_sz_${pad} LONG, bid_ct_${pad} INT, ask_ct_${pad} INT`;
  }).join(',\n      ');

  await queryQuestDB(`
    CREATE TABLE IF NOT EXISTS mbp10 (
      ts_recv TIMESTAMP,
      ts_event TIMESTAMP,
      rtype SHORT,
      publisher_id INT,
      instrument_id LONG,
      action SYMBOL CAPACITY 10 CACHE,
      side SYMBOL CAPACITY 10 CACHE,
      depth SHORT,
      price DOUBLE,
      size LONG,
      flags SHORT,
      ts_in_delta INT,
      sequence LONG,
      ${bookLevels},
      symbol SYMBOL CAPACITY 200 CACHE INDEX
    ) timestamp(ts_event) PARTITION BY DAY WAL
    DEDUP UPSERT KEYS(symbol, ts_event, sequence);
  `);
}

export async function getQuestDBTables(): Promise<any[]> {
  const sql = "SHOW TABLES;";
  return await queryQuestDB(sql);
}

export async function getQuestDBTableInfo(tableName: string): Promise<any[]> {
  // Validate table name to prevent SQL injection
  const safeTableName = validateTableName(tableName);
  const sql = `SHOW COLUMNS FROM ${safeTableName};`;
  return await queryQuestDB(sql);
}

export async function getQuestDBPartitions(tableName: string): Promise<any[]> {
  // Validate table name to prevent SQL injection
  const safeTableName = validateTableName(tableName);
  const escapedName = safeTableName.replace(/'/g, "''");
  const sql = `SELECT * FROM table_partitions('${escapedName}');`;
  return await queryQuestDB(sql);
}

export async function getQuestDBTableRowCount(tableName: string): Promise<number> {
  // Validate table name to prevent SQL injection
  const safeTableName = validateTableName(tableName);
  const result = await queryQuestDB<{ count: string }>(`SELECT count() as count FROM ${safeTableName};`);
  return parseInt(result[0]?.count || "0");
}

export async function getQuestDBTablePreview(tableName: string, limit = 100): Promise<any[]> {
  // Validate inputs to prevent SQL injection
  const safeTableName = validateTableName(tableName);
  const safeLimit = validatePositiveInt(limit, 1000);
  const sql = `SELECT * FROM ${safeTableName} LIMIT ${safeLimit};`;
  return await queryQuestDB(sql);
}

export async function closeQuestDB(): Promise<void> {
  if (sender) {
    await sender.close();
    sender = null;
  }
  if (queryPool) {
    await queryPool.end();
    queryPool = null;
  }
}

export async function checkQuestDBHealth(): Promise<boolean> {
  try {
    const pool = getQuestDBQueryPool();
    // Race against a 3-second timeout to prevent hanging
    await Promise.race([
      pool.query("SELECT 1;"),
      new Promise((_, reject) => setTimeout(() => reject(new Error('QuestDB health check timeout')), 3000)),
    ]);
    return true;
  } catch (error: any) {
    console.warn("[questdb] Health check failed:", error.message);
    return false;
  }
}

export async function getQuestDBStats(): Promise<any> {
  try {
    const tables = await getQuestDBTables();
    const stats: any = {
      connected: true,
      tables: tables.length,
      tableDetails: [],
    };
    
    for (const table of tables) {
      const tableName = table.table_name || table.name || table.tableName;
      if (tableName) {
        try {
          const rowCount = await getQuestDBTableRowCount(tableName);
          const partitions = await getQuestDBPartitions(tableName);
          stats.tableDetails.push({
            name: tableName,
            rowCount,
            partitionCount: partitions.length,
          });
        } catch (e) {
          stats.tableDetails.push({
            name: tableName,
            error: String(e),
          });
        }
      }
    }
    
    return stats;
  } catch (error) {
    return {
      connected: false,
      error: String(error),
    };
  }
}

const DEFAULT_PARQUET_OUTPUT_DIR = path.join(process.cwd(), 'data', 'parquet-data');

export async function exportQuestDBToParquet(
  symbol: string,
  timeframe: string = "1m",
  outputDir: string = DEFAULT_PARQUET_OUTPUT_DIR
): Promise<{ path: string; rowCount: number }> {
  const safeSymbol = validateSymbol(symbol);
  const fs = await import('fs');
  const nodePath = await import('path');
  
  fs.mkdirSync(outputDir, { recursive: true });
  
  const data = await getOHLCVSampleBy(safeSymbol, timeframe);
  
  if (data.length === 0) {
    throw new Error(`No data found for symbol ${safeSymbol} in QuestDB`);
  }
  
  const outputPath = nodePath.join(outputDir, `${safeSymbol}_${timeframe}.parquet`);
  
  const { runQuery } = await import('./duckdb');
  
  const tableData = data.map(row => ({
    symbol: row.symbol,
    timestamp: new Date(row.timestamp).getTime(),
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    volume: Number(row.volume)
  }));
  
  const tempTableName = `temp_${safeSymbol}_${Date.now()}`;
  
  await runQuery(`
    CREATE TABLE ${tempTableName} (
      symbol VARCHAR,
      timestamp BIGINT,
      open DOUBLE,
      high DOUBLE,
      low DOUBLE,
      close DOUBLE,
      volume DOUBLE
    )
  `);
  
  const batchSize = 5000;
  for (let i = 0; i < tableData.length; i += batchSize) {
    const batch = tableData.slice(i, i + batchSize);
    const values = batch.map(row => 
      `('${row.symbol}', ${row.timestamp}, ${row.open}, ${row.high}, ${row.low}, ${row.close}, ${row.volume})`
    ).join(',');
    
    await runQuery(`INSERT INTO ${tempTableName} VALUES ${values}`);
  }
  
  await runQuery(`COPY ${tempTableName} TO '${outputPath}' (FORMAT PARQUET)`);
  await runQuery(`DROP TABLE ${tempTableName}`);
  
  console.log(`[QuestDB] Exported ${data.length} rows for ${safeSymbol} (${timeframe}) to ${outputPath}`);
  
  return { path: outputPath, rowCount: data.length };
}

export async function getSymbolsInQuestDB(): Promise<string[]> {
  const sql = `SELECT DISTINCT symbol FROM ohlcv`;
  const result = await queryQuestDB<{ symbol: string }>(sql);
  return result.map(r => r.symbol);
}

export async function getSymbolStats(symbol: string): Promise<{
  symbol: string;
  rowCount: number;
  earliest: Date;
  latest: Date;
  timeSpanDays: number;
}> {
  const safeSymbol = validateSymbol(symbol);
  const escapedSymbol = safeSymbol.replace(/'/g, "''");
  
  const sql = `
    SELECT 
      symbol,
      count() as row_count,
      min(timestamp) as earliest,
      max(timestamp) as latest
    FROM ohlcv 
    WHERE symbol = '${escapedSymbol}'
  `;
  
  const result = await queryQuestDB<any>(sql);
  
  if (result.length === 0 || !result[0].row_count) {
    throw new Error(`No data found for symbol ${safeSymbol}`);
  }
  
  const row = result[0];
  const earliest = new Date(row.earliest);
  const latest = new Date(row.latest);
  const timeSpanDays = (latest.getTime() - earliest.getTime()) / (1000 * 60 * 60 * 24);
  
  return {
    symbol: row.symbol,
    rowCount: parseInt(row.row_count),
    earliest,
    latest,
    timeSpanDays: Math.round(timeSpanDays * 100) / 100
  };
}
