import { queryQuestDB } from "./connection";

/** Known QuestDB indicator table timeframes and their partition strategies */
const INDICATOR_TIMEFRAMES: { suffix: string; partition: string }[] = [
  { suffix: '5m', partition: 'MONTH' },
  { suffix: '15m', partition: 'MONTH' },
  { suffix: '30m', partition: 'YEAR' },
  { suffix: '1h', partition: 'YEAR' },
  { suffix: '4h', partition: 'YEAR' },
  { suffix: '1d', partition: 'YEAR' },
  { suffix: '1w', partition: 'YEAR' },
];

export async function createOHLCVTable(): Promise<void> {
  // Original ohlcv table (kept for compatibility during migration)
  await queryQuestDB(`
    CREATE TABLE IF NOT EXISTS ohlcv (
      symbol SYMBOL CAPACITY 50 CACHE INDEX,
      timestamp TIMESTAMP,
      open DOUBLE,
      high DOUBLE,
      low DOUBLE,
      close DOUBLE,
      volume DOUBLE
    ) timestamp(timestamp) PARTITION BY DAY WAL
    DEDUP UPSERT KEYS(symbol, timestamp);
  `);

  // New Separate Forex Table (Aligned with your existing ohlcv_forex)
  await queryQuestDB(`
    CREATE TABLE IF NOT EXISTS ohlcv_forex (
      symbol SYMBOL CAPACITY 100 CACHE INDEX,
      timestamp TIMESTAMP,
      open DOUBLE,
      high DOUBLE,
      low DOUBLE,
      close DOUBLE,
      volume DOUBLE
    ) timestamp(timestamp) PARTITION BY DAY WAL
    DEDUP UPSERT KEYS(symbol, timestamp);
  `);

  // Rollovers Table (Aligned with your existing rollovers)
  await queryQuestDB(`
    CREATE TABLE IF NOT EXISTS rollovers (
      root SYMBOL CAPACITY 50 CACHE INDEX,
      rollover_date TIMESTAMP,
      from_contract SYMBOL CAPACITY 200 CACHE,
      to_contract SYMBOL CAPACITY 200 CACHE,
      from_close DOUBLE,
      to_close DOUBLE,
      price_gap DOUBLE,
      cumulative_adjustment DOUBLE
    ) timestamp(rollover_date) PARTITION BY YEAR WAL
    DEDUP UPSERT KEYS(root, rollover_date);
  `);
}

export async function createTradesTable(): Promise<void> {
  await queryQuestDB(`
    CREATE TABLE IF NOT EXISTS trades (
      ts_event TIMESTAMP,
      rtype SHORT,
      publisher_id INT,
      instrument_id LONG,
      action SYMBOL CAPACITY 10 CACHE,
      side SYMBOL CAPACITY 10 CACHE,
      depth SHORT,
      price DOUBLE,
      size LONG,
      flags SHORT,
      ts_in_delta INT,
      sequence LONG,
      symbol SYMBOL CAPACITY 200 CACHE INDEX,
      ts_recv TIMESTAMP
    ) timestamp(ts_event) PARTITION BY DAY WAL
    DEDUP UPSERT KEYS(symbol, ts_event, sequence);
  `);
}

export async function createMBP10Table(): Promise<void> {
  const bookLevels = Array.from({ length: 10 }, (_, i) => {
    const pad = String(i).padStart(2, '0');
    return `bid_px_${pad} DOUBLE, ask_px_${pad} DOUBLE, bid_sz_${pad} LONG, ask_sz_${pad} LONG, bid_ct_${pad} INT, ask_ct_${pad} INT`;
  }).join(',\n      ');

  await queryQuestDB(`
    CREATE TABLE IF NOT EXISTS mbp10 (
      ts_recv TIMESTAMP,
      ts_event TIMESTAMP,
      rtype SHORT,
      publisher_id INT,
      instrument_id LONG,
      action SYMBOL CAPACITY 10 CACHE,
      side SYMBOL CAPACITY 10 CACHE,
      depth SHORT,
      price DOUBLE,
      size LONG,
      flags SHORT,
      ts_in_delta INT,
      sequence LONG,
      ${bookLevels},
      symbol SYMBOL CAPACITY 200 CACHE INDEX
    ) timestamp(ts_event) PARTITION BY DAY WAL
    DEDUP UPSERT KEYS(symbol, ts_event, sequence);
  `);
}

export async function initQuestDBTables(): Promise<void> {
  await createOHLCVTable();
  await createTradesTable();
  await createMBP10Table();
  await createIndicatorTables();
}

/**
 * Create indicator materialized-view tables if they don't exist.
 * These mirror the schema used by scripts/upload-indicators-questdb.py.
 * Only OHLCV + symbol + asset_class columns are created here — the full
 * 344-column schema is extended by the upload script via ALTER TABLE.
 */
async function createIndicatorTables(): Promise<void> {
  for (const { suffix, partition } of INDICATOR_TIMEFRAMES) {
    try {
      await queryQuestDB(`
        CREATE TABLE IF NOT EXISTS indicators_${suffix} (
          symbol SYMBOL CAPACITY 50 CACHE INDEX,
          asset_class SYMBOL CAPACITY 5 CACHE,
          timestamp TIMESTAMP,
          open DOUBLE,
          high DOUBLE,
          low DOUBLE,
          close DOUBLE,
          volume DOUBLE
        ) timestamp(timestamp) PARTITION BY ${partition} WAL
        DEDUP UPSERT KEYS(symbol, timestamp);
      `);
    } catch (e) {
      // Table may already exist with extended schema — that's fine
      console.warn(`[questdb] indicator table indicators_${suffix} creation skipped: ${e instanceof Error ? e.message : e}`);
    }
  }
  console.log(`[questdb] Indicator tables ensured (${INDICATOR_TIMEFRAMES.map(t => t.suffix).join(', ')})`);
}
