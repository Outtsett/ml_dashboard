---
name: lake-market-data
description: Market data objects and storage
---

### Market-data objects

The serving snapshot `s3://derived/recipe=questdb_full_2026-09-09/` holds the 41 market-data objects frozen there on 2026-09-09; with Iceberg `bars` that makes 42 objects DuckDB serves. The full inventory — row counts, disk, partitioning, DDL paths — is `docs/CLAUDE-reference.md` §1. What still matters day to day:

- **Base tables:** `ohlcv` (863.3M **1-SECOND** bars, 908 symbols, 2010→2026 — use a timeframe view for 1-minute bars), `candle_anatomy` (96.7M), `mnq_indicators_norm_1m` (2.34M), `mnq_zigzag_1m` (647K), `ticks` (1.48M, five days of Feb–Mar 2026), `ohlcv_1h` (crypto only, 57 USD pairs — not the 1-hour view), `symbols` (904). `dom_l2` / `dom_summary` no longer exist.
- **Timeframe views, two deliberate tiers:** the rich `ohlcv_<tf>` family carries orderflow (`trades`, `vol_at_bid`, `vol_at_ask`, `trades_at_bid`, `trades_at_ask`) with a capped history — its 1-hour member is `ohlcv_1h_v` because `ohlcv_1h` is the crypto table; the plain `ohlcv_full_<tf>` family is full 2010→ history without orderflow. Neither is a superset of the other. `ohlcv_full_<tf>` carries ~93.5k legitimately negative calendar-spread bars (`ESU0-ESZ0`): filter `close > 0` or the `A-B` symbol pattern. The `mnq_ohlcv_<tf>` family is MNQ off `candle_anatomy`.
- **Feature objects:** `candle_anatomy_1m` (per-bar body / wick / range), `ta_indicators_1m` (RSI / MACD / BB / ATR / OBV / EMA / SMA, 18,439 MNQ rows only), `candle_geometry_1m` (per-bar embedding, **relative, never absolute price**: shape ÷ range plus causal rolling z-scores, window 100). `ta_indicators_1m` and `mnq_zigzag_1m` are excluded from the chart because the chart engine draws both itself.
- **Where a derived feature belongs:** a time-bucket aggregate, or arithmetic on the bar inside the bucket, is a view over the timeframe rollup. A windowed or stateful feature (RSI, EMA, rolling z-score, `lag()`) is a batch-computed table when it is read repeatedly or feeds training — the `mnq_indicators_norm_1m` pattern — and a plain view only for rare ad-hoc reads.
- **MNQ 1m coverage** is dense 2024-03-01 → 2025-12-30, then nothing until 2026-03-02 and five thin days in March 2026 — a chart anchored to the newest bar lands in that hole.

**Storage & compression:** the lake is already zstd-compressed parquet under
Iceberg, so there is no separate compression step to configure and no
Enterprise-gated conversion path to work around. Two facts about the *data*
still hold and are worth knowing before sizing anything:

- The 863M `ohlcv` rows are **1-SECOND bars**; the pre-aggregated timeframe
  views hold the rollups. Expiring pre-2024 second-level rows is the single
  biggest reduction available, and it is lossy — the base table is the only
  copy (the feed has been dead since 2026-03-30).
- The compression floor is entropy-bound: timestamps delta-compress to ~0 and
  volumes/counts (small ints) compress well, but DOUBLE price mantissa low-bits
  are noise and incompressible. Quantizing prices to integer tick counts is the
  lever that lowers the floor (~5–10x quantized vs ~3–5x raw float).

**Data Ingestion**: Vendor data of any kind — file upload (CSV / Parquet / ZST
/ DBN), API pull, broker socket — lands write-once in `E:\lake\raw\vendor=<name>\`
with a `.sha256` sidecar via `datalake/scripts/land_raw.py`, and is promoted
from there into the Iceberg tables. A fetch that writes anywhere else has to be
done again. Dedup is tracked in SQLite `ingested_files`. The former real-time study that also wrote ticks and DOM L2
was removed with the MotiveWave integration; those tables no longer receive new
rows.

**Service / process management**: none. The lake is files plus an Iceberg
catalog; DuckDB runs inside the calling process. Nothing auto-starts, nothing
crash-loops, no JVM heap to cap, no `nssm` service to manage. The only listening
component is the AIStor catalog on `:9100`.

**Query features available through DuckDB**:
- Pre-aggregated timeframe views read directly (`lake.serving.TIMEFRAME_VIEW`);
  any other interval resampled on the fly via `lake.serving.resample_sql`
- `time_bucket(INTERVAL '5 minutes', timestamp)` for arbitrary bucketing
- `arg_min(col, timestamp)` / `arg_max(col, timestamp)` for OHLC within a bucket
  — **never `first()`/`last()`**, which are order-unspecified inside a group and
  drift between runs
- `ASOF JOIN` for trade-to-quote matching
- Vectorized, parallel scans directly over the parquet; predicate and projection
  pushdown mean an unfiltered `SELECT *` is the only slow shape

**Backup / DR**: the lake IS the durable copy. `raw/` is write-once and
sha256-verified, and Iceberg snapshots give point-in-time recovery inside the
table, so there is no export job between "the data" and "a backup of the data".
The DuckDB serving views are derived and rebuildable at zero cost. What remains
a live concern is off-drive replication: `E:\lake` sits on one NVMe, and tick /
order-book history genuinely cannot be re-bought. The D: drive is being
decommissioned entirely — nothing may be written there. Full runbook:
`docs/runbooks/questdb-backup-restore.md`.

### SQLite Schema