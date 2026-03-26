# Data Ingestion

Upload market data into the ML Dashboard via QuestDB and compute indicators.

## Usage: /ingest-data [action]

Actions: upload, indicators, seed, status

### upload
Upload market data files via the web UI or API:
- POST `/api/upload` — supports CSV, ZST, Parquet, DBN (500MB max)
- Standardizes columns on ingestion (`ts_event` → `ts`, `instrument_id` → `symbol`)
- Ingests into QuestDB via ILP protocol (port 9009)
- SHA-256 file dedup tracked in SQLite `ingested_files` table

### indicators
Compute all pandas-ta indicators for every symbol x timeframe (output: parquet files only):

```bash
python scripts/compute-indicators.py
python scripts/compute-indicators.py --symbol ES --timeframe 1d
```
- 25 symbols x 8 timeframes, ~344 columns each (9 category parquets per combo)
- Requires: `pip install pandas-ta duckdb pyarrow` (in .venv; duckdb used by offline script only)
- Output: `data/{futures|forex}/{symbol}/{timeframe}/all.parquet`
- QuestDB indicator tables have been removed — indicators are stored as parquet files only

### seed
Seed instruments table with 25 known instruments:
```bash
npx tsx scripts/seed-instruments.ts
```
8 futures (MNQ, MES, MYM, M2K, ES, NQ, YM, RTY) + 17 forex pairs with pip sizes.

### status
Check ingestion status:
1. Query QuestDB for row counts per table (`ohlcv`, `trades`, `mbp10`)
2. Query QuestDB for distinct symbol counts
3. Check SQLite `ingested_files` table for processed file history

## Standardized Schema
All data normalizes to: `symbol`, `timestamp`, `open`, `high`, `low`, `close`, `volume`
- Forex: pip precision varies (0.0001 standard, 0.01 JPY pairs)

## Data Volumes
| Table | Rows | Description |
|-------|------|-------------|
| QuestDB ohlcv | 856M | Futures + forex 1m bars |
| QuestDB trades | 12.9M | Tick-level trade data |
| QuestDB mbp10 | 408.8M | 10-level order book |

## Scripts Reference
| Script | Language | Purpose |
|--------|----------|---------|
| `compute-indicators.py` | Python | OHLCV → indicator parquet files |
| `seed-instruments.ts` | TypeScript | Populate SQLite instruments table |
