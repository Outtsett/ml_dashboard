# Cache Layer Architecture

## 1. Overview

```
Browser ─── HTTP Cache Headers ───► Express Server
              (Cache-Control)           │
                                        ├── OHLCV Cache ──────────► Lake (ohlcv, 782M+ rows)
                                        ├── Query Cache ──────────► Lake (general queries)
                                        ├── Anchor Cache ─────────► Lake (max timestamp per symbol)
                                        ├── Symbol Catalog Cache ─► Lake (symbols table, 904 rows)
                                        ├── Model Results Cache ──► Disk (diagnostics.json, convergence.json, assignments.csv)
                                        ├── Label Preview Cache ──► Lake (CTE-based label SQL)
                                        └── Parquet Cache ────────► Disk (data/.cache/*.parquet + *.json sidecars)

Ingestion Pipeline ──► EventBus ──► ingestion.completed ──► Invalidation cascade
```

## 2. Cache Inventory

| # | Name | File | Type | Max Size | TTL | Eviction | Instrumented | Event Invalidation |
|---|------|------|------|----------|-----|----------|-------------|-------------------|
| 1 | **OHLCV Cache** | `cache/ohlcv.ts` | In-memory LRU | 500 entries / 200 MB | 60 min | LRU + size cap + periodic cleanup (60s) | Y | `ingestion.completed` (via uploadProcessor) |
| 2 | **Query Cache** | `cache/query.ts` | In-memory LRU | 500 entries | 5 min | LRU (`lru-cache` v11) | Y | `ingestion.completed`, `model.**`, `training.**` |
| 3 | **Anchor Cache** | `cache/anchor.ts` | In-memory TTL map | 200 entries | 5 min | Oldest-expiry | Y | `ingestion.completed` |
| 4 | **Symbol Catalog Cache** | `cache/symbols.ts` | Single-value TTL | 1 entry (~904 symbols) | 60 min | Full replace | Y | None |
| 5 | **Model Results Cache** | `cache/model.ts` | In-memory LRU | 100 entries | None (immutable) | LRU | Y | `model.retired` |
| 6 | **Label Preview Cache** | `cache/labels.ts` | In-memory LRU + TTL | 50 entries | 15 min | LRU + TTL check on read | Y | `ingestion.completed` |
| 7 | **Parquet Cache** | `cache/parquet.ts` + Python | Disk | 2 GB cap | 24h (stale files deleted) | Oldest-file eviction + periodic cleanup (10 min) | Y | `ingestion.completed` (symbol-scoped) |

**HTTP Cache Headers** (browser-side, not a server cache):

| Constant | File | `Cache-Control` | Applied To |
|----------|------|------------------|------------|
| `CACHE_STATIC` | `cache/headers.ts` | `public, max-age=3600` | Instrument catalog, rarely-changing data |
| `CACHE_SEMI` | `cache/headers.ts` | `public, max-age=300` | Symbol list, training config, health |

## 3. Data Flow Paths

### Chart Rendering (`GET /api/charts/ohlcv`)
```
1. Lake Health ────── cached boolean (10s TTL)
2. Anchor Cache ──── cached max(timestamp) per symbol (5 min TTL)
                     anchor change cascades OHLCV invalidation
3. OHLCV Cache ───── cached bar arrays (60 min TTL)
                     empty arrays cached with short 5-min TTL (prevents retry storms on data gaps)
```

### Symbol List (`GET /api/charts/symbols`)
```
1. Symbol Catalog Cache ── cached array, 904 symbols (60 min TTL, warmed on startup)
2. HTTP Cache-Control ──── CACHE_SEMI (5 min browser cache)
```

### Training Data (Python ML pipeline)
```
1. Parquet Cache ──── Python reads data/.cache/{hash}.parquet (24h max age)
                     miss → feature_extract.py computes indicators → saves .parquet + .json sidecar
                     stale files proactively deleted on read
```

### Label Preview (`POST /api/labels/preview`)
```
1. Label Preview Cache ── cached label results (15 min TTL)
                          miss → generateLabelSQL() → queryLabels() → cache result
```

### Model Results (`GET /api/training/models/:id/diagnostics`)
```
1. Model Results Cache ── cached diagnostics/convergence/assignments (no TTL, immutable)
                          miss → read from disk → cache indefinitely
```

### General Queries (via QueryCache)
```
1. Query Cache ── cached results (5 min TTL)
                  event-driven invalidation via EventBus subscriptions
```

## 4. Invalidation Strategy

### Event-Driven Invalidation (`ingestion.completed`)

```
New data uploaded
        │
        ▼
uploadProcessor.ts
        │
        ├──► ohlcvCache.invalidateSymbol(symbol)      [OHLCV: remove entries for symbol]
        ├──► clearParquetCacheForSymbol(symbol)        [Parquet: delete .parquet + .json for symbol]
        └──► EventBus.emit('ingestion.completed')
                    │
                    ├──► QueryCache ── invalidateBySymbol()  [Query: remove keys containing :symbol:]
                    ├──► AnchorCache ── invalidateAnchorForSymbol()  [Anchor: remove symbol entry]
                    └──► LabelPreviewCache ── invalidatePreviewCacheForSymbol()  [Labels: remove symbol entries]
```

