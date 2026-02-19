import * as fs from 'fs';
import * as path from 'path';
import { validateSymbol } from "@shared/schema";
import { conn, withMutex, runQuery, runQueryUnlocked, validateTableName, validatePositiveInteger, PARQUET_DIR } from "./core";

export async function loadParquetForAnalytics(symbol: string): Promise<any[]> {
  const safeSymbol = validateSymbol(symbol);
  const parquetPath = path.join(PARQUET_DIR, `${safeSymbol}_ohlcv.parquet`);

  if (!fs.existsSync(parquetPath)) {
    throw new Error(`Parquet file not found for symbol: ${symbol}`);
  }

  return withMutex(() => new Promise((resolve, reject) => {
    conn.all(`SELECT * FROM read_parquet(?) ORDER BY timestamp`, [parquetPath], (err, result) => {
      if (err) reject(err);
      else resolve(result as any[]);
    });
  }));
}

export async function getParquetStats(symbol: string): Promise<{
  count: number;
  minTimestamp: number;
  maxTimestamp: number;
  fileSize: number;
}> {
  const safeSymbol = validateSymbol(symbol);
  const parquetPath = path.join(PARQUET_DIR, `${safeSymbol}_ohlcv.parquet`);

  if (!fs.existsSync(parquetPath)) {
    throw new Error(`Parquet file not found for symbol: ${symbol}`);
  }

  const stats = fs.statSync(parquetPath);

  return withMutex(() => new Promise((resolve, reject) => {
    conn.all(`
      SELECT
        COUNT(*) as count,
        MIN(timestamp) as min_timestamp,
        MAX(timestamp) as max_timestamp
      FROM read_parquet(?)
    `, [parquetPath], (err, result) => {
      if (err) reject(err);
      else {
        const row = (result as any[])[0];
        resolve({
          count: Number(row.count),
          minTimestamp: Number(row.min_timestamp),
          maxTimestamp: Number(row.max_timestamp),
          fileSize: stats.size
        });
      }
    });
  }));
}

export async function queryParquetOHLCV(
  symbol: string,
  startTime?: number,
  endTime?: number,
  limit?: number,
  offset?: number
): Promise<any[]> {
  const safeSymbol = validateSymbol(symbol);
  const parquetPath = path.join(PARQUET_DIR, `${safeSymbol}_ohlcv.parquet`);

  if (!fs.existsSync(parquetPath)) {
    return [];
  }

  let sql = `SELECT * FROM read_parquet(?) WHERE 1=1`;
  const params: any[] = [parquetPath];

  if (startTime) {
    sql += ` AND timestamp >= ?`;
    params.push(startTime);
  }
  if (endTime) {
    sql += ` AND timestamp <= ?`;
    params.push(endTime);
  }

  sql += ` ORDER BY timestamp`;

  if (limit) {
    sql += ` LIMIT ?`;
    params.push(validatePositiveInteger(limit, 'limit', 100000));
  }

  if (offset !== undefined && offset > 0) {
    sql += ` OFFSET ?`;
    params.push(validatePositiveInteger(offset, 'offset', 1000000000));
  }

  return withMutex(() => new Promise((resolve, reject) => {
    const stmt = conn.prepare(sql);
    stmt.all(...params, (err: Error | null, result: any[]) => {
      stmt.finalize();
      if (err) reject(err);
      else {
        // Convert BigInt values to Number for JSON serialization
        const serializable = result.map(row => {
          const converted: Record<string, any> = {};
          for (const [key, value] of Object.entries(row)) {
            converted[key] = typeof value === 'bigint' ? Number(value) : value;
          }
          return converted;
        });
        resolve(serializable);
      }
    });
  }));
}

