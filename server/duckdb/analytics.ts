/**
 * DuckDB Analytics Engine -- ephemeral in-memory compute.
 *
 * Replaces: server/duckdb/core.ts + server/duckdb/market.ts
 *
 * No persistent storage. Queries QuestDB via postgres_scanner
 * when analytics need price data. Computes features, indicators,
 * and ML datasets in memory. Exports to Parquet.
 */
import DuckDB from 'duckdb';
import * as fs from 'fs';
import * as path from 'path';
import { validateSymbol } from "@shared/schema";

// ============================================================
// CORE INFRASTRUCTURE
// ============================================================

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
      await new Promise<void>((res) => {
        conn.run(`INSTALL httpfs; LOAD httpfs;`, (err) => {
          if (err) console.log('httpfs extension not available (optional)');
          res();
        });
      });

      // Enable parallel processing for better performance
      await new Promise<void>((res) => {
        conn.run(`SET threads TO 4;`, (err) => {
          if (err) console.log('Could not set threads');
          res();
        });
      });

      // Memory limit for analytics workloads
      await new Promise<void>((res) => {
        conn.run(`SET memory_limit = '4GB';`, (err) => {
          if (err) console.log('Could not set memory limit');
          res();
        });
      });

      // Install postgres_scanner for QuestDB access
      try {
        await new Promise<void>((res, rej) => {
          conn.run(`INSTALL postgres_scanner; LOAD postgres_scanner;`, (err) => {
            if (err) rej(err); else res();
          });
        });

        const questdbHost = process.env.QUESTDB_HOST || 'localhost';
        const questdbPort = process.env.QUESTDB_PG_PORT || '8812';

        await new Promise<void>((res, rej) => {
          conn.run(
            `ATTACH 'host=${questdbHost} port=${questdbPort} user=admin password=quest dbname=qdb' AS questdb (TYPE postgres, READ_ONLY)`,
            (err) => { if (err) rej(err); else res(); }
          );
        });
        console.log('[duckdb] postgres_scanner attached to QuestDB');
      } catch (err: any) {
        console.warn('[duckdb] postgres_scanner setup failed (QuestDB reads unavailable):', err.message);
      }

      initialized = true;
      console.log('DuckDB analytics engine initialized');
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
  return withMutex(() => runQueryUnlocked<T>(sql, params));
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

// ============================================================
// STATISTICAL ANALYSIS FUNCTIONS
// ============================================================

export async function calculateRollingStats(
  data: { timestamp: number; close: number }[],
  windowSize: number
): Promise<{ timestamp: number; close: number; sma: number; std: number }[]> {
  if (data.length === 0) return [];

  const validatedWindow = validatePositiveInteger(windowSize, 'windowSize', 1000);
  const tableName = `price_${Date.now()}`;

  return withMutex(() => new Promise((resolve, reject) => {
    conn.run(`
      CREATE OR REPLACE TABLE "${tableName}" (
        timestamp BIGINT,
        close DOUBLE
      )
    `, async (err) => {
      if (err) return reject(err);

      const stmt = conn.prepare(`INSERT INTO "${tableName}" VALUES (?, ?)`);
      const BATCH_SIZE = 10000;
      let processed = 0;

      const insertBatch = () => {
        const end = Math.min(processed + BATCH_SIZE, data.length);
        for (let i = processed; i < end; i++) {
          stmt.run(data[i].timestamp, data[i].close);
        }
        processed = end;

        if (processed < data.length) {
          setImmediate(insertBatch);
        } else {
          stmt.finalize(async (err) => {
            if (err) return reject(err);

            try {
              const windowOffset = validatedWindow - 1;
              const results = await runQueryUnlocked<{ timestamp: number; close: number; sma: number; std: number }>(`
                SELECT
                  timestamp,
                  close,
                  avg(close) OVER (ORDER BY timestamp ROWS BETWEEN ${windowOffset} PRECEDING AND CURRENT ROW) as sma,
                  stddev(close) OVER (ORDER BY timestamp ROWS BETWEEN ${windowOffset} PRECEDING AND CURRENT ROW) as std
                FROM "${tableName}"
                ORDER BY timestamp
              `);

              await runQueryUnlocked(`DROP TABLE IF EXISTS "${tableName}"`);

              resolve(results);
            } catch (e) {
              reject(e);
            }
          });
        }
      };

      insertBatch();
    });
  }));
}

