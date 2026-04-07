# Optimize API Endpoint

Apply all available performance optimizations to a server API endpoint.

## Instructions

Target endpoint: $ARGUMENTS

Launch 3 parallel Explore agents to audit the endpoint:

### Agent 1: Current State Audit
- Read the route handler file
- Check: does it have cache headers? ETags? MessagePack support? Compression bypass for binary?
- Check: does the client hook use AbortSignal? IndexedDB cache? Optimistic updates?
- Report what's missing

### Agent 2: Response Size Analysis
- Find the route handler, understand the data shape returned
- Estimate response size for typical queries
- Determine if MessagePack would help (>10KB responses benefit, <1KB don't)
- Check if the response is reference data (cacheable) vs live data (not cacheable)

### Agent 3: Cache Strategy
- Check if server-side LRU cache exists for this endpoint
- Check if HTTP cache headers are set
- Determine optimal TTL based on data freshness requirements
- Check for event-driven cache invalidation opportunities

### Apply Optimizations (in order of impact)

1. **HTTP Cache Headers** — Add `CACHE_STATIC` or `CACHE_SEMI` from `src/server/cache/headers.ts`
2. **Server LRU Cache** — Wrap expensive queries in `cachedQuery()` if not already
3. **MessagePack** — Add `Accept: application/msgpack` support for bulk data endpoints
4. **Client AbortSignal** — Ensure the consuming hook passes `signal` to `fetch()`
5. **IndexedDB** — For immutable historical data, add client-side persistence
6. **Optimistic Updates** — For mutations (POST/PUT/DELETE), add `onMutate` rollback

### Key Files
- `src/server/cache/headers.ts` — HTTP cache middleware
- `src/server/cache/ohlcv.ts` — LRU cache pattern
- `src/server/routes/charts.ts` — Reference implementation (has all optimizations)
- `src/client/src/lib/query_client.ts` — AbortSignal wiring
- `src/client/src/lib/ohlcv_cache.ts` — IndexedDB pattern
- `src/shared/delta.ts` — SSE delta encoding
