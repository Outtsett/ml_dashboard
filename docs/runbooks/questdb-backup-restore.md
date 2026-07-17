# QuestDB Backup & Restore Runbook

Closes AUD-014/AUD-015 (CRITICAL — zero backup/DR for irreplaceable tick/order-book data)
from the 2026-07-12 data-infrastructure audit.

## Why this exists

Before 2026-07-13 there was no backup mechanism of any kind for this QuestDB instance.
`ticks` (~1.48M rows) and `dom_l2` order-book data (~17.46M rows) are genuinely
irreplaceable: no vendor sells historical CME futures order-book replay or
Coinbase-equivalent historical crypto L2/BBO data, and this machine holds no such vendor
credential regardless. `scripts/dump-questdb-parquet.py` (pre-existing) is explicitly NOT
a backup — it writes to the same physical drive as the source (E:), and never touches
`ticks`/`dom_l2`/`dom_summary` or the crypto tables.

## What backs this up

| Item | Value |
|---|---|
| Backup script | `E:\source\repos\ml_dashboard\scripts\backup-questdb.py` |
| Restore-drill script | `E:\source\repos\ml_dashboard\scripts\restore-questdb-backup.py` |
| Destination | `D:\questdb-backups\` |
| Destination physical disk | Disk 1 — `ST2000DM006-2DM164` (2TB HDD), genuinely separate spindle from the source |
| Source physical disk | Disk 2 — `Samsung SSD 970 EVO Plus 500GB` (hosts `E:`, where QuestDB's `db/` directory lives) |
| Mechanism | Per-partition SQL export to parquet (zstd level 3), using QuestDB's own `table_partitions()` metadata |
| Schedule | Daily, 03:15 local time, Windows Scheduled Task `QuestDB_Daily_Backup` (runs as user `tyler`, no elevation) |
| Coverage | All 32 tables in the instance, priority order: `ticks` → `dom_l2` → `dom_summary` → `ohlcv` (base table) → every remaining table (crypto tables, materialized views, feature/prediction-log tables) |

### Why per-partition SQL export, not a physical/file-level snapshot

QuestDB's native `CHECKPOINT CREATE` / `CHECKPOINT RELEASE` commands (the recommended
mechanism on Linux for a consistent physical copy of the whole `db/` directory) are
**not supported on Windows** — verified empirically against this exact instance
(v9.3.3):

```
$ curl -s --get http://127.0.0.1:9000/exec --data-urlencode "query=CHECKPOINT CREATE"
{"error":"Checkpoint is not supported on Windows"}
```

Per-partition SQL-to-parquet export is therefore the correct backup mechanism for this
platform/version, not a shortcut. It has an added benefit: partitions are QuestDB's own
atomic storage unit (`PARTITION BY DAY` on every table in this instance), so exporting
partition-by-partition gives natural, verifiable chunk boundaries and lets an
interrupted run resume exactly where it left off.

### Priority ordering and resilience

Tables are backed up in this order: `ticks`, `dom_l2`, `dom_summary`, `ohlcv`, then
every other table alphabetically. If the backup process is killed partway through (out
of disk space, machine reboot, etc.), the most irreplaceable data has already been
written to `D:` first. The state file is saved after **every table**, not just at the
end of the run, so a partial run's progress is never lost.

### Incremental behavior

QuestDB partitions are immutable once closed (WAL model) except the currently-active
partition and any partition later amended by an out-of-order/late-arriving write. The
script tracks `(numRows, diskSize, maxTimestamp)` per `(table, partition)` in
`D:\questdb-backups\_state.json` and skips re-exporting a partition on the next run if
none of those three have changed. This means:

- First run: full export of all 32 tables (~76GB source data → much smaller after zstd
  compression; see "First backup results" below).
- Every subsequent daily run: only new or changed partitions are re-exported — for this
  instance, that's effectively nothing per day right now, because **the MotiveWave
  ingestion feed has been confirmed dead for 100+ days (AUD-001)** — see the TTL note
  below. If/when the feed resumes, only the newly-written partitions get exported each
  night.
- Force a full re-export of everything regardless of state: `--force-full`.

## Manual run

```
"C:\Users\tyler\anaconda3\envs\ml\python.exe" "E:\source\repos\ml_dashboard\scripts\backup-questdb.py" --dest D:/questdb-backups
```

Options:
- `--tables ticks,dom_l2` — back up a subset instead of everything.
- `--force-full` — ignore the incremental state file, re-export every partition.
- `--dest <path>` — override destination (the script **refuses to run** if `--dest`
  resolves to the same drive letter as `--source-drive`, default `E:`, as a basic
  same-disk-backup guard).
- `--pg-host` / `--pg-port` / `--pg-user` / `--pg-password` — override connection
  (env vars `QUESTDB_HOST`/`QUESTDB_PG_PORT`/`QUESTDB_USER`/`QUESTDB_PASSWORD` also
  work, same convention as `dump-questdb-parquet.py`).

Every run writes a timestamped manifest to `D:\questdb-backups\_manifests\manifest_<UTC
timestamp>.json` and refreshes `D:\questdb-backups\_manifest_latest.json`. The manifest
records, per table: a **live snapshot** (row count + min/max timestamp captured from the
live table immediately before that table's export began) and the actual export result
(partitions exported/skipped/failed, rows written, elapsed time). The live snapshot is
the ground truth the restore drill diffs against.

## Scheduled task

```
schtasks /query /tn "QuestDB_Daily_Backup" /v /fo list
```

- Runs daily at **03:15** under the current user account (`tyler`) — **not** SYSTEM,
  **not** elevated. Backing up is a normal-user operation: QuestDB access is over
  HTTP/PG-wire (no admin rights needed), and both the source read path and the `D:`
  write path are within the logged-in user's own filesystem permissions.
- Logs to `D:\questdb-backups\_logs\backup.log` (appended every run; the manifest JSONs
  under `_manifests/` are the structured, authoritative per-run record).
- To change the schedule: `schtasks /change /tn "QuestDB_Daily_Backup" /st HH:MM`.
- To disable temporarily: `schtasks /change /tn "QuestDB_Daily_Backup" /disable`.

## Restore procedure

Restoring means reading the backed-up parquet files back — either directly with any
parquet-capable tool (pandas, Polars, DuckDB, Spark — the files are portable, standard
parquet, not tied to QuestDB), or back into QuestDB itself via `read_parquet()`:

```sql
-- Query a backed-up partition directly (path relative to cairo.sql.copy.root,
-- configured in server.conf as E:/source/databases/questdb-9.3.3-rt-windows-x86-64/import):
SELECT * FROM read_parquet('<staged-relative-path>/2026-03-26.parquet');

