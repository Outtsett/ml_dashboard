r"""Land the TimescaleDB monthly-load measurement log in the lake.

The notebook ``datalake/notebooks/timescaledb_load.py`` read one table from
``E:\lake-workspace\workspace.duckdb``, ``timescaledb_load_batches``: one row per
monthly INSERT commit of ``scripts/load_timescaledb.py`` (recorded 2026-09-12,
13:31 to 15:15), plus constants written into the notebook source. A standalone
``.duckdb`` is unreadable from the dashboard (its DuckDB has no ATTACH), so this
job copies the log as it is, read-only, adds the notebook's derived
``batch_number`` (1-based, in ``recorded_at`` order) and lands:

    s3://derived/study_timescaledb_load_monitor/recipe=<recipe>/table=batches/
    s3://derived/study_timescaledb_load_monitor/recipe=<recipe>/table=load_facts/

``load_facts`` carries the notebook's hard-coded constants (lake row counts,
the slice's month count, the bytes-per-row of the forex load and of the failed
first attempt, the free space the notebook quoted) each with the notebook line
it came from, so the page reads every number from the lake.

The dashboard serves them as ``derived_study_timescaledb_load_monitor_batches``
and ``..._load_facts`` once the manifest lines land (``POST
/api/labels/catalog/refresh`` or the next boot). An existing recipe is never
overwritten: a second run refuses unless given a new ``--recipe``.

Run with the datalake interpreter (it carries ``lake``, pandas and pyarrow):

    E:/source/repos/datalake/.venv/Scripts/python.exe packages/ml-engine/src/studies/timescaledb_load_monitor/build.py
"""

from __future__ import annotations

import argparse
import os
import sys
import tempfile

import duckdb
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from ta_strategy.store import land, write_local  # noqa: E402

DATASET = "study_timescaledb_load_monitor"
DEFAULT_RECIPE = "measured_2026_09_12"
SOURCE_DATABASE = r"E:\lake-workspace\workspace.duckdb"
NOTEBOOK = "datalake/notebooks/timescaledb_load.py"

#: (fact, value, unit, meaning, notebook line). Values are the notebook's own constants.
FACTS = [
    ("lake_total_row_count", 785_766_203.0, "rows", "market.bars, every slice: the row count the serving copy must reach", f"{NOTEBOOK}:89"),
    ("futures_one_second_slice_row_count", 711_812_841.0, "rows", "the futures 1-second slice this load moves (90.6 percent of the table)", f"{NOTEBOOK}:90"),
    ("futures_one_second_slice_month_count", 187.0, "months", "one INSERT commit per month of the slice", f"{NOTEBOOK}:91"),
    ("forex_proven_bytes_per_row", 125.3, "bytes per row", "density the forex load achieved; the target line on the size chart", f"{NOTEBOOK}:359-361"),
    ("failed_attempt_bytes_per_row", 824.0, "bytes per row", "first attempt: 7-day chunks, slice-ordered inserts, pages about 15 percent full", f"{NOTEBOOK}:326-330,376"),
    ("failed_attempt_projected_gigabytes", 648.0, "gigabytes", "the failed attempt's projection for the full table", f"{NOTEBOOK}:330"),
    ("failed_attempt_free_gigabytes", 237.0, "gigabytes", "free space the notebook compared the failed projection against", f"{NOTEBOOK}:330"),
    ("free_gigabytes_on_e_drive", 287.7, "gigabytes", "free space on E: quoted beside the current projection", f"{NOTEBOOK}:376"),
    ("failed_attempt_chunk_count", 847.0, "chunks", "7-day chunks the thin layers of rows were sprayed across", f"{NOTEBOOK}:328"),
    ("failed_attempt_rolled_back_share", 9.4, "percent", "share loaded when the single-INSERT attempt rolled back", f"{NOTEBOOK}:123"),
    ("marginal_bytes_per_row_first_99_months", 158.8, "bytes per row", "marginal density over the first 99 months, as the notebook measured it", f"{NOTEBOOK}:395"),
    ("marginal_bytes_per_row_first_99_months_spread", 2.4, "bytes per row", "plus or minus, same window", f"{NOTEBOOK}:395"),
]


def read_batches(database: str) -> pd.DataFrame:
    connection = duckdb.connect(database, read_only=True)
    try:
        connection.execute("SET TimeZone = 'UTC'")
        frame = connection.execute(
            """
            SELECT recorded_at, asset_class, timeframe, month_start, lake_row_count, elapsed_seconds,
                   rows_per_second, hypertable_bytes, hypertable_row_count, bytes_per_row
            FROM timescaledb_load_batches ORDER BY recorded_at
            """
        ).fetchdf()
    finally:
        connection.close()
    frame.insert(0, "batch_number", range(1, len(frame) + 1))
    frame["month_start"] = pd.to_datetime(frame["month_start"])
    return frame


def read_facts() -> pd.DataFrame:
    return pd.DataFrame(FACTS, columns=["fact", "value", "unit", "meaning", "notebook_line"])


def recipe_exists(recipe: str) -> bool:
    from lake.layout import arrow_fs, arrow_key, derived_root

    key = arrow_key(derived_root(DATASET, recipe) / "table=batches" / "part-0.parquet")
    return arrow_fs().get_file_info(key).type.name != "NotFound"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--recipe", default=DEFAULT_RECIPE)
    parser.add_argument("--database", default=SOURCE_DATABASE)
    args = parser.parse_args()

    if recipe_exists(args.recipe):
        print(f"recipe {args.recipe} is already landed under {DATASET}; pass --recipe for a new one", file=sys.stderr)
        return 1
    tables = {"batches": read_batches(args.database), "load_facts": read_facts()}
    for name, frame in tables.items():
        print(f"read {name}: {len(frame):,} rows, {len(frame.columns)} columns")
    with tempfile.TemporaryDirectory() as scratch:
        paths = write_local(tables, scratch)
        landed = land(paths, args.recipe, source=f"{args.database} table timescaledb_load_batches (written 2026-09-12 by scripts/load_timescaledb.py) plus the constants of {NOTEBOOK}", dataset=DATASET)
    for name, detail in landed.items():
        print(f"  {name}: {detail['rows']:,} rows, {detail['bytes']:,} bytes, manifest {detail['manifest']}, {detail['uri']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
