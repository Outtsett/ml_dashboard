# Cache Layer Architecture

## 1. Cache Layer Overview

```
Browser ─── HTTP Cache Headers ───► Express Server
              (Cache-Control)           │
                                        ├── OHLCV Cache ──────────► QuestDB (ohlcv, 759M+ rows)
                                        ├── Query Cache ──────────► QuestDB (general queries)
                                        ├── Anchor Cache ─────────► QuestDB (max timestamp per symbol)
                                        ├── Symbol Catalog Cache ─► QuestDB (symbols table, 904 rows)
                                        ├── QuestDB Health Cache ─► QuestDB (health check)
                                        ├── Model Results Cache ──► Disk (diagnostics.json, convergence.json, assignments.csv)
                                        ├── Label Preview Cache ──► QuestDB (CTE-based label SQL)
                                        └── Parquet Cache ────────► Disk (data/.cache/*.parquet + *.json sidecars)

Ingestion Pipeline ──► EventBus ──► ingestion.completed ──► Invalidation cascade
```

## 2. Cache Inventory

| # | Name | File | Type | Storage | Max Size | TTL | Eviction | Instrumented |
|---|------|------|------|---------|----------|-----|----------|--------------|
| 1 | **OHLCV Cache** | `src/server/lib/ohlcvCache.ts` | In-memory LRU | `Map<string, CacheEntry>` | 500 entries / 200 MB | 60 min | LRU + size cap | Y (hits/misses/evictions/sizeMB) |
| 2 | **Query Cache** | `src/server/cache/query-cache.ts` | In-memory LRU | `lru-cache` v11 | 500 entries | 5 min | LRU (built-in) | Y (hits/misses/entries/hitRate) |
| 3 | **Anchor Cache** | `src/server/routes/charts.ts` (inline) | In-memory TTL map | `Map<string, {value, expiry}>` | 200 entries | 5 min | Oldest-expiry eviction | N |
| 4 | **Symbol Catalog Cache** | `src/server/routes/charts.ts` (inline) | Single-value TTL | `{data, expiry}` variable | 1 entry (~904 symbols) | 60 min | Full replace | N |
| 5 | **QuestDB Health Cache** | `src/server/routes/charts.ts` (inline) | Single-value TTL | `boolean` variable | 1 entry | 10 sec | Full replace | N |
| 6 | **Model Results Cache** | `src/server/lib/modelResults.ts` | In-memory LRU | `Map<string, ModelCacheEntry>` | 100 entries | None (immutable data) | LRU | N |
| 7 | **Label Preview Cache** | `src/server/lib/labels/labelPreview.ts` | In-memory LRU + TTL | `Map<string, PreviewCacheEntry>` | 50 entries | 15 min | LRU + TTL check on read | N |
| 8 | **Parquet Cache** | `src/server/lib/parquetCache.ts` | Disk (Python pipeline) | `data/.cache/*.parquet` + `*.json` | Unbounded | None (invalidated on ingestion) | Symbol-scoped delete | N |

**HTTP Cache Headers** (not a server cache, but part of the caching strategy):

| Constant | File | `Cache-Control` | Applied To |
|----------|------|------------------|------------|
| `CACHE_STATIC` | `src/server/lib/cacheHeaders.ts` | `public, max-age=3600` | Instrument catalog, rarely-changing data |
| `CACHE_SEMI` | `src/server/lib/cacheHeaders.ts` | `public, max-age=300` | Symbol list, training config, health |

## 3. Data Flow Paths

### Chart Rendering (`GET /api/charts/ohlcv`)
```
1. QuestDB Health Cache ── hit? return cached boolean
                           miss? → checkQuestDBHealth() → cache 10s
2. Anchor Cache ────────── hit? return cached max(timestamp)
                           miss? → SELECT max(timestamp) FROM ohlcv → cache 5min
                           (anchor change invalidates OHLCV entries for that symbol)
3. OHLCV Cache ─────────── hit? return cached bar array
                           miss? → getOHLCVSampleBy() or getStitchedOHLCV() → cache 60min
                           (empty arrays are NOT cached — prevents caching transient failures)
```

### Symbol List (`GET /api/charts/symbols`)
```
1. QuestDB Health Cache ── (same as above)
2. Symbol Catalog Cache ── hit? return cached array (904 symbols)
                           miss? → SELECT symbol, asset_class, root FROM symbols → cache 60min
3. HTTP Cache-Control ──── CACHE_SEMI (5 min browser cache)
```

### Training Data (Python ML pipeline)
```
1. Parquet Cache ──── hit? Python reads data/.cache/{hash}.parquet directly
                     miss? → feature_extract.py computes indicators → writes .parquet + .json sidecar
```

