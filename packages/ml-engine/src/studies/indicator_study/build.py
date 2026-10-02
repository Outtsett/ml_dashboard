"""Land the MNQ indicator study in the lake, so the dashboard's indicator-study page can read it.

    E:/source/repos/datalake/.venv/Scripts/python.exe packages/ml-engine/src/studies/indicator_study/build.py

The study itself was computed on 2026-09-13 by the datalake repository's
``scripts/build_mnq_indicator_study.py`` (bootstrap intervals, circular-shift
nulls, walk-forward logistic regressions, pattern-condition consistency) and
written to a standalone DuckDB file, ``E:/lake-workspace/mnq_indicator_study.duckdb``,
which the dashboard cannot read. This script does not recompute any of it: it
copies each of the file's 27 tables unchanged, read-only, into
``s3://derived/study_indicator_study/recipe=<recipe>/table=<name>/`` with one
manifest line per table, so they are served as
``derived_study_indicator_study_<name>``.

Two further tables are computed here, exactly as the notebook
(datalake/notebooks/mnq_indicator_study.py) computes them in its cells:

``candle_thresholds``
    Per bar and timeframe, the candle anatomy and TA-Lib's CandleSettings
    thresholds (trailing averages over the bars BEFORE the one judged) that the
    notebook's pattern inspector shows, plus the independent re-implementation's
    verdict for the six patterns in ``candlestick_reference.REFERENCE``. Uses the
    datalake repository's own ``candlestick_reference`` module, as the notebook does.

``mnq_talib_4h_bars``
    The 4-hour TA-Lib bar set ``derived/mnq_talib_4h/recipe=talib_v1`` copied
    unchanged: it has no manifest line, so the dashboard serves no view over it
    (the 1-minute and 1-hour sets are served as ``derived_mnq_talib_1m`` / ``_1h``).

Refuses to run when the recipe is already in the manifest: a landed recipe is
never overwritten.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
import time
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[4]
DATALAKE = Path(os.environ.get("DATALAKE_REPOSITORY", r"E:\source\repos\datalake"))
sys.path.insert(0, str(ROOT / "src" / "ml"))
sys.path.insert(0, str(DATALAKE / "src"))
sys.path.insert(0, str(DATALAKE / "scripts"))

from candlestick_reference import REFERENCE, candle_average  # noqa: E402

DATASET = "study_indicator_study"
RECIPE = "mnq_2025q4_talib_v1"
STUDY_DATABASE = Path(os.environ.get("MNQ_INDICATOR_STUDY_DATABASE", r"E:\lake-workspace\mnq_indicator_study.duckdb"))
BAR_SETS = {"1m": "mnq_talib_1m", "1h": "mnq_talib_1h", "4h": "mnq_talib_4h"}
SOURCE = ("datalake scripts/build_mnq_indicator_study.py (2026-09-13) via E:/lake-workspace/mnq_indicator_study.duckdb; "
          "landed by ml_dashboard packages/ml-engine/src/studies/indicator_study/build.py")

THRESHOLD_SETTINGS = {
    "body_long_or_short_threshold": "BodyLong",
    "body_doji_threshold": "BodyDoji",
    "shadow_very_short_threshold": "ShadowVeryShort",
    "shadow_short_threshold": "ShadowShort",
    "near_threshold": "Near",
}


def study_tables(connection: duckdb.DuckDBPyConnection) -> list[str]:
    return [row[0] for row in connection.execute(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'main' ORDER BY table_name").fetchall()]


def bar_frame(timeframe: str, attempts: int = 8) -> pd.DataFrame:
    """Every bar of one timeframe, read as the notebook reads it (``bars_frame``).
    A read that fails to connect to the object store is retried: under load the
    machine runs out of loopback ports for a minute at a time."""
    from lake.catalog import duckdb_connect

    for attempt in range(attempts):
        connection = duckdb_connect(duckdb.connect())
        connection.execute("SET TimeZone = 'UTC'")
        try:
            frame = connection.execute(f"""
                SELECT * EXCLUDE (year, month)
                FROM read_parquet('s3://derived/{BAR_SETS[timeframe]}/recipe=talib_v1/**/*.parquet', hive_partitioning = true)
                ORDER BY "timestamp"
            """).df()
            break
        except duckdb.IOException:
            if attempt == attempts - 1:
                raise
            time.sleep(30)
        finally:
            connection.close()
    frame.insert(0, "bar_index", np.arange(len(frame), dtype=np.int64))
    return frame


def candle_thresholds(timeframe: str, frame: pd.DataFrame, pattern_columns: dict[str, str]) -> pd.DataFrame:
    """The pattern inspector's anatomy, thresholds and independent verdicts (notebook cell at line 505)."""
    open_, high, low, close = (frame[name].to_numpy(dtype=np.float64) for name in ("open", "high", "low", "close"))
    out = pd.DataFrame({
        "timeframe": timeframe,
        "timestamp": frame["timestamp"],
        "bar_index": frame["bar_index"],
        "real_body": np.abs(close - open_),
        "upper_shadow": high - np.maximum(open_, close),
        "lower_shadow": np.minimum(open_, close) - low,
        "high_low_range": high - low,
    })
    for column, setting in THRESHOLD_SETTINGS.items():
        out[column] = candle_average(setting, open_, high, low, close)
    for function, implementation in REFERENCE.items():
        column = pattern_columns.get(function)
        if column is None:
            continue
        out[f"independent_reimplementation_{column}"] = implementation(open_, high, low, close).astype(np.float64)
    return out


