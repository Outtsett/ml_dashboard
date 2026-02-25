/**
 * Label Service Helpers
 *
 * Shared utilities for label generation: DuckDB access, OHLCV loading,
 * and synthetic data generation.
 */

// Dynamic import to avoid circular dependencies
export async function getDuckDB() {
  const duckdb = await import('../../duckdb');
  return {
    runQuery: duckdb.runQuery,
    executeDuckDBQuery: duckdb.executeDuckDBQuery,
  };
}

export async function queryDuckDB(sql: string): Promise<Array<Record<string, unknown>>> {
  const { executeDuckDBQuery } = await getDuckDB();
  return executeDuckDBQuery(sql);
}

// Generate synthetic OHLCV data for preview purposes when no real data exists
export async function generateSyntheticOHLCV(symbol: string, count: number = 1000): Promise<void> {
  const { executeDuckDBQuery } = await getDuckDB();

  // Create realistic-looking synthetic data using DuckDB
  await executeDuckDBQuery(`
    CREATE TABLE ohlcv AS
    WITH RECURSIVE dates AS (
      SELECT 
        1 as idx,
        1704067200000::BIGINT as ts,  -- Jan 1, 2024
        100.0 as price
      UNION ALL
      SELECT 
        idx + 1,
        ts + 60000,  -- 1-minute bars
        price * (1 + (RANDOM() - 0.5) * 0.002)  -- Random walk
      FROM dates
      WHERE idx < ${count}
    ),
    ohlcv_gen AS (
      SELECT
        ts as timestamp,
        '${symbol}' as symbol,
        price * (1 + (RANDOM() - 0.5) * 0.001) as open,
        price * (1 + RANDOM() * 0.002) as high,
        price * (1 - RANDOM() * 0.002) as low,
        price as close,
        (RANDOM() * 10000 + 1000)::INTEGER as volume
      FROM dates
    )
    SELECT * FROM ohlcv_gen
  `);
}

// Load OHLCV data from QuestDB into analytics DuckDB table for label generation
export interface LoadOHLCVOptions {
  symbol: string;
  limit?: number;
  startTimestamp?: number; // In milliseconds - filter data from this time
  endTimestamp?: number;   // In milliseconds - filter data up to this time
  timeframeMinutes?: number; // Timeframe to aggregate to (default 1 = 1-minute)
}

export async function loadOHLCVIntoDuckDB(options: LoadOHLCVOptions): Promise<void> {
  const { symbol, limit = 50000, startTimestamp, endTimestamp, timeframeMinutes = 1 } = options;
  const { executeDuckDBQuery } = await getDuckDB();
  const intervalSec = timeframeMinutes * 60;

  console.log(`[LabelService] Loading OHLCV from market.duckdb for ${symbol}, tf=${timeframeMinutes}m, range: ${startTimestamp} - ${endTimestamp}`);

  // Drop existing temp ohlcv table in analytics DuckDB
  try {
    await executeDuckDBQuery('DROP TABLE IF EXISTS ohlcv');
  } catch (e) {
    // Ignore if table doesn't exist
  }

  // Query real market data from file-backed market.duckdb
  const { questdbMarketQuery: marketQuery } = await import('../../lib/questdbMarketQuery');

  // Build time filter for QuestDB queries
  let timeFilter = '';
  if (startTimestamp && endTimestamp) {
    const startMs = startTimestamp < 1e12 ? startTimestamp * 1000 : startTimestamp;
    const endMs = endTimestamp < 1e12 ? endTimestamp * 1000 : endTimestamp;
    timeFilter = ` AND epoch_ms(ts) >= ${startMs} AND epoch_ms(ts) <= ${endMs}`;
  }

  // Detect if this is a root symbol (e.g. ES, NQ) vs specific contract (ESH5) or forex (EURUSD)
  const isRootSymbol = symbol.length <= 3 && /^[A-Z]+$/.test(symbol);
  const symbolFilter = isRootSymbol
    ? `symbol ~ '^${symbol}[FGHJKMNQUVXZ][0-9]{1,2}$'`
    : `symbol = '${symbol}'`;

  // Query QuestDB ohlcv — for root symbols, match all contracts via regex
  const ohlcvRows = await marketQuery<{
    timestamp: number;
    symbol: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>(`
    SELECT
      CAST(epoch_ms(time_bucket(INTERVAL '${intervalSec} seconds', ts)) AS DOUBLE) as timestamp,
      '${symbol}' as symbol,
      first(open ORDER BY ts) as open,
      max(high) as high,
      min(low) as low,
      last(close ORDER BY ts) as close,
      CAST(sum(volume) AS DOUBLE) as volume
    FROM ohlcv
    WHERE ${symbolFilter}${timeFilter}
    GROUP BY time_bucket(INTERVAL '${intervalSec} seconds', ts)
    ORDER BY timestamp DESC
    LIMIT ${limit}
  `);

  console.log(`[LabelService] ${isRootSymbol ? 'Root symbol' : 'Direct symbol'} query returned ${ohlcvRows.length} rows for ${symbol}`);

  if (ohlcvRows.length === 0) {
    // Fall back to synthetic data only if no market data exists for this symbol
    console.warn(`[LabelService] No market data found for ${symbol}, generating synthetic data`);
    await generateSyntheticOHLCV(symbol, limit);
    return;
  }

  // Sort ascending for proper label generation (WINDOW functions need chronological order)
  ohlcvRows.sort((a, b) => Number(a.timestamp) - Number(b.timestamp));

  // Create the ohlcv table in analytics DuckDB
  await executeDuckDBQuery(`
    CREATE TABLE ohlcv (
      timestamp BIGINT,
      symbol VARCHAR,
      open DOUBLE,
      high DOUBLE,
      low DOUBLE,
      close DOUBLE,
      volume DOUBLE
    )
  `);

  // Insert data in batches
  const batchSize = 1000;
  for (let i = 0; i < ohlcvRows.length; i += batchSize) {
    const batch = ohlcvRows.slice(i, i + batchSize);
    const values = batch.map(row =>
      `(${Number(row.timestamp)}, '${row.symbol}', ${row.open}, ${row.high}, ${row.low}, ${row.close}, ${row.volume})`
    ).join(',\n');

    await executeDuckDBQuery(`INSERT INTO ohlcv VALUES ${values}`);
  }
}
