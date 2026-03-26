# ML Dashboard

Full-stack ML Dashboard for quantitative trading research. Electron desktop app + web (React 19 + Express 5 + NestJS 11) with a 2-database architecture (SQLite 35 tables + QuestDB 2 tables). HDP-HMM regime detection trained on 2.3M MNQ 1m bars. No external experiment tracking — all metrics via built-in SSE protocol.

## Project Scale
- **182 React components**, 63 pages, 30 route files, 45 Python ML files, 51 scripts
- **99 npm dependencies**, 40 devDependencies, 7 config JSONs
- **Node 22.20**, Python 3.13, TypeScript, Numba JIT, Polars
- **157 commits** on `feat/event-architecture` branch (pushed to GitHub)
- **Trained models**: MNQ_1m (6 regimes, 2.3M bars, quality 87), EURUSD_1h (3 regimes), EURUSD_1h_2state, MNQZ5_1m (11 regimes, quality 91)

## User Learning Style

The user is an **extreme visual learner** who cannot process abstract math or theoretical concepts in text form. When explaining technical concepts (ML architectures, algorithms, data flows, etc.):

- **Always use "Think of it as..." analogies** grounded in trading/real-world terms the user already understands (e.g., "a chart pattern scanner sliding a magnifying glass", "a panel of experts voting", "a trader reading bar by bar with a mental notepad")
- **Build visual components** in the dashboard rather than writing text explanations — the user needs to SEE how things work (data flows, layer shapes, attention maps, decision trees)
- **Show data shape transformations** step-by-step (e.g., 60×31 → Conv → 30×64 → Pool → ...) so the user can trace how their data morphs through each layer
- **Use strength/weakness trade-off badges** and side-by-side comparison matrices instead of paragraphs of prose
- **Never assume math literacy** — translate formulas into visual or intuitive equivalents (e.g., "softmax = picks the strongest signal" not "softmax = e^x / Σe^x")
- **Connect every concept back to the user's actual data** — their 29 features, their OHLCV from QuestDB — not abstract examples

## Development Hardware

| Component         | Spec                                                      |
| ----------------- | --------------------------------------------------------- |
| **CPU**           | AMD Ryzen 9 7900X — 12 cores / 24 threads, 5.6 GHz boost  |
| **RAM**           | 128 GB DDR5-5600 (4 × 32 GB Micron CP32G60C40U5B)         |
| **GPU**           | NVIDIA GeForce RTX 5060 Ti — 16 GB VRAM, 180 W TDP        |
| **iGPU**          | AMD Radeon (integrated, Zen 4)                            |
| **Motherboard**   | ASUS TUF GAMING X870-PLUS WIFI                            |
| **Boot/OS Drive** | Samsung 970 EVO Plus 500 GB NVMe (E:, 466 GB, 45 GB free) |
| **Data Drive**    | Samsung 870 EVO 2 TB SATA SSD (C:, 1.86 TB, 464 GB free)  |
| **Bulk Storage**  | Seagate ST2000DM006 2 TB HDD (D:, 1.86 TB, 1.75 TB free)  |
| **OS**            | Windows 11 Pro (Build 26200)                              |
| **BIOS**          | v0831 (2024-12-29)                                        |
| **GPU Driver**    | NVIDIA 591.44                                             |

## Tech Stack

- **Frontend**: React 19, Wouter router, TanStack Query, Tailwind v4, shadcn/ui (Radix), Recharts, Lightweight Charts, Three.js/R3F, D3, Framer Motion
- **Backend**: Express 5, TypeScript, Node.js
- **ORM**: Drizzle ORM with Zod validation
- **ML**: TensorFlow.js-node (CNN models), label generation, XAI (9 methods)
- **Indicators**: 151 technical indicators computed 100% client-side from raw OHLCV bars (no server-side indicator code)
- **Desktop**: Electron 34
- **Testing**: Vitest
- **Build**: Vite 7, esbuild, tsx

## Database Architecture

Two databases with distinct responsibilities:

| Database          | Role                                                  | Persistent? | Connection                                 |
| ----------------- | ----------------------------------------------------- | ----------- | ------------------------------------------ |
| **SQLite**        | App metadata: users, ML models, training, instruments | Yes         | Embedded (`data/ml_dashboard.db`)          |
| **QuestDB 9.3.3** | Source of truth for ALL time-series data (unified multi-asset) | Yes | HTTP `:9000`, ILP `:9009`, PG wire `:8812` |

