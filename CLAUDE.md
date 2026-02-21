# ML Dashboard

Full-stack ML Dashboard for quantitative trading research. Electron desktop app + web (React 19 + Express 5) with a 3-database architecture.

## User Learning Style

The user is an **extreme visual learner** who cannot process abstract math or theoretical concepts in text form. When explaining technical concepts (ML architectures, algorithms, data flows, etc.):

- **Always use "Think of it as..." analogies** grounded in trading/real-world terms the user already understands (e.g., "a chart pattern scanner sliding a magnifying glass", "a panel of experts voting", "a trader reading bar by bar with a mental notepad")
- **Build visual components** in the dashboard rather than writing text explanations — the user needs to SEE how things work (data flows, layer shapes, attention maps, decision trees)
- **Show data shape transformations** step-by-step (e.g., 60×31 → Conv → 30×64 → Pool → ...) so the user can trace how their data morphs through each layer
- **Use strength/weakness trade-off badges** and side-by-side comparison matrices instead of paragraphs of prose
- **Never assume math literacy** — translate formulas into visual or intuitive equivalents (e.g., "softmax = picks the strongest signal" not "softmax = e^x / Σe^x")
- **Connect every concept back to the user's actual data** — their 31 features, their 60-bar windows, their OHLCV from DuckDB — not abstract examples

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

Three databases with distinct responsibilities:

| Database                        | Role                                                                                          | Data Volume                                               | Connection                                                                |
| ------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------- |
| **PostgreSQL 18 + TimescaleDB** | App layer: users, ML models, training, labels, trades, 25 instruments, 353 contract rollovers | 21 Drizzle tables                                         | `postgresql://postgres:postgres@localhost:5432/ml_dashboard` (trust auth) |
| **QuestDB 9.3.1**               | Chart rendering via `SAMPLE BY` aggregation                                                   | 759.5M OHLCV rows (903 symbols)                           | HTTP `:9000`, ILP `:9009`, PG wire `:8812`                                |
| **DuckDB 1.4**                  | Market data source of truth + analytics                                                       | 782M OHLCV + 14.5M trades + 408.8M MBP-10 + 353 rollovers | Embedded, `data/market.duckdb`                                            |

### When to Use Which
- **PostgreSQL**: Relationships, CRUD, metadata, auth, model registry, trade logs, instruments, rollovers
- **QuestDB**: Chart candle rendering (SAMPLE BY aggregation), streaming tick ingestion
- **DuckDB market.ts**: Market data source of truth, continuous contract queries, indicator SQL, label generation
- **DuckDB core.ts/duckdb.ts**: In-memory analytics, parquet queries, feature engineering
- **Indicator parquets**: Pre-computed pandas-ta indicators in `data/indicators/` (344 columns per file)

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

### DuckDB Market Tables
| Table            | Rows   | Schema                                                                                                         |
| ---------------- | ------ | -------------------------------------------------------------------------------------------------------------- |
| `ohlcv`          | 782M   | ts, symbol, open, high, low, close, volume                                                                     |
| `trades`         | 14.5M  | ts, rtype, publisher_id, instrument_id, action, side, depth, price, size, flags, ts_in_delta, sequence, symbol |
| `mbp10`          | 408.8M | ts_recv, ts_event, 10-level bid/ask (px, sz, ct), symbol                                                       |
| `rollovers`      | 353    | root, rollover_date, from_contract, to_contract, from_close, to_close, price_gap, cumulative_adjustment        |
| `ingested_files` | —      | file_path (PK), file_hash, ingested_at, row_count                                                              |

### Standardized OHLCV Schema

All market data uses: `ts` (TIMESTAMP), `symbol` (VARCHAR), `open`, `high`, `low`, `close` (DOUBLE), `volume` (BIGINT)

- Column names are standardized on ingestion (`ts_event` -> `ts`, `instrument_id` -> `symbol` via JOIN)
- Futures: Panama additive back-adjustment for rollovers (volume-based daily detection from DuckDB)
- Forex: `pipSize` varies (0.0001 standard, 0.01 for JPY pairs)

### Continuous Contracts
Built from DuckDB directly via rollover schedule:
1. `rollovers` table stores volume-based rollover dates + Panama price gaps
2. `/api/continuous/:baseSymbol` joins OHLCV with rollover schedule, applies cumulative adjustment
3. Aggregates to any timeframe via `time_bucket()` — supports 1m, 5m, 15m, 30m, 1H, 4H, 1D, 1W
4. Client can view continuous (back-adjusted) or individual contracts

### PostgreSQL Schema (21 tables in `shared/schema.ts`)

