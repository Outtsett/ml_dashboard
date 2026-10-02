r"""Land the TA-Lib indicator catalogue in the lake, so the dashboard's catalogue page can read it.

    E:/source/repos/datalake/.venv/Scripts/python.exe packages/ml-engine/src/studies/talib_indicator_catalogue/build.py

The notebook ``datalake/notebooks/mnq_talib_1m.py`` read one table, ``mnq_talib_1m_column_statistics``, from
a standalone DuckDB file (``E:/lake-workspace/workspace.duckdb``) that the dashboard cannot read and that no
script in any repository produces. This job reproduces that table from the data it describes, read-only:
the three TA-Lib bar sets ``derived/mnq_talib_{1m,1h,4h}/recipe=talib_v1`` (served as ``derived_mnq_talib_1m``,
``_1h`` and ``_4h``) and their ``_meta.json`` sidecars, which name each column's TA-Lib function, output,
group and warmup. It lands four tables under

    s3://derived/study_talib_indicator_catalogue/recipe=talib_v1/table=<name>/

``column_statistics``
    One row per (timeframe, column): the notebook's columns (function, output, group, lookback, finite
    count and percent, mean, median, standard deviation, skewness, kurtosis, 25th and 75th percentile,
    minimum, maximum) plus ``nonzero_bar_count`` (how many bars a pattern column fired on) and the TA-Lib
    parameters. The notebook's definitions, reproduced exactly (they differ from pandas and polars in the
    fifth digit): standard deviation with n-1, skewness = mean((x-mean)^3) / s^3, excess kurtosis =
    mean((x-mean)^4) / s^4 - 3, with s the n-1 standard deviation; quantiles by linear interpolation.
``column_histogram``
    One row per (timeframe, column, bin): 60 equal-width bins between the column's minimum and maximum,
    so every column can be drawn as its own distribution and re-binned by merging neighbours.
``column_trend``
    One row per (timeframe, column, bucket): the mean of the column over 60 equal runs of bars, so every
    column can be drawn as its own line without sending 86,925 points each.
``dataset_summary``
    One row per (timeframe, contract): bar count, first and last timestamp and the bar index the contract's
    run starts at (the roll), with the TA-Lib version and the window.

The dashboard serves them as ``derived_study_talib_indicator_catalogue_<name>`` after
``POST /api/labels/catalog/refresh`` or its next start. A recipe already landed is never overwritten.
Rebuilding the indicators themselves (TA-Lib over 161 functions) stays in the datalake repository's
``scripts/build_mnq_talib_1m.py``.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
import time
import warnings
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[4]
DATALAKE = Path(os.environ.get("DATALAKE_REPOSITORY", r"E:\source\repos\datalake"))
sys.path.insert(0, str(ROOT / "src" / "ml"))
sys.path.insert(0, str(DATALAKE / "src"))

from ta_strategy.store import land, write_local  # noqa: E402

DATASET = "study_talib_indicator_catalogue"
RECIPE = "talib_v1"
SOURCE_RECIPE = "talib_v1"
TIMEFRAMES = ("1m", "1h", "4h")
BIN_COUNT = 60
BUCKET_COUNT = 60


def source_dataset(timeframe: str) -> str:
    return f"mnq_talib_{timeframe}"


def statistics_of(values: np.ndarray) -> dict:
    """The notebook's eight numbers over the finite values of one column (None where undefined)."""
    finite = values[np.isfinite(values)]
    count = int(finite.size)
    out: dict = {
        "finite_count": count,
        "mean": None, "median": None, "standard_deviation": None, "skewness": None, "kurtosis": None,
        "percentile_25": None, "percentile_75": None, "minimum": None, "maximum": None,
    }
    if count == 0:
        return out
    out["mean"] = float(finite.mean())
    out["median"] = float(np.median(finite))
    out["percentile_25"] = float(np.quantile(finite, 0.25))
    out["percentile_75"] = float(np.quantile(finite, 0.75))
    out["minimum"] = float(finite.min())
    out["maximum"] = float(finite.max())
    if count > 1:
        deviation = finite - finite.mean()
        spread = float(finite.std(ddof=1))
        out["standard_deviation"] = spread
        if spread > 0:
            out["skewness"] = float((deviation ** 3).mean() / spread ** 3)
            out["kurtosis"] = float((deviation ** 4).mean() / spread ** 4 - 3.0)
    return out


def histogram_rows(timeframe: str, name: str, values: np.ndarray) -> list[dict]:
    finite = values[np.isfinite(values)]
    if finite.size == 0:
        return []
    low, high = float(finite.min()), float(finite.max())
    if high == low:
        counts = np.zeros(BIN_COUNT, dtype=np.int64)
        counts[0] = finite.size
        edges = np.full(BIN_COUNT + 1, low)
    else:
        counts, edges = np.histogram(finite, bins=BIN_COUNT, range=(low, high))
    return [
        {"timeframe": timeframe, "column_name": name, "bin_index": index,
         "bin_lower_value": float(edges[index]), "bin_upper_value": float(edges[index + 1]), "bar_count": int(counts[index])}
        for index in range(BIN_COUNT)
    ]