export async function correlationMatrix(
  symbols: string[],
  data: { symbol: string; timestamp: number; close: number }[]
): Promise<{ symbol1: string; symbol2: string; correlation: number }[]> {
  if (data.length === 0 || symbols.length === 0) return [];

  const validSymbols = symbols.map(validateSymbol);
  const tableName = `corr_${Date.now()}`;

  return withMutex(() => new Promise((resolve, reject) => {
    conn.run(`
      CREATE OR REPLACE TABLE "${tableName}" (
        symbol VARCHAR,
        timestamp BIGINT,
        close DOUBLE
      )
    `, async (err) => {
      if (err) return reject(err);

      const stmt = conn.prepare(`INSERT INTO "${tableName}" VALUES (?, ?, ?)`);
      const BATCH_SIZE = 10000;
      let processed = 0;

      const insertBatch = () => {
        const end = Math.min(processed + BATCH_SIZE, data.length);
        for (let i = processed; i < end; i++) {
          stmt.run(validateSymbol(data[i].symbol), data[i].timestamp, data[i].close);
        }
        processed = end;

        if (processed < data.length) {
          setImmediate(insertBatch);
        } else {
          stmt.finalize(async (err) => {
            if (err) return reject(err);

            try {
              const results: { symbol1: string; symbol2: string; correlation: number }[] = [];

              for (let i = 0; i < validSymbols.length; i++) {
                for (let j = i; j < validSymbols.length; j++) {
                  const corr = await runQueryUnlocked<{ correlation: number }>(`
                    SELECT corr(a.close, b.close) as correlation
                    FROM (SELECT timestamp, close FROM "${tableName}" WHERE symbol = ?) a
                    JOIN (SELECT timestamp, close FROM "${tableName}" WHERE symbol = ?) b
                    ON a.timestamp = b.timestamp
                  `, [validSymbols[i], validSymbols[j]]);

                  if (corr.length > 0 && corr[0].correlation !== null) {
                    results.push({
                      symbol1: validSymbols[i],
                      symbol2: validSymbols[j],
                      correlation: corr[0].correlation
                    });
                  }
                }
              }

              await runQueryUnlocked(`DROP TABLE IF EXISTS "${tableName}"`);

              resolve(results);
            } catch (e) {
              reject(e);
            }
          });
        }
      };

      insertBatch();
    });
  }));
}

// ============================================================
// ML ANALYTICS FUNCTIONS
// ============================================================

// Calculate returns (log and simple)
export async function calculateReturns(
  data: { timestamp: number; close: number }[]
): Promise<{ timestamp: number; close: number; simple_return: number; log_return: number }[]> {
  if (data.length < 2) return [];

  const tableName = `returns_${Date.now()}`;

  return withMutex(() => new Promise((resolve, reject) => {
    conn.run(`
      CREATE OR REPLACE TABLE "${tableName}" (
        timestamp BIGINT,
        close DOUBLE
      )
    `, async (err) => {
      if (err) return reject(err);

      const stmt = conn.prepare(`INSERT INTO "${tableName}" VALUES (?, ?)`);
      for (const row of data) {
        stmt.run(row.timestamp, row.close);
      }

      stmt.finalize(async (err) => {
        if (err) return reject(err);

        try {
          const results = await runQueryUnlocked<{ timestamp: number; close: number; simple_return: number; log_return: number }>(`
            SELECT
              timestamp,
              close,
              (close - LAG(close) OVER (ORDER BY timestamp)) / LAG(close) OVER (ORDER BY timestamp) as simple_return,
              LN(close / LAG(close) OVER (ORDER BY timestamp)) as log_return
            FROM "${tableName}"
            ORDER BY timestamp
          `);

          await runQueryUnlocked(`DROP TABLE IF EXISTS "${tableName}"`);
          resolve(results.filter(r => r.simple_return !== null));
        } catch (e) {
          reject(e);
        }
      });
    });
  }));
}

