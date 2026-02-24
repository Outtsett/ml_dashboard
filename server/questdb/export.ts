import * as path from "path";
import { validateSymbol } from "@shared/schema";
import { getOHLCVSampleBy } from "./queries";

const DEFAULT_PARQUET_OUTPUT_DIR = path.join(process.cwd(), 'data', 'parquet-data');

export async function exportQuestDBToParquet(
  symbol: string,
  timeframe: string = "1m",
  outputDir: string = DEFAULT_PARQUET_OUTPUT_DIR
): Promise<{ path: string; rowCount: number }> {
  const safeSymbol = validateSymbol(symbol);
  const fs = await import('fs');
  const nodePath = await import('path');
  
  fs.mkdirSync(outputDir, { recursive: true });
  
  const data = await getOHLCVSampleBy(safeSymbol, timeframe);
  
  if (data.length === 0) {
    throw new Error(`No data found for symbol ${safeSymbol} in QuestDB`);
  }
  
  const outputPath = nodePath.join(outputDir, `${safeSymbol}_${timeframe}.parquet`);
  
  const { runQuery } = await import('../duckdb');
  
  const tableData = data.map(row => ({
    symbol: row.symbol,
    timestamp: new Date(row.timestamp).getTime(),
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    volume: Number(row.volume)
  }));
  
  const tempTableName = `temp_${safeSymbol}_${Date.now()}`;
  
  await runQuery(`
    CREATE TABLE ${tempTableName} (
      symbol VARCHAR,
      timestamp BIGINT,
      open DOUBLE,
      high DOUBLE,
      low DOUBLE,
      close DOUBLE,
      volume DOUBLE
    )
  `);
  
  const batchSize = 5000;
  for (let i = 0; i < tableData.length; i += batchSize) {
    const batch = tableData.slice(i, i + batchSize);
    const values = batch.map(row => 
      `('${row.symbol}', ${row.timestamp}, ${row.open}, ${row.high}, ${row.low}, ${row.close}, ${row.volume})`
    ).join(',');
    
    await runQuery(`INSERT INTO ${tempTableName} VALUES ${values}`);
  }
  
  await runQuery(`COPY ${tempTableName} TO '${outputPath}' (FORMAT PARQUET)`);
  await runQuery(`DROP TABLE ${tempTableName}`);
  
  console.log(`[QuestDB] Exported ${data.length} rows for ${safeSymbol} (${timeframe}) to ${outputPath}`);
  
  return { path: outputPath, rowCount: data.length };
}
