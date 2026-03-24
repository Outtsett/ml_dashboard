import { LRUCache } from 'lru-cache';
import type { EventBus } from '../events/event-bus';
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
    return this.cache.get(key) as T | undefined;
  }

  set(key: string, value: CacheValue): void {
    this.cache.set(key, value);
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  getStats(): { size: number; maxSize: number } {
    return {
      size: this.cache.size,
      maxSize: this.cache.max,
    };
  }

  // ── Event-driven invalidation ─────────────────────────────

  private subscribeToEvents(): void {
    // TODO: Wire ingestion service to emit 'ingestion.completed' events
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

  private invalidateBySymbol(symbol: string): void {
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
