/**
 * IndexedDB-backed OHLCV cache for instant chart loads on revisit.
 *
 * Historical OHLCV bars are immutable — once a candle closes, its OHLC values
 * never change. This module persists fetched bars locally so subsequent visits
 * to the same symbol/timeframe skip the network entirely.
 *
 * Storage: IndexedDB "ohlcv-cache" database, one object store per symbol|timeframe.
 * TTL: 24 hours (guard against rare data corrections).
 * Range merging: new bars are merged with existing cached bars, deduped by timestamp.
 */

import { openDB, type IDBPDatabase } from 'idb';

/**
 * Generic bar shape — accepts anything with a timestamp for IndexedDB storage.
 *
 * Deliberately constrains ONLY `timestamp`: IndexedDB persists whole objects,
 * so callers keep every other field at runtime. Requiring an index signature
 * here (e.g. `Record<string, unknown> &`) would reject ordinary interfaces
 * like `StitchedOHLCVBar`, which declare their fields and have no index
 * signature, even though they are perfectly valid bars.
 */
type OhlcvBar = { timestamp: number | string };

interface CachedRange {
  bars: OhlcvBar[];
  firstTs: number;
  lastTs: number;
  storedAt: number;
}

const DB_NAME = 'ohlcv-cache';
const DB_VERSION = 1;
const STORE_NAME = 'ranges';
const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      },
    });
  }
  return dbPromise;
}

function cacheKey(symbol: string, timeframe: string): string {
  return `${symbol}|${timeframe}`;
}

function toEpochMs(ts: number | string): number {
  return typeof ts === 'string' ? parseInt(ts, 10) : ts;
}

/**
 * Retrieve cached bars for a symbol/timeframe.
 * Returns null if no cache exists or cache has expired.
 * If startTime/endTime are provided, only returns data if the cached range fully covers them.
 */
export async function getCachedBars(
  symbol: string,
  timeframe: string,
  startTime?: number,
  endTime?: number,
): Promise<OhlcvBar[] | null> {
  try {
    const db = await getDb();
    const key = cacheKey(symbol, timeframe);
    const cached: CachedRange | undefined = await db.get(STORE_NAME, key);

    if (!cached) return null;

    // Check TTL
    if (Date.now() - cached.storedAt > TTL_MS) {
      await db.delete(STORE_NAME, key);
      return null;
    }

    // If caller requests a specific range, verify coverage
    if (startTime !== undefined && cached.firstTs > startTime) return null;
    if (endTime !== undefined && cached.lastTs < endTime) return null;

    // Filter to requested range if bounds provided
    let bars = cached.bars;
    if (startTime !== undefined || endTime !== undefined) {
      bars = bars.filter(b => {
        const ts = toEpochMs(b.timestamp);
        if (startTime !== undefined && ts < startTime) return false;
        if (endTime !== undefined && ts > endTime) return false;
        return true;
      });
    }

    return bars;
  } catch {
    return null;
  }
}

/**
 * Store bars in IndexedDB, merging with any existing cached range.
 * Deduplicates by timestamp and sorts ascending.
 */
export async function storeBars(
  symbol: string,
  timeframe: string,
  newBars: OhlcvBar[],
): Promise<void> {
  if (!newBars.length) return;

  try {
    const db = await getDb();
    const key = cacheKey(symbol, timeframe);
    const existing: CachedRange | undefined = await db.get(STORE_NAME, key);

    let merged: OhlcvBar[];

    if (existing && Date.now() - existing.storedAt < TTL_MS) {
      // Merge with existing cached bars
      const combined = [...existing.bars, ...newBars];
      const seen = new Set<number>();
      merged = combined.filter(b => {
        const ts = toEpochMs(b.timestamp);
        if (seen.has(ts)) return false;
        seen.add(ts);
        return true;
      }).sort((a, b) => toEpochMs(a.timestamp) - toEpochMs(b.timestamp));
    } else {
      // No existing cache or expired — store fresh
      const seen = new Set<number>();
      merged = newBars.filter(b => {
        const ts = toEpochMs(b.timestamp);
        if (seen.has(ts)) return false;
        seen.add(ts);
        return true;
      }).sort((a, b) => toEpochMs(a.timestamp) - toEpochMs(b.timestamp));
    }

    const range: CachedRange = {
      bars: merged,
      firstTs: toEpochMs(merged[0]!.timestamp),
      lastTs: toEpochMs(merged[merged.length - 1]!.timestamp),
      storedAt: Date.now(),
    };

    await db.put(STORE_NAME, range, key);
  } catch {
    // IndexedDB failures are non-critical — silently continue
  }
}

/**
 * Clear all cached OHLCV data. Exposed for settings/debug UI.
 */
export async function clearOhlcvCache(): Promise<void> {
  try {
    const db = await getDb();
    await db.clear(STORE_NAME);
  } catch {
    // Non-critical
  }
}

/**
 * Get cache statistics for the dashboard summary.
 */
export async function getOhlcvCacheStats(): Promise<{ entries: number; totalBars: number }> {
  try {
    const db = await getDb();
    const keys = await db.getAllKeys(STORE_NAME);
    let totalBars = 0;

    for (const key of keys) {
      const range: CachedRange | undefined = await db.get(STORE_NAME, key);
      if (range) totalBars += range.bars.length;
    }

    return { entries: keys.length, totalBars };
  } catch {
    return { entries: 0, totalBars: 0 };
  }
}
