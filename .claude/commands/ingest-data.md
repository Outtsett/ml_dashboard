# Data Ingestion

Load market data into the ML Dashboard's DuckDB market database, sync to QuestDB, and compute indicators.

## Usage: /ingest-data [action]

Actions: futures, forex, trades, mbp10, sync, indicators, rollovers, status, seed

### futures
Ingest futures data from analytics.duckdb into market.duckdb:
```bash
npx tsx scripts/ingest-futures.ts
```
Source: `data/sources/analytics.duckdb` (720M+ rows, 1s bars)
Maps instrument_id → symbol via instruments table JOIN.

### forex
Ingest forex data from forex.duckdb and loose parquets into market.duckdb:
```bash
npx tsx scripts/ingest-forex.ts
```
Sources: `data/sources/forex.duckdb` (native_bars M1) + `data/sources/*.parquet`

### trades
Ingest tick-level trade data from Databento DBN files:
```bash
npx tsx scripts/ingest-trades.ts
```
Source: `data/sources/trades/*.dbn.zst` → DuckDB trades table (14.5M rows)
Uses `convert-dbn-trades.py` for DBN→parquet conversion.

### mbp10
Ingest MBP-10 order book snapshots from Databento DBN files:
```bash
npx tsx scripts/ingest-mbp10.ts
```
Source: `data/sources/mbp10/*.dbn.zst` → DuckDB mbp10 table (408.8M rows)

### sync
Sync DuckDB market data to QuestDB using bulk CSV:
```bash
npx tsx scripts/fast-questdb-sync.ts
```
Uses QuestDB `/imp` CSV endpoint (754K rows/sec). Syncs in batches.
Requires QuestDB running on port 9000.

### indicators
Compute all pandas-ta indicators for every symbol × timeframe:
```bash
python scripts/compute-indicators.py
python scripts/compute-indicators.py --symbols ES,MNQ --timeframes 1d,1h
```
- Outputs to `data/{futures|forex}/{symbol}/{timeframe}/{category}.parquet`
- 25 symbols × 8 timeframes, ~350 columns each (9 category parquets per combo)
- Futures: builds continuous contract from DuckDB (Panama adjustment)
- Forex: reads directly from ohlcv table
- **Important**: Kill dev server first — DuckDB file lock prevents read_only access
- Requires: `pip install pandas-ta duckdb pyarrow` (in .venv)

### rollovers
Compute futures contract rollovers from DuckDB volume data:
```bash
npx tsx scripts/compute-rollovers.ts
```
- Volume-based daily detection across 8 roots (ES, NQ, YM, RTY, MNQ, MES, MYM, M2K)
- Writes to DuckDB `rollovers` table + syncs to PG `contract_rollovers`
- 353 rollover events total
- Panama additive back-adjustment (cumulative price gap)

### status
Check ingestion status:
1. Query `data/market.duckdb` for row counts per symbol
2. Check `ingested_files` table for processed file history
3. Compare QuestDB row counts vs DuckDB counts
4. Check `data/{futures,forex}/` for parquet file count + size

### seed
Seed instruments table with 25 known instruments:
```bash
npx tsx scripts/seed-instruments.ts
```
8 futures (MNQ, MES, MYM, M2K, ES, NQ, YM, RTY) + 17 forex pairs with pip sizes.

## Standardized Schema
All data normalizes to: ts, symbol, open, high, low, close, volume
- Futures: Panama additive back-adjustment for rollovers (volume-based daily detection from DuckDB)
- Forex: pip precision varies (0.0001 standard, 0.01 JPY pairs)

## Data Volumes
| Table | Rows | Source |
|-------|------|--------|
| DuckDB ohlcv | 782M | futures + forex 1s bars |
| DuckDB trades | 14.5M | Databento tick data |
| DuckDB mbp10 | 408.8M | Databento order book |
| DuckDB rollovers | 353 | Volume-based detection |
| QuestDB ohlcv_1s | 759.5M | Bulk CSV sync from DuckDB |
| Indicator parquets | 200 files | pandas-ta AllStudy (~350 cols each) |

## Scripts Reference
| Script | Language | Purpose |
|--------|----------|---------|
| `ingest-futures.ts` | TypeScript | analytics.duckdb → market.duckdb |
| `ingest-forex.ts` | TypeScript | forex.duckdb + parquets → market.duckdb |
| `ingest-trades.ts` | TypeScript | DBN trade files → DuckDB trades |
| `ingest-mbp10.ts` | TypeScript | DBN book files → DuckDB mbp10 |
| `fast-questdb-sync.ts` | TypeScript | DuckDB → QuestDB bulk CSV |
| `compute-rollovers.ts` | TypeScript | DuckDB volume → rollovers table |
| `compute-indicators.py` | Python | OHLCV → parquet indicator files |
| `seed-instruments.ts` | TypeScript | Populate PG instruments table |
| `convert-dbn-trades.py` | Python | DBN→parquet conversion utility |
