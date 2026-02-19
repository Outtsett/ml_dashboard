/**
 * Fast QuestDB sync — bulk CSV import via /imp REST API.
 * Replaces slow ILP row-by-row approach (~60K/s) with bulk upload (~2M+/s).
 *
 * Strategy:
 *   1. Export DuckDB ohlcv to CSV in batches (by symbol groups)
 *   2. Upload each CSV to QuestDB /imp endpoint
 *   3. Delete temp CSV after upload
 *
 * Run: npx tsx scripts/fast-questdb-sync.ts
 */
import { initMarketDB, marketQuery, closeMarketDB } from '../server/duckdb/market';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const QUESTDB_URL = `http://${process.env.QUESTDB_HOST || 'localhost'}:${process.env.QUESTDB_HTTP_PORT || '9000'}`;
const TMP_DIR = path.join(process.cwd(), 'data', 'tmp-sync');
const SYMBOLS_PER_BATCH = 50;

async function questdbExec(sql: string): Promise<any> {
  const url = `${QUESTDB_URL}/exec?query=${encodeURIComponent(sql)}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`QuestDB exec failed (${res.status}): ${body}`);
  }
  return res.json();
}

async function main() {
  const totalStart = Date.now();
  await initMarketDB();
  fs.mkdirSync(TMP_DIR, { recursive: true });

  // 1. Stats from DuckDB
  const symbols = await marketQuery<{ symbol: string }>(
    'SELECT DISTINCT symbol FROM ohlcv ORDER BY symbol'
  );
  const totalResult = await marketQuery<{ cnt: number }>('SELECT COUNT(*) as cnt FROM ohlcv');
  const totalRows = Number(totalResult[0].cnt);
  console.log(`[fast-sync] ${totalRows.toLocaleString()} rows, ${symbols.length} symbols in DuckDB`);

  // 2. Drop + recreate QuestDB table with proper schema
  console.log('[fast-sync] Dropping existing QuestDB ohlcv table...');
  try { await questdbExec('DROP TABLE IF EXISTS ohlcv'); } catch (e: any) {
    console.log('[fast-sync] Drop warning:', e.message);
  }
  // Wait for drop to fully complete
  await new Promise(r => setTimeout(r, 3000));

  console.log('[fast-sync] Creating QuestDB ohlcv table...');
  await questdbExec(`
    CREATE TABLE ohlcv (
      symbol SYMBOL CAPACITY 1000 CACHE INDEX,
      timestamp TIMESTAMP,
      open DOUBLE,
      high DOUBLE,
      low DOUBLE,
      close DOUBLE,
      volume DOUBLE
    ) timestamp(timestamp) PARTITION BY DAY WAL
    DEDUP UPSERT KEYS(symbol, timestamp)
  `);
  console.log('[fast-sync] Table created.');

  // 3. Batch symbols
  const batches: string[][] = [];
  for (let i = 0; i < symbols.length; i += SYMBOLS_PER_BATCH) {
    batches.push(symbols.slice(i, i + SYMBOLS_PER_BATCH).map(s => s.symbol));
  }

  let totalSynced = 0;
  const syncStart = Date.now();

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const symbolList = batch.map(s => `'${s.replace(/'/g, "''")}'`).join(',');
    const csvFile = path.join(TMP_DIR, `chunk_${i}.csv`).replace(/\\/g, '/');

    // Export from DuckDB to CSV
    const t0 = Date.now();
    await marketQuery(`
      COPY (
        SELECT symbol,
               strftime(ts, '%Y-%m-%dT%H:%M:%S.%fZ') as timestamp,
               open, high, low, close, volume
        FROM ohlcv
        WHERE symbol IN (${symbolList})
        ORDER BY ts
      ) TO '${csvFile}' (HEADER, DELIMITER ',')
    `);
    const exportMs = Date.now() - t0;
    const fileSizeBytes = fs.statSync(csvFile).size;
    const fileSizeMB = fileSizeBytes / (1024 * 1024);

    // Upload to QuestDB /imp
    const t1 = Date.now();
    let rowsImported = 0;
    try {
      const result = execSync(
        `curl -s -F "data=@${csvFile}" "${QUESTDB_URL}/imp?name=ohlcv"`,
        { timeout: 600000, maxBuffer: 50 * 1024 * 1024 }
      ).toString();
      const match = result.match(/Rows imported[\s|:]*(\d+)/i);
      rowsImported = match ? parseInt(match[1]) : 0;
      if (rowsImported === 0) {
        // Try alternate parse
        const altMatch = result.match(/"rowsImported"\s*:\s*(\d+)/);
        if (altMatch) rowsImported = parseInt(altMatch[1]);
      }
      if (rowsImported === 0 && fileSizeMB > 0.01) {
        console.log(`[fast-sync] Warning: could not parse row count. Response: ${result.substring(0, 200)}`);
      }
    } catch (e: any) {
      console.error(`[fast-sync] Upload error batch ${i}:`, e.message?.substring(0, 200));
    }
    const uploadMs = Date.now() - t1;

    totalSynced += rowsImported;

    // Delete temp CSV
    fs.unlinkSync(csvFile);

    const elapsed = (Date.now() - syncStart) / 1000;
    const rate = totalSynced / elapsed;
    const remainMin = totalRows > totalSynced ? (totalRows - totalSynced) / rate / 60 : 0;

    console.log(
      `[fast-sync] ${i + 1}/${batches.length}: ` +
      `${rowsImported.toLocaleString()} rows (${fileSizeMB.toFixed(0)}MB) ` +
      `exp=${(exportMs / 1000).toFixed(1)}s upl=${(uploadMs / 1000).toFixed(1)}s | ` +
      `${totalSynced.toLocaleString()}/${totalRows.toLocaleString()} ` +
      `(${rate.toFixed(0)}/s, ~${remainMin.toFixed(1)}m left)`
    );
  }

  // 4. Verify
  console.log('\n[fast-sync] Verifying...');
  await new Promise(r => setTimeout(r, 2000)); // let WAL flush
  const qdbResult = await questdbExec('SELECT count() as cnt FROM ohlcv');
  const qdbCount = qdbResult?.dataset?.[0]?.[0] ?? 'unknown';
  console.log(`[fast-sync] QuestDB: ${Number(qdbCount).toLocaleString()} rows`);
  console.log(`[fast-sync] DuckDB:  ${totalRows.toLocaleString()} rows`);

  // Cleanup
  try { fs.rmSync(TMP_DIR, { recursive: true }); } catch {}
  closeMarketDB();

  const totalTime = (Date.now() - totalStart) / 1000;
  console.log(`\n[fast-sync] DONE in ${(totalTime / 60).toFixed(1)} min (${(totalSynced / totalTime).toFixed(0)} rows/sec avg)`);
}

main().catch(console.error);
