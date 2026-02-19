# Data Architecture Redesign — Design Document

**Date:** 2026-02-18
**Status:** Approved
**Scope:** Reorganize ~825M+ rows of scattered market data into a clean 3-database architecture

---

## Problem

Market data is scattered across multiple locations with inconsistent schemas:
- `analytics.duckdb` — VIEW over external Parquet (720M rows futures 1s OHLCV, prices scaled by 1B, column `ts_event`)
- `forex.duckdb` — 103M rows forex data (15 pairs, 6yr M1)
- 15 loose Parquet files in `ai-dashboard/data/forex/`
- `ohlcv-1s.parquet` (5.7GB) referenced by the analytics view
- Column names vary: `ts_event` vs `ts` vs `timestamp`, prices sometimes divided by 1B
- No instrument metadata (pip sizes, tick sizes, decimal places)
- No futures rollover handling
- No clear separation of concerns between storage, computation, and serving

All source data has been consolidated to `E:\source\repos\ml_dashboard\data\sources\` (~12GB).

---

## Architecture

### 3-Database Split

| Database | Role | Startup |
|----------|------|---------|
| **DuckDB** | Market data storage + indicator calculation engine | Embedded (no process) |
| **QuestDB** | Chart rendering + live data serving | Electron child process (`-f` foreground, no admin needed) |
| **PostgreSQL** | App/ML layer (Drizzle ORM) | Electron child process via `pg_ctl` |

### Why This Split

- **DuckDB** — Parquet-native reads, SQL window functions for indicators, embedded (zero ops), handles bulk analytics. Source of truth for all market data.
- **QuestDB** — `SAMPLE BY` aggregates any timeframe on the fly (1s→1m→5m→1h→1d from a single query), REST API returns JSON for direct frontend consumption, optimized for time-range scans. Serving cache for charts.
- **PostgreSQL** — Drizzle ORM manages 21 existing tables (ML models, trades, labels, training sessions, uploads, etc.). Stays unchanged.

### Data Flow

```
Disk (Parquet/CSV/ZST)
    │
    ▼
DuckDB (ingest, clean, standardize, calculate indicators)
    │
    ├──► QuestDB (sync cleaned OHLCV + indicators via ILP on port 9009)
    │        │
    │        ▼
    │    Frontend (charts query QuestDB REST API, SAMPLE BY for timeframes)
    │
    └──► DuckDB views (materialized indicator series, continuous adjusted futures)

