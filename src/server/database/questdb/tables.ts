import { queryQuestDB } from "./connection";

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
}
