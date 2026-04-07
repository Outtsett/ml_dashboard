# Wire AbortSignal Through Hooks

Adds request cancellation (AbortSignal) to React Query hooks that use raw `fetch()`.

## Instructions

### Step 1: Find Target Hooks

Search `src/client/src/hooks/` for all `useQuery` hooks with custom `queryFn` that call `fetch()` without passing a `signal` parameter:

```
Pattern: queryFn: async () => { ... fetch( ... ) ... }
```

Skip hooks that already destructure `{ signal }` in the queryFn parameter.

### Step 2: Apply Signal Pattern

For each hook found, apply this transformation:

**Before:**
```typescript
queryFn: async () => {
  const res = await fetch(`/api/endpoint`);
  ...
}
```

**After:**
```typescript
queryFn: async ({ signal }) => {
  const res = await fetch(`/api/endpoint`, { signal });
  ...
}
```

### Step 3: Thread Through API Service

If the hook uses `apiRequest()` or helpers from `src/client/src/lib/api_service.ts`, verify the signal is threaded through:
- `apiRequest(method, url, data?, signal?)` — 4th param
- `get(url, signal?)` — 2nd param
- `getArray(url, signal?)` — 2nd param

### Step 4: Verify

Run `npx tsc --noEmit` to confirm no type errors introduced.

### Key Files
- `src/client/src/lib/query_client.ts` — `apiRequest()` and `getQueryFn()` (signal already wired)
- `src/client/src/lib/api_service.ts` — `get()`, `getArray()` helpers (signal already wired)
- `src/client/src/hooks/` — All hooks with custom queryFn
