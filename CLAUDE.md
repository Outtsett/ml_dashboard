# ML Dashboard

Full-stack ML Dashboard for quantitative trading research. Electron desktop app + web (React 19 + Express 5 + NestJS 11) with a 2-database architecture (SQLite 37 tables + QuestDB 5 tables). Primitives Discovery + TensionFlow scorer. MotiveWave ILP plugin streams live OHLCV, ticks, and DOM L2 data. No external experiment tracking — all metrics via built-in SSE protocol. CNN+Transformer triple barrier predictor extracted to `E:\source\repos\cnn_transformer` on 2026-04-01. HDP-HMM and 2-state-HMM models removed on 2026-04-03.

## Project Scale
- **335 React component files**, 28 pages, 27 route files, 111 Python ML files, 38 scripts, 38 test files
- **108 npm dependencies**, 51 devDependencies, 8 config JSONs
- **Node 22.20**, Python 3.13, TypeScript, Numba JIT, Polars
- **181 commits** on `feature/triple-barrier-training` branch (pushed to GitHub)
- **Trained models**: see data/models/
- **MotiveWave plugin**: QuestDB ILP Stream study — streams OHLCV (with orderflow), ticks (with exchange IDs), and Level 2 DOM to QuestDB in real-time

## Tech Stack

- **Frontend**: React 19, Wouter router, TanStack Query, Tailwind v4, shadcn/ui (Radix), Recharts, Lightweight Charts, Three.js/R3F, D3, Framer Motion, visx 3.12 (SVG primitives)
- **Backend**: Express 5, TypeScript, Node.js
- **ORM**: Drizzle ORM with Zod validation
- **ML**: PyTorch 2.10+CUDA, Pydantic 2.12 (diagnostics schema validation), Numba, Optuna, Polars, bottleneck 1.6 (fast rolling ops)
- **Indicators**: 151 technical indicators computed 100% client-side from raw OHLCV bars (no server-side indicator code)
- **Desktop**: Electron 34
- **Testing**: Vitest, @testing-library/react 16.3, msw 2.12 (API mocking), pytest, pytest-benchmark
- **Build**: Vite 7, esbuild, tsx

## Database Architecture

Two databases with distinct responsibilities:

| Database          | Role                                                  | Persistent? | Connection                                 |
| ----------------- | ----------------------------------------------------- | ----------- | ------------------------------------------ |
| **SQLite**        | App metadata: users, ML models, training, instruments, model checkpoints, prediction logs | Yes | Embedded (`data/ml_dashboard.db`) |
| **QuestDB 9.3.3** | Source of truth for ALL time-series data (unified multi-asset) + live prediction_log | Yes | HTTP `:9000`, ILP `:9009`, PG wire `:8812` |

Plus file-based stores:

| Store          | Role                                | Size |
| -------------- | ----------------------------------- | ---- |
| `data/models/` | Trained model checkpoints | Var. |

### When to Use Which

- **SQLite**: All CRUD, relationships, metadata — model registry, trade logs, backtest results, instruments, uploads, labels, ensembles, training sessions, news
- **QuestDB**: ALL time-series queries — chart rendering (`SAMPLE BY`), training data (Python reads via PG wire). Unified `ohlcv` table with `asset_class`/`root` columns for all instruments. OHLCV-only — no feature/indicator tables.

### Database Paths (Local Installs)
```
SQLite:     data/ml_dashboard.db (embedded, WAL mode)

QuestDB:    E:\source\databases\questdb-9.3.3-rt-windows-x86-64\
  bin:      E:\source\databases\questdb-9.3.3-rt-windows-x86-64\bin\java.exe
  service:  Registered as Windows service "QuestDB" (nssm, auto-start)
```

### QuestDB Schema — Unified Multi-Asset (rebuilt 2026-03-24)

Single unified `ohlcv` table for ALL asset classes (futures, forex, equities, crypto) with `asset_class` and `root` SYMBOL INDEX columns. No per-asset-class table splitting. PostgreSQL eliminated.

**Tables (5)**:

| Table | Rows | Partition | Dedup | Key Columns |
| ----- | ---- | --------- | ----- | ----------- |
| `ohlcv` | 863M | DAY | yes | symbol, asset_class, root, timestamp, open, high, low, close, volume, trades, vol_at_bid, vol_at_ask, trades_at_bid, trades_at_ask |
| `symbols` | 904 | YEAR | yes | symbol, asset_class, root, exchange, currency, tick_size, point_value, pip_size, contract_size, decimal_places, timestamp |
| `ticks` | 1.3M | DAY | no | symbol, asset_class, root, side, price, volume, bid, ask, bid_size, ask_size, spread, timestamp |
| `dom_l2` | 4.9M | DAY | no | symbol, asset_class, root, side, level, price, size, order_count, timestamp |
| `dom_summary` | 206K | DAY | no | symbol, asset_class, root, best_bid, best_ask, spread, total_bid_size, total_ask_size, bid_levels, ask_levels, imbalance, timestamp |

**Asset classes**: futures (817.6M OHLCV rows, 8 roots: ES, NQ, MNQ, MES, YM, MYM, RTY, M2K), forex (38.6M rows, 18 pairs)

No materialized views — all timeframe aggregation done on-the-fly via `SAMPLE BY` from the base `ohlcv` table.

**Data Ingestion**: Two paths:
1. **MotiveWave ILP plugin** (real-time): Java study streams OHLCV + ticks + DOM L2 directly to QuestDB port 9009. Auto-derives `asset_class`/`root` from SDK `Instrument.getType()`. Orderflow fields (vwap, trades, vol_at_bid/ask) from SDK `Bar` interface. Tick flush: every 50 ticks or 2s timeout. DOM throttle: 100ms configurable.
2. **Node.js Sender**: File uploads and watcher-based CSV ingestion. Dedup tracked in SQLite `ingested_files`.

**QuestDB Service**: Windows service "QuestDB" via nssm, AUTO_START, failure recovery (restart after 5s/10s/30s).

**QuestDB Performance Features**:
- `SAMPLE BY` aggregation for any timeframe on the fly (5m, 15m, 1h, 4h, 1d, 1w)
- `LATEST ON` for instant last-value-per-symbol lookup
- `ASOF JOIN + TOLERANCE` for trade-to-quote matching
- JIT-compiled WHERE filters (SIMD/AVX2, ~3.3 GB/s)
- Detach/Attach partitions for cold storage
- Materialized views with `immediate` refresh for zero-query-latency timeframe aggregation

**QuestDB as Windows Service**:
- Managed via `nssm` (Non-Sucking Service Manager)
- Auto-starts on boot, auto-restarts on crash
- `nssm start/stop/status QuestDB` to manage

### SQLite Schema (`src/shared/schema.ts`)

**User & Auth**: `users`
**ML Observatory**: `ml_models`, `feature_sets`, `model_outputs`, `coherence_snapshots`, `ensemble_configs`, `generated_labels`, `contrastive_pairs`, `market_regimes`
**Trading & Backtesting**: `trades`, `backtest_runs`, `backtest_trades`, `broker_configs`, `instruments`, `feature_importance`
**Training & Data**: `training_sessions`, `loss_history`, `uploads`, `ingested_files`, `news_articles`, `news_symbols`