// Realized volatility (rolling std of returns)
export async function realizedVolatility(
  data: { timestamp: number; close: number }[],
  windowSize: number = 20
): Promise<{ timestamp: number; realized_vol: number; annualized_vol: number }[]> {
  if (data.length < windowSize) return [];

  const validatedWindow = validatePositiveInteger(windowSize, 'windowSize', 1000);
  const tableName = `vol_${Date.now()}`;

  return withMutex(() => new Promise((resolve, reject) => {
    conn.run(`
      CREATE OR REPLACE TABLE "${tableName}" (
        timestamp BIGINT,
        close DOUBLE
      )
    `, async (err) => {
      if (err) return reject(err);

      const stmt = conn.prepare(`INSERT INTO "${tableName}" VALUES (?, ?)`);
      for (const row of data) {
        stmt.run(row.timestamp, row.close);
      }

      stmt.finalize(async (err) => {
        if (err) return reject(err);

        try {
          const windowOffset = validatedWindow - 1;
          const results = await runQueryUnlocked<{ timestamp: number; realized_vol: number; annualized_vol: number }>(`
            WITH returns AS (
              SELECT
                timestamp,
                LN(close / LAG(close) OVER (ORDER BY timestamp)) as log_return
              FROM "${tableName}"
            )
            SELECT
              timestamp,
              STDDEV(log_return) OVER (ORDER BY timestamp ROWS BETWEEN ${windowOffset} PRECEDING AND CURRENT ROW) as realized_vol,
              STDDEV(log_return) OVER (ORDER BY timestamp ROWS BETWEEN ${windowOffset} PRECEDING AND CURRENT ROW) * SQRT(252) as annualized_vol
            FROM returns
            WHERE log_return IS NOT NULL
            ORDER BY timestamp
          `);

          await runQueryUnlocked(`DROP TABLE IF EXISTS "${tableName}"`);
          resolve(results.filter(r => r.realized_vol !== null));
        } catch (e) {
          reject(e);
        }
      });
    });
  }));
}

// Parkinson volatility estimator (uses high-low range)
export async function parkinsonVolatility(
  data: { timestamp: number; high: number; low: number }[],
  windowSize: number = 20
): Promise<{ timestamp: number; parkinson_vol: number }[]> {
  if (data.length < windowSize) return [];

  const validatedWindow = validatePositiveInteger(windowSize, 'windowSize', 1000);
  const tableName = `parkinson_${Date.now()}`;

  return withMutex(() => new Promise((resolve, reject) => {
    conn.run(`
      CREATE OR REPLACE TABLE "${tableName}" (
        timestamp BIGINT,
        high DOUBLE,
        low DOUBLE
      )
    `, async (err) => {
      if (err) return reject(err);

      const stmt = conn.prepare(`INSERT INTO "${tableName}" VALUES (?, ?, ?)`);
      for (const row of data) {
        stmt.run(row.timestamp, row.high, row.low);
      }

      stmt.finalize(async (err) => {
        if (err) return reject(err);

        try {
          const windowOffset = validatedWindow - 1;
          // Parkinson formula: sqrt(1/(4*n*ln(2)) * sum(ln(H/L)^2))
          const results = await runQueryUnlocked<{ timestamp: number; parkinson_vol: number }>(`
            WITH hl_ratio AS (
              SELECT
                timestamp,
                POWER(LN(high / low), 2) as hl_sq
              FROM "${tableName}"
            )
            SELECT
              timestamp,
              SQRT(AVG(hl_sq) OVER (ORDER BY timestamp ROWS BETWEEN ${windowOffset} PRECEDING AND CURRENT ROW) / (4 * LN(2))) as parkinson_vol
            FROM hl_ratio
            ORDER BY timestamp
          `);

          await runQueryUnlocked(`DROP TABLE IF EXISTS "${tableName}"`);
          resolve(results.filter(r => r.parkinson_vol !== null));
        } catch (e) {
          reject(e);
        }
      });
    });
  }));
}

