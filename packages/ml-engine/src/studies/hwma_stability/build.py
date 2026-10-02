r"""Land the Holt-Winters moving-average stability measurement in the lake.

The notebook ``notebooks/hwma_stability.py`` read three tables from
``E:\lake-workspace\hwma_stability.duckdb``, written by
``scripts/hwma_stability.py`` on 2026-09-15:

    hwma_parameter_grid    6,859 rows, one per (na, nb, nc) on 0.05..0.95 step 0.05
    hwma_price_series      the 2,000 MNQH6 one-minute closes every run was measured on
    hwma_run_information   one row: what was measured, when, the defaults

A standalone ``.duckdb`` is unreadable from the dashboard (its DuckDB has no
ATTACH), so this job copies the three tables as they are, read-only, and lands:

    s3://derived/study_hwma_stability/recipe=<recipe>/table=grid/
    s3://derived/study_hwma_stability/recipe=<recipe>/table=price_series/
    s3://derived/study_hwma_stability/recipe=<recipe>/table=run_information/

The dashboard serves them as ``derived_study_hwma_stability_grid``,
``..._price_series`` and ``..._run_information`` once the manifest lines land
(``POST /api/labels/catalog/refresh`` or the next boot).

An existing recipe is never overwritten: a second run refuses unless given a
new ``--recipe`` (re-measuring, for example on other closes, is a new recipe).

Run with the datalake interpreter (it carries ``lake``, pandas and pyarrow):

    E:/source/repos/datalake/.venv/Scripts/python.exe packages/ml-engine/src/studies/hwma_stability/build.py
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

DATASET = "study_hwma_stability"
DEFAULT_RECIPE = "measured_2026_09_15"
SOURCE_DATABASE = r"E:\lake-workspace\hwma_stability.duckdb"

#: landed table name -> the notebook's source table
SOURCE_TABLES = {
    "grid": "hwma_parameter_grid",
    "price_series": "hwma_price_series",
    "run_information": "hwma_run_information",
}


def read_tables(database: str) -> dict[str, pd.DataFrame]:
    connection = duckdb.connect(database, read_only=True)
    try:
        # Timestamps are read as UTC instants so the parquet holds exactly what the source held.
        connection.execute("SET TimeZone = 'UTC'")
        orderings = {"grid": "na, nb, nc", "price_series": "bar_index", "run_information": "generated_at"}
        return {
            name: connection.execute(f"SELECT * FROM {source} ORDER BY {orderings[name]}").fetchdf()
            for name, source in SOURCE_TABLES.items()
        }
    finally:
        connection.close()


def recipe_exists(recipe: str) -> bool:
    from lake.layout import arrow_fs, arrow_key, derived_root

    key = arrow_key(derived_root(DATASET, recipe) / "table=grid" / "part-0.parquet")
    return arrow_fs().get_file_info(key).type.name != "NotFound"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--recipe", default=DEFAULT_RECIPE)
    parser.add_argument("--database", default=SOURCE_DATABASE)
    args = parser.parse_args()

    if recipe_exists(args.recipe):
        print(f"recipe {args.recipe} is already landed under {DATASET}; pass --recipe for a new one", file=sys.stderr)
        return 1
    tables = read_tables(args.database)
    for name, frame in tables.items():
        print(f"read {name}: {len(frame):,} rows, {len(frame.columns)} columns")
    with tempfile.TemporaryDirectory() as scratch:
        paths = write_local(tables, scratch)
        landed = land(paths, args.recipe, source=f"{args.database} (tables {', '.join(SOURCE_TABLES.values())}, built 2026-09-15 by scripts/hwma_stability.py)", dataset=DATASET)
    for name, detail in landed.items():
        print(f"  {name}: {detail['rows']:,} rows, {detail['bytes']:,} bytes, manifest {detail['manifest']}, {detail['uri']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