Plus file-based stores:

| Store          | Role                                | Size |
| -------------- | ----------------------------------- | ---- |
| `data/models/` | Trained model checkpoints (HDP-HMM) | Var. |

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

**Base Tables (2)**:

| Table | Rows | Partition | Dedup | Key Columns |
| ----- | ---- | --------- | ----- | ----------- |
| `ohlcv` | 856M | DAY | yes | symbol, asset_class, root, timestamp, open, high, low, close, volume |
| `symbols` | 904 | YEAR | yes | symbol, asset_class, root, exchange, currency, tick_size, point_value, pip_size, contract_size, decimal_places, timestamp |

**Asset classes**: futures (817.6M rows, 8 roots: ES, NQ, MNQ, MES, YM, MYM, RTY, M2K), forex (38.6M rows, 18 pairs)

No materialized views — all timeframe aggregation done on-the-fly via `SAMPLE BY` from the base `ohlcv` table.

**Data Ingestion**: ILP protocol (port 9009) via Node.js Sender. File dedup tracked in SQLite `ingested_files`.

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

### SQLite Schema (22 tables in `shared/schema.ts`)

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
QuestDB OHLCV (source of truth, 856M rows, unified multi-asset)
    |
    +--> Python training reads QuestDB directly (PG wire :8812)
    |        |
    |        v
    |    features.py computes 29 inline features from raw OHLCV
    |        |
    |        v
    |    HDP-HMM regime discovery → saves artifacts to data/models/
    |
    +--> Chart API (SAMPLE BY on base ohlcv table)
```

## Project Structure

```
client/src/
  pages/            13 pages: Dashboard, DataSets, MLHub, Portfolio, Watchlist,
                    News, Databases, Observatory, Training, Signals, Backtest, Gpu, not-found
  components/       shadcn/ui + domain components (ExplainableAI, IndicatorPanel,
                    LabelGeneration, LossSurface3D, TradingChart, VisualizationOrchestrator)
  components/training/
    live/           LiveTrainingDashboard (config-driven, 3 layout modes: detailed/compact/split),
                    MetricPanel (recharts chart + description sidebar, reads metric-descriptions.json),
                    ConvergenceChart, RegimeCountTracker, TransitionMatrixHeatmap (animate prop), IterationMetrics
    analytics/      QualityGatePanel (gate status row), MetricScorecard (sparkline grid),
                    RecommendationEngine (warn/fail cards), EmissionHeatmap (K×D SVG heatmap),
                    BetaWeightArea (stacked area), RegimeCentroidScatter (PCA 2D scatter),
                    ParameterTraces (3 stacked line charts: self-transition, beta, regime count)
    tabs/           OverviewTab (QualityGatePanel + MetricScorecard + RecommendationEngine),
                    ModelStateTab (QualityGatePanel + EmissionHeatmap + TransitionMatrix + BetaWeight + Centroids + Traces)
    ModelBrowser.tsx  Navigable tree: Model Type → Instrument → Checkpoints with grade badges
  components/visualizations/  8 types: AnomalyTimeline, ComponentLoadings,
                    ConfusionMatrixHeatmap, EmbeddingScatter, ForceDirectedCluster,
                    ForecastRibbon, ResidualPlot, SimilarityMatrix
  hooks/            useMarketData, useActiveIndicators (professional indicator system), use-toast,
                    useMetricDescriptions (config-driven metric annotations per model type),
                    useTrainedModels (multi-instrument model grouping: type → instrument → checkpoints),
                    useGpuMetrics (SSE-driven GPU telemetry: snapshot, history, device info)
  lib/              queryClient, prefetch, mlModels (50+ model definitions), indicatorRegistry (151 indicator definitions),
                    indicatorCompute (dispatcher), candlePatterns (60 client-side CDL patterns),
                    indicatorPanels, indicatorColors, utils
                    calculators/  mathPrimitives, overlayExtra, momentumExtra, volatilityExtra,
                                  volumeExtra, trendExtra, statisticsExtra, cyclePerformance

