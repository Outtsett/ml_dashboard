/**
 * LRU cache for trained model results (diagnostics, convergence, assignments).
 *
 * These files are immutable after training completes, so caching avoids
 * redundant disk I/O. Max 100 entries with O(1) LRU eviction via lru-cache.
 * Listens for model.retired events to clear stale cached results.
 */

import { LRUCache } from 'lru-cache';
import type { DomainEvent } from '@shared/event-types';
import { getEventBus } from '../events/event-bus';

const MODEL_CACHE_MAX = 100;

type CacheValue = NonNullable<unknown>;

const modelCache = new LRUCache<string, CacheValue>({
  max: MODEL_CACHE_MAX,
  dispose: (_value, _key, reason) => {
    if (reason === 'evict') modelStats.evictions++;
  },
});

// ── Stats ──────────────────────────────────────────────────
let modelStats = { hits: 0, misses: 0, evictions: 0, invalidations: 0 };

export function modelCacheGet<T>(key: string): T | undefined {
  const value = modelCache.get(key) as T | undefined;
  if (value !== undefined) {
    modelStats.hits++;
  } else {
    modelStats.misses++;
  }
  return value;
}

export function modelCacheSet(key: string, value: CacheValue): void {
  modelCache.set(key, value);
}

/**
 * Clear cached model results.
 * @param modelId If provided, removes only entries for that model. Otherwise clears all.
 */
export function clearModelCache(modelId?: string): void {
  if (!modelId) {
    modelCache.clear();
    modelStats = { hits: 0, misses: 0, evictions: 0, invalidations: 0 };
    return;
  }
  const suffix = `:${modelId}`;
  let removed = 0;
  for (const key of modelCache.keys()) {
    if (key.endsWith(suffix)) {
      modelCache.delete(key);
      removed++;
    }
  }
  modelStats.invalidations += removed;
}

/** Get model cache stats. */
export function getModelCacheStats(): {
  hits: number;
  misses: number;
  entries: number;
  evictions: number;
  invalidations: number;
  hitRate: string;
  maxSize: number;
} {
  const total = modelStats.hits + modelStats.misses;
  const hitRate = total > 0 ? ((modelStats.hits / total) * 100).toFixed(1) + '%' : '0.0%';
  return {
    hits: modelStats.hits,
    misses: modelStats.misses,
    entries: modelCache.size,
    evictions: modelStats.evictions,
    invalidations: modelStats.invalidations,
    hitRate,
    maxSize: MODEL_CACHE_MAX,
  };
}

// ── Event-driven invalidation ──────────────────────────────
function subscribeToEvents(): void {
  const bus = getEventBus();
  // model.retired → clear cached results for the retired model
  bus.on('model.retired', (event: DomainEvent) => {
    if (event.type !== 'model.retired') return;
    const { modelId } = event.data;
    clearModelCache(modelId);
  });
}

subscribeToEvents();