### Standardized OHLCV Schema

All market data in unified `ohlcv` table: `symbol` (SYMBOL), `asset_class` (SYMBOL), `root` (SYMBOL), `timestamp` (TIMESTAMP), `open`, `high`, `low`, `close`, `volume` (DOUBLE)

- `asset_class`: `futures`, `forex`, `equity`, `crypto` — adding new asset classes requires zero DDL
- `root`: `ES`, `MNQ` for futures contracts/spreads; same as symbol for forex/equities — enables `WHERE root = 'ES'` instead of regex
- ILP ingestion auto-derives `asset_class` and `root` from symbol via `deriveAssetFields()` in `connection.ts`
- Futures: Continuous contracts built by volume-based front-month detection from OHLCV data. No separate rollovers table — `getFrontMonthOHLCV()` picks the highest-volume contract per day.
- Forex: `pipSize` varies (0.0001 standard, 0.01 for JPY pairs)

### Data Pipeline

```
MotiveWave (live trading platform)
    |
    +--> [QuestDB ILP Stream Study] ──→ QuestDB ILP :9009
    |       OHLCV (with orderflow: vwap, trades, vol_at_bid/ask)
    |       Ticks (price, volume, BBO, exchange order IDs)
    |       DOM L2 (10-50 levels per side, 100ms throttle)
    |       DOM Summary (spread, depth, imbalance)
    |
QuestDB (source of truth, 863M+ rows, 5 tables, unified multi-asset)
    |
    +--> Python training reads QuestDB directly (PG wire :8812)
    |        |
    |        v
    |    features.py computes 29 inline features from raw OHLCV
    |        |
    |        v
    |    ML model training → saves artifacts to data/models/
    |
    +--> Chart API (SAMPLE BY on base ohlcv table)
    |
    +--> Node.js watcher (CSV file ingestion, legacy path)
```

## Project Structure

