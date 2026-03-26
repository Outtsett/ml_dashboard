/**
 * Unified cache barrel — re-exports all cache modules.
 *
 * Provides clearAllCaches() and getCacheStats() for centralized management.
 */

// Re-export all cache modules
export { ohlcvCache, OHLCVCache, cachedQuery } from './ohlcv';
export { QueryCache, getQueryCache } from './query';
export { getCachedAnchor, setCachedAnchor, clearAnchorCache } from './anchor';
export { clearSymbolsCatalogCache, getSymbolsCatalogCache, setSymbolsCatalogCache, warmSymbolsCatalog } from './symbols';
export { modelCacheGet, modelCacheSet, clearModelCache } from './model';
export { previewCacheKey, previewCacheGet, previewCacheSet, clearPreviewCache } from './labels';
export type { PreviewCacheKeyRequest } from './labels';
export { clearParquetCacheForSymbol, clearAllParquetCache } from './parquet';
export { cacheControl, CACHE_STATIC, CACHE_SEMI } from './headers';

import { ohlcvCache } from './ohlcv';
import { getQueryCache } from './query';
import { clearAnchorCache } from './anchor';
import { clearSymbolsCatalogCache } from './symbols';
import { clearModelCache } from './model';
import { clearPreviewCache } from './labels';
import { clearAllParquetCache } from './parquet';

/** Clear all server-side caches. */
export function clearAllCaches(): void {
  ohlcvCache.clear();
  getQueryCache().clear();
  clearAnchorCache();
  clearSymbolsCatalogCache();
  clearModelCache();
  clearPreviewCache();
  clearAllParquetCache();
}

/** Get stats from all instrumented caches. */
export function getCacheStats(): {
  ohlcv: ReturnType<typeof ohlcvCache.getStats>;
  query: ReturnType<ReturnType<typeof getQueryCache>['getStats']>;
} {
  return {
    ohlcv: ohlcvCache.getStats(),
    query: getQueryCache().getStats(),
  };
}
