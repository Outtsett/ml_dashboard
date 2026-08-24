# Trade Lab Consolidation — Implementation Record

**Status:** ✅ Done — 2026-05-04
**Plan source:** `C:\Users\tyler\.claude\plans\go-to-the-ml-glowing-perlis.md`

## Why

Two chart-centric pages (`Market Data` at `/`, `ML Studio` at `/ml-studio`) overlapped heavily — both rendered the same `TradingChart` with the same indicator subcharts. Trade entry/exit markers existed but were passive: no click-to-inspect, no MAE/MFE/conf/regime context, no equity-vs-chart linking, no per-trade analytics. Primary use of the dashboard is data analysis and plotting model trades; the old layout made raw price exploration easy and trade analysis hard. Consolidation inverts that.

## What changed

Single `/` route — **Trade Lab** — with two modes:

- **No run selected** → behaves exactly like the old Market Data page (asset/symbol/timeframe picker, 151 indicators, CDL patterns, S/R + zigzag + structure overlays, regime shading, replay, training sync).
- **Run selected** → trade-analysis layers fade in:
  - entry/exit markers on chart, click → right-side detail drawer
  - equity + drawdown panel below the chart
  - bottom row: 3 analytics tiles (ConfPnLScatter via visx, RegimePnLBars via recharts, MAEMFEHistogram via recharts) + sortable trade list
  - all tiles + list + headline metrics filtered to the visible chart window

ML Studio sub-tabs promoted to top-level routes: `/training`, `/backtest`, `/forecast`, `/curriculum`. Chat promoted to `/chat`. `/ml-studio` and `/market-data` 301-redirect to `/`.

## Files

**Added:**
- `src/client/src/contexts/TradeLabContext.tsx`
- `src/client/src/pages/trade-lab/index.tsx`
- `src/client/src/pages/trade-lab/TradeLabToolbar.tsx`
- `src/client/src/pages/trade-lab/TradeLabStatStrip.tsx`
- `src/client/src/pages/trade-lab/TradeDetailDrawer.tsx`
- `src/client/src/pages/trade-lab/EquityDrawdownPanel.tsx`
- `src/client/src/pages/trade-lab/TradeListPanel.tsx`
- `src/client/src/pages/trade-lab/MarketToolbar.tsx` (was `pages/market-data/Toolbar.tsx`)
- `src/client/src/pages/trade-lab/MarketAnalyticsStrip.tsx` (was `pages/market-data/AnalyticsStrip.tsx`)
- `src/client/src/pages/trade-lab/types.ts` (was `pages/market-data/types.ts`)
- `src/client/src/pages/trade-lab/hooks/useChartOverlayData.ts` (was `pages/market-data/`)
- `src/client/src/pages/trade-lab/hooks/useTradeLabRun.ts`
- `src/client/src/pages/trade-lab/hooks/useEquityCurve.ts`
- `src/client/src/pages/trade-lab/analytics/ConfPnLScatter.tsx`
- `src/client/src/pages/trade-lab/analytics/RegimePnLBars.tsx`
- `src/client/src/pages/trade-lab/analytics/MAEMFEHistogram.tsx`
- `src/client/src/pages/Forecast.tsx` (page wrapper for ForecastVisualizer)
- `src/client/src/pages/Chat.tsx` (page wrapper for ChatTab)

**Removed:**
- `src/client/src/pages/MarketData.tsx`
- `src/client/src/pages/MLStudio.tsx`
- `src/client/src/pages/market-data/` (7 files: index, Toolbar, AnalyticsStrip, useChartOverlayData, types, IntegratedTabs, ChartPanel)
- `src/client/src/pages/ml-studio/` (2 files: DashboardTab, TradesTab)

**Modified:**
- `src/client/src/App.tsx` — `/` → TradeLab; added redirects for `/ml-studio` and `/market-data`; lazy routes for `/training`, `/backtest`, `/forecast`, `/curriculum`, `/chat`
- `src/client/src/lib/navigation.ts` — sidebar leads with Trade Lab; ML Studio + Market Data entries removed
- `src/client/src/hooks/useChartOHLCV.ts` — import path for `OhlcvData` updated
- `src/client/src/components/IndicatorChartLayout.tsx` — added `onMainRangeChange` pass-through prop (Trade Lab uses it to scope equity/list/stats to visible window)
- `src/client/src/components/TradingChart.tsx` — accepts `onTradeMarkerClick` callback
- `src/client/src/components/chart/types.ts` — added `onTradeMarkerClick` to `TradingChartProps`
- `src/client/src/components/chart/useChartMarkers.ts` — `chart.subscribeClick` + nearest-bucket id resolution against `tradeMarkers`
- `src/client/CLAUDE.md` + `src/client/README.md` — page count + Trade Lab references

## Data flow (key paths)

- **Click-on-marker:** chart click → `useChartMarkers.subscribeClick` resolves nearest aligned-bucket → `TradeLabContext.setSelectedTradeId` → fans out to drawer / list / scatter (highlights selected dot).
- **Run selection:** toolbar run picker → `useTradeLabRun(runId)` fetches `/api/backtest/trades/:runId` → trades + computed `TradeMarker[]` (id-encoded as `tl-<tradeId>-<entry|exit>`) → `useEquityCurve(trades)` derives `equity / drawdown / peak`.
- **Visible-range sync:** `IndicatorChartLayout.onMainRangeChange` → `TradeLabContext.setVisibleRange` (bar-index range converted to seconds-epoch) → equity panel, analytics tiles, stat strip, and trade list all filter by it.

## Verification (executed 2026-05-04)

- `npx tsc --noEmit` — only 7 pre-existing errors remain (`metric_extractors.ts`, `pages/fourier-transform/`); zero from this work
- `npm run build` — clean, ~30s frontend build, ~700ms server build
- `npm test` — 92 tests pass; 7 pre-existing test files fail on unrelated missing modules

## Deferred / not in scope

- Live mode rolling-confidence sparkline (no clear trigger without a model picker UI)
- Storybook stories for new components
- Unit tests for `useEquityCurve`, `useTradeLabRun`, `TradeDetailDrawer`, click-resolution logic
- Trade Lab E2E test
