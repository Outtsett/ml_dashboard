/**
 * Ingest MBP-10 (Market By Price, 10-level depth) CSVs into QuestDB.
 *
 * Source: D:\HistoricalTickData\*.mbp-10.csv (26 files, ~210GB total)
 * Schema: 73 columns -- ts_recv, ts_event, 10-level bid/ask px/sz/ct, symbol, etc.
 * All MNQ contracts, June 5 - July 4, 2025.
 *
 * Reads from CSV files via ephemeral DuckDB.
 * Writes to QuestDB mbp10 table via ILP.
 * Tracks ingestion in PostgreSQL (optional).
 *
 * Run: npx tsx scripts/ingest-mbp10.ts
 */
import { Sender } from '@questdb/nodejs-client';
import { initDuckDB, runQuery } from '../server/duckdb';
import { recordIngestion, computeFileHash, checkFileIngested } from '../server/services/ingestionService';
import * as fs from 'fs';

// Deliveries are partitioned by received= date under the schema dir; walk them all
// so a new delivery needs no code change.
const HIST_DIR = 'E:/lake/raw/vendor=databento/dataset=GLBX.MDP3/schema=mbp-10';
const BATCH_SIZE = 50_000;
const QUESTDB_HTTP_PORT = process.env.QUESTDB_HTTP_PORT || '9000';
const QUESTDB_HOST = process.env.QUESTDB_HOST || 'localhost';

// Generate the 10-level book column names
const BOOK_LEVELS = Array.from({ length: 10 }, (_, i) => {
  const pad = String(i).padStart(2, '0');
  return {
    bidPx: `bid_px_${pad}`, askPx: `ask_px_${pad}`,
    bidSz: `bid_sz_${pad}`, askSz: `ask_sz_${pad}`,
    bidCt: `bid_ct_${pad}`, askCt: `ask_ct_${pad}`,
  };
});

// Build the SELECT columns for DuckDB -- all book level columns
const bookSelectCols = BOOK_LEVELS.map(l =>
  `${l.bidPx}, ${l.askPx}, ${l.bidSz}, ${l.askSz}, ${l.bidCt}, ${l.askCt}`
).join(', ');

interface MBP10Row {
  ts_recv: string;
  ts_event: string;
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
  [key: string]: string | number; // book level columns
}

async function sendMBP10Batch(
  sender: Sender,
  batch: MBP10Row[],
): Promise<{ count: number; tsMin: number; tsMax: number }> {
  let tsMin = Infinity;
  let tsMax = -Infinity;

  for (const row of batch) {
    const tsEventMs = new Date(row.ts_event).getTime();
    const tsRecvMs = new Date(row.ts_recv).getTime();

    let s = sender
      .table('mbp10')
      .symbol('action', String(row.action || ''))
      .symbol('side', String(row.side || ''))
      .symbol('symbol', String(row.symbol || ''))
      .timestampColumn('ts_recv', tsRecvMs, 'ms')
      .intColumn('rtype', Number(row.rtype) || 0)
      .intColumn('publisher_id', Number(row.publisher_id) || 0)
      .intColumn('instrument_id', Number(row.instrument_id) || 0)
      .intColumn('depth', Number(row.depth) || 0)
      .floatColumn('price', Number(row.price))
      .intColumn('size', Number(row.size) || 0)
      .intColumn('flags', Number(row.flags) || 0)
      .intColumn('ts_in_delta', Number(row.ts_in_delta) || 0)
      .intColumn('sequence', Number(row.sequence) || 0);

    // Add 10 levels of book data
    for (const level of BOOK_LEVELS) {
      s = s
        .floatColumn(level.bidPx, Number(row[level.bidPx]) || 0)
        .floatColumn(level.askPx, Number(row[level.askPx]) || 0)
        .intColumn(level.bidSz, Number(row[level.bidSz]) || 0)
        .intColumn(level.askSz, Number(row[level.askSz]) || 0)
        .intColumn(level.bidCt, Number(row[level.bidCt]) || 0)
        .intColumn(level.askCt, Number(row[level.askCt]) || 0);
    }

    // ts_event is the designated timestamp
    await s.at(tsEventMs, 'ms');

    if (tsEventMs < tsMin) tsMin = tsEventMs;
    if (tsEventMs > tsMax) tsMax = tsEventMs;
  }

  return { count: batch.length, tsMin, tsMax };
}