// Garman-Klass volatility estimator (uses OHLC)
export async function garmanKlassVolatility(
  data: { timestamp: number; open: number; high: number; low: number; close: number }[],
  windowSize: number = 20
): Promise<{ timestamp: number; gk_vol: number }[]> {
  if (data.length < windowSize) return [];

  const validatedWindow = validatePositiveInteger(windowSize, 'windowSize', 1000);
  const tableName = `gk_${Date.now()}`;

  return withMutex(() => new Promise((resolve, reject) => {
    conn.run(`
      CREATE OR REPLACE TABLE "${tableName}" (
        timestamp BIGINT,
        open DOUBLE,
        high DOUBLE,
        low DOUBLE,
        close DOUBLE
      )
    `, async (err) => {
      if (err) return reject(err);

      const stmt = conn.prepare(`INSERT INTO "${tableName}" VALUES (?, ?, ?, ?, ?)`);
      for (const row of data) {
        stmt.run(row.timestamp, row.open, row.high, row.low, row.close);
      }

      stmt.finalize(async (err) => {
        if (err) return reject(err);

        try {
          const windowOffset = validatedWindow - 1;
          // Garman-Klass: 0.5*ln(H/L)^2 - (2*ln(2)-1)*ln(C/O)^2
          const results = await runQueryUnlocked<{ timestamp: number; gk_vol: number }>(`
            WITH gk_terms AS (
              SELECT
                timestamp,
                0.5 * POWER(LN(high / low), 2) - (2 * LN(2) - 1) * POWER(LN(close / open), 2) as gk_term
              FROM "${tableName}"
            )
            SELECT
              timestamp,
              SQRT(AVG(gk_term) OVER (ORDER BY timestamp ROWS BETWEEN ${windowOffset} PRECEDING AND CURRENT ROW)) as gk_vol
            FROM gk_terms
            ORDER BY timestamp
          `);

          await runQueryUnlocked(`DROP TABLE IF EXISTS "${tableName}"`);
          resolve(results.filter(r => r.gk_vol !== null));
        } catch (e) {
          reject(e);
        }
      });
    });
  }));
}

// Drawdown calculation
export async function calculateDrawdown(
  data: { timestamp: number; equity: number }[]
): Promise<{ timestamp: number; equity: number; peak: number; drawdown: number; drawdown_pct: number }[]> {
  if (data.length === 0) return [];

  const tableName = `dd_${Date.now()}`;

  return withMutex(() => new Promise((resolve, reject) => {
    conn.run(`
      CREATE OR REPLACE TABLE "${tableName}" (
        timestamp BIGINT,
        equity DOUBLE
      )
    `, async (err) => {
      if (err) return reject(err);

      const stmt = conn.prepare(`INSERT INTO "${tableName}" VALUES (?, ?)`);
      for (const row of data) {
        stmt.run(row.timestamp, row.equity);
      }

      stmt.finalize(async (err) => {
        if (err) return reject(err);

        try {
          const results = await runQueryUnlocked<{ timestamp: number; equity: number; peak: number; drawdown: number; drawdown_pct: number }>(`
            SELECT
              timestamp,
              equity,
              MAX(equity) OVER (ORDER BY timestamp ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) as peak,
              equity - MAX(equity) OVER (ORDER BY timestamp ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) as drawdown,
              (equity - MAX(equity) OVER (ORDER BY timestamp ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)) /
                MAX(equity) OVER (ORDER BY timestamp ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) as drawdown_pct
            FROM "${tableName}"
            ORDER BY timestamp
          `);

          await runQueryUnlocked(`DROP TABLE IF EXISTS "${tableName}"`);
          resolve(results);
        } catch (e) {
          reject(e);
        }
      });
    });
  }));
}

