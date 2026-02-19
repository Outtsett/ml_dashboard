# ML Dashboard

Full-stack ML Dashboard for quantitative trading research. Electron desktop app + web (React 19 + Express 5) with a 3-database architecture.

## Tech Stack

- **Frontend**: React 19, Wouter router, TanStack Query, Tailwind v4, shadcn/ui (Radix), Recharts, Lightweight Charts, Three.js/R3F, D3, Framer Motion
- **Backend**: Express 5, TypeScript, Node.js
- **ORM**: Drizzle ORM with Zod validation
- **ML**: TensorFlow.js-node (CNN models), technical indicators, label generation, XAI (9 methods)
- **Desktop**: Electron 34
- **Testing**: Vitest
- **Build**: Vite 7, esbuild, tsx

## Database Architecture

Three databases with distinct responsibilities:

| Database | Role | Connection |
|----------|------|------------|
| **PostgreSQL 18 + TimescaleDB** | App layer: users, ML models, training sessions, labels, trades, ensembles, regimes, news (21 Drizzle tables) | `postgresql://postgres:postgres@localhost:5432/ml_dashboard` (trust auth) |
| **QuestDB 9.3.1** | Chart rendering via `SAMPLE BY` for timeframe aggregation | HTTP `:9000`, ILP `:9009`, PG wire `:8812` |
| **DuckDB 1.4** | Market data source of truth (file-backed) + analytics engine | Embedded, `data/market.duckdb` |

### When to Use Which
- **PostgreSQL**: Anything with relationships, CRUD, metadata, auth, model registry, trade logs
- **QuestDB**: Chart candle rendering (SAMPLE BY aggregation), streaming tick ingestion via ILP
- **DuckDB market.ts**: Market data source of truth, ingestion, indicator SQL, label generation
- **DuckDB core.ts/duckdb.ts**: In-memory analytics, parquet queries, feature engineering

### Database Paths (Local Installs)
```
PostgreSQL: E:\source\databases\PostgreSQL\pgsql\
  bin:      E:\source\databases\PostgreSQL\pgsql\bin\pg_ctl.exe
  data:     E:\source\databases\PostgreSQL\pgsql\data\

QuestDB:    E:\source\databases\questdb-9.3.1-rt-windows-x86-64\
  bin:      E:\source\databases\questdb-9.3.1-rt-windows-x86-64\bin\java.exe

DuckDB:     In-process, no external server
  market:   data/market.duckdb (file-backed, persistent)
  analytics: in-memory (ephemeral)
```

### Standardized OHLCV Schema

All market data uses: `ts` (TIMESTAMP), `symbol` (VARCHAR), `open`, `high`, `low`, `close` (DOUBLE), `volume` (BIGINT)

- Column names are standardized on ingestion (`ts_event` -> `ts`, `instrument_id` -> `symbol` via JOIN)
- Futures: ratio back-adjustment for rollovers (NOT Panama)
- Forex: `pipSize` varies (0.0001 standard, 0.01 for JPY pairs)

### PostgreSQL Schema (21 tables in `shared/schema.ts`)

users, ohlcv_data, uploads, feature_importance, contract_rollovers, training_sessions, loss_history, instruments, news_articles, news_symbols, ml_models, feature_sets, model_outputs, model_output_embeddings, ensemble_configs, market_regimes, regime_history, trades, coherence_snapshots, generated_labels, contrastive_pairs

## Project Structure