// Server-side aggregation for efficient infinite scrolling at any timeframe
export async function queryParquetOHLCVAggregated(
  symbol: string,
  timeframeMinutes: number = 1,
  startTime?: number,
  endTime?: number,
  limit: number = 2000,  // Reduced from 5000 to prevent memory issues
  offset: number = 0,
  loadFromEnd: boolean = true  // Load most recent data first by default
): Promise<any[]> {
  const safeSymbol = validateSymbol(symbol);
  const parquetPath = path.join(PARQUET_DIR, `${safeSymbol}_ohlcv.parquet`);

  if (!fs.existsSync(parquetPath)) {
    return [];
  }

  const timeframeMs = timeframeMinutes * 60 * 1000;

  // For higher timeframes (>=60 min), the aggregated result is small enough to load fully
  // For lower timeframes, we need pagination
  const isHighTimeframe = timeframeMinutes >= 60;

  // Build SQL with aggregation
  let sql: string;
  const params: any[] = [parquetPath];

  if (timeframeMinutes === 1) {
    // For 1-minute, aggregate 1-second bars into 1-minute bars
    const oneMinuteMs = 60 * 1000;
    sql = `
      SELECT
        symbol,
        (FLOOR(timestamp / ${oneMinuteMs}) * ${oneMinuteMs})::BIGINT as timestamp,
        FIRST(open) as open,
        MAX(high) as high,
        MIN(low) as low,
        LAST(close) as close,
        SUM(volume)::BIGINT as volume
      FROM read_parquet(?)
      WHERE 1=1
    `;

    if (startTime) {
      sql += ` AND timestamp >= ?`;
      params.push(startTime);
    }
    if (endTime) {
      sql += ` AND timestamp <= ?`;
      params.push(endTime);
    }

    // Determine sort order:
    // - Initial load (no filters, loadFromEnd): Get most recent data, order DESC, then reverse
    // - Loading earlier data (endTime but no startTime): Get most recent data before endTime, order DESC, then reverse
    // - Loading later data (startTime but no endTime): Get data after startTime, order ASC
    const loadingEarlier = endTime && !startTime;
    const loadingLater = startTime && !endTime;
    const initialLoad = !startTime && !endTime;

    // Order DESC when we want most recent data first (initial load or loading earlier)
    const orderDir = (loadFromEnd && (initialLoad || loadingEarlier)) ? 'DESC' : 'ASC';
    sql += ` GROUP BY symbol, FLOOR(timestamp / ${oneMinuteMs}) ORDER BY timestamp ${orderDir} LIMIT ? OFFSET ?`;
    params.push(limit);
    params.push(offset);
  } else {
    // Aggregate to the requested timeframe
    // For high timeframes, load all; for low timeframes, use time filtering
    sql = `
      SELECT
        symbol,
        (FLOOR(timestamp / ${timeframeMs}) * ${timeframeMs})::BIGINT as timestamp,
        FIRST(open) as open,
        MAX(high) as high,
        MIN(low) as low,
        LAST(close) as close,
        SUM(volume)::BIGINT as volume
      FROM read_parquet(?)
      WHERE 1=1
    `;

    if (startTime) {
      sql += ` AND timestamp >= ?`;
      params.push(startTime);
    }
    if (endTime) {
      sql += ` AND timestamp <= ?`;
      params.push(endTime);
    }

    // Determine sort order (same logic as 1-minute case)
    const loadingEarlier = endTime && !startTime;
    const loadingLater = startTime && !endTime;
    const initialLoad = !startTime && !endTime;

    const orderDir = (loadFromEnd && (initialLoad || loadingEarlier)) ? 'DESC' : 'ASC';
    sql += ` GROUP BY symbol, FLOOR(timestamp / ${timeframeMs}) ORDER BY timestamp ${orderDir}`;

    // Always apply LIMIT to prevent memory issues
    // For high timeframes, use a generous limit that covers all expected data
    const effectiveLimit = isHighTimeframe ? 50000 : limit;
    sql += ` LIMIT ? OFFSET ?`;
    params.push(effectiveLimit);
    params.push(offset);
  }

  // Track if we need to reverse (when ordering DESC for initial load or loading earlier data)
  const loadingEarlierFinal = endTime && !startTime;
  const initialLoadFinal = !startTime && !endTime;
  const needsReverse = loadFromEnd && (initialLoadFinal || loadingEarlierFinal);

  return withMutex(() => new Promise((resolve, reject) => {
    const stmt = conn.prepare(sql);
    stmt.all(...params, (err: Error | null, result: any[]) => {
      stmt.finalize();
      if (err) reject(err);
      else {
        // Convert BigInt values to Number for JSON serialization
        const serializable = result.map(row => {
          const converted: Record<string, any> = {};
          for (const [key, value] of Object.entries(row)) {
            converted[key] = typeof value === 'bigint' ? Number(value) : value;
          }
          return converted;
        });
        // Reverse to get chronological order for chart display
        resolve(needsReverse ? serializable.reverse() : serializable);
      }
    });
  }));
}

