# Architecture Reference Skill

Complete schema, database rules, API map, and frontend structure for the ML Dashboard.

## Instructions

Use this as a reference when answering architecture questions, making schema changes, or understanding data flow. When the user asks about tables, routes, or components, consult the relevant section below.

## PostgreSQL Tables (21)

### Core Trading Data (5 tables)

**users** — Authentication
| Column | Type | Notes |
|--------|------|-------|
| id | varchar (PK) | gen_random_uuid |
| username | text | UNIQUE, NOT NULL |
| password | text | NOT NULL |

**ohlcv_data** — 1-second OHLCV ticks (legacy)
| Column | Type | Notes |
|--------|------|-------|
| id | serial (PK) | |
| symbol | text | NOT NULL |
| timestamp | bigint | NOT NULL |
| open, high, low, close | double precision | |
| volume | double precision | |
| *Indexes:* | | timestamp, symbol, (symbol, timestamp) |

**uploads** — Upload tracking
| Column | Type | Notes |
|--------|------|-------|
| id | serial (PK) | |
| filename | text | NOT NULL |
| symbol | text | NOT NULL |
| recordCount | integer | DEFAULT 0 |
| uploadedAt | timestamp | DEFAULT now() |
| status | text | processing / complete / failed |

**featureImportance** — Feature rankings
| Column | Type | Notes |
|--------|------|-------|
| id | serial (PK) | |
| modelName, featureName | text | NOT NULL |
| importance | double precision | NOT NULL |
| updatedAt | timestamp | DEFAULT now() |

**contractRollovers** — Futures contract management (synced from DuckDB)
| Column | Type | Notes |
|--------|------|-------|
| id | serial (PK) | |
| baseSymbol | text | e.g. "ES" |
| fromContract, toContract | text | e.g. "ESH24" → "ESM24" |
| rolloverTimestamp | bigint | epoch ms |
| priceAdjustment | double precision | Panama cumulative adjustment |
| from_close | double precision | Close price of outgoing contract |
| to_close | double precision | Close price of incoming contract |
| ratio | double precision | Price gap at rollover |

### Training & Monitoring (4 tables)

**trainingSessions** — Training job tracking
| Column | Type | Notes |
|--------|------|-------|
| id | serial (PK) | |
| modelName | text | NOT NULL |
| status | text | running / paused / completed / failed |
| currentEpoch, maxEpochs | integer | |
| currentLoss, currentValLoss | double precision | |
| learningRate | double precision | NOT NULL |
| startedAt, updatedAt | timestamp | |

**lossHistory** — 3D loss surface data
| Column | Type | Notes |
|--------|------|-------|
| id | serial (PK) | |
| sessionId | integer (FK) | trainingSessions |
| epoch | integer | NOT NULL |
| loss, valLoss | double precision | NOT NULL |

**instruments** — Asset metadata (25 instruments: 8 futures + 17 forex)
| Column | Type | Notes |
|--------|------|-------|
| id | serial (PK) | |
| symbol | text | UNIQUE, NOT NULL |
| name, assetType | text | futures / forex |
| exchange | text | CME / CBOT / etc. |
| tickSize, tickValue, pointValue | double precision | |
| contractSize | double precision | DEFAULT 1 |
| currency | text | DEFAULT 'USD' |
| marginRequirement | double precision | |
| tradingHours | text | |
| decimalPlaces | integer | DEFAULT 2 |
| pip_size | double precision | For forex precision |
| contract_months | text[] | Active contract months |

**newsArticles** + **newsSymbols** — Sentiment tracking
- newsArticles: title, summary, content, source, sentimentScore (-1 to 1), sentimentLabel, category
- newsSymbols: newsId (FK CASCADE), symbol, isPrimary

### ML Observatory (11 tables)

**mlModels** — Model registry
| Column | Type | Notes |
|--------|------|-------|
| id | serial (PK) | |
| name | text | NOT NULL |
| version | text | DEFAULT '1.0.0' |
| architecture | text | lstm / transformer / xgboost / cnn / etc. |
| category | text | supervised / unsupervised / self-supervised / semi-supervised |
| subcategory | text | classification / regression / sequence / clustering / etc. |
| hyperparameters | text (JSON) | |
| featureSetId | integer (FK) | |
| metrics | text (JSON) | Category-specific metrics |
| status | text | draft / training / active / retired |

**featureSets** — Feature configurations
- name (UNIQUE), features (JSON array), normalization (JSON), lagPeriods, technicalIndicators, symbols, timeframe, lookbackBars

