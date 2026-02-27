/**
 * QuestDB Export — parquet/CSV export via HTTP API.
 *
 * Uses QuestDB /exp endpoint (no DuckDB).
 */

import * as path from "path";
import * as fs from "fs";
import { validateSymbol } from "@shared/schema";
import { getOHLCVSampleBy } from "./queries";
import { questdbExportParquet } from "./httpQuery";

const DEFAULT_PARQUET_OUTPUT_DIR = path.join(process.cwd(), 'data', 'parquet-data');

export async function exportQuestDBToParquet(
  symbol: string,
  timeframe: string = "1m",
  outputDir: string = DEFAULT_PARQUET_OUTPUT_DIR
): Promise<{ path: string; rowCount: number }> {
  const safeSymbol = validateSymbol(symbol);

  fs.mkdirSync(outputDir, { recursive: true });

  const outputPath = path.join(outputDir, `${safeSymbol}_${timeframe}.parquet`);

  // Build SAMPLE BY query
  const sampleInterval = timeframe === '1w' ? '7d' : timeframe;
  const sql = `
    SELECT symbol, timestamp,
      first(open) as open, max(high) as high,
      min(low) as low, last(close) as close,
      sum(volume) as volume
    FROM ohlcv
    WHERE symbol = '${safeSymbol}'
    SAMPLE BY ${sampleInterval} ALIGN TO CALENDAR
    ORDER BY timestamp
  `;

  const buffer = await questdbExportParquet(sql);
  fs.writeFileSync(outputPath, buffer);

  // Get row count from the data
  const data = await getOHLCVSampleBy(safeSymbol, timeframe);

  console.log(`[QuestDB] Exported ${data.length} rows for ${safeSymbol} (${timeframe}) to ${outputPath}`);

  return { path: outputPath, rowCount: data.length };
}
