/**
 * DuckDB Analytics -- Statistical & Volatility Analysis
 *
 * Rolling statistics, correlation, returns, realized/Parkinson/Garman-Klass
 * volatility estimators, and drawdown calculation.
 */
import { validateSymbol } from "@shared/schema";
import { conn, withMutex, runQueryUnlocked, validatePositiveInteger } from "./analyticsCore";

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
// VOLATILITY ANALYSIS FUNCTIONS
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
