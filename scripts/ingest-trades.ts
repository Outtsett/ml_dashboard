/**
 * Ingest trades data into QuestDB.
 *
 * Sources:
 *   - D:\HistoricalTickData\merged_trades_all.parquet (14.5M rows, MNQ, Jun-Jul 2025)
 *   - D:\HistoricalTickData\*.trades.parquet (converted from .dbn by convert-dbn-trades.py)
 *
 * Reads from Parquet files via ephemeral DuckDB.
 * Writes to QuestDB trades table via ILP.
 * Tracks ingestion in PostgreSQL (optional).
 *
 * Run: npx tsx scripts/ingest-trades.ts
 */
import { Sender } from '@questdb/nodejs-client';
import { initDuckDB, runQuery } from '../server/duckdb';
import { recordIngestion, computeFileHash, checkFileIngested } from '../server/services/ingestionService';
import * as fs from 'fs';

const HIST_DIR = 'E:/lake/raw/vendor=databento/dataset=GLBX.MDP3';
const BATCH_SIZE = 50_000;
const QUESTDB_HTTP_PORT = process.env.QUESTDB_HTTP_PORT || '9000';
const QUESTDB_HOST = process.env.QUESTDB_HOST || 'localhost';

/**
 * Send a batch of trade rows to QuestDB via ILP.
 * The trades table uses ts_event as the designated timestamp.
 */
async function sendTradesBatch(
  sender: Sender,
  batch: Array<{
    ts: string;
    rtype: number;
    publisher_id: number;
    instrument_id: number;
    action: string;
    side: string;
    depth: number;
    price: number;
    size: number;
    flags: number;
    ts_in_delta: number;
    sequence: number;
    symbol: string;
  }>,
): Promise<{ count: number; tsMin: number; tsMax: number }> {
  let tsMin = Infinity;
  let tsMax = -Infinity;

  for (const row of batch) {
    const tsMs = new Date(row.ts).getTime();

    await sender
      .table('trades')
      .symbol('action', String(row.action || ''))
      .symbol('side', String(row.side || ''))
      .symbol('symbol', String(row.symbol || ''))
      .intColumn('rtype', Number(row.rtype) || 0)
      .intColumn('publisher_id', Number(row.publisher_id) || 0)
      .intColumn('instrument_id', Number(row.instrument_id) || 0)
      .intColumn('depth', Number(row.depth) || 0)
      .floatColumn('price', Number(row.price))
      .intColumn('size', Number(row.size) || 0)
      .intColumn('flags', Number(row.flags) || 0)
      .intColumn('ts_in_delta', Number(row.ts_in_delta) || 0)
      .intColumn('sequence', Number(row.sequence) || 0)
      .at(tsMs, 'ms');

    if (tsMs < tsMin) tsMin = tsMs;
    if (tsMs > tsMax) tsMax = tsMs;
  }

  return { count: batch.length, tsMin, tsMax };
}