```
client/src/
  pages/            12 pages: Dashboard, DataSets, MLHub, Portfolio, Watchlist,
                    News, Databases, Observatory, Training, Signals, Backtest, not-found
  components/       shadcn/ui + domain components (ExplainableAI, IndicatorPanel,
                    LabelGeneration, LossSurface3D, VisualizationOrchestrator)
  components/visualizations/  8 types: AnomalyTimeline, ComponentLoadings,
                    ConfusionMatrixHeatmap, EmbeddingScatter, ForceDirectedCluster,
                    ForecastRibbon, ResidualPlot, SimilarityMatrix
  hooks/            useMarketData, use-toast
  lib/              queryClient, prefetch, mlModels (50+ model definitions), utils

server/
  index.ts          Express app + startup (initMarketDB, startQuestDB, setupPartitions)
  routes.ts         Route registration (8 routers)
  routes/           upload, parquet, instruments, indicators, ml, news, databases, charts
  db.ts             Drizzle PostgreSQL connection
  storage.ts        Drizzle queries for all PostgreSQL tables
  duckdb.ts         In-memory analytics DuckDB (legacy)
  questdb.ts        QuestDB client
  duckdb/
    market.ts       File-backed market DuckDB (source of truth, Mutex serialization)
    analytics.ts    Analytics queries
    core.ts         In-memory DuckDB setup
    queries.ts      Query helpers
    fileOps.ts      File operations
    mlFeatures.ts   ML feature generation
    introspection.ts  Schema introspection
    preAggregation.ts  Pre-aggregated data
  lib/
    ingestion/      fileTracker (SHA-256 dedup), standardize, ingestParquet
    indicators/     registry (36+ indicators), sqlGenerator, math, indicatorService
    labels/         sqlLabelGenerators (15+ types), contrastivePairs, labelService
    xai/            xaiService (9 methods: SHAP, LIME, GradCAM, Integrated Gradients,
                    Saliency, Permutation, Feature Interaction, Calibration, Counterfactual)
    questdbSync.ts  DuckDB -> QuestDB bulk sync via ILP
    questdbProcess.ts  QuestDB java.exe lifecycle management
    circuitBreaker.ts  Auto-disable failing DB connections
    databaseHealth.ts  Health monitoring
    rateLimiter.ts  API 100/min, ML 50/min, upload 10/min
    streamingPipeline.ts  CSV/Parquet -> multi-DB streaming
    unifiedIngestion.ts   Multi-DB ingestion coordinator
    dataPipeline.ts       ETL orchestration
    metrics.ts            Performance tracking
  ml/               trainer.ts (MLTrainer + SSE streaming), cnn.ts, dataPipeline.ts

shared/
  schema.ts         21 PostgreSQL tables (Drizzle definitions + Zod validation)
  mlTaxonomy.ts     ML categories, subcategories, metrics, XAI method registry (~1600 lines)

scripts/
  ingest-futures.ts    Migrate futures from analytics.duckdb -> market.duckdb
  ingest-forex.ts      Migrate forex from forex.duckdb + parquets -> market.duckdb
  sync-to-questdb.ts   DuckDB -> QuestDB bulk sync
  seed-instruments.ts  Upsert 24 instruments (8 futures + 16 forex)
  inspect-sources.ts   Inspect source data files

electron/
  main.cjs             Electron main process
  start-databases.cjs  Database lifecycle (pg_ctl + QuestDB java.exe)
  preload.cjs          Preload script

data/
  sources/             Raw data files (analytics.duckdb, forex.duckdb)
  sources/forex/       16 forex pair parquets (6Y of M1 data each)
  market.duckdb        Clean market data (generated by ingestion scripts)
```

## Path Aliases (tsconfig.json)

- `@/*` -> `./client/src/*`
- `@shared/*` -> `./shared/*`

## Key Architectural Patterns

- **EventEmitter training**: `MLTrainer extends EventEmitter` emits progress events per epoch. Frontend connects via SSE at `GET /ml/train/stream`.
- **SQL-first indicators/labels**: DuckDB SQL window functions for batch processing. Direction labels and triple barrier labels generate via SQL CTEs, not row-by-row.
- **Circuit breaker**: Auto-disable failing DB connections. States: closed (normal), open (failing, fast-fail), half-open (testing). Reset via `POST /circuit-breaker/reset/:name`.
- **Fallback routing**: TimescaleDB hypertables -> partitioned tables -> legacy `ohlcv_data` table. Queries try each in order.
- **File-level dedup**: SHA-256 hash tracking in `ingested_files` DuckDB table prevents re-ingestion.
- **Mutex serialization**: File-backed DuckDB (`market.duckdb`) needs serialized access via Mutex class.
- **Chart data flow**: QuestDB `SAMPLE BY` is primary for candle rendering, DuckDB is fallback.
- **Multi-DB ingestion**: Upload -> `unifiedIngestion.ts` -> parallel writes to DuckDB + QuestDB (ILP).

## API Route Map (8 routers on `/api`)

| Router | Mount | Purpose |
|--------|-------|---------|
| upload | `/api/upload` | File upload + OHLCV ingestion (CSV, ZST, Parquet, DBN; 500MB max) |
| parquet | `/api/parquet` | Parquet file queries, aggregation, cursor pagination, export |
| instruments | `/api/instruments` | Instrument metadata, rollovers, continuous contracts |
| indicators | `/api/indicators` | Technical indicator computation, SQL generation, batch calc |
| ml | `/api/ml` | Models, training, features, predictions, ensembles, regimes, trades, labels, XAI |
| news | `/api/news` | News articles + sentiment (Yahoo Finance RSS, Alpha Vantage) |
| databases | `/api/databases` | DB health/stats, read-only SQL queries, QuestDB process control, pipeline status |
| charts | `/api/charts` | OHLCV candles (QuestDB SAMPLE BY primary, DuckDB fallback) |

