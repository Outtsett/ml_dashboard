import * as fs from 'fs';
import * as path from 'path';
import { validateSymbol } from "@shared/schema";
import { conn, withMutex, PARQUET_DIR } from "./core";
import { listParquetFiles } from "./fileOps";
import { getParquetStats } from "./queries";

// Export PostgreSQL data to Parquet file for fast DuckDB queries
export async function exportPostgresToParquet(symbol: string, db: any): Promise<string> {
  const safeSymbol = validateSymbol(symbol);
  const outputPath = path.join(PARQUET_DIR, `${safeSymbol}_ohlcv.parquet`);

  console.log(`[duckdb] Exporting PostgreSQL data to parquet: ${symbol} -> ${outputPath}`);

  // Query PostgreSQL for all data for this symbol
  const { ohlcvData } = await import('@shared/schema');
  const { eq, asc } = await import('drizzle-orm');

  const data = await db
    .select()
    .from(ohlcvData)
    .where(eq(ohlcvData.symbol, symbol))
    .orderBy(asc(ohlcvData.timestamp));

  if (data.length === 0) {
    throw new Error(`No data found for symbol ${symbol}`);
  }

  console.log(`[duckdb] Found ${data.length} rows for ${symbol}, writing to parquet...`);

  // Create a temporary JSON file, then convert to parquet using DuckDB
  const tempJsonPath = path.join(PARQUET_DIR, `${safeSymbol}_temp.json`);
  const rows = data.map((row: any) => ({
    symbol: row.symbol,
    timestamp: Number(row.timestamp),
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    volume: Number(row.volume)
  }));

  fs.writeFileSync(tempJsonPath, JSON.stringify(rows));

  return withMutex(() => new Promise((resolve, reject) => {
    // Use direct string interpolation for file paths (safe since paths are internally generated)
    const sql = `
      COPY (
        SELECT
          symbol,
          CAST(timestamp AS BIGINT) as timestamp,
          CAST(open AS DOUBLE) as open,
          CAST(high AS DOUBLE) as high,
          CAST(low AS DOUBLE) as low,
          CAST(close AS DOUBLE) as close,
          CAST(volume AS BIGINT) as volume
        FROM read_json_auto('${tempJsonPath.replace(/'/g, "''")}')
        ORDER BY timestamp ASC
      ) TO '${outputPath.replace(/'/g, "''")}' (FORMAT PARQUET, COMPRESSION ZSTD)
    `;

    conn.run(sql, (err: Error | null) => {
      // Clean up temp file
      try { fs.unlinkSync(tempJsonPath); } catch(e) {}

      if (err) {
        console.error('[duckdb] Parquet export error:', err);
        reject(err);
      } else {
        console.log(`[duckdb] Parquet file created: ${outputPath} (${data.length} rows)`);
        resolve(outputPath);
      }
    });
  }));
}

// Get DuckDB stats for database explorer
export async function getDuckDBStats(): Promise<{
  connected: boolean;
  tables: number;
  tableDetails: { name: string; rowCount: number; type: string; size?: number }[];
  error?: string;
}> {
  try {
    const files = listParquetFiles();
    const tableDetails: { name: string; rowCount: number; type: string; size?: number }[] = [];

    for (const file of files) {
      try {
        const stats = await getParquetStats(file.symbol);
        tableDetails.push({
          name: `${file.symbol}_ohlcv.parquet`,
          rowCount: stats.count || 0,
          type: 'parquet',
          size: file.size,
        });
      } catch (e) {
        tableDetails.push({
          name: file.symbol,
          rowCount: 0,
          type: 'parquet',
          size: file.size,
        });
      }
    }

    // Also check for pre-aggregated files
    const preAggDir = path.join(PARQUET_DIR, 'aggregated');
    if (fs.existsSync(preAggDir)) {
      const aggFiles = fs.readdirSync(preAggDir).filter(f => f.endsWith('.parquet'));
      for (const file of aggFiles) {
        const filePath = path.join(preAggDir, file);
        const stats = fs.statSync(filePath);
        tableDetails.push({
          name: `aggregated/${file}`,
          rowCount: 0, // Would need to query to get count
          type: 'pre-aggregated',
          size: stats.size,
        });
      }
    }

    return {
      connected: true,
      tables: tableDetails.length,
      tableDetails,
    };
  } catch (error: any) {
    return {
      connected: false,
      tables: 0,
      tableDetails: [],
      error: error.message,
    };
  }
}