server/
  main.ts           Express app + NestJS DI bootstrap
  core/routes.ts    Route registration (11 routers)
  routes/           upload, instruments, ml, news, databases, charts,
                    backtest, agent, regime, training, system (GPU monitoring)
  database/
    db.ts           Drizzle SQLite connection (better-sqlite3, WAL mode)
    health.ts       Cross-DB health monitoring (SQLite + QuestDB, circuit breaker)
    database.module.ts  NestJS DI module (QuestDBService, SQLiteService)
    questdb.service.ts  NestJS QuestDB facade
    sqlite.service.ts   NestJS SQLite facade
    typeorm.module.ts   TypeORM config
    questdb/
      connection.ts   Low-level clients (Sender, pg.Pool, queryQuestDB, insertOHLCVBatch — auto-derives asset_class/root)
      marketData.ts   Unified OHLCV queries (single table), front-month stitching via volume detection
      introspection.ts  Schema metadata (SHOW TABLES, columns, partitions, stats)
      httpQuery.ts    QuestDB HTTP API (questdbHttpQuery, questdbExportParquet, questdbImportCSV)
      export.ts       Parquet export via /exp endpoint
      tables.ts       DDL (createOHLCVTable — unified schema with asset_class/root, createIndicatorTables)
      lifecycle.ts    QuestDB process lifecycle (start, stop, status)
      integration.ts  Circuit-breaker-wrapped insert/query + pipeline metrics
      ohlcvQuery.ts   OHLCV query orchestration (health check, time-window estimation, caching)
      index.ts        Barrel re-exporting all sub-modules
  cache/            Unified server-side cache layer
    index.ts        Barrel exports + clearAllCaches() + getCacheStats()
    ohlcv.ts        OHLCV bar LRU cache (500 entries, 60min TTL, 200MB cap)
    query.ts        Event-driven query cache (LRU, 5min TTL, auto-invalidation)
    anchor.ts       Chart anchor timestamp cache (per-symbol, 5min TTL)
    symbols.ts      QuestDB symbols catalog cache (1hr TTL, warm on startup)
    model.ts        Model results disk I/O cache (100 entries LRU)
    labels.ts       Label preview cache (50 entries, 15min TTL)
    parquet.ts      Python parquet cache invalidation (data/.cache/)
    headers.ts      HTTP Cache-Control middleware (CACHE_STATIC, CACHE_SEMI)
  storage/          Drizzle queries for all SQLite tables (domain sub-interfaces)
  training/
    registry.ts     Config reader (config/models.json, features.json, training.json)
    orchestrator.ts Central coordinator — startTraining, stopTraining, session management
    runners/
      types.ts      ITrainerRunner interface, session management, SSE event buffering
      pythonRunner.ts  Spawns Python scripts, parses stdout (HDP-HMM Gibbs metrics)
      tfjsRunner.ts    Wraps TF.js MLTrainer EventEmitter
  lib/
    ingestion/      fileTracker (SHA-256 dedup), standardize, uploadProcessor
    labels/         sqlLabelGenerators (15+ types), contrastivePairs, labelService
    xai/            xaiService (9 methods: SHAP, LIME, GradCAM, Integrated Gradients,
                    Saliency, Permutation, Feature Interaction, Calibration, Counterfactual)
    circuitBreaker.ts  Auto-disable failing DB connections
    rateLimiter.ts  API 100/min, ML 50/min, upload 10/min
    metrics.ts            Performance tracking
  ml/               trainer.ts (MLTrainer + SSE streaming), cnn.ts

