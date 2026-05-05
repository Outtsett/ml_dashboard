import fetch from "node-fetch";
import { Sender } from "@questdb/nodejs-client";
import pg from "pg";
import { z } from "zod";

const { Pool } = pg;

export const QUESTDB_HOST = process.env.QUESTDB_HOST || "localhost";
export const QUESTDB_PG_PORT = process.env.QUESTDB_PG_PORT || "8812";
export const QUESTDB_HTTP_PORT = process.env.QUESTDB_HTTP_PORT || "9000";
export const QUESTDB_USER = process.env.QUESTDB_USER || "admin";
export const QUESTDB_PASSWORD = process.env.QUESTDB_PASSWORD || "quest";

const SLOW_QUERY_THRESHOLD_MS = 1000;

let sender: Sender | null = null;
/**
 * Simple async mutex to prevent concurrent access to the singleton Sender.
 * The QuestDB NodeJS client is NOT thread-safe for concurrent table/symbol/at calls.
 */
class SenderMutex {
  private queue: Promise<void> = Promise.resolve();

  async run<T>(fn: (sender: Sender) => Promise<T>): Promise<T> {
    const result = this.queue.then(async () => {
      if (!sender) {
        const configStr = `http::addr=${QUESTDB_HOST}:${QUESTDB_HTTP_PORT};`;
        sender = await Sender.fromConfig(configStr);
      }
      return await fn(sender);
    });
    // Ensure the queue continues even if the function fails
    this.queue = result.then(() => {}).catch(() => {});
    return result;
  }
}

const senderMutex = new SenderMutex();

let queryPool: pg.Pool | null = null;

export async function getQuestDBSender(): Promise<Sender> {
  if (!sender) {
    const configStr = `http::addr=${QUESTDB_HOST}:${QUESTDB_HTTP_PORT};`;
    sender = await Sender.fromConfig(configStr);
  }
  return sender;
}

/** Initialize the connection pool eagerly (call at startup). */
export function initQueryPool(): pg.Pool {
  if (!queryPool) {
    queryPool = new Pool({
      host: QUESTDB_HOST,
      port: parseInt(QUESTDB_PG_PORT),
      database: "qdb",
      user: QUESTDB_USER,
      password: QUESTDB_PASSWORD,
      max: 50,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000,
      statement_timeout: 60000,
    });
    queryPool.on("error", (err) => {
      console.error("[questdb] Idle client error:", err.message);
    });
    console.log(`[questdb] Connection pool initialized (host=${QUESTDB_HOST}, port=${QUESTDB_PG_PORT}, max=50)`);
  }
  return queryPool;
}

export function getQuestDBQueryPool(): pg.Pool {
  return initQueryPool();
}


/**
 * ULTRA-FAST QuestDB Reader via HTTP REST API.
 * 
 * Performance:
 * 1. Bypasses PG wire overhead.
 * 2. Streams result sets directly as JSON/CSV.
 * 3. Ideal for bulk data pulls (100k+ bars).
 */
export async function queryQuestDBFast<T = any>(sql: string, signal?: AbortSignal): Promise<T[]> {
  const start = performance.now();
  const url = `http://${QUESTDB_HOST}:${QUESTDB_HTTP_PORT}/exec?query=${encodeURIComponent(sql)}&nm=true`;

  try {
    const response = await fetch(url, signal ? { signal: signal as any } : undefined);
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`QuestDB HTTP Error: ${errorText}`);
    }
    
    const data: any = await response.json();
    
    // Map array-of-arrays to array-of-objects using columns metadata
    const columns = data.columns.map((c: any) => c.name);
    const result = data.dataset.map((row: any[]) => {
      const obj: any = {};
      for (let i = 0; i < columns.length; i++) {
        obj[columns[i]] = row[i];
      }
      return obj as T;
    });

    const durationMs = performance.now() - start;
    if (durationMs > 1000) {
      console.warn(`[questdb-fast] LARGE QUERY (${durationMs.toFixed(0)}ms, ${result.length} rows)`);
    }
    
    return result;
  } catch (error: any) {
    console.error("[questdb-fast] HTTP Query failed:", error.message);
    // Fallback to PG if HTTP fails
    return queryQuestDB(sql);
  }
}

