import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import DuckDB from 'duckdb';
import * as fs from 'fs';
import * as path from 'path';

const TEST_DB_PATH = path.join(process.cwd(), 'data', 'test-market.duckdb');

describe('DuckDB market database', () => {
  let db: DuckDB.Database;
  let conn: DuckDB.Connection;

  beforeAll(() => {
    // Clean up any leftover test DB from previous runs
    try { fs.unlinkSync(TEST_DB_PATH); } catch {}
    try { fs.unlinkSync(TEST_DB_PATH + '.wal'); } catch {}
    fs.mkdirSync(path.dirname(TEST_DB_PATH), { recursive: true });
    db = new DuckDB.Database(TEST_DB_PATH);
    conn = db.connect();
  });

  afterAll(() => {
    conn.close();
    db.close();
    try { fs.unlinkSync(TEST_DB_PATH); } catch {}
    try { fs.unlinkSync(TEST_DB_PATH + '.wal'); } catch {}
  });

  function query<T = any>(sql: string): Promise<T[]> {
    return new Promise((resolve, reject) => {
      conn.all(sql, (err, result) => {
        if (err) reject(err);
        else resolve(result as T[]);
      });
    });
  }

  it('should create ohlcv table', async () => {
    await query(`
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
    const tables = await query("SHOW TABLES");
    expect(tables.some((t: any) => t.name === 'ohlcv')).toBe(true);
  });

  it('should create contracts table', async () => {
    await query(`
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
    const tables = await query("SHOW TABLES");
    expect(tables.some((t: any) => t.name === 'contracts')).toBe(true);
  });

  it('should create rollovers table', async () => {
    await query(`
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
    const tables = await query("SHOW TABLES");
    expect(tables.some((t: any) => t.name === 'rollovers')).toBe(true);
  });

  it('should create ingested_files table', async () => {
    await query(`
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
    const tables = await query("SHOW TABLES");
    expect(tables.some((t: any) => t.name === 'ingested_files')).toBe(true);
  });

  it('should insert and query ohlcv data', async () => {
    await query(`
      INSERT INTO ohlcv VALUES
        ('2024-01-02 09:30:00', 'MNQ', 16800.25, 16801.00, 16799.50, 16800.75, 150),
        ('2024-01-02 09:30:01', 'MNQ', 16800.75, 16802.00, 16800.50, 16801.50, 200)
    `);
    const result = await query("SELECT COUNT(*) as cnt FROM ohlcv WHERE symbol = 'MNQ'");
    expect(Number(result[0].cnt)).toBe(2);
  });

  it('should track ingested files', async () => {
    await query(`
      INSERT INTO ingested_files (file_path, file_hash, file_size, row_count, symbol)
      VALUES ('test/file.parquet', 'abc123', 1024, 100, 'MNQ')
    `);
    const result = await query("SELECT * FROM ingested_files WHERE file_path = 'test/file.parquet'");
    expect(result.length).toBe(1);
    expect(result[0].file_hash).toBe('abc123');
  });
});
