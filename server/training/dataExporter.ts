/**
 * Data Exporter — Exports OHLCV from QuestDB to temp parquet for Python trainers.
 *
 * All time series data comes from QuestDB (SAMPLE BY aggregation).
 * No Panama adjustment or continuous contract stitching — individual contracts only.
 * Parquet writing uses DuckDB in-memory as a utility (analytics layer).
 */

import fs from "fs";
import os from "os";
import path from "path";
import { getOHLCVSampleBy } from "../questdb";
import { runQuery } from "../duckdb/core";

const TMP_DIR = path.join(os.tmpdir(), "ml_dashboard_training");

export interface ExportResult {
  dataFile: string;
  totalBars: number;
  dateRange: { start: string; end: string };
}

/**
 * Export OHLCV data from QuestDB to a temp parquet file.
 * Queries QuestDB via SAMPLE BY, writes parquet via DuckDB in-memory.
 */
export async function exportTrainingData(
  symbol: string,
  timeframe: string,
  dateRange?: { start: string; end: string },
): Promise<ExportResult> {
  const sym = symbol.toUpperCase();

  // Map timeframe label to QuestDB SAMPLE BY format
  const LABEL_TO_SAMPLE: Record<string, string> = {
    '1m': '1m', '5m': '5m', '15m': '15m', '30m': '30m',
    '1h': '1h', '4h': '4h', '1d': '1d', '1w': '1w',
  };
  const sampleLabel = LABEL_TO_SAMPLE[timeframe] ?? '1m';

  // Convert date range to ms-epoch for QuestDB query
  const startMs = dateRange?.start ? new Date(dateRange.start).getTime() : undefined;
  const endMs = dateRange?.end ? new Date(dateRange.end).getTime() : undefined;

  // Query QuestDB via SAMPLE BY (no row limit — we want all training data)
  const rows = await getOHLCVSampleBy(sym, sampleLabel, startMs, endMs);

  if (rows.length === 0) {
    throw new Error(`No data found for ${sym} in QuestDB`);
  }

  // Normalise QuestDB rows to flat OHLCV
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

  // Ensure tmp dir exists
  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

  const dataFile = path.join(TMP_DIR, `${sym}_${timeframe}_${Date.now()}.parquet`).replace(/\\/g, "/");

  // Write to parquet via DuckDB in-memory (analytics utility)
  const tempTable = `training_export_${Date.now()}`;
  await runQuery(`CREATE TABLE ${tempTable} (ts TIMESTAMP, open DOUBLE, high DOUBLE, low DOUBLE, close DOUBLE, volume DOUBLE)`);

  // Insert in batches
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

  const totalBars = ohlcv.length;
  const exportedRange = {
    start: ohlcv[0].ts,
    end: ohlcv[ohlcv.length - 1].ts,
  };

  return { dataFile, totalBars, dateRange: exportedRange };
}

/** Clean up a temp data file */
export function cleanupDataFile(dataFile: string) {
  try {
    const localPath = dataFile.replace(/\//g, path.sep);
    if (fs.existsSync(localPath)) fs.unlinkSync(localPath);
  } catch { /* ignore */ }
}
