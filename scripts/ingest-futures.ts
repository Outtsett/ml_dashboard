/**
 * Ingest futures data from analytics.duckdb ohlcv_1s view into market DuckDB.
 *
 * The ohlcv_1s VIEW already has clean data:
 *   - timestamp: TIMESTAMPTZ (already converted from ts_event nanoseconds)
 *   - instrument_id: VARCHAR (already string)
 *   - open/high/low/close: DOUBLE (already divided by 1B)
 *   - volume: BIGINT
 *
 * The instruments table maps instrument_id → symbol.
 *
 * Run: npx tsx scripts/ingest-futures.ts
 */
import { initMarketDB, marketQuery, closeMarketDB } from '../server/duckdb/market';

async function main() {
  await initMarketDB();

  const analyticsPath = 'E:/source/repos/ml_dashboard/data/sources/analytics.duckdb';

  // Check if already ingested
  const existing = await marketQuery(
    `SELECT file_path FROM ingested_files WHERE file_path LIKE '%analytics.duckdb%'`
  );
  if (existing.length > 0) {
    console.log('[ingest] analytics.duckdb already ingested, skipping');
    closeMarketDB();
    return;
  }

  console.log('[ingest] Attaching analytics.duckdb...');
  await marketQuery(`ATTACH '${analyticsPath}' AS src (READ_ONLY)`);

  // Build instrument_id → symbol mapping from the instruments table
  console.log('[ingest] Loading instrument mapping...');
  const instruments = await marketQuery<{ instrument_id: string; symbol: string }>(
    `SELECT instrument_id, symbol FROM src.instruments`
  );
  console.log(`[ingest] Found ${instruments.length} instrument mappings`);

  // Show sample mappings
  const sampleMappings = instruments.slice(0, 10);
  console.log('[ingest] Sample mappings:');
  sampleMappings.forEach(m => console.log(`  ${m.instrument_id} → ${m.symbol}`));

  // Get distinct instrument_ids in ohlcv_1s to know what we're working with
  const distinctIds = await marketQuery<{ instrument_id: string }>(
    `SELECT DISTINCT instrument_id FROM src.ohlcv_1s LIMIT 50`
  );
  console.log(`[ingest] Found ${distinctIds.length} distinct instrument_ids in ohlcv_1s`);

  console.log('[ingest] Starting futures ingestion from ohlcv_1s (720M rows)...');
  console.log('[ingest] This may take several minutes...');

  const start = Date.now();

  // Join ohlcv_1s with instruments to get proper symbol names
  // Use COALESCE to fall back to instrument_id if no mapping exists
  await marketQuery(`
    INSERT INTO ohlcv
    SELECT
      CAST(o.timestamp AS TIMESTAMP) AS ts,
      COALESCE(i.symbol, o.instrument_id) AS symbol,
      o.open,
      o.high,
      o.low,
      o.close,
      o.volume
    FROM src.ohlcv_1s o
    LEFT JOIN src.instruments i ON o.instrument_id = i.instrument_id
  `);

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[ingest] Futures ingestion complete in ${elapsed}s`);

  // Get stats
  const stats = await marketQuery(`
    SELECT symbol, COUNT(*) as cnt,
           MIN(ts)::VARCHAR as ts_min,
           MAX(ts)::VARCHAR as ts_max
    FROM ohlcv
    GROUP BY symbol
    ORDER BY cnt DESC
    LIMIT 20
  `);
  console.log('[ingest] Stats:');
  stats.forEach((row: any) =>
    console.log(`  ${row.symbol}: ${Number(row.cnt).toLocaleString()} rows, ${row.ts_min} → ${row.ts_max}`)
  );

  // Record ingestion
  const totalRows = await marketQuery<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM ohlcv`);
  await marketQuery(`
    INSERT INTO ingested_files (file_path, file_hash, file_size, row_count, symbol, ts_min, ts_max)
    VALUES ('${analyticsPath}', 'bulk-futures', 0, ${Number(totalRows[0].cnt)}, 'FUTURES_ALL',
            (SELECT MIN(ts) FROM ohlcv), (SELECT MAX(ts) FROM ohlcv))
  `);

  await marketQuery("DETACH src");
  closeMarketDB();
  console.log('[ingest] Done.');
}

main().catch(console.error);