PostgreSQL (independent — app state, ML models, training, labels via Drizzle)
```

---

## Unified Column Schema

Both DuckDB and QuestDB use identical column names:

```sql
ts       TIMESTAMP    -- UTC, microsecond precision
symbol   VARCHAR      -- instrument identifier (e.g., 'MNQ', 'EURUSD')
open     DOUBLE       -- actual price, no scaling
high     DOUBLE
low      DOUBLE
close    DOUBLE
volume   BIGINT
```

### Standardization Rules

| Source Issue | Fix |
|-------------|-----|
| `ts_event` (nanoseconds since epoch) | Convert: `to_timestamp(ts_event / 1000000000)` → `ts` |
| Prices scaled by 1B | Divide: `open / 1000000000.0` → `open` |
| Mixed column names (`timestamp`, `ts`, `time`) | Rename to `ts` |
| Instrument ID as integer | Map to symbol string via lookup |

---

## Instruments Table (PostgreSQL via Drizzle)

Reference/config data for all tradeable instruments:

```
instruments
├── symbol          TEXT PK        -- 'MNQ', 'EURUSD', 'USDJPY'
├── asset_class     TEXT           -- 'futures', 'forex'
├── exchange        TEXT           -- 'CME', 'OANDA'
├── tick_size       NUMERIC        -- 0.25 (MNQ), 0.00001 (EURUSD), 0.001 (USDJPY)
├── pip_size        NUMERIC NULL   -- NULL (futures), 0.0001 (EURUSD), 0.01 (USDJPY)
├── point_value     NUMERIC        -- 2.0 (MNQ), 100000 (forex standard lot)
├── decimal_places  INT            -- 2 (MNQ), 5 (EURUSD), 3 (USDJPY)
├── contract_months TEXT[] NULL    -- ['H','M','U','Z'] (futures), NULL (forex)
├── created_at      TIMESTAMP
└── updated_at      TIMESTAMP
```

DuckDB and QuestDB store only `symbol`. Joins against this table when precision metadata is needed.

---

## Futures Rollover

### Strategy: Volume-Based Trigger + Ratio Back-Adjustment

**Detection:** Switch from front-month to back-month when back-month daily volume exceeds front-month daily volume.

**Adjustment:** Ratio method — multiply all historical prices by `(new_contract_close / old_contract_close)` at each rollover point. Preserves percentage relationships, never creates negative values.

### Storage

**Raw per-contract data (immutable truth):**
```sql
-- DuckDB table
CREATE TABLE contracts (
    ts          TIMESTAMP,
    symbol      VARCHAR,      -- 'MNQH26', 'MNQM26' (with month/year)
    root        VARCHAR,      -- 'MNQ'
    expiry      DATE,
    open        DOUBLE,
    high        DOUBLE,
    low         DOUBLE,
    close       DOUBLE,
    volume      BIGINT
);
```

**Rollover events:**
```sql
-- DuckDB table
CREATE TABLE rollovers (
    ts              TIMESTAMP,    -- rollover date
    root            VARCHAR,      -- 'MNQ'
    from_contract   VARCHAR,      -- 'MNQH26'
    to_contract     VARCHAR,      -- 'MNQM26'
    from_close      DOUBLE,
    to_close        DOUBLE,
    ratio           DOUBLE        -- to_close / from_close
);
```

**Continuous adjusted series (DuckDB view):**

Built by applying cumulative ratio product to raw contract prices. The view joins `contracts` with `rollovers` and multiplies each bar's prices by the cumulative adjustment factor from all subsequent rollovers.

---

## DuckDB Schema

### Tables

```sql
-- Cleaned, standardized OHLCV (all instruments, all timeframes at base resolution)
CREATE TABLE ohlcv (
    ts          TIMESTAMP NOT NULL,
    symbol      VARCHAR NOT NULL,
    open        DOUBLE,
    high        DOUBLE,
    low         DOUBLE,
    close       DOUBLE,
    volume      BIGINT
);

-- Raw per-contract futures data (immutable)
CREATE TABLE contracts (
    ts          TIMESTAMP NOT NULL,
    symbol      VARCHAR NOT NULL,    -- contract symbol with expiry code
    root        VARCHAR NOT NULL,    -- root symbol
    expiry      DATE,
    open        DOUBLE,
    high        DOUBLE,
    low         DOUBLE,
    close       DOUBLE,
    volume      BIGINT
);

-- Rollover events
CREATE TABLE rollovers (
    ts              TIMESTAMP NOT NULL,
    root            VARCHAR NOT NULL,
    from_contract   VARCHAR NOT NULL,
    to_contract     VARCHAR NOT NULL,
    from_close      DOUBLE NOT NULL,
    to_close        DOUBLE NOT NULL,
    ratio           DOUBLE NOT NULL
);

-- Ingestion tracking (file-level dedup)
CREATE TABLE ingested_files (
    file_path       VARCHAR PRIMARY KEY,
    file_hash       VARCHAR,           -- SHA-256
    file_size       BIGINT,
    row_count       BIGINT,
    symbol          VARCHAR,
    ts_min          TIMESTAMP,
    ts_max          TIMESTAMP,
    ingested_at     TIMESTAMP DEFAULT current_timestamp
);
```

### Views

```sql
-- Continuous adjusted futures (ratio back-adjustment)
CREATE VIEW continuous AS
    -- Joins contracts + rollovers, applies cumulative ratio product

