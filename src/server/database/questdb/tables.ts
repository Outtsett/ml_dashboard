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
  await queryQuestDB(`
    CREATE TABLE IF NOT EXISTS ohlcv (
      symbol SYMBOL CAPACITY 200 CACHE INDEX,
      asset_class SYMBOL CAPACITY 10 CACHE INDEX,
      root SYMBOL CAPACITY 50 CACHE INDEX,
      timestamp TIMESTAMP,
      open DOUBLE,
      high DOUBLE,
      low DOUBLE,
      close DOUBLE,
      volume DOUBLE
    ) timestamp(timestamp) PARTITION BY DAY WAL
    DEDUP UPSERT KEYS(symbol, timestamp);
  `);

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

  await queryQuestDB(`
    CREATE TABLE IF NOT EXISTS symbols (
      symbol SYMBOL CAPACITY 500 CACHE INDEX,
      asset_class SYMBOL CAPACITY 10 CACHE INDEX,
      root SYMBOL CAPACITY 50 CACHE,
      exchange SYMBOL CAPACITY 20 CACHE,
      currency SYMBOL CAPACITY 10 CACHE,
      tick_size DOUBLE,
      point_value DOUBLE,
      pip_size DOUBLE,
      contract_size DOUBLE,
      decimal_places SHORT,
      timestamp TIMESTAMP
    ) timestamp(timestamp) PARTITION BY YEAR WAL
    DEDUP UPSERT KEYS(symbol, timestamp);
  `);
}

export async function initQuestDBTables(): Promise<void> {
  await createOHLCVTable();
  await createIndicatorTables();
}

/**
 * Create indicator tables if they don't exist.
 * These mirror the schema used by scripts/upload-indicators-questdb.py.
 * Only OHLCV + symbol + asset_class + root columns are created here — the full
 * 344-column schema is extended by the upload script via ALTER TABLE.
 */
async function createIndicatorTables(): Promise<void> {
  for (const { suffix, partition } of INDICATOR_TIMEFRAMES) {
    try {
      await queryQuestDB(`
        CREATE TABLE IF NOT EXISTS indicators_${suffix} (
          symbol SYMBOL CAPACITY 200 CACHE INDEX,
          asset_class SYMBOL CAPACITY 10 CACHE,
          root SYMBOL CAPACITY 50 CACHE INDEX,
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
