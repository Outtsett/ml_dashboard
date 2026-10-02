"""Land the project's tables in the lake and read them back.

Every table goes to ``s3://derived/<dataset>/recipe=<recipe>/table=<name>/part-0.parquet``
with one line in ``meta/ingest_manifests/<dataset>.jsonl``, so the dashboard
serves it as ``derived_<dataset>_<name>`` after its next view refresh.
Run with the ml_dashboard interpreter (it carries the datalake ``lake`` package).
"""

from __future__ import annotations

import json
from datetime import datetime, timezone

import pyarrow as pa
import pyarrow.parquet as pq
from lake.layout import INGEST_MANIFESTS, arrow_fs, arrow_key, derived_root
from lake.writer import COMPRESSION, COMPRESSION_LEVEL


def write_table(dataset: str, recipe: str, name: str, table: pa.Table, source: str) -> dict:
    """Write one table (replacing an earlier write of the same recipe/table) and record it."""
    root = derived_root(dataset, recipe) / f"table={name}"
    key = arrow_key(root / "part-0.parquet")
    with arrow_fs().open_output_stream(key) as sink:
        pq.write_table(table, sink, compression=COMPRESSION, compression_level=COMPRESSION_LEVEL)
    size = arrow_fs().get_file_info(key).size
    entry = {
        "written_at": datetime.now(timezone.utc).isoformat(), "dataset": dataset, "table": name,
        "zone": "derived", "recipe": recipe, "source": source, "rows": table.num_rows,
        "duplicates_removed": 0, "file_count": 1, "bytes": size, "ts_min": None, "ts_max": None,
    }
    with (INGEST_MANIFESTS / f"{dataset}.jsonl").open("a", encoding="utf-8") as manifest:
        manifest.write(json.dumps(entry) + "\n")
    return entry
