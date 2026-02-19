/**
 * File-level deduplication tracker.
 * Checks ingested_files table in market DuckDB before processing any file.
 */
import * as fs from 'fs';
import * as crypto from 'crypto';
import { marketQuery } from '../../duckdb/market';

export async function computeFileHash(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

export interface FileStatus {
  alreadyIngested: boolean;
  hashChanged: boolean;
  previousHash?: string;
}

export async function checkFileStatus(filePath: string, currentHash: string): Promise<FileStatus> {
  const safePath = filePath.replace(/\\/g, '/').replace(/'/g, "''");
  const rows = await marketQuery<{ file_hash: string }>(
    `SELECT file_hash FROM ingested_files WHERE file_path = '${safePath}'`
  );

  if (rows.length === 0) {
    return { alreadyIngested: false, hashChanged: false };
  }

  if (rows[0].file_hash === currentHash) {
    return { alreadyIngested: true, hashChanged: false };
  }

  return { alreadyIngested: false, hashChanged: true, previousHash: rows[0].file_hash };
}

export async function recordIngestion(
  filePath: string, fileHash: string, fileSize: number,
  rowCount: number, symbol: string, tsMin: Date, tsMax: Date
): Promise<void> {
  const safePath = filePath.replace(/\\/g, '/').replace(/'/g, "''");
  await marketQuery(`
    INSERT OR REPLACE INTO ingested_files
    (file_path, file_hash, file_size, row_count, symbol, ts_min, ts_max)
    VALUES ('${safePath}', '${fileHash}', ${fileSize}, ${rowCount}, '${symbol}',
            '${tsMin.toISOString()}', '${tsMax.toISOString()}')
  `);
}
