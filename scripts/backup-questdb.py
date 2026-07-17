"""
QuestDB full-instance backup to a physically separate drive.

Exports every table via SQL (per-partition, using QuestDB's own table_partitions()
metadata) to parquet on a backup destination that lives on a DIFFERENT PHYSICAL DISK
than the source data directory. QuestDB on Windows does not support CHECKPOINT CREATE
(verified empirically against v9.3.3: "Checkpoint is not supported on Windows"), so a
physical/file-level snapshot backup is not available on this platform -- this SQL-level
per-partition parquet export is the correct backup mechanism for this OS/version.

Priority order (irreplaceable data first, so a killed/interrupted run has already
protected the most valuable tables): ticks, dom_l2, dom_summary, ohlcv, then every
remaining table in the instance (crypto tables, materialized views, feature tables, ...).

Incremental: each table's partitions are immutable once closed in QuestDB's WAL model
(except the currently-active/most-recent partition, and any partition later amended by
an out-of-order/late-arriving write). A state file records (numRows, diskSize,
maxTimestamp) per (table, partition) from the last successful export of that partition;
on rerun, only new/changed partitions are re-exported. Use --force-full to ignore state
and re-export everything.

Usage:
    python scripts/backup-questdb.py                          # incremental, all tables, priority order
    python scripts/backup-questdb.py --tables ticks,dom_l2     # subset
    python scripts/backup-questdb.py --force-full              # ignore state, re-export everything
    python scripts/backup-questdb.py --dest D:/questdb-backups # override destination
"""

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import psycopg2

PRIORITY_TABLES = ["ticks", "dom_l2", "dom_summary", "ohlcv"]

DEFAULT_DEST = Path("D:/questdb-backups")
DEFAULT_SOURCE_DRIVE = "E:"  # QuestDB data directory lives here -- must never equal --dest drive
STATE_FILENAME = "_state.json"
FETCH_CHUNK_SIZE = 200_000


def connect(host, port, user, password):
    return psycopg2.connect(host=host, port=port, user=user, password=password, database="qdb")


def http_query(query):
    """Run a query via QuestDB's HTTP /exec endpoint (used for metadata-only calls that
    don't need a pg-wire cursor, e.g. SHOW TABLES / table_partitions)."""
    import urllib.parse
    import urllib.request

    url = "http://127.0.0.1:9000/exec?" + urllib.parse.urlencode({"query": query})
    with urllib.request.urlopen(url, timeout=30) as resp:
        payload = json.loads(resp.read())
    if "error" in payload:
        raise RuntimeError(f"QuestDB query failed: {payload['error']} (query={query!r})")
    cols = [c["name"] for c in payload["columns"]]
    return [dict(zip(cols, row)) for row in payload["dataset"]]


def list_all_tables():
    rows = http_query("SHOW TABLES")
    return [r["table_name"] for r in rows]


def table_partitions(table):
    return http_query(
        f"SELECT index, name, minTimestamp, maxTimestamp, numRows, diskSize "
        f"FROM table_partitions('{table}') ORDER BY index"
    )


def live_snapshot(table):
    """Point-in-time count/min/max for a table, captured before export begins -- this is
    the ground truth the restore drill diffs against."""
    rows = http_query(f"SELECT count() cnt, min(timestamp) min_ts, max(timestamp) max_ts FROM {table}")
    row = rows[0]
    return {"row_count": row["cnt"], "min_timestamp": row["min_ts"], "max_timestamp": row["max_ts"]}


def load_state(dest: Path) -> dict:
    state_path = dest / STATE_FILENAME
    if state_path.exists():
        return json.loads(state_path.read_text())
    return {}


def save_state(dest: Path, state: dict):
    state_path = dest / STATE_FILENAME
    state_path.write_text(json.dumps(state, indent=2, default=str))


def partition_unchanged(state: dict, table: str, part: dict) -> bool:
    key = f"{table}/{part['name']}"
    prev = state.get(key)
    if prev is None:
        return False
    return (
        prev.get("numRows") == part["numRows"]
        and prev.get("diskSize") == part["diskSize"]
        and prev.get("maxTimestamp") == part["maxTimestamp"]
    )


