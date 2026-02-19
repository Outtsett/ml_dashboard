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
  await marketQuery("SET threads TO 24");
  await marketQuery("SET memory_limit = '80GB'");

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
    CREATE TABLE IF NOT EXISTS trades (
      ts TIMESTAMPTZ,
      rtype UTINYINT,
      publisher_id USMALLINT,
      instrument_id UINTEGER,
      action VARCHAR,
      side VARCHAR,
      depth UTINYINT,
      price DOUBLE,
      size UINTEGER,
      flags UTINYINT,
      ts_in_delta INTEGER,
      sequence UINTEGER,
      symbol VARCHAR
    )
  `);

  await marketQuery(`
    CREATE TABLE IF NOT EXISTS mbp10 (
      ts_recv TIMESTAMPTZ, ts_event TIMESTAMPTZ,
      rtype UTINYINT, publisher_id USMALLINT, instrument_id UINTEGER,
      action VARCHAR, side VARCHAR, depth UTINYINT,
      price DOUBLE, size UINTEGER, flags UTINYINT,
      ts_in_delta INTEGER, sequence UINTEGER,
      bid_px_00 DOUBLE, ask_px_00 DOUBLE, bid_sz_00 UINTEGER, ask_sz_00 UINTEGER, bid_ct_00 USMALLINT, ask_ct_00 USMALLINT,
      bid_px_01 DOUBLE, ask_px_01 DOUBLE, bid_sz_01 UINTEGER, ask_sz_01 UINTEGER, bid_ct_01 USMALLINT, ask_ct_01 USMALLINT,
      bid_px_02 DOUBLE, ask_px_02 DOUBLE, bid_sz_02 UINTEGER, ask_sz_02 UINTEGER, bid_ct_02 USMALLINT, ask_ct_02 USMALLINT,
      bid_px_03 DOUBLE, ask_px_03 DOUBLE, bid_sz_03 UINTEGER, ask_sz_03 UINTEGER, bid_ct_03 USMALLINT, ask_ct_03 USMALLINT,
      bid_px_04 DOUBLE, ask_px_04 DOUBLE, bid_sz_04 UINTEGER, ask_sz_04 UINTEGER, bid_ct_04 USMALLINT, ask_ct_04 USMALLINT,
      bid_px_05 DOUBLE, ask_px_05 DOUBLE, bid_sz_05 UINTEGER, ask_sz_05 UINTEGER, bid_ct_05 USMALLINT, ask_ct_05 USMALLINT,
      bid_px_06 DOUBLE, ask_px_06 DOUBLE, bid_sz_06 UINTEGER, ask_sz_06 UINTEGER, bid_ct_06 USMALLINT, ask_ct_06 USMALLINT,
      bid_px_07 DOUBLE, ask_px_07 DOUBLE, bid_sz_07 UINTEGER, ask_sz_07 UINTEGER, bid_ct_07 USMALLINT, ask_ct_07 USMALLINT,
      bid_px_08 DOUBLE, ask_px_08 DOUBLE, bid_sz_08 UINTEGER, ask_sz_08 UINTEGER, bid_ct_08 USMALLINT, ask_ct_08 USMALLINT,
      bid_px_09 DOUBLE, ask_px_09 DOUBLE, bid_sz_09 UINTEGER, ask_sz_09 UINTEGER, bid_ct_09 USMALLINT, ask_ct_09 USMALLINT,
      symbol VARCHAR
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