/** Internal unlocked version - caller must hold the mutex */
export async function bulkLoadOHLCVUnlocked(
  tableName: string,
  data: { symbol: string; timestamp: number; open: number; high: number; low: number; close: number; volume: number }[]
): Promise<void> {
  if (data.length === 0) return;

  const safeTable = validateTableName(tableName);

  return new Promise((resolve, reject) => {
    conn.run(`
      CREATE OR REPLACE TABLE "${safeTable}" (
        symbol VARCHAR,
        timestamp BIGINT,
        open DOUBLE,
        high DOUBLE,
        low DOUBLE,
        close DOUBLE,
        volume DOUBLE
      )
    `, (err) => {
      if (err) return reject(err);

      const stmt = conn.prepare(`INSERT INTO "${safeTable}" VALUES (?, ?, ?, ?, ?, ?, ?)`);

      const BATCH_SIZE = 10000;
      let processed = 0;

      const insertBatch = () => {
        const end = Math.min(processed + BATCH_SIZE, data.length);
        for (let i = processed; i < end; i++) {
          const row = data[i];
          stmt.run(
            validateSymbol(row.symbol),
            row.timestamp,
            row.open,
            row.high,
            row.low,
            row.close,
            row.volume
          );
        }
        processed = end;

        if (processed < data.length) {
          setImmediate(insertBatch);
        } else {
          stmt.finalize((err) => {
            if (err) reject(err);
            else resolve();
          });
        }
      };

      insertBatch();
    });
  });
}

export async function bulkLoadOHLCV(
  tableName: string,
  data: { symbol: string; timestamp: number; open: number; high: number; low: number; close: number; volume: number }[]
): Promise<void> {
  if (data.length === 0) return;
  return withMutex(() => bulkLoadOHLCVUnlocked(tableName, data));
}

export async function aggregateOHLCV(
  data: { timestamp: number; open: number; high: number; low: number; close: number; volume: number }[],
  intervalMinutes: number
): Promise<{ bucket: number; open: number; high: number; low: number; close: number; volume: number }[]> {
  if (data.length === 0) return [];

  const validatedInterval = validatePositiveInteger(intervalMinutes, 'intervalMinutes', 1440);
  const tableName = `ohlcv_agg_${Date.now()}`;

  return withMutex(async () => {
    await bulkLoadOHLCVUnlocked(tableName, data.map(d => ({ ...d, symbol: 'TEMP' })));

    const intervalMs = validatedInterval * 60 * 1000;

    const results = await runQueryUnlocked<{ bucket: number; open: number; high: number; low: number; close: number; volume: number }>(`
      SELECT
        (timestamp / ${intervalMs}) * ${intervalMs} as bucket,
        first(open ORDER BY timestamp) as open,
        max(high) as high,
        min(low) as low,
        last(close ORDER BY timestamp) as close,
        sum(volume) as volume
      FROM "${tableName}"
      GROUP BY (timestamp / ${intervalMs}) * ${intervalMs}
      ORDER BY bucket
    `);

    await runQueryUnlocked(`DROP TABLE IF EXISTS "${tableName}"`);

    return results;
  });
}

// Fast cursor-based pagination for large datasets using DuckDB
export async function queryOHLCVCursor(
  symbol: string,
  cursor?: number,
  limit: number = 1000,
  direction: 'forward' | 'backward' = 'forward'
): Promise<{ data: any[]; nextCursor: number | null; prevCursor: number | null }> {
  const safeSymbol = validateSymbol(symbol);
  const parquetPath = path.join(PARQUET_DIR, `${safeSymbol}_ohlcv.parquet`);
  const safeLimit = validatePositiveInteger(limit, 'limit', 5000);

  if (!fs.existsSync(parquetPath)) {
    return { data: [], nextCursor: null, prevCursor: null };
  }

  let sql: string;
  const params: any[] = [parquetPath];

  if (direction === 'forward') {
    sql = cursor !== undefined
      ? `SELECT * FROM read_parquet(?) WHERE timestamp > ? ORDER BY timestamp ASC LIMIT ?`
      : `SELECT * FROM read_parquet(?) ORDER BY timestamp ASC LIMIT ?`;
    if (cursor !== undefined) params.push(cursor);
    params.push(safeLimit + 1); // Fetch one extra to check if there's more
  } else {
    sql = cursor !== undefined
      ? `SELECT * FROM read_parquet(?) WHERE timestamp < ? ORDER BY timestamp DESC LIMIT ?`
      : `SELECT * FROM read_parquet(?) ORDER BY timestamp DESC LIMIT ?`;
    if (cursor !== undefined) params.push(cursor);
    params.push(safeLimit + 1);
  }

  return withMutex(() => new Promise((resolve, reject) => {
    const stmt = conn.prepare(sql);
    stmt.all(...params, (err: Error | null, result: any[]) => {
      stmt.finalize();
      if (err) return reject(err);

      const hasMore = result.length > safeLimit;
      const data = result.slice(0, safeLimit).map(row => {
        const converted: Record<string, any> = {};
        for (const [key, value] of Object.entries(row)) {
          converted[key] = typeof value === 'bigint' ? Number(value) : value;
        }
        return converted;
      });

      // For backward direction, reverse to get chronological order
      if (direction === 'backward') data.reverse();

      const nextCursor = hasMore && data.length > 0 ? data[data.length - 1].timestamp : null;
      const prevCursor = data.length > 0 ? data[0].timestamp : null;

      resolve({ data, nextCursor, prevCursor });
    });
  }));
}

