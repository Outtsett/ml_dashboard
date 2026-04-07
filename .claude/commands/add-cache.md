# Add Cache Layer

Adds caching to an API endpoint or React hook using the established cache infrastructure.

## Instructions

Determine the cache type needed based on the target: $ARGUMENTS

### Decision Matrix

| Target | Cache Type | Implementation |
|--------|-----------|----------------|
| Server API endpoint (reference data) | HTTP cache headers | Add `CACHE_STATIC` (1h) or `CACHE_SEMI` (5min) middleware from `src/server/cache/headers.ts` |
| Server API endpoint (query results) | LRU in-memory | Use `cachedQuery()` pattern from `src/server/cache/ohlcv.ts` |
| Client hook (immutable historical data) | IndexedDB | Use `getCachedBars()`/`storeBars()` pattern from `src/client/src/lib/ohlcv_cache.ts` |
| Client hook (reference/config data) | TanStack Query staleTime | Set `staleTime: 60 * 60 * 1000` (1h) in useQuery options |
| SSE events (large payloads) | Delta encoding | Use `computeDelta()`/`applyDelta()` from `src/shared/delta.ts` |
| API response (bulk data) | MessagePack binary | Add `Accept: application/msgpack` support per `src/server/routes/charts.ts` pattern |

### Pattern: Server LRU Cache

```typescript
// In route handler:
import { cachedQuery } from '../cache/ohlcv';  // or create new cache module

const cacheKey = `mydata|${param1}|${param2}`;
const data = await cachedQuery(cacheKey, async () => {
  // Expensive query here
  return queryResult;
});
res.json(data);
```

### Pattern: HTTP Cache Headers

```typescript
import { CACHE_SEMI } from '../cache/headers';

router.get('/my-endpoint', CACHE_SEMI, (req, res) => {
  // Handler — browser caches 5 min, ETags handle revalidation
});
```

### Pattern: IndexedDB Client Cache

```typescript
import { getCachedBars, storeBars } from '@/lib/ohlcv_cache';

queryFn: async ({ signal }) => {
  // L0: IndexedDB
  const cached = await getCachedBars(symbol, timeframe);
  if (cached?.length) return cached as unknown as MyType[];

  // L1: Network
  const res = await fetch(url, { signal });
  const data = await res.json();

  // Persist (fire-and-forget)
  storeBars(symbol, timeframe, data);
  return data;
}
```

### Pattern: MessagePack Endpoint

Server side (`src/server/routes/*.ts`):
```typescript
import { encode as msgpackEncode } from '@msgpack/msgpack';

// Before res.json(data):
const accept = req.headers['accept'] || '';
if (accept.includes('application/msgpack')) {
  const packed = msgpackEncode(data);
  res.setHeader('Content-Type', 'application/msgpack');
  return res.send(Buffer.from(packed));
}
return res.json(data);
```

Client side:
```typescript
import { decode as msgpackDecode } from '@msgpack/msgpack';

const response = await fetch(url, {
  signal,
  headers: { 'Accept': 'application/msgpack' },
});
const contentType = response.headers.get('content-type') || '';
if (contentType.includes('application/msgpack')) {
  const buffer = await response.arrayBuffer();
  return msgpackDecode(new Uint8Array(buffer)) as MyType[];
}
return response.json();
```

### After Adding Cache

1. Run `npx tsc --noEmit` to verify types
2. Update CLAUDE.md cache section if adding a new cache module
3. Add cache stats to `/api/cache/stats` if server-side
