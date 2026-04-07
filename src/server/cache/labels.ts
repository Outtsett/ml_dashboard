/**
 * Label preview cache — caches preview results for 15 minutes (max 50 entries).
 *
 * Same symbol + generatorType + params + timeframe = same result.
 * O(1) LRU eviction via lru-cache v11.
 * Invalidated on ingestion.completed events for the affected symbol.
 */

import { LRUCache } from 'lru-cache';
import type { DomainEvent } from '@shared/event-types';
import { getEventBus } from '../events/event-bus';

const PREVIEW_CACHE_MAX = 50;
const PREVIEW_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

type CacheValue = NonNullable<unknown>;

const previewCache = new LRUCache<string, CacheValue>({
  max: PREVIEW_CACHE_MAX,
  ttl: PREVIEW_CACHE_TTL_MS,
  dispose: (_value, _key, reason) => {
    if (reason === 'evict') labelStats.evictions++;
  },
});

// Track which keys belong to which symbol (for invalidation)
const keyToSymbol = new Map<string, string>();

// ── Stats ──────────────────────────────────────────────────
let labelStats = { hits: 0, misses: 0, evictions: 0, invalidations: 0 };

export interface PreviewCacheKeyRequest {
  symbol: string;
  generatorType: string;
  params: Record<string, unknown>;
  timeframeMinutes?: number;
}

export function previewCacheKey(req: PreviewCacheKeyRequest): string {
  return JSON.stringify({
    symbol: req.symbol,
    generatorType: req.generatorType,
    config: req.params,
    timeframeMinutes: req.timeframeMinutes || 1,
  });
}

export function previewCacheGet<T>(key: string): T | undefined {
  const value = previewCache.get(key) as T | undefined;
  if (value !== undefined) {
    labelStats.hits++;
  } else {
    labelStats.misses++;
    // Clean up stale symbol mapping if entry was TTL-expired
    keyToSymbol.delete(key);
  }
  return value;
}

export function previewCacheSet(key: string, value: CacheValue, symbol: string): void {
  previewCache.set(key, value);
  keyToSymbol.set(key, symbol);
}

/** Invalidate all label preview entries for a symbol. */
export function invalidatePreviewCacheForSymbol(symbol: string): number {
  let removed = 0;
  const keysToDelete: string[] = [];
  for (const [key, sym] of keyToSymbol) {
    if (sym === symbol) {
      keysToDelete.push(key);
    }
  }
  for (const key of keysToDelete) {
    previewCache.delete(key);
    keyToSymbol.delete(key);
    removed++;
  }
  if (removed > 0) labelStats.invalidations += removed;
  return removed;
}

/** Clear all label preview cache entries. */
export function clearPreviewCache(): void {
  previewCache.clear();
  keyToSymbol.clear();
  labelStats = { hits: 0, misses: 0, evictions: 0, invalidations: 0 };
}

/** Get label preview cache stats. */
export function getPreviewCacheStats(): {
  hits: number;
  misses: number;
  entries: number;
  evictions: number;
  invalidations: number;
  hitRate: string;
  maxSize: number;
} {
  const total = labelStats.hits + labelStats.misses;
  const hitRate = total > 0 ? ((labelStats.hits / total) * 100).toFixed(1) + '%' : '0.0%';
  return {
    hits: labelStats.hits,
    misses: labelStats.misses,
    entries: previewCache.size,
    evictions: labelStats.evictions,
    invalidations: labelStats.invalidations,
    hitRate,
    maxSize: PREVIEW_CACHE_MAX,
  };
}

// ── Event-driven invalidation ──────────────────────────────
function subscribeToEvents(): void {
  const bus = getEventBus();
  bus.on('ingestion.completed', (event: DomainEvent) => {
    if (event.type !== 'ingestion.completed') return;
    const { symbol } = event.data;
    invalidatePreviewCacheForSymbol(symbol);
  });
}

subscribeToEvents();
