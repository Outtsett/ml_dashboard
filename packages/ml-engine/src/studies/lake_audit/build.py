r"""Land the lake audit reports in the lake so the dashboard can query them.

The notebook ``datalake/notebooks/lake_audit.py`` renders one JSON report the
audit job wrote to ``s3://meta/audits/market_bars_latest.json`` and computes
nothing itself. The same job also writes one ``<table>_<stamp>.json`` per run
(three so far, 2026-09-10), so this job reads every stamped report, read-only,
through the datalake's own ``lake.audit`` module, flattens each one into six
tables and lands them, one recipe per report:

    s3://derived/study_lake_audit/recipe=<table>_<stamp>/table=runs/
                                                        table=checks/
                                                        table=check_partitions/
                                                        table=coverage/
                                                        table=duplicate_partitions/
                                                        table=remediation_partitions/

The dashboard serves them as ``derived_study_lake_audit_<table>`` after
``POST /api/labels/catalog/refresh`` or the next boot. A report whose recipe is
already landed is skipped, never overwritten, so a run after a new audit
(``python scripts/audit_lake.py --table bars`` in the datalake repo) lands only
the new report. The audit itself (a multi-minute scan of 785M rows, and its
``apply`` which rewrites Iceberg partitions) stays in the datalake repo.

Run with the datalake interpreter (it carries ``lake``, pandas and pyarrow):

    E:/source/repos/datalake/.venv/Scripts/python.exe packages/ml-engine/src/studies/lake_audit/build.py
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile

import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from ta_strategy.store import land, write_local  # noqa: E402

DATASET = "study_lake_audit"

PARTITION_KEYS = ["asset_class", "root", "timeframe", "partition_start_timestamp"]


def naive_utc(value) -> pd.Timestamp | None:
    """A tz-naive UTC timestamp, or None (the audit writes ISO strings)."""
    if value is None:
        return None
    stamp = pd.Timestamp(value)
    return stamp.tz_convert("UTC").tz_localize(None) if stamp.tzinfo else stamp


def frame(rows: list[dict], columns: dict[str, str]) -> pd.DataFrame:
    """A frame with exactly these columns and dtypes, empty or not (an empty list still has a schema)."""
    out = pd.DataFrame(rows, columns=list(columns))
    for name, dtype in columns.items():
        if dtype == "timestamp":
            out[name] = pd.to_datetime(out[name].map(naive_utc)).astype("datetime64[us]")
        else:
            out[name] = out[name].astype(dtype)
    return out


def flatten(report: dict, source_uri: str) -> dict[str, pd.DataFrame]:
    """One audit report into its six tables. Every column is a full word."""
    generated_at = naive_utc(report["generated_at"])
    remediation = report.get("remediation") or {}

    runs = frame([{
        "table_name": report["table"],
        "generated_at": generated_at,
        "snapshot_id": str(report["snapshot_id"]),
        "row_count": report["row_count"],
        "partition_count": report["partition_count"],
        "error_row_count": report["error_row_count"],
        "warning_row_count": report["warning_row_count"],
        "droppable_row_count": report["droppable_row_count"],
        "duplicate_key_row_count": report["duplicate_key_row_count"],
        "row_pass_seconds": report["row_pass_seconds"],
        "duplicate_pass_seconds": report["duplicate_pass_seconds"],
        "unique_key": ", ".join(report["unique_key"]),
        "check_count": len(report["checks"]),
        "scope_predicate": report.get("scope_predicate"),
        "has_remediation": bool(remediation),
        "remediation_generated_at": remediation.get("generated_at"),
        "remediation_dry_run": remediation.get("dry_run"),
        "remediation_partitions_planned": remediation.get("partitions_planned"),
        "remediation_partitions_rewritten": remediation.get("partitions_rewritten"),
        "remediation_partitions_skipped": remediation.get("partitions_skipped"),
        "remediation_rows_removed": remediation.get("rows_removed"),
        "source_report": source_uri,
    }], {
        "table_name": "string", "generated_at": "timestamp", "snapshot_id": "string",
        "row_count": "int64", "partition_count": "int64", "error_row_count": "int64",
        "warning_row_count": "int64", "droppable_row_count": "int64", "duplicate_key_row_count": "int64",
        "row_pass_seconds": "float64", "duplicate_pass_seconds": "float64", "unique_key": "string",
        "check_count": "int64", "scope_predicate": "string", "has_remediation": "bool",
        "remediation_generated_at": "timestamp", "remediation_dry_run": "boolean",
        "remediation_partitions_planned": "Int64", "remediation_partitions_rewritten": "Int64",
        "remediation_partitions_skipped": "Int64", "remediation_rows_removed": "Int64",
        "source_report": "string",
    })

    checks = frame([{
        "generated_at": generated_at,
        "check_name": c["name"],
        "severity": c["severity"],
        "remediation": c["remediation"],
        "description": c["description"],
        "predicate": c["predicate"],
        "violation_row_count": c["violation_row_count"],
        "violation_share_of_table": c["violation_share_of_table"],
        "affected_partition_count": len(c["partitions_affected"]),
    } for c in report["checks"]], {
        "generated_at": "timestamp", "check_name": "string", "severity": "string", "remediation": "string",
        "description": "string", "predicate": "string", "violation_row_count": "int64",
        "violation_share_of_table": "float64", "affected_partition_count": "int64",
    })

    check_partitions = frame([{
        "generated_at": generated_at,
        "check_name": c["name"],
        **{key: p.get(key) for key in PARTITION_KEYS},
        "violation_row_count": p["violation_row_count"],
    } for c in report["checks"] for p in c["partitions_affected"]], {
        "generated_at": "timestamp", "check_name": "string", "asset_class": "string", "root": "string",
        "timeframe": "string", "partition_start_timestamp": "timestamp", "violation_row_count": "int64",
    })

    coverage = frame([{"generated_at": generated_at, **row} for row in report["coverage"]], {
        "generated_at": "timestamp", "asset_class": "string", "timeframe": "string", "row_count": "int64",
        "symbol_count": "int64", "first_timestamp": "timestamp", "last_timestamp": "timestamp",
        "hours_since_last_row": "int64",
    })

    duplicate_partitions = frame([{"generated_at": generated_at, **row} for row in report["duplicate_partitions"]], {
        "generated_at": "timestamp", "asset_class": "string", "root": "string", "timeframe": "string",
        "partition_start_timestamp": "timestamp", "row_count": "int64", "duplicate_key_row_count": "int64",
    })

    remediation_partitions = frame([{"generated_at": generated_at, **row} for row in remediation.get("partitions", [])], {
        "generated_at": "timestamp", "asset_class": "string", "root": "string", "timeframe": "string",
        "partition_start_timestamp": "timestamp", "row_count_before": "int64", "row_count_after": "int64",
        "rows_removed": "int64", "status": "string",
    })

    return {
        "runs": runs, "checks": checks, "check_partitions": check_partitions, "coverage": coverage,
        "duplicate_partitions": duplicate_partitions, "remediation_partitions": remediation_partitions,
    }


def recipe_for(report: dict) -> str:
    stamp = pd.Timestamp(report["generated_at"]).strftime("%Y%m%dT%H%M%S")
    return f"{report['table'].replace('.', '_')}_{stamp}"


def recipe_exists(recipe: str) -> bool:
    from lake.layout import arrow_fs, arrow_key, derived_root

    key = arrow_key(derived_root(DATASET, recipe) / "table=runs" / "part-0.parquet")
    return arrow_fs().get_file_info(key).type.name != "NotFound"


def stamped_reports() -> list[tuple[str, dict]]:
    """Every ``<table>_<stamp>.json`` under s3://meta/audits (the ``_latest`` copy repeats the newest)."""
    from lake import audit

    out = []
    for path in sorted(audit.AUDIT_DIR.iterdir(), key=str):
        name = str(path)
        if name.endswith(".json") and not name.endswith("_latest.json"):
            out.append((name, json.loads(path.read_text(encoding="utf-8"))))
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.parse_args()
    landed_any = False
    for uri, report in stamped_reports():
        recipe = recipe_for(report)
        if recipe_exists(recipe):
            print(f"skip {recipe}: already landed")
            continue
        tables = flatten(report, uri)
        print(f"{recipe}: " + ", ".join(f"{name} {len(data)}" for name, data in tables.items()))
        with tempfile.TemporaryDirectory() as scratch:
            paths = write_local(tables, scratch)
            landed = land(paths, recipe, source=uri, dataset=DATASET)
        for name, detail in landed.items():
            print(f"  {name}: {detail['rows']:,} rows, {detail['bytes']:,} bytes, manifest {detail['manifest']}")
        landed_any = True
    if not landed_any:
        print("nothing new to land")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
