# ML Dashboard

Full-stack ML Dashboard for quantitative trading research. Electron desktop app + web (React 19 + Express 5) with a 2-database architecture (SQLite + QuestDB).

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
- **ML**: TensorFlow.js-node (CNN models), technical indicators, label generation, XAI (9 methods)
- **Indicators**: pandas-ta (Python, 344 pre-computed columns) + TypeScript SQL generators (13 core indicators for realtime)
- **Desktop**: Electron 34
- **Testing**: Vitest
- **Build**: Vite 7, esbuild, tsx

## Database Architecture

Two databases with distinct responsibilities:

| Database          | Role                                                  | Persistent? | Connection                                 |
| ----------------- | ----------------------------------------------------- | ----------- | ------------------------------------------ |
| **SQLite**        | App metadata: users, ML models, training, instruments | Yes         | Embedded (`data/ml_dashboard.db`)          |
| **QuestDB 9.3.1** | Source of truth for ALL time-series data              | Yes         | HTTP `:9000`, ILP `:9009`, PG wire `:8812` |

Plus file-based stores:

| Store          | Role                                | Size |
| -------------- | ----------------------------------- | ---- |
| `data/models/` | Trained model checkpoints (HDP-HMM) | Var. |

### When to Use Which

- **SQLite**: All CRUD, relationships, metadata — model registry, trade logs, backtest results, instruments, uploads, labels, ensembles, training sessions, news
- **QuestDB**: ALL time-series queries — chart rendering (`SAMPLE BY`), training data (Python reads via PG wire), trades, MBP-10 depth, pre-computed indicators (`indicators_{tf}` tables), model outputs (`model_regimes`, `model_shap`)

### Database Paths (Local Installs)
```
SQLite:     data/ml_dashboard.db (embedded, WAL mode)

QuestDB:    E:\source\databases\questdb-9.3.3-rt-windows-x86-64\
  bin:      E:\source\databases\questdb-9.3.3-rt-windows-x86-64\bin\java.exe
  service:  Registered as Windows service "QuestDB" (nssm, auto-start)
```

### QuestDB Schema (47 objects: 19 tables + 22 materialized views + 6 views)

**Base Tables (19)**:

| Table | Rows | Partition | Dedup | Schema |
| ----- | ---- | --------- | ----- | ------ |
| `ohlcv` | 856M | DAY | yes | symbol, timestamp, open, high, low, close, volume |
| `ohlcv_forex` | 38.6M | WEEK | no | symbol, open, high, low, close, volume, timestamp |
| `futures_ohlcv` | 0 (empty) | DAY | yes | symbol, root, timestamp, open, high, low, close, volume |
| `mbp10` | 400M | DAY | yes | 73 cols: ts_recv, ts_event, symbol, 10-level bid/ask (px/sz/ct) |
| `trades` | 12.7M | DAY | yes | 14 cols: ts_event, symbol, price, size, side, flags, etc. |
| `rollovers` | 353 | YEAR | yes | root, rollover_date, from_contract, to_contract, from_close, to_close, price_gap, cumulative_adjustment |
| `symbols` | 904 | DAY | no | symbol, asset_class, tick_size, timestamp |
| `labels` | 77.8M | MONTH | no | 15 cols: timestamp, symbol, close, regime/trend/exec directions, confluence, reversal, volatility |
| `swing_labels` | 2.0M | MONTH | no | 13 cols: timestamp, symbol, dir at 7 horizons (1m-1h), proximity, magnitude, transition |
| `triple_barrier_labels` | 2.0M | MONTH | no | timestamp, symbol, tb_label, tb_holding_period, tb_return, tb_upper, tb_lower |
| `features_1m` | 2.3M | DAY | no | 36 cols: symbol, OHLCV, returns, SMAs, EMAs, MACD, BB, ATR, RSI, vol_ratio, timestamp |
| `training_1m` | 2.0M | MONTH | no | 47 cols: features_1m + label columns joined |
| `talib_features` | 153M | MONTH | no | 141 cols: timestamp, symbol + 139 TA-Lib indicators |
| `talib_features_clean` | 6.4M | NONE | no | Same 141 cols, cleaned/filtered subset. Non-WAL. |
| `ob_features_1m` | 104K | MONTH | yes | 62 cols: 1-min aggregated orderbook features (10 levels) |
| `trade_features_1m` | 50K | MONTH | yes | 9 cols: trade_count, total_volume, VWAP, first/last/high/low price |
| `model_regimes` | 100K | YEAR | yes | model_id, symbol, ts, close, regime, regime_label, split |
| `model_shap` | 530K | YEAR | yes | 32 cols: model_id, symbol, ts, regime, shap_* for 28 features |
| `training_metrics` | 2.5K | DAY | no | phase, model, metric, value, step, epoch, fold, timestamp |