// Performance ratios: Sharpe, Sortino, Calmar
export async function calculatePerformanceRatios(
  returns: { timestamp: number; return_pct: number }[],
  riskFreeRate: number = 0.0,
  maxDrawdownPct: number = 0.1
): Promise<{ sharpe: number; sortino: number; calmar: number; avg_return: number; volatility: number; downside_dev: number }> {
  if (returns.length === 0) {
    return { sharpe: 0, sortino: 0, calmar: 0, avg_return: 0, volatility: 0, downside_dev: 0 };
  }

  const tableName = `ratios_${Date.now()}`;

  return withMutex(() => new Promise((resolve, reject) => {
    conn.run(`
      CREATE OR REPLACE TABLE "${tableName}" (
        timestamp BIGINT,
        return_pct DOUBLE
      )
    `, async (err) => {
      if (err) return reject(err);

      const stmt = conn.prepare(`INSERT INTO "${tableName}" VALUES (?, ?)`);
      for (const row of returns) {
        stmt.run(row.timestamp, row.return_pct);
      }

      stmt.finalize(async (err) => {
        if (err) return reject(err);

        try {
          const results = await runQueryUnlocked<{ avg_return: number; volatility: number; downside_dev: number }>(`
            SELECT
              AVG(return_pct) as avg_return,
              STDDEV(return_pct) as volatility,
              SQRT(AVG(CASE WHEN return_pct < 0 THEN POWER(return_pct, 2) ELSE 0 END)) as downside_dev
            FROM "${tableName}"
          `);

          await runQueryUnlocked(`DROP TABLE IF EXISTS "${tableName}"`);

          if (results.length === 0) {
            return resolve({ sharpe: 0, sortino: 0, calmar: 0, avg_return: 0, volatility: 0, downside_dev: 0 });
          }

          const { avg_return, volatility, downside_dev } = results[0];
          const excessReturn = avg_return - riskFreeRate;

          const sharpe = volatility > 0 ? (excessReturn / volatility) * Math.sqrt(252) : 0;
          const sortino = downside_dev > 0 ? (excessReturn / downside_dev) * Math.sqrt(252) : 0;
          const calmar = Math.abs(maxDrawdownPct) > 0 ? (avg_return * 252) / Math.abs(maxDrawdownPct) : 0;

          resolve({ sharpe, sortino, calmar, avg_return, volatility, downside_dev });
        } catch (e) {
          reject(e);
        }
      });
    });
  }));
}