**modelOutputs** — Predictions
- modelId (FK CASCADE), symbol, timestamp, prediction, predictionLabel, confidence, probabilities (JSON), features (JSON snapshot)

**modelOutputEmbeddings** — pgvector support
- outputId (FK CASCADE), embeddingDim, embedding vector(256)

**ensembleConfigs** — Multi-model ensembles
- name (UNIQUE), modelIds (JSON), weights (JSON), aggregationMethod (vote/average/weighted/stacking), confidenceThreshold, unanimityRequired

**marketRegimes** + **regimeHistory** — Market state classification
- marketRegimes: name, volatilityLevel, trendDirection, characteristics (JSON), detectionRules (JSON)
- regimeHistory: regimeId (FK), symbol, startTimestamp, endTimestamp, confidence, detectedBy

**trades** — Trade tracking
- symbol, side (long/short), entryTimestamp, exitTimestamp, entryPrice, exitPrice, quantity, pnl, pnlPct, commission, slippage, modelId (FK), ensembleId (FK), regimeId (FK), signalConfidence, status (open/closed/cancelled)

**coherenceSnapshots** — Model agreement
- timestamp, symbol, modelCorrelations (JSON), agreementMatrix (JSON), ensembleSignal, ensembleConfidence, divergenceScore

**generatedLabels** + **contrastivePairs** — Label generation
- generatedLabels: generatorType, category (classification/regression/sequence/contrastive), config (JSON), sampleCount, labelDistribution (JSON), parquetPath, status
- contrastivePairs: labelSetId (FK CASCADE), anchorIdx, positiveIdx, negativeIdx, pairType, similarity

### TimescaleDB Hypertable

**ohlcv_1s** — High-performance time-series (via `setup_hypertable.sql`)
```sql
ts TIMESTAMPTZ, symbol TEXT, base_symbol TEXT,
open DOUBLE PRECISION, high DOUBLE PRECISION,
low DOUBLE PRECISION, close DOUBLE PRECISION, volume BIGINT
```
- Partitioned by `ts` (range)
- Auto-compress chunks > 90 days
- Materialized view: `daily_contract_volume` for rollover detection

## DuckDB Tables (market.duckdb — 782M+ OHLCV rows)

**ohlcv** — Primary OHLCV storage (782M rows, 1s bars)
```sql
ts TIMESTAMP, symbol VARCHAR, open DOUBLE, high DOUBLE,
low DOUBLE, close DOUBLE, volume DOUBLE
```

**rollovers** — Futures contract rollover schedule (353 events across 8 roots)
```sql
root VARCHAR NOT NULL,           -- e.g. "ES", "NQ"
rollover_date DATE NOT NULL,     -- Date of rollover
from_contract VARCHAR NOT NULL,  -- e.g. "ESH24"
to_contract VARCHAR NOT NULL,    -- e.g. "ESM24"
from_close DOUBLE NOT NULL,      -- Outgoing contract close
to_close DOUBLE NOT NULL,        -- Incoming contract close
price_gap DOUBLE NOT NULL,       -- to_close - from_close
cumulative_adjustment DOUBLE NOT NULL  -- Panama back-adjustment
```

**trades** — Tick-level trade data (14.5M rows)
```sql
ts TIMESTAMP, symbol VARCHAR, action VARCHAR, side VARCHAR,
price DOUBLE, size DOUBLE, flags UINTEGER, sequence UBIGINT,
ts_recv TIMESTAMP
```

**mbp10** — Market-by-price 10-level book (408.8M rows)
```sql
ts TIMESTAMP, symbol VARCHAR, action VARCHAR, side VARCHAR,
price DOUBLE, size DOUBLE, flags UINTEGER, sequence UBIGINT,
ts_recv TIMESTAMP, bid_px_00..bid_px_09 DOUBLE,
ask_px_00..ask_px_09 DOUBLE, bid_sz_00..bid_sz_09 DOUBLE,
ask_sz_00..ask_sz_09 DOUBLE, bid_ct_00..bid_ct_09 UINTEGER,
ask_ct_00..ask_ct_09 UINTEGER
```

**ingested_files** — Tracks which source files have been processed
```sql
filepath VARCHAR PRIMARY KEY, row_count INTEGER,
ingested_at TIMESTAMP DEFAULT current_timestamp
```

## Pre-computed Indicator Parquets (data/indicators/)

