/**
 * Ingest trades data into market DuckDB.
 *
 * Sources:
 *   - D:\HistoricalTickData\merged_trades_all.parquet (14.5M rows, MNQ, Jun-Jul 2025)
 *   - D:\HistoricalTickData\*.trades.parquet (converted from .dbn by convert-dbn-trades.py)
 *
 * Run: npx tsx scripts/ingest-trades.ts
 */
import { initMarketDB, marketQuery, closeMarketDB } from '../server/duckdb/market';
import * as fs from 'fs';
import * as path from 'path';

const HIST_DIR = 'D:/HistoricalTickData';

async function main() {
  await initMarketDB();

  // 1. Ingest merged_trades_all.parquet
  const mergedPath = `${HIST_DIR}/merged_trades_all.parquet`;
  const mergedIngested = await marketQuery(
    `SELECT file_path FROM ingested_files WHERE file_path = '${mergedPath}'`
  );

  if (mergedIngested.length > 0) {
    console.log('[trades] merged_trades_all.parquet already ingested, skipping');
  } else {
    console.log('[trades] Ingesting merged_trades_all.parquet...');
    const start = Date.now();
    await marketQuery(`
      INSERT INTO trades
      SELECT * FROM read_parquet('${mergedPath}')
    `);
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    const count = await marketQuery<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM trades`);
    console.log(`[trades] Ingested ${Number(count[0].cnt).toLocaleString()} rows in ${elapsed}s`);

    await marketQuery(`
      INSERT INTO ingested_files (file_path, file_hash, file_size, row_count, symbol, ts_min, ts_max)
      VALUES ('${mergedPath}', 'merged-trades', 0, ${Number(count[0].cnt)}, 'MNQ_TRADES',
              (SELECT MIN(ts) FROM trades), (SELECT MAX(ts) FROM trades))
    `);
  }

  // 2. Find and ingest any additional .trades.parquet files (converted from .dbn)
  const files = fs.readdirSync(HIST_DIR)
    .filter(f => f.endsWith('.trades.parquet') && f !== 'merged_trades_all.parquet')
    .sort();

  if (files.length === 0) {
    console.log('[trades] No additional .trades.parquet files found (run convert-dbn-trades.py first)');
  } else {
    for (const file of files) {
      const filePath = `${HIST_DIR}/${file}`;
      const existing = await marketQuery(
        `SELECT file_path FROM ingested_files WHERE file_path = '${filePath}'`
      );
      if (existing.length > 0) {
        console.log(`[trades] ${file} already ingested, skipping`);
        continue;
      }

      console.log(`[trades] Ingesting ${file}...`);
      const start = Date.now();
      // .dbn parquets have ts_recv + ts_event; map to trades table schema (ts = ts_event)
      await marketQuery(`
        INSERT INTO trades
        SELECT s.ts_event, s.rtype, s.publisher_id, s.instrument_id,
               s.action, s.side, s.depth, s.price, s.size,
               s.flags, s.ts_in_delta, s.sequence, s.symbol
        FROM read_parquet('${filePath}') s
        WHERE NOT EXISTS (
          SELECT 1 FROM trades t
          WHERE t.ts = s.ts_event AND t.instrument_id = s.instrument_id AND t.sequence = s.sequence
        )
      `);
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`[trades] ${file} done in ${elapsed}s`);

      const rowCount = await marketQuery<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM trades`);
      await marketQuery(`
        INSERT INTO ingested_files (file_path, file_hash, file_size, row_count, symbol)
        VALUES ('${filePath}', 'dbn-trades', 0, ${Number(rowCount[0].cnt)}, 'MNQ_TRADES')
      `);
    }
  }

  // Stats
  const stats = await marketQuery(`
    SELECT COUNT(*) as cnt,
           COUNT(DISTINCT symbol) as symbols,
           MIN(ts)::VARCHAR as ts_min,
           MAX(ts)::VARCHAR as ts_max
    FROM trades
  `);
  const s = stats[0] as any;
  console.log(`[trades] Total: ${Number(s.cnt).toLocaleString()} rows, ${Number(s.symbols)} symbols, ${s.ts_min} → ${s.ts_max}`);

  closeMarketDB();
  console.log('[trades] Done.');
}

main().catch(console.error);
