"""Land the findings casebook in the lake for the `pattern-casebook` study.

The notebook this replaced (datalake/notebooks/findings_casebook.py) read a
standalone DuckDB file, ``E:\\lake-workspace\\findings_casebook.duckdb``, that
datalake's ``scripts/build_findings_casebook.py`` wrote on 2026-09-15 (TA-Lib
pattern firings on MNQ 2021-2025 as dated trades, the "last move" rules, the
recent-findings list). The dashboard cannot read that file, so this copies its
tables, read-only and unchanged except as noted, into

    derived/study_pattern_casebook/recipe=findings_casebook_2026_09_15/table=<name>/part-0.parquet
    meta/ingest_manifests/study_pattern_casebook.jsonl        one line per table

served by the dashboard as ``derived_study_pattern_casebook_<name>``:

    run_information          1 row: the cost, tick size and trade rule the build used (was findings_casebook_run_information)
    recent_findings          22 rows: the dated findings restated in trader units
    pattern_side_dollars     8,053 rows: per pattern side, year and exit candle, net dollars per trade, totals, random-bar band
    last_move_rules          60 rows: repeat / fade the last close-to-close move, per timeframe and period
    pattern_firing_trades    4,363,499 rows: every firing as one trade; the six net_dollars_candle_k columns are
                             left out because they bake in the build's cost (5.6022 ticks): the page prices the
                             stored gross ticks at the cost it is shown

``last_candle_persistence`` is not landed: the notebook never read it.

``--check-rebuild`` instead recomputes the tables with the builder's own
functions (datalake scripts/build_findings_casebook.py, which reads the lake's
derived/mnq_next_candles_* datasets) and reports how far they are from the
file, landing nothing.

Run once:  E:/source/repos/datalake/.venv/Scripts/python.exe packages/ml-engine/src/studies/pattern_casebook/build.py
It refuses to land a recipe that already exists (write-once).
"""

from __future__ import annotations

import argparse
import os
import sys
import tempfile
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT / "src" / "ml"))

from ta_strategy.store import (
    land,  # noqa: E402  the Model Cycle landing job, as the TA strategy rounds use it
)

DATALAKE = Path(os.environ.get("DATALAKE_REPOSITORY", r"E:\source\repos\datalake"))
CASEBOOK = Path(os.environ.get("FINDINGS_CASEBOOK_DATABASE", r"E:\lake-workspace\findings_casebook.duckdb"))
DATASET = "study_pattern_casebook"
RECIPE = "findings_casebook_2026_09_15"
HORIZON = 6

#: table name in the lake -> the SELECT that reads it from the casebook file
TABLES = {
    "run_information": "SELECT * FROM findings_casebook_run_information",
    "recent_findings": "SELECT * FROM recent_findings ORDER BY finding_date DESC, repository",
    "pattern_side_dollars": "SELECT * FROM pattern_side_dollars ORDER BY timeframe, pattern, side, calendar_year, candle",
    "last_move_rules": "SELECT * FROM last_move_rules ORDER BY timeframe, rule, period",
    "pattern_firing_trades": (
        "SELECT * EXCLUDE ({net}) FROM pattern_firing_trades "
        "ORDER BY timeframe, pattern, side, calendar_year, bar_timestamp"
    ).format(net=", ".join(f"net_dollars_candle_{k}" for k in range(1, HORIZON + 1))),
}


def already_landed() -> bool:
    from lake.layout import arrow_fs, arrow_key, derived_root
    from pyarrow.fs import FileType

    key = arrow_key(derived_root(DATASET, RECIPE))
    return arrow_fs().get_file_info(key).type != FileType.NotFound


