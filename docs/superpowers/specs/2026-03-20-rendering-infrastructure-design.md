# Rendering Infrastructure Overhaul — Design Spec

**Date:** 2026-03-20
**Status:** Approved

## Goal

Comprehensive rendering infrastructure upgrade across the ML Dashboard: SSE streaming performance, React 19.2 integration, query layer modernization, error handling hardening, code quality improvements, and build optimization.

## Architecture

Four-layer approach: (1) React Compiler + React 19.2 APIs for automatic memoization and non-blocking updates, (2) SSE data pipeline with batched ring buffer and reconnection, (3) TanStack Query v5 migration to Suspense-based queries with proper error boundaries, (4) Build optimization with Rolldown and dependency pruning.

## Tech Stack

- React 19.2.0 (useTransition, useDeferredValue, Activity, useEffectEvent)
- React Compiler v1.0 (babel-plugin-react-compiler)
- TanStack Query v5.60.5 (useSuspenseQuery, QueryErrorResetBoundary)
- Vite 7.1.9 with Rolldown (opt-in Rust bundler)
- lightweight-charts v5.1.0 (data conflation)
- react-window v2.2.5 (already installed)
- Tailwind CSS v4.1.14

## Sections

### 1. React Compiler Integration

Install `babel-plugin-react-compiler` as a Vite babel plugin. This auto-memoizes all components, hooks, and intermediate values at build time. Eliminates the need for manual React.memo, useMemo, useCallback. Provides up to 12% faster initial loads and 2.5x faster interactions (Meta benchmarks).

Configuration: `compilationMode: 'all'`, `target: '19'`.

After compiler is verified working, audit and remove unnecessary manual memoization that the compiler now handles.

### 2. SSE Data Pipeline

Replace the current per-event `setEvents(prev => [...prev, data])` pattern in useTrainingSSE with:

- **Ring buffer** (fixed 5000-slot circular array, O(1) push, zero copies)
- **Microbatch accumulator** (ref-based, 50ms flush window)
- **`startTransition` flush** (non-blocking state update)
- **`useEffectEvent`** for SSE message handler (reads latest state without re-subscribing EventSource)
- **Exponential backoff reconnection** on all EventSource consumers (1s/2s/4s/8s, max 30s)
- **Split TrainingLive context** into 3 sub-providers: metrics, logs, overlays

### 3. Query Layer Modernization

Migrate from `useQuery` to `useSuspenseQuery` where data is required for rendering:

- `data` is guaranteed defined (eliminates `data?.` chains and undefined checks)
- Loading handled by existing `<Suspense>` boundaries
- Errors handled by `<ErrorBoundary>` with `QueryErrorResetBoundary` for retry
- Add `onError` toast notifications to all mutation hooks

Adjust staleTime per data type (instruments: 5min, DB health: 10s, chart OHLCV: Infinity).

### 4. Component Architecture

- **`<Activity>`** (React 19.2) for tab/route preservation — navigating away doesn't destroy charts
- **`useDeferredValue`** for search/filter inputs (symbol picker, indicator catalog, news search)
- **`react-window`** virtualization for long lists (backtest trades, news, portfolio, indicator catalog)
- **lightweight-charts conflation** enabled for 10k+ bar datasets

### 5. Error Handling Hardening

- Global `unhandledrejection` listener with toast notification
- Fix 8+ silent catch blocks with structured logging
- Replace `any` types at API boundaries with Zod validation
- Remove non-null assertions (`!`) — use optional chaining + fallback
- Add `onError` callbacks to all TanStack Query hooks
- EventSource reconnection with exponential backoff on all 3 SSE consumers

### 6. Build Optimization

- **Rolldown** opt-in via `npm:rolldown-vite` (10-30x faster builds)
- **Prune ~10 unused dependencies** (framer-motion, passport, typeorm, parquetjs, etc.)
- **Performance monitoring** dev hook (Web Vitals: LCP, FID, CLS)

### 7. Large File Splitting

Split 4 files exceeding 800 lines into focused modules:
- mlModels.ts (1457 lines) → types + models
- HPOConfigPanel.tsx (1163 lines) → optimizer config + search space editor
- FourierTransform.tsx (893 lines) → math utils + component
- HPODashboard.tsx (817 lines) → trial tracker + convergence + charts
