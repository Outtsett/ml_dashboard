/**
 * Anchor query cache — caches the latest timestamp per symbol for OHLCV chart windowing.
 *
 * 5-min TTL per symbol, bounded LRU (max 200 entries).
 * When an anchor changes, stale OHLCV cache entries for that symbol are flushed.
 */

import { ohlcvCache } from './ohlcv';

const anchorCache = new Map<string, { value: number; expiry: number }>();
const ANCHOR_TTL_MS = 5 * 60 * 1000; // 5 minutes
const ANCHOR_MAX_ENTRIES = 200;

export function getCachedAnchor(symbol: string): number | undefined {
  const entry = anchorCache.get(symbol);
  if (entry && Date.now() < entry.expiry) return entry.value;
  if (entry) anchorCache.delete(symbol);
  return undefined;
}

export function setCachedAnchor(symbol: string, value: number): void {
  const previous = anchorCache.get(symbol);
  anchorCache.set(symbol, { value, expiry: Date.now() + ANCHOR_TTL_MS });

  // Anchor changed → flush stale OHLCV entries that used the old time window
  if (previous && previous.value !== value) {
    ohlcvCache.invalidateSymbol(symbol);
  }

  // Evict oldest entry (by expiry) when over capacity
  if (anchorCache.size > ANCHOR_MAX_ENTRIES) {
    let oldestKey: string | undefined;
    let oldestExpiry = Infinity;
    anchorCache.forEach((entry, key) => {
      if (entry.expiry < oldestExpiry) {
        oldestExpiry = entry.expiry;
        oldestKey = key;
      }
    });
    if (oldestKey) anchorCache.delete(oldestKey);
  }
}

/** Clear all anchor cache entries. Used by /api/cache/clear. */
export function clearAnchorCache(): void {
  anchorCache.clear();
}
