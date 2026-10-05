/**
 * Server-side LRU cache for OHLCV bar query results.
 *
 * Sits between the API routes and the database queries (lake, SQLite).
 * Cache keys encode symbol + timeframe + time window so identical scroll requests
 * are served from memory instead of re-querying 782M+ row tables.
 *
 * Design:
 *  - Max 500 entries, 200 MB hard cap
 *  - 60 min TTL per entry (historical OHLCV is immutable)
 *  - O(1) LRU eviction via lru-cache v11
 *  - Supports ohlcv, lake, and chart cache sources
 */

import { LRUCache } from 'lru-cache';

const DEFAULT_MAX_ENTRIES = 500;
const DEFAULT_TTL_MS = 60 * 60 * 1000; // 60 minutes
const MAX_SIZE_BYTES = 200 * 1024 * 1024; // 200 MB

// ── Stats (tracked separately since lru-cache doesn't track all of these) ──
interface CacheStats {
  hits: number;
  misses: number;
  entries: number;
  sizeMB: number;
  evictions: number;
}

type CacheValue = NonNullable<unknown>;

class OHLCVCache {
  private cache: LRUCache<string, CacheValue>;
  private stats: CacheStats = { hits: 0, misses: 0, entries: 0, sizeMB: 0, evictions: 0 };
  private totalSizeBytes = 0;

  constructor(maxEntries = DEFAULT_MAX_ENTRIES, ttlMs = DEFAULT_TTL_MS) {
    this.cache = new LRUCache<string, CacheValue>({
      max: maxEntries,
      ttl: ttlMs,
      maxSize: MAX_SIZE_BYTES,
      sizeCalculation: (value: CacheValue) => {
        // lru-cache rejects a size of 0 ("sizeCalculation return invalid"), and
        // an empty result set is a legitimate, cacheable answer — a symbol with
        // no bars in the requested window. Without the floor, caching [] threw
        // and the whole /api/charts/ohlcv request 500'd instead of returning [].
        if (!Array.isArray(value)) return 1024;
        return Math.max(1, value.length * 80);
      },
      dispose: (_value, _key, reason) => {
        if (reason === 'evict') {
          this.stats.evictions++;
        }
      },
    });
  }

  /**
   * Build a cache key from query parameters.
   * Key format: source|symbol|timeframe|startTime|endTime|limit|loadFromStart
   */
  static key(
    source: 'ohlcv' | 'lake' | 'chart',
    symbol: string,
    timeframe: number | string,
    opts?: {
      startTime?: number;
      endTime?: number;
      limit?: number;
      loadFromStart?: boolean;
      extra?: string;
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
      opts?.extra ?? '',
    ];
    return parts.join('|');
  }

  get<T>(key: string): T | undefined {
    const value = this.cache.get(key) as T | undefined;
    if (value !== undefined) {
      this.stats.hits++;
    } else {
      this.stats.misses++;
    }
    this.updateSizeStats();
    return value;
  }

  set(key: string, data: CacheValue): void {
    this.cache.set(key, data);
    this.updateSizeStats();
  }

  /**
   * Invalidate all entries for a given symbol (e.g., after new data ingestion).
   */
  invalidateSymbol(symbol: string): number {
    let removed = 0;
    const pattern = `|${symbol}|`;
    const keysToDelete: string[] = [];

    for (const key of this.cache.keys()) {
      if (key.includes(pattern)) {
        keysToDelete.push(key);
      }
    }
    for (const key of keysToDelete) {
      this.cache.delete(key);
      removed++;
    }
    this.updateSizeStats();
    return removed;
  }

  clear(): void {
    this.cache.clear();
    this.totalSizeBytes = 0;
    this.stats = { hits: 0, misses: 0, entries: 0, sizeMB: 0, evictions: 0 };
  }

  getStats(): CacheStats & { hitRate: string } {
    this.updateSizeStats();
    const total = this.stats.hits + this.stats.misses;
    const hitRate = total > 0 ? ((this.stats.hits / total) * 100).toFixed(1) + '%' : 'N/A';
    return { ...this.stats, hitRate };
  }

  private updateSizeStats(): void {
    this.stats.entries = this.cache.size;
    this.totalSizeBytes = this.cache.calculatedSize ?? 0;
    this.stats.sizeMB = this.totalSizeBytes / (1024 * 1024);
  }
}

// Also export the class for static method access (OHLCVCache.key())
export { OHLCVCache };

// Singleton instance
export const ohlcvCache = new OHLCVCache();

// lru-cache v11 handles TTL expiry automatically — no periodic cleanup needed

/**
 * Queries already running, keyed the same way as the cache.
 *
 * A cache lookup and the `set` that follows it are separated by the whole
 * duration of the query, and every caller arriving in that window used to see
 * a miss and start its own. For the cheap keys that only wasted work; for the
 * front-month stitch it was an outage. That query scans `ohlcv` — 863M rows,
 * DAY-partitioned across 2010-2026, with no timestamp predicate, so it reads
 * every partition and takes 13-49s. Overlapping chart requests each held a
 * lake reader for that long, the reader pool ran out, and lake started
 * answering `table busy [reason=pool size exceeded]`. One session logged 93
 * executions of a query whose result is cached for 60 minutes.
 */
const inFlight = new Map<string, Promise<CacheValue>>();

/**
 * Cache-through helper: check cache first, call fetcher on miss, store result.
 *
 * Concurrent misses on the same key share a single fetch.
 */
export async function cachedQuery<T extends CacheValue>(
  key: string,
  fetcher: () => Promise<T>
): Promise<T> {
  const cached = ohlcvCache.get<T>(key);
  if (cached !== undefined) return cached;

  const running = inFlight.get(key);
  if (running !== undefined) return running as Promise<T>;

  // Registered before the first await so a caller arriving later in this same
  // tick joins this query rather than starting another.
  const pending = (async () => {
    const result = await fetcher();
    // An empty result is a legitimate answer — a symbol with no bars in the
    // window — and is cached like any other, so a data gap does not turn into
    // a retry storm against the same 863M-row scan.
    ohlcvCache.set(key, result);
    return result;
  })();

  inFlight.set(key, pending);
  try {
    return await pending;
  } finally {
    // Cleared on failure too: a transient timeout must not leave a rejected
    // promise parked here, which would make the key permanently unqueryable.
    inFlight.delete(key);
  }
}

