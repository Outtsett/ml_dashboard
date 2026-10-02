r"""Land the process census snapshots in the lake so the dashboard can read them.

The notebook ``notebooks/process_census.py`` read ``data/diagnostics.duckdb``,
table ``process_census`` (one row per process per snapshot, written by
``scripts/process_census.py``). The dashboard's DuckDB has no ATTACH, so this
job copies every snapshot in that table, read-only, and lands it:

    s3://derived/study_process_census/recipe=<recipe>/table=process_census/

Columns are the notebook's own, unchanged (``snapshot_timestamp`` is local wall
clock, exactly as the collector stamped it). The recipe names the newest
snapshot it holds (``snapshots_2026_09_22_1659``), so landing the same table
twice is refused and landing after a new snapshot is a new recipe; the page
reads the newest recipe and offers every snapshot inside it.

``--take-snapshot`` first runs the notebook's own collector
(``scripts/process_census.py``, the "Take a new snapshot" button) so the new
snapshot is in the table before it is landed. Without it the table is landed
as it is.

Run with the datalake interpreter (it carries ``lake``, pandas, pyarrow and
psutil):

    E:/source/repos/datalake/.venv/Scripts/python.exe packages/ml-engine/src/studies/process_census/build.py
"""

from __future__ import annotations

import argparse
import importlib.util
import os
import pathlib
import sys
import tempfile

import duckdb
import pandas as pd

ML_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, ML_ROOT)

from ta_strategy.store import land, write_local  # noqa: E402

DATASET = "study_process_census"
TABLE = "process_census"
REPOSITORY_ROOT = pathlib.Path(__file__).resolve().parents[4]
SOURCE_DATABASE = REPOSITORY_ROOT / "data" / "diagnostics.duckdb"
COLLECTOR_SCRIPT = REPOSITORY_ROOT / "scripts" / "process_census.py"


def take_snapshot(database: pathlib.Path) -> int:
    """Run the notebook's collector (its button) and append one snapshot to the database."""
    spec = importlib.util.spec_from_file_location("process_census_collector", COLLECTOR_SCRIPT)
    collector = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(collector)
    rows = collector.collect_snapshot()
    collector.write_snapshot(rows, database)
    return len(rows)


def read_snapshots(database: pathlib.Path) -> pd.DataFrame:
    # Short-lived read-only connection: the collector needs the single writer slot.
    connection = duckdb.connect(str(database), read_only=True)
    try:
        return connection.execute(
            f"SELECT * FROM {TABLE} ORDER BY snapshot_timestamp, process_identifier"
        ).fetchdf()
    finally:
        connection.close()


def recipe_exists(recipe: str) -> bool:
    from lake.layout import arrow_fs, arrow_key, derived_root

    key = arrow_key(derived_root(DATASET, recipe) / f"table={TABLE}" / "part-0.parquet")
    return arrow_fs().get_file_info(key).type.name != "NotFound"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--recipe", default="")
    parser.add_argument("--database", default=str(SOURCE_DATABASE))
    parser.add_argument("--take-snapshot", action="store_true", help="run the collector first (appends one snapshot)")
    args = parser.parse_args()
    database = pathlib.Path(args.database)

    if args.take_snapshot:
        print(f"collected a new snapshot: {take_snapshot(database):,} processes")
    frame = read_snapshots(database)
    if frame.empty:
        print(f"{database} holds no process_census rows; nothing to land", file=sys.stderr)
        return 1
    snapshots = frame["snapshot_timestamp"].nunique()
    newest = frame["snapshot_timestamp"].max()
    recipe = args.recipe or f"snapshots_{newest:%Y_%m_%d_%H%M}"
    print(f"read {TABLE}: {len(frame):,} rows, {snapshots} snapshots, newest {newest:%Y-%m-%d %H:%M:%S}")

    if recipe_exists(recipe):
        print(f"recipe {recipe} is already landed under {DATASET}; pass --recipe for a new one", file=sys.stderr)
        return 1
    with tempfile.TemporaryDirectory() as scratch:
        paths = write_local({TABLE: frame}, scratch)
        landed = land(paths, recipe, source=f"{database} (table {TABLE})", dataset=DATASET)
    for name, detail in landed.items():
        print(f"  {name}: {detail['rows']:,} rows, {detail['bytes']:,} bytes, manifest {detail['manifest']}, {detail['uri']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
