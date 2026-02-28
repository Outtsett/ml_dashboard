# Architecture Reference Skill

Complete schema, database rules, API map, and frontend structure for the ML Dashboard.

## Instructions

Use this as a reference when answering architecture questions, making schema changes, or understanding data flow. When the user asks about tables, routes, or components, consult the relevant section below.

## Database Architecture (2 databases)

| Database | Role | Connection |
|----------|------|------------|
| **SQLite** | App metadata: users, ML models, training, instruments | Embedded (`data/ml_dashboard.db`, WAL mode) |
| **QuestDB 9.3.1** | ALL time-series data: OHLCV, trades, MBP-10, indicators, model outputs | HTTP `:9000`, ILP `:9009`, PG wire `:8812` |

## SQLite Tables (22 in `shared/schema.ts`)

### Core Trading Data (5 tables)

**users** — Authentication
| Column | Type | Notes |
|--------|------|-------|
| id | varchar (PK) | gen_random_uuid |
| username | text | UNIQUE, NOT NULL |
| password | text | NOT NULL |

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
- generatedLabels: generatorType, category (classification/regression/sequence/contrastive), config (JSON), sampleCount, labelDistribution (JSON), status
- contrastivePairs: labelSetId (FK CASCADE), anchorIdx, positiveIdx, negativeIdx, pairType, similarity

## QuestDB Tables (time series)

**ohlcv** — 759.5M rows, PARTITION BY DAY
```sql
symbol SYMBOL INDEX, timestamp TIMESTAMP, open DOUBLE, high DOUBLE,
low DOUBLE, close DOUBLE, volume DOUBLE
```

**trades** — 12.9M rows, PARTITION BY DAY
```sql
symbol SYMBOL INDEX, ts_event TIMESTAMP, rtype, publisher_id, instrument_id,
action, side, depth, price, size, flags, ts_in_delta, sequence, ts_recv
```

**mbp10** — 408.8M rows, PARTITION BY DAY
```sql
symbol SYMBOL INDEX, ts_event TIMESTAMP, ts_recv,
bid_px_00..bid_px_09, ask_px_00..ask_px_09,
bid_sz_00..bid_sz_09, ask_sz_00..ask_sz_09,
bid_ct_00..bid_ct_09, ask_ct_00..ask_ct_09
```

**indicators_{tf}** — 7 tables (5m, 15m, 30m, 1h, 4h, 1d, 1w)
```sql
timestamp TIMESTAMP, symbol SYMBOL INDEX, [344 indicator columns]
```

**model_regimes** — PARTITION BY YEAR, WAL, DEDUP UPSERT KEYS(model_id, ts)
```sql
model_id SYMBOL INDEX, symbol SYMBOL INDEX, ts TIMESTAMP,
close DOUBLE, regime INT, regime_label VARCHAR, split VARCHAR
```

**model_shap** — PARTITION BY YEAR, WAL, DEDUP UPSERT KEYS(model_id, ts)
```sql
model_id SYMBOL INDEX, symbol SYMBOL INDEX, ts TIMESTAMP,
regime INT, [29 shap_* columns]
```

**Materialized Views** (auto-refresh on insert):
`ohlcv_5m`, `ohlcv_15m`, `ohlcv_30m`, `ohlcv_1h`, `ohlcv_4h`, `ohlcv_1d`, `ohlcv_1w`

## Pre-computed Indicators (QuestDB `indicators_{tf}` tables)

~344 indicator columns across 9 categories:
- **Candle** (62): CDL_DOJI, CDL_HAMMER, CDL_ENGULFING, etc.
- **Overlap** (36): SMA, EMA, WMA, DEMA, TEMA, HMA, ICHIMOKU, SUPERTREND, etc.
- **Momentum** (43): RSI, MACD, STOCH, STOCHRSI, CCI, WILLR, MOM, ROC, etc.
- **Volatility** (28): BBANDS, ATR, NATR, KC, DONCHIAN, etc.
- **Volume** (17): OBV, AD, ADOSC, CMF, MFI, KVO, etc.
- **Trend** (23): ADX, AROON, CHOP, PSAR, VORTEX, etc.
- **Statistics** (12): ENTROPY, KURTOSIS, SKEW, STDEV, ZSCORE, etc.
- **Cycle** (4): EBSW, etc.
- **Performance** (3): LOG_RETURN, PERCENT_RETURN, etc.

Computed by `scripts/compute-indicators.py`, uploaded by `scripts/upload-indicators-questdb.py`.

## Database Selection Rules

| Use Case | Database | Why |
|----------|----------|-----|
| User auth, sessions | SQLite | Relational, Drizzle ORM |
| Model metadata, CRUD | SQLite | Drizzle ORM, relationships |
| Trade logs, P&L | SQLite | Transactional integrity |
| Label generation jobs | SQLite | Status tracking, foreign keys |
| Ensemble configs | SQLite | JSON + relational hybrid |
| OHLCV chart rendering | QuestDB | SAMPLE BY, materialized views |
| Training data source | QuestDB | Python reads via PG wire |
| Pre-computed indicators | QuestDB | `indicators_{tf}` tables |
| Tick trades + book data | QuestDB | Time-partitioned columnar |
| Model outputs | QuestDB | `model_regimes`, `model_shap` |

## Data Flow

```
QuestDB OHLCV (source of truth, 759.5M rows)
    |
    +--> Chart API (SAMPLE BY, materialized views)
    |
    +--> Python training (PG wire :8812)
    |        |-- features.py: 29 inline features from config
    |        |-- HDP-HMM → model_regimes + model_shap
    |
    +--> Indicator pipeline (offline)
         |-- compute-indicators.py → parquet
         |-- upload-indicators-questdb.py → indicators_{tf}
```

## Frontend Page Structure

| Route | Page | Description |
|-------|------|-------------|
| `/` | DataSets | Data import, OHLCV charts, file management |
| `/ml-hub` | MLHub | Model registry, training, predictions |
| `/portfolio` | Portfolio | Portfolio tracking |
| `/watchlist` | Watchlist | Instrument watchlist |
| `/news` | News | Financial news + sentiment |
| `/databases` | Databases | DB health, query explorer |
| `/training` | Training | Model training dashboard |

All pages: lazy-loaded via `React.lazy()`, wrapped in `ErrorBoundary` + `Suspense`.

## UI Stack
- **Components:** shadcn/ui (40+ Radix primitives)
- **Styling:** Tailwind CSS v4, glass-morphism effects, gradient system
- **Charts:** Recharts (2D), Lightweight Charts (OHLC), Three.js + React Three Fiber (3D), D3 (force-directed)
- **Routing:** wouter (lightweight)
- **Data Fetching:** @tanstack/react-query (60s stale, 10min gc, 1 retry)
- **Animations:** Framer Motion
- **Icons:** Lucide React