```
client/src/
  pages/            18 pages: MarketData, MLStudio, ModelCatalog, Training, Backtest,
                    Portfolio, Watchlist, News, Databases, Gpu, Hardware, SystemMatrix,
                    Settings, Terminals, Curriculum, ArchitectureExplorer, FourierTransform, not-found
  components/       shadcn/ui + domain components (ExplainableAI,
                    LabelGeneration, LossSurface3D, TradingChart)
  components/renderers/  15 metric renderers: Gauge, Number, Percent, Bars, PrecisionBars,
                    ConfusionMatrix, FoldBars, ChartOverlay, TimeSeries, Heatmap, Distribution,
                    Table, Ring, Text, Surface3D + RendererShell + MetricGrid (12-col responsive grid)
  components/training/
    ConfigStrip.tsx      Inline config cards (model, market, hyperparameters, run/stop) — replaces old header bar
    ModelBrowser.tsx     Collapsible trained-model tree (type → instrument → checkpoints)
    GroupTabs.tsx        Auto-generated group tab navigation from metric declarations (model-agnostic)
    LiveTrainingView.tsx Split layout for live training: streaming metrics (left) + terminal log (right) + awaiting group pills
    live/           MetricPanel, ConvergenceChart, RegimeCountTracker, TransitionMatrixHeatmap, IterationMetrics
    analytics/      34 components: BenchmarkComparison, ClassificationPerformance, ClusterProfileCards,
                    ClusterScatter, ConfidenceCalibration, ConvergenceAnalytics, DashboardSummary,
                    DataQuality, ElbowBicCurve, EmissionHeatmap, FeatureCorrelation, MetricScorecard,
                    MicrostructureAnalytics, ModelHistory, ParameterTraces, PerformanceAttribution,
                    PerformanceTimeSeries, PerRegimeShapCards, PosteriorHeatmap, QualityGatePanel,
                    RadialGauge, RecommendationEngine, RegimeCentroidScatter, RegimeProfileCards,
                    RegimeTimeline, ResourceUsage, ReturnDistributions, ShapBeeswarm, ShapEvolution,
                    SilhouettePlot, TrainTestTimeline, TransitionSankey, WalkForwardWindows, BetaWeightArea
    tabs/           ConvergenceTab, PerformanceTab, ShapTab, ModelStateTab (used by ML Hub, not Training page)
  components/visualizations/  8 types: AnomalyTimeline, ComponentLoadings,
                    ConfusionMatrixHeatmap, EmbeddingScatter, ForceDirectedCluster,
                    ForecastRibbon, ResidualPlot, SimilarityMatrix
  hooks/            useChartOHLCV, useActiveIndicators (professional indicator system), use-toast,
                    useMetricDescriptions (config-driven metric annotations per model type),
                    useTrainedModels (multi-instrument model grouping: type → instrument → checkpoints),
                    useGpuMetrics (SSE-driven GPU telemetry: snapshot, history, device info),
                    useModelCheckpoints, useSystemManifest, useSystemMatrix
  lib/              query_client, prefetch, ml_models (50+ model definitions), indicator_registry (151 indicator definitions),
                    indicator_compute (dispatcher), candle_patterns (60 client-side CDL patterns),
                    indicator_panels, indicator_colors, utils
                    calculators/  math_primitives, overlay_extra, momentum_extra, volatility_extra,
                                  volume_extra, trend_extra, statistics_extra, cycle_performance

server/
  main.ts           Express app + NestJS DI bootstrap
  core/routes.ts    Route registration (17 routers)
  routes/           upload, instruments, training, training-artifacts, hpo,
                    ml/ (observatory, sessions, labels, xai, forecasts),
                    news, databases/ (explorer, infrastructure), charts,
                    backtest, system, settings, modelCatalog,
                    curriculum, motivewave, events, pipelines, chat
  database/
    db.ts           Drizzle SQLite connection (better-sqlite3, WAL mode)
    health.ts       Cross-DB health monitoring (SQLite + QuestDB, circuit breaker)
    database.module.ts  NestJS DI module (QuestDBService, SQLiteService)
    questdb.service.ts  NestJS QuestDB facade
    sqlite.service.ts   NestJS SQLite facade
    automation.service.ts  QuestDB automation service
    questdb/
      connection.ts   Low-level clients (Sender, pg.Pool, queryQuestDB, insertOHLCVBatch — auto-derives asset_class/root)
      marketData.ts   Unified OHLCV queries (single table), front-month stitching via volume detection
      introspection.ts  Schema metadata (SHOW TABLES, columns, partitions, stats)
      httpQuery.ts    QuestDB HTTP API (questdbHttpQuery, questdbExportParquet, questdbImportCSV)
      tables.ts       DDL (createOHLCVTable — unified schema with asset_class/root)
      lifecycle.ts    QuestDB process lifecycle (start, stop, status)
      integration.ts  Circuit-breaker-wrapped insert/query + pipeline metrics
      ohlcvQuery.ts   OHLCV query orchestration (health check, time-window estimation, caching)
      index.ts        Barrel re-exporting all sub-modules
  cache/            Unified server-side cache layer (all 7 caches instrumented, event-driven invalidation)
    index.ts        Barrel exports + clearAllCaches() + getCacheStats() (all 7 caches)
    ohlcv.ts        OHLCV bar LRU cache (500 entries, 60min TTL, 200MB cap)
    query.ts        Event-driven query cache (LRU, 5min TTL, ingestion/model/training events)
    anchor.ts       Chart anchor cache (per-symbol, 5min TTL, ingestion-invalidated)
    symbols.ts      QuestDB symbols catalog cache (1hr TTL, warm on startup)
    model.ts        Model results cache (100 entries LRU, model.retired event-invalidated)
    labels.ts       Label preview cache (50 entries, 15min TTL, ingestion-invalidated)
    parquet.ts      Parquet cache management (2GB cap, 24h stale cleanup, 10min periodic)
    headers.ts      HTTP Cache-Control middleware (CACHE_STATIC, CACHE_SEMI) + ETags enabled globally
    ARCHITECTURE.md Full cache layer docs (inventory, invalidation flows, config)
  storage/          Drizzle queries for all SQLite tables (domain sub-interfaces)
  training/
    registry.ts     Config reader (src/config/models.json, features.json, training.json)
    orchestrator.ts Central coordinator — startTraining, stopTraining, session management
    runners/
      types.ts      ITrainerRunner interface, session management, SSE event buffering
      pythonRunner.ts  Spawns Python scripts, parses stdout (training metrics)
      parsers/      Output parsers per model type
  lib/
    ingestion/      standardize, uploadProcessor
    labels/         sqlLabelGenerators (15+ types), contrastivePairs, labelService
    xai/            xaiService (9 methods: SHAP, LIME, GradCAM, Integrated Gradients,
                    Saliency, Permutation, Feature Interaction, Calibration, Counterfactual)
    circuitBreaker.ts  Auto-disable failing DB connections
    rateLimiter.ts  API 100/min, ML 50/min, upload 10/min
    metrics.ts            Performance tracking
    ollama.ts       Ollama HTTP client (streaming chat + model listing, localhost:11434)
  hpo.service.ts    HPO orchestration (Optuna integration)
  training.service.ts  NestJS training service
  training.module.ts   NestJS training module

ml/                 Python ML model packages (shared, primitives_discovery, tensionflow + optimizers)
  shared/           Shared across ALL models
    features.py     Config-driven feature computation (35 features, 10 categories). Numba JIT rolling stats. normalize_features() uses O(1) memory numba rolling z-score (handles 2M+ rows, no OOM).
    normalizer.py   Feature classification (8 types) + transform functions (rolling_zscore, scale_bounded, pct_from_close, price_ratio, cumulative_roc). Constants: ROLLING_WINDOW=50, CLIP_RANGE=5.0
    feature_extract.py      Indicator-to-feature derivation transforms (8 transforms: roc, distance_from, percentile_rank, zscore, divergence, squeeze, crossover_dist, acceleration). Numba JIT kernels, joblib parallel across categories, parquet cache layer for QuestDB data. Config-driven via feature_extraction.json.
    feature_correlation.py  Pairwise correlation (polars+numpy corrcoef), hierarchical clustering, batch VIF via matrix inverse, redundancy detection, feature drop suggestions
    feature_importance.py   Permutation importance (joblib-parallelized, supervised + unsupervised ARI), mutual information (subsampled to 100k), SHAP wrapper, cumulative importance, aggregate ranking
    trajectory.py   TrajectoryRecorder — records model weight snapshots during training, PCA projection for 3D trajectory visualization. Lazy sklearn import. get_live_trajectory() returns dashboard-ready dict, get_pca_directions() returns (pc1, pc2, center) for loss surface alignment.
    loss_surface.py compute_loss_surface() — Li et al. 2018 filter-normalized random directions for 2D loss landscape visualization. Supports PCA directions from TrajectoryRecorder, incremental resolution (11x11 coarse -> full grid), surface diagnostics (sharpness, condition_number, valley_width, locally_convex). try/finally weight restoration.
    swing.py        Causal zigzag detection (no lookahead)
    protocol.py     JSON stdout protocol (emit_progress, emit_metric, etc.)
    data.py         QuestDB OHLCV loading via PG wire (psycopg2)
shared/
  schema.ts         SQLite tables (Drizzle definitions + Zod validation)
  mlTaxonomy.ts     ML categories, subcategories, metrics, XAI method registry (~1600 lines)
  trainingTypes.ts  Universal training types (TrainingRequest, SSE events, overlay payloads, Surface3D types)
  event-types.ts    SSE event type definitions
  hpoTypes.ts       HPO session and trial types
  ohlcv.ts          Shared OHLCV type definitions
  validation.ts     Shared validation schemas
  strategyTypes.ts  Trading strategy types
  categoryMetrics.ts  ML category metrics
  delta.ts          SSE delta encoding/decoding (computeDelta, applyDelta, DELTA_MARKER)

src/config/
  models.json       Model registry (runner, script, hyperparams, CLI flags, metricDeclarations)
  features.json     Feature registry (35 features, 10 categories, normalization config)
  feature_extraction.json  Per-indicator transform specs (13 categories)
  metric-descriptions.json  Legacy metric annotations (superseded by metricDeclarations in models.json)
  training.json     Infrastructure: paths, limits, timeframe map
  cost_model.json   Trading cost model (commissions, slippage per broker)
  visualizations.json  Config-driven visualization component registry

scripts/                       76 scripts total
  feature-research.py          Feature engineering research: extract derived features from indicators, correlation analysis, importance testing. Output: data/feature_research/{symbol}/{tf}/
  cleanup_questdb.py           Drop non-OHLCV tables from QuestDB (idempotent, --dry-run supported)
  dump-questdb-parquet.py      One-time QuestDB table export to parquet (monthly partition fetch). Output: data/.cache/{table}_{symbol}.parquet
  visualize-regimes.py         DEPRECATED — HMM model code removed (2026-04-03)
  training_monitor.py          Live Plotly Dash training monitor (tails convergence.json, 5s refresh, port 8050)
  dash_training_viewer.py      Plotly Dash training viewer
  prediction_viewer.py         DEPRECATED — being replaced by PredictionsPanel in dashboard. Standalone Dash app for OOS prediction overlay (port 8051).
  seed-instruments.ts          Upsert 25 instruments (8 futures + 17 forex)
  inspect-sources.ts           Inspect source data files
  hardware_node.py             System hardware info collector
  ingest-oanda.ts              Oanda forex data ingestion
  test_primitives.py           Primitives discovery model test
  audit_chat.mjs               Chat component audit
  audit_visuals.mjs            Visualization component audit
  orb_*.py                     Opening range breakout analysis suite (20+ scripts)

motivewave-plugin/        MotiveWave Java plugin (Maven, JDK 17)
  src/main/java/com/mldashboard/motivewave/
    QuestDBStreamStudy.java   Study that streams OHLCV+ticks+DOM to QuestDB via ILP TCP
    util/ILPClient.java       Lightweight ILP TCP client (line protocol construction, reconnect)
  pom.xml                     Maven build (system dep on E:/MotiveWave/lib/mwave_sdk.jar)
  .mvn/jvm.config             JVM flags (--enable-native-access)
  dist/MLDashboardPlugin.jar  Built JAR → deployed to ~/MotiveWave Extensions/

electron/
  main.cjs             Electron main process
  start-databases.cjs  Database lifecycle (QuestDB java.exe)
  preload.cjs          Preload script

data/
  ml_dashboard.db      SQLite database (WAL mode, 37 tables — added model_checkpoints, prediction_log)
  models/              Trained model checkpoints (diagnostics.json, convergence.json, assignments.csv)
  .cache/              Parquet cache for QuestDB data (auto-populated, 24h TTL)
  feature_research/    Feature engineering research outputs (per symbol/timeframe)

## Trained Models (as of 2026-04-01)

### On Disk (`data/models/`)

CNN+Transformer models extracted to `E:\source\repos\cnn_transformer` (2026-04-01). HDP-HMM and 2-state-HMM models removed (2026-04-03).

### Self-Describing Diagnostics Architecture

Models emit their own metric declarations — the dashboard renders whatever the model declares. No model-type-specific UI code needed. Adding a new model type takes minutes, not sprints.

**TypeScript schema**: `src/client/src/lib/diagnostics-schema.ts` — RendererType (15 types incl. surface_3d), MetricDeclaration, MetricContext, SelfDescribingDiagnostics
**Pydantic schema**: `src/ml/shared/diagnostics_schema.py` — mirrors TypeScript exactly, validates before JSON emission
**Renderer components**: `src/client/src/components/renderers/` — 15 crafted renderers + RendererShell + MetricGrid + index.ts (registry). Includes Surface3DRenderer (Three.js/R3F) for 3D loss surface + trajectory.
**Training Page**: Phase-aware adaptive layout. LIVE: ConfigStrip → LiveTrainingView (split: streaming metrics + log + awaiting group pills). POST: ConfigStrip → GroupTabs (auto-generated from metric declarations) → MetricGrid (filtered to active group) → ModelBrowser. Fully model-agnostic — different models produce different tabs automatically.
**Loss Surface**: `src/ml/shared/loss_surface.py` — Li et al. 2018 filter-normalized random directions, 51x51 grid with incremental refinement. `src/ml/shared/trajectory.py` — PCA-projected weight trajectory recorder for live training visualization.
**Section Colors**: deep_learning=purple, machine_learning=cyan, trading=amber, regimes=orange, quality=teal, features=indigo
**Metric Declarations**: models.json defines per-model metrics with renderer, mission, context, group, order. Declarations in `src/config/models.json` metricDeclarations.

**Renderer types**: gauge, number, percent, bars, precision_bars, confusion_matrix, fold_bars, chart_overlay, time_series, heatmap, distribution, table, ring, text

**API**: `src/server/routes/models.ts` — 12 endpoints for model checkpoints + predictions (GET/POST/PATCH/DELETE)
**DB tables**: `model_checkpoints` (SQLite, diagnostics JSON + metadata), `prediction_log` (SQLite + QuestDB hot path)
**SSE events**: metric_declarations, hpo_trial_start/done, fold_start/done (added to parser + TrainingEventType)

### Feature Pipeline
- **35 base features** across 10 categories in `src/config/features.json`
- **280 derived features** (8 transforms per base feature)
- Feature research outputs in `data/feature_research/` (ES, MNQ subdirs)

mcp_server/              FastMCP server (Python) for Claude.ai web + Claude Code
  server.py              FastMCP instance, lifespan, auth, health
  run.py                 Entry point (streamable HTTP or stdio)
  db/
    validation.py        SQL injection protection, table allowlists, row limits
    questdb_conn.py      psycopg2 pool (PGWire :8812)
    sqlite_conn.py       sqlite3 read-only connection
  tools/
    questdb_tools.py     7 QuestDB tools (query, tables, columns, sample, ohlcv, symbols, inventory)
    sqlite_tools.py      6 SQLite tools (query, tables, columns, sample, training_sessions, models)
```