**Materialized Views (22)** — all `immediate` refresh (auto-update on insert), all `valid`:

| Base Table | Materialized Views (SAMPLE BY) |
| ---------- | ------------------------------ |
| `ohlcv` | `ohlcv_1m`, `ohlcv_5m`, `ohlcv_15m`, `ohlcv_30m`, `ohlcv_1h`, `ohlcv_4h`, `ohlcv_1d`, `ohlcv_1w` |
| `ohlcv_forex` | `ohlcv_forex_5m`, `ohlcv_forex_15m`, `ohlcv_forex_30m`, `ohlcv_forex_1h`, `ohlcv_forex_4h`, `ohlcv_forex_1d`, `ohlcv_forex_1w` |
| `futures_ohlcv` | `futures_ohlcv_5m`, `futures_ohlcv_15m`, `futures_ohlcv_30m`, `futures_ohlcv_1h`, `futures_ohlcv_4h`, `futures_ohlcv_1d`, `futures_ohlcv_1w` |

**Regular Views (6)**:

| View | Purpose |
| ---- | ------- |
| `view_futures_panama_adj` | Latest Panama canal adjustment per root (LATEST ON rollover_date) |
| `view_current_front_month` | Current front-month contract per root (LATEST ON timestamp) |
| `view_futures_inventory` | Contract count/date range per root (GROUP BY root, symbol) |
| `view_forex_inventory` | Symbol count/date range for forex (GROUP BY symbol) |
| `view_futures_latest_rollovers` | Most recent rollover per root (max rollover_date) |
| `view_futures_active_contracts` | Currently active contract per root (LATEST ON timestamp) |

**Data Ingestion**: ILP protocol (port 9009) via Node.js Sender. File dedup tracked in SQLite `ingested_files`.

**QuestDB Performance Features**:
- `SAMPLE BY` aggregation for chart timeframes
- `LATEST ON` for instant last-value-per-symbol lookup
- `ASOF JOIN + TOLERANCE` for trade-to-quote matching
- JIT-compiled WHERE filters (SIMD/AVX2, ~3.3 GB/s)
- Detach/Attach partitions for cold storage
- Materialized views with `immediate` refresh for zero-query-latency timeframe aggregation

**QuestDB as Windows Service**:
- Managed via `nssm` (Non-Sucking Service Manager)
- Auto-starts on boot, auto-restarts on crash
- `nssm start/stop/status QuestDB` to manage
- PostgreSQL also registered as service (`nssm start/stop/status PostgreSQL`)

### SQLite Schema (22 tables in `shared/schema.ts`)

**User & Auth**: `users`
**ML Observatory**: `ml_models`, `feature_sets`, `model_outputs`, `coherence_snapshots`, `ensemble_configs`, `generated_labels`, `contrastive_pairs`, `market_regimes`
**Trading & Backtesting**: `trades`, `backtest_runs`, `backtest_trades`, `broker_configs`, `instruments`, `feature_importance`
**Training & Data**: `training_sessions`, `loss_history`, `uploads`, `ingested_files`, `news_articles`, `news_symbols`

### Standardized OHLCV Schema

All market data uses: `ts` (TIMESTAMP), `symbol` (VARCHAR), `open`, `high`, `low`, `close` (DOUBLE), `volume` (BIGINT)

- Column names standardized on ingestion (`ts_event` -> `ts`, `instrument_id` -> `symbol`)
- Futures: Rollover stitching via QuestDB `rollovers` table (353 rows, 8 roots). Default: raw prices (no adjustment). Optional: `?adjustment=panama|ratio`
- Forex: `pipSize` varies (0.0001 standard, 0.01 for JPY pairs)

### Data Pipeline

```
QuestDB OHLCV (source of truth, 759.5M rows)
    |
    +--> Python training reads QuestDB directly (PG wire :8812)
    |        |
    |        v
    |    features.py computes 29 inline features from raw OHLCV
    |        |
    |        v
    |    HDP-HMM regime discovery → writes model_regimes + model_shap to QuestDB
    |
    +--> Offline indicator pipeline
    |        |
    |        v
    |    compute-indicators.py (344 pandas-ta indicators)
    |        |
    |        v
    |    upload-indicators-questdb.py → QuestDB indicators_{tf} tables
    |
    +--> Chart API (SAMPLE BY, materialized views)
```