ml/                 Python ML model packages
  shared/           Shared across ALL models
    features.py     Config-driven feature computation (29 features, 8 categories). Numba JIT rolling stats. normalize_features() uses O(1) memory numba rolling z-score (handles 2M+ rows, no OOM).
    normalizer.py   Feature classification (8 types) + transform functions (rolling_zscore, scale_bounded, pct_from_close, price_ratio, cumulative_roc). Constants: ROLLING_WINDOW=50, CLIP_RANGE=5.0
    feature_extract.py      Indicator-to-feature derivation transforms (8 transforms: roc, distance_from, percentile_rank, zscore, divergence, squeeze, crossover_dist, acceleration). Numba JIT kernels, joblib parallel across categories, parquet cache layer for QuestDB data. Config-driven via feature_extraction.json.
    feature_correlation.py  Pairwise correlation (polars+numpy corrcoef), hierarchical clustering, batch VIF via matrix inverse, redundancy detection, feature drop suggestions
    feature_importance.py   Permutation importance (joblib-parallelized, supervised + unsupervised ARI), mutual information (subsampled to 100k), SHAP wrapper, cumulative importance, aggregate ranking
    swing.py        Causal zigzag detection (no lookahead)
    protocol.py     JSON stdout protocol (emit_progress, emit_metric, etc.)
    data.py         QuestDB OHLCV loading via PG wire (psycopg2)
  hdp_hmm/          Sticky HDP-HMM regime detection package
    main.py         Entry point spawned by pythonRunner.ts (CLI + orchestration)
    model.py        StickyHDPHMM class + Numba JIT FFBS. Vectorized emission LL (BLAS matmul), vectorized NIG sampling, vectorized transition counting, vectorized dwell computation.
    config.py       Model constants (K_TRUNC=4, NIG priors)
    io/             Model-specific I/O (save, relabel, SHAP, evaluation, quality)

shared/
  schema.ts         35 SQLite tables (Drizzle definitions + Zod validation)
  mlTaxonomy.ts     ML categories, subcategories, metrics, XAI method registry (~1600 lines)
  trainingTypes.ts  Universal training types (TrainingRequest, SSE events, overlay payloads)

config/
  models.json       Model registry (hdp-hmm, 2-state-hmm — runner, script, hyperparams, CLI flags)
  metric-descriptions.json  v2 metric annotations (7 HDP-HMM metrics, 4 2-state metrics) with title, format, description, detects, purpose, usage, crossMetrics, healthy ranges
  model-templates.json      Model architecture templates
  features.json     Feature registry (29 features, 8 categories, normalization config)
  feature_extraction.json  Per-indicator transform specs (13 categories: bounded_oscillators, bollinger, macd, atr_volatility, moving_averages, volume_flow, trend_strength, momentum_misc, hilbert_cycle, statistics)
  metric-descriptions.json  Per-model-type metric annotations (title, description, effect, healthy range, display format). UI reads this to annotate live training metrics.
  training.json     Infrastructure: paths, limits, timeframe map

scripts/
  feature-research.py          Feature engineering research: extract derived features from indicators, correlation analysis, importance testing. Output: data/feature_research/{symbol}/{tf}/
  cleanup_questdb.py           Drop non-OHLCV tables from QuestDB (idempotent, --dry-run supported)
  dump-questdb-parquet.py      One-time QuestDB table export to parquet (monthly partition fetch). Output: data/.cache/{table}_{symbol}.parquet
  visualize-regimes.py         HDP-HMM regime visualization: 9-panel analysis (convergence, distribution, transitions, timeline, returns/vol, dwell, OOS, profiles, SHAP). Output: data/models/{id}/analysis.png + panels/
  seed-instruments.ts          Upsert 25 instruments (8 futures + 17 forex)
  inspect-sources.ts           Inspect source data files

electron/
  main.cjs             Electron main process
  start-databases.cjs  Database lifecycle (QuestDB java.exe)
  preload.cjs          Preload script

data/
  ml_dashboard.db      SQLite database (WAL mode, 35 tables)
  models/              Trained model checkpoints (diagnostics.json, convergence.json, assignments.csv)
  .cache/              Parquet cache for QuestDB data (auto-populated, 24h TTL)
  feature_research/    Feature engineering research outputs (per symbol/timeframe)

## Trained Models (as of 2026-03-25)

| Model ID | Symbol | TF | Regimes | Bars | Quality | Grade | Key Finding |
|----------|--------|----|---------|------|---------|-------|-------------|
| MNQ_1m | MNQ | 1m | 6 | 2.34M | 87 | D | return_20 + swing_direction dominate SHAP. Bull Reversal Sharpe 6.07. OOS similarity 1.000. |
| EURUSD_1h | EURUSD | 1h | 3 | 37K | 85 | D | 3-regime forex structure |
| EURUSD_1h_2state | EURUSD | 1h | 2 | 750 | 78 | D | 2-state bull/bear baseline |
| MNQZ5_1m_hdp-hmm_20260302T015913 | MNQZ5 | 1m | 11 | 140K | 91 | D | 11 regimes with K_TRUNC=20. Superseded by MNQ_1m with K_TRUNC=4. |

