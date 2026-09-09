"""
QuestDB backup restore drill.

Proves the parquet backup produced by backup-questdb.py is genuinely restorable, using
TWO independent verification paths:

  1. Native QuestDB read_parquet(): backup files are copied from the backup drive into a
     scratch staging directory under QuestDB's own configured import root
     (cairo.sql.copy.root in server.conf) -- NOT the live db/ data directory -- and then
     queried through the actual running QuestDB SQL engine via read_parquet(). This proves
     QuestDB itself can read the backup back, which is what a real restore looks like
     (re-attach via read_parquet, or `CREATE TABLE x AS SELECT * FROM read_parquet(...)`).

  2. Independent pyarrow read directly off the backup drive (no QuestDB engine involved at
     all), proving the parquet files are structurally valid on their own -- the backup would
     survive even total QuestDB/Windows-build failure since plain parquet is readable by any
     tool (pandas, DuckDB, Polars, Spark, ...).

Both are diffed against the manifest's live_snapshot (row count + min/max timestamp captured
from the live table immediately before that backup run started).

Usage:
    python scripts/restore-questdb-backup.py                          # drill every table in the latest manifest
    python scripts/restore-questdb-backup.py --tables ticks,dom_l2,dom_summary,ohlcv
    python scripts/restore-questdb-backup.py --keep-staged            # don't clean up the scratch copies
"""

import argparse
import json
import shutil
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import pyarrow.parquet as pq

DEFAULT_BACKUP_DIR = Path("E:/lake/raw/vendor=questdb")
IMPORT_ROOT = Path("E:/source/databases/questdb-9.3.3-rt-windows-x86-64/import")
STAGING_SUBDIR = "_restore_drill"


def http_query(query):
    url = "http://127.0.0.1:9000/exec?" + urllib.parse.urlencode({"query": query})
    with urllib.request.urlopen(url, timeout=60) as resp:
        payload = json.loads(resp.read())
    if "error" in payload:
        raise RuntimeError(f"QuestDB query failed: {payload['error']} (query={query!r})")
    cols = [c["name"] for c in payload["columns"]]
    return [dict(zip(cols, row)) for row in payload["dataset"]]


def parse_ts(value):
    """Normalize a timestamp value (str, possibly ns or us precision, possibly None, possibly
    tz-naive from a raw pyarrow python datetime or tz-aware from a QuestDB 'Z'-suffixed JSON
    string) to a single comparable representation: a UTC tz-aware pandas.Timestamp. QuestDB
    TIMESTAMP columns are always UTC, so a tz-naive value is assumed to already be UTC and is
    localized rather than converted."""
    if value is None:
        return None
    import pandas as pd

    ts = pd.Timestamp(value)
    if ts.tzinfo is None:
        ts = ts.tz_localize("UTC")
    else:
        ts = ts.tz_convert("UTC")
    return ts


def load_manifest(backup_dir: Path) -> dict:
    manifest_path = backup_dir / "_manifest_latest.json"
    if not manifest_path.exists():
        raise FileNotFoundError(f"No manifest found at {manifest_path} -- run backup-questdb.py first")
    return json.loads(manifest_path.read_text())


def restore_via_questdb_engine(backup_dir: Path, table: str, log) -> dict:
    """Copy this table's backup parquet files into the QuestDB import-root staging dir and
    query them back through the live QuestDB engine via read_parquet()."""
    src_dir = backup_dir / table
    parquet_files = sorted(src_dir.glob("*.parquet"))
    if not parquet_files:
        return {"row_count": 0, "min_timestamp": None, "max_timestamp": None, "files": 0}

    stage_dir = IMPORT_ROOT / STAGING_SUBDIR / table
    stage_dir.mkdir(parents=True, exist_ok=True)

    total_rows = 0
    overall_min = None
    overall_max = None
    for f in parquet_files:
        staged = stage_dir / f.name
        shutil.copy2(f, staged)
        rel_path = f"{STAGING_SUBDIR}/{table}/{f.name}"
        rows = http_query(f"SELECT count() cnt, min(timestamp) mn, max(timestamp) mx FROM read_parquet('{rel_path}')")
        row = rows[0]
        total_rows += row["cnt"]
        mn = parse_ts(row["mn"])
        mx = parse_ts(row["mx"])
        if mn is not None and (overall_min is None or mn < overall_min):
            overall_min = mn
        if mx is not None and (overall_max is None or mx > overall_max):
            overall_max = mx

    return {
        "row_count": total_rows,
        "min_timestamp": str(overall_min) if overall_min is not None else None,
        "max_timestamp": str(overall_max) if overall_max is not None else None,
        "files": len(parquet_files),
    }


def restore_via_pyarrow(backup_dir: Path, table: str) -> dict:
    """Independent, QuestDB-engine-free check: read the parquet files directly off the
    backup drive with pyarrow and compute row counts + timestamp range from column stats."""
    src_dir = backup_dir / table
    parquet_files = sorted(src_dir.glob("*.parquet"))
    if not parquet_files:
        return {"row_count": 0, "min_timestamp": None, "max_timestamp": None, "files": 0}

    total_rows = 0
    overall_min = None
    overall_max = None
    for f in parquet_files:
        pf = pq.ParquetFile(str(f))
        total_rows += pf.metadata.num_rows
        table_data = pf.read(columns=["timestamp"])
        col = table_data.column("timestamp")
        # column is sorted ascending in QuestDB partition export order; take true min/max defensively
        import pyarrow.compute as pc

        mn_val = parse_ts(pc.min(col).as_py())
        mx_val = parse_ts(pc.max(col).as_py())
        if mn_val is not None and (overall_min is None or mn_val < overall_min):
            overall_min = mn_val
        if mx_val is not None and (overall_max is None or mx_val > overall_max):
            overall_max = mx_val

    return {
        "row_count": total_rows,
        "min_timestamp": str(overall_min) if overall_min is not None else None,
        "max_timestamp": str(overall_max) if overall_max is not None else None,
        "files": len(parquet_files),
    }


