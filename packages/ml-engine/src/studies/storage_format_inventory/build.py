r"""Land the storage-format inventory in the lake so the dashboard can read it.

The notebook ``datalake/notebooks/data_format_inventory.py`` read one table,
``data_format_inventory`` in ``E:\lake-workspace\data_format_inventory.duckdb``:
one row per file measured on 2026-09-11 under ``E:\lake\warehouse`` (the
AIStor buckets) and the data-bearing directories of ``E:\source\repos``. A
standalone ``.duckdb`` is unreadable from the dashboard (its DuckDB has no
ATTACH), so this job copies the table as it is, read-only, and lands it:

    s3://derived/study_storage_format_inventory/recipe=<recipe>/table=files/
    s3://derived/study_storage_format_inventory/recipe=<recipe>/table=measurement/

``files`` is the notebook's own nine columns, every row; ``measurement`` is one
row saying what was measured, when and from where. The dashboard serves them as
``derived_study_storage_format_inventory_files`` and
``derived_study_storage_format_inventory_measurement`` once the manifest lines
land (``POST /api/labels/catalog/refresh`` or the next boot).

An existing recipe is never overwritten: a second run refuses unless given a
new ``--recipe`` (a re-measurement of the directories is a new recipe).

Run with the datalake interpreter (it carries ``lake``, pandas and pyarrow):

    E:/source/repos/datalake/.venv/Scripts/python.exe packages/ml-engine/src/studies/storage_format_inventory/build.py
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

DATASET = "study_storage_format_inventory"
DEFAULT_RECIPE = "measured_2026_09_11"
SOURCE_DATABASE = r"E:\lake-workspace\data_format_inventory.duckdb"
MEASURED_ROOTS = r"E:\lake\warehouse; E:\source\repos"

FILE_COLUMNS = """store_name, zone_name, file_path, file_extension, file_bytes, file_gibibytes,
                  modified_timestamp, format_family, is_parquet"""


def read_inventory(database: str) -> pd.DataFrame:
    connection = duckdb.connect(database, read_only=True)
    try:
        return connection.execute(f"SELECT {FILE_COLUMNS} FROM data_format_inventory").fetchdf()
    finally:
        connection.close()


def measurement_row(files: pd.DataFrame, database: str, measured_on: str) -> pd.DataFrame:
    return pd.DataFrame([{
        "measured_on_date": measured_on,
        "source_database": database,
        "source_table": "data_format_inventory",
        "measured_roots": MEASURED_ROOTS,
        "file_count": int(len(files)),
        "total_file_bytes": int(files["file_bytes"].sum()),
        "zone_count": int(files["zone_name"].nunique()),
        "store_names": ", ".join(sorted(files["store_name"].dropna().unique())),
        "format_family_count": int(files["format_family"].nunique()),
        "earliest_modified_timestamp": files["modified_timestamp"].min(),
        "latest_modified_timestamp": files["modified_timestamp"].max(),
    }])


def recipe_exists(recipe: str) -> bool:
    from lake.layout import arrow_fs, arrow_key, derived_root

    key = arrow_key(derived_root(DATASET, recipe) / "table=files" / "part-0.parquet")
    return arrow_fs().get_file_info(key).type.name != "NotFound"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--recipe", default=DEFAULT_RECIPE)
    parser.add_argument("--database", default=SOURCE_DATABASE)
    parser.add_argument("--measured-on", default="2026-09-11", help="the day the files were measured")
    args = parser.parse_args()

    if recipe_exists(args.recipe):
        print(f"recipe {args.recipe} is already landed under {DATASET}; pass --recipe for a new one", file=sys.stderr)
        return 1
    files = read_inventory(args.database)
    measurement = measurement_row(files, args.database, args.measured_on)
    print(f"read {len(files):,} files, {files['file_bytes'].sum() / 1024**3:,.3f} GiB, {files['zone_name'].nunique()} zones")
    with tempfile.TemporaryDirectory() as scratch:
        paths = write_local({"files": files, "measurement": measurement}, scratch)
        landed = land(paths, args.recipe, source=f"{args.database} (table data_format_inventory, measured {args.measured_on})", dataset=DATASET)
    for name, detail in landed.items():
        print(f"  {name}: {detail['rows']:,} rows, {detail['bytes']:,} bytes, manifest {detail['manifest']}, {detail['uri']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
