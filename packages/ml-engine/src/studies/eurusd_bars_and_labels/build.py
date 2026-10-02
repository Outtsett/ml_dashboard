"""Land EURUSD's forward trend labels in the lake for the `eurusd-bars-and-labels` study.

The notebook this replaced (Trading/forexmodel/notebooks/eurusd.py) read
`data/forex/EURUSD/trend_labels_<timeframe>.parquet`, which `forexmodel`'s
retired repo-local cache no longer holds, so its whole label half was dead.
This build recomputes that file's content with the repository's own code path
(`scripts/trend_labels.py::one`, imported for its constants and re-run step for
step without the parquet write), from the same bars the notebook reads
(`forexmodel.data.load_ohlcv`, i.e. the lake's `market.bars` 1-minute rows,
coarser timeframes by the same polars `group_by_dynamic`), and lands what the
notebook showed:

  forward_direction_bars   every bar's `dir_h<h>` (the marker column), non-null rows only
  label_catalog            every label column with its meaning (scripts/label_browser.py::annotate)
  label_class_balance      every integer column with at most 8 distinct values: class counts and shares
  label_distributions      every continuous column: the notebook's `stats.describe_frame` set
  label_histograms         60 bins per continuous column, so the page can draw every column
  label_horizon_grid       the measured class boundary and the class shares per timeframe and horizon
  label_run_information    bars, date range, development size and what each timeframe carries

    derived/study_eurusd_bars_and_labels/recipe=<RECIPE>/table=<name>/part-0.parquet
    meta/ingest_manifests/study_eurusd_bars_and_labels.jsonl   one line per table

Served by the dashboard as `derived_study_eurusd_bars_and_labels_<name>`.

Run:  E:/source/repos/datalake/.venv/Scripts/python.exe packages/ml-engine/src/studies/eurusd_bars_and_labels/build.py
It refuses to land a recipe that already exists (write-once).
"""

from __future__ import annotations

import importlib.util
import os
import re
import sys
import tempfile
import time
import warnings
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import polars as pl

warnings.filterwarnings("ignore")

REPOSITORY = Path(__file__).resolve().parents[4]
FOREXMODEL = REPOSITORY / "Trading" / "forexmodel"
sys.path.insert(0, str(FOREXMODEL / "src"))
sys.path.insert(0, str(REPOSITORY / "src" / "ml"))

from forexmodel import data, ngrams, split, stats, trend  # noqa: E402
from forexmodel.features import scales as scales_module  # noqa: E402

DATASET = "study_eurusd_bars_and_labels"
RECIPE = "forexmodel_trend_labels_20260930"
PAIR = "EURUSD"
HISTOGRAM_BINS = 60
HISTOGRAM_LOWER_PERCENTILE = 0.5
HISTOGRAM_UPPER_PERCENTILE = 99.5
CONNECT_ATTEMPTS = 12


