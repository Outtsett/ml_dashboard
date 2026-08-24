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

export async function createPredictionLogTable(): Promise<void> {
  await queryQuestDB(`
    CREATE TABLE IF NOT EXISTS prediction_log (
      model_id SYMBOL CAPACITY 100 CACHE INDEX,
      symbol SYMBOL CAPACITY 200 CACHE INDEX,
      predicted_class SHORT,
      actual_class SHORT,
      confidence DOUBLE,
      prob_tp DOUBLE,
      prob_sl DOUBLE,
      prob_timeout DOUBLE,
      realized_return DOUBLE,
      exit_bars INT,
      barrier_hit SYMBOL CAPACITY 10 CACHE,
      fold_index SHORT,
      split_type SYMBOL CAPACITY 5 CACHE,
      timestamp TIMESTAMP
    ) timestamp(timestamp) PARTITION BY MONTH WAL
    DEDUP UPSERT KEYS(model_id, symbol, timestamp);
  `);
}

export async function initQuestDBTables(): Promise<void> {
  await createOHLCVTable();
  await createPredictionLogTable();
}
