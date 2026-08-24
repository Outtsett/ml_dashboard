# QuestDB-Centric Architecture: Database Separation Design

**Date**: 2026-02-23
**Status**: Partially superseded — continuous contract tables (ohlcv_continuous, rollovers) and Panama back-adjustment were replaced with on-demand front-month queries. QuestDB/DuckDB/PostgreSQL separation remains valid.
**Supersedes**: 2026-02-18-data-architecture-design.md (partially)

## Problem

The current architecture has overlapping responsibilities between DuckDB and QuestDB:
- DuckDB `market.duckdb` (782M rows) stores raw OHLCV, contracts, rollovers, trades, mbp10
- QuestDB (759M rows) stores a synced copy of OHLCV for chart serving
- Continuous contract logic runs in DuckDB against parquet files
- Data is duplicated across both databases

This creates sync complexity, wasted storage, and unclear ownership boundaries.

## Decision

**QuestDB** = sole time-series engine (all price/market data)
**DuckDB** = pure analytics engine (in-memory only, no persistent file)
**PostgreSQL** = app metadata (unchanged)

## Architecture

### Database Responsibilities

| Database | Role | Persistent? | Data |
|----------|------|-------------|------|
| QuestDB | Time-series engine | Yes | OHLCV (raw + continuous), trades, mbp10, rollovers |
| DuckDB | Analytics engine | No (in-memory) | Ephemeral feature tables, indicator computations |
| PostgreSQL | App metadata | Yes | Users, instruments, ML models, training, news, ingested_files |

### QuestDB Schema

```sql
-- Raw OHLCV from individual contracts (ESH5, ESM5, EURUSD, etc.)
CREATE TABLE ohlcv (
  ts TIMESTAMP,
  symbol SYMBOL INDEX,
  open DOUBLE,
  high DOUBLE,
  low DOUBLE,
  close DOUBLE,
  volume DOUBLE
) timestamp(ts) PARTITION BY MONTH WAL;

-- Back-adjusted continuous contract series
CREATE TABLE ohlcv_continuous (
  ts TIMESTAMP,
  root SYMBOL INDEX,       -- base symbol (ES, NQ, MNQ)
  open DOUBLE,
  high DOUBLE,
  low DOUBLE,
  close DOUBLE,
  volume DOUBLE,
  raw_close DOUBLE,        -- unadjusted close for reference
  adjustment DOUBLE        -- cumulative Panama adjustment applied
) timestamp(ts) PARTITION BY MONTH WAL;

-- Contract rollover records
CREATE TABLE rollovers (
  ts TIMESTAMP,
  root SYMBOL INDEX,
  from_contract SYMBOL,
  to_contract SYMBOL,
  from_close DOUBLE,
  to_close DOUBLE,
  price_gap DOUBLE,
  rollover_type SYMBOL     -- 'volume', 'expiry'
) timestamp(ts);

-- Tick trades
CREATE TABLE trades (
  ts TIMESTAMP,
  symbol SYMBOL INDEX,
  price DOUBLE,
  size INT,
  side SYMBOL,
  action SYMBOL
) timestamp(ts) PARTITION BY DAY WAL;

-- Order book depth (10 levels)
CREATE TABLE mbp10 (
  ts TIMESTAMP,
  symbol SYMBOL INDEX,
  bid_px_00 DOUBLE, ask_px_00 DOUBLE, bid_sz_00 INT, ask_sz_00 INT,
  bid_px_01 DOUBLE, ask_px_01 DOUBLE, bid_sz_01 INT, ask_sz_01 INT,
  bid_px_02 DOUBLE, ask_px_02 DOUBLE, bid_sz_02 INT, ask_sz_02 INT,
  bid_px_03 DOUBLE, ask_px_03 DOUBLE, bid_sz_03 INT, ask_sz_03 INT,
  bid_px_04 DOUBLE, ask_px_04 DOUBLE, bid_sz_04 INT, ask_sz_04 INT,
  bid_px_05 DOUBLE, ask_px_05 DOUBLE, bid_sz_05 INT, ask_sz_05 INT,
  bid_px_06 DOUBLE, ask_px_06 DOUBLE, bid_sz_06 INT, ask_sz_06 INT,
  bid_px_07 DOUBLE, ask_px_07 DOUBLE, bid_sz_07 INT, ask_sz_07 INT,
  bid_px_08 DOUBLE, ask_px_08 DOUBLE, bid_sz_08 INT, ask_sz_08 INT,
  bid_px_09 DOUBLE, ask_px_09 DOUBLE, bid_sz_09 INT, ask_sz_09 INT
) timestamp(ts) PARTITION BY DAY WAL;
```

### Ingestion Pipeline

