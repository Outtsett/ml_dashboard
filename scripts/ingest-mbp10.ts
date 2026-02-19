/**
 * Ingest MBP-10 (Market By Price, 10-level depth) CSVs into market DuckDB.
 *
 * Source: D:\HistoricalTickData\*.mbp-10.csv (26 files, ~210GB total)
 * Schema: 73 columns — ts_recv, ts_event, 10-level bid/ask px/sz/ct, symbol, etc.
 * All MNQ contracts, June 5 - July 4, 2025.
 *
 * Run: npx tsx scripts/ingest-mbp10.ts
 */
import { initMarketDB, marketQuery, closeMarketDB } from '../server/duckdb/market';
import * as fs from 'fs';

const HIST_DIR = 'D:/HistoricalTickData';

async function main() {
  await initMarketDB();

  const csvFiles = fs.readdirSync(HIST_DIR)
    .filter(f => f.endsWith('.mbp-10.csv'))
    .sort();

  console.log(`[mbp10] Found ${csvFiles.length} MBP-10 CSV files`);

  let totalIngested = 0;

  for (const file of csvFiles) {
    const filePath = `${HIST_DIR}/${file}`;

    // Skip if already ingested
    const existing = await marketQuery(
      `SELECT file_path FROM ingested_files WHERE file_path = '${filePath}'`
    );
    if (existing.length > 0) {
      console.log(`[mbp10] ${file} already ingested, skipping`);
      continue;
    }

    const fileStat = fs.statSync(filePath);
    const sizeGB = (fileStat.size / (1024 ** 3)).toFixed(2);
    console.log(`[mbp10] Ingesting ${file} (${sizeGB} GB)...`);

    const start = Date.now();
    await marketQuery(`
      INSERT INTO mbp10
      SELECT * FROM read_csv('${filePath}', auto_detect=true, parallel=true)
    `);
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);

    // Get row count for this file
    const rowCount = await marketQuery<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM mbp10`
    );
    const currentTotal = Number(rowCount[0].cnt);
    const fileRows = currentTotal - totalIngested;
    totalIngested = currentTotal;

    console.log(`[mbp10] ${file}: ${fileRows.toLocaleString()} rows in ${elapsed}s`);

    // Record in ingested_files
    await marketQuery(`
      INSERT INTO ingested_files (file_path, file_hash, file_size, row_count, symbol)
      VALUES ('${filePath}', 'mbp10-csv', ${fileStat.size}, ${fileRows}, 'MNQ_MBP10')
    `);
  }

  // Final stats
  const stats = await marketQuery(`
    SELECT COUNT(*) as cnt,
           COUNT(DISTINCT symbol) as symbols,
           MIN(ts_event)::VARCHAR as ts_min,
           MAX(ts_event)::VARCHAR as ts_max
    FROM mbp10
  `);
  const s = stats[0] as any;
  console.log(`[mbp10] Total: ${Number(s.cnt).toLocaleString()} rows, ${Number(s.symbols)} symbols, ${s.ts_min} → ${s.ts_max}`);

  closeMarketDB();
  console.log('[mbp10] Done.');
}

main().catch(console.error);
