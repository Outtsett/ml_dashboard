/**
 * Sync market data from DuckDB → QuestDB for chart rendering.
 * Uses QuestDB's ILP (InfluxDB Line Protocol) for fast ingestion.
 */
import { Sender } from '@questdb/nodejs-client';
import { marketQuery } from '../duckdb/market';

const QUESTDB_HOST = process.env.QUESTDB_HOST || 'localhost';
const QUESTDB_HTTP_PORT = process.env.QUESTDB_HTTP_PORT || '9000';
const BATCH_SIZE = 50000;

export interface SyncResult {
  symbol: string;
  rowsSynced: number;
  duration: number;
}

/**
 * Sync a single symbol from DuckDB ohlcv → QuestDB ohlcv.
 */
export async function syncSymbol(symbol: string, lastQuestDBTimestamp?: Date): Promise<SyncResult> {
  const start = Date.now();
  const configStr = `http::addr=${QUESTDB_HOST}:${QUESTDB_HTTP_PORT};`;
  const sender = await Sender.fromConfig(configStr);

  let whereClause = `WHERE symbol = '${symbol}'`;
  if (lastQuestDBTimestamp) {
    whereClause += ` AND ts > '${lastQuestDBTimestamp.toISOString()}'`;
  }

  const countResult = await marketQuery<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM ohlcv ${whereClause}`
  );
  const totalRows = Number(countResult[0].cnt);

  if (totalRows === 0) {
    await sender.close();
    return { symbol, rowsSynced: 0, duration: Date.now() - start };
  }

  console.log(`[sync] ${symbol}: syncing ${totalRows.toLocaleString()} rows...`);

  let offset = 0;
  let synced = 0;

  while (offset < totalRows) {
    const batch = await marketQuery<{
      ts: string; open: number; high: number; low: number; close: number; volume: number;
    }>(`
      SELECT ts::VARCHAR as ts, open, high, low, close, volume
      FROM ohlcv ${whereClause}
      ORDER BY ts
      LIMIT ${BATCH_SIZE} OFFSET ${offset}
    `);

    for (const row of batch) {
      await sender
        .table('ohlcv')
        .symbol('symbol', symbol)
        .floatColumn('open', row.open)
        .floatColumn('high', row.high)
        .floatColumn('low', row.low)
        .floatColumn('close', row.close)
        .floatColumn('volume', Number(row.volume))
        .at(new Date(row.ts).getTime(), 'ms');
    }

    await sender.flush();
    synced += batch.length;
    offset += BATCH_SIZE;

    if (synced % 500000 === 0) {
      console.log(`[sync] ${symbol}: ${synced.toLocaleString()} / ${totalRows.toLocaleString()}`);
    }
  }

  await sender.close();
  const duration = Date.now() - start;
  console.log(`[sync] ${symbol}: done (${synced.toLocaleString()} rows in ${(duration / 1000).toFixed(1)}s)`);

  return { symbol, rowsSynced: synced, duration };
}

/**
 * Sync all symbols from DuckDB → QuestDB.
 */
export async function syncAllToQuestDB(): Promise<SyncResult[]> {
  const symbols = await marketQuery<{ symbol: string }>(
    'SELECT DISTINCT symbol FROM ohlcv ORDER BY symbol'
  );

  console.log(`[sync] Syncing ${symbols.length} symbols to QuestDB...`);
  const results: SyncResult[] = [];

  for (const { symbol } of symbols) {
    const result = await syncSymbol(symbol);
    results.push(result);
  }

  return results;
}