def export_partition(conn, table: str, part: dict, out_path: Path) -> int:
    """Fetch one partition's rows in chunks and write a single parquet file. Returns row count written.

    QuestDB's PG-wire emulation does not support named/server-side cursors
    (`DECLARE ... CURSOR WITHOUT HOLD` is rejected -- verified empirically against v9.3.3),
    so this uses a plain client-side cursor. Per-partition size is bounded by QuestDB's own
    DAY partitioning (largest observed partition in this instance: ~860k rows / ~73MB), so
    the full per-partition result set comfortably fits in memory regardless of fetchmany
    chunking; fetchmany is still used to keep the write path incremental/consistent with
    a possible future large-partition table.
    """
    cur = conn.cursor()
    cur.execute(
        f"SELECT * FROM {table} WHERE timestamp >= '{part['minTimestamp']}' "
        f"AND timestamp <= '{part['maxTimestamp']}'"
    )
    cols = [d[0] for d in cur.description]

    chunks = []
    total = 0
    while True:
        rows = cur.fetchmany(FETCH_CHUNK_SIZE)
        if not rows:
            break
        chunks.append(pd.DataFrame(rows, columns=cols))
        total += len(rows)
    cur.close()

    out_path.parent.mkdir(parents=True, exist_ok=True)
    if not chunks:
        # Partition metadata said numRows>0 but query returned nothing -- data integrity
        # problem, must not be silently skipped.
        if part["numRows"] > 0:
            raise RuntimeError(
                f"{table}/{part['name']}: table_partitions() reports {part['numRows']} rows "
                f"but export query returned 0 rows -- refusing to write an empty backup file"
            )
        return 0

    df = pd.concat(chunks, ignore_index=True) if len(chunks) > 1 else chunks[0]
    df.to_parquet(str(out_path), compression="zstd", compression_level=3)
    return total


def backup_table(conn, table: str, dest: Path, state: dict, force_full: bool, log) -> dict:
    t0 = time.time()
    snapshot = live_snapshot(table)
    parts = table_partitions(table)

    table_dir = dest / table
    exported = 0
    skipped = 0
    rows_written = 0
    errors = []
    progress_every = 250

    for i, part in enumerate(parts, start=1):
        out_path = table_dir / f"{part['name']}.parquet"
        if not force_full and out_path.exists() and partition_unchanged(state, table, part):
            skipped += 1
            continue
        try:
            n = export_partition(conn, table, part, out_path)
            rows_written += n
            key = f"{table}/{part['name']}"
            state[key] = {
                "numRows": part["numRows"],
                "diskSize": part["diskSize"],
                "maxTimestamp": part["maxTimestamp"],
                "backed_up_at": datetime.now(timezone.utc).isoformat(),
                "rows_written": n,
                "file": str(out_path),
            }
            exported += 1
        except Exception as e:
            errors.append({"partition": part["name"], "error": str(e)})
            log(f"    FAILED partition {part['name']}: {e}")

        if len(parts) > progress_every and i % progress_every == 0:
            elapsed_so_far = time.time() - t0
            log(
                f"    ...{table} progress: {i}/{len(parts)} partitions processed "
                f"({exported} exported, {skipped} skipped, {len(errors)} failed), "
                f"{rows_written:,} rows so far, {elapsed_so_far:.0f}s elapsed"
            )

    elapsed = time.time() - t0
    log(
        f"  {table}: {len(parts)} partitions ({exported} exported, {skipped} unchanged/skipped, "
        f"{len(errors)} failed), {rows_written:,} rows written in {elapsed:.1f}s "
        f"[live snapshot: {snapshot['row_count']:,} rows, max_ts={snapshot['max_timestamp']}]"
    )

    return {
        "table": table,
        "live_snapshot": snapshot,
        "partitions_total": len(parts),
        "partitions_exported": exported,
        "partitions_skipped": skipped,
        "partitions_failed": len(errors),
        "errors": errors,
        "rows_written": rows_written,
        "elapsed_seconds": round(elapsed, 2),
    }