### Feature Research Results (MNQ 1m, 1.95M bars)
- **209 derived features** extracted from 148 talib indicators in 12.3s (numba+parallel)
- **Top features by MI**: bop_z50, bop_pctrnk, trange_pctrnk, stochf_fastk_pctrnk, stddev_pctrnk
- **Redundancy**: 64 pairs with |r| > 0.90, reduced to 68/107 features after drops
- **95% importance** captured by 95 features out of 209

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
- **Python scripts**: Each script does one pipeline step (`feature-research.py` → feature extraction only, `visualize-regimes.py` → visualization only).

### OCP — Open/Closed
> Add new behavior by adding new code, not by editing existing code.

- **ML models**: New model = new directory in `src/ml/` following `hdp_hmm/` pattern (main.py, model.py, config.py, io/) + entry in `config/models.json`. Shared utils live in `src/ml/shared/`.
- **Indicators**: Add calculator function in `src/client/src/lib/calculators/` + entry in `indicatorRegistry.ts` — never add `if (name === 'x')` branches.
- **Label generators**: Add to `sqlLabelGenerators.ts` registry — callers iterate the registry, never reference specific types.
- **React pages**: New file in `client/src/pages/` + one route entry in `App.tsx` — no other files change.

### LSP — Liskov Substitution
> Any implementation of an interface must be a drop-in replacement.

- **`ITrainerRunner`**: `PythonRunner` and `TfjsRunner` are fully interchangeable — the orchestrator never uses `instanceof` to branch behavior.
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
- **Orchestrator → Runner**: `TrainingOrchestrator` depends on `ITrainerRunner` interface — never imports `PythonRunner` or `TfjsRunner` directly; receives runner via factory.
- **QuestDB access**: All code calls `questdbHttpQuery()` / `getOHLCVSampleBy()` abstractions — never constructs raw HTTP requests directly.
- **React → API**: Components depend on TanStack Query hooks — never call `fetch('/api/...')` directly inside a component body.

## Key Architectural Patterns

