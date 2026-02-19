/**
 * Sync all DuckDB market data → QuestDB for chart rendering.
 *
 * Prerequisites:
 * - QuestDB must be running (port 9000)
 * - DuckDB market database must have data
 *
 * Run: npx tsx scripts/sync-to-questdb.ts
 */
import { initMarketDB, closeMarketDB } from '../server/duckdb/market';
import { syncAllToQuestDB } from '../server/lib/questdbSync';
import { createOHLCVTable } from '../server/questdb';

async function main() {
  await initMarketDB();

  console.log('[sync] Creating QuestDB ohlcv table if not exists...');
  await createOHLCVTable();

  const results = await syncAllToQuestDB();

  console.log('\n=== Sync Summary ===');
  let totalRows = 0;
  for (const r of results) {
    console.log(`  ${r.symbol}: ${r.rowsSynced.toLocaleString()} rows (${(r.duration / 1000).toFixed(1)}s)`);
    totalRows += r.rowsSynced;
  }
  console.log(`  TOTAL: ${totalRows.toLocaleString()} rows synced`);

  closeMarketDB();
}

main().catch(console.error);