-- Indicator calculations via SQL window functions
-- Generated dynamically by server/lib/indicators/sqlGenerator.ts
```

### Indicator Engine

DuckDB handles indicator calculations via SQL window functions generated by `sqlGenerator.ts`:
- SMA, EMA, RSI, MACD, Bollinger Bands, ATR, Stochastic, etc.
- 36+ indicators with SQL implementations
- Presets: momentum, volatility, trend, full
- Note: MACD SQL uses SMA approximation; TypeScript math library provides true EMA for real-time

---

## QuestDB Schema

QuestDB receives synced data from DuckDB for chart serving:

```sql
-- Main chart-serving table (designated timestamp on ts)
CREATE TABLE ohlcv (
    ts          TIMESTAMP,
    symbol      SYMBOL,        -- QuestDB indexed symbol type
    open        DOUBLE,
    high        DOUBLE,
    low         DOUBLE,
    close       DOUBLE,
    volume      LONG
) timestamp(ts) PARTITION BY MONTH;
```

### Chart Query Examples

```sql
-- 5-minute candles for MNQ, last 24 hours
SELECT ts, first(open) open, max(high) high, min(low) low, last(close) close, sum(volume) volume
FROM ohlcv
WHERE symbol = 'MNQ' AND ts > dateadd('d', -1, now())
SAMPLE BY 5m;

