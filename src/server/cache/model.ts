/**
 * LRU cache for trained model results (diagnostics, convergence, assignments).
 *
 * These files are immutable after training completes, so caching avoids
 * redundant disk I/O. Max 100 entries with LRU eviction.
 */

interface ModelCacheEntry {
  value: unknown;
  accessedAt: number;
}

const MODEL_CACHE_MAX = 100;
const modelCache = new Map<string, ModelCacheEntry>();

export function modelCacheGet<T>(key: string): T | undefined {
  const entry = modelCache.get(key);
  if (!entry) return undefined;
  entry.accessedAt = Date.now();
  return entry.value as T;
}

export function modelCacheSet(key: string, value: unknown): void {
  // Evict LRU if at capacity
  while (modelCache.size >= MODEL_CACHE_MAX) {
    let oldestKey: string | undefined;
    let oldestAccess = Infinity;
    for (const [k, e] of modelCache) {
      if (e.accessedAt < oldestAccess) {
        oldestAccess = e.accessedAt;
        oldestKey = k;
      }
    }
    if (oldestKey) modelCache.delete(oldestKey);
    else break;
  }
  modelCache.set(key, { value, accessedAt: Date.now() });
}

/**
 * Clear cached model results.
 * @param modelId If provided, removes only entries for that model. Otherwise clears all.
 */
export function clearModelCache(modelId?: string): void {
  if (!modelId) {
    modelCache.clear();
    return;
  }
  const suffix = `:${modelId}`;
  for (const key of modelCache.keys()) {
    if (key.endsWith(suffix)) {
      modelCache.delete(key);
    }
  }
}
