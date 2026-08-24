# SOLID Fix Plan — 85 Violations

> Generated from deep audit of `src/client/`. Each phase is self-contained and can be merged independently.
> Phases are ordered by dependency — later phases build on earlier ones.

---

## Overview

| Phase                           | Focus                                         | Violations Fixed | Risk        | Estimated Files Changed |
| ------------------------------- | --------------------------------------------- | ---------------- | ----------- | ----------------------- |
| **1 — Foundation**              | Shared constants, slim types, API abstraction | ~18              | Low         | 12                      |
| **2 — Hook Extraction**         | Extract data-fetching into dedicated hooks    | ~25              | Medium      | 20                      |
| **3 — Component Decomposition** | Break god components into focused pieces      | ~22              | Medium-High | 15                      |
| **4 — Context Separation**      | Split UnifiedDashboardContext                 | ~10              | High        | 14                      |
| **5 — Config Externalization**  | Move static data to JSON, registry maps       | ~10              | Low         | 5                       |

**Total: 85 violations → 5 phases → ~66 files touched**

---

## Phase 1 — Foundation (Low Risk)

*Create shared building blocks that all later phases depend on.*

### 1A. Shared Timeframe Constants (OCP, SRP — 3 violations)

**Problem**: Identical minutes→label map duplicated in 3 files:
- `src/client/src/pages/market-data/types.ts` → `getApiTimeframe()`
- `src/client/src/hooks/useUniversalTraining.ts` → `MINUTES_TO_LABEL`
- `src/client/src/components/training/useRegimeTraining.ts` → `tfMinutesToLabel()`

**Fix**: Create `src/client/src/lib/timeframes.ts`

```ts
// src/client/src/lib/timeframes.ts
export const TIMEFRAME_OPTIONS = [
  { minutes: 1,    label: '1m',  apiKey: '1m'  },
  { minutes: 5,    label: '5m',  apiKey: '5m'  },
  { minutes: 15,   label: '15m', apiKey: '15m' },
  { minutes: 30,   label: '30m', apiKey: '30m' },
  { minutes: 60,   label: '1h',  apiKey: '1h'  },
  { minutes: 240,  label: '4h',  apiKey: '4h'  },
  { minutes: 1440, label: '1d',  apiKey: '1d'  },
] as const;

export type TimeframeMinutes = typeof TIMEFRAME_OPTIONS[number]['minutes'];

export function minutesToLabel(m: number): string {
  return TIMEFRAME_OPTIONS.find(t => t.minutes === m)?.label ?? `${m}m`;
}

export function minutesToApiKey(m: number): string {
  return TIMEFRAME_OPTIONS.find(t => t.minutes === m)?.apiKey ?? '1d';
}

export const MAX_BARS_IN_MEMORY = 50_000;

export function getFetchLimit(minutes: number): number {
  if (minutes >= 1440) return 2000;
  if (minutes >= 240)  return 5000;
  if (minutes >= 60)   return 10000;
  return 20000;
}
```

**Then update**:
| File                                           | Change                                                                                                                                                              |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pages/market-data/types.ts`                   | Remove `timeframes`, `getApiTimeframe`, `getFetchLimit`, `MAX_BARS_IN_MEMORY`. Import from `lib/timeframes`. Keep `OhlcvData`, `InstrumentInfo`, `ChartSymbolInfo`. |
| `hooks/useUniversalTraining.ts`                | Delete `MINUTES_TO_LABEL` + `minutesToLabel()`. Import `minutesToLabel` from `lib/timeframes`.                                                                      |
| `components/training/useRegimeTraining.ts`     | Delete `tfMinutesToLabel()`. Import `minutesToLabel` from `lib/timeframes`.                                                                                         |
| `pages/fourier-transform/constants.ts`         | Delete `TF_LABELS`. Import from `lib/timeframes` or derive from `TIMEFRAME_OPTIONS`.                                                                                |
| `pages/fourier-transform/FourierTransform.tsx` | Delete inline `tfMap`. Use `minutesToLabel`.                                                                                                                        |
| `pages/market-data/Toolbar.tsx`                | Update import to use `TIMEFRAME_OPTIONS` from `lib/timeframes`.                                                                                                     |
| `pages/market-data/index.tsx`                  | Update import to use `minutesToLabel` from `lib/timeframes`.                                                                                                        |

---

### 1B. Slim Interface Types (ISP — 5 violations)

**Problem**: Components accept bloated types when they only use 2-3 fields.

**Fix**: Add slim projection types to `src/client/src/lib/types.ts`:

```ts
// Slim projections (ISP)
export interface ModelSummary { id: number; name: string; type?: string; }
export interface TradeSummary { id: number; symbol: string; side: string; pnl: number | null; }
export interface FeatureInfo   { name: string; importance: number; }
export interface TrainStatus   { modelId: number; status: string; progress?: number; epoch?: number; }
```

**Then update components** that only use a few fields:
| Component                  | Current Prop          | New Prop                                   |
| -------------------------- | --------------------- | ------------------------------------------ |
| Any model badge/list item  | `MlModel` (18 fields) | `ModelSummary` (3 fields)                  |
| Trade table row            | `Trade` (18 fields)   | `TradeSummary` (4 fields) where applicable |
| Feature importance display | full feature object   | `FeatureInfo` (2 fields)                   |

---

### 1C. Centralized API Service (DIP — 10 violations, foundation for Phase 2)

**Problem**: 42 inline `fetch('/api/...')` calls across 15 files. The existing `apiRequest()` in `queryClient.ts` and `fetchArray()` in `fetchArray.ts` are underused.

**Fix**: Create `src/client/src/lib/apiService.ts` — a typed facade that wraps `apiRequest` for every endpoint group. Hooks will import from here instead of writing raw `fetch()`.

```ts
// src/client/src/lib/apiService.ts
import { apiRequest } from './queryClient';

