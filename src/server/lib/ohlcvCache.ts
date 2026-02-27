/**
 * Server-side LRU cache for OHLCV bar query results.
 *
 * Sits between the API routes and the database queries (QuestDB, SQLite).
 * Cache keys encode symbol + timeframe + time window so identical scroll requests
 * are served from memory instead of re-querying 782M+ row tables.
 *
 * Design:
 *  - Max 500 entries (each ~2000 bars × ~64 bytes ≈ 125 KB → total ~60 MB max)
 *  - 5 min TTL per entry (market data doesn't change for historical bars)
 *  - LRU eviction when at capacity
 *  - Supports ohlcv, questdb, and chart cache sources
 */

interface CacheEntry<T> {
  data: T;
  createdAt: number;
  accessedAt: number;
  sizeEstimate: number; // bytes
}

interface CacheStats {
  hits: number;
  misses: number;
  entries: number;
  sizeMB: number;
  evictions: number;
}

const DEFAULT_MAX_ENTRIES = 500;
const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_SIZE_MB = 200; // hard cap

class OHLCVCache {
  private cache = new Map<string, CacheEntry<unknown>>();
  private maxEntries: number;
  private ttlMs: number;
  private stats: CacheStats = { hits: 0, misses: 0, entries: 0, sizeMB: 0, evictions: 0 };
  private totalSizeBytes = 0;

  constructor(maxEntries = DEFAULT_MAX_ENTRIES, ttlMs = DEFAULT_TTL_MS) {
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
  }

  /**
   * Build a cache key from query parameters.
   * Key format: source|symbol|timeframe|startTime|endTime|limit|loadFromStart
   */
  static key(
    source: 'ohlcv' | 'questdb' | 'chart',
    symbol: string,
    timeframe: number | string,
    opts?: {
      startTime?: number;
      endTime?: number;
      limit?: number;
      loadFromStart?: boolean;
    }
  ): string {
    const parts = [
      source,
      symbol,
      timeframe.toString(),
      opts?.startTime?.toString() ?? '',
      opts?.endTime?.toString() ?? '',
      opts?.limit?.toString() ?? '2000',
      opts?.loadFromStart ? '1' : '0',
    ];
    return parts.join('|');
  }

  get<T>(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) {
      this.stats.misses++;
      return undefined;
    }

    // Check TTL
    if (Date.now() - entry.createdAt > this.ttlMs) {
      this.delete(key);
      this.stats.misses++;
      return undefined;
    }

    entry.accessedAt = Date.now();
    this.stats.hits++;
    return entry.data as T;
  }

  set<T>(key: string, data: T): void {
    // Estimate size: JSON.stringify is expensive for large arrays, use heuristic
    const sizeEstimate = Array.isArray(data) ? data.length * 80 : 1024;

    // Evict if at capacity
    while (
      this.cache.size >= this.maxEntries ||
      this.totalSizeBytes + sizeEstimate > MAX_SIZE_MB * 1024 * 1024
    ) {
      if (this.cache.size === 0) break;
      this.evictLRU();
    }

    // Remove existing entry if overwriting
    if (this.cache.has(key)) {
      this.delete(key);
    }

    this.cache.set(key, {
      data,
      createdAt: Date.now(),
      accessedAt: Date.now(),
      sizeEstimate,
    });
    this.totalSizeBytes += sizeEstimate;
    this.stats.entries = this.cache.size;
    this.stats.sizeMB = this.totalSizeBytes / (1024 * 1024);
  }

  private delete(key: string): void {
    const entry = this.cache.get(key);
    if (entry) {
      this.totalSizeBytes -= entry.sizeEstimate;
      this.cache.delete(key);
      this.stats.entries = this.cache.size;
      this.stats.sizeMB = this.totalSizeBytes / (1024 * 1024);
    }
  }

  private evictLRU(): void {
    let oldestKey: string | undefined;
    let oldestAccess = Infinity;

    this.cache.forEach((entry, key) => {
      if (entry.accessedAt < oldestAccess) {
        oldestAccess = entry.accessedAt;
        oldestKey = key;
      }
    });

    if (oldestKey) {
      this.delete(oldestKey);
      this.stats.evictions++;
    }
  }

  /**
   * Invalidate all entries for a given symbol (e.g., after new data ingestion).
   */
  invalidateSymbol(symbol: string): number {
    let removed = 0;
    const keysToDelete: string[] = [];
    this.cache.forEach((_entry, key) => {
      if (key.includes(`|${symbol}|`)) {
        keysToDelete.push(key);
      }
    });
    keysToDelete.forEach(key => {
      this.delete(key);
      removed++;
    });
    return removed;
  }

  /**
   * Clear expired entries proactively (called periodically).
   */
  cleanup(): number {
    const now = Date.now();
    let removed = 0;
    const keysToDelete: string[] = [];
    this.cache.forEach((entry, key) => {
      if (now - entry.createdAt > this.ttlMs) {
        keysToDelete.push(key);
      }
    });
    keysToDelete.forEach(key => {
      this.delete(key);
      removed++;
    });
    return removed;
  }

  clear(): void {
    this.cache.clear();
    this.totalSizeBytes = 0;
    this.stats = { hits: 0, misses: 0, entries: 0, sizeMB: 0, evictions: 0 };
  }

  getStats(): CacheStats & { hitRate: string } {
    const total = this.stats.hits + this.stats.misses;
    const hitRate = total > 0 ? ((this.stats.hits / total) * 100).toFixed(1) + '%' : 'N/A';
    return { ...this.stats, hitRate };
  }
}

// Also export the class for static method access (OHLCVCache.key())
export { OHLCVCache };

// Singleton instance
export const ohlcvCache = new OHLCVCache();

// Periodic cleanup every 60 seconds
setInterval(() => {
  ohlcvCache.cleanup();
}, 60_000);

/**
 * Cache-through helper: check cache first, call fetcher on miss, store result.
 */
export async function cachedQuery<T>(
  key: string,
  fetcher: () => Promise<T>
): Promise<T> {
  const cached = ohlcvCache.get<T>(key);
  if (cached !== undefined) return cached;

  const result = await fetcher();
  ohlcvCache.set(key, result);
  return result;
}
