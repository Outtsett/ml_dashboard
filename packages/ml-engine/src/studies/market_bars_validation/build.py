r"""Land the market_bars column validation record in the lake so the dashboard can read it.

The notebook ``datalake/notebooks/market_bars_columns.py`` read one table,
``market_bars_column_checks`` in ``E:\lake-workspace\workspace.duckdb``: every
check ``scripts/validate_market_bars_columns.py`` compared between the Iceberg
``market.bars`` table and the PostgreSQL / TimescaleDB ``market_bars`` copy.
A standalone ``.duckdb`` is unreadable from the dashboard (its DuckDB has no
ATTACH), so this job copies the table whole, read-only (every run of every
tier, so "the most recent result per check" stays a query), and lands it:

    s3://derived/study_market_bars_validation/recipe=<recipe>/table=checks/
    s3://derived/study_market_bars_validation/recipe=<recipe>/table=measurement/
    s3://derived/study_market_bars_validation/recipe=<recipe>/table=table_columns/

``checks`` is the notebook's own seven columns (``recorded_at`` spelled out as
``recorded_timestamp``); ``measurement`` is one row saying what the record is
about, including the lake row count the notebook hard-coded (785,766,203) as
data, cross-checked here against the sum of the exact tier's per-slice row
counts; ``table_columns`` is the 24 real columns of ``market_bars`` in order
(the invariant tier stores rule names in ``column_name``, so the real columns
cannot be read off the checks), cross-checked against the schema tier. The
dashboard serves them as ``derived_study_market_bars_validation_checks``,
``..._measurement`` and ``..._table_columns`` once the manifest lines land
(``POST /api/labels/catalog/refresh`` or the next boot).

An existing recipe is never overwritten: a second run refuses unless given a
new ``--recipe`` (a fresh validation run is a new recipe).

Run with the datalake interpreter (it carries ``lake``, pandas and pyarrow):

    E:/source/repos/datalake/.venv/Scripts/python.exe packages/ml-engine/src/studies/market_bars_validation/build.py
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

DATASET = "study_market_bars_validation"
DEFAULT_RECIPE = "recorded_2026_09_12"
SOURCE_DATABASE = r"E:\lake-workspace\workspace.duckdb"
SOURCE_TABLE = "market_bars_column_checks"
VALIDATOR_SCRIPT = r"E:\source\repos\datalake\scripts\validate_market_bars_columns.py"

#: The notebook's LAKE_ROWS (market_bars_columns.py:41), Iceberg market.bars at validation time.
NOTEBOOK_LAKE_ROWS = 785_766_203

#: The 24 real columns of market_bars, in table order (market_bars_columns.py:46-52).
TABLE_COLUMNS = [
    "timestamp", "symbol", "timeframe", "asset_class", "root",
    "open", "high", "low", "close", "volume", "trade_count",
    "volume_at_bid", "volume_at_ask", "trade_count_at_bid", "trade_count_at_ask",
    "bid_open", "bid_high", "bid_low", "bid_close",
    "ask_open", "ask_high", "ask_low", "ask_close", "vendor",
]


def read_checks(database: str) -> pd.DataFrame:
    connection = duckdb.connect(database, read_only=True)
    try:
        return connection.execute(
            f"""SELECT recorded_at AS recorded_timestamp, tier, column_name, check_name,
                       lake_value, postgres_value, matched
                FROM {SOURCE_TABLE} ORDER BY recorded_at, tier, column_name, check_name"""
        ).fetchdf()
    finally:
        connection.close()


def slice_row_total(checks: pd.DataFrame) -> int:
    """Sum of the exact tier's per-slice row counts: how many rows the validation actually saw."""
    rows = checks[(checks["tier"] == "exact") & (checks["column_name"] == "*") & checks["check_name"].str.startswith("row_count [")]
    latest = rows.sort_values("recorded_timestamp").groupby("check_name").tail(1)
    return int(latest["lake_value"].astype("int64").sum())


def schema_columns(checks: pd.DataFrame) -> set[str]:
    rows = checks[(checks["tier"] == "schema") & (checks["check_name"] == "type")]
    return set(rows["column_name"])


def measurement_row(checks: pd.DataFrame, lake_row_count: int, database: str) -> pd.DataFrame:
    latest = checks.sort_values("recorded_timestamp").groupby(["tier", "column_name", "check_name"]).tail(1)
    return pd.DataFrame([{
        "lake_row_count": lake_row_count,
        "lake_row_count_source": "sum of the exact tier's per-slice row_count checks (equals the notebook's hard-coded LAKE_ROWS)",
        "comparison_target": "PostgreSQL / TimescaleDB market_bars hypertable",
        "source_database": database,
        "source_table": SOURCE_TABLE,
        "validator_script": VALIDATOR_SCRIPT,
        "recorded_check_count": int(len(checks)),
        "latest_check_count": int(len(latest)),
        "failed_latest_check_count": int((~latest["matched"].astype(bool)).sum()),
        "tier_count": int(checks["tier"].nunique()),
        "table_column_count": len(TABLE_COLUMNS),
        "first_recorded_timestamp": checks["recorded_timestamp"].min(),
        "last_recorded_timestamp": checks["recorded_timestamp"].max(),
    }])


def recipe_exists(recipe: str) -> bool:
    from lake.layout import arrow_fs, arrow_key, derived_root

    key = arrow_key(derived_root(DATASET, recipe) / "table=checks" / "part-0.parquet")
    return arrow_fs().get_file_info(key).type.name != "NotFound"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--recipe", default=DEFAULT_RECIPE)
    parser.add_argument("--database", default=SOURCE_DATABASE)
    args = parser.parse_args()

    if recipe_exists(args.recipe):
        print(f"recipe {args.recipe} is already landed under {DATASET}; pass --recipe for a new one", file=sys.stderr)
        return 1
    checks = read_checks(args.database)
    total = slice_row_total(checks)
    if total != NOTEBOOK_LAKE_ROWS:
        print(f"slice row counts sum to {total:,}, the notebook says {NOTEBOOK_LAKE_ROWS:,}; refusing to land", file=sys.stderr)
        return 1
    if schema_columns(checks) != set(TABLE_COLUMNS):
        print("the schema tier's columns differ from the notebook's 24; refusing to land", file=sys.stderr)
        return 1
    measurement = measurement_row(checks, total, args.database)
    table_columns = pd.DataFrame({"column_position": range(1, len(TABLE_COLUMNS) + 1), "column_name": TABLE_COLUMNS})
    print(f"read {len(checks):,} checks over {checks['tier'].nunique()} tiers; lake rows {total:,}")
    with tempfile.TemporaryDirectory() as scratch:
        paths = write_local({"checks": checks, "measurement": measurement, "table_columns": table_columns}, scratch)
        landed = land(paths, args.recipe, source=f"{args.database} (table {SOURCE_TABLE}, validation of 2026-09-12)", dataset=DATASET)
    for name, detail in landed.items():
        print(f"  {name}: {detail['rows']:,} rows, {detail['bytes']:,} bytes, manifest {detail['manifest']}, {detail['uri']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