## Path Aliases (tsconfig.json)

- `@/*` -> `./client/src/*`
- `@shared/*` -> `./shared/*`

## SOLID Principles

All new code **must** follow SOLID. Apply everywhere — routes, components, hooks, services, ML trainers.

### SRP — Single Responsibility
> One module, one job. One reason to change.

- **Route files**: HTTP concern only — parse params, call storage/service, return JSON. No business logic inline.
- **`storage.ts` methods**: DB query only — no HTTP, no formatting, no side-effects.
- **React components**: Render only. Data-fetching → custom hooks. Business logic → utils.
- **Hooks**: One hook per data concern. Never a mega-hook that fetches everything.
- **Python scripts**: Each script does one pipeline step (`feature-research.py` → feature extraction only).

### OCP — Open/Closed
> Add new behavior by adding new code, not by editing existing code.

- **ML models**: New model = new directory in `src/ml/` (main.py, model.py, config.py, io/) + entry in `src/config/models.json`. Shared utils live in `src/ml/shared/`.
- **TensionFlow scorer**: `src/ml/tensionflow/` — Level 1 only (no DOM). 5 signals: S_spatial, S_momentum, S_band_direction, S_volume_profile, S_structure. Entry requires Confluence > 1.5 + Alignment > 0.60. 278 tests.
- **Indicators**: Add calculator function in `src/client/src/lib/calculators/` + entry in `indicator_registry.ts` — never add `if (name === 'x')` branches.
- **Label generators**: Add to `sqlLabelGenerators.ts` registry — callers iterate the registry, never reference specific types.
- **React pages**: New file in `client/src/pages/` + one route entry in `App.tsx` — no other files change.

### LSP — Liskov Substitution
> Any implementation of an interface must be a drop-in replacement.

- **`ITrainerRunner`**: `PythonRunner` implements the interface — the orchestrator depends on the abstraction, not the concrete runner.
- **`questdbHttpQuery<T>()`**: Always returns `T[]` — callers trust the return contract, no surprises.
- **React components**: If a prop type says `Trade[]`, every valid `Trade[]` must work — no hidden shape assumptions.

### ISP — Interface Segregation
> Don't force a module to depend on methods it doesn't use.

- **Route handlers**: Import only the specific `storage.*` methods needed — not the whole `storage` object.
- **React hooks**: Expose only the data the component needs — `useChartCandles()` should not also return model list.
- **Types**: Split large interfaces. Accept `ModelSummary { id, name }` instead of full `MLModel` when only those fields are used.
- **`shared/schema.ts`**: Export focused `Insert*` + select types per table — callers import only what they need.

### DIP — Dependency Inversion
> Depend on abstractions (interfaces/functions), not on concrete implementations.

- **Routes → Storage**: Route handlers call `storage.*` (abstraction) — never call `db.select().from(table)` directly inside a route.
- **Orchestrator → Runner**: `TrainingOrchestrator` depends on `ITrainerRunner` interface — never imports `PythonRunner` directly; receives runner via factory.
- **QuestDB access**: All code calls `questdbHttpQuery()` / `getOHLCVSampleBy()` abstractions — never constructs raw HTTP requests directly.
- **React → API**: Components depend on TanStack Query hooks — never call `fetch('/api/...')` directly inside a component body.

## Key Architectural Patterns