def manifest_has_recipe() -> bool:
    from lake.layout import INGEST_MANIFESTS, arrow_fs, arrow_key
    from pyarrow import fs

    key = arrow_key(INGEST_MANIFESTS / f"{DATASET}.jsonl")
    filesystem = arrow_fs()
    if filesystem.get_file_info(key).type == fs.FileType.NotFound:
        return False
    with filesystem.open_input_stream(key) as source:
        text = source.read().decode("utf-8")
    for line in text.splitlines():
        try:
            if json.loads(line).get("recipe") == RECIPE:
                return True
        except ValueError:
            continue
    return False


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dry-run", action="store_true", help="write the parquet files locally and stop before landing")
    arguments = parser.parse_args()

    if not arguments.dry_run and manifest_has_recipe():
        print(f"refusing: recipe {RECIPE} of {DATASET} is already landed", file=sys.stderr)
        return 2

    from cycle.store import _land_job

    directory = Path(tempfile.mkdtemp(prefix="indicator_study_"))
    paths: dict[str, str] = {}
    source = duckdb.connect(str(STUDY_DATABASE), read_only=True)
    source.execute("SET TimeZone = 'UTC'")
    try:
        for name in study_tables(source):
            path = directory / f"{name}.parquet"
            source.execute(f"COPY (SELECT * FROM \"{name}\") TO '{path.as_posix()}' (FORMAT parquet, COMPRESSION zstd)")
            paths[name] = str(path)
        pattern_columns = dict(source.execute(
            "SELECT DISTINCT talib_function, column_name FROM indicator_catalogue "
            "WHERE feature_kind = 'candlestick_pattern'").fetchall())
    finally:
        source.close()

    thresholds = []
    for timeframe in BAR_SETS:
        frame = bar_frame(timeframe)
        thresholds.append(candle_thresholds(timeframe, frame, pattern_columns))
        if timeframe == "4h":
            bars_path = directory / "mnq_talib_4h_bars.parquet"
            frame.drop(columns=["bar_index"]).to_parquet(bars_path, index=False)
            paths["mnq_talib_4h_bars"] = str(bars_path)
    thresholds_path = directory / "candle_thresholds.parquet"
    pd.concat(thresholds, ignore_index=True).to_parquet(thresholds_path, index=False)
    paths["candle_thresholds"] = str(thresholds_path)

    print(f"{len(paths)} tables written to {directory}")
    if arguments.dry_run:
        return 0
    result = _land_job({"dataset": DATASET, "recipe": RECIPE, "tables": paths, "manifest_for": list(paths), "source": SOURCE})
    for name, info in sorted(result.items()):
        print(f"{name}: {info['rows']} rows, manifest {info['manifest']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