Per-symbol, per-timeframe parquet files with ~350 columns each:
- Pattern: `{symbol}_{timeframe}.parquet` (e.g. `ES_1d.parquet`, `EURUSD_5m.parquet`)
- 25 symbols × 8 timeframes = 200 files
- Computed by: `python scripts/compute-indicators.py`
- ~344 indicator columns across 9 categories:
  - **Candle** (62): CDL_DOJI, CDL_HAMMER, CDL_ENGULFING, etc.
  - **Overlap** (36): SMA, EMA, WMA, DEMA, TEMA, HMA, ICHIMOKU, SUPERTREND, etc.
  - **Momentum** (43): RSI, MACD, STOCH, STOCHRSI, CCI, WILLR, MOM, ROC, etc.
  - **Volatility** (28): BBANDS, ATR, NATR, KC, DONCHIAN, etc.
  - **Volume** (17): OBV, AD, ADOSC, CMF, MFI, KVO, etc.
  - **Trend** (23): ADX, AROON, CHOP, PSAR, VORTEX, etc.
  - **Statistics** (12): ENTROPY, KURTOSIS, SKEW, STDEV, ZSCORE, etc.
  - **Cycle** (4): EBSW, etc.
  - **Performance** (3): LOG_RETURN, PERCENT_RETURN, etc.

## Continuous Contract Data Flow

```
DuckDB rollovers table (353 events, 8 roots)
    ↓
CTE: schedule (active contract windows + Panama adjustment)
    ↓
CTE: stitched (OHLCV joined to schedule, prices adjusted)
    ↓
time_bucket() aggregation (1m, 5m, 15m, 30m, 1H, 4H, 1D, 1W)
    ↓
API response / Indicator computation
```

**Panama back-adjustment**: Additive cumulative adjustment computed backward from most recent contract. Volume-based daily rollover detection (when next contract's daily volume exceeds current).

## Database Selection Rules

| Use Case | Database | Why |
|----------|----------|-----|
| User auth, sessions | PostgreSQL | Relational, Passport.js |
| Model metadata, CRUD | PostgreSQL | Drizzle ORM, relationships |
| Trade logs, P&L | PostgreSQL | Transactional integrity |
| Label generation jobs | PostgreSQL | Status tracking, foreign keys |
| Ensemble configs | PostgreSQL | JSON + relational hybrid |
| Primary OHLCV storage | DuckDB | 782M rows, columnar, fast aggregation |
| Continuous contracts | DuckDB | Rollover schedule + Panama adjustment |
| Pre-computed indicators | DuckDB | read_parquet() on indicator files |
| Tick trades + book data | DuckDB | 14.5M trades, 408.8M MBP-10 |
| QuestDB chart rendering | QuestDB | 759.5M rows, bulk CSV sync |
| Time-range OHLCV queries | QuestDB | Columnar, time-partitioned |
| Historical OHLCV archive | TimescaleDB | Compression, hypertable |
| Parquet file analytics | DuckDB | In-process, zero-copy |
| Feature engineering SQL | DuckDB | Window functions on Parquet |
| Indicator batch calc | DuckDB | SQL generation engine |

## Fallback Routing (OHLCV Queries)

```
Request → DuckDB (primary: 782M rows, continuous contracts)
  ↓ (if chart rendering)
QuestDB (759.5M rows, bulk CSV sync)
  ↓ (if unavailable)
TimescaleDB hypertable (ohlcv_1s)
  ↓ (if unavailable)
Legacy ohlcv_data table (Drizzle)
```

## Frontend Page Structure

| Route | Page | Skeleton | Description |
|-------|------|----------|-------------|
| `/` | DataSets | ChartSkeleton | Data import, OHLCV charts, file management |
| `/ml-hub` | MLHub | MLHubSkeleton | Model registry, training, predictions |
| `/portfolio` | Portfolio | DataGridSkeleton | Portfolio tracking (stub) |
| `/watchlist` | Watchlist | DataGridSkeleton | Instrument watchlist |
| `/news` | News | DataGridSkeleton | Financial news + sentiment |
| `/databases` | Databases | DataGridSkeleton | DB health, query explorer |
| `/settings` | Settings | — | Coming soon |

All pages: lazy-loaded via `React.lazy()`, wrapped in `ErrorBoundary` + `Suspense`.

## UI Stack
- **Components:** shadcn/ui (40+ Radix primitives)
- **Styling:** Tailwind CSS v4, glass-morphism effects, gradient system
- **Charts:** Recharts (2D), Lightweight Charts (OHLC), Three.js + React Three Fiber (3D), D3 (force-directed)
- **Routing:** wouter (lightweight)
- **Data Fetching:** @tanstack/react-query (60s stale, 10min gc, 1 retry)
- **Animations:** Framer Motion
- **Icons:** Lucide React
- **Caching:** Dexie (IndexedDB) for client-side persistence