- **EventEmitter training**: `MLTrainer extends EventEmitter` emits progress events per epoch. Frontend connects via SSE at `GET /ml/train/stream`.
- **Config-driven features**: `src/config/features.json` is the single source of truth for all 35 features across 10 categories. Python `features.py` reads this config via dispatch table. Adding a feature = add JSON entry.
- **Indicator system**: 151 technical indicators computed 100% client-side from raw OHLCV bars. Calculator files in `src/client/src/lib/calculators/` (math_primitives, overlay_extra, momentum_extra, volatility_extra, volume_extra, trend_extra, statistics_extra, cycle_performance). Registry in `src/client/src/lib/indicator_registry.ts`, dispatch in `src/client/src/lib/indicator_compute.ts`. Users add/configure/remove indicator instances via `useActiveIndicators` hook. Each instance is independently parameterized. CDL_* candlestick patterns (60 patterns) via `lib/candle_patterns.ts`. NO server-side indicator calculation. `feature_extraction.json` still used by ML training pipeline.
- **Front-month stitching**: Futures root symbols (ES, MNQ, M2K, etc.) are stitched at query time by volume-based front-month detection from OHLCV data. No separate rollovers table — the active contract is whichever had the highest daily volume. Frontend references root symbols only. **Performance**: Cold stitching takes 9-13s (scans 200M+ rows for daily volume). Cached for 60 min after first load. The `ohlcv_continuous`/`rollovers` tables from the 2026-02-23 design doc were never built — stitching is on-demand only.
- **Circuit breaker**: Auto-disable failing DB connections. States: closed (normal), open (failing, fast-fail), half-open (testing). Reset via `POST /circuit-breaker/reset/:name`.
- **File-level dedup**: SHA-256 hash tracking in SQLite `ingested_files` table prevents re-ingestion.
- **Chart data flow**: QuestDB `SAMPLE BY` for chart candles. Futures roots use front-month stitching (`getStitchedOHLCV` → `getFrontMonthOHLCV`); forex uses direct `queryQuestDBFast` (HTTP API, ~0.4s). Asset type switching auto-selects first symbol of new type and cancels in-flight queries via `queryClient.cancelQueries()`.
- **Training data flow**: Python reads QuestDB directly via PG wire (psycopg2), computes features inline, saves model artifacts to disk (`data/models/`). No external experiment tracking — all metrics flow via stdout JSON protocol → SSE → browser + SQLite persistence.
- **Live training metrics**: Python `emit_metric()` → stdout JSON → parser → SSE `event: metric` → `useTrainingSSE` → `TrainingMetricsCtx` → streaming metric panels. Declarations in `src/config/models.json` metricDeclarations (not metric-descriptions.json).
- **Live model state**: Python `emit_model_state()` → stdout JSON → parser → SSE `event: model_state` → `useTrainingSSE` → `TrainingModelStateCtx` → visualization components. Full snapshot every 25-50 iterations. History capped at 100 entries.
- **Regime candle painting**: `regimeColorMap` prop on `TradingChart` colors candle body/wick/volume by regime. Built from live SSE overlay events during training, or from `assignments.csv` for completed models. 16-color palette in `chartConfig.ts`.
- **Band fill rendering**: Band/channel indicators (Bollinger, Keltner, Donchian, Ichimoku, AccBands, HWC) render upper/lower bands as `AreaSeries` with subtle 6% opacity fills. Upper bands fill downward, lower bands fill upward via `invertFilledArea`. Middle lines render at width 2, signal/trigger lines use `LineStyle.Dashed`, chikou span uses `LineStyle.Dotted` at 0.5 opacity. Band lines at 0.7 opacity, signals at 0.8. Reference lines with increased visibility (0.45 opacity for OB/OS, 0.2 for zero lines). AO directional histogram coloring (green increasing, red decreasing). Squeeze 4-color momentum histogram. Category-colored dots in IndicatorSelector. Panel color dots for multi-output subchart indicators. Min panel height 100px, scrollable subchart area (50vh max). Logic in `useChartOverlays.ts`, color utility `colorToRgba()` in `indicator_colors.ts`.

### Indicator UI Improvements (2026-03-25)
- Band/channel fills via AreaSeries (Bollinger, Keltner, Donchian, Ichimoku, AccBands) with 6% opacity
- Line style differentiation: dashed signal lines, dotted chikou span, tiered opacity levels
- Enhanced reference line visibility (0.45 opacity for OB/OS levels, 0.2 for zero lines)
- Directional histogram coloring: AO (green increasing, red decreasing), Squeeze (4-color momentum)
- Category-colored indicator selector with colored dots per category
- Multi-output panel label dots for subchart indicators with multiple outputs

## API Route Map (17 routers on `/api`)

| Router      | Mount              | Purpose                                                                              |
| ----------- | ------------------ | ------------------------------------------------------------------------------------ |
| upload      | `/api/upload`      | File upload + OHLCV ingestion (CSV, ZST, Parquet, DBN; 500MB max)                    |
| instruments | `/api/instruments` | Instrument metadata, feature importance                                              |
| training    | `/api/training`    | Training: start, stop, SSE stream, config, history, models, diagnostics, SHAP        |
| hpo         | `/api/hpo`         | Optuna HPO: start, stop, SSE stream, sessions, trials, apply best params             |
| ml          | `/api/ml`          | Observatory (models, outputs, coherence, ensembles), sessions, labels (16 generators), XAI (9 methods), forecasts (Chronos) |
| news        | `/api/news`        | News articles + sentiment (Yahoo Finance RSS, Alpha Vantage, SSE stream)             |
| databases   | `/api/databases`   | DB explorer, infrastructure health, circuit breakers, rate limits, cache stats        |
| charts      | `/api/charts`      | OHLCV candles + symbols (QuestDB SAMPLE BY, futures stitching, anchor caching)       |
| backtest    | `/api/backtest`    | Walk-forward, Monte Carlo, benchmark comparison, SSE progress, trade markers         |
| system      | `/api/system`      | GPU/CPU telemetry (Python subprocess + systeminformation fallback)                   |
| settings    | `/api/settings`    | User preferences (SQLite), server config, connectivity tests                         |
| modelCatalog| `/api/model-catalog`| 300+ model specs browsing, taxonomy, search/filter                                  |
| curriculum  | `/api/curriculum`  | Learning progress tracking, bookmarks, time logging                                  |
| motivewave  | `/api/motivewave`  | File watcher config, manual import, status (legacy CSV path)                         |
| events      | `/api/events`      | SSE event bus (per-channel: pipeline, training, system)                               |
| pipelines   | `/api/pipelines`   | Event-sourced pipeline state (CQRS pattern)                                          |
| chat        | `/api/chat`        | Ollama LLM chat (streaming SSE, live dashboard context injection)                    |

## Dev Commands

```bash
# Start QuestDB
node electron/start-databases.cjs

# Push Drizzle schema changes to SQLite
npx drizzle-kit push

# Run dev server (Express API + Vite HMR on port 5000)
npm run dev

# Desktop mode (starts DBs + server + Electron)
npm run electron:dev

# Run tests
npm test

# Type check
npm run check

# Build for production (includes pre-compressed .gz/.br static assets)
npm run build

# Bundle analysis treemap (opens HTML report)
npm run analyze

# Offline scripts
npx tsx scripts/seed-instruments.ts        # Upsert 25 instruments
python scripts/feature-research.py --symbol MNQ --timeframe 1m --source parquet  # Feature research pipeline
python scripts/dump-questdb-parquet.py --tables ohlcv --symbols MNQ             # Export QuestDB to parquet

# Training visualization
python scripts/training_monitor.py --port 8050                                  # Live training dashboard (tails convergence.json)
python scripts/prediction_viewer.py --port 8051                                 # OOS prediction viewer (loads oos_predictions.npz)
```

