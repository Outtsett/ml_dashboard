/**
 * Unified cache barrel — re-exports all cache modules.
 *
 * Provides clearAllCaches() and getCacheStats() for centralized management.
 */

// Re-export all cache modules
export { ohlcvCache, OHLCVCache, cachedQuery } from './ohlcv';
export { QueryCache, getQueryCache } from './query';
export { getCachedAnchor, setCachedAnchor, clearAnchorCache, invalidateAnchorForSymbol, getAnchorCacheStats } from './anchor';
export { clearSymbolsCatalogCache, getSymbolsCatalogCache, setSymbolsCatalogCache, warmSymbolsCatalog, getSymbolsCacheStats } from './symbols';
export { modelCacheGet, modelCacheSet, clearModelCache, getModelCacheStats } from './model';
export { previewCacheKey, previewCacheGet, previewCacheSet, clearPreviewCache, invalidatePreviewCacheForSymbol, getPreviewCacheStats } from './labels';
export type { PreviewCacheKeyRequest } from './labels';
export { clearParquetCacheForSymbol, clearAllParquetCache, cleanupParquetCache, getParquetCacheStats } from './parquet';
export { cacheControl, CACHE_STATIC, CACHE_SEMI } from './headers';

import { ohlcvCache } from './ohlcv';
import { getQueryCache } from './query';
import { clearAnchorCache, getAnchorCacheStats } from './anchor';
import { clearSymbolsCatalogCache, getSymbolsCacheStats } from './symbols';
import { clearModelCache, getModelCacheStats } from './model';
import { clearPreviewCache, getPreviewCacheStats } from './labels';
import { clearAllParquetCache, getParquetCacheStats } from './parquet';

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
  anchor: ReturnType<typeof getAnchorCacheStats>;
  symbols: ReturnType<typeof getSymbolsCacheStats>;
  model: ReturnType<typeof getModelCacheStats>;
  labels: ReturnType<typeof getPreviewCacheStats>;
  parquet: ReturnType<typeof getParquetCacheStats>;
} {
  return {
    ohlcv: ohlcvCache.getStats(),
    query: getQueryCache().getStats(),
    anchor: getAnchorCacheStats(),
    symbols: getSymbolsCacheStats(),
    model: getModelCacheStats(),
    labels: getPreviewCacheStats(),
    parquet: getParquetCacheStats(),
  };
}