-- 1-hour candles for EURUSD, last week
SELECT ts, first(open) open, max(high) high, min(low) low, last(close) close, sum(volume) volume
FROM ohlcv
WHERE symbol = 'EURUSD' AND ts > dateadd('w', -1, now())
SAMPLE BY 1h;
```

No pre-materialized timeframe tables needed — `SAMPLE BY` aggregates on the fly.

### Sync: DuckDB → QuestDB

Bulk load via ILP (InfluxDB Line Protocol) on port 9009:
- ~1M rows/sec ingestion rate
- Runs as background job after DuckDB ingestion completes
- Idempotent: QuestDB deduplicates by timestamp + symbol

---

## PostgreSQL Schema (Unchanged)

21 existing Drizzle-managed tables stay as-is. New addition:

```typescript
// shared/schema.ts — add instruments table
export const instruments = pgTable('instruments', {
  symbol: text('symbol').primaryKey(),
  assetClass: text('asset_class').notNull(),       // 'futures' | 'forex'
  exchange: text('exchange').notNull(),             // 'CME' | 'OANDA'
  tickSize: numeric('tick_size').notNull(),
  pipSize: numeric('pip_size'),                     // NULL for futures
  pointValue: numeric('point_value').notNull(),
  decimalPlaces: integer('decimal_places').notNull(),
  contractMonths: text('contract_months').array(),  // NULL for forex
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});
```

---

## Electron Lifecycle Management

On app launch:
1. Start PostgreSQL via `pg_ctl start` (child process)
2. Start QuestDB via `questdb.exe start -f` (foreground child process, no admin)
3. DuckDB — nothing to start (embedded)
4. Wait for PG + QuestDB health checks to pass
5. Run gap-fill check (compare last timestamp vs current time, fetch missing data from Yahoo Finance / OANDA)

On app close:
1. Kill QuestDB child process
2. Stop PostgreSQL via `pg_ctl stop -m fast`
3. DuckDB — nothing to stop

Zero friction: double-click the app, everything starts. Close the app, everything stops.

---

## Ingestion Pipeline

### Phase 1: Inventory & Dedup Check
- Scan `data/sources/` for all Parquet, CSV, ZST files
- Hash each file (SHA-256)
- Check against `ingested_files` table — skip already-ingested files

### Phase 2: Futures Data (analytics.duckdb → DuckDB ohlcv)
- Read `ohlcv-1s.parquet` via DuckDB
- Apply standardization: `ts_event/1e9 → ts`, `price/1e9 → open/high/low/close`
- Map `instrument_id` integers to symbol strings
- Insert into `ohlcv` table
- Record in `ingested_files`

### Phase 3: Forex Data (forex.duckdb → DuckDB ohlcv)
- Read existing tables from forex.duckdb
- Standardize column names to unified schema
- Insert into `ohlcv` table
- Record in `ingested_files`

### Phase 4: Loose Parquet Files
- Read each forex Parquet file
- Standardize and insert into `ohlcv`
- Record in `ingested_files`

### Phase 5: DuckDB → QuestDB Sync
- Bulk export from DuckDB `ohlcv` table
- Stream to QuestDB via ILP on port 9009
- Verify row counts match

### Phase 6: Cleanup
- Verify all data accessible via QuestDB `SAMPLE BY` queries
- Verify indicator SQL runs against DuckDB `ohlcv`
- Remove source files from `data/sources/` once verified
- Update dashboard API routes to query from new schema

---

## File-Level Deduplication

No row-level dedup — trust source data integrity. Track at file level:
- Before ingesting any file, check `ingested_files` by path + hash
- If file already ingested (same hash), skip entirely
- If file path exists but hash changed, flag for manual review
- This is sufficient because our data sources (Databento, OANDA) provide clean, non-overlapping files

---

## Gap-Fill on Startup

When the app opens after being offline:
1. Query `SELECT MAX(ts) FROM ohlcv WHERE symbol = ?` for each active instrument
2. Compare against current market time
3. If gap > threshold:
   - **Forex:** Fetch missing bars from OANDA REST API (free, up to 5000 candles per request)
   - **Futures:** Fetch from Yahoo Finance API (free, daily/intraday)
4. Insert into DuckDB → sync to QuestDB
5. Dashboard renders seamlessly with no visible gaps

---

## Migration Checklist

- [ ] Add `instruments` table to Drizzle schema + push
- [ ] Create DuckDB tables (`ohlcv`, `contracts`, `rollovers`, `ingested_files`)
- [ ] Create QuestDB `ohlcv` table with designated timestamp
- [ ] Run Phase 2: Ingest futures data (standardize 720M rows)
- [ ] Run Phase 3: Ingest forex data (standardize 103M rows)
- [ ] Run Phase 4: Ingest loose Parquet files
- [ ] Run Phase 5: Sync DuckDB → QuestDB
- [ ] Seed `instruments` table with known symbols + metadata
- [ ] Build continuous adjusted futures view
- [ ] Update API routes to use new schema
- [ ] Update frontend chart components to query QuestDB
- [ ] Wire Electron lifecycle (PG + QuestDB start/stop)
- [ ] Implement gap-fill on startup
- [ ] Clean up source files after verification
- [ ] Update CLAUDE.md and skills to reflect new architecture

---

## Ports Reference

| Service | Port | Protocol | Use |
|---------|------|----------|-----|
| PostgreSQL | 5432 | PG wire | App/ML layer (Drizzle) |
| QuestDB HTTP | 9000 | REST | Chart queries from frontend |
| QuestDB PG | 8812 | PG wire | SQL queries (backup path) |
| QuestDB ILP | 9009 | Line Protocol | Bulk data sync from DuckDB |
| Express Server | 5000 | HTTP | Dashboard API |

---

## Key File Paths

| What | Where |
|------|-------|
| DuckDB market data | `E:\source\repos\ml_dashboard\data\market.duckdb` (new, unified) |
| Source data (pre-migration) | `E:\source\repos\ml_dashboard\data\sources\` |
| Drizzle schema | `E:\source\repos\ml_dashboard\shared\schema.ts` |
| Indicator SQL generator | `E:\source\repos\ml_dashboard\server\lib\indicators\sqlGenerator.ts` |
| QuestDB binary | `E:\source\databases\questdb-9.3.1-rt-windows-x86-64\bin\questdb.exe` |
| QuestDB data | `E:\source\databases\questdb-data\` |
| PostgreSQL binary | `E:\source\databases\PostgreSQL\pgsql\bin\` |
| PostgreSQL data | `E:\source\databases\PostgreSQL\pgsql\data\` |