def _script(name: str):
    """A forexmodel script as a module: imported for its constants and helpers, never run."""
    path = FOREXMODEL / "scripts" / f"{name}.py"
    spec = importlib.util.spec_from_file_location(f"forexmodel_script_{name}", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


TREND_LABELS = _script("trend_labels")
LABEL_BROWSER = _script("label_browser")

# The 1-minute bars are read once (the lake's object store answers slowly when other sessions
# are reading it, so the connection is retried) and every coarser timeframe is resampled from them.
_read_one_minute = data._read_1m
_one_minute_cache: dict[str, pl.DataFrame] = {}


def _cached_one_minute(pair: str) -> pl.DataFrame:
    if pair not in _one_minute_cache:
        for attempt in range(1, CONNECT_ATTEMPTS + 1):
            try:
                _one_minute_cache[pair] = _read_one_minute(pair)
                break
            except Exception as error:  # noqa: BLE001
                if attempt == CONNECT_ATTEMPTS:
                    raise
                print(f"reading the lake failed ({str(error).splitlines()[0][:90]}); retry {attempt}")
                time.sleep(10)
    return _one_minute_cache[pair]


data._read_1m = _cached_one_minute

BASE_NAMES = {
    "dir": "forward direction",
    "is_trending": "forward is trending",
    "is_ranging": "forward is ranging",
    "is_up": "forward is up",
    "is_down": "forward is down",
    "mag": "forward move size class",
    "is_large": "forward move is large",
    "fwd_t": "forward slope t-statistic",
    "fwd_beta": "forward slope in log return per bar",
    "fwd_beta_vol": "forward slope in trailing-volatility units",
    "fwd_ret": "forward log return",
    "fwd_r2": "forward fit coefficient of determination",
}


def display_name(column: str) -> tuple[str, int | None]:
    """A column identifier -> (spelled-out name, horizon in bars or the trailing window)."""
    if match := re.match(r"^t_(\d+)$", column):
        return f"trailing slope t-statistic over the last {match.group(1)} bars", int(match.group(1))
    if match := re.match(r"^(\w+?)_h(\d+)$", column):
        base, horizon = match.group(1), int(match.group(2))
        return f"{BASE_NAMES.get(base, base)}, {horizon} bars ahead", horizon
    return column, None


def label_frame_for(timeframe: str) -> tuple[pl.DataFrame, list[dict], int, pl.DataFrame]:
    """`scripts/trend_labels.py::one` for EURUSD, minus the parquet write.

    Returns (label frame or an empty frame, the horizon grid rows, development bar count, the bars).
    """
    bars = data.load_ohlcv(PAIR, timeframe)
    bounds = ngrams.segments(bars["timestamp"], timeframe)
    development_stop, _ = split.dev_oos_split(len(bars))
    windows = sorted({TREND_LABELS.bars(days, timeframe) for days in TREND_LABELS.FEATURE_DAYS})
    windows = [window for window in windows if window >= 3]
    horizons = sorted({TREND_LABELS.bars(days, timeframe) for days in TREND_LABELS.HORIZON_DAYS})
    horizons = [horizon for horizon in horizons if horizon >= TREND_LABELS.MIN_HORIZON_BARS]

    columns: dict[str, pl.Series] = {"timestamp": bars["timestamp"]}
    close = bars["close"].to_numpy().astype(np.float64)
    for window in windows:
        columns[f"t_{window}"] = pl.Series(trend.tstat(close, window))

    grid: list[dict] = []
    for horizon in horizons:
        frame, info = trend.label_frame(
            bars, bounds, horizon=horizon, feature_windows=(), quantile=trend.NULL_QUANTILE,
            n_shuffle=2, seed=17,
        )
        coverage = info["n_labelled"] / len(bars)
        trending = 1.0 - info["share_ranging"]
        kept = bool(coverage >= TREND_LABELS.MIN_COVERAGE)
        grid.append({
            "timeframe": timeframe,
            "horizon_bars": horizon,
            "horizon_trading_days": round(horizon / scales_module.BARS_PER_DAY[timeframe], 3),
            "class_boundary_t_statistic_upper": info["threshold"],
            "class_boundary_t_statistic_lower": info["threshold_lo"],
            "magnitude_boundary_volatility_units": info["mag_threshold"],
            "abstain_share": info["share_abstain"],
            "large_move_share": info["share_large"],
            "labelled_bar_share": coverage,
            "up_share": info["share_up"],
            "ranging_share": info["share_ranging"],
            "down_share": info["share_down"],
            "trending_share": trending,
            "shuffled_series_trending_share": info["surrogate_share_trending"],
            "trending_share_excess_over_shuffle": trending - info["surrogate_share_trending"],
            "horizon_kept": kept,
        })
        if not kept:
            continue
        for column in frame.columns:
            if column != "timestamp" and not column.startswith("t_"):
                columns[f"{column}_h{horizon}"] = frame[column]

    if not any(row["horizon_kept"] for row in grid):
        return pl.DataFrame(), grid, development_stop, bars
    # `label_frame` returns nulls and `trend.tstat` NaN; one convention before anything is counted.
    out = pl.DataFrame(columns).with_columns(pl.col(pl.Float64).fill_nan(None))
    return out, grid, development_stop, bars


def describe_continuous(timeframe: str, frame: pl.DataFrame) -> tuple[pl.DataFrame, pl.DataFrame]:
    """The notebook's `stats.describe_frame` set per continuous column, and 60-bin histograms of each."""
    columns = [c for c in frame.columns if c != "timestamp" and frame[c].dtype in (pl.Float32, pl.Float64)]
    described = stats.describe_frame(frame, columns, extra_percentiles=(1.0, 5.0, 95.0, 99.0))
    rows, bins = [], []
    for column in columns:
        values = frame[column].drop_nulls().to_numpy().astype(np.float64)
        values = values[np.isfinite(values)]
        lower, upper = np.percentile(values, [HISTOGRAM_LOWER_PERCENTILE, HISTOGRAM_UPPER_PERCENTILE])
        below = int((values < lower).sum())
        above = int((values > upper).sum())
        if upper > lower:
            counts, edges = np.histogram(values, bins=HISTOGRAM_BINS, range=(lower, upper))
            for position in range(HISTOGRAM_BINS):
                bins.append({
                    "timeframe": timeframe, "label_column": column, "bin_position": position + 1,
                    "bin_lower_edge": float(edges[position]), "bin_upper_edge": float(edges[position + 1]),
                    "bin_count": int(counts[position]),
                })
        rows.append({"label_column": column, "count_below_histogram_range": below, "count_above_histogram_range": above})
    tails = pl.DataFrame(rows)
    described = described.join(tails, left_on="column", right_on="label_column", how="left")
    described = described.rename({
        "column": "label_column", "n": "count", "std": "standard_deviation", "skew": "skewness",
        "kurtosis": "excess_kurtosis", "p25": "percentile_25", "p50": "percentile_50", "p75": "percentile_75",
        "min": "minimum", "max": "maximum", "n_dropped": "dropped_count",
        "p1": "percentile_1", "p5": "percentile_5", "p95": "percentile_95", "p99": "percentile_99",
    }).with_columns(pl.lit(timeframe).alias("timeframe"))
    names = [display_name(c)[0] for c in described["label_column"].to_list()]
    described = described.with_columns(pl.Series("label_display_name", names))
    return described, pl.DataFrame(bins) if bins else pl.DataFrame()


def class_balance(timeframe: str, frame: pl.DataFrame) -> pl.DataFrame:
    """The notebook's balance table: integer columns with at most 8 distinct values."""
    discrete = [
        c for c in frame.columns
        if frame[c].dtype in (pl.Int8, pl.Int16, pl.Int32, pl.Int64) and frame[c].n_unique() <= 8
    ]
    parts = []
    for column in discrete:
        known = len(frame) - frame[column].null_count()
        counts = frame[column].drop_nulls().value_counts().sort(column)
        parts.append(pl.DataFrame({
            "timeframe": timeframe,
            "label_column": column,
            "label_display_name": display_name(column)[0],
            "class_value": counts[column].cast(pl.Int64),
            "class_count": counts["count"].cast(pl.Int64),
            "known_count": known,
            "class_share": counts["count"] / known,
        }))
    return pl.concat(parts) if parts else pl.DataFrame()


def catalog(timeframe: str, frame: pl.DataFrame) -> pl.DataFrame:
    rows = []
    for column in frame.columns:
        if column == "timestamp":
            continue
        family, role, values, meaning = LABEL_BROWSER.annotate(column)
        name, horizon = display_name(column)
        known = len(frame) - frame[column].null_count()
        rows.append({
            "timeframe": timeframe, "label_column": column, "label_display_name": name,
            "label_family": family, "label_role": role, "data_type": str(frame[column].dtype),
            "value_set": values, "horizon_or_window_bars": horizon,
            "row_count": len(frame), "known_count": known,
            "known_share": known / len(frame) if len(frame) else None,
            "distinct_count": frame[column].n_unique(), "meaning": meaning,
        })
    return pl.DataFrame(rows)


def forward_direction(timeframe: str, frame: pl.DataFrame) -> pl.DataFrame:
    parts = []
    for column in frame.columns:
        if match := re.match(r"^dir_h(\d+)$", column):
            part = frame.select("timestamp", pl.col(column).alias("forward_direction")).drop_nulls("forward_direction")
            parts.append(part.with_columns(
                pl.lit(timeframe).alias("timeframe"),
                pl.lit(int(match.group(1))).cast(pl.Int32).alias("horizon_bars"),
                pl.col("forward_direction").cast(pl.Int8),
                pl.col("timestamp").cast(pl.Datetime("us")),
            ).select("timeframe", "horizon_bars", "timestamp", "forward_direction"))
    return pl.concat(parts).sort("horizon_bars", "timestamp") if parts else pl.DataFrame()


def build_tables() -> dict[str, pl.DataFrame]:
    built_at = datetime.now(timezone.utc).replace(tzinfo=None)
    collected: dict[str, list[pl.DataFrame]] = {name: [] for name in (
        "forward_direction_bars", "label_catalog", "label_class_balance", "label_distributions",
        "label_histograms", "label_horizon_grid", "label_run_information")}
    for timeframe in data.INTERVALS:
        started = time.time()
        frame, grid, development_stop, bars = label_frame_for(timeframe)
        collected["label_horizon_grid"].append(pl.DataFrame(grid))
        horizons = sorted({int(m.group(1)) for c in frame.columns if (m := re.match(r"^dir_h(\d+)$", c))}) if len(frame) else []
        collected["label_run_information"].append(pl.DataFrame({
            "timeframe": [timeframe], "bar_count": [len(bars)],
            "first_bar_timestamp": [bars["timestamp"].min()], "last_bar_timestamp": [bars["timestamp"].max()],
            "development_bar_count": [development_stop], "sealed_bar_count": [len(bars) - development_stop],
            "label_column_count": [max(len(frame.columns) - 1, 0)],
            "label_horizons_bars": [",".join(str(h) for h in horizons)],
            "built_at": [built_at], "source": ["market.bars 1-minute EURUSD through forexmodel.data.load_ohlcv"],
        }))
        if len(frame):
            distributions, histograms = describe_continuous(timeframe, frame)
            collected["label_distributions"].append(distributions)
            collected["label_histograms"].append(histograms)
            collected["label_class_balance"].append(class_balance(timeframe, frame))
            collected["label_catalog"].append(catalog(timeframe, frame))
            collected["forward_direction_bars"].append(forward_direction(timeframe, frame))
        print(f"{timeframe:>4}: {len(bars):>9,} bars, {max(len(frame.columns) - 1, 0):>3} label columns, "
              f"horizons {horizons}, {time.time() - started:5.1f}s", flush=True)
    # An unknown is null, never NaN: the grid's unkept horizons and a degenerate column's moments.
    return {
        name: pl.concat(parts, how="diagonal").with_columns(pl.col(pl.Float64).fill_nan(None))
        for name, parts in collected.items() if parts
    }


def already_landed() -> bool:
    from lake.layout import arrow_fs, arrow_key, derived_root
    from pyarrow.fs import FileType

    key = arrow_key(derived_root(DATASET, RECIPE))
    return arrow_fs().get_file_info(key).type != FileType.NotFound


def main() -> int:
    from ta_strategy.store import land

    if already_landed():
        print(f"recipe {RECIPE} of {DATASET} is already in the lake; refusing to overwrite it.")
        return 1
    tables = build_tables()
    with tempfile.TemporaryDirectory(prefix="study_eurusd_bars_and_labels_") as directory:
        paths = {}
        for name, frame in tables.items():
            path = os.path.join(directory, f"{name}.parquet")
            frame.write_parquet(path)
            paths[name] = path
        result = land(paths, RECIPE, "forexmodel scripts/trend_labels.py re-run on market.bars EURUSD", dataset=DATASET)
    for name, info in result.items():
        print(f"{name}: {info['rows']:,} rows -> {info['uri']} (manifest {info['manifest']})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