// Query a parquet file directly
export async function queryParquet(sql: string): Promise<any[]> {
  return executeDuckDBQuery(sql);
}

// Query parquet with pagination for streaming
export async function queryParquetWithPagination(
  symbolOrPath: string,
  offset: number = 0,
  limit: number = 5000
): Promise<any[]> {
  let parquetPath: string;

  if (symbolOrPath.endsWith('.parquet')) {
    parquetPath = symbolOrPath;
  } else {
    const safeSymbol = validateSymbol(symbolOrPath);
    parquetPath = path.join(PARQUET_DIR, `${safeSymbol}_ohlcv.parquet`);
  }

  if (!fs.existsSync(parquetPath)) {
    return [];
  }

  const safeOffset = Math.max(0, Math.floor(offset));
  const safeLimit = Math.min(Math.max(1, Math.floor(limit)), 100000);

  const sql = `
    SELECT timestamp, open, high, low, close, volume
    FROM read_parquet('${parquetPath}')
    ORDER BY timestamp
    LIMIT ${safeLimit} OFFSET ${safeOffset}
  `;

  return executeDuckDBQuery(sql);
}

// Execute arbitrary DuckDB query
export async function executeDuckDBQuery(sql: string): Promise<any[]> {
  return withMutex(() => new Promise((resolve, reject) => {
    conn.all(sql, (err, result) => {
      if (err) return reject(err);
      // Convert BigInt to Number for JSON serialization
      const converted = (result || []).map(row => {
        const obj: Record<string, any> = {};
        for (const [key, value] of Object.entries(row as object)) {
          obj[key] = typeof value === 'bigint' ? Number(value) : value;
        }
        return obj;
      });
      resolve(converted);
    });
  }));
}

// Fast analytics using DuckDB for ML Hub performance metrics
export async function computeOHLCVStats(symbol: string): Promise<{
  count: number;
  minTimestamp: number;
  maxTimestamp: number;
  avgVolume: number;
  priceRange: { min: number; max: number };
}> {
  const safeSymbol = validateSymbol(symbol);
  const parquetPath = path.join(PARQUET_DIR, `${safeSymbol}_ohlcv.parquet`);

  if (!fs.existsSync(parquetPath)) {
    return { count: 0, minTimestamp: 0, maxTimestamp: 0, avgVolume: 0, priceRange: { min: 0, max: 0 } };
  }

  const sql = `
    SELECT
      COUNT(*) as count,
      MIN(timestamp) as min_ts,
      MAX(timestamp) as max_ts,
      AVG(volume) as avg_volume,
      MIN(low) as min_price,
      MAX(high) as max_price
    FROM read_parquet(?)
  `;

  return withMutex(() => new Promise((resolve, reject) => {
    conn.all(sql, [parquetPath], (err, result) => {
      if (err) return reject(err);
      const row = result[0] as any;
      resolve({
        count: Number(row?.count || 0),
        minTimestamp: Number(row?.min_ts || 0),
        maxTimestamp: Number(row?.max_ts || 0),
        avgVolume: Number(row?.avg_volume || 0),
        priceRange: { min: Number(row?.min_price || 0), max: Number(row?.max_price || 0) }
      });
    });
  }));
}
