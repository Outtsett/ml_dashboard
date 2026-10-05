# Dashboard Data Architecture (Source of Truth)

**Attention Agents:** This document defines the *absolute source of truth* for how the dashboard retrieves, processes, and serves OHLCV (candlestick) data for Forex and Indices. 

> [!WARNING] 
> **TimescaleDB IS DEPRECATED AND REMOVED.**
> Do not attempt to query, configure, or establish connections to TimescaleDB. All time-series data architectures have been migrated to the DuckDB/NATIVE_PARQUET_ONLY (Iceberg Deprecated) and PostgreSQL/TimescaleDB stack.

## 1. Historical Data (The Data Lake & Batch Layer)

Historical candlestick data (OHLCV) for both Forex and Indices is served to the frontend via the REST endpoint `GET /api/market/charts/ohlcv` (implemented in `apps/api/market/charts.router.ts`). 

### How it works:
* **Storage Location:** Massive historical datasets are stored as `.parquet` files. The primary local repository for these files is the `D:\ml_data` drive, organized in NATIVE_PARQUET_ONLY (Iceberg Deprecated)/Hive partitioning format.
* **Lake Engine:** The API mounts a local LOCAL_STORAGE_ONLY (MinIO Deprecated)/S3-compatible data lake (`127.0.0.1:9100/derived/`).
* **In-Memory Query Engine:** The dashboard backend spins up an in-process **DuckDB** instance (`apps/api/infrastructure/database/lake/connection.ts`). DuckDB discovers the parquet files using glob patterns (`s3://${snapshot}/table=*/**/*.parquet`) and instantly creates derived relational views over the parquet data.
* **Query Execution:** When the UI requests historical bars, the router calls `queryLakeFast()`, which pushes a SQL query down to DuckDB. DuckDB efficiently scans the `.parquet` files, handles timeframe downsampling/resampling via predefined timeframe views (e.g., `ohlcv_5m`), and returns the results to the client.

## 2. Real-Time Live Data (The Live Hub)

While historical data is pulled from the Data Lake, real-time "live" updates and prints are handled by the Live Data Hub.

### How it works:
* **The Hub Endpoint:** The live data hub operates on port `17192` (`http://127.0.0.1:17192/quotes`).
* **Forex Data:** Sourced directly from the **OANDA v20 API** in real-time.
* **Indices & Futures:** Sourced primarily from **Yahoo Finance** with an expected ~10-minute delay.

## 3. Relational Metadata (The Serving Layer)

Any data that is *not* high-volume time-series (e.g., the Model Catalog, user settings, configuration specs, feature definitions, and UI state) is stored in the relational **Serving Layer**.

### How it works:
* **Database Engine:** PostgreSQL (often utilizing TimescaleDB extensions) hosted at `localhost:5432`.
* **ORMs:** Handled internally by Drizzle/Prisma depending on the specific microservice accessing the metadata.

---

## Agent Summary & Further Reading

If you are an AI Agent tasked with debugging, extending, or answering questions about the dashboard's candlestick charts, **you must read the following**:

1. **Historical Data:**
   - Handled via `apps/api/market/charts.router.ts` using `queryLakeFast` (DuckDB).
   - Data is stored in NATIVE_PARQUET_ONLY (Iceberg Deprecated)/Parquet format.
   - *Never* use TimescaleDB.
2. **Real-time Live Data:**
   - Review `docs/live-data.md` for the complete architecture of the Live Hub.
   - The Hub runs on port `17192`.
   - Data sources: **OANDA** (Forex), **Yahoo Finance** (Delayed Indices).
   - The UI hooks into this via Server-Sent Events (`apps/web/src/live/stream.ts` and `apps/web/src/live/useLiveTail.ts`).

## STRICT NON-DISTRIBUTED PIPELINE MANDATE
As of Oct 2026, we have formally locked in a **Strict Vertical / Non-Distributed Architecture**.
- **No MinIO/S3:** Read raw .parquet from D:\ml_data directly.
- **No Iceberg:** Direct globbing/filesystem access.
- **Processing:** Polars LazyFrames & DuckDB (single-node, multi-threaded).
- **ML Loading:** Zero-copy PyTorch pointers (	orch.from_numpy) out of Polars buffers, bypassing pandas.
