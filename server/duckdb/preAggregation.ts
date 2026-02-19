import * as fs from 'fs';
import * as path from 'path';
import { validateSymbol } from "@shared/schema";
import { conn, withMutex, PARQUET_DIR } from "./core";
import { queryParquetOHLCVAggregated } from "./queries";

// Pre-aggregate parquet file into multiple timeframes
// This creates separate parquet files for each timeframe for instant loading
export async function createPreAggregatedParquetFiles(symbol: string): Promise<{
  timeframes: { timeframe: number; file: string; rowCount: number }[];
  rolloverInfo: { timestamp: number; fromContract: string; toContract: string; priceAdjustment: number }[];
}> {
  const safeSymbol = validateSymbol(symbol);
  const sourceParquet = path.join(PARQUET_DIR, `${safeSymbol}_ohlcv.parquet`);

  if (!fs.existsSync(sourceParquet)) {
    throw new Error(`Source parquet file not found: ${sourceParquet}`);
  }

  return withMutex(async () => {
  const timeframes = [
    { name: '1m', minutes: 1 },
    { name: '5m', minutes: 5 },
    { name: '15m', minutes: 15 },
    { name: '30m', minutes: 30 },
    { name: '1h', minutes: 60 },
    { name: '4h', minutes: 240 },
    { name: '1d', minutes: 1440 },
  ];

  const results: { timeframe: number; file: string; rowCount: number }[] = [];
  const rolloverInfo: { timestamp: number; fromContract: string; toContract: string; priceAdjustment: number }[] = [];

  // First, detect contract rollovers using volume-based method
  console.log(`[duckdb] Detecting contract rollovers for ${safeSymbol}...`);

  // Simple volume-based rollover detection:
  // Find days where volume leader changes, then get both contract prices on that day
  const rolloverSql = `
    WITH daily_volume AS (
      SELECT
        symbol,
        DATE_TRUNC('day', TO_TIMESTAMP(timestamp / 1000)) as trade_date,
        SUM(volume) as total_volume,
        LAST(close ORDER BY timestamp) as close_price
      FROM read_parquet(?)
      GROUP BY symbol, DATE_TRUNC('day', TO_TIMESTAMP(timestamp / 1000))
    ),
    ranked AS (
      SELECT
        trade_date,
        symbol,
        total_volume,
        close_price,
        ROW_NUMBER() OVER (PARTITION BY trade_date ORDER BY total_volume DESC) as rank
      FROM daily_volume
    ),
    daily_leaders AS (
      SELECT trade_date, symbol as leader
      FROM ranked WHERE rank = 1
    ),
    leader_changes AS (
      SELECT
        d1.trade_date as rollover_date,
        d2.leader as from_contract,
        d1.leader as to_contract
      FROM daily_leaders d1
      JOIN daily_leaders d2 ON d1.trade_date = d2.trade_date + INTERVAL '1 day'
      WHERE d1.leader != d2.leader
    ),
    rollover_prices AS (
      SELECT
        lc.rollover_date,
        lc.from_contract,
        lc.to_contract,
        prev.close_price as prev_contract_price,
        curr.close_price as next_contract_price
      FROM leader_changes lc
      JOIN daily_volume prev ON prev.symbol = lc.from_contract
        AND prev.trade_date = lc.rollover_date
      JOIN daily_volume curr ON curr.symbol = lc.to_contract
        AND curr.trade_date = lc.rollover_date
    )
    SELECT
      EPOCH_MS(rollover_date)::BIGINT as timestamp,
      from_contract,
      to_contract,
      prev_contract_price - next_contract_price as price_adjustment
    FROM rollover_prices
    ORDER BY rollover_date
  `;

  await new Promise<void>((resolve, reject) => {
    const stmt = conn.prepare(rolloverSql);
    stmt.all(sourceParquet, (err: Error | null, result: any[]) => {
      stmt.finalize();
      if (err) {
        console.log(`[duckdb] Error detecting rollovers: ${err.message}`);
        resolve(); // Continue without rollover info
      } else {
        for (const row of result) {
          rolloverInfo.push({
            timestamp: Number(row.timestamp),
            fromContract: row.from_contract,
            toContract: row.to_contract,
            priceAdjustment: row.price_adjustment
          });
        }
        console.log(`[duckdb] Found ${rolloverInfo.length} contract rollovers`);
        resolve();
      }
    });
  });

  // Calculate cumulative back-adjustment from rollovers (Panama Canal method)
  // Each rollover adds to the cumulative adjustment for all bars BEFORE that rollover
  // Sort rollovers by timestamp descending to calculate cumulative adjustment from newest to oldest
  const sortedRollovers = [...rolloverInfo].sort((a, b) => b.timestamp - a.timestamp);
  let cumulativeAdjustment = 0;
  const adjustmentsByTime: { timestamp: number; cumulativeAdj: number }[] = [];

  for (const rollover of sortedRollovers) {
    cumulativeAdjustment += rollover.priceAdjustment;
    adjustmentsByTime.push({
      timestamp: rollover.timestamp,
      cumulativeAdj: cumulativeAdjustment
    });
  }
  // Reverse so it's oldest to newest
  adjustmentsByTime.reverse();

  console.log(`[duckdb] Calculated cumulative adjustments for ${adjustmentsByTime.length} rollovers`);
  if (adjustmentsByTime.length > 0) {
    console.log(`[duckdb] Total cumulative adjustment: ${cumulativeAdjustment.toFixed(2)}`);
  }

  // Build SQL CASE statement for price adjustments
  // For each bar, add the cumulative adjustment based on its timestamp
  let adjustmentCaseExpr = '0';
  if (adjustmentsByTime.length > 0) {
    const cases = adjustmentsByTime.map((adj, idx) => {
      if (idx === 0) {
        return `WHEN bar_time < ${adj.timestamp} THEN ${adj.cumulativeAdj}`;
      }
      return `WHEN bar_time < ${adj.timestamp} THEN ${adj.cumulativeAdj}`;
    }).join('\n            ');
    adjustmentCaseExpr = `CASE\n            ${cases}\n            ELSE 0\n          END`;
  }

  // Create aggregated parquet files for each timeframe with back-adjusted prices
  for (const tf of timeframes) {
    const outputFile = path.join(PARQUET_DIR, `${safeSymbol}_${tf.name}.parquet`);
    const timeframeMs = tf.minutes * 60 * 1000;

    console.log(`[duckdb] Creating ${tf.name} aggregated parquet for ${safeSymbol}...`);

    // Aggregate and write to parquet with Panama Canal back-adjustment
    // Volume is NOT back-adjusted per industry standard (only prices)
    // Key: Determine DAILY leader first, then use only that contract's bars for the day
    const aggregateSql = `
      COPY (
        WITH daily_volume AS (
          SELECT
            symbol,
            DATE_TRUNC('day', TO_TIMESTAMP(timestamp / 1000)) as trade_date,
            SUM(volume) as total_volume
          FROM read_parquet('${sourceParquet}')
          GROUP BY symbol, DATE_TRUNC('day', TO_TIMESTAMP(timestamp / 1000))
        ),
        daily_leader AS (
          SELECT trade_date, symbol as leader
          FROM (
            SELECT *, ROW_NUMBER() OVER (PARTITION BY trade_date ORDER BY total_volume DESC) as rn
            FROM daily_volume
          )
          WHERE rn = 1
        ),
        raw_bars AS (
          SELECT
            symbol,
            (FLOOR(timestamp / ${timeframeMs}) * ${timeframeMs})::BIGINT as bar_time,
            DATE_TRUNC('day', TO_TIMESTAMP(timestamp / 1000)) as trade_date,
            FIRST(open) as open,
            MAX(high) as high,
            MIN(low) as low,
            LAST(close) as close,
            SUM(volume)::BIGINT as volume
          FROM read_parquet('${sourceParquet}')
          GROUP BY symbol, FLOOR(timestamp / ${timeframeMs}), DATE_TRUNC('day', TO_TIMESTAMP(timestamp / 1000))
        ),
        continuous AS (
          SELECT b.symbol, b.bar_time, b.open, b.high, b.low, b.close, b.volume
          FROM raw_bars b
          JOIN daily_leader d ON b.trade_date = d.trade_date AND b.symbol = d.leader
        )
        -- Raw prices without Panama adjustment - just volume-based contract switching
        SELECT symbol, bar_time as timestamp, open, high, low, close, volume
        FROM continuous
        ORDER BY timestamp
      ) TO '${outputFile}' (FORMAT PARQUET, COMPRESSION ZSTD)
    `;

    await new Promise<void>((resolve, reject) => {
      conn.run(aggregateSql, (err: Error | null) => {
        if (err) {
          console.log(`[duckdb] Error creating ${tf.name} parquet: ${err.message}`);
          reject(err);
        } else {
          resolve();
        }
      });
    });

    // Count rows in the new parquet file
    const countSql = `SELECT COUNT(*) as cnt FROM read_parquet('${outputFile}')`;
    const rowCount = await new Promise<number>((resolve, reject) => {
      conn.all(countSql, (err: Error | null, result: any[]) => {
        if (err) reject(err);
        else resolve(Number(result[0]?.cnt || 0));
      });
    });

    results.push({
      timeframe: tf.minutes,
      file: outputFile,
      rowCount
    });

    console.log(`[duckdb] Created ${tf.name} parquet: ${rowCount.toLocaleString()} bars`);
  }

  // Save rollover info to a JSON file for quick loading
  const rolloverFile = path.join(PARQUET_DIR, `${safeSymbol}_rollovers.json`);
  fs.writeFileSync(rolloverFile, JSON.stringify(rolloverInfo, null, 2));
  console.log(`[duckdb] Saved rollover info to ${rolloverFile}`);

  return { timeframes: results, rolloverInfo };
  }); // end withMutex
}