### Event-Driven Invalidation (model/training events)

| Event Pattern | Cache Action |
|---------------|-------------|
| `model.**` | QueryCache invalidates keys starting with `models:` |
| `model.retired` | ModelResultsCache clears entries for the retired model ID |
| `training.**` | QueryCache invalidates keys starting with `training:` |

### Time-Based Expiry

| Cache | Mechanism |
|-------|-----------|
| OHLCV Cache | TTL checked on `get()` + periodic `cleanup()` every 60s via `setInterval` |
| Query Cache | Built-in `lru-cache` TTL (auto-evicts expired entries) |
| Anchor Cache | Expiry checked on `get()`; stale entries deleted on read |
| Symbol Catalog | Expiry checked on request; refetched if past TTL |
| Label Preview | TTL checked on `get()`; expired entries deleted on read |
| Model Results | No TTL (data is immutable after training) |
| Parquet Cache | 24h max age; stale files deleted on Python read + periodic cleanup every 10 min |

### Manual Invalidation (API Endpoints)

| Endpoint | Method | Action |
|----------|--------|--------|
| `/api/cache/stats` | GET | Returns stats for all 7 server-side caches |
| `/api/cache/clear` | POST | Clears all 7 caches (OHLCV, query, anchor, symbols, model, labels, parquet) |
| `/api/cache/invalidate/:symbol` | POST | Cascades to all symbol-scoped caches (OHLCV, query, anchor, labels, parquet) |

## 5. Cache Management API

### `GET /api/cache/stats`

Response includes stats for all caches: `ohlcv`, `query`, `anchor`, `symbols`, `model`, `labels`, `parquet`.

Each cache reports: `hits`, `misses`, `entries`, `hitRate`, plus cache-specific fields (e.g., `sizeMB` for OHLCV, `totalSizeMB` for parquet).

### `POST /api/cache/clear`

Clears all 7 server-side caches. Resets stats counters.

### `POST /api/cache/invalidate/:symbol`

Invalidates all symbol-scoped caches: OHLCV, Query, Anchor, Labels, Parquet.

Response:
```json
{
  "symbol": "ES",
  "invalidated": ["ohlcv", "query", "anchor", "labels", "parquet"],
  "ohlcvEntriesRemoved": 12,
  "parquetFilesRemoved": 2
}
```

## 6. Cache Warming

On server startup (`main.ts` → `httpServer.listen` callback):

```
warmSymbolsCatalog()  [fire-and-forget]
    │
    ├── checklakeHealth()   [market-data health; name pending the src/server port]
    │     └── if unhealthy → skip, log warning
    │
    └── SELECT symbol, asset_class, root FROM symbols
          └── populate symbolsCatalogCache (904 symbols, 60-min TTL)
```

All other caches populate lazily on first request.

## 7. Configuration

| Constant | Cache | Value | File |
|----------|-------|-------|------|
| `DEFAULT_MAX_ENTRIES` | OHLCV | 500 | `cache/ohlcv.ts` |
| `DEFAULT_TTL_MS` | OHLCV | 3,600,000 (60 min) | `cache/ohlcv.ts` |
| `MAX_SIZE_MB` | OHLCV | 200 MB | `cache/ohlcv.ts` |
| `DEFAULTS.max` | Query | 500 | `cache/query.ts` |
| `DEFAULTS.ttl` | Query | 300,000 (5 min) | `cache/query.ts` |
| `ANCHOR_TTL_MS` | Anchor | 300,000 (5 min) | `cache/anchor.ts` |
| `ANCHOR_MAX_ENTRIES` | Anchor | 200 | `cache/anchor.ts` |
| `SYMBOLS_CATALOG_TTL_MS` | Symbols | 3,600,000 (60 min) | `cache/symbols.ts` |
| `MODEL_CACHE_MAX` | Model Results | 100 | `cache/model.ts` |
| `PREVIEW_CACHE_MAX` | Label Preview | 50 | `cache/labels.ts` |
| `PREVIEW_CACHE_TTL_MS` | Label Preview | 900,000 (15 min) | `cache/labels.ts` |
| `MAX_CACHE_SIZE_BYTES` | Parquet | 2,147,483,648 (2 GB) | `cache/parquet.ts` |
| `STALE_AGE_MS` | Parquet | 86,400,000 (24h) | `cache/parquet.ts` |
| `CLEANUP_INTERVAL_MS` | Parquet | 600,000 (10 min) | `cache/parquet.ts` |
| `CACHE_STATIC` | HTTP | `max-age=3600` | `cache/headers.ts` |
| `CACHE_SEMI` | HTTP | `max-age=300` | `cache/headers.ts` |
| OHLCV cleanup interval | OHLCV | 60,000 (60 sec) | `cache/ohlcv.ts` |

## 8. Barrel Module

`cache/index.ts` provides:
- Re-exports from all cache modules
- `clearAllCaches()` — clears all 7 caches
- `getCacheStats()` — aggregated stats from all 7 caches

