/**
 * DuckDB Analytics -- Performance Metrics & Feature Engineering
 *
 * Performance ratios (Sharpe, Sortino, Calmar), trade metrics,
 * lagged feature creation, and technical indicator computation.
 */
import { conn, withMutex, runQueryUnlocked, validatePositiveInteger } from "./analyticsCore";

// ============================================================
// PERFORMANCE & TRADE METRICS
// ============================================================

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

          const { avg_return, volatility, downside_dev } = results[0]!;
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

          const r = results[0]!;
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

// ============================================================
// FEATURE ENGINEERING
// ============================================================

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