def main():
    parser = argparse.ArgumentParser(description="Backup QuestDB to parquet on a separate physical drive")
    parser.add_argument("--dest", type=str, default=str(DEFAULT_DEST), help=f"Backup destination (default: {DEFAULT_DEST})")
    parser.add_argument("--tables", type=str, default=None, help="Comma-separated table override (default: all tables, priority order)")
    parser.add_argument("--force-full", action="store_true", help="Ignore incremental state, re-export every partition")
    parser.add_argument("--pg-host", type=str, default=os.environ.get("QUESTDB_HOST", "127.0.0.1"))
    parser.add_argument("--pg-port", type=int, default=int(os.environ.get("QUESTDB_PG_PORT", "8812")))
    parser.add_argument("--pg-user", type=str, default=os.environ.get("QUESTDB_USER", "admin"))
    parser.add_argument("--pg-password", type=str, default=os.environ.get("QUESTDB_PASSWORD", "quest"))
    parser.add_argument("--source-drive", type=str, default=DEFAULT_SOURCE_DRIVE, help="Drive letter the live QuestDB data directory lives on -- refuses to run if --dest is on this drive")
    args = parser.parse_args()

    dest = Path(args.dest)
    dest_drive = os.path.splitdrive(str(dest.resolve()))[0].upper()
    source_drive = args.source_drive.rstrip("\\/").upper()
    if not source_drive.endswith(":"):
        source_drive += ":"
    if dest_drive == source_drive:
        print(
            f"REFUSING TO RUN: destination drive {dest_drive} is the same as the source "
            f"data drive {source_drive}. A backup on the same physical volume as the source "
            f"defeats the purpose. Pass --dest on a different drive.",
            file=sys.stderr,
        )
        sys.exit(2)

    dest.mkdir(parents=True, exist_ok=True)

    def log(msg):
        ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        print(f"[{ts}] {msg}", flush=True)

    if args.tables:
        tables = [t.strip() for t in args.tables.split(",")]
    else:
        all_tables = list_all_tables()
        rest = sorted(t for t in all_tables if t not in PRIORITY_TABLES)
        tables = [t for t in PRIORITY_TABLES if t in all_tables] + rest
        missing_priority = [t for t in PRIORITY_TABLES if t not in all_tables]
        if missing_priority:
            log(f"WARNING: priority tables not found in instance: {missing_priority}")

    log(f"Backup run starting. Destination: {dest} (drive {dest_drive}, source drive {source_drive})")
    log(f"Tables ({len(tables)}), priority order: {tables}")

    state = load_state(dest) if not args.force_full else {}
    conn = connect(args.pg_host, args.pg_port, args.pg_user, args.pg_password)

    run_started = datetime.now(timezone.utc).isoformat()
    results = []
    fatal_tables = []
    for table in tables:
        log(f"Backing up: {table}")
        try:
            result = backup_table(conn, table, dest, state, args.force_full, log)
            results.append(result)
        except Exception as e:
            log(f"  FATAL for table {table}: {e}")
            fatal_tables.append({"table": table, "error": str(e)})
        save_state(dest, state)  # persist after every table so a killed run keeps prior progress

    conn.close()

    manifest = {
        "run_started_utc": run_started,
        "run_finished_utc": datetime.now(timezone.utc).isoformat(),
        "destination": str(dest),
        "dest_drive": dest_drive,
        "source_drive": source_drive,
        "force_full": args.force_full,
        "tables": results,
        "fatal_tables": fatal_tables,
    }
    manifest_dir = dest / "_manifests"
    manifest_dir.mkdir(parents=True, exist_ok=True)
    manifest_name = f"manifest_{datetime.now().strftime('%Y%m%dT%H%M%S')}.json"
    (manifest_dir / manifest_name).write_text(json.dumps(manifest, indent=2, default=str))
    (dest / "_manifest_latest.json").write_text(json.dumps(manifest, indent=2, default=str))

    log(f"Manifest written: {manifest_dir / manifest_name}")

    total_failed_partitions = sum(r["partitions_failed"] for r in results)
    if fatal_tables or total_failed_partitions:
        log(
            f"COMPLETED WITH ERRORS: {len(fatal_tables)} fatal table(s), "
            f"{total_failed_partitions} failed partition(s) across successful tables"
        )
        sys.exit(1)

    log("Backup run completed successfully, no errors.")
    sys.exit(0)


if __name__ == "__main__":
    main()