-- Or materialize it back into a real table:
CREATE TABLE ticks_restored AS (
    SELECT * FROM read_parquet('<staged-relative-path>/2026-03-26.parquet')
);
```

`read_parquet()` only resolves paths under QuestDB's configured `cairo.sql.copy.root`
(currently `E:/source/databases/questdb-9.3.3-rt-windows-x86-64/import`), so a real
restore-through-the-engine requires first copying the relevant backup file(s) from
`D:\questdb-backups\<table>\` into a subdirectory under that import root, then running
the query above.

`scripts/restore-questdb-backup.py` automates exactly this and is the reusable restore
verification tool — run it any time to prove the current backup set is still genuinely
restorable:

```
"C:\Users\tyler\anaconda3\envs\ml\python.exe" "E:\source\repos\ml_dashboard\scripts\restore-questdb-backup.py" --backup-dir D:/questdb-backups
```

It performs two **independent** checks per table, comparing both against the manifest's
live snapshot:

1. **QuestDB engine (`read_parquet`)** — stages the backup files under the import root
   and queries them through the live, running QuestDB SQL engine. This is what an actual
   restore-through-the-database looks like.
2. **pyarrow, direct off `D:`** — reads the parquet files with no QuestDB engine
   involved at all, proving the files are structurally valid on their own. This is the
   proof that the backup survives even a total QuestDB/Windows-build failure, since
   plain parquet is readable by any tool.

Staged copies under the import root are scratch/temporary and are deleted at the end of
the drill (pass `--keep-staged` to leave them for manual inspection). Nothing is ever
written back into the live `db/` directory — the drill only ever reads the live tables
(for the snapshot comparison) and writes to a scratch subdirectory under `import/`,
never to `db/`.

Results are written to `D:\questdb-backups\_restore_drill_result_<timestamp>.json` and
printed as a table (expected rows / restored rows via each method / MATCH-or-MISMATCH).
A non-zero exit code means at least one table failed to reconcile — treat that as a
backup-integrity incident, not a warning.

## First backup + restore drill results (2026-07-13)

<!-- FILLED IN AFTER THE FULL RUN COMPLETES -->

## TTL — deliberately NOT applied (AUD-018 hold)

The audit's AUD-018 finding recommends a 90-180 day TTL on `ticks`/`dom_l2`/
`dom_summary`/`ohlcv` "before re-enabling the upstream feed." **This has deliberately
NOT been done as part of this backup work**, and must not be done until a human
explicitly decides the TTL value and sequencing. The reason: the MotiveWave ingestion
feed has been confirmed dead for 100+ days (AUD-001), so `max(timestamp)` on every one
of these tables is already older than a blind 90-day cutoff. Running
`ALTER TABLE ticks SET TTL 90 DAYS` today would cause QuestDB to treat essentially the
entire table as past retention and purge it — destroying the exact irreplaceable
historical data this backup exists to protect, before the backup even has a chance to
be useful as a safety net for anything else. TTL must only be applied once the feed
resumes and/or with a value computed relative to actual current data, never a blind
"90 days from today."