def trend_rows(timeframe: str, name: str, values: np.ndarray) -> list[dict]:
    bar_count = values.size
    bucket = np.minimum((np.arange(bar_count) * BUCKET_COUNT) // bar_count, BUCKET_COUNT - 1)
    rows = []
    for index in range(BUCKET_COUNT):
        inside = np.flatnonzero(bucket == index)
        if inside.size == 0:
            continue
        run = values[inside]
        finite = run[np.isfinite(run)]
        rows.append({
            "timeframe": timeframe, "column_name": name, "bucket_index": index,
            "first_bar_index": int(inside[0]), "last_bar_index": int(inside[-1]),
            "mean_value": float(finite.mean()) if finite.size else None,
            "finite_bar_count": int(finite.size),
        })
    return rows


def read_sidecar(timeframe: str) -> dict:
    from lake.layout import derived_root

    path = derived_root(source_dataset(timeframe), SOURCE_RECIPE) / "_meta.json"
    return json.loads(path.read_text(encoding="utf-8"))


def naive_utc(value) -> pd.Timestamp:
    stamp = pd.Timestamp(value)
    return stamp.tz_convert("UTC").tz_localize(None) if stamp.tzinfo else stamp


def build_timeframe(connection, timeframe: str) -> dict[str, list[dict]]:
    sidecar = read_sidecar(timeframe)
    catalogue = [entry for entry in sidecar["columns"] if entry.get("column_name")]
    names = [entry["column_name"] for entry in catalogue]
    quoted = ", ".join(f'"{name}"' for name in names)
    table = connection.execute(
        f'SELECT "timestamp", contract_symbol, {quoted} FROM derived_{source_dataset(timeframe)} ORDER BY "timestamp"'
    ).to_arrow_table()
    bar_count = table.num_rows
    if bar_count != sidecar["row_count"]:
        raise RuntimeError(f"{timeframe}: lake has {bar_count} bars, sidecar says {sidecar['row_count']}")

    statistics, histograms, trends = [], [], []
    for entry in catalogue:
        name = entry["column_name"]
        column = table.column(name).to_numpy(zero_copy_only=False).astype(np.float64)
        column = np.where(np.isnan(column), np.nan, column)
        finite_mask = np.isfinite(column)
        numbers = statistics_of(column)
        statistics.append({
            "timeframe": timeframe, "column_name": name,
            "talib_function": entry["talib_function"], "talib_output": entry["talib_output"],
            "talib_group": entry["talib_group"], "lookback_bars": int(entry["lookback_bars"]),
            "integer_output": bool(entry.get("integer_output", False)),
            "parameters_json": json.dumps(entry.get("parameters", {}), sort_keys=True),
            "bar_count": bar_count,
            "finite_percent": 100.0 * numbers["finite_count"] / bar_count,
            "nonzero_bar_count": int(np.count_nonzero(finite_mask & (column != 0))),
            **numbers,
        })
        histograms.extend(histogram_rows(timeframe, name, column))
        trends.extend(trend_rows(timeframe, name, column))

    symbols = table.column("contract_symbol").to_pylist()
    stamps = table.column("timestamp").to_pylist()
    summary = []
    start = 0
    for index in range(1, bar_count + 1):
        if index == bar_count or symbols[index] != symbols[start]:
            run_stamps = stamps[start:index]
            summary.append({
                "timeframe": timeframe, "contract_symbol": symbols[start], "bar_count": index - start,
                "first_bar_index": start, "first_timestamp": naive_utc(run_stamps[0]), "last_timestamp": naive_utc(run_stamps[-1]),
                "talib_version": sidecar["talib_version"], "window_start": pd.Timestamp(sidecar["window_start"]),
                "window_end": pd.Timestamp(sidecar["window_end"]), "source_recipe": SOURCE_RECIPE,
            })
            start = index
    return {"column_statistics": statistics, "column_histogram": histograms, "column_trend": trends, "dataset_summary": summary}


def connect_serving():
    from lake.serving import connect

    return connect()


def with_retry(work, attempts: int = 30):
    """The AIStor listener drops connections under load; a read is retried, never guessed."""
    last: Exception | None = None
    for _ in range(attempts):
        try:
            return work()
        except Exception as error:  # noqa: BLE001 - only connection failures are retried
            if "Could not connect" not in str(error) and "IO Error" not in str(error):
                raise
            last = error
            time.sleep(2)
    raise RuntimeError(f"lake unreachable after {attempts} attempts: {last}")


def recipe_exists() -> bool:
    from lake.layout import arrow_fs, arrow_key, derived_root

    key = arrow_key(derived_root(DATASET, RECIPE) / "table=column_statistics" / "part-0.parquet")
    return arrow_fs().get_file_info(key).type.name != "NotFound"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dry-run", action="store_true", help="compute and print the row counts, land nothing")
    arguments = parser.parse_args()
    warnings.filterwarnings("ignore")

    if not arguments.dry_run and recipe_exists():
        print(f"skip {DATASET}/recipe={RECIPE}: already landed (a landed recipe is never overwritten)")
        return 0

    combined: dict[str, list[dict]] = {}
    for timeframe in TIMEFRAMES:
        parts = with_retry(lambda: build_timeframe(connect_serving(), timeframe))
        for name, rows in parts.items():
            combined.setdefault(name, []).extend(rows)
        print(f"{timeframe}: " + ", ".join(f"{name} {len(rows)}" for name, rows in parts.items()))

    frames = {name: pd.DataFrame(rows) for name, rows in combined.items()}
    for column in ("first_timestamp", "last_timestamp", "window_start", "window_end"):
        frames["dataset_summary"][column] = pd.to_datetime(frames["dataset_summary"][column]).astype("datetime64[us]")
    if arguments.dry_run:
        return 0

    source = "derived/mnq_talib_{1m,1h,4h}/recipe=talib_v1 (+ _meta.json) via datalake lake.serving; notebook datalake/notebooks/mnq_talib_1m.py"
    with tempfile.TemporaryDirectory() as scratch:
        paths = write_local(frames, scratch)
        landed = land(paths, RECIPE, source=source, dataset=DATASET)
    for name, detail in landed.items():
        print(f"  {name}: {detail['rows']:,} rows, {detail['bytes']:,} bytes, manifest {detail['manifest']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
