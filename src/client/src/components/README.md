# Components — React UI Components

335 component files organized by domain. Top-level components are page-level features; subdirectories group related functionality.

## Top-Level Components

| Component | Purpose |
|---|---|
| `Layout.tsx` | App shell: sidebar + main content area + breadcrumbs |
| `TradingChart.tsx` | Lightweight Charts candlestick chart with regime coloring, band fills, indicator overlays |
| `SubchartPanel.tsx` | Subchart indicator panels below main chart |
| `IndicatorSelector.tsx` | Category-colored indicator picker (151 indicators) |
| `IndicatorChartLayout.tsx` | Chart + indicator layout orchestration |
| `ExplainableAI.tsx` | XAI method selection and visualization |
| `LabelGeneration.tsx` | Label generation UI (16+ generators) |
| `LossSurface3D.tsx` | Three.js/R3F 3D loss surface visualization |
| `RegimeAnalytics.tsx` | Regime analysis dashboard |
| `RegimeLegend.tsx` | Regime color legend |
| `ForecastVisualizer.tsx` | Time-series forecast visualization |
| `CommandPalette.tsx` | Cmd+K command palette (cmdk) |
| `ErrorBoundary.tsx` | React error boundary with recovery |
| `QueryErrorBoundary.tsx` | TanStack Query error boundary with retry |
| `ReplayControls.tsx` | Chart replay/playback controls |
| `SpeedAuditPanel.tsx` | Performance audit panel |
| `TrainingSyncBanner.tsx` | Training sync status banner |
| `LoadingSkeletons.tsx` | Skeleton loaders (DataGrid, Chart, Page) |
| `NotImplemented.tsx` | Placeholder for unimplemented features |

## Subdirectories

| Directory | Files | Purpose |
|---|---|---|
| `ui/` | 58 | shadcn/ui primitives (Radix-based: Button, Dialog, Select, Tabs, etc.) |
| `renderers/` | 18 | Self-describing metric renderers (15 types + MetricGrid + RendererShell) |
| `training/` | 80+ | Training UI: live metrics, analytics (34), HPO, model tabs, config |
| `visualizations/` | 9 | Data visualizations: scatter, heatmap, timeline, force-directed, ribbon |
| `chart/` | - | TradingChart internal components |
| `sidebar/` | - | Navigation sidebar |
| `layout/` | - | App layout components |
| `terminal/` | - | Xterm.js terminal wrapper |
| `desktop/` | - | Electron-specific components |
| `curriculum/` | - | Learning curriculum UI |
| `panels/` | - | Reusable panel components |
| `indicator-selector/` | - | Indicator selection UI |
| `label-generation/` | - | Label generation UI components |
| `explainable-ai/` | - | XAI visualization components |
| `forecast-visualizer/` | - | Forecast display components |
| `regime-analytics/` | - | Regime analysis components |
| `charts/` | - | Chart utility components |