export async function queryQuestDB<T = any>(sql: string, timeoutMs?: number): Promise<T[]> {
  const pool = getQuestDBQueryPool();
  const start = performance.now();

  let result: pg.QueryResult;
  if (timeoutMs && timeoutMs > 0) {
    // Per-query timeout: race the query against an AbortController
    const client = await pool.connect();
    try {
      await client.query(`SET statement_timeout = ${Math.floor(timeoutMs)}`);
      result = await client.query(sql);
      await client.query('SET statement_timeout = 0'); // reset for pool reuse
    } catch (err: any) {
      // QuestDB/PG fires '57014' (query_canceled) on timeout
      if (err.code === '57014') {
        const preview = sql.length > 120 ? sql.slice(0, 120) + '…' : sql;
        console.warn(`[questdb] QUERY TIMEOUT (${timeoutMs}ms): ${preview}`);
        throw new Error(`Query timed out after ${timeoutMs}ms`);
      }
      throw err;
    } finally {
      client.release();
    }
  } else {
    result = await pool.query(sql);
  }

  const durationMs = performance.now() - start;
  const preview = sql.length > 120 ? sql.slice(0, 120) + '…' : sql;
  if (durationMs > SLOW_QUERY_THRESHOLD_MS) {
    console.warn(`[questdb] SLOW QUERY (${durationMs.toFixed(0)}ms, ${result.rowCount} rows): ${preview}`);
  } else if (process.env.QUESTDB_QUERY_LOG === "verbose") {
    console.log(`[questdb] query (${durationMs.toFixed(0)}ms, ${result.rowCount} rows): ${preview}`);
  }

  return result.rows as T[];
}

/**
 * Stream large result sets using a PG cursor.
 * Processes rows in chunks to avoid loading everything into memory.
 * @param sql - The SQL query
 * @param onChunk - Callback receiving each chunk of rows
 * @param chunkSize - Rows per chunk (default 5000)
 */
export async function queryQuestDBStream<T = any>(
  sql: string,
  onChunk: (rows: T[]) => void | Promise<void>,
  chunkSize = 5000,
): Promise<{ totalRows: number; durationMs: number }> {
  const pool = getQuestDBQueryPool();
  const client = await pool.connect();
  const start = performance.now();
  let totalRows = 0;

  try {
    // Use a portal-based cursor via DECLARE/FETCH
    await client.query('BEGIN');
    await client.query(`DECLARE qdb_cursor NO SCROLL CURSOR FOR ${sql}`);

    let done = false;
    while (!done) {
      const result = await client.query(`FETCH ${chunkSize} FROM qdb_cursor`);
      if (result.rows.length === 0) {
        done = true;
      } else {
        totalRows += result.rows.length;
        await onChunk(result.rows as T[]);
        if (result.rows.length < chunkSize) done = true;
      }
    }

    await client.query('CLOSE qdb_cursor');
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }

  const durationMs = performance.now() - start;
  console.log(`[questdb] streamed ${totalRows} rows in ${durationMs.toFixed(0)}ms (${chunkSize}/chunk)`);
  return { totalRows, durationMs };
}

/**
 * Execute a query with Zod runtime validation on each row.
 * Provides type safety at runtime — slower than raw queryQuestDB but catches schema drift.
 */
export async function queryQuestDBValidated<T>(sql: string, schema: z.ZodType<T>): Promise<T[]> {
  const rows = await queryQuestDB(sql);
  return rows.map((row, i) => {
    const parsed = schema.safeParse(row);
    if (!parsed.success) {
      console.warn(`[questdb] Row ${i} validation failed: ${parsed.error.message}`);
      throw new Error(`QuestDB result validation failed at row ${i}: ${parsed.error.message}`);
    }
    return parsed.data;
  });
}

/** Zod schema for OHLCV query results (coerces QuestDB string numerics) */
export const OHLCVRowSchema = z.object({
  symbol: z.string(),
  timestamp: z.coerce.date(),
  open: z.coerce.number(),
  high: z.coerce.number(),
  low: z.coerce.number(),
  close: z.coerce.number(),
  volume: z.coerce.number(),
});
export type ValidatedOHLCVRow = z.infer<typeof OHLCVRowSchema>;