## NPM Scripts

| Script           | Purpose                                     |
| ---------------- | ------------------------------------------- |
| `dev`            | Full dev server (Express + Vite, port 5000) |
| `dev:client`     | Vite-only dev server                        |
| `build`          | Production build (tsx script/build.ts)      |
| `start`          | Production server                           |
| `electron:dev`   | Start DBs + dev + Electron                  |
| `build:electron` | Build + Electron NSIS installer             |
| `start:desktop`  | Launch Electron app                         |
| `db:push`        | Drizzle schema push to SQLite               |
| `check`          | TypeScript type check                       |
| `test`           | Vitest run                                  |
| `test:watch`     | Vitest watch mode                           |

## Git Workflow

**Hooks (Husky):**
- `pre-commit`: lint-staged (ESLint on `.ts`/`.tsx`, Ruff on `.py` staged files)
- `commit-msg`: Conventional Commits enforced on subject line only (feat/fix/docs/chore/refactor/perf/test/build/ci/style/revert). Multi-line messages and trailers (Co-Authored-By, Signed-off-by) are allowed.
- `pre-push`: TypeScript type check (`tsc --noEmit`)

**Commit format:**
```
<type>(<scope>): <description>

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
```

**Branch strategy:**
- `master`: stable
- `feature/<description>`: new features
- `fix/<description>`: bug fixes

**PR workflow:**
- All PRs use the template in `.github/pull_request_template.md`
- CI runs lint + typecheck + test on every PR

**Claude Code hooks:**
- `.claude/settings.json` defines a PostToolUse hook that auto-lints files after Edit/Write operations
- `.claude/hooks/auto-lint.py`: runs `ruff check --fix` on `.py` files, `npx eslint --fix` on `.ts`/`.tsx` files

## Documentation Updates — MANDATORY

After EVERY change — no exceptions — update all affected documentation immediately. Not later, not when asked, not in a separate step. The change is not complete until docs reflect reality.

**What to update after any change:**
- **CLAUDE.md**: Key Scripts, Key Configs, Active Models, architecture sections, project scale counts
- **Memory files**: If the change affects stored context (model state, architecture decisions, references)
- **Code comments**: If behavior changed, comments must match the new behavior (no stale descriptions)
- **Config files**: If new scripts, dependencies, or settings were added

**Triggers:**
- New file created → add to relevant CLAUDE.md section
- File deleted or renamed → remove/update references everywhere
- Model trained → update Active Models section + save checkpoint metadata
- Architecture or feature changed → update all affected docs + comments
- Strategy or logic modified → update `@StudyHeader` desc, inline comments, any referencing docs
- Dependency added/removed → update Tech Stack, package lists

**The standard:** If someone reads CLAUDE.md and the codebase disagrees, that's a bug. Docs and code must always be in sync.

## Environment Variables (.env)

```
QUESTDB_HOST=localhost
QUESTDB_ILP_PORT=9009
QUESTDB_PG_PORT=8812
QUESTDB_HTTP_PORT=9000
PORT=5000
NODE_ENV=development
```

## Indicators (151 client-side)

All 151 technical indicators computed 100% client-side from raw OHLCV bars. No server-side indicator code remains.

**Calculator modules** in `src/client/src/lib/calculators/`:

| Module | Coverage |
| ------ | -------- |
| `math_primitives.ts` | SMA, EMA, WMA, DEMA, TEMA, StdDev, rolling stats |
| `overlay_extra.ts` | Bollinger, Keltner, Donchian, Ichimoku, Supertrend, envelope overlays |
| `momentum_extra.ts` | RSI, MACD, Stochastic, StochRSI, CCI, Williams %R, ROC, AO, PPO, TSI, Fisher, KDJ, Squeeze, STC, TRIX |
| `volatility_extra.ts` | ATR, NATR, True Range, Ulcer Index, Chaikin Volatility |
| `volume_extra.ts` | OBV, AD, ADOSC, CMF, EFI, EMV, KVO, MFI, NVI, PVI, VWAP, VPOC |
| `trend_extra.ts` | ADX, Aroon, CHOP, DPO, PSAR, Vortex, VHF |
| `statistics_extra.ts` | Entropy, Kurtosis, MAD, Median, Skew, Variance, Z-Score |
| `cycle_performance.ts` | EBSW, Reflex, Log Return, Percent Return |

**Registry**: `src/client/src/lib/indicator_registry.ts` — all indicator definitions with typed params
**Dispatch**: `src/client/src/lib/indicator_compute.ts` — routes each indicator to its calculator
**Candle patterns**: 60 CDL_* patterns via `src/client/src/lib/candle_patterns.ts`

`feature_extraction.json` remains for the ML training pipeline (reads pre-computed talib_features from QuestDB).

## ML Taxonomy Reference

### Categories (4) -> Subcategories (10)
| Category            | Subcategories                                           |
| ------------------- | ------------------------------------------------------- |
| **Supervised**      | classification, regression, sequence                    |
| **Unsupervised**    | clustering, dimensionality-reduction, anomaly-detection |
| **Self-Supervised** | representation, contrastive                             |
| **Semi-Supervised** | pseudo-labeling, consistency                            |

### Label Generators (15+)
**Supervised:** direction, signal, regime, future_return, future_volatility, multi_step, triple_barrier
**Advanced:** npmm, volatility_adaptive, trend_scanning, meta_label
**Self-Supervised:** contrastive_temporal, contrastive_augmentation, contrastive_statistical
**Semi-Supervised:** pseudo_confidence, consistency_perturbation

### XAI Methods (9)
SHAP, Permutation Importance, GradCAM, Integrated Gradients, Saliency Maps, LIME, Feature Interactions, Confidence Calibration, Counterfactuals

## Naming Convention

Filenames are **operational interfaces**, not descriptions. Names declare what a module *does*, not what it *is about*.

### Level 1 — Domain Directories
- **Exactly one word** — names an operational domain or process stage.
- Absorbs semantic context so children don't repeat it.

```
server/
  training/       ✅  (domain: training)
  routes/         ✅  (domain: routing)
  lib/            ✅  (domain: shared utilities)
```

### Level 2 — Component Files
- **One word by default** (`orchestrator.ts`, `registry.ts`, `runner.ts`).
- **Two words (snake_case) only when**:
  - No single atomic term exists (`circuit_breaker.ts`)
  - The file is a system boundary (`python_runner.ts`)
  - A sibling collision would otherwise occur

```
server/training/
  orchestrator.ts   ✅  one word — role is clear from parent
  registry.ts       ✅  one word
  runners/
    types.ts        ✅  one word
    python_runner.ts ✅  two words — system boundary (Python ↔ Node)
    tfjs_runner.ts   ✅  two words — system boundary
```

