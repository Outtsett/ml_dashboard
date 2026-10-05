# Market Data Backup & Restore Runbook

## Current state (2026-09-10)

Backup and restore are properties of the lake, not of a separate job.

`E:\lake` is Apache Iceberg v2 (namespace `market`, tables `bars` / `ticks` /
`quotes` / `book`), catalog AIStor at `http://127.0.0.1:9100/_iceberg`,
warehouse `lakehouse`. It is the system of record. Data is already parquet on
disk with table metadata and snapshot history, so there is no export step
between "the data" and "a backup of the data" — the older nightly
per-partition export existed only to get rows *out* of a server that held them
in its own format.

DuckDB reads the lake in-process (`from lake.serving import connect`) and is a
rebuildable cache over it. Losing the serving views costs nothing; they are
regenerated from the lake.

**What still needs a second physical disk.** The irreplaceability argument has
not changed: `ticks` (~1.48M rows) and order-book data (~17.46M rows) cannot be
re-bought. No vendor sells historical CME futures order-book replay, and this
machine holds no such credential regardless. The lake living on one drive is
not a backup of itself. Off-drive replication of `E:\lake` is the live concern
this runbook covers, and it is the thing to check first when auditing DR.

## Frozen pre-lake tables

The 41 market-data objects that were served from a separate database until
2026-09-10 are frozen parquet at `s3://derived/recipe=questdb_full_2026-09-09/`
(row-count verified 39/39 exact), which is what DuckDB serves today. Their DDL
is `s3://meta/questdb_schema/questdb_schema_latest.sql`.
