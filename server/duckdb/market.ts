/**
 * Persistent DuckDB Market Database
 *
 * File-backed DuckDB at data/market.duckdb — source of truth for all market data.
 * Separate from the in-memory analytics DuckDB in core.ts.
 */
import DuckDB from 'duckdb';
import * as fs from 'fs';
import * as path from 'path';

const MARKET_DB_PATH = path.join(process.cwd(), 'data', 'market.duckdb');

let marketDb: DuckDB.Database | null = null;
let marketConn: DuckDB.Connection | null = null;

// Mutex (same pattern as core.ts)
class Mutex {
  private queue: Array<{ resolve: () => void }> = [];
  private locked = false;

  async acquire(): Promise<void> {
    if (!this.locked) { this.locked = true; return; }
    return new Promise<void>((resolve) => { this.queue.push({ resolve }); });
  }

  release(): void {
    const next = this.queue.shift();
    if (next) next.resolve();
    else this.locked = false;
  }
}

const mutex = new Mutex();

export async function initMarketDB(): Promise<void> {
  if (marketDb) return;

  fs.mkdirSync(path.dirname(MARKET_DB_PATH), { recursive: true });
  marketDb = new DuckDB.Database(MARKET_DB_PATH);
  marketConn = marketDb.connect();

  // Set performance options
  await marketQuery("SET threads TO 4");
  await marketQuery("SET memory_limit = '4GB'");

  // Create tables if they don't exist
  await marketQuery(`
    CREATE TABLE IF NOT EXISTS ohlcv (
      ts TIMESTAMP NOT NULL,
      symbol VARCHAR NOT NULL,
      open DOUBLE,
      high DOUBLE,
      low DOUBLE,
      close DOUBLE,
      volume BIGINT
    )
  `);

  await marketQuery(`
    CREATE TABLE IF NOT EXISTS contracts (
      ts TIMESTAMP NOT NULL,
      symbol VARCHAR NOT NULL,
      root VARCHAR NOT NULL,
      expiry DATE,
      open DOUBLE,
      high DOUBLE,
      low DOUBLE,
      close DOUBLE,
      volume BIGINT
    )
  `);

  await marketQuery(`
    CREATE TABLE IF NOT EXISTS rollovers (
      ts TIMESTAMP NOT NULL,
      root VARCHAR NOT NULL,
      from_contract VARCHAR NOT NULL,
      to_contract VARCHAR NOT NULL,
      from_close DOUBLE NOT NULL,
      to_close DOUBLE NOT NULL,
      ratio DOUBLE NOT NULL
    )
  `);

  await marketQuery(`
    CREATE TABLE IF NOT EXISTS ingested_files (
      file_path VARCHAR PRIMARY KEY,
      file_hash VARCHAR,
      file_size BIGINT,
      row_count BIGINT,
      symbol VARCHAR,
      ts_min TIMESTAMP,
      ts_max TIMESTAMP,
      ingested_at TIMESTAMP DEFAULT current_timestamp
    )
  `);

  console.log('[market-db] Initialized at', MARKET_DB_PATH);
}

export function marketQuery<T = any>(sql: string): Promise<T[]> {
  return new Promise(async (resolve, reject) => {
    await mutex.acquire();
    try {
      if (!marketConn) throw new Error('Market DB not initialized');
      marketConn.all(sql, (err, result) => {
        mutex.release();
        if (err) reject(err);
        else resolve(result as T[]);
      });
    } catch (e) {
      mutex.release();
      reject(e);
    }
  });
}

export function closeMarketDB(): void {
  if (marketConn) { marketConn.close(); marketConn = null; }
  if (marketDb) { marketDb.close(); marketDb = null; }
}

export function getMarketDBPath(): string {
  return MARKET_DB_PATH;
}
