/**
 * Data Exporter — Exports OHLCV from QuestDB to temp parquet for Python trainers.
 *
 * Primary path: DuckDB postgres_scanner queries QuestDB directly and writes
 * parquet in a single COPY command (zero Node.js memory copies).
 *
 * Fallback path: QuestDB PG wire → Node.js → DuckDB temp table → parquet
 * (used when postgres_scanner isn't available or for 1m timeframe which
 * requires QuestDB-native SAMPLE BY aggregation).
 */

import fs from "fs";
import os from "os";
import path from "path";
import { getOHLCVSampleBy, getFrontMonthOHLCV, getFrontMonthRanges } from "../questdb";
import { isFuturesRoot } from "../services/continuousContract";
import { runQuery } from "../duckdb";
import { validateSymbol } from "@shared/schema";

const TMP_DIR = path.join(os.tmpdir(), "ml_dashboard_training");

export interface ExportResult {
  dataFile: string;
  totalBars: number;
  dateRange: { start: string; end: string };
}

/** Materialized views in QuestDB — matches questdb.ts */
const MATERIALIZED_VIEWS: Record<string, string> = {
  "5m": "ohlcv_5m", "15m": "ohlcv_15m", "30m": "ohlcv_30m",
  "1h": "ohlcv_1h", "4h": "ohlcv_4h", "1d": "ohlcv_1d", "1w": "ohlcv_1w",
};

/**
 * Export OHLCV data from QuestDB to a temp parquet file.
 * Tries the direct postgres_scanner path first, falls back to buffered.
 */
export async function exportTrainingData(
  symbol: string,
  timeframe: string,
  dateRange?: { start: string; end: string },
): Promise<ExportResult> {
  const sym = validateSymbol(symbol.toUpperCase());

  const LABEL_TO_SAMPLE: Record<string, string> = {
    '1m': '1m', '5m': '5m', '15m': '15m', '30m': '30m',
    '1h': '1h', '4h': '4h', '1d': '1d', '1w': '1w',
  };
  const sampleLabel = LABEL_TO_SAMPLE[timeframe] ?? '1m';

  const startMs = dateRange?.start ? new Date(dateRange.start).getTime() : undefined;
  const endMs = dateRange?.end ? new Date(dateRange.end).getTime() : undefined;

  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
  const dataFile = path.join(TMP_DIR, `${sym}_${timeframe}_${Date.now()}.parquet`).replace(/\\/g, "/");

  // Try direct path (DuckDB → QuestDB → parquet, zero Node.js copies)
  // Skip direct path for futures roots — the UNION ALL of hundreds of contract
  // ranges can cause DuckDB postgres_scanner to crash. Buffered path is safer.
  const matView = MATERIALIZED_VIEWS[sampleLabel];
  if (matView && !isFuturesRoot(sym)) {
    try {
      const result = await exportDirect(sym, matView, startMs, endMs, dataFile);
      if (result.totalBars > 0) {
        console.log(`[dataExporter] Direct export: ${result.totalBars} bars via postgres_scanner`);
        return result;
      }
    } catch (err: any) {
      console.log(`[dataExporter] Direct export failed, falling back to buffered: ${err.message}`);
    }
  }

  // Fallback: QuestDB PG → Node.js → DuckDB → parquet
  return exportBuffered(sym, sampleLabel, startMs, endMs, dataFile);
}

/**
 * Direct export: DuckDB queries QuestDB via postgres_scanner and writes parquet.
 * No data passes through Node.js memory.
 */
