import DuckDB from 'duckdb';
import * as fs from 'fs';
import * as path from 'path';

export const db = new DuckDB.Database(':memory:');
export const conn = db.connect();

let initialized = false;

// Mutex to serialize DuckDB access -- single connection is not safe for concurrent operations
export class DuckDBMutex {
  private queue: Array<{ resolve: () => void }> = [];
  private locked = false;

  async acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push({ resolve });
    });
  }

  release(): void {
    const next = this.queue.shift();
    if (next) {
      next.resolve();
    } else {
      this.locked = false;
    }
  }
}

const mutex = new DuckDBMutex();

/** Run a function with exclusive DuckDB access */
export async function withMutex<T>(fn: () => Promise<T>): Promise<T> {
  await mutex.acquire();
  try {
    return await fn();
  } finally {
    mutex.release();
  }
}

export const PARQUET_DIR = path.join(process.cwd(), 'data', 'parquet-data');
fs.mkdirSync(PARQUET_DIR, { recursive: true });

const VALID_TABLE_NAME_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export function validateTableName(name: string): string {
  if (!VALID_TABLE_NAME_REGEX.test(name)) {
    throw new Error(`Invalid table name: ${name}`);
  }
  return name;
}

export function validatePositiveInteger(value: number, name: string, max: number = 10000): number {
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new Error(`Invalid ${name}: must be integer between 1 and ${max}`);
  }
  return value;
}

export async function initDuckDB(): Promise<void> {
  if (initialized) return;

  return withMutex(() => new Promise(async (resolve, reject) => {
    try {
      // Install and load useful extensions
      await new Promise<void>((res, rej) => {
        conn.run(`INSTALL httpfs; LOAD httpfs;`, (err) => {
          if (err) console.log('httpfs extension not available (optional)');
          res();
        });
      });

      // Enable parallel processing for better performance
      await new Promise<void>((res, rej) => {
        conn.run(`SET threads TO 4;`, (err) => {
          if (err) console.log('Could not set threads');
          res();
        });
      });

      // Enable memory-efficient mode for large files
      await new Promise<void>((res, rej) => {
        conn.run(`SET memory_limit = '2GB';`, (err) => {
          if (err) console.log('Could not set memory limit');
          res();
        });
      });

      initialized = true;
      console.log('DuckDB initialized');
      resolve();
    } catch (err) {
      reject(err);
    }
  }));
}

/**
 * Run a DuckDB query. Acquires mutex to prevent concurrent access.
 * Internal functions that already hold the mutex should call conn directly.
 */
export function runQuery<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  return withMutex(() => new Promise((resolve, reject) => {
    if (params.length > 0) {
      const stmt = conn.prepare(sql);
      stmt.all(...params, (err: Error | null, result: T[]) => {
        stmt.finalize();
        if (err) reject(err);
        else resolve(result);
      });
    } else {
      conn.all(sql, (err, result) => {
        if (err) reject(err);
        else resolve(result as T[]);
      });
    }
  }));
}

/**
 * Run query without mutex. Use ONLY inside functions that already hold the mutex
 * via withMutex() (e.g. analytics functions that do CREATE TABLE + INSERT + SELECT + DROP).
 */
export function runQueryUnlocked<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  return new Promise((resolve, reject) => {
    if (params.length > 0) {
      const stmt = conn.prepare(sql);
      stmt.all(...params, (err: Error | null, result: T[]) => {
        stmt.finalize();
        if (err) reject(err);
        else resolve(result);
      });
    } else {
      conn.all(sql, (err, result) => {
        if (err) reject(err);
        else resolve(result as T[]);
      });
    }
  });
}

// Validate file paths for SQL interpolation - only allow safe characters
export function validateFilePath(filePath: string): string {
  const resolved = path.resolve(filePath);
  // Block path traversal and special characters that could break SQL strings
  if (resolved.includes("'") || resolved.includes('"') || resolved.includes(';') || resolved.includes('--')) {
    throw new Error(`Unsafe characters in file path: ${filePath}`);
  }
  return resolved.replace(/\\/g, '/');
}

export function closeDuckDB(): void {
  conn.close();
  db.close();
}
