# Performance Audit

Run a comprehensive performance audit across the entire ML Dashboard stack.

## Instructions

Execute all checks in parallel using subagents, then compile results into a single report.

### Step 1: Launch Parallel Audit Agents

Launch these 4 agents simultaneously:

**Agent 1 — Bundle Analysis:**
- Run `npm run analyze` (if not recently run) or check `dist/bundle-analysis.html`
- Report vendor chunk sizes, total JS shipped, largest chunks
- Check for duplicate dependencies or unexpectedly large modules

**Agent 2 — Cache Layer Health:**
- Hit `GET /api/cache/stats` (or grep for `getCacheStats` usage) to get server-side cache hit rates
- Check IndexedDB usage via `getOhlcvCacheStats()` in `src/client/src/lib/ohlcv_cache.ts`
- Report: hit rates, entry counts, memory usage, TTL freshness
- Flag any cache with <50% hit rate

**Agent 3 — TypeScript + Build Verification:**
- Run `npx tsc --noEmit` — report error count and new errors vs known pre-existing
- Run `npm run build` — verify clean build, check output sizes
- Verify `.gz` and `.br` files exist in `dist/public/assets/`

**Agent 4 — API Response Audit:**
- Grep all route files in `src/server/routes/` for endpoints missing cache headers (no `CACHE_STATIC` or `CACHE_SEMI`)
- Check which endpoints support MessagePack (`Accept: application/msgpack`)
- Verify ETags are enabled (`app.set('etag', 'weak')` in main.ts)
- Check SSE endpoints for delta encoding support

### Step 2: Compile Report

Present results as a table:

| Area | Status | Details |
|------|--------|---------|
| Bundle Size | OK/WARN | Total JS, largest chunk |
| Server Cache | OK/WARN | Hit rates per cache |
| Client Cache | OK/WARN | IndexedDB entries, Service Worker status |
| Compression | OK/WARN | Pre-compressed assets present? |
| Type Safety | OK/WARN | Error count |
| API Headers | OK/WARN | Endpoints missing cache headers |

### Step 3: Action Items

List specific improvements with file paths and line numbers.
