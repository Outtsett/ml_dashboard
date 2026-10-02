"""Land the tables of the `candlestick-pattern-exemplars` study.

The notebook this replaced (notebooks/candlestick_pattern_exemplars.py) read two
tables from the standalone data/diagnostics.duckdb, which the dashboard's
in-memory DuckDB cannot attach. They are produced by
scripts/candlestick_pattern_exemplars.py (MNQ 1d bars, TA-Lib, the datalake's
talib_candlestick_rules.json). This build IMPORTS that script's own functions
(`load_rules`, `load_bars`, `build_exemplars`), so the numbers are the
notebook's, and lands them in the lake:

    derived/study_candlestick_pattern_exemplars/recipe=<recipe>/table=<name>/part-0.parquet
    meta/ingest_manifests/study_candlestick_pattern_exemplars.jsonl       one line per table

served by the dashboard as ``derived_study_candlestick_pattern_exemplars_<name>``:

    exemplars    one row per firing of each TA-Lib candlestick pattern (shape fractions, prior
                 trend stamped causally, archetype distance, prototypicality rank); the notebook's
                 candlestick_pattern_exemplars table, unchanged
    rules        one row per pattern (61): what TA-Lib's rule reads and whether it checks the
                 prior trend; the notebook's candlestick_pattern_rules table, unchanged
    daily_bars   the MNQ daily bars the firings were found on (open / high / low / close, labelled
                 absolute price, never inside a distance), so the page can draw each exemplar
                 with the bars before it; the notebook drew only fractions

Run once:  E:/source/repos/datalake/.venv/Scripts/python.exe packages/ml-engine/src/studies/candlestick_pattern_exemplars/build.py
It refuses to land a recipe that already exists (write-once). ``--dry-run`` computes and prints, landing
nothing; ``--compare-database`` also checks every column of the two notebook tables against
data/diagnostics.duckdb.
"""

from __future__ import annotations

import argparse
import importlib.util
import os
import sys
import tempfile
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT / "src" / "ml"))

from ta_strategy.store import (
    land,  # noqa: E402  the Model Cycle landing job, as the TA strategy rounds use it
)

DATASET = "study_candlestick_pattern_exemplars"
RECIPE = "mnq_1d_talib_exemplars_2026_09_30"
SCRIPT = ROOT / "scripts" / "candlestick_pattern_exemplars.py"
DIAGNOSTICS_DATABASE = ROOT / "data" / "diagnostics.duckdb"


def load_script():
    """The notebook's own builder, imported by path (scripts/ is not a package)."""
    specification = importlib.util.spec_from_file_location("candlestick_pattern_exemplars_script", SCRIPT)
    if specification is None or specification.loader is None:
        raise ImportError(f"cannot load {SCRIPT}")
    module = importlib.util.module_from_spec(specification)
    sys.modules[specification.name] = module
    specification.loader.exec_module(module)
    return module


def compute(symbol: str, timeframe: str, max_bars: int) -> dict[str, pd.DataFrame]:
    script = load_script()
    rules = script.load_rules()
    bars = script.load_bars(symbol, timeframe, max_bars)
    exemplars = script.build_exemplars(bars, rules)
    exemplars.insert(0, "symbol", symbol)
    exemplars.insert(1, "timeframe", timeframe)
    daily_bars = pd.DataFrame({
        "bar_timestamp": bars["bar_timestamp"],
        "absolute_open_price": bars["open"],
        "absolute_high_price": bars["high"],
        "absolute_low_price": bars["low"],
        "absolute_close_price": bars["close"],
        "volume": bars["volume"],
    })
    return {"exemplars": exemplars, "rules": rules, "daily_bars": daily_bars}


def compare_with_database(tables: dict[str, pd.DataFrame]) -> bool:
    """Every column of the two notebook tables against the diagnostics database, row for row."""
    import duckdb

    connection = duckdb.connect(str(DIAGNOSTICS_DATABASE), read_only=True)
    ok = True
    try:
        for name, table in (("exemplars", "candlestick_pattern_exemplars"), ("rules", "candlestick_pattern_rules")):
            stored = connection.execute(f"SELECT * FROM {table}").df()
            fresh = tables[name]
            keys = ["talib_function", "bar_timestamp"] if name == "exemplars" else ["talib_function"]
            for frame in (stored, fresh):
                if "bar_timestamp" in frame:
                    frame["bar_timestamp"] = pd.to_datetime(frame["bar_timestamp"], utc=True)
            stored = stored.sort_values(keys).reset_index(drop=True)
            fresh = fresh.sort_values(keys).reset_index(drop=True)
            if len(stored) != len(fresh):
                print(f"{name}: rows differ  stored {len(stored):,}  fresh {len(fresh):,}")
                ok = False
                continue
            differing = []
            for column in stored.columns:
                a, b = stored[column], fresh[column]
                if pd.api.types.is_float_dtype(a) or pd.api.types.is_float_dtype(b):
                    same = np.allclose(a.astype(float), b.astype(float), equal_nan=True, rtol=1e-12, atol=1e-12)
                else:
                    same = bool((a.astype(object).fillna("<null>").astype(str) == b.astype(object).fillna("<null>").astype(str)).all())
                if not same:
                    differing.append(column)
            print(f"{name}: {len(fresh):,} rows, columns differing from the notebook's table: {differing or 'none'}")
            ok = ok and not differing
    finally:
        connection.close()
    return ok


def already_landed() -> bool:
    from lake.layout import arrow_fs, arrow_key, derived_root
    from pyarrow.fs import FileType

    key = arrow_key(derived_root(DATASET, RECIPE))
    return arrow_fs().get_file_info(key).type != FileType.NotFound


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--symbol", default="MNQ")
    parser.add_argument("--timeframe", default="1d")
    parser.add_argument("--max-bars", type=int, default=5000)
    parser.add_argument("--dry-run", action="store_true", help="compute and print; land nothing")
    parser.add_argument("--compare-database", action="store_true", help="check the notebook tables against data/diagnostics.duckdb")
    arguments = parser.parse_args()

    tables = compute(arguments.symbol, arguments.timeframe, arguments.max_bars)
    for name, frame in tables.items():
        print(f"--- {name}: {len(frame):,} rows, {len(frame.columns)} columns")
    exemplars = tables["exemplars"]
    print(f"patterns that fired: {exemplars['talib_function'].nunique()} of {len(tables['rules'])}; "
          f"{exemplars['bar_timestamp'].min().date()} .. {exemplars['bar_timestamp'].max().date()}")
    if arguments.compare_database and not compare_with_database(tables):
        print("the fresh tables differ from the diagnostics database; nothing landed")
        return 2
    if arguments.dry_run:
        return 0
    if already_landed():
        print(f"recipe {RECIPE} of {DATASET} is already in the lake; refusing to overwrite it.")
        return 1
    with tempfile.TemporaryDirectory(prefix="study_candlestick_pattern_exemplars_") as directory:
        paths: dict[str, str] = {}
        for name, frame in tables.items():
            path = os.path.join(directory, f"{name}.parquet")
            frame.to_parquet(path, index=False)
            paths[name] = path
        result = land(
            paths, RECIPE,
            "scripts/candlestick_pattern_exemplars.py on MNQ 1d lake bars + datalake talib_candlestick_rules.json "
            "(study candlestick-pattern-exemplars build.py)",
            dataset=DATASET,
        )
    for name, info in result.items():
        print(f"{name}: {info['rows']:,} rows -> {info['uri']} (manifest {info['manifest']})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