export interface OHLCVRow {
  symbol: string;
  assetClass?: string;
  root?: string;
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}


/** Validates table names to prevent garbage table creation from malformed ILP data. */
function validateTableName(table: string): string {
  const allowed = ["ohlcv", "ticks", "dom_l2", "dom_summary", "symbols", "mbp10", "trades"];
  if (allowed.includes(table)) return table;
  // If table looks like a number or is missing, default to ohlcv
  if (/^\d/.test(table) || table.length < 2) {
    console.warn(`[questdb] Blocked garbage table name: "${table}", defaulting to "ohlcv"`);
    return "ohlcv";
  }
  return table;
}

/** Derive asset_class and root from a symbol string. */
function deriveAssetFields(symbol: string): { assetClass: string; root: string } {
  const s = symbol.toUpperCase();
  // Forex: 6 uppercase letters, no digits
  if (s.length === 6 && !/\d/.test(s)) return { assetClass: "forex", root: s };
  if (s.includes("/")) return { assetClass: "forex", root: s.replace("/", "") };
  // Futures contract: extract root (before month code)
  const m = s.match(/^([A-Z][A-Z0-9]*)[FGHJKMNQUVXZ]\d{1,2}/);
  if (m) return { assetClass: "futures", root: m[1]! };
  // Spread: extract root from first leg
  const sp = s.match(/^([A-Z][A-Z0-9]*[FGHJKMNQUVXZ]\d{1,2})-/);
  if (sp) {
    const legRoot = sp[1]!.match(/^([A-Z][A-Z0-9]*)[FGHJKMNQUVXZ]\d{1,2}$/);
    if (legRoot) return { assetClass: "futures", root: legRoot[1]! };
  }
  return { assetClass: "futures", root: s };
}

export async function insertOHLCVBatch(rows: OHLCVRow[]): Promise<void> {
  return senderMutex.run(async (s) => {
    for (const row of rows) {
      const { assetClass, root } = row.assetClass && row.root
        ? { assetClass: row.assetClass, root: row.root }
        : deriveAssetFields(row.symbol);

      await s
        .table(validateTableName("ohlcv"))
        .symbol("symbol", row.symbol)
        .symbol("asset_class", assetClass)
        .symbol("root", root)
        .floatColumn("open", row.open)
        .floatColumn("high", row.high)
        .floatColumn("low", row.low)
        .floatColumn("close", row.close)
        .floatColumn("volume", row.volume)
        .at(row.timestamp.getTime(), "ms");
    }
    await s.flush();
  });
}

export async function insertOHLCVStream(
  symbol: string,
  timestamp: number,
  open: number,
  high: number,
  low: number,
  close: number,
  volume: number,
  assetClass?: string,
  root?: string,
): Promise<void> {
  return senderMutex.run(async (s) => {
    const derived = assetClass && root
      ? { assetClass, root }
      : deriveAssetFields(symbol);

    await s
      .table(validateTableName("ohlcv"))
      .symbol("symbol", symbol)
      .symbol("asset_class", derived.assetClass)
      .symbol("root", derived.root)
      .floatColumn("open", open)
      .floatColumn("high", high)
      .floatColumn("low", low)
      .floatColumn("close", close)
      .floatColumn("volume", volume)
      .at(timestamp, "ms");

    await s.flush();
  });
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
    console.log(`[questdb-debug] Checking health on ${QUESTDB_HOST}:${QUESTDB_PG_PORT}...`);
    // Race against a 10-second timeout to prevent hanging (QuestDB can be slow on large WAL flush)
    const result = await Promise.race([
      pool.query("SELECT 1;"),
      new Promise((_, reject) => setTimeout(() => reject(new Error('QuestDB health check timeout')), 10000)),
    ]);
    console.log('[questdb-debug] Health check success');
    return true;
  } catch (error: any) {
    console.warn("[questdb] Health check failed:", error.message, "at", `${QUESTDB_HOST}:${QUESTDB_PG_PORT}`);
    return false;
  }
}
