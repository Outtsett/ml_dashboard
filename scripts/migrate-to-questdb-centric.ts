/**
 * One-time migration: DuckDB market.duckdb -> QuestDB + PostgreSQL
 *
 * Run: npx tsx scripts/migrate-to-questdb-centric.ts
 *
 * Prerequisites:
 * - QuestDB running on ports 9000/9009/8812
 * - PostgreSQL running on port 5432
 * - data/market.duckdb exists with current data
 */
import DuckDB from 'duckdb';
import * as path from 'path';
import * as fs from 'fs';
import { Sender } from '@questdb/nodejs-client';
import { queryQuestDB, initQuestDBTables } from '../server/questdb';
import { buildContinuousSeries } from '../server/services/continuousContract';

const MARKET_DB_PATH = path.join(process.cwd(), 'data', 'market.duckdb');
const BATCH_SIZE = 50000;

// Simple DuckDB query helper for the source database
function createSourceDB(): { query: <T = any>(sql: string) => Promise<T[]>; close: () => void } {
  if (!fs.existsSync(MARKET_DB_PATH)) {
    throw new Error(`market.duckdb not found at ${MARKET_DB_PATH}`);
  }
  const db = new DuckDB.Database(MARKET_DB_PATH, { access_mode: 'READ_ONLY' });
  const conn = db.connect();
  return {
    query: <T = any>(sql: string) => new Promise<T[]>((resolve, reject) => {
      conn.all(sql, (err: DuckDB.DuckDbError | null, result: DuckDB.TableData) => {
        if (err) reject(err);
        else resolve(result as unknown as T[]);
      });
    }),
    close: () => { conn.close(); db.close(); },
  };
}