## Project Structure

```
client/src/
  pages/            12 pages: Dashboard, DataSets, MLHub, Portfolio, Watchlist,
                    News, Databases, Observatory, Training, Signals, Backtest, not-found
  components/       shadcn/ui + domain components (ExplainableAI, IndicatorPanel,
                    LabelGeneration, LossSurface3D, TradingChart, VisualizationOrchestrator)
  components/visualizations/  8 types: AnomalyTimeline, ComponentLoadings,
                    ConfusionMatrixHeatmap, EmbeddingScatter, ForceDirectedCluster,
                    ForecastRibbon, ResidualPlot, SimilarityMatrix
  hooks/            useMarketData, use-toast
  lib/              queryClient, prefetch, mlModels (50+ model definitions), utils

server/
  main.ts           Express app + NestJS DI bootstrap
  core/routes.ts    Route registration (11 routers)
  routes/           upload, instruments, indicators, ml, news, databases, charts,
                    backtest, agent, regime, training
  database/
    db.ts           Drizzle SQLite connection (better-sqlite3, WAL mode)
    health.ts       Cross-DB health monitoring (SQLite + QuestDB, circuit breaker)
    database.module.ts  NestJS DI module (QuestDBService, SQLiteService)
    questdb.service.ts  NestJS QuestDB facade
    sqlite.service.ts   NestJS SQLite facade
    typeorm.module.ts   TypeORM config
    questdb/
      connection.ts   Low-level clients (Sender, pg.Pool, queryQuestDB, insertOHLCVBatch)
      marketData.ts   OHLCV SAMPLE BY queries, materialized view lookup, rollover stitching
      introspection.ts  Schema metadata (SHOW TABLES, columns, partitions, stats)
      httpQuery.ts    QuestDB HTTP API (questdbHttpQuery, questdbExportParquet, questdbImportCSV)
      export.ts       Parquet export via /exp endpoint
      tables.ts       DDL (createOHLCVTable, createTradesTable, createMBP10Table)
      lifecycle.ts    QuestDB process lifecycle (start, stop, status)
      integration.ts  Circuit-breaker-wrapped insert/query + pipeline metrics
      ohlcvQuery.ts   OHLCV query orchestration (health check, time-window estimation, caching)
      index.ts        Barrel re-exporting all sub-modules
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
    indicators/     registry (344 indicators via pandas-ta), sqlGenerator, precomputedService
    labels/         sqlLabelGenerators (15+ types), contrastivePairs, labelService
    xai/            xaiService (9 methods: SHAP, LIME, GradCAM, Integrated Gradients,
                    Saliency, Permutation, Feature Interaction, Calibration, Counterfactual)
    circuitBreaker.ts  Auto-disable failing DB connections
    rateLimiter.ts  API 100/min, ML 50/min, upload 10/min
    metrics.ts            Performance tracking
  ml/               trainer.ts (MLTrainer + SSE streaming), cnn.ts

ml/                 Python ML model packages
  shared/           Shared across ALL models
    features.py     Config-driven feature computation (29 features, 8 categories)
    normalizer.py   Feature classification (8 types) + transform functions (rolling_zscore, scale_bounded, pct_from_close, price_ratio, cumulative_roc). Constants: ROLLING_WINDOW=50, CLIP_RANGE=5.0
    swing.py        Causal zigzag detection (no lookahead)
    protocol.py     JSON stdout protocol (emit_progress, emit_metric, etc.)
    data.py         QuestDB OHLCV loading via PG wire (psycopg2)
  hdp_hmm/          Sticky HDP-HMM regime detection package
    main.py         Entry point spawned by pythonRunner.ts (CLI + orchestration)
    model.py        StickyHDPHMM class + Numba JIT kernels (~500 lines)
    config.py       Model constants (K_TRUNC=20, NIG priors)
    io/             Model-specific I/O (save, relabel, SHAP, evaluation, quality)

shared/
  schema.ts         22 SQLite tables (Drizzle definitions + Zod validation)
  mlTaxonomy.ts     ML categories, subcategories, metrics, XAI method registry (~1600 lines)
  trainingTypes.ts  Universal training types (TrainingRequest, SSE events, overlay payloads)

config/
  models.json       Model registry (hdp-hmm, cnn-universal — runner, script, hyperparams)
  features.json     Feature registry (29 features, 8 categories, normalization config)
  training.json     Infrastructure: paths, limits, timeframe map

scripts/
  compute-indicators.py        Batch compute ALL pandas-ta indicators (344 columns, 25 symbols × 8 timeframes)
  normalize-indicators.py      Normalize indicator parquets (imports classification + transforms from src/ml/shared/normalizer.py)
  upload-indicators-questdb.py Upload indicator parquets to QuestDB indicators_{tf} tables
  seed-instruments.ts          Upsert 25 instruments (8 futures + 17 forex)
  inspect-sources.ts           Inspect source data files

electron/
  main.cjs             Electron main process
  start-databases.cjs  Database lifecycle (QuestDB java.exe)
  preload.cjs          Preload script

data/
  ml_dashboard.db      SQLite database (WAL mode)
  models/              Trained model checkpoints (HDP-HMM)
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
- **Python scripts**: Each script does one pipeline step (`compute-indicators.py` → indicators only, `normalize-indicators.py` → normalization only).

### OCP — Open/Closed
> Add new behavior by adding new code, not by editing existing code.

- **ML models**: New model = new directory in `src/ml/` following `hdp_hmm/` pattern (main.py, model.py, config.py, io/) + entry in `config/models.json`. Shared utils live in `src/ml/shared/`.
- **Indicators**: Add SQL indicator entry to `sqlGenerator.ts` registry map — never add `if (name === 'x')` branches.
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
- **Pre-computed indicators**: pandas-ta computes 344 indicator columns (9 categories). Stored in QuestDB `indicators_{tf}` tables, served via `/api/indicators/data/:symbol`.
- **Rollover stitching**: Futures root symbols (ES, MNQ, M2K, etc.) are stitched at query time from per-contract OHLCV using the `rollovers` table. Frontend references root symbols only — all rollover/front-month logic is backend.
- **Circuit breaker**: Auto-disable failing DB connections. States: closed (normal), open (failing, fast-fail), half-open (testing). Reset via `POST /circuit-breaker/reset/:name`.
- **File-level dedup**: SHA-256 hash tracking in SQLite `ingested_files` table prevents re-ingestion.
- **Chart data flow**: QuestDB `SAMPLE BY` for chart candles. Futures roots use rollover stitching (`getStitchedOHLCV`, default: no price adjustment); forex uses direct queries.
- **Training data flow**: Python reads QuestDB directly via PG wire (psycopg2), computes features inline, writes results back to QuestDB via HTTP `/imp`.

## API Route Map (11 routers on `/api`)

| Router      | Mount              | Purpose                                                                              |
| ----------- | ------------------ | ------------------------------------------------------------------------------------ |
| upload      | `/api/upload`      | File upload + OHLCV ingestion (CSV, ZST, Parquet, DBN; 500MB max)                    |
| parquet     | `/api/parquet`     | Parquet file queries, aggregation, cursor pagination, export, rollovers              |
| instruments | `/api/instruments` | Instrument metadata, rollovers                                                       |
| indicators  | `/api/indicators`  | 344 pre-computed indicators (catalog, data, patterns), SQL generation, realtime calc |
| training    | `/api/training`    | Universal training: start, stop, stream SSE, config (model registry)                 |
| ml          | `/api/ml`          | Models, features, predictions, ensembles, regimes, trades, labels, XAI               |
| news        | `/api/news`        | News articles + sentiment (Yahoo Finance RSS, Alpha Vantage)                         |
| databases   | `/api/databases`   | DB health/stats, read-only SQL queries, QuestDB process control, pipeline status     |
| charts      | `/api/charts`      | OHLCV candles + symbols (QuestDB SAMPLE BY only, no fallback)                        |
| backtest    | `/api/backtest`    | Backtesting engine                                                                   |
| agent       | `/api/agent`       | Trading agent predictions, signals, backtesting                                      |
| regime      | `/api/regime`      | Legacy HDP-HMM training + regime queries                                             |

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
python scripts/compute-indicators.py       # ALL pandas-ta indicators (344 columns, 200 files)
python scripts/compute-indicators.py --symbol ES --timeframe 1d  # Single combo
python scripts/upload-indicators-questdb.py  # Upload indicator parquets to QuestDB
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

## Environment Variables (.env)

```
QUESTDB_HOST=localhost
QUESTDB_ILP_PORT=9009
QUESTDB_PG_PORT=8812
QUESTDB_HTTP_PORT=9000
PORT=5000
NODE_ENV=development
```

## Indicators (344 columns via pandas-ta)

Pre-computed for all 25 symbols × 8 timeframes via `scripts/compute-indicators.py`.

| Category            | Count | Examples                                                                                                   |
| ------------------- | ----- | ---------------------------------------------------------------------------------------------------------- |
| **Candle Patterns** | 62    | CDL_DOJI, CDL_HAMMER, CDL_ENGULFING, CDL_MORNINGSTAR, CDL_SHOOTINGSTAR                                     |
| **Overlap**         | 36    | SMA, EMA, WMA, DEMA, TEMA, T3, KAMA, HMA, ALMA, Ichimoku, Supertrend, Bollinger, Keltner, Donchian         |
| **Momentum**        | 43    | RSI, MACD, Stochastic, StochRSI, CCI, Williams %R, ROC, AO, APO, PPO, Fisher, KDJ, Squeeze, STC, TRIX, TSI |
| **Volatility**      | 16    | ATR, NATR, True Range, Keltner, Aberration, Thermo, Ulcer Index, HWC                                       |
| **Volume**          | 19    | OBV, AD, ADOSC, CMF, EFI, EMV, KVO, MFI, NVI, PVI, VWAP, TSV                                               |
| **Trend**           | 20    | ADX, AROON, CHOP, DPO, PSAR, Vortex, VHF, ZigZag, Chandelier Exit                                          |
| **Statistics**      | 10    | Entropy, Kurtosis, MAD, Median, Quantile, Skew, StdDev, Variance, Z-Score                                  |
| **Cycle**           | 2     | EBSW, Reflex                                                                                               |
| **Performance**     | 2     | Log Return, Percent Return                                                                                 |

Also available: 13 core indicators via TypeScript SQL generators for realtime computation (RSI, MACD, Bollinger, ATR, Stochastic, CCI, Williams %R, ROC, Momentum, SMA, EMA, WMA, StdDev).

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

### Performance
- lightweight-charts: `enableConflation: true` + `conflationThresholdFactor: 1.0` for 10k+ bar datasets
- Web Vitals monitoring in dev mode (LCP, FID, CLS) via `useWebVitals()` hook
- `useDeferredFilter()` hook for search/filter inputs (wraps `useDeferredValue`)
- `RingBuffer<T>` class in `lib/ringBuffer.ts` for O(1) push event accumulation
- Training context split: `useTrainingMetrics()`, `useTrainingLogs()`, `useTrainingOverlays()` for granular subscriptions

## Common Pitfalls

- **Windows paths**: Use forward slashes in Node.js code, backslashes in shell commands
- **npx shims**: Use `npx tsx` not `tsx` directly on Windows; or use `npm run` scripts
- **`--env-file` flag**: Requires Node 20.6+; the dev script uses `node --env-file=.env --import tsx`
- **Rate limits**: API 100/min, ML 50/min, upload 10/min
- **QuestDB startup**: Registered as Windows service via nssm (auto-start on boot). Also manageable with `nssm start/stop/status QuestDB`
- **QuestDB LIMIT syntax**: `LIMIT offset, count` (NOT `LIMIT count OFFSET offset`)
- **QuestDB count**: `count()` (NOT `COUNT(*)`)
- **QuestDB cast**: `CAST(x AS INT)` (NOT `CAST(x AS INTEGER)`)
- **QuestDB /imp timestamps**: Require `T` separator (not space), no timezone offset like `+00`
- **QuestDB `nm=true`**: Strips `columns` metadata from `/exec` response — do NOT use if code needs column names
- **Vite dev vs production**: Vite middleware only loaded in development; production uses static file serving from `dist/`
- **Schema push**: Always run `npx drizzle-kit push` after modifying `shared/schema.ts`
- **Indicator column names**: pandas-ta naming convention with dots/percent sanitized (e.g., `BBL_20_2.0` → `BBL_20_2_0`, `%` → `pct`)

## Claude Skills

Available skills in `.claude/commands/`:
- `/db-manage` — Start/stop/status/reset/migrate databases
- `/ingest-data` — Upload and ingest market data (futures, forex, trades, MBP-10, indicators)
- `/ml-pipeline` — Feature engineering, labels, training, XAI
- `/architecture` — Schema reference and architecture guide
- `/frontend` — UI development patterns and components
- `/debug` — Troubleshooting and health checks
