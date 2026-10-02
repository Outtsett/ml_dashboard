/**
 * Parquet cache management for Python ML pipeline cache.
 *
 * The Python feature_extract.py caches indicator DataFrames as parquet files
 * in data/.cache/ with metadata JSON sidecars containing { symbol, timeframe, ... }.
 * Cache key format: {md5hash}.parquet + {md5hash}.json
 *
 * This module provides:
 *  - Symbol-scoped invalidation on data ingestion
 *  - Max-size cap with LRU cleanup (oldest files evicted first)
 *  - Proactive stale file deletion (>24h)
 *  - Disk usage stats for monitoring
 */

import * as fs from 'fs';
import * as path from 'path';
import { log } from '../lib/log';

const CACHE_DIR = path.join(process.cwd(), 'data', '.cache');

// ── Configuration ──────────────────────────────────────────
const MAX_CACHE_SIZE_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB
const STALE_AGE_MS = 24 * 60 * 60 * 1000;            // 24 hours
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;           // 10 minutes

// ── Stats tracking ─────────────────────────────────────────
const stats = {
  deletions: 0,
  staleEvictions: 0,
  sizeEvictions: 0,
};

interface ParquetFileInfo {
  parquetPath: string;
  jsonPath: string;
  sizeBytes: number;
  mtimeMs: number;
  symbol?: string;
}

/**
 * Scan the cache directory and return info for each parquet+json pair.
 * Sorted by modification time ascending (oldest first) for LRU eviction.
 */
function scanCacheFiles(): ParquetFileInfo[] {
  if (!fs.existsSync(CACHE_DIR)) return [];

  const entries: ParquetFileInfo[] = [];
  try {
    const files = fs.readdirSync(CACHE_DIR);
    const parquetFiles = files.filter(f => f.endsWith('.parquet'));

    for (const pf of parquetFiles) {
      const parquetPath = path.join(CACHE_DIR, pf);
      const baseName = pf.replace('.parquet', '');
      const jsonPath = path.join(CACHE_DIR, `${baseName}.json`);

      try {
        const pStat = fs.statSync(parquetPath);
        let symbol: string | undefined;

        if (fs.existsSync(jsonPath)) {
          try {
            const raw = fs.readFileSync(jsonPath, 'utf-8');
            const meta = JSON.parse(raw);
            symbol = meta.symbol;
          } catch {
            // Corrupted sidecar — still track the parquet file
          }
        }

        entries.push({
          parquetPath,
          jsonPath,
          sizeBytes: pStat.size,
          mtimeMs: pStat.mtimeMs,
          symbol,
        });
      } catch {
        // File disappeared between readdir and stat — skip
      }
    }
  } catch {
    // Cache dir unreadable
  }

  // Sort oldest first for LRU eviction
  entries.sort((a, b) => a.mtimeMs - b.mtimeMs);
  return entries;
}

/**
 * Delete a parquet cache entry (both .parquet and .json sidecar).
 */
function deleteEntry(info: ParquetFileInfo): void {
  try {
    if (fs.existsSync(info.parquetPath)) fs.unlinkSync(info.parquetPath);
  } catch { /* locked or already gone */ }
  try {
    if (fs.existsSync(info.jsonPath)) fs.unlinkSync(info.jsonPath);
  } catch { /* locked or already gone */ }
}

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
      stats.deletions += deleted;
      log(`Cleared ${deleted} parquet cache file(s) for ${symbol}`, 'cache');
    }
  } catch (err) {
    log(`Failed to clear parquet cache for ${symbol}: ${(err as Error).message}`, 'cache');
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
      stats.deletions += deleted;
      log(`Cleared all parquet cache: ${deleted} file(s)`, 'cache');
    }
  } catch (err) {
    log(`Failed to clear parquet cache: ${(err as Error).message}`, 'cache');
  }

  return deleted;
}

/**
 * Proactive cleanup: delete stale files (>24h) and enforce max-size cap.
 * Called periodically via setInterval.
 *
 * @returns { staleRemoved, sizeRemoved, totalSizeMB }
 */
export function cleanupParquetCache(): { staleRemoved: number; sizeRemoved: number; totalSizeMB: number } {
  const entries = scanCacheFiles();
  const now = Date.now();
  let staleRemoved = 0;
  let sizeRemoved = 0;

  // Pass 1: Remove stale entries (>24h)
  const fresh: ParquetFileInfo[] = [];
  for (const entry of entries) {
    if (now - entry.mtimeMs > STALE_AGE_MS) {
      deleteEntry(entry);
      staleRemoved++;
    } else {
      fresh.push(entry);
    }
  }

  // Pass 2: Enforce max-size cap (evict oldest first)
  let totalSize = fresh.reduce((sum, e) => sum + e.sizeBytes, 0);
  let idx = 0;
  while (totalSize > MAX_CACHE_SIZE_BYTES && idx < fresh.length) {
    const entry = fresh[idx]!;
    deleteEntry(entry);
    totalSize -= entry.sizeBytes;
    sizeRemoved++;
    idx++;
  }

  if (staleRemoved > 0 || sizeRemoved > 0) {
    stats.staleEvictions += staleRemoved;
    stats.sizeEvictions += sizeRemoved;
    log(
      `Parquet cache cleanup: ${staleRemoved} stale, ${sizeRemoved} over-size removed. ` +
      `${(totalSize / (1024 * 1024)).toFixed(1)} MB remaining`,
      'cache'
    );
  }

  return {
    staleRemoved,
    sizeRemoved,
    totalSizeMB: totalSize / (1024 * 1024),
  };
}

/**
 * Get parquet cache stats for monitoring.
 */
export function getParquetCacheStats(): {
  entries: number;
  totalSizeMB: number;
  maxSizeMB: number;
  deletions: number;
  staleEvictions: number;
  sizeEvictions: number;
} {
  const files = scanCacheFiles();
  const totalBytes = files.reduce((sum, f) => sum + f.sizeBytes, 0);

  return {
    entries: files.length,
    totalSizeMB: Math.round((totalBytes / (1024 * 1024)) * 10) / 10,
    maxSizeMB: Math.round(MAX_CACHE_SIZE_BYTES / (1024 * 1024)),
    deletions: stats.deletions,
    staleEvictions: stats.staleEvictions,
    sizeEvictions: stats.sizeEvictions,
  };
}

// ── Periodic cleanup (every 10 minutes) ────────────────────
setInterval(() => {
  cleanupParquetCache();
}, CLEANUP_INTERVAL_MS);
