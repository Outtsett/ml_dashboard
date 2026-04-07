/**
 * Anchor query cache — caches the latest timestamp per symbol for OHLCV chart windowing.
 *
 * 5-min TTL per symbol, bounded LRU (max 200 entries).
 * When an anchor changes, stale OHLCV cache entries for that symbol are flushed.
 * Invalidated on ingestion.completed events for the affected symbol.
 */

import type { DomainEvent } from '@shared/event-types';
import { ohlcvCache } from './ohlcv';
import { getEventBus } from '../events/event-bus';

const anchorCache = new Map<string, { value: number; expiry: number }>();
const ANCHOR_TTL_MS = 5 * 60 * 1000; // 5 minutes
const ANCHOR_MAX_ENTRIES = 200;

// ── Stats ──────────────────────────────────────────────────
let anchorStats = { hits: 0, misses: 0, invalidations: 0 };

export function getCachedAnchor(symbol: string): number | undefined {
  const entry = anchorCache.get(symbol);
  if (entry && Date.now() < entry.expiry) {
    anchorStats.hits++;
    return entry.value;
  }
  if (entry) anchorCache.delete(symbol);
  anchorStats.misses++;
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

/** Invalidate anchor cache entry for a symbol. */
export function invalidateAnchorForSymbol(symbol: string): boolean {
  const existed = anchorCache.has(symbol);
  if (existed) {
    anchorCache.delete(symbol);
    anchorStats.invalidations++;
  }
  return existed;
}

/** Clear all anchor cache entries. Used by /api/cache/clear. */
export function clearAnchorCache(): void {
  anchorCache.clear();
  anchorStats = { hits: 0, misses: 0, invalidations: 0 };
}

/** Get anchor cache stats. */
export function getAnchorCacheStats(): {
  hits: number;
  misses: number;
  entries: number;
  invalidations: number;
  hitRate: string;
  maxSize: number;
} {
  const total = anchorStats.hits + anchorStats.misses;
  const hitRate = total > 0 ? ((anchorStats.hits / total) * 100).toFixed(1) + '%' : '0.0%';
  return {
    hits: anchorStats.hits,
    misses: anchorStats.misses,
    entries: anchorCache.size,
    invalidations: anchorStats.invalidations,
    hitRate,
    maxSize: ANCHOR_MAX_ENTRIES,
  };
}

// ── Event-driven invalidation ──────────────────────────────
function subscribeToEvents(): void {
  const bus = getEventBus();
  bus.on('ingestion.completed', (event: DomainEvent) => {
    if (event.type !== 'ingestion.completed') return;
    const { symbol } = event.data;
    invalidateAnchorForSymbol(symbol);
  });
}

subscribeToEvents();
