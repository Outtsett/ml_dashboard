/**
 * Ingest forex data from forex.duckdb and loose Parquet files into QuestDB.
 *
 * Writes to unified 'ohlcv' table with asset_class='forex'.
 */
import { Sender } from '@questdb/nodejs-client';
import { initDuckDB, runQuery } from '../server/duckdb';
import { recordIngestion, computeFileHash, checkFileIngested } from '../server/services/ingestionService';
import * as fs from 'fs';
import * as path from 'path';

const BATCH_SIZE = 50_000;
const QUESTDB_HTTP_PORT = process.env.QUESTDB_HTTP_PORT || '9000';
const QUESTDB_HOST = process.env.QUESTDB_HOST || 'localhost';

async function main() {
  await initDuckDB();

  // --- Part 1: forex.duckdb native_bars ---
  const forexDbPath = 'E:/source/repos/ml_dashboard/data/sources/forex.duckdb';

  let forexDbIngested = false;
  try {
    const hash = await computeFileHash(forexDbPath);
    const dupCheck = await checkFileIngested(forexDbPath, hash);
    if (dupCheck.ingested) {
      console.log('[ingest] forex.duckdb already ingested (per PostgreSQL), skipping');
      forexDbIngested = true;
    }
  } catch {
    console.log('[ingest] PostgreSQL dedup check unavailable, proceeding');
  }

  if (!forexDbIngested) {
    console.log('[ingest] Attaching forex.duckdb...');
    await runQuery(`ATTACH '${forexDbPath}' AS forex (READ_ONLY)`);

    const m1Count = await runQuery<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM forex.native_bars WHERE timeframe = 'M1'`
    );
    const totalM1 = Number(m1Count[0].cnt);
    console.log(`[ingest] M1 rows to ingest to 'ohlcv' (forex): ${totalM1.toLocaleString()}`);

    const start = Date.now();
    const configStr = `http::addr=${QUESTDB_HOST}:${QUESTDB_HTTP_PORT};auto_flush=off;`;
    const sender = await Sender.fromConfig(configStr);

    let offset = 0;
    let rowCount = 0;
    let tsMin = Infinity;
    let tsMax = -Infinity;

    while (offset < totalM1) {
      const batch = await runQuery<{
        ts: string;
        pair: string;
        open: number;
        high: number;
        low: number;
        close: number;
        volume: number;
      }>(`
        SELECT
          CAST(ts AS VARCHAR) AS ts,
          pair,
          open, high, low, close, volume
        FROM forex.native_bars
        WHERE timeframe = 'M1'
        ORDER BY ts
        LIMIT ${BATCH_SIZE} OFFSET ${offset}
      `);

      if (batch.length === 0) break;

      for (const row of batch) {
        const symbol = row.pair.replace(/_/g, '');
        const tsMs = new Date(row.ts).getTime();

        await sender
          .table('ohlcv')
          .symbol('symbol', symbol)
          .symbol('asset_class', 'forex')
          .symbol('root', symbol)
          .floatColumn('open', row.open)
          .floatColumn('high', row.high)
          .floatColumn('low', row.low)
          .floatColumn('close', row.close)
          .floatColumn('volume', Number(row.volume))
          .at(tsMs, 'ms');

        if (tsMs < tsMin) tsMin = tsMs;
        if (tsMs > tsMax) tsMax = tsMs;
        rowCount++;
      }

      await sender.flush();
      offset += BATCH_SIZE;

      if (rowCount % 500_000 === 0 || offset >= totalM1) {
        const pct = ((offset / totalM1) * 100).toFixed(1);
        console.log(`[ingest] native_bars progress: ${rowCount.toLocaleString()} rows (${pct}%)`);
      }
    }

    await sender.flush();
    await sender.close();

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`[ingest] native_bars M1 ingested: ${rowCount.toLocaleString()} rows in ${elapsed}s`);

    await runQuery("DETACH forex");
  }

  // --- Part 2: Loose Parquet files ---
  const forexParquetDir = path.join(process.cwd(), 'data', 'sources', 'forex');
  if (fs.existsSync(forexParquetDir)) {
    const parquetFiles = fs.readdirSync(forexParquetDir).filter(f => f.endsWith('.parquet'));
    console.log(`\n[ingest] Found ${parquetFiles.length} loose forex Parquet files`);

    for (const file of parquetFiles) {
      const filePath = path.join(forexParquetDir, file).replace(/\\/g, '/');
      const symbol = path.basename(file, '.parquet')
        .replace(/_M\d+_\d+Y$/i, '')
        .replace(/_/g, '')
        .toUpperCase();

      console.log(`[ingest] ${file} -> ${symbol}`);

      const countResult = await runQuery<{ cnt: number }>(
        `SELECT COUNT(*) as cnt FROM read_parquet('${filePath}')`
      );
      const totalRows = Number(countResult[0].cnt);

      const configStr = `http::addr=${QUESTDB_HOST}:${QUESTDB_HTTP_PORT};auto_flush=off;`;
      const sender = await Sender.fromConfig(configStr);

      let offset = 0;
      let rowCount = 0;

      while (offset < totalRows) {
        const batch = await runQuery<{
          time: string;
          open: number;
          high: number;
          low: number;
          close: number;
          volume: number;
        }>(`
          SELECT time, open, high, low, close, COALESCE(volume, 0) AS volume
          FROM read_parquet('${filePath}')
          LIMIT ${BATCH_SIZE} OFFSET ${offset}
        `);

        if (batch.length === 0) break;

        for (const row of batch) {
          const tsMs = new Date(row.time).getTime();

          await sender
            .table('ohlcv')
            .symbol('symbol', symbol)
            .symbol('asset_class', 'forex')
            .symbol('root', symbol)
            .floatColumn('open', Number(row.open))
            .floatColumn('high', Number(row.high))
            .floatColumn('low', Number(row.low))
            .floatColumn('close', Number(row.close))
            .floatColumn('volume', Number(row.volume))
            .at(tsMs, 'ms');

          rowCount++;
        }

        await sender.flush();
        offset += BATCH_SIZE;
      }

      await sender.flush();
      await sender.close();
    }
  }

  console.log('\n[ingest] Done.');
}

main().catch(console.error);
