/**
 * Sync MBP-10 order book depth from DuckDB → QuestDB via bulk CSV /imp upload.
 *
 * 408.8M rows × 73 columns — this is the big one. Batched by symbol to keep
 * CSV files manageable and allow progress tracking.
 *
 * Run: npx tsx scripts/sync-mbp10-questdb.ts
 */
import { initMarketDB, marketQuery, closeMarketDB } from '../server/duckdb/market';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const QUESTDB_URL = `http://${process.env.QUESTDB_HOST || 'localhost'}:${process.env.QUESTDB_HTTP_PORT || '9000'}`;
const TMP_DIR = path.join(process.cwd(), 'data', 'tmp-sync');
const SYMBOLS_PER_BATCH = 5; // MBP-10 rows are wide (73 cols), keep batches small

async function questdbExec(sql: string): Promise<any> {
  const url = `${QUESTDB_URL}/exec?query=${encodeURIComponent(sql)}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`QuestDB exec failed (${res.status}): ${body}`);
  }
  return res.json();
}

/** Build the 10-level bid/ask column definitions for QuestDB */
function buildBookLevelColumns(): string {
  const levels: string[] = [];
  for (let i = 0; i < 10; i++) {
    const pad = String(i).padStart(2, '0');
    levels.push(
      `bid_px_${pad} DOUBLE, ask_px_${pad} DOUBLE,`,
      `bid_sz_${pad} LONG, ask_sz_${pad} LONG,`,
      `bid_ct_${pad} INT, ask_ct_${pad} INT${i < 9 ? ',' : ''}`
    );
  }
  return levels.join('\n      ');
}

/** Build the SELECT columns for CSV export (with timestamp formatting) */
function buildSelectColumns(): string {
  const bookCols: string[] = [];
  for (let i = 0; i < 10; i++) {
    const pad = String(i).padStart(2, '0');
    bookCols.push(
      `bid_px_${pad}, ask_px_${pad}, bid_sz_${pad}, ask_sz_${pad}, bid_ct_${pad}, ask_ct_${pad}`
    );
  }
  return [
    `symbol`,
    `strftime(ts_event, '%Y-%m-%dT%H:%M:%S.%fZ') as timestamp`,
    `strftime(ts_recv, '%Y-%m-%dT%H:%M:%S.%fZ') as ts_recv`,
    `rtype, publisher_id, instrument_id`,
    `action, side, depth, price, size, flags, ts_in_delta, sequence`,
    ...bookCols,
  ].join(',\n               ');
}

async function main() {
  const totalStart = Date.now();
  await initMarketDB();
  fs.mkdirSync(TMP_DIR, { recursive: true });

  // 1. Stats
  const symbols = await marketQuery<{ symbol: string }>(
    'SELECT DISTINCT symbol FROM mbp10 ORDER BY symbol'
  );
  const totalResult = await marketQuery<{ cnt: number }>('SELECT COUNT(*)::BIGINT as cnt FROM mbp10');
  const totalRows = Number(totalResult[0].cnt);
  console.log(`[sync-mbp10] ${totalRows.toLocaleString()} rows, ${symbols.length} symbols in DuckDB`);

  // 2. Drop + recreate QuestDB mbp10 table
  console.log('[sync-mbp10] Dropping existing QuestDB mbp10 table...');
  try { await questdbExec('DROP TABLE IF EXISTS mbp10'); } catch (e: any) {
    console.log('[sync-mbp10] Drop warning:', e.message);
  }
  await new Promise(r => setTimeout(r, 3000));

  console.log('[sync-mbp10] Creating QuestDB mbp10 table...');
  await questdbExec(`
    CREATE TABLE mbp10 (
      symbol SYMBOL CAPACITY 200 CACHE INDEX,
      timestamp TIMESTAMP,
      ts_recv TIMESTAMP,
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
      ${buildBookLevelColumns()}
    ) timestamp(timestamp) PARTITION BY DAY WAL
    DEDUP UPSERT KEYS(symbol, timestamp, sequence)
  `);
  console.log('[sync-mbp10] Table created.');

  // 3. Batch by symbol
  const batches: string[][] = [];
  for (let i = 0; i < symbols.length; i += SYMBOLS_PER_BATCH) {
    batches.push(symbols.slice(i, i + SYMBOLS_PER_BATCH).map(s => s.symbol));
  }

  let totalSynced = 0;
  const syncStart = Date.now();

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const symbolList = batch.map(s => `'${s.replace(/'/g, "''")}'`).join(',');
    const csvFile = path.join(TMP_DIR, `mbp10_${i}.csv`).replace(/\\/g, '/');

    const t0 = Date.now();
    await marketQuery(`
      COPY (
        SELECT ${buildSelectColumns()}
        FROM mbp10
        WHERE symbol IN (${symbolList})
        ORDER BY ts_event
      ) TO '${csvFile}' (HEADER, DELIMITER ',')
    `);
    const exportMs = Date.now() - t0;

    const stat = fs.statSync(csvFile);
    const fileSizeMB = stat.size / (1024 * 1024);

    const t1 = Date.now();
    let rowsImported = 0;
    try {
      const result = execSync(
        `curl -s -F "data=@${csvFile}" "${QUESTDB_URL}/imp?name=mbp10"`,
        { timeout: 1200000, maxBuffer: 100 * 1024 * 1024 } // 20 min timeout, 100MB buffer
      ).toString();
      const match = result.match(/Rows imported[\s|:]*(\d+)/i);
      rowsImported = match ? parseInt(match[1]) : 0;
      if (rowsImported === 0) {
        const altMatch = result.match(/"rowsImported"\s*:\s*(\d+)/);
        if (altMatch) rowsImported = parseInt(altMatch[1]);
      }
      if (rowsImported === 0 && fileSizeMB > 0.01) {
        console.log(`[sync-mbp10] Warning: could not parse row count. Response: ${result.substring(0, 200)}`);
      }
    } catch (e: any) {
      console.error(`[sync-mbp10] Upload error batch ${i}:`, e.message?.substring(0, 200));
    }
    const uploadMs = Date.now() - t1;

    totalSynced += rowsImported;
    fs.unlinkSync(csvFile);

    const elapsed = (Date.now() - syncStart) / 1000;
    const rate = totalSynced / elapsed;
    const remainMin = totalRows > totalSynced ? (totalRows - totalSynced) / rate / 60 : 0;

    console.log(
      `[sync-mbp10] ${i + 1}/${batches.length}: ` +
      `${batch.join(',')} — ${rowsImported.toLocaleString()} rows (${fileSizeMB.toFixed(0)}MB) ` +
      `exp=${(exportMs / 1000).toFixed(1)}s upl=${(uploadMs / 1000).toFixed(1)}s | ` +
      `${totalSynced.toLocaleString()}/${totalRows.toLocaleString()} ` +
      `(${rate.toFixed(0)}/s, ~${remainMin.toFixed(1)}m left)`
    );
  }

  // 4. Verify
  console.log('\n[sync-mbp10] Verifying...');
  await new Promise(r => setTimeout(r, 5000)); // longer WAL flush for large table
  const qdbResult = await questdbExec('SELECT count() as cnt FROM mbp10');
  const qdbCount = qdbResult?.dataset?.[0]?.[0] ?? 'unknown';
  console.log(`[sync-mbp10] QuestDB: ${Number(qdbCount).toLocaleString()} rows`);
  console.log(`[sync-mbp10] DuckDB:  ${totalRows.toLocaleString()} rows`);

  try { fs.rmSync(TMP_DIR, { recursive: true }); } catch {}
  closeMarketDB();

  const totalTime = (Date.now() - totalStart) / 1000;
  console.log(`\n[sync-mbp10] DONE in ${(totalTime / 60).toFixed(1)} min (${(totalSynced / totalTime).toFixed(0)} rows/sec avg)`);
}

main().catch(console.error);
