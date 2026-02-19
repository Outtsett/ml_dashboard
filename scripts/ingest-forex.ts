/**
 * Ingest forex data from forex.duckdb and loose Parquet files.
 *
 * forex.duckdb tables:
 *   - native_bars (36.8M rows): pair, timeframe, ts, OHLCV + bid/ask/spread (M1)
 *   - bars (11.3M rows): pair, timeframe, ts, OHLCV + session + returns (5M+)
 *   - m1_raw: raw M1 data (may overlap with native_bars)
 *
 * We ingest native_bars M1 data as the primary forex source (highest resolution
 * with bid/ask spread data).
 *
 * Forex parquets (15 files):
 *   - time (VARCHAR), open, high, low, close, volume
 *   - File naming: PAIR_M1_6Y.parquet → extract pair from filename
 *
 * Run: npx tsx scripts/ingest-forex.ts
 */
import { initMarketDB, marketQuery, closeMarketDB } from '../server/duckdb/market';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  await initMarketDB();

  // --- Part 1: forex.duckdb native_bars (highest quality — has bid/ask) ---
  const forexDbPath = 'E:/source/repos/ml_dashboard/data/sources/forex.duckdb';

  const existingForexDb = await marketQuery(
    `SELECT file_path FROM ingested_files WHERE file_path LIKE '%forex.duckdb%'`
  );

  if (existingForexDb.length > 0) {
    console.log('[ingest] forex.duckdb already ingested, skipping');
  } else {
    console.log('[ingest] Attaching forex.duckdb...');
    await marketQuery(`ATTACH '${forexDbPath}' AS forex (READ_ONLY)`);

    // List tables to understand what's available
    const tables = await marketQuery(
      "SELECT table_name FROM information_schema.tables WHERE table_catalog = 'forex' AND table_type = 'BASE TABLE'"
    );
    console.log(`[ingest] Found ${tables.length} tables:`, tables.map((t: any) => t.table_name));

    // Ingest native_bars — M1 resolution only (skip higher timeframes, we'll aggregate)
    console.log('[ingest] Ingesting native_bars (M1 only)...');

    const m1Count = await marketQuery<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM forex.native_bars WHERE timeframe = 'M1'`
    );
    console.log(`[ingest] M1 rows to ingest: ${Number(m1Count[0].cnt).toLocaleString()}`);

    const start = Date.now();

    // Convert pair format: AUD_JPY → AUDJPY
    await marketQuery(`
      INSERT INTO ohlcv
      SELECT
        CAST(ts AS TIMESTAMP) AS ts,
        REPLACE(pair, '_', '') AS symbol,
        open,
        high,
        low,
        close,
        volume
      FROM forex.native_bars
      WHERE timeframe = 'M1'
    `);

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`[ingest] native_bars M1 ingested in ${elapsed}s`);

    // Record
    const forexRows = await marketQuery<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM ohlcv WHERE symbol NOT LIKE '%H%' AND symbol NOT LIKE '%M%' AND symbol NOT LIKE '%U%' AND symbol NOT LIKE '%Z%' AND LENGTH(symbol) = 6`
    );
    await marketQuery(`
      INSERT INTO ingested_files (file_path, file_hash, file_size, row_count, symbol, ts_min, ts_max)
      VALUES ('${forexDbPath}', 'bulk-forex-native', 0, ${Number(forexRows[0].cnt)}, 'FOREX_ALL',
              (SELECT MIN(ts) FROM ohlcv WHERE LENGTH(symbol) = 6), (SELECT MAX(ts) FROM ohlcv WHERE LENGTH(symbol) = 6))
    `);

    await marketQuery("DETACH forex");
  }

  // --- Part 2: Loose Parquet files (may have additional data not in forex.duckdb) ---
  const forexParquetDir = path.join(process.cwd(), 'data', 'sources', 'forex');
  if (fs.existsSync(forexParquetDir)) {
    const parquetFiles = fs.readdirSync(forexParquetDir).filter(f => f.endsWith('.parquet'));
    console.log(`\n[ingest] Found ${parquetFiles.length} loose forex Parquet files`);

    for (const file of parquetFiles) {
      const filePath = path.join(forexParquetDir, file).replace(/\\/g, '/');

      // Check if already ingested
      const safePath = filePath.replace(/'/g, "''");
      const existing = await marketQuery(
        `SELECT file_path FROM ingested_files WHERE file_path = '${safePath}'`
      );
      if (existing.length > 0) {
        console.log(`[ingest] ${file}: already ingested, skipping`);
        continue;
      }

      // Extract symbol from filename: "AUD_JPY_M1_6Y.parquet" → "AUDJPY"
      const symbol = path.basename(file, '.parquet')
        .replace(/_M\d+_\d+Y$/i, '')
        .replace(/_/g, '')
        .toUpperCase();

      console.log(`[ingest] ${file} → ${symbol}`);

      const count = await marketQuery<{ cnt: number }>(
        `SELECT COUNT(*) as cnt FROM read_parquet('${filePath}')`
      );

      // Forex parquets have: time (VARCHAR), open, high, low, close, volume
      await marketQuery(`
        INSERT INTO ohlcv
        SELECT
          CAST(time AS TIMESTAMP) AS ts,
          '${symbol}' AS symbol,
          CAST(open AS DOUBLE) AS open,
          CAST(high AS DOUBLE) AS high,
          CAST(low AS DOUBLE) AS low,
          CAST(close AS DOUBLE) AS close,
          CAST(COALESCE(volume, 0) AS BIGINT) AS volume
        FROM read_parquet('${filePath}')
      `);

      await marketQuery(`
        INSERT INTO ingested_files (file_path, file_hash, file_size, row_count, symbol, ts_min, ts_max)
        VALUES ('${safePath}', 'bulk-forex-parquet', 0, ${Number(count[0].cnt)}, '${symbol}',
                (SELECT MIN(ts) FROM ohlcv WHERE symbol = '${symbol}'),
                (SELECT MAX(ts) FROM ohlcv WHERE symbol = '${symbol}'))
      `);

      console.log(`  Ingested ${Number(count[0].cnt).toLocaleString()} rows`);
    }
  }

  // --- Summary ---
  console.log('\n[ingest] === Final Summary ===');
  const summary = await marketQuery(`
    SELECT symbol, COUNT(*) as cnt,
           MIN(ts)::VARCHAR as ts_min,
           MAX(ts)::VARCHAR as ts_max
    FROM ohlcv
    GROUP BY symbol
    ORDER BY cnt DESC
  `);
  let total = 0;
  summary.forEach((row: any) => {
    const cnt = Number(row.cnt);
    total += cnt;
    console.log(`  ${row.symbol}: ${cnt.toLocaleString()} rows, ${row.ts_min} → ${row.ts_max}`);
  });
  console.log(`  TOTAL: ${total.toLocaleString()} rows across ${summary.length} symbols`);

  closeMarketDB();
}

main().catch(console.error);