// Query pre-aggregated parquet file (much faster than on-the-fly aggregation)
export async function queryPreAggregatedParquet(
  symbol: string,
  timeframeMinutes: number,
  startTime?: number,
  endTime?: number,
  limit: number = 2000,
  loadFromEnd: boolean = true
): Promise<any[]> {
  const safeSymbol = validateSymbol(symbol);

  // Map timeframe to filename
  const tfMap: Record<number, string> = {
    1: '1m', 5: '5m', 15: '15m', 30: '30m', 60: '1h', 240: '4h', 1440: '1d'
  };

  const tfName = tfMap[timeframeMinutes];
  if (!tfName) {
    // Fallback to on-the-fly aggregation for unsupported timeframes
    return queryParquetOHLCVAggregated(symbol, timeframeMinutes, startTime, endTime, limit, 0, loadFromEnd);
  }

  const parquetPath = path.join(PARQUET_DIR, `${safeSymbol}_${tfName}.parquet`);

  if (!fs.existsSync(parquetPath)) {
    // Pre-aggregated file doesn't exist, fall back to on-the-fly
    console.log(`[duckdb] Pre-aggregated file not found, using on-the-fly: ${parquetPath}`);
    return queryParquetOHLCVAggregated(symbol, timeframeMinutes, startTime, endTime, limit, 0, loadFromEnd);
  }

  // Build efficient query against pre-aggregated parquet
  const params: any[] = [parquetPath];
  let whereClause = '';

  if (startTime) {
    whereClause += ` AND timestamp >= ?`;
    params.push(startTime);
  }
  if (endTime) {
    whereClause += ` AND timestamp <= ?`;
    params.push(endTime);
  }

  // Determine sort order
  const loadingEarlier = endTime && !startTime;
  const initialLoad = !startTime && !endTime;
  const orderDir = (loadFromEnd && (initialLoad || loadingEarlier)) ? 'DESC' : 'ASC';
  const needsReverse = loadFromEnd && (initialLoad || loadingEarlier);

  const sql = `
    SELECT symbol, timestamp, open, high, low, close, volume
    FROM read_parquet(?)
    WHERE 1=1 ${whereClause}
    ORDER BY timestamp ${orderDir}
    LIMIT ?
  `;
  params.push(limit);

  return withMutex(() => new Promise((resolve, reject) => {
    const stmt = conn.prepare(sql);
    stmt.all(...params, (err: Error | null, result: any[]) => {
      stmt.finalize();
      if (err) reject(err);
      else {
        const serializable = result.map(row => {
          const converted: Record<string, any> = {};
          for (const [key, value] of Object.entries(row)) {
            converted[key] = typeof value === 'bigint' ? Number(value) : value;
          }
          return converted;
        });
        resolve(needsReverse ? serializable.reverse() : serializable);
      }
    });
  }));
}

// Check if pre-aggregated files exist for a symbol
export function hasPreAggregatedFiles(symbol: string): boolean {
  const safeSymbol = validateSymbol(symbol);
  const oneMinuteFile = path.join(PARQUET_DIR, `${safeSymbol}_1m.parquet`);
  return fs.existsSync(oneMinuteFile);
}

// Get rollover info from JSON file
export function getRolloverInfo(symbol: string): { timestamp: number; fromContract: string; toContract: string; priceAdjustment: number }[] {
  const safeSymbol = validateSymbol(symbol);
  const rolloverFile = path.join(PARQUET_DIR, `${safeSymbol}_rollovers.json`);

  if (!fs.existsSync(rolloverFile)) {
    return [];
  }

  try {
    return JSON.parse(fs.readFileSync(rolloverFile, 'utf-8'));
  } catch (e) {
    return [];
  }
}
