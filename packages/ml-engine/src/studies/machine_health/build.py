r"""Land the machine-diagnostics tables in the lake so the dashboard can read them.

The notebook ``dotfiles/diagnostics/notebooks/machine_health.py`` read
``E:\lake-workspace\machine_diagnostics.duckdb``, a standalone file the crash
indexer (a dotfiles scheduled task) writes. The dashboard's DuckDB has no
ATTACH, so this job copies the tables the notebook reads, read-only, and
lands them:

    s3://derived/study_machine_health/recipe=<recipe>/table=<name>/

Tables (the notebook's own columns, every row):

    crash_event_with_dump   the notebook's ``crash_event_with_dump`` view: one row per crash, hang,
                            bugcheck, reset or error report, joined to its dump file, with two added
                            columns: ``event_timestamp`` is UTC (naive) and ``event_local_timestamp``
                            is the same instant in America/Los_Angeles wall clock (the notebook's
                            ``event_local_time``, converted here exactly as it did)
    dump_file               one row per dump file on disk
    process_snapshot        one row per process per snapshot label
    memory_snapshot         one row per snapshot label (machine totals)
    startup_snapshot        login items per snapshot label
    configuration_change    each setting changed, with its exact revert command
    index_run               when the indexer ran and what it added

The dashboard serves them as ``derived_study_machine_health_<table>`` once the
manifest lines land (``POST /api/labels/catalog/refresh`` or the next boot).

An existing recipe is never overwritten: a second run refuses unless given a
new ``--recipe`` (re-running the indexer and landing again is a new recipe; the
page reads the newest recipe).

Run with the datalake interpreter (it carries ``lake``, pandas and pyarrow):

    E:/source/repos/datalake/.venv/Scripts/python.exe packages/ml-engine/src/studies/machine_health/build.py
"""

from __future__ import annotations

import argparse
import datetime
import os
import sys
import tempfile

import duckdb
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from ta_strategy.store import land, write_local  # noqa: E402

DATASET = "study_machine_health"
SOURCE_DATABASE = r"E:\lake-workspace\machine_diagnostics.duckdb"
LOCAL_ZONE = "America/Los_Angeles"  # the notebook's LOCAL_ZONE

# Source table -> landed table. The event table is the notebook's view, not crash_event.
COPIED_TABLES = {
    "dump_file": "dump_file",
    "process_snapshot": "process_snapshot",
    "memory_snapshot": "memory_snapshot",
    "startup_snapshot": "startup_snapshot",
    "configuration_change": "configuration_change",
    "index_run": "index_run",
}


def read_events(connection: duckdb.DuckDBPyConnection) -> pd.DataFrame:
    """The notebook's ``crash_event_with_dump`` with its local-time column, converted as it did."""
    events = connection.execute("SELECT * FROM crash_event_with_dump ORDER BY event_timestamp, event_record_identifier").fetchdf()
    instants = pd.to_datetime(events["event_timestamp"], utc=True)
    events["event_timestamp"] = instants.dt.tz_localize(None)
    events["event_local_timestamp"] = instants.dt.tz_convert(LOCAL_ZONE).dt.tz_localize(None)
    events["event_data_json"] = events["event_data_json"].astype("string")
    return events


def recipe_exists(recipe: str) -> bool:
    from lake.layout import arrow_fs, arrow_key, derived_root

    key = arrow_key(derived_root(DATASET, recipe) / "table=crash_event_with_dump" / "part-0.parquet")
    return arrow_fs().get_file_info(key).type.name != "NotFound"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--recipe", default=f"indexed_{datetime.date.today():%Y_%m_%d}")
    parser.add_argument("--database", default=SOURCE_DATABASE)
    args = parser.parse_args()

    if recipe_exists(args.recipe):
        print(f"recipe {args.recipe} is already landed under {DATASET}; pass --recipe for a new one", file=sys.stderr)
        return 1
    # Short-lived read-only connection: the indexer task needs the single writer slot.
    connection = duckdb.connect(args.database, read_only=True)
    try:
        tables = {"crash_event_with_dump": read_events(connection)}
        for source, landed in COPIED_TABLES.items():
            tables[landed] = connection.execute(f'SELECT * FROM "{source}"').fetchdf()
    finally:
        connection.close()
    for name, frame in tables.items():
        print(f"read {name}: {len(frame):,} rows, {len(frame.columns)} columns")
    with tempfile.TemporaryDirectory() as scratch:
        paths = write_local(tables, scratch)
        landed = land(paths, args.recipe, source=f"{args.database} (tables {', '.join(tables)})", dataset=DATASET)
    for name, detail in landed.items():
        print(f"  {name}: {detail['rows']:,} rows, {detail['bytes']:,} bytes, manifest {detail['manifest']}, {detail['uri']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
