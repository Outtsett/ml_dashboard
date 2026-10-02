# Pages — Application Pages

18 pages, all lazy-loaded via `lazyRetry` wrapper in `App.tsx`. Each page is wrapped with `ErrorBoundary` + `Suspense` via the `AppRoute` helper.

## Pages

| Route | File/Dir | Description |
|---|---|---|
| `/` | `MarketData.tsx` | Main charting page: candlestick charts, 151 indicators, regime overlays, subchart panels |
| `/ml-studio` | `MLStudio.tsx` | ML model management: dashboard + trades tabs |
| `/model-catalog` | `ModelCatalog.tsx` | Browse 300+ model specs with taxonomy filtering |
| `/databases` | `Databases.tsx` | Lake explorer: table list, query console, data upload |
| `/portfolio` | `Portfolio.tsx` | Portfolio: positions, allocation, trade history |
| `/watchlist` | `Watchlist.tsx` | Symbol watchlist |
| `/news` | `News.tsx` | News feed with sentiment analysis |
| `/hardware` | `Hardware.tsx` | CPU/GPU/RAM/disk telemetry |
| `/terminals` | `Terminals.tsx` | Embedded terminal sessions (xterm.js + node-pty) |
| `/fourier` | `FourierTransform.tsx` | FFT + Hilbert transform analysis on price data |
| `/architecture` | `ArchitectureExplorer.tsx` | ML architecture comparison (Transformer, LSTM, XGBoost, Hybrid) |
| `/settings` | `Settings.tsx` | App preferences, market-data config, training settings, server status |
| `*` | `not-found.tsx` | 404 page |

## Multi-File Pages

Complex pages are split into subdirectories:

### `market-data/`
- `ChartPanel.tsx` — Main chart container
- `Toolbar.tsx` — Symbol/timeframe selector
- `AnalyticsStrip.tsx` — Quick analytics below chart
- `IntegratedTabs.tsx` — Tabs below chart area

### `training/`
- `PhasePanel.tsx` — Phase-aware main panel
- `PhaseSidebar.tsx` — Phase navigation sidebar
- `HPOWorkflow.tsx` — HPO workflow UI
- `PipelineOverview.tsx` — Training pipeline overview

### `databases/`
- `TableList.tsx` — Lake table browser
- `TablePreview.tsx` — Table data preview
- `QueryConsole.tsx` — SQL query console
- `StatsCards.tsx` — Database statistics
- `UploadTab.tsx` — File upload interface
- `LakeControls.tsx` — store lifecycle controls. The lake has no process to start or stop; pending removal with the `src/client` port.

### `backtest/`
- `ConfigPanel.tsx` — Backtest configuration
- `ResultsTab.tsx` — Results summary
- `TradesTab.tsx` — Individual trades
- `WalkForwardTab.tsx` — Walk-forward results
- `MonteCarloTab.tsx` — Monte Carlo simulation
- `BenchmarkTab.tsx` — Benchmark comparison
- `CostsTab.tsx` — Cost analysis

### `settings/`
- `PreferencesTab.tsx` — User preferences
- `LakeConfigTab.tsx` — market-data connection config. The lake needs no host/port/credential; pending removal with the `src/client` port.
- `TrainingSettingsTab.tsx` — Training defaults
- `ServerStatusTab.tsx` — Server health
- `PerformanceTab.tsx` — Performance settings
- `DesktopTab.tsx` — Electron desktop settings

### `fourier-transform/`
- `FourierCanvas.tsx` — FFT visualization canvas
- `FourierControls.tsx` — Parameter controls
- `HilbertAnalytics.tsx` — Hilbert transform analytics
- `PriceFourierInfo.tsx` — Price-domain Fourier info

### `architecture-explorer/`
- `TransformerDetail.tsx` — Transformer architecture detail
- `LSTMDetail.tsx` — LSTM architecture detail
- `XGBoostDetail.tsx` — XGBoost detail
- `HybridDetail.tsx` — Hybrid architecture detail
- `ComparisonMatrix.tsx` — Side-by-side comparison
- `PipelineOverview.tsx` — ML pipeline overview

