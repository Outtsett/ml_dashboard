# Data Ingestion

Load market data into the ML Dashboard's DuckDB market database and sync to QuestDB.

## Usage: /ingest-data [action]

Actions: futures, forex, sync, status, seed

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

### sync
Sync DuckDB market data to QuestDB for chart rendering:
```bash
npx tsx scripts/sync-to-questdb.ts
```
Requires QuestDB running on port 9009 (ILP). Syncs in 50K row batches.

### status
Check ingestion status:
1. Query `data/market.duckdb` for row counts per symbol
2. Check `ingested_files` table for processed file history
3. Compare QuestDB row counts vs DuckDB counts

### seed
Seed instruments table with 24 known instruments:
```bash
npx tsx scripts/seed-instruments.ts
```
8 futures (MNQ, MES, MYM, M2K, ES, NQ, YM, RTY) + 16 forex pairs with pip sizes.

## Standardized Schema
All data normalizes to: ts, symbol, open, high, low, close, volume
- Futures: ratio back-adjustment for rollovers
- Forex: pip precision varies (0.0001 standard, 0.01 JPY pairs)
