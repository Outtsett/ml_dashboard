/**
 * Sync trades from DuckDB → QuestDB via bulk CSV /imp upload.
 *
 * Same pattern as fast-questdb-sync.ts:
 *   1. Export DuckDB trades to CSV in symbol batches
 *   2. Upload each CSV to QuestDB /imp endpoint
 *   3. Delete temp CSV after upload
 *
 * Run: npx tsx scripts/sync-trades-questdb.ts
 */
import { initMarketDB, marketQuery, closeMarketDB } from '../server/duckdb/market';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const QUESTDB_URL = `http://${process.env.QUESTDB_HOST || 'localhost'}:${process.env.QUESTDB_HTTP_PORT || '9000'}`;
const TMP_DIR = path.join(process.cwd(), 'data', 'tmp-sync');
const SYMBOLS_PER_BATCH = 10; // trades are denser per symbol than OHLCV

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

  // 1. Stats
  const symbols = await marketQuery<{ symbol: string }>(
    'SELECT DISTINCT symbol FROM trades ORDER BY symbol'
  );
  const totalResult = await marketQuery<{ cnt: number }>('SELECT COUNT(*)::BIGINT as cnt FROM trades');
  const totalRows = Number(totalResult[0].cnt);
  console.log(`[sync-trades] ${totalRows.toLocaleString()} rows, ${symbols.length} symbols in DuckDB`);

  // 2. Drop + recreate QuestDB trades table
  console.log('[sync-trades] Dropping existing QuestDB trades table...');
  try { await questdbExec('DROP TABLE IF EXISTS trades'); } catch (e: any) {
    console.log('[sync-trades] Drop warning:', e.message);
  }
  await new Promise(r => setTimeout(r, 3000));

  console.log('[sync-trades] Creating QuestDB trades table...');
  await questdbExec(`
    CREATE TABLE trades (
      symbol SYMBOL CAPACITY 200 CACHE INDEX,
      timestamp TIMESTAMP,
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
      sequence LONG
    ) timestamp(timestamp) PARTITION BY DAY WAL
    DEDUP UPSERT KEYS(symbol, timestamp, sequence)
  `);
  console.log('[sync-trades] Table created.');

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
    const csvFile = path.join(TMP_DIR, `trades_${i}.csv`).replace(/\\/g, '/');

    const t0 = Date.now();
    await marketQuery(`
      COPY (
        SELECT symbol,
               strftime(ts, '%Y-%m-%dT%H:%M:%S.%fZ') as timestamp,
               rtype, publisher_id, instrument_id,
               action, side, depth, price, size, flags,
               ts_in_delta, sequence
        FROM trades
        WHERE symbol IN (${symbolList})
        ORDER BY ts
      ) TO '${csvFile}' (HEADER, DELIMITER ',')
    `);
    const exportMs = Date.now() - t0;

    const stat = fs.statSync(csvFile);
    const fileSizeMB = stat.size / (1024 * 1024);

    const t1 = Date.now();
    let rowsImported = 0;
    try {
      const result = execSync(
        `curl -s -F "data=@${csvFile}" "${QUESTDB_URL}/imp?name=trades"`,
        { timeout: 600000, maxBuffer: 50 * 1024 * 1024 }
      ).toString();
      const match = result.match(/Rows imported[\s|:]*(\d+)/i);
      rowsImported = match ? parseInt(match[1]) : 0;
      if (rowsImported === 0) {
        const altMatch = result.match(/"rowsImported"\s*:\s*(\d+)/);
        if (altMatch) rowsImported = parseInt(altMatch[1]);
      }
      if (rowsImported === 0 && fileSizeMB > 0.01) {
        console.log(`[sync-trades] Warning: could not parse row count. Response: ${result.substring(0, 200)}`);
      }
    } catch (e: any) {
      console.error(`[sync-trades] Upload error batch ${i}:`, e.message?.substring(0, 200));
    }
    const uploadMs = Date.now() - t1;

    totalSynced += rowsImported;
    fs.unlinkSync(csvFile);

    const elapsed = (Date.now() - syncStart) / 1000;
    const rate = totalSynced / elapsed;
    const remainMin = totalRows > totalSynced ? (totalRows - totalSynced) / rate / 60 : 0;

    console.log(
      `[sync-trades] ${i + 1}/${batches.length}: ` +
      `${batch.join(',')} — ${rowsImported.toLocaleString()} rows (${fileSizeMB.toFixed(0)}MB) ` +
      `exp=${(exportMs / 1000).toFixed(1)}s upl=${(uploadMs / 1000).toFixed(1)}s | ` +
      `${totalSynced.toLocaleString()}/${totalRows.toLocaleString()} ` +
      `(${rate.toFixed(0)}/s, ~${remainMin.toFixed(1)}m left)`
    );
  }

  // 4. Verify
  console.log('\n[sync-trades] Verifying...');
  await new Promise(r => setTimeout(r, 2000));
  const qdbResult = await questdbExec('SELECT count() as cnt FROM trades');
  const qdbCount = qdbResult?.dataset?.[0]?.[0] ?? 'unknown';
  console.log(`[sync-trades] QuestDB: ${Number(qdbCount).toLocaleString()} rows`);
  console.log(`[sync-trades] DuckDB:  ${totalRows.toLocaleString()} rows`);

  try { fs.rmSync(TMP_DIR, { recursive: true }); } catch {}
  closeMarketDB();

  const totalTime = (Date.now() - totalStart) / 1000;
  console.log(`\n[sync-trades] DONE in ${(totalTime / 60).toFixed(1)} min (${(totalSynced / totalTime).toFixed(0)} rows/sec avg)`);
}

main().catch(console.error);