// Trade-level P&L and metrics
export async function calculateTradeMetrics(
  trades: { timestamp: number; pnl: number; side: 'long' | 'short' }[]
): Promise<{
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  win_rate: number;
  profit_factor: number;
  expectancy: number;
  avg_win: number;
  avg_loss: number;
  largest_win: number;
  largest_loss: number;
  total_pnl: number;
}> {
  if (trades.length === 0) {
    return {
      total_trades: 0, winning_trades: 0, losing_trades: 0,
      win_rate: 0, profit_factor: 0, expectancy: 0,
      avg_win: 0, avg_loss: 0, largest_win: 0, largest_loss: 0, total_pnl: 0
    };
  }

  const tableName = `trades_${Date.now()}`;

  return withMutex(() => new Promise((resolve, reject) => {
    conn.run(`
      CREATE OR REPLACE TABLE "${tableName}" (
        timestamp BIGINT,
        pnl DOUBLE,
        side VARCHAR
      )
    `, async (err) => {
      if (err) return reject(err);

      const stmt = conn.prepare(`INSERT INTO "${tableName}" VALUES (?, ?, ?)`);
      for (const row of trades) {
        stmt.run(row.timestamp, row.pnl, row.side);
      }

      stmt.finalize(async (err) => {
        if (err) return reject(err);

        try {
          const results = await runQueryUnlocked<{
            total_trades: number;
            winning_trades: number;
            losing_trades: number;
            gross_profit: number;
            gross_loss: number;
            avg_win: number;
            avg_loss: number;
            largest_win: number;
            largest_loss: number;
            total_pnl: number;
          }>(`
            SELECT
              COUNT(*) as total_trades,
              SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as winning_trades,
              SUM(CASE WHEN pnl < 0 THEN 1 ELSE 0 END) as losing_trades,
              SUM(CASE WHEN pnl > 0 THEN pnl ELSE 0 END) as gross_profit,
              ABS(SUM(CASE WHEN pnl < 0 THEN pnl ELSE 0 END)) as gross_loss,
              AVG(CASE WHEN pnl > 0 THEN pnl END) as avg_win,
              AVG(CASE WHEN pnl < 0 THEN pnl END) as avg_loss,
              MAX(pnl) as largest_win,
              MIN(pnl) as largest_loss,
              SUM(pnl) as total_pnl
            FROM "${tableName}"
          `);

          await runQueryUnlocked(`DROP TABLE IF EXISTS "${tableName}"`);

          if (results.length === 0) {
            return resolve({
              total_trades: 0, winning_trades: 0, losing_trades: 0,
              win_rate: 0, profit_factor: 0, expectancy: 0,
              avg_win: 0, avg_loss: 0, largest_win: 0, largest_loss: 0, total_pnl: 0
            });
          }

          const r = results[0];
          const win_rate = r.total_trades > 0 ? r.winning_trades / r.total_trades : 0;
          const profit_factor = r.gross_loss > 0 ? r.gross_profit / r.gross_loss : r.gross_profit > 0 ? Infinity : 0;
          const expectancy = r.total_trades > 0 ? r.total_pnl / r.total_trades : 0;

          resolve({
            total_trades: r.total_trades,
            winning_trades: r.winning_trades,
            losing_trades: r.losing_trades,
            win_rate,
            profit_factor,
            expectancy,
            avg_win: r.avg_win || 0,
            avg_loss: r.avg_loss || 0,
            largest_win: r.largest_win || 0,
            largest_loss: r.largest_loss || 0,
            total_pnl: r.total_pnl
          });
        } catch (e) {
          reject(e);
        }
      });
    });
  }));
}

// Feature engineering: lagged features
export async function createLaggedFeatures(
  data: { timestamp: number; value: number }[],
  lags: number[] = [1, 5, 10, 20]
): Promise<{ timestamp: number; value: number; [key: string]: number }[]> {
  if (data.length === 0) return [];

  const validatedLags = lags.map(l => validatePositiveInteger(l, 'lag', 1000));
  const tableName = `lagged_${Date.now()}`;

  return withMutex(() => new Promise((resolve, reject) => {
    conn.run(`
      CREATE OR REPLACE TABLE "${tableName}" (
        timestamp BIGINT,
        value DOUBLE
      )
    `, async (err) => {
      if (err) return reject(err);

      const stmt = conn.prepare(`INSERT INTO "${tableName}" VALUES (?, ?)`);
      for (const row of data) {
        stmt.run(row.timestamp, row.value);
      }

      stmt.finalize(async (err) => {
        if (err) return reject(err);

        try {
          const lagColumns = validatedLags.map(l =>
            `LAG(value, ${l}) OVER (ORDER BY timestamp) as lag_${l}`
          ).join(',\n');

          const results = await runQueryUnlocked<any>(`
            SELECT
              timestamp,
              value,
              ${lagColumns}
            FROM "${tableName}"
            ORDER BY timestamp
          `);

          await runQueryUnlocked(`DROP TABLE IF EXISTS "${tableName}"`);
          resolve(results);
        } catch (e) {
          reject(e);
        }
      });
    });
  }));
}

