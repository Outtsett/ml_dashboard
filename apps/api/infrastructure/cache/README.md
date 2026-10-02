# Cache — 7-Layer Server Cache

Unified server-side cache layer. All 7 caches are instrumented with hit/miss counters and support event-driven invalidation via the typed event bus.

## Caches

| Module | Type | TTL | Capacity | Invalidation Trigger |
|---|---|---|---|---|
| `ohlcv.ts` | LRU | 60 min | 500 entries, 200MB cap | Ingestion events |
| `query.ts` | LRU | 5 min | Event-driven | Ingestion, model, training events |
| `anchor.ts` | Per-symbol | 5 min | Per chart | Ingestion events |
| `symbols.ts` | Catalog | 1 hr | Full catalog | Warm on startup |
| `model.ts` | LRU | Until retired | 100 entries | `model.retired` event |
| `labels.ts` | LRU | 15 min | 50 entries | Ingestion events |
| `parquet.ts` | Disk | 24 hr stale | 2GB cap | LRU eviction, 10 min periodic cleanup |

## Files

| File | Purpose |
|---|---|
| `index.ts` | Barrel exports + `clearAllCaches()` + `getCacheStats()` |
| `headers.ts` | HTTP `Cache-Control` middleware (`CACHE_STATIC`, `CACHE_SEMI`) + ETags |

## Architecture

All caches subscribe to typed events from the event bus. When new data is ingested, models are updated, or training completes, relevant caches auto-invalidate. Cache stats are exposed via `GET /api/databases/cache-stats`.

The `parquet.ts` cache manages disk-based parquet files in `data/.cache/` with a 2GB cap and LRU eviction strategy.