- **EventEmitter training**: `MLTrainer extends EventEmitter` emits progress events per epoch. Frontend connects via SSE at `GET /ml/train/stream`.
- **Config-driven features**: `src/config/features.json` is the single source of truth for all 29 features across 8 categories. Python `features.py` reads this config via dispatch table. Adding a feature = add JSON entry.
- **Indicator system**: 151 technical indicators computed 100% client-side from raw OHLCV bars. Calculator files in `src/client/src/lib/calculators/` (mathPrimitives, overlayExtra, momentumExtra, volatilityExtra, volumeExtra, trendExtra, statisticsExtra, cyclePerformance). Registry in `src/client/src/lib/indicatorRegistry.ts`, dispatch in `src/client/src/lib/indicatorCompute.ts`. Users add/configure/remove indicator instances via `useActiveIndicators` hook. Each instance is independently parameterized. CDL_* candlestick patterns (60 patterns) via `lib/candlePatterns.ts`. NO server-side indicator calculation — removed: `src/server/lib/indicators/`, `src/server/routes/indicators/`, `src/server/indicators/`. `technicalindicators` npm package uninstalled. `feature_extraction.json` still used by ML training pipeline (reads from QuestDB talib_features).
- **Front-month stitching**: Futures root symbols (ES, MNQ, M2K, etc.) are stitched at query time by volume-based front-month detection from OHLCV data. No separate rollovers table — the active contract is whichever had the highest daily volume. Frontend references root symbols only.
- **Circuit breaker**: Auto-disable failing DB connections. States: closed (normal), open (failing, fast-fail), half-open (testing). Reset via `POST /circuit-breaker/reset/:name`.
- **File-level dedup**: SHA-256 hash tracking in SQLite `ingested_files` table prevents re-ingestion.
- **Chart data flow**: QuestDB `SAMPLE BY` for chart candles. Futures roots use front-month stitching (`getStitchedOHLCV` → `getFrontMonthOHLCV`); forex uses direct queries.
- **Training data flow**: Python reads QuestDB directly via PG wire (psycopg2), computes features inline, saves model artifacts to disk (`data/models/`). No external experiment tracking — all metrics flow via stdout JSON protocol → SSE → browser + SQLite persistence.
- **Live training metrics**: Python `emit_metric()` → stdout JSON → `HdpHmmParser` → SSE `event: metric` → `useTrainingSSE` → `TrainingMetricsCtx` → `MetricPanel` Recharts charts. 7 HDP-HMM metrics: log_likelihood, num_regimes, assignment_stability, mean_self_transition, switch_rate, avg_dwell, beta_entropy. Descriptions in `src/config/metric-descriptions.json`.
- **Live model state**: Python `emit_model_state()` → stdout JSON → `HdpHmmParser` → SSE `event: model_state` → `useTrainingSSE` → `TrainingModelStateCtx` → visualization components. Full snapshot every 25-50 iterations: emission heatmap, transition matrix, regime profiles, feature attribution, cluster quality, quality gates. History capped at 100 entries.
- **Regime candle painting**: `regimeColorMap` prop on `TradingChart` colors candle body/wick/volume by regime. Built from live SSE overlay events during training, or from `assignments.csv` for completed models. 16-color palette in `chartConfig.ts`.
- **Band fill rendering**: Band/channel indicators (Bollinger, Keltner, Donchian, Ichimoku, AccBands, HWC) render upper/lower bands as `AreaSeries` with subtle 6% opacity fills. Upper bands fill downward, lower bands fill upward via `invertFilledArea`. Middle lines render at width 2, signal/trigger lines use `LineStyle.Dashed`, chikou span uses `LineStyle.Dotted` at 0.5 opacity. Band lines at 0.7 opacity, signals at 0.8. Reference lines with increased visibility (0.45 opacity for OB/OS, 0.2 for zero lines). AO directional histogram coloring (green increasing, red decreasing). Squeeze 4-color momentum histogram. Category-colored dots in IndicatorSelector. Panel color dots for multi-output subchart indicators. Min panel height 100px, scrollable subchart area (50vh max). Logic in `useChartOverlays.ts`, color utility `colorToRgba()` in `indicatorColors.ts`.

### Indicator UI Improvements (2026-03-25)
- Band/channel fills via AreaSeries (Bollinger, Keltner, Donchian, Ichimoku, AccBands) with 6% opacity
- Line style differentiation: dashed signal lines, dotted chikou span, tiered opacity levels
- Enhanced reference line visibility (0.45 opacity for OB/OS levels, 0.2 for zero lines)
- Directional histogram coloring: AO (green increasing, red decreasing), Squeeze (4-color momentum)
- Category-colored indicator selector with colored dots per category
- Multi-output panel label dots for subchart indicators with multiple outputs

## API Route Map (11 routers on `/api`)

| Router      | Mount              | Purpose                                                                              |
| ----------- | ------------------ | ------------------------------------------------------------------------------------ |
| upload      | `/api/upload`      | File upload + OHLCV ingestion (CSV, ZST, Parquet, DBN; 500MB max)                    |
| parquet     | `/api/parquet`     | Parquet file queries, aggregation, cursor pagination, export, rollovers              |
| instruments | `/api/instruments` | Instrument metadata, rollovers                                                       |
| training    | `/api/training`    | Universal training: start, stop, stream SSE, config (model registry)                 |
| ml          | `/api/ml`          | Models, features, predictions, ensembles, regimes, trades, labels, XAI               |
| news        | `/api/news`        | News articles + sentiment (Yahoo Finance RSS, Alpha Vantage)                         |
| databases   | `/api/databases`   | DB health/stats, read-only SQL queries, QuestDB process control, pipeline status     |
| charts      | `/api/charts`      | OHLCV candles + symbols (QuestDB SAMPLE BY only, no fallback)                        |
| backtest    | `/api/backtest`    | Backtesting engine                                                                   |
| agent       | `/api/agent`       | Trading agent predictions, signals, backtesting                                      |
| regime      | `/api/regime`      | Legacy HDP-HMM training + regime queries                                             |
| system      | `/api/system`      | GPU telemetry (nvidia-smi), hardware monitoring, SSE system channel broadcast         |

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

# Build for production
npm run build