### Constraints
- Names must be **minimal relative to directory context** — the parent directory provides scope.
- **More than two tokens = mis-scoped abstraction** — refactor the module or restructure the directory.
- **No metaphors, no outcomes, no interpretations** — name the mechanism, not the effect.

```
❌ training_session_manager.ts   → 3 tokens, parent is training/
✅ sessions.ts                   → parent provides "training" context

❌ smart_feature_picker.ts       → metaphor ("smart")
✅ selector.ts                   → mechanism

❌ profit_calculator.ts          → outcome
✅ returns.ts                    → domain
```

## Token Budget

No token budget constraints. Always prioritize high-end performance and thorough implementation over token conservation. Use a million tokens if needed — quality and completeness matter, not cost.

## Rendering Infrastructure

### React Compiler
- `babel-plugin-react-compiler` enabled in `vite.config.ts`
- Auto-memoizes all components, hooks, and intermediate values at build time
- Do NOT add manual `React.memo`, `useMemo`, or `useCallback` — the compiler handles it
- If a component needs to opt out: add `'use no memo'` directive

### SSE Streaming
- `useSSEConnection` — shared hook with exponential backoff reconnection (1s/2s/4s/8s, max 30s), supports both `onMessage` and named `eventMap`
- `useTrainingSSE` — ring buffer (5000 slots) + 50ms microbatch + `startTransition` flush (~2-3 renders/sec vs old ~50/sec)
- `useEventStream` — pipeline/training/system channels with auto-reconnection via named event listeners
- `useGpuMetrics` — subscribes to `system.gpu` SSE events, maintains 300-point rolling history for charts
- GPU monitor auto-starts on server boot (2s interval), broadcasts via `system` SSE channel
- All SSE errors logged via `logError()` from `lib/errorLogger.ts`

### Query Layer
- Global `staleTime: 5min` — individual queries override as needed (chart OHLCV uses Infinity)
- `useSuspenseQuery` preferred over `useQuery` when data is required for render
- `QueryErrorBoundary` wraps route groups for retry on query failure (integrates with `QueryErrorResetBoundary`)
- All mutations must have `onError` handlers (toast notification)

### Error Handling
- Global `unhandledrejection` listener in `App.tsx`
- `logError(component, message, context)` / `logWarn()` from `lib/errorLogger.ts` for structured logging
- No silent catch blocks — every catch must log or handle
- Custom error handler sink via `setErrorHandler()` for toast integration
- Server: standardized error envelope `{ error, requestId, status }` — all routes use same shape

### Performance
- lightweight-charts: `enableConflation: true` + `conflationThresholdFactor: 1.0` for 10k+ bar datasets
- Web Vitals monitoring in dev mode (LCP, FID, CLS) via `useWebVitals()` hook
- `useDeferredFilter()` hook for search/filter inputs (wraps `useDeferredValue`)
- `RingBuffer<T>` class in `lib/ringBuffer.ts` for O(1) push event accumulation
- Training context split: `useTrainingMetrics()`, `useTrainingLogs()`, `useTrainingOverlays()`, `useTrainingModelState()` for granular subscriptions

