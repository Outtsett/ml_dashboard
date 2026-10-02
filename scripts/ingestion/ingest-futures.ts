/**
 * Ingest futures data from analytics.duckdb ohlcv_1s view into lake.
 *
 * Writes to unified 'ohlcv' table with asset_class='futures' and extracted root.
 */
import { Sender } from '@lake/nodejs-client';
import { initDuckDB, runQuery } from '../server/duckdb';
import { recordIngestion, computeFileHash, checkFileIngested } from '../server/services/ingestionService';

const BATCH_SIZE = 50_000;
const lake_HTTP_PORT = process.env.lake_HTTP_PORT || '9000';
const lake_HOST = process.env.lake_HOST || 'localhost';

/**
 * Extracts the root symbol from a futures contract (e.g., 'MNQZ24' -> 'MNQ')
 */
function getRootSymbol(symbol: string): string {
  const match = symbol.match(/^([A-Z]+)[FGHJKMNQUVXZ]\d{1,2}$/i);
  return match ? match[1].toUpperCase() : symbol.split(/[0-9]/)[0].toUpperCase();
}

async function main() {
  await initDuckDB();

  const analyticsPath = 'E:/source/repos/ml_dashboard/data/sources/analytics.duckdb';

  let alreadyIngested = false;
  try {
    const hash = await computeFileHash(analyticsPath);
    const dupCheck = await checkFileIngested(analyticsPath, hash);
    if (dupCheck.ingested) {
      console.log('[ingest] analytics.duckdb already ingested (per PostgreSQL), skipping');
      alreadyIngested = true;
    }
  } catch (err) {
    console.log('[ingest] PostgreSQL dedup check unavailable, proceeding with ingestion');
  }

  if (alreadyIngested) return;

  console.log('[ingest] Attaching analytics.duckdb...');
  await runQuery(`ATTACH '${analyticsPath}' AS src (READ_ONLY)`);

  console.log('[ingest] Loading instrument mapping...');
  const instruments = await runQuery<{ instrument_id: string; symbol: string }>(
    `SELECT instrument_id, symbol FROM src.instruments`
  );
  const symbolMap = new Map(instruments.map(m => [m.instrument_id, m.symbol]));

  const totalResult = await runQuery<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM src.ohlcv_1s`
  );
  const totalRows = Number(totalResult[0].cnt);
  console.log(`[ingest] Starting futures ingestion to 'ohlcv' (${totalRows.toLocaleString()} rows)...`);

  const start = Date.now();
  const configStr = `http::addr=${lake_HOST}:${lake_HTTP_PORT};auto_flush=off;`;
  const sender = await Sender.fromConfig(configStr);

  let offset = 0;
  let rowCount = 0;
  let tsMin = Infinity;
  let tsMax = -Infinity;

  while (offset < totalRows) {
    const batch = await runQuery<{
      timestamp: string;
      instrument_id: string;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
    }>(`
      SELECT
        CAST(o.timestamp AS VARCHAR) AS timestamp,
        o.instrument_id,
        o.open,
        o.high,
        o.low,
        o.close,
        o.volume
      FROM src.ohlcv_1s o
      ORDER BY o.timestamp
      LIMIT ${BATCH_SIZE} OFFSET ${offset}
    `);

    if (batch.length === 0) break;

    for (const row of batch) {
      const symbol = symbolMap.get(row.instrument_id) || row.instrument_id;
      const root = getRootSymbol(symbol);
      const tsMs = new Date(row.timestamp).getTime();

      await sender
        .table('ohlcv')
        .symbol('symbol', symbol)
        .symbol('asset_class', 'futures')
        .symbol('root', root)
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

    if (rowCount % 500_000 === 0 || offset >= totalRows) {
      const pct = ((offset / totalRows) * 100).toFixed(1);
      console.log(`[ingest] Progress: ${rowCount.toLocaleString()} rows (${pct}%)`);
    }
  }

  await sender.flush();
  await sender.close();

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[ingest] Futures ingestion complete: ${rowCount.toLocaleString()} rows in ${elapsed}s`);

  await runQuery("DETACH src");
}

main().catch(console.error);