async function main() {
  await initDuckDB();

  if (!fs.existsSync(HIST_DIR)) {
    console.log(`[mbp10] Directory ${HIST_DIR} does not exist`);
    return;
  }

  const csvFiles = fs.existsSync(HIST_DIR)
    ? fs.readdirSync(HIST_DIR)
        .filter(d => d.startsWith('received='))
        .flatMap(d => fs.readdirSync(`${HIST_DIR}/${d}`)
          .filter(f => f.endsWith('.mbp-10.csv') || f.endsWith('.mbp-10.csv.zst'))
          .map(f => `${d}/${f}`))
        .sort()
    : [];

  console.log(`[mbp10] Found ${csvFiles.length} MBP-10 CSV files`);

  let totalIngested = 0;

  for (const file of csvFiles) {
    const filePath = `${HIST_DIR}/${file}`;

    // Dedup check via PostgreSQL (optional)
    let skipFile = false;
    try {
      const hash = await computeFileHash(filePath);
      const dupCheck = await checkFileIngested(filePath, hash);
      if (dupCheck.ingested) {
        console.log(`[mbp10] ${file} already ingested, skipping`);
        skipFile = true;
      }
    } catch {
      // PostgreSQL not available
    }
    if (skipFile) continue;

    const fileStat = fs.statSync(filePath);
    const sizeGB = (fileStat.size / (1024 ** 3)).toFixed(2);
    console.log(`[mbp10] Ingesting ${file} (${sizeGB} GB)...`);

    // Count rows in file
    const countResult = await runQuery<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM read_csv('${filePath}', auto_detect=true)`
    );
    const totalRows = Number(countResult[0].cnt);

    const start = Date.now();
    const configStr = `http::addr=${QUESTDB_HOST}:${QUESTDB_HTTP_PORT};auto_flush=off;`;
    const sender = await Sender.fromConfig(configStr);

    let offset = 0;
    let rowCount = 0;
    let globalTsMin = Infinity;
    let globalTsMax = -Infinity;

    while (offset < totalRows) {
      const batch = await runQuery<MBP10Row>(`
        SELECT
          CAST(ts_recv AS VARCHAR) AS ts_recv,
          CAST(ts_event AS VARCHAR) AS ts_event,
          rtype, publisher_id, instrument_id,
          action, side, depth, price, size,
          flags, ts_in_delta, sequence,
          ${bookSelectCols},
          symbol
        FROM read_csv('${filePath}', auto_detect=true)
        LIMIT ${BATCH_SIZE} OFFSET ${offset}
      `);

      if (batch.length === 0) break;

      const result = await sendMBP10Batch(sender, batch);
      rowCount += result.count;
      if (result.tsMin < globalTsMin) globalTsMin = result.tsMin;
      if (result.tsMax > globalTsMax) globalTsMax = result.tsMax;

      await sender.flush();
      offset += BATCH_SIZE;

      if (rowCount % 500_000 === 0 || offset >= totalRows) {
        const pct = ((offset / totalRows) * 100).toFixed(1);
        console.log(`[mbp10] ${file}: ${rowCount.toLocaleString()} rows (${pct}%)`);
      }
    }

    await sender.flush();
    await sender.close();

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`[mbp10] ${file}: ${rowCount.toLocaleString()} rows in ${elapsed}s`);

    totalIngested += rowCount;

    // Record in PostgreSQL (optional)
    try {
      const hash = await computeFileHash(filePath);
      await recordIngestion(
        filePath, hash, fileStat.size, rowCount,
        'MNQ_MBP10', new Date(globalTsMin), new Date(globalTsMax),
      );
    } catch {
      // PostgreSQL not available
    }
  }

  console.log(`[mbp10] Total ingested: ${totalIngested.toLocaleString()} rows`);
  console.log('[mbp10] Done.');
}

main().catch(console.error);
