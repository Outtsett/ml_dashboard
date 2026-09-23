"""Land the regression tab's render-threshold and cache measurements into the lake.

Measured 2026-09-23 to answer two questions about the Price Regression tab:
how many points a scatter should draw, and whether an in-memory store such as
Redis would make it faster. The record lives in the lake, not in a page:

    s3://derived/regression_tab_performance/recipe=<recipe>/table=<name>/part-0.parquet

Tables:
    render_threshold        painted-pixel coverage and 2-D shape error of a
                            stride-thinned scatter against all the data, real
                            MNQ bars, by requested budget and panel size
    canvas_draw             browser-measured canvas cost by points drawn, three runs
    latency_layers          cold/warm server latency by layer and lake object,
                            under each rule for the one-second anatomy table
    client_fit              fitting cost on the main thread against the worker
    cache_option_reference  an in-process LRU hit against a Redis round trip

Each table write appends a manifest line to meta/ingest_manifests/.

Run with the datalake interpreter (it carries the ``lake`` package):

    E:/source/repos/datalake/.venv/Scripts/python.exe scripts/land_regression_tab_performance.py \\
        --scratch <directory holding the measurement CSVs>
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import polars as pl
import pyarrow.parquet as pq
from lake.layout import INGEST_MANIFESTS, arrow_fs, arrow_key, derived_root
from lake.writer import COMPRESSION, COMPRESSION_LEVEL

DATASET = "regression_tab_performance"
DEFAULT_RECIPE = "measured_2026_09_23"


def write_table(name: str, frame: pl.DataFrame, recipe: str, source: str) -> None:
    root = derived_root(DATASET, recipe) / f"table={name}"
    key = arrow_key(root / "part-0.parquet")
    with arrow_fs().open_output_stream(key) as sink:
        pq.write_table(frame.to_arrow(), sink, compression=COMPRESSION, compression_level=COMPRESSION_LEVEL)
    size = arrow_fs().get_file_info(key).size
    entry = {
        "written_at": datetime.now(timezone.utc).isoformat(), "dataset": DATASET, "table": name,
        "zone": "derived", "recipe": recipe, "source": source, "rows": frame.height,
        "duplicates_removed": 0, "file_count": 1, "bytes": size, "ts_min": None, "ts_max": None,
    }
    with (INGEST_MANIFESTS / f"{DATASET}.jsonl").open("a", encoding="utf-8") as manifest:
        manifest.write(json.dumps(entry) + "\n")
    print(f"  {name}: {frame.height:,} rows, {frame.width} columns, {size:,} bytes")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--scratch", type=Path, required=True)
    parser.add_argument("--recipe", default=DEFAULT_RECIPE)
    args = parser.parse_args()
    scratch = args.scratch

    # Clean re-measurement: requested budget and actual count kept apart, only
    # budgets smaller than the series, coverage on true 1x pixels.
    render = pl.read_csv(scratch / "render_threshold_clean.csv")

    before = pl.read_csv(scratch / "latency_layers.csv", schema_overrides={"object": pl.Utf8})
    after = pl.read_csv(scratch / "latency_after.csv", schema_overrides={"object": pl.Utf8})
    latency = pl.concat([
        before.with_columns(pl.lit("original_rule_reads_one_second_table").alias("measurement_set")),
        # layer names in latency_after.csv say which set they are:
        #   regression_columns_one_minute_copy_only  — anatomy read from the 1m copy alone
        #   regression_columns_all_current_rule      — both tables, as the tab reads them now
        after.with_columns(pl.col("layer").alias("measurement_set")),
    ], how="diagonal_relaxed")

    cache_reference = pl.DataFrame([
        {"option": "in-process LRU hit, full HTTP response (measured)", "payload_megabytes": 0.88,
         "milliseconds": 11.7, "source": "this machine, /api/charts/regression/columns warm, median of 3"},
        {"option": "Redis GET on localhost, value only (published)", "payload_megabytes": 1.0,
         "milliseconds": 1.2, "source": "redis-benchmark GET at 1 MB values, ~822 requests per second"},
        {"option": "Node JSON.parse of a large object (published)", "payload_megabytes": 5.0,
         "milliseconds": 25.0, "source": "reported 15-40 ms for large objects"},
    ])

    tables = {
        "render_threshold": render,
        "canvas_draw": pl.read_csv(scratch / "canvas_draw.csv"),
        "latency_layers": latency,
        "client_fit": pl.read_csv(scratch / "client_fit.csv"),
        "cache_option_reference": cache_reference,
    }
    print(f"landing {len(tables)} tables into {derived_root(DATASET, args.recipe)}")
    for name, frame in tables.items():
        write_table(name, frame, args.recipe, "regression tab performance measurements, 2026-09-23")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