// ── ML Models ────────────────────────────────
export const mlApi = {
  getModels:      ()         => apiRequest('GET', '/api/ml/models'),
  getSavedModels: ()         => apiRequest('GET', '/api/ml/saved-models'),
  getTrainStatus: ()         => apiRequest('GET', '/api/ml/train/status'),
  getFeatures:    ()         => apiRequest('GET', '/api/ml/universal/features'),
  getTrades:      ()         => apiRequest('GET', '/api/ml/trades'),
  getForecasts:   (params: Record<string,string>) =>
    apiRequest('GET', `/api/ml/forecasts?${new URLSearchParams(params)}`),
} as const;

// ── Training ─────────────────────────────────
export const trainingApi = {
  getConfig:  ()                  => apiRequest('GET', '/api/training/config'),
  start:      (body: unknown)     => apiRequest('POST', '/api/training/start', body),
  stop:       (modelId: number)   => apiRequest('POST', `/api/training/stop/${modelId}`),
} as const;

// ── Regime ───────────────────────────────────
export const regimeApi = {
  getModels:       ()              => apiRequest('GET', '/api/regime/models'),
  getDiagnostics:  (id: number)    => apiRequest('GET', `/api/regime/diagnostics?modelId=${id}`),
  getConvergence:  (id: number)    => apiRequest('GET', `/api/regime/convergence?modelId=${id}`),
  getAssignments:  (params: Record<string,string>) =>
    apiRequest('GET', `/api/regime/assignments?${new URLSearchParams(params)}`),
  getTrainStatus:  ()              => apiRequest('GET', '/api/regime/train/status'),
  startTraining:   (body: unknown) => apiRequest('POST', '/api/regime/train', body),
  stopTraining:    ()              => apiRequest('POST', '/api/regime/train/stop'),
  deleteModel:     (id: number)    => apiRequest('DELETE', `/api/regime/models/${id}`),
} as const;

// ── Indicators ───────────────────────────────
export const indicatorApi = {
  getCatalog:  (symbol: string) =>
    apiRequest('GET', `/api/indicators/catalog?symbol=${symbol}`),
  getData:     (symbol: string, tf: string) =>
    apiRequest('GET', `/api/indicators/data/${symbol}?timeframe=${tf}`),
  getPatterns: (symbol: string, tf: string) =>
    apiRequest('GET', `/api/indicators/patterns/${symbol}?timeframe=${tf}`),
  compute:     (body: unknown) =>
    apiRequest('POST', '/api/indicators/compute', body),
} as const;

// ── Charts ───────────────────────────────────
export const chartApi = {
  getOhlcv: (params: Record<string,string>) =>
    apiRequest('GET', `/api/charts/ohlcv?${new URLSearchParams(params)}`),
  getSymbols: () => apiRequest('GET', '/api/charts/symbols'),
} as const;

// ── XAI ──────────────────────────────────────
export const xaiApi = {
  getMethods: () => apiRequest('GET', '/api/xai/methods'),
  explain:    (body: unknown) => apiRequest('POST', '/api/xai/explain', body),
} as const;

// ── Labels ───────────────────────────────────
export const labelApi = {
  getLabels:  (symbol: string) =>
    apiRequest('GET', `/api/labels?symbol=${symbol}`),
  preview:    (body: unknown) =>
    apiRequest('POST', '/api/labels/preview', body),
  delete:     (id: number) =>
    apiRequest('DELETE', `/api/labels/${id}`),
} as const;

