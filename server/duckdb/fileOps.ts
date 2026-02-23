import * as fs from 'fs';
import * as path from 'path';
import { validateSymbol } from "@shared/schema";
import { conn, withMutex, validateTableName, validateFilePath, PARQUET_DIR } from "./analytics";

export function loadParquetSafe(tableName: string, filePath: string): Promise<void> {
  const safeTable = validateTableName(tableName);

  if (!filePath.match(/^[a-zA-Z0-9_\-./\\:]+\.parquet$/)) {
    throw new Error(`Invalid parquet file path: ${filePath}`);
  }

  return withMutex(() => new Promise((resolve, reject) => {
    conn.run(`CREATE OR REPLACE TABLE "${safeTable}" AS SELECT * FROM read_parquet(?)`, [filePath], (err) => {
      if (err) reject(err);
      else resolve();
    });
  }));
}

export function loadCSVSafe(tableName: string, filePath: string): Promise<void> {
  const safeTable = validateTableName(tableName);

  if (!filePath.match(/^[a-zA-Z0-9_\-./\\:]+\.csv(\.zst)?$/)) {
    throw new Error(`Invalid CSV file path: ${filePath}`);
  }

  return withMutex(() => new Promise((resolve, reject) => {
    conn.run(`CREATE OR REPLACE TABLE "${safeTable}" AS SELECT * FROM read_csv_auto(?)`, [filePath], (err) => {
      if (err) reject(err);
      else resolve();
    });
  }));
}

export async function convertCSVToParquet(
  inputPath: string,
  symbol: string,
  compression: 'zstd' | 'none' = 'none'
): Promise<string> {
  const safeSymbol = validateSymbol(symbol);
  const safeInputPath = validateFilePath(inputPath);
  const outputPath = path.join(PARQUET_DIR, `${safeSymbol}_ohlcv.parquet`);
  const safeOutputPath = validateFilePath(outputPath);

  console.log(`Converting CSV to Parquet (compression=${compression}): ${safeInputPath} -> ${safeOutputPath}`);

  const compressionOption = compression === 'zstd' ? ", compression='zstd'" : "";

  return withMutex(async () => {
    const columns = await new Promise<string[]>((res, rej) => {
      conn.all(
        `SELECT column_name FROM (DESCRIBE SELECT * FROM read_csv_auto('${safeInputPath}', header=true${compressionOption}, sample_size=1000))`,
        (err, rows) => {
          if (err) rej(err);
          else res((rows || []).map((r: any) => r.column_name?.toLowerCase()));
        }
      );
    });

    console.log('Detected CSV columns:', columns);

    const hasTs_event = columns.includes('ts_event');
    const hasTimestamp = columns.includes('timestamp');

    let timestampExpr: string;
    if (hasTs_event) {
      timestampExpr = `epoch_ms(ts_event::TIMESTAMP)`;
    } else if (hasTimestamp) {
      timestampExpr = `CAST(timestamp AS BIGINT)`;
    } else {
      throw new Error('No timestamp column found (ts_event or timestamp)');
    }

    const symbolExpr = columns.includes('symbol')
      ? `COALESCE(symbol, '${safeSymbol}')`
      : `'${safeSymbol}'`;

    const sql = `
      COPY (
        SELECT
          ${symbolExpr} as symbol,
          ${timestampExpr} as timestamp,
          CAST(open AS DOUBLE) as open,
          CAST(high AS DOUBLE) as high,
          CAST(low AS DOUBLE) as low,
          CAST(close AS DOUBLE) as close,
          CAST(COALESCE(volume, 0) AS DOUBLE) as volume
        FROM read_csv_auto('${safeInputPath}', header=true${compressionOption})
        WHERE open IS NOT NULL AND close IS NOT NULL
      ) TO '${safeOutputPath}' (FORMAT PARQUET, COMPRESSION ZSTD)
    `;

    return new Promise<string>((resolve, reject) => {
      conn.run(sql, (err) => {
        if (err) {
          console.error('Parquet conversion error:', err);
          reject(err);
        } else {
          console.log(`Parquet file created: ${outputPath}`);
          resolve(outputPath);
        }
      });
    });
  });
}

export async function convertZstCSVToParquet(
  inputPath: string,
  symbol: string
): Promise<string> {
  return convertCSVToParquet(inputPath, symbol, 'zstd');
}

export async function getParquetRowCount(parquetPath: string): Promise<number> {
  return withMutex(() => new Promise((resolve, reject) => {
    conn.all(
      `SELECT COUNT(*) as cnt FROM read_parquet('${parquetPath}')`,
      (err, rows: any[]) => {
        if (err) reject(err);
        else {
          const cnt = rows[0]?.cnt;
          resolve(typeof cnt === 'bigint' ? Number(cnt) : (cnt || 0));
        }
      }
    );
  }));
}

export function listParquetFiles(): { symbol: string; path: string; size: number }[] {
  const files = fs.readdirSync(PARQUET_DIR)
    .filter(f => f.endsWith('.parquet'))
    .map(f => {
      const fullPath = path.join(PARQUET_DIR, f);
      const stats = fs.statSync(fullPath);
      const symbol = f.replace('_ohlcv.parquet', '');
      return { symbol, path: fullPath, size: stats.size };
    });
  return files;
}