## Dev Commands

```bash
# Start databases (PostgreSQL + QuestDB)
node electron/start-databases.cjs

# Push Drizzle schema changes to PostgreSQL
npm run db:push

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

# Run ingestion scripts
npx tsx scripts/ingest-futures.ts
npx tsx scripts/ingest-forex.ts
npx tsx scripts/sync-to-questdb.ts
npx tsx scripts/seed-instruments.ts
```

## NPM Scripts

| Script | Purpose |
|--------|---------|
| `dev` | Full dev server (Express + Vite, port 5000) |
| `dev:client` | Vite-only dev server |
| `build` | Production build (tsx script/build.ts) |
| `start` | Production server |
| `electron:dev` | Start DBs + dev + Electron |
| `build:electron` | Build + Electron NSIS installer |
| `start:desktop` | Launch Electron app |
| `db:push` | Drizzle schema push to PostgreSQL |
| `check` | TypeScript type check |
| `test` | Vitest run |
| `test:watch` | Vitest watch mode |

## Environment Variables (.env)

```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ml_dashboard
QUESTDB_HOST=localhost
QUESTDB_ILP_PORT=9009
QUESTDB_PG_PORT=8812
QUESTDB_HTTP_PORT=9000
PORT=5000
NODE_ENV=development
```

## ML Taxonomy Reference

### Categories (4) -> Subcategories (10)
| Category | Subcategories |
|----------|--------------|
| **Supervised** | classification, regression, sequence |
| **Unsupervised** | clustering, dimensionality-reduction, anomaly-detection |
| **Self-Supervised** | representation, contrastive |
| **Semi-Supervised** | pseudo-labeling, consistency |

### Label Generators (15+)
**Supervised:** direction, signal, regime, future_return, future_volatility, multi_step, triple_barrier
**Advanced:** npmm, volatility_adaptive, trend_scanning, meta_label
**Self-Supervised:** contrastive_temporal, contrastive_augmentation, contrastive_statistical
**Semi-Supervised:** pseudo_confidence, consistency_perturbation

### XAI Methods (9)
SHAP, Permutation Importance, GradCAM, Integrated Gradients, Saliency Maps, LIME, Feature Interactions, Confidence Calibration, Counterfactuals

### Indicators (36+)
**Trend:** SMA, EMA, WMA, ADX, AROON, KAMA, SAR, DEMA
**Momentum:** RSI, MACD, Stochastic, CCI, Williams %R, KDJ, ROC, MFI
**Volatility:** Bollinger Bands, ATR, Keltner Channels, NATR, TRANGE
**Volume:** OBV, CMF, AD

## Common Pitfalls

- **Windows paths**: Use forward slashes in Node.js code and DuckDB SQL (`read_parquet('E:/data/file.parquet')`), backslashes in shell commands
- **npx shims**: Use `npx tsx` not `tsx` directly on Windows; or use `npm run` scripts
- **`--env-file` flag**: Requires Node 20.6+; the dev script uses `node --env-file=.env --import tsx`
- **DuckDB BigInt**: `COUNT(*)` returns BigInt; wrap with `Number()` for comparisons and JSON serialization
- **DuckDB mutex**: File-backed DB (`market.duckdb`) needs serialized access via the Mutex class in `market.ts`
- **DuckDB volume type**: `volume` is `BIGINT` in DuckDB market tables, not `DOUBLE`
- **Rate limits**: API 100/min, ML 50/min, upload 10/min
- **QuestDB startup**: Uses `java.exe` directly (not questdb.exe as a service); PID saved to `.questdb.pid`
- **Vite dev vs production**: Vite middleware only loaded in development; production uses static file serving from `dist/`
- **Schema push**: Always run `npm run db:push` after modifying `shared/schema.ts`
- **MACD SQL approximation**: DuckDB SQL uses SMA approximation for MACD (true EMA needs recursive CTEs). TypeScript calc uses true EMA. Results differ slightly.
- **TimescaleDB extension**: Must `CREATE EXTENSION IF NOT EXISTS timescaledb` before creating hypertables

## Claude Skills

Available skills in `.claude/commands/`:
- `/db-manage` — Start/stop/status/reset/migrate databases
- `/ingest-data` — Upload and ingest market data
- `/ml-pipeline` — Feature engineering, labels, training, XAI
- `/architecture` — Schema reference and architecture guide
- `/frontend` — UI development patterns and components
- `/debug` — Troubleshooting and health checks
