"""Land the data-lifecycle audit into the lake.

The audit (2026-09-23) was a measured, adversarially verified review of how data
is stored, retrieved, moved, computed on, held in memory, temporarily saved and
destroyed across the lake, the DuckDB serving layer, the Node server, the
browser client and the Python training path.

Its record lives in the lake, not in a page:

    s3://derived/data_lifecycle_audit/recipe=<recipe>/table=<name>/part-0.parquet

Tables:
    findings                  one row per verified improvement
    refuted_findings          what the adversarial verifiers struck, and why
    headline_measurements     one number per measurement a researcher took
    documentation_confirmed   library facts confirmed from source or docs
    raw_table_index           what each raw_* table is and where it came from
    raw_<strand>__<name>      every per-item table a researcher measured

Each table write appends a manifest line to meta/ingest_manifests/.

Run with the datalake interpreter (it carries the ``lake`` package):

    E:/source/repos/datalake/.venv/Scripts/python.exe scripts/land_data_lifecycle_audit.py \
        --workflow-result <result.json> --scratch <audit scratch dir>
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import polars as pl
import pyarrow.parquet as pq
from lake.layout import INGEST_MANIFESTS, arrow_fs, arrow_key, derived_root
from lake.writer import COMPRESSION, COMPRESSION_LEVEL

DATASET = "data_lifecycle_audit"
DEFAULT_RECIPE = "measured_audit_2026_09_23"
AUDIT_DATE = "2026-09-23"

FINDING_COLUMNS = [
    "identifier", "strand", "lifecycle_stage", "component", "file_path", "line_number", "title",
    "current_behavior", "evidence", "measured_value", "measured_unit", "improvement", "expected_gain",
    "severity", "effort", "risk", "confidence", "verdict", "verification_note",
]


def table_name(text: str) -> str:
    return re.sub(r"[^a-z0-9_]+", "_", text.lower()).strip("_")


def findings_frame(rows: list[dict], strand_of: dict[str, str]) -> pl.DataFrame:
    shaped = []
    for row in rows:
        shaped.append({
            **{column: row.get(column) for column in FINDING_COLUMNS},
            "strand": row.get("strand") or strand_of.get(row["identifier"].split("-")[0], "unknown"),
            "line_number": int(row.get("line_number") or 0),
            "measured_value": None if row.get("measured_value") is None else float(row["measured_value"]),
        })
    frame = pl.DataFrame(shaped, schema={
        column: (pl.Int64 if column == "line_number" else pl.Float64 if column == "measured_value" else pl.Utf8)
        for column in FINDING_COLUMNS
    })
    return frame.with_columns(pl.lit(AUDIT_DATE).str.to_date().alias("audit_date"))


def write_table(name: str, frame: pl.DataFrame, recipe: str, source: str) -> int:
    root = derived_root(DATASET, recipe) / f"table={name}"
    key = arrow_key(root / "part-0.parquet")
    with arrow_fs().open_output_stream(key) as sink:
        pq.write_table(frame.to_arrow(), sink, compression=COMPRESSION, compression_level=COMPRESSION_LEVEL)
    size = arrow_fs().get_file_info(key).size
    # Same fields lake.writer records, plus the table: one manifest file for the
    # whole audit rather than one per table.
    entry = {
        "written_at": datetime.now(timezone.utc).isoformat(), "dataset": DATASET, "table": name,
        "zone": "derived", "recipe": recipe, "source": source, "rows": frame.height,
        "duplicates_removed": 0, "file_count": 1, "bytes": size, "ts_min": None, "ts_max": None,
    }
    with (INGEST_MANIFESTS / f"{DATASET}.jsonl").open("a", encoding="utf-8") as manifest:
        manifest.write(json.dumps(entry) + "\n")
    print(f"  {name}: {frame.height:,} rows, {frame.width} columns, {size:,} bytes")
    return size


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--workflow-result", type=Path, required=True)
    parser.add_argument("--scratch", type=Path, required=True)
    parser.add_argument("--recipe", default=DEFAULT_RECIPE)
    parser.add_argument("--coordinator-checked", default="",
                        help="comma-separated GAP identifiers the coordinator re-checked against source")
    parser.add_argument("--coordinator-note", default="",
                        help="what the coordinator re-checked, recorded on each of those findings")
    args = parser.parse_args()

    result = json.loads(args.workflow_result.read_text(encoding="utf-8"))
    source = f"data lifecycle audit workflow {args.workflow_result.name}"
    prefixes = {"LAKE": "lake_storage", "SERVER": "server_read_path", "TEMP": "temporary_storage",
                "PY": "python_compute", "GAP": "gaps"}

    # The gap critic's findings had no separate verifier. Those the coordinator
    # re-checked against source say so; the rest say they were not re-checked.
    checked = {identifier.strip() for identifier in args.coordinator_checked.split(",") if identifier.strip()}
    gap_findings = [
        {**finding, "strand": "gaps",
         "verdict": "confirmed_by_coordinator" if finding["identifier"] in checked else "measured_by_critic_only",
         "verification_note": args.coordinator_note if finding["identifier"] in checked
         else "measured by the gap investigator; not re-checked by a second agent"}
        for finding in (result.get("gaps") or {}).get("findings", [])
    ]
    findings = findings_frame(result["kept"] + gap_findings, prefixes)

    refuted = pl.DataFrame(result.get("dropped") or [], schema={
        "identifier": pl.Utf8, "verdict": pl.Utf8, "title": pl.Utf8, "verification_note": pl.Utf8})

    measurement_rows, documentation_rows = [], []
    strand_blocks = list(result["strands"])
    if result.get("gaps"):
        strand_blocks.append({"strand": "gaps", **result["gaps"]})
    for block in strand_blocks:
        for measurement in block.get("measurements", []):
            csv_path = measurement.get("csv_path") or ""
            measurement_rows.append({
                "strand": block["strand"], "measurement_name": measurement["measurement_name"],
                "value": float(measurement["value"]), "unit": measurement["unit"], "method": measurement["method"],
                "raw_table_name": (f"raw_{block['strand']}__{table_name(Path(csv_path).stem)}" if csv_path else ""),
            })
        for fact in block.get("documentation_confirmed", []):
            documentation_rows.append({"strand": block["strand"], **fact})

    tables: dict[str, pl.DataFrame] = {
        "findings": findings,
        "refuted_findings": refuted,
        "headline_measurements": pl.DataFrame(measurement_rows),
        "documentation_confirmed": pl.DataFrame(documentation_rows),
    }

    index_rows = []
    for csv in sorted(args.scratch.rglob("*.csv")):
        strand = csv.relative_to(args.scratch).parts[0]
        name = f"raw_{table_name(strand)}__{table_name(csv.stem)}"
        try:
            frame = pl.read_csv(csv, infer_schema_length=100_000, try_parse_dates=True)
        except Exception as error:  # a malformed scratch CSV is reported, not silently skipped
            print(f"  skipped {csv}: {type(error).__name__}: {error}", file=sys.stderr)
            continue
        if frame.height == 0:
            continue
        tables[name] = frame
        index_rows.append({"raw_table_name": name, "strand": strand, "source_file": csv.name,
                           "row_count": frame.height, "column_count": frame.width,
                           "columns": ", ".join(frame.columns)})
    tables["raw_table_index"] = pl.DataFrame(index_rows)

    print(f"landing {len(tables)} tables into {derived_root(DATASET, args.recipe)}")
    total = sum(write_table(name, frame, args.recipe, source) for name, frame in tables.items())
    print(f"done: {total:,} bytes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
