/**
 * Data Exporter — OHLCV → parquet export via QuestDB HTTP API.
 *
 * Uses QuestDB /exp?fmt=parquet for direct parquet export (no DuckDB).
 * Also provides helper functions for feature paths and cleanup.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { validateSymbol } from "@shared/schema";
import { questdbExportParquet, questdbHttpQuery } from "../questdb/httpQuery";

export interface ExportResult {
  dataFile: string;
  totalBars: number;
  dateRange: { start: string; end: string };
}

const TMP_DIR = path.join(os.tmpdir(), "ml_dashboard_training");

const SAMPLE_BY: Record<string, string> = {
  '1m': '1m', '5m': '5m', '15m': '15m', '30m': '30m',
  '1h': '1h', '4h': '4h', '1d': '1d', '1w': '7d',
};

/**
 * Export OHLCV data from QuestDB to a temp parquet file.
 * Uses QuestDB /exp?fmt=parquet — zero DuckDB involvement.
 */
export async function exportTrainingData(
  symbol: string,
  timeframe: string,
  dateRange?: { start: string; end: string },
  maxBars?: number,
): Promise<ExportResult> {
  const sym = validateSymbol(symbol.toUpperCase());
  const sampleInterval = SAMPLE_BY[timeframe] ?? '1m';
  const barLimit = maxBars ?? 100_000;

  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
  const dataFile = path.join(TMP_DIR, `${sym}_${timeframe}_${Date.now()}.parquet`).replace(/\\/g, "/");

  // Build WHERE clause
  let where = `WHERE symbol = '${sym}'`;
  if (dateRange?.start) where += ` AND timestamp >= '${dateRange.start}'`;
  if (dateRange?.end) where += ` AND timestamp <= '${dateRange.end}'`;

  const sql = `
    SELECT symbol, timestamp,
      first(open) as open, max(high) as high,
      min(low) as low, last(close) as close,
      sum(volume) as volume
    FROM ohlcv
    ${where}
    SAMPLE BY ${sampleInterval} ALIGN TO CALENDAR
    ORDER BY timestamp
    LIMIT ${barLimit}
  `;

  // Export directly to parquet via QuestDB HTTP API
  const buffer = await questdbExportParquet(sql);
  fs.writeFileSync(dataFile.replace(/\//g, path.sep), buffer);

  // Get actual row count via a quick count query
  let totalBars = 0;
  try {
    const countRows = await questdbHttpQuery<{ cnt: number }>(`
      SELECT count() as cnt FROM ohlcv ${where}
      SAMPLE BY ${sampleInterval} ALIGN TO CALENDAR
    `);
    totalBars = Math.min(countRows[0]?.cnt ?? 0, barLimit);
  } catch {
    // Approximate from buffer size if count query fails
    totalBars = buffer.length > 100 ? barLimit : 0;
  }

  console.log(`[dataExporter] Exported ${sym} ${timeframe}: ${totalBars} bars to ${dataFile}`);

  return {
    dataFile,
    totalBars,
    dateRange: {
      start: dateRange?.start ?? 'all',
      end: dateRange?.end ?? 'all',
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
  const tfDir = SAMPLE_BY[timeframe] ? timeframe : null;
  if (!tfDir) return null;

  const featuresPath = path.join(process.cwd(), 'data', 'features', tfDir, symbol.toUpperCase(), 'normalized.parquet');
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
