# Scripts — Utility Scripts

76 utility scripts for data ingestion, feature research, model visualization, database maintenance, and seeding. Mix of Python, TypeScript, and JavaScript.

## Categories

### Data Ingestion
| Script | Language | Description |
|---|---|---|
New data lands in `E:\lake\raw\vendor=<name>\` write-once with a `.sha256`
sidecar (`datalake/scripts/land_raw.py`) and is promoted into the Iceberg
tables from there. A fetch that writes anywhere else has to be done again.

| Script | Language | Description |
|---|---|---|
| `ingest_dbn.py` | Python | Databento DBN format ingestion |
| `ingest_forex.py` | Python | Forex data ingestion (Python path) |
| `convert-dbn-trades.py` | Python | Convert DBN trade files |

### ML Research & Visualization
| Script | Language | Description |
|---|---|---|
| `feature-research.py` | Python | Feature engineering pipeline: extract, correlate, importance test |
| `visualize-regimes.py` | Python | DEPRECATED -- HMM model code removed (2026-04-03) |
| `training_monitor.py` | Python | Live Plotly Dash training monitor (tails convergence.json) |
| `prediction_viewer.py` | Python | OOS prediction overlay viewer (deprecated, moving to dashboard) |
| `dash_training_viewer.py` | Python | Plotly Dash training results viewer |
| `train-live.py` | Python | Live training launcher |
| `pretrained-forecast.py` | Python | Run pretrained model forecasts |
| `test_primitives.py` | Python | Primitives discovery model test |

### Database Maintenance

The lake needs none of the maintenance a server did: no process to start, no
schema to migrate, no tables to drop. SQLite schema changes go through
`npm run db:push`.

### Retired — do not run

These still sit in this directory but their target store no longer exists.
Every one of them starts, feeds, migrates or reads a database that holds zero
tables; running one connects to a dead endpoint. They are queued for deletion.

| Script | Language | Was |
|---|---|---|
| `ingest-futures.ts` | TypeScript | Futures OHLCV ingestion over ILP |
| `ingest-forex.ts` | TypeScript | Forex ingestion over ILP |
| `ingest-oanda.ts` | TypeScript | OANDA API forex streaming over ILP |
| `ingest-trades.ts` | TypeScript | Trade-level ingestion over ILP |
| `ingest-mbp10.ts` | TypeScript | MBP-10 order book ingestion over ILP |
| `upload-trades-questdb.py` | Python | Bulk trade upload over HTTP `/imp` |
| `dump-questdb-parquet.py` | Python | Export to parquet (superseded — the lake IS parquet) |
| `cleanup_questdb.py` | Python | Drop non-OHLCV tables |
| `migrate-questdb-schema.py` | Python | Schema migration |
| `backup-questdb.py` | Python | Backup (superseded — see the retirement note in `docs/runbooks/`) |
| `start-questdb.js` | JavaScript | Start the database process |
| `start-questdb.sh` | Bash | Start the database process (Unix) |

### Seeding & Setup
| Script | Language | Description |
|---|---|---|
| `seed-instruments.ts` | TypeScript | Upsert 24 instruments: the 8 futures roots the lake carries, read from `src/config/contract_specifications.json` through `src/shared/instruments.ts`, plus 16 forex pairs |
| `build_contract_specifications.py` | Python | Build `src/config/contract_specifications.json` (42 stock-index futures: tick, exchange, contract size, months) from AMP Futures' contract-specifications page; `--html <saved page>` parses a copy, `--check` exits 1 if the file would change |
| `seed-models.ts` | TypeScript | Seed ML model definitions |
| `seed-broker-configs.cjs` | JavaScript | Seed broker configuration |
| `setup_hypertable.sql` | SQL | TimescaleDB hypertable setup (legacy) |
| `setup_forex_hypertable.sql` | SQL | Forex hypertable setup (legacy) |

### ORB Analysis Suite
20+ scripts for Opening Range Breakout analysis:
`orb_backtest.py`, `orb_optimize.py`, `orb_greedy.py`, `orb_param_sweep.py`, `orb_filter_validation.py`, `orb_indicator_analysis.py`, `orb_corr_by_side.py`, `orb_ranges_by_side.py`, `orb_complete_report.py`, etc.

### Data Inspection
| Script | Language | Description |
|---|---|---|
| `inspect-sources.ts` | TypeScript | Inspect source data files |
| `check_mnq_data.py` | Python | Verify MNQ data quality |
| `check_cols.py` | Python | Check lake table column schemas |
| `count_trading_days.py` | Python | Count trading days in dataset |
| `data_reader.py` | Python | Generic data file reader |

## Running Scripts

```bash
# TypeScript scripts
npx tsx scripts/seed-instruments.ts

# Python scripts (use project venv)
python scripts/feature-research.py --symbol MNQ --timeframe 1m --source parquet
python scripts/visualize-regimes.py --model latest
python scripts/training_monitor.py --port 8050
```