### API Infrastructure
- **Compression**: gzip via `compression` middleware (threshold 1KB, skips SSE streams + production `/assets/`). Pre-compressed `.gz`/`.br` static assets via `vite-plugin-compression2` at build time — eliminates runtime CPU overhead.
- **ETags**: Weak ETags enabled (`app.set('etag', 'weak')`) for automatic 304 Not Modified responses on reference data.
- **Request cancellation**: All TanStack Query hooks pass `signal` (AbortSignal) to `fetch()`. Navigating away and symbol/timeframe switches call `queryClient.cancelQueries()` to immediately abort in-flight OHLCV fetches. Server detects client disconnect via `req.on('close')` and bails before heavy queries.
- **Request IDs**: Every response includes `X-Request-ID` header. Auto-generated UUID, or forwarded from `X-Request-ID` on incoming request. Included in error responses and slow request logs.
- **Request timeouts**: 30s default for API routes. Charts OHLCV route uses 15s timeout (fail fast for stitched futures queries). SSE streams and `/training/start` exempt (timeout=0). Returns 408/504 on timeout.
- **Health endpoint**: `GET /health` — returns `{ status, uptime, memory: { heapUsed, heapTotal, rss }, timestamp }`. No auth required.
- **Security headers**: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` on all responses.
- **Slow request logging**: Requests >5s logged with `[SLOW reqId]` prefix for performance debugging.
- **SSE delta encoding**: Training `model_state` events use delta encoding (`src/shared/delta.ts`). First event is full snapshot, subsequent events send only changed fields if delta <50% of full size. Full snapshot forced every 10 events for recovery.
- **MessagePack**: OHLCV endpoint supports `Accept: application/msgpack` for ~50% smaller binary responses. Client sends msgpack Accept header, decodes ArrayBuffer response.
- **IndexedDB OHLCV cache**: `src/client/src/lib/ohlcv_cache.ts` persists OHLCV bars client-side (24h TTL). Charts load instantly on revisit without network request.
- **Optimistic mutations**: Model deletion uses TanStack Query optimistic update — card disappears instantly, rolls back on server error.
- **Service Worker**: `src/client/public/sw.js` caches static assets (cache-first for `/assets/*`, network-first for everything else). Registered in production only. App shell renders during server startup.
- **Bundle analysis**: `npm run analyze` generates treemap HTML via `rollup-plugin-visualizer`.
- **Virtual scrolling**: Reusable `VirtualList` component at `src/client/src/components/ui/virtual-list.tsx` wrapping react-window v2.
- **Async file I/O**: All config file reads use `fs.promises` — no blocking `readFileSync` in route handlers.
- **Metric descriptions**: Metric metadata embedded in `src/config/models.json` per model's `metricDeclarations` object (renderer type, mission, context thresholds, group). Client rendering is model-agnostic via `SelfDescribingDiagnostics` schema. Legacy `metric-descriptions.json` superseded.

### ML Pipeline Performance
- **Numba JIT**: Rolling z-score, rolling std, rolling mean, ROC, percentile rank all Numba-compiled. ~50x vs pandas on 500k+ rows.
- **Parquet cache**: QuestDB fetch cached to `data/.cache/` as zstd parquet. First fetch ~280s, subsequent reads <1s. 24h TTL with proactive stale deletion. 2GB max cap with LRU eviction. Auto-invalidated on ingestion (upload + MotiveWave watcher). Periodic cleanup every 10 min via `cache/parquet.ts`.
- **Cache warming**: Symbol catalog pre-fetched on server startup (fire-and-forget after listen). See `warmSymbolsCatalog()` in `cache/symbols.ts`.
- **Monthly partition fetch**: QuestDB large table queries split into monthly chunks to avoid PG wire timeout on 150M+ row tables.
- **Joblib parallel**: Feature extraction parallelized across indicator categories. Permutation importance parallelized across features.
- **Polars correlation**: Spearman ranking via Rust-native polars, then numpy corrcoef. ~3x vs scipy.
- **Batch VIF**: Single matrix inverse `diag(R^-1)` instead of D separate OLS regressions.
- **MI subsampling**: Mutual information capped at 100k rows for O(n*d*k) KNN. Full dataset unnecessary for MI estimation.
- **O(1) memory normalization**: features.py normalize_features uses numba online algorithm instead of sliding_window_view (which OOM'd at 127GB for 2.3M rows).

## Common Pitfalls

- **Windows paths**: Use forward slashes in Node.js code, backslashes in shell commands
- **npx shims**: Use `npx tsx` not `tsx` directly on Windows; or use `npm run` scripts
- **`--env-file` flag**: Requires Node 20.6+; the dev script uses `node --env-file=.env --import tsx`
- **Rate limits**: API 100/min, ML 20/min, upload 30/min, query 50/10s
- **QuestDB startup**: Registered as Windows service via nssm (auto-start on boot). Also manageable with `nssm start/stop/status QuestDB`
- **QuestDB LIMIT syntax**: `LIMIT offset, count` (NOT `LIMIT count OFFSET offset`)
- **QuestDB count**: `count()` (NOT `COUNT(*)`)
- **QuestDB cast**: `CAST(x AS INT)` (NOT `CAST(x AS INTEGER)`)
- **QuestDB /imp timestamps**: Require `T` separator (not space), no timezone offset like `+00`
- **QuestDB `nm=true`**: Strips `columns` metadata from `/exec` response — do NOT use if code needs column names
- **Vite dev vs production**: Vite middleware only loaded in development; production uses static file serving from `dist/`
- **Schema push**: Always run `npx drizzle-kit push` after modifying `shared/schema.ts`
- **Indicator column names**: pandas-ta naming convention with dots/percent sanitized (e.g., `BBL_20_2.0` → `BBL_20_2_0`, `%` → `pct`)
- **Numba cache corruption**: After changing `@njit` function signatures, delete `__pycache__/` dirs under `src/ml/`. Stale `.nbi`/`.nbc` files cause `ModuleNotFoundError`.
- **QuestDB**: 5 tables: `ohlcv` (863M rows), `symbols` (904), `ticks` (1.3M), `dom_l2` (4.9M), `dom_summary` (206K). All timeframe aggregation uses `SAMPLE BY` on the base table. Label generators use `wrapWithSampleBy()` to inject a `sampled_ohlcv` CTE when `timeframeMinutes > 1`. All features computed from parquet files or in-memory. Continuous contracts derived from OHLCV volume at query time.
- **Unicode in Python print**: Windows cp1252 can't encode arrows/special chars. Use ASCII in all print statements (`to` not `→`).
- **No W&B**: Weights & Biases removed entirely. All experiment tracking flows through the dashboard SSE protocol → SQLite + browser. No `wandb` imports anywhere.

## MCP Server (FastMCP)

Read-only MCP server exposing both databases to Claude.ai (web) and Claude Code (stdio).

**Location**: `mcp_server/` (Python, FastMCP 3.1.1)

**13 tools**: 7 QuestDB (`questdb_query`, `questdb_tables`, `questdb_columns`, `questdb_sample_data`, `questdb_ohlcv`, `questdb_symbol_list`, `questdb_data_inventory`) + 6 SQLite (`sqlite_query`, `sqlite_tables`, `sqlite_columns`, `sqlite_sample_data`, `sqlite_training_sessions`, `sqlite_models`)

**Auth**: Bearer token via `StaticTokenVerifier` (token in `mcp_server/.env`)

```bash
# Start for Claude.ai web (streamable HTTP)
cd E:\source\repos\ml_dashboard && python -m mcp_server.run
# Health check: http://localhost:8765/health
# MCP endpoint: http://localhost:8765/mcp/

# Expose for Claude.ai via tunnel
ngrok http 8765
# Then add to Claude.ai > Settings > Integrations > Add custom integration
#   URL: https://<ngrok-url>/mcp/
#   Auth: Bearer token from mcp_server/.env MCP_AUTH_TOKEN
```

**Files**:
- `mcp_server/server.py` — FastMCP instance, lifespan, auth, health route
- `mcp_server/run.py` — Entry point (streamable HTTP or stdio)
- `mcp_server/db/validation.py` — SQL injection protection, table allowlists, row limits
- `mcp_server/db/questdb_conn.py` — psycopg2 pool (PGWire :8812)
- `mcp_server/db/sqlite_conn.py` — sqlite3 read-only connection
- `mcp_server/tools/questdb_tools.py` — 7 QuestDB tools
- `mcp_server/tools/sqlite_tools.py` — 6 SQLite tools

## Claude Skills

Available skills in `.claude/commands/`:
- `/db-manage` — Start/stop/status/reset/migrate databases
- `/ingest-data` — Upload and ingest market data (futures, forex, trades, MBP-10, indicators)
- `/ml-pipeline` — Feature engineering, labels, training, XAI
- `/architecture` — Schema reference and architecture guide
- `/frontend` — UI development patterns and components (updated: AbortSignal, optimistic mutations, IndexedDB, MessagePack)
- `/debug` — Troubleshooting and health checks
- `/perf-audit` — Full performance audit (bundle, cache, types, API headers) with 4 parallel subagents
- `/add-signal` — Wire AbortSignal through React Query hooks with raw fetch()
- `/add-cache` — Add cache layer (HTTP headers, LRU, IndexedDB, TanStack, MessagePack, delta encoding)
- `/optimize-endpoint` — Apply all performance optimizations to a server API endpoint
- `/add-sse-delta` — Add SSE delta encoding to reduce event payload bandwidth
- `/clean-imports` — Clean up unused imports

## Agent Workflows

| When the task involves | Dispatch | Trigger words |
|------------------------|----------|---------------|
| Training loops, loss functions, optimizers, checkpoints, walk-forward | ml-lead | train, loss, optimizer, scheduler, checkpoint, epoch, fold, AMP, gradient |
| Feature engineering, normalization, selection, Numba | ml-lead | feature, normalize, z-score, rolling, Numba, correlation, VIF, SHAP |
| Model architecture, layers, attention, gradient flow | ml-lead | architecture, CNN, transformer, attention, VAE, HMM, head, layer |
| Data loading, QuestDB queries, splits, labeling | ml-lead | data, QuestDB, parquet, DataLoader, walk-forward, barrier, label |
| Model evaluation, metrics, profit factor, Sharpe | ml-lead | evaluate, profit factor, Sharpe, drawdown, win rate, backtest, OOS |
| React components, pages, hooks, state management | frontend-lead | component, page, hook, context, TanStack, query, route, React |
| Charts, D3, Recharts, Three.js, visualization | frontend-lead | chart, D3, Recharts, visualization, render, Tailwind, shadcn |
| SSE streaming, EventSource, real-time updates | frontend-lead | SSE, stream, EventSource, real-time, delta, keepalive |
| API routes, Express, NestJS, middleware, validation | backend-lead | route, endpoint, API, Express, NestJS, middleware, Zod |
| Database schema, Drizzle, SQLite, migrations | backend-lead | schema, table, migration, Drizzle, SQLite, index, query |
| EventBus, SSE adapter, cron, background jobs | backend-lead | event, cron, background, fire-and-forget, EventBus, SSE adapter |
| QuestDB admin, ILP ingestion, SAMPLE BY, partitions | infra-lead | QuestDB, ILP, SAMPLE BY, LATEST ON, partition, ingestion |
| Docker, containerization | infra-lead | Docker, compose, container, image, volume |