# Offline scripts
npx tsx scripts/seed-instruments.ts        # Upsert 25 instruments
python scripts/feature-research.py --symbol MNQ --timeframe 1m --source parquet  # Feature research pipeline
python scripts/dump-questdb-parquet.py --tables ohlcv --symbols MNQ             # Export QuestDB to parquet
python scripts/visualize-regimes.py --model latest                              # Generate regime analysis plots
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
| `mathPrimitives.ts` | SMA, EMA, WMA, DEMA, TEMA, StdDev, rolling stats |
| `overlayExtra.ts` | Bollinger, Keltner, Donchian, Ichimoku, Supertrend, envelope overlays |
| `momentumExtra.ts` | RSI, MACD, Stochastic, StochRSI, CCI, Williams %R, ROC, AO, PPO, TSI, Fisher, KDJ, Squeeze, STC, TRIX |
| `volatilityExtra.ts` | ATR, NATR, True Range, Ulcer Index, Chaikin Volatility |
| `volumeExtra.ts` | OBV, AD, ADOSC, CMF, EFI, EMV, KVO, MFI, NVI, PVI, VWAP, VPOC |
| `trendExtra.ts` | ADX, Aroon, CHOP, DPO, PSAR, Vortex, VHF |
| `statisticsExtra.ts` | Entropy, Kurtosis, MAD, Median, Skew, Variance, Z-Score |
| `cyclePerformance.ts` | EBSW, Reflex, Log Return, Percent Return |

**Registry**: `src/client/src/lib/indicatorRegistry.ts` — all indicator definitions with typed params
**Dispatch**: `src/client/src/lib/indicatorCompute.ts` — routes each indicator to its calculator
**Candle patterns**: 60 CDL_* patterns via `src/client/src/lib/candlePatterns.ts`

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
- **Compression**: gzip via `compression` middleware (threshold 1KB, skips SSE streams). ~80% reduction on OHLCV/chart responses.
- **Request IDs**: Every response includes `X-Request-ID` header. Auto-generated UUID, or forwarded from `X-Request-ID` on incoming request. Included in error responses and slow request logs.
- **Request timeouts**: 30s default for API routes. SSE streams and `/training/start` exempt (timeout=0). Returns 408 on timeout.
- **Health endpoint**: `GET /health` — returns `{ status, uptime, memory: { heapUsed, heapTotal, rss }, timestamp }`. No auth required.
- **Security headers**: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` on all responses.
- **Slow request logging**: Requests >5s logged with `[SLOW reqId]` prefix for performance debugging.
- **Async file I/O**: All config file reads use `fs.promises` — no blocking `readFileSync` in route handlers.
- **Metric descriptions**: `GET /api/training/metric-descriptions` serves `src/config/metric-descriptions.json` — 7 HDP-HMM metrics with titles, formats, descriptions, healthy ranges.

### ML Pipeline Performance
- **Numba JIT**: Rolling z-score, rolling std, rolling mean, ROC, percentile rank all Numba-compiled. ~50x vs pandas on 500k+ rows.
- **Parquet cache**: QuestDB fetch cached to `data/.cache/` as zstd parquet. First fetch ~280s, subsequent reads <1s. 24h TTL. Auto-invalidated on ingestion (upload + MotiveWave watcher) via `cache/parquet.ts`.
- **Cache warming**: Symbol catalog pre-fetched on server startup (fire-and-forget after listen). See `warmSymbolsCatalog()` in `cache/symbols.ts`.
- **Monthly partition fetch**: QuestDB large table queries split into monthly chunks to avoid PG wire timeout on 150M+ row tables.
- **Vectorized emission LL**: HDP-HMM `_compute_log_likelihood` uses 3 BLAS matmuls instead of K-loop. ~3-5x speedup on 2M+ bars.
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
- **QuestDB OHLCV-only**: Only 2 tables remain: `ohlcv` (856M rows, 1-minute bars) and `symbols` (instrument metadata). All materialized views dropped. All timeframe aggregation uses `SAMPLE BY` on the base table. Label generators use `wrapWithSampleBy()` to inject a `sampled_ohlcv` CTE when `timeframeMinutes > 1`. All features computed from parquet files or in-memory. Continuous contracts derived from OHLCV volume at query time.
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
- `/frontend` — UI development patterns and components
- `/debug` — Troubleshooting and health checks
