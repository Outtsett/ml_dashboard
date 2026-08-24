import { describe, it, expect, beforeEach } from 'vitest';
import type { DomainEvent, IngestionEvent, ModelEvent, TrainingEvent, CacheEvent } from '../src/shared/event-types';
import { EventBus, resetEventBus } from '../src/server/infrastructure/events/event-bus';
import { QueryCache } from '../src/server/infrastructure/cache/query';

// ── Helpers ──────────────────────────────────────────────────
function makeEvent<T extends DomainEvent>(
  overrides: Omit<T, 'metadata'> & Partial<Pick<T, 'metadata'>>,
): T {
  return {
    ...overrides,
    metadata: overrides.metadata ?? {
      correlationId: 'cor-1',
      causationId: 'cau-1',
      timestamp: Date.now(),
    },
  } as T;
}

describe('QueryCache', () => {
  let bus: EventBus;
  let cache: QueryCache;

  beforeEach(() => {
    resetEventBus();
    bus = new EventBus();
    cache = new QueryCache(bus, { max: 100, ttl: 60_000 });
  });

  // ── 1. Cache and retrieve values ──────────────────────────
  it('should cache and retrieve values', () => {
    cache.set('charts:ES:1h', { candles: [1, 2, 3] });
    cache.set('indicators:ES:rsi', { values: [50, 60] });

    expect(cache.get<{ candles: number[] }>('charts:ES:1h')).toEqual({ candles: [1, 2, 3] });
    expect(cache.get<{ values: number[] }>('indicators:ES:rsi')).toEqual({ values: [50, 60] });
  });

  // ── 2. Return undefined for missing keys ──────────────────
  it('should return undefined for missing keys', () => {
    expect(cache.get('nonexistent:key')).toBeUndefined();
  });

  // ── 3. Invalidate keys matching symbol on ingestion.completed ──
  it('should invalidate cache keys containing the symbol on ingestion.completed', () => {
    cache.set('charts:ES:1h', { candles: [1, 2, 3] });
    cache.set('charts:ES:5m', { candles: [4, 5, 6] });
    cache.set('indicators:ES:rsi', { values: [50] });
    cache.set('charts:NQ:1h', { candles: [7, 8, 9] });
    cache.set('models:lstm-v1', { accuracy: 0.95 });

    bus.emit(makeEvent<IngestionEvent>({
      type: 'ingestion.completed',
      data: { uploadId: 'u-1', symbol: 'ES', timeframe: '1h', rowCount: 500 },
    }));

    // ES keys invalidated
    expect(cache.get('charts:ES:1h')).toBeUndefined();
    expect(cache.get('charts:ES:5m')).toBeUndefined();
    expect(cache.get('indicators:ES:rsi')).toBeUndefined();

    // NQ key untouched
    expect(cache.get('charts:NQ:1h')).toEqual({ candles: [7, 8, 9] });

    // models key untouched (no symbol match)
    expect(cache.get('models:lstm-v1')).toEqual({ accuracy: 0.95 });
  });

  // ── 3b. Invalidate keys starting with 'models:' on model.* ──
  it('should invalidate model keys on model.* events', () => {
    cache.set('models:lstm-v1', { accuracy: 0.95 });
    cache.set('models:transformer-v2', { accuracy: 0.92 });
    cache.set('charts:ES:1h', { candles: [1, 2, 3] });

    bus.emit(makeEvent<ModelEvent>({
      type: 'model.registered',
      data: { modelId: 'm-1', name: 'lstm-v3', metrics: { sharpe: 1.5 } },
    }));

    expect(cache.get('models:lstm-v1')).toBeUndefined();
    expect(cache.get('models:transformer-v2')).toBeUndefined();
    // Non-model keys untouched
    expect(cache.get('charts:ES:1h')).toEqual({ candles: [1, 2, 3] });
  });

  // ── 3c. Invalidate keys starting with 'training:' on training.* ──
  it('should invalidate training keys on training.* events', () => {
    cache.set('training:session-1:metrics', { loss: 0.5 });
    cache.set('training:session-2:metrics', { loss: 0.3 });
    cache.set('charts:ES:1h', { candles: [1, 2, 3] });

    bus.emit(makeEvent<TrainingEvent>({
      type: 'training.epoch.completed',
      data: { sessionId: 's-1', epoch: 5, metrics: { loss: 0.4 } },
    }));

    expect(cache.get('training:session-1:metrics')).toBeUndefined();
    expect(cache.get('training:session-2:metrics')).toBeUndefined();
    // Non-training keys untouched
    expect(cache.get('charts:ES:1h')).toEqual({ candles: [1, 2, 3] });
  });

  // ── 4. Emit cache.invalidate event to bus ─────────────────
  it('should emit cache.invalidate event with invalidated key prefixes', () => {
    const emitted: DomainEvent[] = [];
    bus.on('cache.invalidate', (e: DomainEvent) => emitted.push(e));

    cache.set('charts:ES:1h', { candles: [1, 2, 3] });
    cache.set('indicators:ES:rsi', { values: [50] });
    cache.set('charts:NQ:1h', { candles: [7, 8, 9] });

    bus.emit(makeEvent<IngestionEvent>({
      type: 'ingestion.completed',
      data: { uploadId: 'u-1', symbol: 'ES', timeframe: '1h', rowCount: 500 },
    }));

    expect(emitted).toHaveLength(1);
    expect(emitted[0]!.type).toBe('cache.invalidate');

    if (emitted[0]!.type === 'cache.invalidate') {
      const keys = (emitted[0] as CacheEvent).data.keys;
      // Should contain the prefixes of invalidated keys
      expect(keys).toContain('charts');
      expect(keys).toContain('indicators');
      // Should NOT contain NQ prefixes since NQ wasn't invalidated
      expect(keys).not.toContain('models');
    }
  });

  // ── 5. Report stats ───────────────────────────────────────
  it('should report accurate stats', () => {
    expect(cache.getStats()).toEqual({ hits: 0, misses: 0, entries: 0, hitRate: '0.0%', maxSize: 100 });

    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);

    expect(cache.getStats()).toEqual({ hits: 0, misses: 0, entries: 3, hitRate: '0.0%', maxSize: 100 });
  });

  // ── 6. delete() removes a specific key ────────────────────
  it('should delete a specific key', () => {
    cache.set('key1', 'value1');
    cache.set('key2', 'value2');

    cache.delete('key1');

    expect(cache.get('key1')).toBeUndefined();
    expect(cache.get('key2')).toBe('value2');
  });

  // ── 7. clear() removes all entries ────────────────────────
  it('should clear all entries', () => {
    cache.set('a', 1);
    cache.set('b', 2);

    cache.clear();

    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBeUndefined();
    expect(cache.getStats().entries).toBe(0);
  });
});