def diff_row(label, expected, restored):
    exp_count = expected["row_count"]
    res_count = restored["row_count"]
    exp_max = parse_ts(expected.get("max_timestamp"))
    res_max = parse_ts(restored.get("max_timestamp"))
    exp_min = parse_ts(expected.get("min_timestamp"))
    res_min = parse_ts(restored.get("min_timestamp"))

    count_match = exp_count == res_count
    max_match = exp_max == res_max
    min_match = exp_min == res_min
    status = "MATCH" if (count_match and max_match and min_match) else "MISMATCH"

    return {
        "check": label,
        "expected_row_count": exp_count,
        "restored_row_count": res_count,
        "count_match": count_match,
        "expected_min_ts": str(exp_min),
        "restored_min_ts": str(res_min),
        "min_match": min_match,
        "expected_max_ts": str(exp_max),
        "restored_max_ts": str(res_max),
        "max_match": max_match,
        "status": status,
    }


def main():
    parser = argparse.ArgumentParser(description="Restore drill for a QuestDB parquet backup")
    parser.add_argument("--backup-dir", type=str, default=str(DEFAULT_BACKUP_DIR))
    parser.add_argument("--tables", type=str, default=None, help="Comma-separated table override (default: every table in the latest manifest)")
    parser.add_argument("--keep-staged", action="store_true", help="Do not delete the scratch staging copies under the import root when done")
    args = parser.parse_args()

    backup_dir = Path(args.backup_dir)
    manifest = load_manifest(backup_dir)

    manifest_tables = {t["table"]: t for t in manifest["tables"]}
    if args.tables:
        tables = [t.strip() for t in args.tables.split(",")]
    else:
        tables = list(manifest_tables.keys())

    def log(msg):
        ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        print(f"[{ts}] {msg}", flush=True)

    log(f"Restore drill starting. Backup dir: {backup_dir}. Manifest run: {manifest['run_started_utc']}")
    log(f"Tables to drill: {tables}")

    results = []
    any_mismatch = False
    for table in tables:
        if table not in manifest_tables:
            log(f"  SKIP {table}: not present in manifest")
            continue
        expected = manifest_tables[table]["live_snapshot"]
        log(f"Drilling: {table} (expected {expected['row_count']:,} rows, max_ts={expected['max_timestamp']})")

        t0 = time.time()
        engine_result = restore_via_questdb_engine(backup_dir, table, log)
        engine_diff = diff_row("questdb_read_parquet", expected, engine_result)
        log(
            f"  [QuestDB read_parquet] {engine_result['files']} files, "
            f"{engine_result['row_count']:,} rows restored -> {engine_diff['status']} "
            f"({time.time() - t0:.1f}s)"
        )

        t1 = time.time()
        pyarrow_result = restore_via_pyarrow(backup_dir, table)
        pyarrow_diff = diff_row("pyarrow_direct", expected, pyarrow_result)
        log(
            f"  [pyarrow direct]      {pyarrow_result['files']} files, "
            f"{pyarrow_result['row_count']:,} rows restored -> {pyarrow_diff['status']} "
            f"({time.time() - t1:.1f}s)"
        )

        if engine_diff["status"] != "MATCH" or pyarrow_diff["status"] != "MATCH":
            any_mismatch = True

        results.append({"table": table, "expected": expected, "questdb_engine": engine_diff, "pyarrow": pyarrow_diff})

    if not args.keep_staged:
        stage_root = IMPORT_ROOT / STAGING_SUBDIR
        if stage_root.exists():
            shutil.rmtree(stage_root)
            log(f"Cleaned up staging directory {stage_root}")

    out = {
        "drill_run_utc": datetime.now(timezone.utc).isoformat(),
        "manifest_run_started_utc": manifest["run_started_utc"],
        "backup_dir": str(backup_dir),
        "results": results,
        "any_mismatch": any_mismatch,
    }
    out_path = backup_dir / f"_restore_drill_result_{datetime.now().strftime('%Y%m%dT%H%M%S')}.json"
    out_path.write_text(json.dumps(out, indent=2, default=str))
    log(f"Restore drill result written: {out_path}")

    print("\n" + "=" * 100)
    print(f"{'TABLE':<28}{'EXPECTED ROWS':>16}{'RESTORED (QDB)':>16}{'RESTORED (PA)':>16}{'STATUS':>12}")
    print("-" * 100)
    for r in results:
        status = "MATCH" if r["questdb_engine"]["status"] == "MATCH" and r["pyarrow"]["status"] == "MATCH" else "MISMATCH"
        print(
            f"{r['table']:<28}{r['expected']['row_count']:>16,}"
            f"{r['questdb_engine']['restored_row_count']:>16,}"
            f"{r['pyarrow']['restored_row_count']:>16,}{status:>12}"
        )
    print("=" * 100)

    if any_mismatch:
        log("RESTORE DRILL FAILED: at least one table had a count/timestamp mismatch")
        sys.exit(1)
    log("RESTORE DRILL PASSED: every table's restored row count and timestamp range matches the live snapshot")
    sys.exit(0)


if __name__ == "__main__":
    main()