async function main() {
  console.log('=== QuestDB-Centric Migration ===\n');

  // Step 0: Ensure QuestDB tables exist
  console.log('[0] Creating QuestDB tables if needed...');
  await initQuestDBTables();

  const source = createSourceDB();

  // Step 1: Verify OHLCV completeness
  console.log('\n[1] Verifying OHLCV data completeness...');
  const duckdbCount = await source.query<{ cnt: number }>('SELECT COUNT(*) as cnt FROM ohlcv');
  const questdbCount = await queryQuestDB<{ cnt: string }>('SELECT count() as cnt FROM ohlcv');
  console.log(`  DuckDB: ${Number(duckdbCount[0].cnt).toLocaleString()} rows`);
  console.log(`  QuestDB: ${Number(questdbCount[0].cnt).toLocaleString()} rows`);
  const diff = Number(duckdbCount[0].cnt) - Number(questdbCount[0].cnt);
  if (diff > 0) {
    console.log(`  WARNING: ${diff.toLocaleString()} rows missing from QuestDB -- may need re-sync`);
  } else {
    console.log('  OK: QuestDB has all OHLCV data');
  }

  // Step 2: Migrate trades
  console.log('\n[2] Migrating trades...');
  const tradesCount = await source.query<{ cnt: number }>('SELECT COUNT(*) as cnt FROM trades');
  const totalTrades = Number(tradesCount[0].cnt);
  if (totalTrades > 0) {
    const questdbTradesCount = await queryQuestDB<{ cnt: string }>('SELECT count() as cnt FROM trades');
    if (Number(questdbTradesCount[0].cnt) >= totalTrades) {
      console.log(`  OK: Trades already migrated (${Number(questdbTradesCount[0].cnt).toLocaleString()} rows)`);
    } else {
      console.log(`  Migrating ${totalTrades.toLocaleString()} trades...`);
      const sender = await Sender.fromConfig('http::addr=localhost:9000;auto_flush=off;');
      let offset = 0;
      let migrated = 0;
      while (offset < totalTrades) {
        const batch = await source.query(`
          SELECT ts::VARCHAR as ts, symbol, price, size, side, action
          FROM trades ORDER BY ts LIMIT ${BATCH_SIZE} OFFSET ${offset}
        `);
        for (const row of batch) {
          await sender
            .table('trades')
            .symbol('symbol', String(row.symbol || 'UNKNOWN'))
            .symbol('side', String(row.side || ''))
            .symbol('action', String(row.action || ''))
            .floatColumn('price', Number(row.price))
            .intColumn('size', Number(row.size))
            .at(new Date(row.ts).getTime(), 'ms');
        }
        await sender.flush();
        migrated += batch.length;
        offset += BATCH_SIZE;
        if (migrated % 500000 === 0) {
          console.log(`  ${migrated.toLocaleString()} / ${totalTrades.toLocaleString()}`);
        }
      }
      await sender.close();
      console.log(`  OK: Migrated ${migrated.toLocaleString()} trades`);
    }
  } else {
    console.log('  No trades to migrate');
  }

  // Step 3: Migrate mbp10 (similar pattern)
  console.log('\n[3] Checking mbp10...');
  try {
    const mbpCount = await source.query<{ cnt: number }>('SELECT COUNT(*) as cnt FROM mbp10');
    const totalMbp = Number(mbpCount[0].cnt);
    if (totalMbp > 0) {
      console.log(`  ${totalMbp.toLocaleString()} mbp10 rows -- migration skipped (run manually if needed)`);
      console.log('  MBP10 has 60+ columns; batch migration is complex. Use scripts/ingest-mbp10.ts instead.');
    } else {
      console.log('  No mbp10 data to migrate');
    }
  } catch {
    console.log('  No mbp10 table found');
  }

  // Step 4: Migrate ingested_files to PostgreSQL
  console.log('\n[4] Migrating ingested_files...');
  try {
    const files = await source.query<{
      file_path: string; file_hash: string; file_size: number;
      row_count: number; symbol: string; ts_min: string; ts_max: string;
    }>('SELECT file_path, file_hash, file_size, row_count, symbol, ts_min::VARCHAR as ts_min, ts_max::VARCHAR as ts_max FROM ingested_files');
    if (files.length > 0) {
      console.log(`  Found ${files.length} ingestion records`);
      // Import Drizzle and insert
      try {
        const { recordIngestion } = await import('../server/services/ingestionService');
        for (const f of files) {
          await recordIngestion(
            f.file_path, f.file_hash || '', Number(f.file_size) || 0,
            Number(f.row_count) || 0, f.symbol || '',
            f.ts_min ? new Date(f.ts_min) : new Date(),
            f.ts_max ? new Date(f.ts_max) : new Date()
          );
        }
        console.log(`  OK: Migrated ${files.length} ingestion records to PostgreSQL`);
      } catch (err: any) {
        console.log(`  WARNING: PostgreSQL not available -- skipping: ${err.message}`);
        console.log('  Run again when PostgreSQL is running');
      }
    } else {
      console.log('  No ingestion records to migrate');
    }
  } catch {
    console.log('  No ingested_files table found');
  }

  // Step 5: Build continuous contract series
  console.log('\n[5] Building continuous contract series...');
  const roots = await source.query<{ root: string }>('SELECT DISTINCT root FROM contracts ORDER BY root');
  if (roots.length > 0) {
    console.log(`  Found ${roots.length} futures roots: ${roots.map(r => r.root).join(', ')}`);
    for (const { root } of roots) {
      try {
        const result = await buildContinuousSeries(root);
        console.log(`  OK ${root}: ${result.barsWritten.toLocaleString()} bars, ${result.rollovers.length} rollovers`);
      } catch (err: any) {
        console.log(`  WARNING ${root}: ${err.message}`);
      }
    }
  } else {
    console.log('  No futures contracts found -- looking at QuestDB symbols...');
    // Try to detect futures roots from QuestDB symbols
    const symbols = await queryQuestDB<{ symbol: string }>('SELECT DISTINCT symbol FROM ohlcv');
    const futuresRoots = new Set<string>();
    for (const { symbol } of symbols) {
      // Match contract patterns like ESH5, NQM25
      const match = symbol.match(/^([A-Z]{1,4})[FGHJKMNQUVXZ]\d{1,2}$/);
      if (match) futuresRoots.add(match[1]);
    }
    if (futuresRoots.size > 0) {
      console.log(`  Detected ${futuresRoots.size} futures roots from QuestDB: ${[...futuresRoots].join(', ')}`);
      for (const root of futuresRoots) {
        try {
          const result = await buildContinuousSeries(root);
          console.log(`  OK ${root}: ${result.barsWritten.toLocaleString()} bars, ${result.rollovers.length} rollovers`);
        } catch (err: any) {
          console.log(`  WARNING ${root}: ${err.message}`);
        }
      }
    } else {
      console.log('  No futures data found');
    }
  }

  source.close();
  console.log('\n=== Migration Complete ===');
  console.log('Next steps:');
  console.log('  1. Verify chart loading works in the dashboard');
  console.log('  2. Once confirmed, you can safely delete data/market.duckdb');
  process.exit(0);
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
