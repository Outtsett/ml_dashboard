import * as fs from 'fs';
import * as path from 'path';

const LOCAL_PARQUET_DIR = path.join(process.cwd(), 'data', 'parquet-data');

export interface ParquetFileInfo {
  symbol: string;
  localPath: string;
  size: number;
  lastModified: Date;
}

export class ParquetStorageManager {
  constructor() {
    fs.mkdirSync(LOCAL_PARQUET_DIR, { recursive: true });
  }

  getLocalPath(symbol: string): string {
    return path.join(LOCAL_PARQUET_DIR, `${symbol.toUpperCase()}_ohlcv.parquet`);
  }

  ensureLocal(symbol: string): { path: string } {
    const localPath = this.getLocalPath(symbol.toUpperCase());
    if (fs.existsSync(localPath)) {
      return { path: localPath };
    }
    throw new Error(`Parquet file not found for ${symbol} locally`);
  }

  async listLocalFiles(): Promise<ParquetFileInfo[]> {
    const files: ParquetFileInfo[] = [];

    if (!fs.existsSync(LOCAL_PARQUET_DIR)) {
      return files;
    }

    const entries = fs.readdirSync(LOCAL_PARQUET_DIR);

    for (const entry of entries) {
      if (!entry.endsWith('.parquet')) continue;

      const fullPath = path.join(LOCAL_PARQUET_DIR, entry);
      const stats = fs.statSync(fullPath);
      const symbol = entry.replace('_ohlcv.parquet', '');

      files.push({
        symbol,
        localPath: fullPath,
        size: stats.size,
        lastModified: stats.mtime,
      });
    }

    return files;
  }

  async deleteLocal(symbol: string): Promise<void> {
    const localPath = this.getLocalPath(symbol.toUpperCase());
    if (fs.existsSync(localPath)) {
      fs.unlinkSync(localPath);
    }
  }

  getLocalDiskUsage(): { totalBytes: number; fileCount: number } {
    if (!fs.existsSync(LOCAL_PARQUET_DIR)) {
      return { totalBytes: 0, fileCount: 0 };
    }
    const files = fs.readdirSync(LOCAL_PARQUET_DIR);
    let totalBytes = 0;
    let fileCount = 0;

    for (const file of files) {
      if (file.endsWith('.parquet')) {
        const stats = fs.statSync(path.join(LOCAL_PARQUET_DIR, file));
        totalBytes += stats.size;
        fileCount++;
      }
    }

    return { totalBytes, fileCount };
  }
}

export const parquetStorage = new ParquetStorageManager();
