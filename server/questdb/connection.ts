import { Sender } from "@questdb/nodejs-client";
import pg from "pg";

const { Pool } = pg;

export const QUESTDB_HOST = process.env.QUESTDB_HOST || "localhost";
export const QUESTDB_ILP_PORT = process.env.QUESTDB_ILP_PORT || "9009";
export const QUESTDB_PG_PORT = process.env.QUESTDB_PG_PORT || "8812";
export const QUESTDB_HTTP_PORT = process.env.QUESTDB_HTTP_PORT || "9000";

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
      max: 20,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000,
      statement_timeout: 30000,
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