### Label Generation (`POST /api/labels/preview`)
```
1. Label Preview Cache ── hit? return cached label array
                          miss? → generateLabelSQL() → queryLabels() against QuestDB → cache 15min
```

### Model Results (`GET /api/training/models/:id/diagnostics`)
```
1. Model Results Cache ── hit? return cached diagnostics/convergence/assignments
                          miss? → read diagnostics.json / convergence.json / assignments.csv from disk → cache (no TTL)
                          (model data is immutable after training — safe to cache indefinitely)
```

### General Queries (via QueryCache)
```
1. Query Cache ── hit? return cached result
                  miss? → execute QuestDB query → cache 5min
                  (event-driven invalidation via EventBus subscriptions)
```

## 4. Invalidation Strategy

### Event-Driven Invalidation (ingestion.completed)

```
New data uploaded
        │
        ▼
uploadProcessor.ts
        │
        ├──► ohlcvCache.invalidateSymbol(symbol)     [OHLCV Cache: remove all entries for symbol]
        ├──► clearParquetCacheForSymbol(symbol)       [Parquet Cache: delete .parquet + .json for symbol]
        └──► EventBus.emit('ingestion.completed')
                    │
                    ▼
             QueryCache.subscribeToEvents()
                    │
                    └──► invalidateBySymbol(symbol)   [Query Cache: remove keys containing :symbol:]
```

**Anchor Cache cascade**: When `setCachedAnchor()` detects the anchor timestamp changed for a symbol, it calls `ohlcvCache.invalidateSymbol(symbol)` to flush stale time-windowed entries.

### Event-Driven Invalidation (model/training events)

| Event Pattern | QueryCache Action |
|---------------|-------------------|
| `model.**` | Invalidate all keys starting with `models:` |
| `training.**` | Invalidate all keys starting with `training:` |

### Time-Based Expiry

| Cache | Mechanism |
|-------|-----------|
| OHLCV Cache | TTL checked on `get()` + periodic `cleanup()` every 60s via `setInterval` |
| Query Cache | Built-in `lru-cache` TTL (auto-evicts expired entries) |
| Anchor Cache | Expiry checked on `get()`; stale entries deleted on read |
| Symbol Catalog | Expiry checked on request; refetched if past TTL |
| QuestDB Health | Timestamp-based; re-checked if >10s since last check |
| Label Preview | TTL checked on `get()`; expired entries deleted on read |
| Model Results | No TTL (data is immutable after training) |
| Parquet Cache | No TTL (invalidated only by ingestion events) |

### Manual Invalidation (API Endpoints)

| Endpoint | Method | Action |
|----------|--------|--------|
| `/api/cache/stats` | GET | Returns stats for OHLCV Cache + Query Cache |
| `/api/cache/clear` | POST | Clears OHLCV Cache + Anchor Cache + Symbol Catalog Cache |
| `/api/cache/invalidate/:symbol` | POST | Calls `ohlcvCache.invalidateSymbol(symbol)`, returns count of removed entries |

## 5. Cache Management API

### `GET /api/cache/stats`

Response:
```json
{
  "ohlcv": {
    "hits": 1234,
    "misses": 56,
    "entries": 142,
    "sizeMB": 18.3,
    "evictions": 7,
    "hitRate": "95.6%"
  },
  "query": {
    "hits": 890,
    "misses": 45,
    "entries": 67,
    "hitRate": "95.2%",
    "maxSize": 500
  }
}
```

### `POST /api/cache/clear`

Clears: OHLCV Cache, Anchor Cache, Symbol Catalog Cache.

Does NOT clear: Query Cache, Model Results Cache, Label Preview Cache, Parquet Cache.

Response:
```json
{ "message": "All caches cleared (OHLCV, anchor, symbols catalog)" }
```

### `POST /api/cache/invalidate/:symbol`

Invalidates OHLCV Cache entries matching the symbol.

Does NOT cascade to: Query Cache (use EventBus for that), Parquet Cache, or other caches.

Response:
```json
{ "symbol": "ES", "entriesRemoved": 12 }
```

## 6. Cache Warming

On server startup (`main.ts` → `httpServer.listen` callback):

```
warmSymbolsCatalog()  [fire-and-forget]
    │
    ├── checkQuestDBHealth()
    │     └── if unhealthy → skip, log warning
    │
    └── SELECT symbol, asset_class, root FROM symbols
          └── populate symbolsCatalogCache (904 symbols, 60-min TTL)
```

No other caches are pre-warmed. OHLCV, Anchor, Query, Model, Label, and Parquet caches populate lazily on first request.

## 7. Configuration