async function exportDirect(
  sym: string,
  matView: string,
  startMs: number | undefined,
  endMs: number | undefined,
  dataFile: string,
): Promise<ExportResult> {
  const escaped = sym.replace(/'/g, "''");

  let selectQuery: string;

  if (isFuturesRoot(sym)) {
    const ranges = await getFrontMonthRanges(sym, startMs, endMs);
    if (ranges.length === 0) throw new Error(`No front-month ranges for ${sym}`);

    const unions = ranges.map(r => {
      const eSym = r.symbol.replace(/'/g, "''");
      const s = r.start + 'T00:00:00.000Z';
      const e = r.end + 'T23:59:59.999Z';
      return `SELECT timestamp, open, high, low, close, volume FROM questdb.${matView} WHERE symbol = '${eSym}' AND timestamp >= '${s}' AND timestamp <= '${e}'`;
    }).join('\n    UNION ALL\n    ');

    selectQuery = `SELECT * FROM (${unions}) ORDER BY timestamp`;
  } else {
    let timeFilter = '';
    if (startMs) timeFilter += ` AND timestamp >= '${new Date(startMs).toISOString()}'`;
    if (endMs) timeFilter += ` AND timestamp <= '${new Date(endMs).toISOString()}'`;

    selectQuery = `SELECT timestamp, open, high, low, close, volume FROM questdb.${matView} WHERE symbol = '${escaped}'${timeFilter} ORDER BY timestamp`;
  }

  await runQuery(`COPY (${selectQuery}) TO '${dataFile}' (FORMAT PARQUET)`);

  // Read back row count and date range from the parquet file
  const stats = await runQuery<{ cnt: number; min_ts: string; max_ts: string }>(
    `SELECT count(*) as cnt, min(timestamp)::VARCHAR as min_ts, max(timestamp)::VARCHAR as max_ts FROM '${dataFile}'`
  );

  const totalBars = Number(stats[0]?.cnt || 0);
  if (totalBars === 0) {
    // Clean up empty parquet and let fallback handle it
    try { fs.unlinkSync(dataFile.replace(/\//g, path.sep)); } catch { /* ignore */ }
    throw new Error('Direct export produced 0 rows');
  }

  return {
    dataFile,
    totalBars,
    dateRange: {
      start: String(stats[0]?.min_ts || ''),
      end: String(stats[0]?.max_ts || ''),
    },
  };
}

/**
 * Buffered export: QuestDB PG → Node.js array → DuckDB temp table → parquet.
 * Used when postgres_scanner isn't available or for 1m (needs SAMPLE BY).
 */
async function exportBuffered(
  sym: string,
  sampleLabel: string,
  startMs: number | undefined,
  endMs: number | undefined,
  dataFile: string,
): Promise<ExportResult> {
  const rows = isFuturesRoot(sym)
    ? await getFrontMonthOHLCV(sym, sampleLabel, startMs, endMs)
    : await getOHLCVSampleBy(sym, sampleLabel, startMs, endMs);

  if (rows.length === 0) {
    throw new Error(`No data found for ${sym} in QuestDB`);
  }

  const ohlcv = rows.map((r: any) => {
    const ts = r.timestamp instanceof Date
      ? r.timestamp.toISOString()
      : new Date(r.timestamp).toISOString();
    return {
      ts,
      open: Number(r.open),
      high: Number(r.high),
      low: Number(r.low),
      close: Number(r.close),
      volume: Number(r.volume),
    };
  });

  const tempTable = `training_export_${Date.now()}`;
  await runQuery(`CREATE TABLE ${tempTable} (ts TIMESTAMP, open DOUBLE, high DOUBLE, low DOUBLE, close DOUBLE, volume DOUBLE)`);

  const batchSize = 5000;
  for (let i = 0; i < ohlcv.length; i += batchSize) {
    const batch = ohlcv.slice(i, i + batchSize);
    const values = batch.map(r =>
      `('${r.ts}'::TIMESTAMP, ${r.open}, ${r.high}, ${r.low}, ${r.close}, ${r.volume})`
    ).join(",");
    await runQuery(`INSERT INTO ${tempTable} VALUES ${values}`);
  }

  await runQuery(`COPY ${tempTable} TO '${dataFile}' (FORMAT PARQUET)`);
  await runQuery(`DROP TABLE ${tempTable}`);

  return {
    dataFile,
    totalBars: ohlcv.length,
    dateRange: {
      start: ohlcv[0]!.ts,
      end: ohlcv[ohlcv.length - 1]!.ts,
    },
  };
}

/**
 * Check if pre-computed normalized features exist for a symbol/timeframe.
 * Returns the path if available, null otherwise.
 */
export function getNormalizedFeaturesPath(
  symbol: string,
  timeframe: string,
): string | null {
  const LABEL_TO_DIR: Record<string, string> = {
    '1m': '1m', '5m': '5m', '15m': '15m', '30m': '30m',
    '1h': '1h', '4h': '4h', '1d': '1d', '1w': '1w',
  };
  const tfDir = LABEL_TO_DIR[timeframe];
  if (!tfDir) return null;

  const featuresPath = path.join(process.cwd(), 'data', 'indicators', tfDir, symbol.toUpperCase(), 'normalized.parquet');
  if (fs.existsSync(featuresPath)) {
    return featuresPath.replace(/\\/g, '/');
  }
  return null;
}

/** Clean up a temp data file */
export function cleanupDataFile(dataFile: string) {
  try {
    const localPath = dataFile.replace(/\//g, path.sep);
    if (fs.existsSync(localPath)) fs.unlinkSync(localPath);
  } catch { /* ignore */ }
}