async function main() {
  await initDuckDB();

  // 1. Ingest merged_trades_all.parquet
  const mergedPath = `${HIST_DIR}/merged_trades_all.parquet`;

  let mergedIngested = false;
  try {
    const hash = await computeFileHash(mergedPath);
    const dupCheck = await checkFileIngested(mergedPath, hash);
    if (dupCheck.ingested) {
      console.log('[trades] merged_trades_all.parquet already ingested, skipping');
      mergedIngested = true;
    }
  } catch {
    console.log('[trades] PostgreSQL dedup check unavailable, proceeding');
  }

  if (!mergedIngested && fs.existsSync(mergedPath)) {
    console.log('[trades] Ingesting merged_trades_all.parquet...');

    const totalResult = await runQuery<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM read_parquet('${mergedPath}')`
    );
    const totalRows = Number(totalResult[0].cnt);
    console.log(`[trades] Total rows: ${totalRows.toLocaleString()}`);

    const start = Date.now();
    const configStr = `http::addr=${QUESTDB_HOST}:${QUESTDB_HTTP_PORT};auto_flush=off;`;
    const sender = await Sender.fromConfig(configStr);

    let offset = 0;
    let rowCount = 0;
    let globalTsMin = Infinity;
    let globalTsMax = -Infinity;

    while (offset < totalRows) {
      // merged_trades_all has: ts, rtype, publisher_id, instrument_id, action, side, depth, price, size, flags, ts_in_delta, sequence, symbol
      const batch = await runQuery<{
        ts: string; rtype: number; publisher_id: number; instrument_id: number;
        action: string; side: string; depth: number; price: number; size: number;
        flags: number; ts_in_delta: number; sequence: number; symbol: string;
      }>(`
        SELECT CAST(ts AS VARCHAR) AS ts, rtype, publisher_id, instrument_id,
               action, side, depth, price, size, flags, ts_in_delta, sequence, symbol
        FROM read_parquet('${mergedPath}')
        LIMIT ${BATCH_SIZE} OFFSET ${offset}
      `);

      if (batch.length === 0) break;

      const result = await sendTradesBatch(sender, batch);
      rowCount += result.count;
      if (result.tsMin < globalTsMin) globalTsMin = result.tsMin;
      if (result.tsMax > globalTsMax) globalTsMax = result.tsMax;

      await sender.flush();
      offset += BATCH_SIZE;

      if (rowCount % 500_000 === 0 || offset >= totalRows) {
        const pct = ((offset / totalRows) * 100).toFixed(1);
        console.log(`[trades] merged progress: ${rowCount.toLocaleString()} rows (${pct}%)`);
      }
    }

    await sender.flush();
    await sender.close();

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`[trades] Ingested ${rowCount.toLocaleString()} rows in ${elapsed}s`);

    // Record in PostgreSQL (optional)
    try {
      const hash = await computeFileHash(mergedPath);
      const fileSize = fs.statSync(mergedPath).size;
      await recordIngestion(
        mergedPath, hash, fileSize, rowCount,
        'MNQ_TRADES', new Date(globalTsMin), new Date(globalTsMax),
      );
      console.log('[trades] Recorded merged ingestion in PostgreSQL');
    } catch {
      console.log('[trades] Could not record ingestion in PostgreSQL');
    }
  }

  // 2. Find and ingest any additional .trades.parquet files (converted from .dbn)
  if (!fs.existsSync(HIST_DIR)) {
    console.log(`[trades] Directory ${HIST_DIR} does not exist, skipping additional files`);
  } else {
    const files = fs.readdirSync(HIST_DIR)
      .filter(f => f.endsWith('.trades.parquet') && f !== 'merged_trades_all.parquet')
      .sort();

    if (files.length === 0) {
      console.log('[trades] No additional .trades.parquet files found (run convert-dbn-trades.py first)');
    } else {
      for (const file of files) {
        const filePath = `${HIST_DIR}/${file}`;

        let skipFile = false;
        try {
          const hash = await computeFileHash(filePath);
          const dupCheck = await checkFileIngested(filePath, hash);
          if (dupCheck.ingested) {
            console.log(`[trades] ${file} already ingested, skipping`);
            skipFile = true;
          }
        } catch {
          // PostgreSQL not available
        }
        if (skipFile) continue;

        console.log(`[trades] Ingesting ${file}...`);

        const totalResult = await runQuery<{ cnt: number }>(
          `SELECT COUNT(*) as cnt FROM read_parquet('${filePath}')`
        );
        const totalRows = Number(totalResult[0].cnt);

        const start = Date.now();
        const configStr = `http::addr=${QUESTDB_HOST}:${QUESTDB_HTTP_PORT};auto_flush=off;`;
        const sender = await Sender.fromConfig(configStr);

        let offset = 0;
        let rowCount = 0;
        let globalTsMin = Infinity;
        let globalTsMax = -Infinity;

        while (offset < totalRows) {
          // .dbn parquets have ts_event as the timestamp column
          const batch = await runQuery<{
            ts: string; rtype: number; publisher_id: number; instrument_id: number;
            action: string; side: string; depth: number; price: number; size: number;
            flags: number; ts_in_delta: number; sequence: number; symbol: string;
          }>(`
            SELECT CAST(ts_event AS VARCHAR) AS ts, rtype, publisher_id, instrument_id,
                   action, side, depth, price, size, flags, ts_in_delta, sequence, symbol
            FROM read_parquet('${filePath}')
            LIMIT ${BATCH_SIZE} OFFSET ${offset}
          `);

          if (batch.length === 0) break;

          const result = await sendTradesBatch(sender, batch);
          rowCount += result.count;
          if (result.tsMin < globalTsMin) globalTsMin = result.tsMin;
          if (result.tsMax > globalTsMax) globalTsMax = result.tsMax;

          await sender.flush();
          offset += BATCH_SIZE;
        }

        await sender.flush();
        await sender.close();

        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        console.log(`[trades] ${file}: ${rowCount.toLocaleString()} rows in ${elapsed}s`);

        // Record in PostgreSQL (optional)
        try {
          const hash = await computeFileHash(filePath);
          const fileSize = fs.statSync(filePath).size;
          await recordIngestion(
            filePath, hash, fileSize, rowCount,
            'MNQ_TRADES', new Date(globalTsMin), new Date(globalTsMax),
          );
        } catch {
          // PostgreSQL not available
        }
      }
    }
  }

  console.log('[trades] Done.');
}

main().catch(console.error);