// Technical indicators: SMA, EMA, RSI, MACD, Bollinger Bands
export async function calculateTechnicalIndicators(
  data: { timestamp: number; close: number; high?: number; low?: number; volume?: number }[],
  params: { smaPeriods?: number[]; emaPeriod?: number; rsiPeriod?: number; bbPeriod?: number; bbStd?: number } = {}
): Promise<any[]> {
  if (data.length === 0) return [];

  const {
    smaPeriods = [20, 50, 200],
    emaPeriod = 12,
    rsiPeriod = 14,
    bbPeriod = 20,
    bbStd = 2
  } = params;

  const tableName = `tech_${Date.now()}`;

  return withMutex(() => new Promise((resolve, reject) => {
    conn.run(`
      CREATE OR REPLACE TABLE "${tableName}" (
        timestamp BIGINT,
        close DOUBLE,
        high DOUBLE,
        low DOUBLE,
        volume DOUBLE
      )
    `, async (err) => {
      if (err) return reject(err);

      const stmt = conn.prepare(`INSERT INTO "${tableName}" VALUES (?, ?, ?, ?, ?)`);
      for (const row of data) {
        stmt.run(row.timestamp, row.close, row.high || row.close, row.low || row.close, row.volume || 0);
      }

      stmt.finalize(async (err) => {
        if (err) return reject(err);

        try {
          const smaColumns = smaPeriods.map(p =>
            `AVG(close) OVER (ORDER BY timestamp ROWS BETWEEN ${p - 1} PRECEDING AND CURRENT ROW) as sma_${p}`
          ).join(',\n');

          const bbOffset = bbPeriod - 1;

          const results = await runQueryUnlocked<any>(`
            WITH base AS (
              SELECT
                timestamp,
                close,
                high,
                low,
                volume,
                close - LAG(close) OVER (ORDER BY timestamp) as price_change,
                ${smaColumns},
                AVG(close) OVER (ORDER BY timestamp ROWS BETWEEN ${bbOffset} PRECEDING AND CURRENT ROW) as bb_middle,
                STDDEV(close) OVER (ORDER BY timestamp ROWS BETWEEN ${bbOffset} PRECEDING AND CURRENT ROW) as bb_std
              FROM "${tableName}"
            ),
            rsi_calc AS (
              SELECT *,
                AVG(CASE WHEN price_change > 0 THEN price_change ELSE 0 END) OVER (ORDER BY timestamp ROWS BETWEEN ${rsiPeriod - 1} PRECEDING AND CURRENT ROW) as avg_gain,
                AVG(CASE WHEN price_change < 0 THEN ABS(price_change) ELSE 0 END) OVER (ORDER BY timestamp ROWS BETWEEN ${rsiPeriod - 1} PRECEDING AND CURRENT ROW) as avg_loss
              FROM base
            )
            SELECT
              timestamp,
              close,
              high,
              low,
              volume,
              ${smaPeriods.map(p => `sma_${p}`).join(', ')},
              bb_middle,
              bb_middle + ${bbStd} * bb_std as bb_upper,
              bb_middle - ${bbStd} * bb_std as bb_lower,
              CASE WHEN avg_loss = 0 THEN 100 ELSE 100 - (100 / (1 + avg_gain / avg_loss)) END as rsi
            FROM rsi_calc
            ORDER BY timestamp
          `);

          await runQueryUnlocked(`DROP TABLE IF EXISTS "${tableName}"`);
          resolve(results);
        } catch (e) {
          reject(e);
        }
      });
    });
  }));
}
