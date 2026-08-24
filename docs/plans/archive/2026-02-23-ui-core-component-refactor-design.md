# UI Core Component Refactor — Design Doc

**Date:** 2026-02-23
**Branch:** feat/data-architecture-reorg
**Scope:** Core components (TradingChart, BottomPanel, Dashboard) + dead code deletion

## Problem

Three core UI files have accumulated complexity that hurts maintainability:
- **TradingChart.tsx** (1259 LOC): 6 copy-pasted marker management effects, 20+ refs, hardcoded config, `console.log` in prod, `any` types everywhere
- **BottomPanel.tsx** (579 LOC): Duplicated trade metrics logic, `any` type on JSON parse, local type that should be shared
- **Dashboard.tsx** (461 LOC): Dead code (unused state, unreachable renders, permanently disabled button, unused component)

Plus one deprecated file (`useMarketData.ts`) that calls non-existent endpoints.

## Design

### 1. TradingChart Decomposition

Extract from 1 monolithic file into focused modules. External API (props) does not change.

| New File | Contents | ~LOC |
|---|---|---|
| `components/chart/chartConfig.ts` | `futuresTickInfo`, `forexPipInfo`, `getBaseSymbol()`, `REGIME_FILLS`, `dedupByTime()`, chart creation options factory | 100 |
| `components/chart/useSeriesMarkers.ts` | Generic hook: given a candle series ref + markers array, handles create/update/clear lifecycle. Replaces 6 copy-pasted blocks. | 50 |
| `components/chart/useChartOverlays.ts` | Indicator overlay series management + CDL pattern markers | 80 |
| `components/TradingChart.tsx` | Core chart: creation, data processing, load-more, price info HUD, ZigZag/S-R. Uses the extracted hooks. | ~450 |

Key fixes:
- Remove `console.log` (line 721)
- Replace `any` refs with `ReturnType<typeof createSeriesMarkers>` or `ISeriesApi<'Line'>`
- Empty `catch {}` → commented catch explaining intent
- `dedupByTime` moves to config (utility, not component)

### 2. Shared `useTradeMetrics` Hook

Both Dashboard and BottomPanel compute identical trade metrics (win rate, P&L, profit factor, etc.). Extract to `hooks/useTradeMetrics.ts`:

```ts
export function useTradeMetrics(trades: Trade[]) {
  return useMemo(() => {
    const closed = trades.filter(t => t.status === 'closed');
    // ... win rate, P&L, profit factor, avg win/loss, etc.
  }, [trades]);
}
```

### 3. BottomPanel Cleanup

- Use shared `useTradeMetrics` hook
- Move `SavedModel` interface to `lib/types.ts`
- Type the metrics JSON parse (replace `any` with `Record<string, number>`)
- Lighter Suspense fallback for Forecast tab

### 4. Dashboard Cleanup

Delete dead code:
- `equityData` state (never populated) + Equity & Drawdown chart (renders empty)
- `correlationMatrix` state + Correlation Matrix card ("Not Implemented")
- `correlationInstruments` empty array
- `isLive` state + disabled Auto-Refresh button
- `MetricCard` component (defined but never called)
- Drawdown Monitor card ("Monitoring not implemented")

Simplify:
- Remove `refetchInterval` ternaries (always `false` since `isLive` was always `false`)
- Replace 6 hardcoded metric card divs with data-driven `.map()`
- Use shared `useTradeMetrics` hook

### 5. Dead Code Deletion

- Delete `hooks/useMarketData.ts` (deprecated, calls `/api/ohlcv/futures` and `/api/ohlcv/forex` which don't exist)

## What Does NOT Change

- TradingChart props interface (all consumers unaffected)
- BottomPanel props interface
- Dashboard route/page structure
- Visual appearance of any component
- Any server-side code

## File Impact

| File | Action |
|---|---|
| `components/chart/chartConfig.ts` | NEW — extracted config + utilities |
| `components/chart/useSeriesMarkers.ts` | NEW — shared marker hook |
| `components/chart/useChartOverlays.ts` | NEW — overlay management hook |
| `components/TradingChart.tsx` | REFACTOR — use extracted modules |
| `hooks/useTradeMetrics.ts` | NEW — shared trade metrics |
| `lib/types.ts` | EDIT — add SavedModel interface |
| `components/panels/BottomPanel.tsx` | EDIT — use shared hook + types |
| `pages/Dashboard.tsx` | EDIT — delete dead code, use shared hook |
| `hooks/useMarketData.ts` | DELETE |