def export(directory: str) -> dict[str, str]:
    """Each table to a local parquet file, read from the casebook file opened read-only."""
    connection = duckdb.connect(str(CASEBOOK), read_only=True)
    connection.execute("SET TimeZone = 'UTC'")
    paths: dict[str, str] = {}
    try:
        for name, select in TABLES.items():
            path = os.path.join(directory, f"{name}.parquet").replace("\\", "/")
            connection.execute(f"COPY ({select}) TO '{path}' (FORMAT PARQUET, COMPRESSION ZSTD)")
            paths[name] = path
            print(f"exported {name}")
    finally:
        connection.close()
    return paths


def check_rebuild() -> int:
    """Recompute with the builder's own functions and compare with the file (lands nothing)."""
    import numpy as np
    import polars as pl

    sys.path.insert(0, str(DATALAKE / "src"))
    sys.path.insert(0, str(DATALAKE / "scripts"))
    import build_findings_casebook as casebook  # the datalake builder
    import build_mnq_next_candles as next_candles

    cost, tick_size, model = next_candles.cost_ticks()
    tick_value = float(model["tick_value"])
    rng = np.random.default_rng(casebook.SEED)
    side_rows, rule_rows, trade_counts = [], [], {}
    for timeframe in next_candles.TIMEFRAMES:
        frame = next_candles.load(timeframe)
        trades = casebook.firing_trades(frame, timeframe, cost, tick_size, tick_value)
        trade_counts[timeframe] = trades.height
        side_rows += casebook.side_dollars(frame, trades, timeframe, cost, tick_size, tick_value, rng)
        rule_rows += casebook.last_move_rules(frame, timeframe, cost, tick_size, tick_value)
    sides, rules = pl.DataFrame(side_rows), pl.DataFrame(rule_rows)
    connection = duckdb.connect(str(CASEBOOK), read_only=True)
    try:
        stored_sides = pl.from_arrow(connection.execute("SELECT * FROM pattern_side_dollars").to_arrow_table())
        stored_rules = pl.from_arrow(connection.execute("SELECT * FROM last_move_rules").to_arrow_table())
        stored_counts = dict(connection.execute(
            "SELECT timeframe, count(*) FROM pattern_firing_trades GROUP BY timeframe").fetchall())
    finally:
        connection.close()
    print(f"cost {cost} ticks; trades per timeframe rebuilt {trade_counts} stored {stored_counts}")
    keys = ["timeframe", "pattern", "side", "calendar_year", "candle"]
    joined = sides.join(stored_sides, on=keys, suffix="_stored")
    print(f"pattern_side_dollars rows rebuilt {sides.height} stored {stored_sides.height} matched {joined.height}")
    for column in ("net_dollars_per_trade_mean", "total_net_dollars", "random_bars_total_net_dollars_percentile_5"):
        print(f"  largest |difference| in {column}: {(joined[column] - joined[f'{column}_stored']).abs().max()}")
    joined_rules = rules.join(stored_rules, on=["timeframe", "rule", "period"], suffix="_stored")
    print(f"last_move_rules rows rebuilt {rules.height} stored {stored_rules.height} matched {joined_rules.height}; "
          f"largest |difference| in gross_ticks_per_trade "
          f"{(joined_rules['gross_ticks_per_trade'] - joined_rules['gross_ticks_per_trade_stored']).abs().max()}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--check-rebuild", action="store_true",
                        help="recompute with the datalake builder and compare with the file; land nothing")
    arguments = parser.parse_args()
    if arguments.check_rebuild:
        return check_rebuild()
    if not CASEBOOK.exists():
        print(f"{CASEBOOK} does not exist: run datalake scripts/build_findings_casebook.py first.")
        return 1
    if already_landed():
        print(f"recipe {RECIPE} of {DATASET} is already in the lake; refusing to overwrite it.")
        return 1
    with tempfile.TemporaryDirectory(prefix="study_pattern_casebook_") as directory:
        paths = export(directory)
        result = land(paths, RECIPE, f"{CASEBOOK} (datalake scripts/build_findings_casebook.py, built 2026-09-15)",
                      dataset=DATASET)
    for name, info in result.items():
        print(f"{name}: {info['rows']:,} rows -> {info['uri']} (manifest {info['manifest']})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
