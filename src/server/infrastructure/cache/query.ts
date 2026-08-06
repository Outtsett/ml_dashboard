import { LRUCache } from 'lru-cache';
import type { EventBus } from '../events/event-bus';
import { getEventBus } from '../events/event-bus';
import type { DomainEvent } from '@shared/event-types';

// ── Default config ──────────────────────────────────────────
const DEFAULTS = {
  max: 500,
  ttl: 5 * 60 * 1000, // 5 minutes
} as const;

// ── Cache value type (lru-cache v11 requires V extends {}) ──
type CacheValue = NonNullable<unknown>;

// ── QueryCache ──────────────────────────────────────────────
export class QueryCache {
  private cache: LRUCache<string, CacheValue>;
  private bus: EventBus;
  private hits = 0;
  private misses = 0;

  constructor(eventBus: EventBus, options?: { max: number; ttl: number }) {
    this.bus = eventBus;
    this.cache = new LRUCache<string, CacheValue>({
      max: options?.max ?? DEFAULTS.max,
      ttl: options?.ttl ?? DEFAULTS.ttl,
    });

    this.subscribeToEvents();
  }

  // ── Public API ────────────────────────────────────────────

  get<T>(key: string): T | undefined {
    const value = this.cache.get(key) as T | undefined;
    if (value !== undefined) {
      this.hits++;
    } else {
      this.misses++;
    }
    return value;
  }

  set(key: string, value: CacheValue): void {
    this.cache.set(key, value);
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  getStats(): { hits: number; misses: number; entries: number; hitRate: string; maxSize: number } {
    const total = this.hits + this.misses;
    const hitRate = total > 0 ? ((this.hits / total) * 100).toFixed(1) + '%' : '0.0%';
    return {
      hits: this.hits,
      misses: this.misses,
      entries: this.cache.size,
      hitRate,
      maxSize: this.cache.max,
    };
  }

  // ── Event-driven invalidation ─────────────────────────────

  private subscribeToEvents(): void {
    // ingestion.completed -> invalidate all keys containing `:${symbol}:`
    this.bus.on('ingestion.completed', (event: DomainEvent) => {
      if (event.type !== 'ingestion.completed') return;
      const { symbol } = event.data;
      this.invalidateBySymbol(symbol);
    });

    // model.** -> invalidate keys starting with 'models:'
    this.bus.on('model.**', () => {
      this.invalidateByPrefix('models:');
    });

    // training.** -> invalidate keys starting with 'training:'
    this.bus.on('training.**', () => {
      this.invalidateByPrefix('training:');
    });
  }

  /** Invalidate all cache entries containing `:symbol:` in their key. */
  invalidateBySymbol(symbol: string): void {
    const pattern = `:${symbol}:`;
    const invalidatedPrefixes = new Set<string>();

    for (const key of this.cache.keys()) {
      if (key.includes(pattern)) {
        const prefix = key.split(':')[0];
        if (prefix) invalidatedPrefixes.add(prefix);
        this.cache.delete(key);
      }
    }

    if (invalidatedPrefixes.size > 0) {
      this.bus.emit({
        type: 'cache.invalidate',
        data: { keys: [...invalidatedPrefixes] },
        metadata: {
          correlationId: `cache-inv-${Date.now()}`,
          causationId: `ingestion-${symbol}`,
          timestamp: Date.now(),
        },
      });
    }
  }

  private invalidateByPrefix(prefix: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
  }
}

// ── Singleton ────────────────────────────────────────────────
let queryCacheInstance: QueryCache | null = null;

/** Get or create the global QueryCache singleton (lazy, wired to EventBus). */
export function getQueryCache(): QueryCache {
  if (!queryCacheInstance) {
    queryCacheInstance = new QueryCache(getEventBus());
  }
  return queryCacheInstance;
}
