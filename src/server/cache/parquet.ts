/**
 * Parquet cache invalidation for Python ML pipeline cache.
 *
 * The Python feature_extract.py caches indicator DataFrames as parquet files
 * in data/.cache/ with metadata JSON sidecars containing { symbol, timeframe, ... }.
 * Cache key format: {md5hash}.parquet + {md5hash}.json
 *
 * This module provides server-side invalidation when new data is ingested,
 * ensuring training pipelines never read stale cached data.
 */

import * as fs from 'fs';
import * as path from 'path';
import { log } from '../lib/log';

const CACHE_DIR = path.join(process.cwd(), 'data', '.cache');

/**
 * Clear parquet cache files for a specific symbol.
 * Reads each .json sidecar to check if it matches the symbol, then deletes
 * both the .json and corresponding .parquet file.
 *
 * @returns Number of parquet files deleted
 */
export function clearParquetCacheForSymbol(symbol: string): number {
  if (!fs.existsSync(CACHE_DIR)) return 0;

  let deleted = 0;
  try {
    const files = fs.readdirSync(CACHE_DIR);
    const jsonFiles = files.filter(f => f.endsWith('.json'));

    for (const jsonFile of jsonFiles) {
      const jsonPath = path.join(CACHE_DIR, jsonFile);
      try {
        const raw = fs.readFileSync(jsonPath, 'utf-8');
        const meta = JSON.parse(raw);
        if (meta.symbol === symbol) {
          // Delete parquet + json sidecar
          const baseName = jsonFile.replace('.json', '');
          const parquetPath = path.join(CACHE_DIR, `${baseName}.parquet`);

          if (fs.existsSync(parquetPath)) {
            fs.unlinkSync(parquetPath);
            deleted++;
          }
          fs.unlinkSync(jsonPath);
        }
      } catch {
        // Corrupted metadata — skip
      }
    }

    if (deleted > 0) {
      log(`Cleared ${deleted} parquet cache file(s) for ${symbol}`, 'cache');
    }
  } catch (err: any) {
    log(`Failed to clear parquet cache for ${symbol}: ${err.message}`, 'cache');
  }

  return deleted;
}

/**
 * Clear ALL parquet cache files. Used when the specific symbol is unknown
 * or when a bulk invalidation is needed.
 *
 * @returns Number of files deleted
 */
export function clearAllParquetCache(): number {
  if (!fs.existsSync(CACHE_DIR)) return 0;

  let deleted = 0;
  try {
    const files = fs.readdirSync(CACHE_DIR);
    for (const file of files) {
      if (file.endsWith('.parquet') || file.endsWith('.json')) {
        try {
          fs.unlinkSync(path.join(CACHE_DIR, file));
          deleted++;
        } catch {
          // File already gone or locked — skip
        }
      }
    }
    if (deleted > 0) {
      log(`Cleared all parquet cache: ${deleted} file(s)`, 'cache');
    }
  } catch (err: any) {
    log(`Failed to clear parquet cache: ${err.message}`, 'cache');
  }

  return deleted;
}