```
Databento/OANDA files (Parquet, CSV)
    |
    v
Node.js Ingestion Service (in-memory transforms)
    |-- Read file headers, detect schema
    |-- Map columns (ts_event -> ts, instrument_id -> symbol)
    |-- Normalize prices (Databento / 1e9)
    |-- Check PostgreSQL ingested_files for dedup
    |
    v
QuestDB ILP (port 9009) -- bulk insert
    |
    v
PostgreSQL -- record in ingested_files
    |
    v
Continuous Contract Service -- recompute if futures data
```

No DuckDB involvement in ingestion. Schema detection and normalization happen in TypeScript (Node.js) memory.

### Continuous Contract Service

Lives as a Node.js service (`server/services/continuousContract.ts`):

1. **Rollover detection**: Query QuestDB for daily volumes per contract root.
   When volume leadership changes between contract months, record a rollover.

2. **Panama back-adjustment**: Walk rollovers newest-to-oldest, accumulate price gaps.
   Each bar before a rollover gets cumulative adjustment added to OHLCV prices.

3. **Write continuous series**: Insert adjusted bars into `ohlcv_continuous` via ILP.
   Only volume-leader contract's bars for each day. `raw_close` preserved.

4. **Incremental updates**: On new ingestion of futures data:
   - Check if rollover occurred
   - If yes: recompute from rollover point forward
   - If no: append new bars with current adjustment factor

### Charts API

```
GET /api/charts/ohlcv?symbol=ES&timeframe=5m

If symbol is a futures root (ES, NQ, MNQ):
  -> Query ohlcv_continuous WHERE root = 'ES' SAMPLE BY 5m

If symbol is a specific contract (ESH5) or non-futures (EURUSD):
  -> Query ohlcv WHERE symbol = 'ESH5' SAMPLE BY 5m
```

### DuckDB Analytics

```typescript
// server/duckdb/analytics.ts -- replaces core.ts + market.ts
const db = new DuckDB.Database(':memory:');

// Attach QuestDB as remote postgres source
conn.run(`
  INSTALL postgres_scanner; LOAD postgres_scanner;
  ATTACH 'host=localhost port=8812 user=admin password=quest dbname=qdb'
  AS questdb (TYPE postgres, READ_ONLY)
`);

// Feature engineering queries pull from QuestDB on demand
// Results computed in DuckDB memory, exported to Parquet for ML
```

DuckDB stores nothing persistently. It is a compute engine that:
- Reads source data from QuestDB via `postgres_scanner` (PG wire port 8812)
- Computes features, indicators, ML datasets in memory
- Exports results to Parquet files for the ML pipeline
- Discards all state on restart

## What Changes

### Files to Delete
- `server/duckdb/market.ts` -- persistent market DB (replaced by QuestDB)
- `server/duckdb/preAggregation.ts` -- DuckDB continuous contracts (replaced by service)
- `server/lib/questdbSync.ts` -- DuckDB->QuestDB sync (no longer needed)
- `data/market.duckdb` -- persistent file (data migrates to QuestDB)

### Files to Refactor
- `server/duckdb/core.ts` -> `server/duckdb/analytics.ts` -- add postgres_scanner, remove OHLCV
- `server/lib/ingestion/` -- write to QuestDB ILP instead of DuckDB
- `server/routes/charts.ts` -- query ohlcv_continuous for futures roots
- `shared/schema.ts` -- add `ingested_files` table to PostgreSQL schema

### Files to Create
- `server/services/continuousContract.ts` -- rollover detection + back-adjustment
- `server/services/ingestionService.ts` -- direct-to-QuestDB ingestion

### Data to Migrate
- DuckDB `ohlcv` (782M rows) -> already in QuestDB, verify completeness
- DuckDB `contracts` -> QuestDB `ohlcv` (should already be there as raw bars)
- DuckDB `rollovers` -> QuestDB `rollovers` table
- DuckDB `trades` (14.5M) -> QuestDB `trades`
- DuckDB `mbp10` -> QuestDB `mbp10`
- DuckDB `ingested_files` -> PostgreSQL `ingested_files`

## Performance Considerations

- QuestDB `SAMPLE BY` provides instant timeframe aggregation (no GROUP BY needed)
- QuestDB supports concurrent reads (unlike DuckDB single-connection mutex)
- DuckDB `postgres_scanner` adds ~1-5ms latency per query vs local data
- For large analytics jobs, DuckDB can `COPY` QuestDB results to local temp tables first
- QuestDB ILP ingestion: 1-4M rows/sec (faster than DuckDB file-backed inserts)

## Ports Reference

| Service | Port | Protocol |
|---------|------|----------|
| QuestDB HTTP | 9000 | REST API |
| QuestDB ILP | 9009 | Line Protocol (ingestion) |
| QuestDB PG Wire | 8812 | PostgreSQL protocol (DuckDB reads) |
| PostgreSQL | 5432 | Standard |
| Express API | 5000 | HTTP |