users, ohlcv_data, uploads, feature_importance, contract_rollovers, training_sessions, loss_history, instruments, news_articles, news_symbols, ml_models, feature_sets, model_outputs, model_output_embeddings, ensemble_configs, market_regimes, regime_history, trades, coherence_snapshots, generated_labels, contrastive_pairs

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
  index.ts          Express app + startup (initMarketDB, startQuestDB, setupPartitions)
  routes.ts         Route registration (8 routers)
  routes/           upload, parquet, instruments, indicators, ml, news, databases, charts
  db.ts             Drizzle PostgreSQL connection
  storage.ts        Drizzle queries for all PostgreSQL tables
  duckdb.ts         In-memory analytics DuckDB (legacy)
  questdb.ts        QuestDB client
  duckdb/
    market.ts       File-backed market DuckDB (source of truth, Mutex serialization)
                    Tables: ohlcv, trades, mbp10, rollovers, ingested_files
    analytics.ts    Analytics queries
    core.ts         In-memory DuckDB setup
    queries.ts      Query helpers
    fileOps.ts      File operations
    mlFeatures.ts   ML feature generation (13 core indicators via SQL)
    introspection.ts  Schema introspection
    preAggregation.ts  Pre-aggregated data
  lib/
    ingestion/      fileTracker (SHA-256 dedup), standardize, ingestParquet
    indicators/     registry (344 indicators via pandas-ta), sqlGenerator, math, indicatorService
    labels/         sqlLabelGenerators (15+ types), contrastivePairs, labelService
    xai/            xaiService (9 methods: SHAP, LIME, GradCAM, Integrated Gradients,
                    Saliency, Permutation, Feature Interaction, Calibration, Counterfactual)
    questdbSync.ts  DuckDB -> QuestDB bulk sync via ILP (legacy, slow)
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
  ingest-futures.ts    Migrate futures from analytics.duckdb -> market.duckdb (720M rows)
  ingest-forex.ts      Migrate forex from forex.duckdb + parquets -> market.duckdb (103M rows)
  ingest-trades.ts     Ingest merged_trades_all.parquet -> market.duckdb trades table
  ingest-mbp10.ts      Ingest MBP-10 depth CSVs -> market.duckdb mbp10 table (210GB source)
  fast-questdb-sync.ts Bulk CSV sync DuckDB -> QuestDB via /imp (754K rows/sec)
  sync-to-questdb.ts   Legacy ILP sync (slow, replaced by fast-questdb-sync)
  compute-rollovers.ts Volume-based rollover detection + Panama adjustment (353 events, 8 roots)
  compute-indicators.py  Batch compute ALL pandas-ta indicators (344 columns, 25 symbols × 8 timeframes)
  seed-instruments.ts  Upsert 25 instruments (8 futures + 17 forex)
  convert-dbn-trades.py  Convert .dbn binary -> parquet via databento Python lib
  inspect-sources.ts   Inspect source data files

electron/
  main.cjs             Electron main process
  start-databases.cjs  Database lifecycle (pg_ctl + QuestDB java.exe)
  preload.cjs          Preload script

data/
  sources/             Raw data files (analytics.duckdb, forex.duckdb)
  sources/forex/       17 forex pair parquets (6Y of M1 data each)
  market.duckdb        Clean market data (782M OHLCV + 14.5M trades + 408.8M MBP-10)
  indicators/          Pre-computed pandas-ta indicator parquets (25 symbols × 8 timeframes)