// ── Instruments ──────────────────────────────
export const instrumentApi = {
  getAll: () => apiRequest('GET', '/api/instruments'),
} as const;

// ── News ─────────────────────────────────────
export const newsApi = {
  streamUrl: (symbol: string) => `/api/news/stream/${symbol}`,
} as const;

// ── Databases ────────────────────────────────
export const databaseApi = {
  query:   (body: unknown) => apiRequest('POST', '/api/databases/query', body),
  getUploads: () => apiRequest('GET', '/api/databases/uploads'),
} as const;

// ── Backtest ─────────────────────────────────
export const backtestApi = {
  getTrades: (params: Record<string, string>) =>
    apiRequest('GET', `/api/backtest/trades?${new URLSearchParams(params)}`),
} as const;
```

**No files change yet** — Phase 2 hooks will import from this service. But creating it now establishes the abstraction layer.

---

## Phase 2 — Hook Extraction (Medium Risk)

*Replace all 42 inline `fetch()` calls with dedicated hooks per data concern.*

### 2A. ML Data Hooks (SRP, DIP — 8 violations)

**Problem**: `market-data/index.tsx`, `bottom-panel/index.tsx`, and `ml-hub/index.tsx` all independently fetch the same ML endpoints inline.

**Create**: `src/client/src/hooks/useMLData.ts`

```
Hooks to extract:
├── useSavedModels()     — GET /api/ml/saved-models     (used in 3 files)
├── useTrainStatus()     — GET /api/ml/train/status      (used in 3 files)
├── useMLModels()        — GET /api/ml/models            (used in 2 files)
├── useMLTrades()        — GET /api/ml/trades            (used in 2 files)
└── useMLFeatures()      — GET /api/ml/universal/features (used in 2 files)
```

Each hook: ~10 lines. Uses `useQuery` + imports from `apiService.ts`.

**Files to update** (remove inline fetch, import hook):
| File                                       | Fetches Removed                                                   |
| ------------------------------------------ | ----------------------------------------------------------------- |
| `pages/market-data/index.tsx`              | `saved-models`, `train/status`                                    |
| `components/panels/bottom-panel/index.tsx` | `ml/models`, `saved-models`, `trades`, `features`, `train/status` |
| `pages/ml-hub/index.tsx`                   | `saved-models`, `train/status`, `features`                        |

---

### 2B. Regime Data Hooks (SRP, DIP — 9 violations)

**Problem**: `useRegimeTraining.ts` (457 lines!) has 9 inline fetch calls mixing data-fetching with training orchestration.

**Create**: `src/client/src/hooks/useRegimeData.ts`

```
Hooks to extract:
├── useRegimeModels()       — GET /api/regime/models
├── useRegimeDiagnostics(modelId)  — GET /api/regime/diagnostics
├── useRegimeConvergence(modelId)  — GET /api/regime/convergence
├── useRegimeAssignments(params)   — GET /api/regime/assignments
└── useRegimeTrainStatus()  — GET /api/regime/train/status
```

**Then slim down `useRegimeTraining.ts`** to only training orchestration:
- Keep: `startTraining()`, `stopTraining()`, `deleteModel()`, SSE stream handling
- Remove: All 5 read queries (they move to `useRegimeData.ts`)
- Remove: `tfMinutesToLabel()` (already moved in Phase 1A)

**Also update**: `components/regime-analytics/index.tsx` — replace its 5 inline `fetch()` calls with hooks from `useRegimeData.ts`.

---

### 2C. Indicator Data Hooks (DIP — 3 violations)

**Problem**: `useIndicatorData.ts` has 3 inline fetch calls + a duplicated timeframe map.

**Fix**: Refactor `src/client/src/hooks/useIndicatorData.ts` in-place:
1. Delete `TIMEFRAME_MAP` (use `minutesToApiKey` from Phase 1A)
2. Replace 3 inline `fetch()` calls with `indicatorApi.*` from `apiService.ts`

Also refactor `IndicatorPanel.tsx`:
- Move the 1 inline `fetch('/api/indicators/compute')` → use `indicatorApi.compute` via a `useMutation`.

---

### 2D. Chart OHLCV Hook (DIP — 2 violations)

**Problem**: `market-data/index.tsx` has 2 inline `fetch()` calls for OHLCV data (initial + infinite scroll).

**Create**: `src/client/src/hooks/useChartOHLCV.ts`

```ts
// Encapsulates:
// - useInfiniteQuery for OHLCV with cursor pagination
// - Symbol/timeframe params from context
// - getFetchLimit() logic
// - The `placeholderData: (prev: any) => prev` fix (type properly)
```

**Update**: `market-data/index.tsx` — replace ~30 lines of inline query config with `useChartOHLCV(symbol, timeframe)`.

---

### 2E. Remaining Inline Fetch Fixes (DIP — 5 violations)

| File                                     | Current          | Fix                                                                                              |
| ---------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------ |
| `explainable-ai/index.tsx`               | 2 inline fetches | Use `xaiApi.*` via `useQuery`/`useMutation` (extract to `useXAI` hook or inline with apiService) |
| `label-generation/index.tsx`             | 1 inline fetch   | Use `labelApi.getLabels`                                                                         |
| `forecast-visualizer/index.tsx`          | 1 inline fetch   | Use `mlApi.getForecasts`                                                                         |
| `sidebar/ml-workflow/index.tsx`          | 1 inline fetch   | Use `labelApi.preview`                                                                           |
| `fourier-transform/FourierTransform.tsx` | 1 inline fetch   | Use `chartApi.getOhlcv`                                                                          |

---

### 2F. Split `useUniversalTraining` (SRP — 3 violations)

**Problem**: 298 lines mixing config fetching, training orchestration, and SSE streaming.

**Fix**: Split into 3:

| New File                                  | Responsibility                                    | Lines (est.) |
| ----------------------------------------- | ------------------------------------------------- | ------------ |
| `hooks/useTrainingConfig.ts`              | `GET /api/training/config` via `trainingApi`      | ~25          |
| `hooks/useTrainingSSE.ts`                 | SSE EventSource connection + event parsing        | ~60          |
| `hooks/useUniversalTraining.ts` (slimmed) | Orchestration: start/stop + combines config + SSE | ~80          |

Update `TrainingContext.tsx` to use the slimmed hook (interface stays the same → no downstream breaks).

---

### 2G. Split `useRegimeTraining` (SRP — 5 violations)

**Problem**: 457 lines mixing 5 queries, training orchestration, SSE streaming, model management, and instrument filtering.

**Fix**: After 2B extracts the 5 read hooks, split the remaining ~200 lines:

| New File                                             | Responsibility                                   | Lines (est.) |
| ---------------------------------------------------- | ------------------------------------------------ | ------------ |
| `hooks/useRegimeSSE.ts`                              | SSE stream connection for regime training        | ~60          |
| `hooks/useRegimeTrainingOrchestrator.ts`             | start/stop/delete + state machine                | ~100         |
| `components/training/useRegimeTraining.ts` (slimmed) | Facade combining orchestrator + SSE + read hooks | ~40          |

Update `RegimeTrainingContext.tsx` to use the slimmed hook.

---

## Phase 3 — Component Decomposition (Medium-High Risk)

*Break god components into focused, single-responsibility pieces.*

### 3A. Decompose `market-data/index.tsx` (SRP — 9 violations)

**Current**: 611 lines, 15+ useState, mixes chart data, regime overlays, training sync, trade metrics, indicator toggling.

**Target structure**:

```
pages/market-data/
├── index.tsx              (~80 lines)  — Layout shell, composes sub-components
├── types.ts               (slimmed)    — OhlcvData, InstrumentInfo, ChartSymbolInfo only
├── Toolbar.tsx            (exists)     — Already extracted ✓
├── ChartContainer.tsx     (~120 lines) — TradingChart wrapper + overlay composition
├── useMarketDataPage.ts   (~80 lines)  — Page-level state orchestration hook
├── useChartOverlayData.ts (~60 lines)  — Fetches regime assignments, trade markers
├── useTradeMetrics.ts     (exists)     — Already extracted ✓
└── bottom-panel/          (exists)     — Already extracted ✓
```

**Migration steps**:
1. Create `useMarketDataPage.ts` — move all `useState` + symbol/TF management
2. Create `useChartOverlayData.ts` — move regime assignment fetch + trade marker fetch
3. Create `ChartContainer.tsx` — move `<TradingChart>` wrapper + overlay props
4. Slim `index.tsx` to layout composition only

---

### 3B. Decompose `regime-analytics/index.tsx` (SRP — 6 violations)

**Current**: 652 lines, 14 useState, mixes training config, training execution, results display.

**Target structure**:

```
components/regime-analytics/
├── index.tsx              (~60 lines)  — Layout + tab controller
├── RegimeConfig.tsx       (~100 lines) — Training configuration form
├── RegimeResults.tsx      (~150 lines) — Diagnostics + convergence display
├── RegimeModelList.tsx    (~80 lines)  — Model list + delete + select
└── useRegimeAnalytics.ts  (~40 lines)  — Page-level state (selected model, active tab)
```

All data fetching already moved to `useRegimeData.ts` hooks (Phase 2B).

---

### 3C. Slim `TradingChart.tsx` (SRP — 3 violations)

**Current**: 763 lines mixing chart initialization, indicator rendering, overlay rendering, resize handling.

**Target structure**:

```
components/trading-chart/
├── TradingChart.tsx        (~200 lines) — Main component, lifecycle, ref forwarding
├── useChartSetup.ts        (~100 lines) — createChart, resize observer, cleanup
├── useChartSeries.ts       (~120 lines) — Candlestick + volume series management
├── useChartOverlays.ts     (~80 lines)  — Trade markers, prediction markers rendering
├── useChartIndicators.ts   (~80 lines)  — Indicator line series management
├── chartHelpers.ts         (~60 lines)  — alignTimestamp, color utils, formatters
└── types.ts                (~30 lines)  — LabelMarker, TradingChartHandle, TradingChartProps
```

**Key**: `TradingChart` keeps `forwardRef` + imperative handle. Internal hooks are private to the folder.

---

### 3D. Decompose `bottom-panel/index.tsx` (SRP, DIP — 6 violations)

**Current**: ~175 lines with 5 inline fetch calls for 5 different data concerns.

**Fix** (after Phase 2A extracts the hooks):
- Replace all 5 inline `useQuery` blocks with imported hooks
- Split tab content into separate files if not already done
- Each tab should receive only the data it needs (ISP)

---

### 3E. Decompose `ml-hub/index.tsx` (SRP — 4 violations)

**Problem**: Single page component managing model list, training status, feature configuration, and model details.

**Target structure**:

```
pages/ml-hub/
├── index.tsx           (~60 lines) — Layout + tab router
├── ModelList.tsx        — Model browser using useSavedModels() + useMLModels()
├── TrainingStatus.tsx   — Live training dashboard using useTrainStatus()
├── FeatureConfig.tsx    — Feature set management using useMLFeatures()
└── ModelDetail.tsx      — Single model detail view
```

---

## Phase 4 — Context Separation (High Risk)

*Split the monolithic UnifiedDashboardContext into focused contexts.*

### 4A. Split UnifiedDashboardContext (SRP, ISP — 10 violations)

**Current**: 272 lines, 5 mixed concerns, 19 methods on one interface. Every consumer gets everything even if they only need symbol/TF.

**Note**: The file already exports `useSymbol()` and `useChartOverlays()` convenience hooks — this split formalizes that pattern.

**Target structure**:

```
contexts/
├── SymbolContext.tsx          (~50 lines)  — symbol, assetType, timeframeMinutes + setters
├── ChartOverlayContext.tsx    (~50 lines)  — tradeMarkers, predictionMarkers, highlightRange
├── ActiveModelContext.tsx     (~30 lines)  — activeModelId, activeModelName + setters
├── DashboardLogContext.tsx    (~40 lines)  — logs[] + addLog
├── UnifiedDashboardContext.tsx (~50 lines) — Composer: wraps all 4 providers, re-exports
│                                              useDashboard() for backward compatibility
├── TrainingContext.tsx        (exists, unchanged)
└── RegimeTrainingContext.tsx  (exists, unchanged)
```

**Migration strategy** (backward-compatible):
1. Create 4 new context files
2. `UnifiedDashboardContext.tsx` becomes a composer that nests all 4 providers
3. `useDashboard()` still works (reads from all 4) — no downstream breaks
4. `useSymbol()` and `useChartOverlays()` now read from their dedicated contexts (faster re-renders)
5. Gradually migrate consumers to use specific hooks instead of `useDashboard()`

**Files that use `useDashboard()` and would benefit from targeted hooks**:

| File                            | Actually Needs                       |
| ------------------------------- | ------------------------------------ |
| `market-data/index.tsx`         | `useSymbol()` + `useChartOverlays()` |
| `ml-hub/index.tsx`              | `useSymbol()` only                   |
| `backtest/index.tsx`            | `useSymbol()` + `useChartOverlays()` |
| `useUniversalTraining.ts`       | `useSymbol()` only                   |
| `useRegimeTraining.ts`          | `useSymbol()` only                   |
| `regime-analytics/index.tsx`    | `useSymbol()` only                   |
| `bottom-panel/index.tsx`        | `useSymbol()` only                   |
| `forecast-visualizer/index.tsx` | `useSymbol()` + `useChartOverlays()` |

---

## Phase 5 — Config Externalization (Low Risk)

*Move static data out of code into config files and registries.*

### 5A. Extract `mlModels.ts` to JSON (OCP, SRP — 4 violations)

**Current**: 1,341 lines of static model definitions in TypeScript.

**Fix**:
1. Create `src/config/ml-model-catalog.json` — array of model definitions
2. Slim `mlModels.ts` to ~50 lines: type definitions + `import catalog from '../../config/ml-model-catalog.json'` + helper functions (`getModelById`, etc.)
3. New models added by editing JSON — no TypeScript recompile needed for data changes

---

### 5B. Hardcoded Watchlist → API (OCP — 1 violation)

**File**: `pages/News.tsx` — 25 symbols hardcoded.

**Fix**: Replace with `const { data: instruments } = useQuery(...)` fetching from `/api/instruments`. Derive symbol list from response.

---

### 5C. Type All `any` Props (LSP — 7 violations)

| File                           | Location                         | Fix                                                 |
| ------------------------------ | -------------------------------- | --------------------------------------------------- |
| `market-data/index.tsx` L173   | `placeholderData: (prev: any)`   | Type as `(prev: OhlcvData[] \| undefined)`          |
| `useRegimeTraining.ts` L367    | `catch (err: any)`               | Use `catch (err: unknown)` + type guard             |
| `useRegimeTraining.ts` L443    | `instruments.filter((i: any) =>` | Type the instruments array properly                 |
| `useUniversalTraining.ts` L269 | `catch (err: any)`               | Use `catch (err: unknown)` + type guard             |
| `databases/index.tsx` L73      | `useQuery<any[]>`                | Define `Upload` interface, use `useQuery<Upload[]>` |
| `databases/UploadTab.tsx`      | `any[]` props                    | Type properly                                       |
| `databases/QueryConsole.tsx`   | `any` results                    | Define result type                                  |

---

### 5D. Fix `fetchArray` Silent Error Swallowing (LSP — 1 violation)

**File**: `lib/fetchArray.ts`

**Problem**: Returns `[]` on any error — callers can't distinguish "no data" from "network failure".

**Fix**:
```ts
// Option A: Throw on error (callers use TanStack Query error handling)
export async function fetchArray<T>(url: string): Promise<T[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetchArray ${url}: ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

// Option B: Return discriminated union
export async function fetchArray<T>(url: string): Promise<{ data: T[]; error?: string }> { ... }
```

Recommend **Option A** since all callers use TanStack Query which handles errors.

---

## Execution Order & Dependencies

```
Phase 1A (timeframes)  ──┐
Phase 1B (slim types)  ──┤
Phase 1C (apiService)  ──┼── Phase 2A-2G (hooks) ──┬── Phase 3A-3E (components)
                         │                          │
                         │                          └── Phase 4A (contexts)
                         │
Phase 5A-5D ─────────────┘  (independent, can run anytime)
```

**Safe parallel work**:
- Phase 1A + 1B + 1C can all run in parallel (no dependencies)
- Phase 5A-5D can run at any time (independent)
- Phase 2A-2G should run after Phase 1C (hooks use apiService)
- Phase 3 should run after Phase 2 (components use extracted hooks)
- Phase 4 should run after Phase 3 (context split affects component imports)

---

## Violation-to-Phase Mapping

### 🔴 Critical (35 violations)

| #   | File                                   | Principle | Violation                                          | Phase  |
| --- | -------------------------------------- | --------- | -------------------------------------------------- | ------ |
| 1   | market-data/index.tsx                  | SRP       | God component (611 lines, 15+ state vars)          | 3A     |
| 2   | market-data/index.tsx                  | DIP       | 5 inline fetch calls                               | 2A, 2D |
| 3   | market-data/index.tsx                  | SRP       | Mixes chart, regime, training, overlays            | 3A     |
| 4   | market-data/index.tsx                  | ISP       | Imports full `useDashboard()` for symbol only      | 4A     |
| 5   | useRegimeTraining.ts                   | SRP       | 457 lines — fetching + training + SSE + model mgmt | 2B, 2G |
| 6   | useRegimeTraining.ts                   | DIP       | 9 inline fetch calls                               | 2B     |
| 7   | useRegimeTraining.ts                   | SRP       | Duplicated timeframe map                           | 1A     |
| 8   | useRegimeTraining.ts                   | DIP       | Direct fetch in mutations                          | 2B     |
| 9   | useRegimeTraining.ts                   | ISP       | Imports full `useDashboard()` for symbol only      | 4A     |
| 10  | useUniversalTraining.ts                | SRP       | 298 lines — config + training + SSE                | 2F     |
| 11  | useUniversalTraining.ts                | DIP       | 3 inline fetch calls                               | 2F     |
| 12  | useUniversalTraining.ts                | SRP       | Duplicated timeframe map                           | 1A     |
| 13  | useUniversalTraining.ts                | ISP       | Imports full `useDashboard()` for symbol only      | 4A     |
| 14  | bottom-panel/index.tsx                 | DIP       | 5 inline fetch calls                               | 2A     |
| 15  | bottom-panel/index.tsx                 | SRP       | Fetches 5 data concerns in one component           | 2A, 3D |
| 16  | regime-analytics/index.tsx             | SRP       | 652 lines, 14 state vars                           | 3B     |
| 17  | regime-analytics/index.tsx             | DIP       | 5 inline fetch calls                               | 2B     |
| 18  | regime-analytics/index.tsx             | SRP       | Mixes config, execution, results display           | 3B     |
| 19  | regime-analytics/index.tsx             | ISP       | Imports full `useDashboard()` for symbol only      | 4A     |
| 20  | TradingChart.tsx                       | SRP       | 763 lines — init, indicators, overlays, resize     | 3C     |
| 21  | TradingChart.tsx                       | SRP       | alignTimestamp + color utils mixed into component  | 3C     |
| 22  | ml-hub/index.tsx                       | SRP       | Single component managing 4 concerns               | 3E     |
| 23  | ml-hub/index.tsx                       | DIP       | 3 inline fetch calls                               | 2A     |
| 24  | ml-hub/index.tsx                       | ISP       | Imports full `useDashboard()` for symbol only      | 4A     |
| 25  | UnifiedDashboardContext.tsx            | SRP       | 5 concerns in one context                          | 4A     |
| 26  | UnifiedDashboardContext.tsx            | ISP       | 19 methods on one interface                        | 4A     |
| 27  | mlModels.ts                            | OCP       | 1,341 lines static data in code                    | 5A     |
| 28  | mlModels.ts                            | SRP       | Data + helpers + types in one file                 | 5A     |
| 29  | explainable-ai/index.tsx               | DIP       | 2 inline fetch calls                               | 2E     |
| 30  | ml-workflow/index.tsx                  | DIP       | 1 inline fetch + mutation in component             | 2E     |
| 31  | ml-workflow/index.tsx                  | SRP       | Mixes label preview + model workflow               | 3E     |
| 32  | fourier-transform/FourierTransform.tsx | DIP       | Inline fetch + duplicated tfMap                    | 1A, 2E |
| 33  | fourier-transform/constants.ts         | SRP       | Duplicated TF_LABELS                               | 1A     |
| 34  | useIndicatorData.ts                    | DIP       | 3 inline fetch calls                               | 2C     |
| 35  | useIndicatorData.ts                    | SRP       | Duplicated TIMEFRAME_MAP                           | 1A     |

### 🟡 Medium (41 violations)

| #   | File                          | Principle | Violation                                              | Phase       |
| --- | ----------------------------- | --------- | ------------------------------------------------------ | ----------- |
| 36  | market-data/index.tsx         | LSP       | `any` type in placeholderData                          | 5C          |
| 37  | market-data/index.tsx         | SRP       | Training sync logic inline                             | 3A          |
| 38  | market-data/index.tsx         | SRP       | Trade metrics computed inline                          | 3A          |
| 39  | market-data/index.tsx         | OCP       | Hardcoded overlay types                                | 3A          |
| 40  | useRegimeTraining.ts          | LSP       | `any` in catch + filter                                | 5C          |
| 41  | useRegimeTraining.ts          | SRP       | Instrument filtering logic inline                      | 2G          |
| 42  | useRegimeTraining.ts          | OCP       | Hardcoded metric parsing                               | 2G          |
| 43  | useUniversalTraining.ts       | LSP       | `any` in catch                                         | 5C          |
| 44  | useUniversalTraining.ts       | SRP       | SSE parsing mixed with state                           | 2F          |
| 45  | bottom-panel/index.tsx        | ISP       | Each tab gets all data, not just its own               | 3D          |
| 46  | bottom-panel/index.tsx        | SRP       | Tab routing + data fetching in same component          | 3D          |
| 47  | regime-analytics/index.tsx    | LSP       | Possible undefined access on diagnostics               | 3B          |
| 48  | regime-analytics/index.tsx    | OCP       | Hardcoded chart config                                 | 3B          |
| 49  | TradingChart.tsx              | ISP       | Props interface has 15+ optional fields                | 3C          |
| 50  | TradingChart.tsx              | OCP       | Hardcoded indicator color map                          | 3C          |
| 51  | IndicatorPanel.tsx            | DIP       | 1 inline fetch (POST compute)                          | 2C          |
| 52  | IndicatorPanel.tsx            | SRP       | Mixes selection UI + compute trigger + results display | 3A          |
| 53  | IndicatorPanel.tsx            | ISP       | Receives full indicator catalog when only needs names  | 2C          |
| 54  | IndicatorPanel.tsx            | OCP       | Category list hardcoded                                | 2C          |
| 55  | IndicatorPanel.tsx            | OCP       | Indicator grouping logic inline                        | 2C          |
| 56  | News.tsx                      | OCP       | 25 hardcoded watchlist symbols                         | 5B          |
| 57  | News.tsx                      | SRP       | SSE connection management inline                       | 2E          |
| 58  | News.tsx                      | DIP       | Direct EventSource, no abstraction                     | 2E          |
| 59  | News.tsx                      | SRP       | Article rendering mixed with stream logic              | 3A          |
| 60  | databases/index.tsx           | DIP       | 1 inline fetch (POST query)                            | 2E          |
| 61  | databases/index.tsx           | LSP       | `useQuery<any[]>` for uploads                          | 5C          |
| 62  | databases/index.tsx           | SRP       | Query execution + result display in one component      | 3A          |
| 63  | databases/UploadTab.tsx       | LSP       | `any[]` props                                          | 5C          |
| 64  | databases/QueryConsole.tsx    | LSP       | `any` results                                          | 5C          |
| 65  | ml-workflow/index.tsx         | SRP       | Label generation embedded in workflow sidebar          | 3E          |
| 66  | ml-workflow/index.tsx         | ISP       | Receives full model list for simple name display       | 1B          |
| 67  | forecast-visualizer/index.tsx | DIP       | 1 inline fetch                                         | 2E          |
| 68  | forecast-visualizer/index.tsx | ISP       | Imports full `useDashboard()`                          | 4A          |
| 69  | label-generation/index.tsx    | DIP       | 1 inline fetch                                         | 2E          |
| 70  | backtest/index.tsx            | DIP       | 1 inline fetch                                         | 2E          |
| 71  | backtest/index.tsx            | ISP       | Imports `useDashboard` for symbol + overlays only      | 4A          |
| 72  | fetchArray.ts                 | LSP       | Silent error → empty array (breaks caller contract)    | 5D          |
| 73  | hooks/useTradeMetrics.ts      | ISP       | Returns 15 computed fields when most callers use 3     | 2A          |
| 74  | hooks/useTrainingSync.ts      | SRP       | Mixes polling + event translation                      | 2F          |
| 75  | hooks/useBreadcrumbs.tsx      | SRP       | Navigation + breadcrumb rendering in one hook          | n/a (minor) |
| 76  | contexts/ overall             | ISP       | 2 training contexts exist separately — discoverability | 4A          |

### 🟢 Minor (9 violations)

| #   | File                   | Principle | Violation                                     | Phase           |
| --- | ---------------------- | --------- | --------------------------------------------- | --------------- |
| 77  | lib/utils.ts           | SRP       | `cn()` + other unrelated utils in one file    | n/a (too minor) |
| 78  | lib/indicatorColors.ts | OCP       | Hardcoded color map (but small, acceptable)   | n/a             |
| 79  | lib/indicatorPanels.ts | OCP       | Hardcoded panel config                        | n/a             |
| 80  | lib/chartOverlays.ts   | SRP       | Small helper file, just needs type tightening | n/a             |
| 81  | lib/cacheManager.ts    | SRP       | IndexedDB + cache policy in one file (small)  | n/a             |
| 82  | lib/uploadUtils.ts     | SRP       | Clean enough — single concern                 | n/a             |
| 83  | hooks/use-mobile.tsx   | SRP       | Fine — single concern                         | n/a             |
| 84  | hooks/use-toast.ts     | SRP       | Fine — single concern                         | n/a             |
| 85  | components/ui/*        | n/a       | shadcn/ui components — don't modify           | n/a             |

---

## Verification Checklist

After each phase, verify:

- [ ] `npm run check` — no TypeScript errors
- [ ] `npm test` — all tests pass
- [ ] `npm run dev` — app starts and renders
- [ ] No circular imports (`npx madge --circular src/client/`)
- [ ] No remaining inline `fetch('/api/')` calls (grep check)
- [ ] Each new file has a single, clear responsibility
- [ ] Each new hook follows the naming convention `use{DataConcern}()`
- [ ] No file exceeds ~200 lines (soft target)
- [ ] All `any` types replaced with proper types
- [ ] QUERY_KEYS used consistently for all query cache keys
