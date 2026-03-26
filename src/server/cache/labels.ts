/**
 * Label preview cache — caches preview results for 15 minutes (max 50 entries).
 *
 * Same symbol + generatorType + params + timeframe = same result.
 * LRU eviction when at capacity.
 */

const PREVIEW_CACHE_MAX = 50;
const PREVIEW_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

interface PreviewCacheEntry {
  value: unknown;
  createdAt: number;
  accessedAt: number;
}

const previewCache = new Map<string, PreviewCacheEntry>();

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
  const entry = previewCache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.createdAt > PREVIEW_CACHE_TTL_MS) {
    previewCache.delete(key);
    return undefined;
  }
  entry.accessedAt = Date.now();
  return entry.value as T;
}

export function previewCacheSet(key: string, value: unknown): void {
  // Evict LRU if at capacity
  while (previewCache.size >= PREVIEW_CACHE_MAX) {
    let oldestKey: string | undefined;
    let oldestAccess = Infinity;
    for (const [k, e] of previewCache) {
      if (e.accessedAt < oldestAccess) {
        oldestAccess = e.accessedAt;
        oldestKey = k;
      }
    }
    if (oldestKey) previewCache.delete(oldestKey);
    else break;
  }
  const now = Date.now();
  previewCache.set(key, { value, createdAt: now, accessedAt: now });
}

/** Clear all label preview cache entries. */
export function clearPreviewCache(): void {
  previewCache.clear();
}
