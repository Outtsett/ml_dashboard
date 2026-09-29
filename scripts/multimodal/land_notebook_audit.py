"""Land the P1 notebook audit in the lake.

    s3://derived/multimodal_notebook_audit/recipe=audit_2026_09_29/table=notebooks/
    s3://derived/multimodal_notebook_audit/recipe=audit_2026_09_29/table=edge_verdicts/

Source: docs/plans/2026-09-29-multimodal/evidence/p1_notebook_audits.json and
p1_edge_verdicts.json (the read-only audit workflow's structured output).

    .venv/Scripts/python.exe scripts/multimodal/land_notebook_audit.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pyarrow as pa

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src" / "ml"))

from multimodal.lake_io import write_table  # noqa: E402

EVIDENCE = ROOT / "docs" / "plans" / "2026-09-29-multimodal" / "evidence"
DATASET = "multimodal_notebook_audit"
RECIPE = "audit_2026_09_29"


def joined(value: object) -> str:
    if isinstance(value, list):
        return " | ".join(str(item) for item in value)
    return "" if value is None else str(value)


def main() -> int:
    audits = json.loads((EVIDENCE / "p1_notebook_audits.json").read_text(encoding="utf-8"))
    verdicts = json.loads((EVIDENCE / "p1_edge_verdicts.json").read_text(encoding="utf-8"))
    notebook_columns = [
        "path", "relevant_to_training", "topic", "purpose", "data_sources", "methods", "findings",
        "lookahead_risk", "lookahead_detail", "costs_included", "out_of_sample", "validity_issues",
        "edge_evidence", "edge_summary", "reusable_assets", "recommendation",
    ]
    notebooks = pa.table({
        column: [
            (bool(row.get(column)) if column == "relevant_to_training" else joined(row.get(column)))
            for row in audits
        ]
        for column in notebook_columns
    })
    verdict_columns = ["path", "claim", "holds", "reasons", "corrected_numbers", "usable_for_design"]
    edge_verdicts = pa.table({column: [joined(row.get(column)) for row in verdicts] for column in verdict_columns})
    for name, table in (("notebooks", notebooks), ("edge_verdicts", edge_verdicts)):
        entry = write_table(DATASET, RECIPE, name, table, source="docs/plans/2026-09-29-multimodal/evidence")
        print(f"  {name}: {entry['rows']} rows, {entry['bytes']:,} bytes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
