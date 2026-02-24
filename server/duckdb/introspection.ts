import * as fs from 'fs';
import * as path from 'path';
import { validateSymbol } from "@shared/schema";
import { conn, withMutex, PARQUET_DIR } from "./analyticsCore";
import { listParquetFiles } from "./fileOps";
import { getParquetStats } from "./queries";

// Legacy function - OHLCV export removed (data lives in QuestDB now)
export async function exportPostgresToParquet(_symbol: string, _db: any): Promise<string> {
  throw new Error('Legacy OHLCV export removed. OHLCV data is in QuestDB.');
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