```

## Path Aliases (tsconfig.json)

- `@/*` -> `./client/src/*`
- `@shared/*` -> `./shared/*`

## Key Architectural Patterns

- **EventEmitter training**: `MLTrainer extends EventEmitter` emits progress events per epoch. Frontend connects via SSE at `GET /ml/train/stream`.
- **SQL-first indicators/labels**: DuckDB SQL window functions for batch processing. Direction labels and triple barrier labels generate via SQL CTEs, not row-by-row.
- **Pre-computed indicators**: pandas-ta `AllStudy` computes 344 indicator columns (9 categories: overlap, momentum, volatility, volume, trend, candle, statistics, cycle, performance). Stored as parquet files in `data/indicators/`, served via `/api/indicators/data/:symbol`.
- **Continuous contracts**: DuckDB-based Panama back-adjustment using volume-detected rollover schedule. No PG views needed.
- **Circuit breaker**: Auto-disable failing DB connections. States: closed (normal), open (failing, fast-fail), half-open (testing). Reset via `POST /circuit-breaker/reset/:name`.
- **File-level dedup**: SHA-256 hash tracking in `ingested_files` DuckDB table prevents re-ingestion.
- **Mutex serialization**: File-backed DuckDB (`market.duckdb`) needs serialized access via Mutex class.
- **Chart data flow**: QuestDB `SAMPLE BY` for chart candles, DuckDB for continuous contracts and indicator data.
- **QuestDB bulk sync**: CSV export from DuckDB -> upload via QuestDB `/imp` REST endpoint (754K rows/sec, 17 min for 782M rows).

## API Route Map (8 routers on `/api`)

| Router      | Mount              | Purpose                                                                              |
| ----------- | ------------------ | ------------------------------------------------------------------------------------ |
| upload      | `/api/upload`      | File upload + OHLCV ingestion (CSV, ZST, Parquet, DBN; 500MB max)                    |
| parquet     | `/api/parquet`     | Parquet file queries, aggregation, cursor pagination, export, rollovers              |
| instruments | `/api/instruments` | Instrument metadata, rollovers, continuous contracts (DuckDB-backed)                 |
| indicators  | `/api/indicators`  | 344 pre-computed indicators (catalog, data, patterns), SQL generation, realtime calc |
| ml          | `/api/ml`          | Models, training, features, predictions, ensembles, regimes, trades, labels, XAI     |
| news        | `/api/news`        | News articles + sentiment (Yahoo Finance RSS, Alpha Vantage)                         |
| databases   | `/api/databases`   | DB health/stats, read-only SQL queries, QuestDB process control, pipeline status     |
| charts      | `/api/charts`      | OHLCV candles (QuestDB SAMPLE BY primary, DuckDB fallback)                           |

## Dev Commands

```bash
# Start databases (PostgreSQL + QuestDB)
node electron/start-databases.cjs

# Push Drizzle schema changes to PostgreSQL
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

# Data pipeline scripts
npx tsx scripts/ingest-futures.ts          # Futures OHLCV -> DuckDB (720M rows)
npx tsx scripts/ingest-forex.ts            # Forex OHLCV -> DuckDB (103M rows)
npx tsx scripts/ingest-trades.ts           # Trades -> DuckDB (14.5M rows)
npx tsx scripts/ingest-mbp10.ts            # MBP-10 depth -> DuckDB (408.8M rows)
npx tsx scripts/fast-questdb-sync.ts       # DuckDB -> QuestDB bulk CSV (759.5M rows)
npx tsx scripts/compute-rollovers.ts       # Volume-based rollover detection (353 events)
npx tsx scripts/seed-instruments.ts        # Upsert 25 instruments
python scripts/compute-indicators.py       # ALL pandas-ta indicators (344 columns, 200 files)
python scripts/compute-indicators.py --symbol ES --timeframe 1d  # Single combo
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
| `db:push`        | Drizzle schema push to PostgreSQL           |
| `check`          | TypeScript type check                       |
| `test`           | Vitest run                                  |
| `test:watch`     | Vitest watch mode                           |

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

## Common Pitfalls

- **Windows paths**: Use forward slashes in Node.js code and DuckDB SQL (`read_parquet('E:/data/file.parquet')`), backslashes in shell commands
- **npx shims**: Use `npx tsx` not `tsx` directly on Windows; or use `npm run` scripts
- **`--env-file` flag**: Requires Node 20.6+; the dev script uses `node --env-file=.env --import tsx`
- **DuckDB BigInt**: `COUNT(*)` and `epoch_ms()` return BigInt; cast to DOUBLE in SQL or wrap with `Number()` in JS for JSON serialization
- **DuckDB file lock**: File-backed DB (`market.duckdb`) allows only one writer. Dev server holds the lock — kill node processes before running scripts that write to DuckDB. Python scripts should use `read_only=True` when possible.
- **DuckDB mutex**: File-backed access needs serialized access via the Mutex class in `market.ts`
- **DuckDB volume type**: `volume` is `BIGINT` in DuckDB market tables, not `DOUBLE`
- **Rate limits**: API 100/min, ML 50/min, upload 10/min
- **QuestDB startup**: Uses `java.exe` directly (not questdb.exe as a service); PID saved to `.questdb.pid`
- **QuestDB dedup**: UPSERT KEYS(symbol, timestamp) reduces 782M DuckDB rows to 759.5M QuestDB rows (22.6M duplicates)
- **Vite dev vs production**: Vite middleware only loaded in development; production uses static file serving from `dist/`
- **Schema push**: Always run `npx drizzle-kit push` after modifying `shared/schema.ts`
- **MACD SQL approximation**: DuckDB SQL uses SMA approximation for MACD (true EMA needs recursive CTEs). TypeScript calc uses true EMA. Results differ slightly. Pre-computed pandas-ta indicators use true EMA.
- **TimescaleDB extension**: Must `CREATE EXTENSION IF NOT EXISTS timescaledb` before creating hypertables
- **Indicator parquets**: Read via DuckDB `read_parquet()` — columns include pandas-ta naming convention (e.g., `SMA_10`, `RSI_14`, `BBL_20_2.0`, `CDL_DOJI_10_0.1`)

## Claude Skills

Available skills in `.claude/commands/`:
- `/db-manage` — Start/stop/status/reset/migrate databases
- `/ingest-data` — Upload and ingest market data (futures, forex, trades, MBP-10, indicators)
- `/ml-pipeline` — Feature engineering, labels, training, XAI
- `/architecture` — Schema reference and architecture guide
- `/frontend` — UI development patterns and components
- `/debug` — Troubleshooting and health checks