| Constant | Cache | Value | Location | Rationale |
|----------|-------|-------|----------|-----------|
| `DEFAULT_MAX_ENTRIES` | OHLCV | 500 | `ohlcvCache.ts:30` | ~2000 bars x 80 bytes x 500 = ~80 MB typical |
| `DEFAULT_TTL_MS` | OHLCV | 3,600,000 (60 min) | `ohlcvCache.ts:31` | Historical OHLCV is immutable; aggressive caching safe |
| `MAX_SIZE_MB` | OHLCV | 200 MB | `ohlcvCache.ts:32` | Hard memory cap prevents unbounded growth |
| `DEFAULTS.max` | Query | 500 | `query-cache.ts:8` | General-purpose query results |
| `DEFAULTS.ttl` | Query | 300,000 (5 min) | `query-cache.ts:9` | Balances freshness vs. QuestDB load |
| `ANCHOR_TTL_MS` | Anchor | 300,000 (5 min) | `charts.ts:71` | max(timestamp) changes only on ingestion |
| `ANCHOR_MAX_ENTRIES` | Anchor | 200 | `charts.ts:72` | One entry per actively-viewed symbol |
| `SYMBOLS_CATALOG_TTL_MS` | Symbol Catalog | 3,600,000 (60 min) | `charts.ts:237` | Symbol table rarely changes |
| `HEALTH_CHECK_INTERVAL_MS` | QuestDB Health | 10,000 (10 sec) | `charts.ts:113` | Avoid hammering health check on every request |
| `MODEL_CACHE_MAX` | Model Results | 100 | `modelResults.ts:23` | Disk I/O avoidance; model files are immutable |
| `PREVIEW_CACHE_MAX` | Label Preview | 50 | `labelPreview.ts:19` | Label previews are expensive SQL CTEs |
| `PREVIEW_CACHE_TTL_MS` | Label Preview | 900,000 (15 min) | `labelPreview.ts:20` | Underlying OHLCV data changes infrequently |
| `CACHE_STATIC` | HTTP | `max-age=3600` | `cacheHeaders.ts:18` | Instruments, indicator catalog |
| `CACHE_SEMI` | HTTP | `max-age=300` | `cacheHeaders.ts:21` | Symbol list, training config |
| Cleanup interval | OHLCV | 60,000 (60 sec) | `ohlcvCache.ts:208` | Proactive expired entry removal |

## 8. Known Limitations

### Not Cached
- Individual QuestDB queries outside the `cachedQuery()` wrapper (direct `queryQuestDB()` calls)
- Training session lists (`listTrainedModels` re-reads all `diagnostics.json` files every call)
- Feature computation results in the Node.js layer (only cached in Python's Parquet pipeline)
- Label generation (full generation, not preview) results

### Stale Data Scenarios
- **Anchor Cache vs. live ingestion**: If data is ingested for a symbol while the anchor is cached, chart requests may use a stale time window for up to 5 minutes. The OHLCV data itself is fresh (invalidated immediately), but the anchor-derived time window may be too narrow to include newly ingested data.
- **`POST /api/cache/clear` is incomplete**: Does not clear Query Cache, Model Results Cache, Label Preview Cache, or Parquet Cache. A full cache reset requires: (1) `POST /api/cache/clear`, (2) manually clearing the other caches (no endpoint exists).
- **`POST /api/cache/invalidate/:symbol` is incomplete**: Only invalidates OHLCV Cache. Does not propagate to Query Cache, Anchor Cache, or Parquet Cache. The EventBus `ingestion.completed` path is the only way to cascade across OHLCV + Query + Parquet caches.
- **Label Preview Cache has no invalidation on ingestion**: If new data is ingested for a symbol, stale label previews persist for up to 15 minutes.
- **HTTP Cache-Control headers are independent**: Even after server-side cache invalidation, browsers may serve stale responses until the `max-age` expires (5 min for CACHE_SEMI, 60 min for CACHE_STATIC).

### Memory Growth Risks
- **Parquet Cache (disk)**: Unbounded. No max-size or max-age cleanup. Files accumulate in `data/.cache/` until explicitly cleared by ingestion or manual deletion.
- **OHLCV Cache**: Bounded by both entry count (500) and size (200 MB). The size estimate is heuristic (`array.length * 80`), not exact — actual memory usage may exceed the 200 MB cap.
- **Model Results Cache**: No TTL. 100-entry cap is safe, but entries for deleted models persist until evicted by LRU pressure.
- **Anchor Cache / Symbol Catalog / Health Cache**: Negligible memory footprint (200 entries, 1 entry, 1 boolean).

### Structural Gaps
- 4 of 8 caches lack instrumentation (no hit/miss tracking): Anchor, Symbol Catalog, Health, Label Preview, Model Results, Parquet.
- No unified cache stats endpoint — `/api/cache/stats` only reports OHLCV and Query caches.
- No unified clear endpoint — `/api/cache/clear` misses Query, Model, Label, and Parquet caches.
- Label Preview Cache and Model Results Cache have no invalidation API endpoints.
