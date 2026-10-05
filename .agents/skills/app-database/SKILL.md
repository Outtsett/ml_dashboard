---
name: app-database
description: Application database architecture
---

## Database Architecture

Two stores with distinct responsibilities. Neither is a server:

| Store | Role | Persistent? | Connection |
| ----- | ---- | ----------- | ---------- |
| **SQLite** | App metadata: users, ML models, training, instruments, model checkpoints, prediction logs | Yes | Embedded (`data/ml_dashboard.db`) |
| **Iceberg lake** (`E:\lake`) | **System of record** for every byte of market data. Apache Iceberg v2, namespace `market`, tables `bars` / `ticks` / `quotes` / `book`. `bars` is 785,766,203 rows. | Yes | Catalog: AIStor at `http://127.0.0.1:9100/_iceberg`, warehouse `lakehouse` |
| **DuckDB** | **Serving layer** over the lake — fast tail, interactive slicing, training reads. In-process, no server, no port; rebuildable from the lake at any time. | No (derived) | `from lake.serving import connect` |

`lake.serving.connect()` returns a DuckDB connection carrying `bars` plus one
view per serving table over `s3://derived/recipe=questdb_full_2026-09-09/`.

Plus file-based stores:

| Store          | Role                                | Size |
| -------------- | ----------------------------------- | ---- |
| `data/models/` | Trained model checkpoints | Var. |

### When to Use Which

- **SQLite**: All CRUD, relationships, metadata — model registry, trade logs, backtest results, instruments, uploads, labels, ensembles, training sessions, news
- **Lake, via DuckDB**: ALL time-series queries — chart rendering (pre-aggregated timeframe views), training data (Python reads in-process). Unified `ohlcv` table with `asset_class`/`root` columns for all instruments. Derived feature/indicator objects DO exist (candle-anatomy, TA indicators, MNQ pipeline) — see the feature-placement rule in the schema section.

### Store Paths (Local)