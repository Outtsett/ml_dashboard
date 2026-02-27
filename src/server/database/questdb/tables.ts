import { queryQuestDB } from "./connection";

export async function createOHLCVTable(): Promise<void> {
  const sql = `
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
  `;

  await queryQuestDB(sql);
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
}
