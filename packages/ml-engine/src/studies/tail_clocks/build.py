"""Land the tail-clocks numbers in the lake for the `tail-clocks` study.

The notebook this replaced (datalake/notebooks/tails.py) sampled one futures
root's front-month, ratio back-adjusted 1-minute bars on three clocks (the
calendar, every N contracts, every N dollars), calibrated to the same bar count,
and compared the fat tails of their standardised returns. It read
`E:/lake/_meta/tails.duckdb`, which does not exist (the real file is
`E:/lake-workspace/tails.duckdb` and its `bars` view points at a retired
Iceberg snapshot), and ran the chain / `fmadj` macros of the datalake repo
inside that file. The dashboard's DuckDB does not have those macros, so this
build runs the notebook's own code path (`lake.analytics` macros, `lake.clocks`,
`lake.tailviz`) once for every root, bar size and clock and lands the result:

    derived/study_tail_clocks/recipe=<RECIPE>/table=<name>/part-0.parquet
    meta/ingest_manifests/study_tail_clocks.jsonl      one line per table

Tables (served as `derived_study_tail_clocks_<name>`):

    bar_returns       one row per bar of the development span (the first 80% of
                      each series, the last 20% stays sealed and is not landed):
                      root, bar_size, clock, bar_timestamp, log_return,
                      standardised_return, percent_return
    series_summary    one row per (root, bar_size, clock): bar counts, the
                      calibration target, the threshold, and the mean and
                      standard deviation the returns were standardised with
    hourly_volume     contracts traded per calendar hour of the development
                      span, per root (the "why" panel)

The standardisation is the notebook's: a whole-span mean and standard deviation
(ddof 1) over the development span. It is descriptive, not causal.

Run:  E:/source/repos/datalake/.venv/Scripts/python.exe packages/ml-engine/src/studies/tail_clocks/build.py
It refuses to land a recipe that already exists (write-once).
"""

from __future__ import annotations

import os
import sys
import tempfile
import time
from pathlib import Path

import numpy as np
import polars as pl

REPOSITORY = Path(__file__).resolve().parents[4]
DATALAKE = Path(os.environ.get("DATALAKE_REPOSITORY", r"E:\source\repos\datalake"))
sys.path.insert(0, str(REPOSITORY / "src" / "ml"))
sys.path.insert(0, str(DATALAKE / "src"))

import duckdb  # noqa: E402
import lake.analytics as lake_analytics  # noqa: E402

# The macro library installs a census over every bar at the end of `install`
# (a scan of 785M rows). Nothing here reads it, and the library is installed
# into an in-memory connection, so the census is skipped.
lake_analytics.ensure_census = lambda connection: None

from lake import clocks, tailviz  # noqa: E402
from lake.analytics import install  # noqa: E402
from lake.catalog import duckdb_connect, scan  # noqa: E402

from ta_strategy.store import land  # noqa: E402

DATASET = "study_tail_clocks"
RECIPE = "futures_ratio_adjusted_development_80_percent_2026_09_30"
DEVELOPMENT_FRACTION = 0.80  # the notebook's DEV_FRAC: the final fifth stays sealed
BAR_SIZES = ("15m", "1h", "4h", "1d")
CLOCKS = ("time", "volume", "dollar")
ORIGIN = "TIMESTAMPTZ '1970-01-05 00:00:00+00'"


def retrying(operation, attempts: int = 8, pause_seconds: float = 20.0):
    """Connections to the local catalog fail while other processes hold every ephemeral port; retry."""
    for attempt in range(1, attempts + 1):
        try:
            return operation()
        except Exception as error:  # noqa: BLE001
            if attempt == attempts:
                raise
            print(f"  retry {attempt}/{attempts - 1} after: {str(error)[:110]}")
            time.sleep(pause_seconds)


def already_landed() -> bool:
    from lake.layout import arrow_fs, arrow_key, derived_root
    from pyarrow.fs import FileType

    key = arrow_key(derived_root(DATASET, RECIPE))
    return arrow_fs().get_file_info(key).type != FileType.NotFound


def open_connection() -> duckdb.DuckDBPyConnection:
    connection = duckdb_connect(duckdb.connect())
    # A local `bars` table the macros bind to: each root's 1m and 1d bars are loaded once,
    # so the repeated macro calls scan memory, not the Iceberg manifest.
    retrying(lambda: connection.execute(f"CREATE TABLE bars AS SELECT * FROM {scan('bars')} WHERE false"))
    install(connection)
    return connection


def futures_roots(connection) -> list[tuple[str, int]]:
    rows = retrying(lambda: connection.execute(
        f"SELECT root, count(*) AS bar_count FROM {scan('bars')} "
        "WHERE asset_class = 'futures' AND timeframe = '1m' GROUP BY root ORDER BY bar_count DESC, root"
    ).fetchall())
    return [(str(root), int(count)) for root, count in rows]


def load_root(connection, root: str) -> None:
    connection.execute("DELETE FROM bars")
    retrying(lambda: connection.execute(
        f"INSERT INTO bars SELECT * FROM {scan('bars')} "
        f"WHERE asset_class = 'futures' AND root = '{root}' AND timeframe IN ('1m', '1d')"
    ))


def naive(timestamps: np.ndarray) -> np.ndarray:
    """Timestamps as the lake stamps them (Pacific wall clock as UTC), without a zone."""
    return timestamps.astype("datetime64[us]")


def build_root(connection, root: str, one_minute_bar_count: int):
    base = connection.execute(f"SELECT ts, o, h, l, c, v, adj FROM fmadj('{root}', '1m', 'futures') ORDER BY ts").pl()
    adjustment = base["adj"].to_numpy()
    returns_parts: list[pl.DataFrame] = []
    summary_rows: list[dict] = []

    for size in BAR_SIZES:
        target = connection.execute(
            f"SELECT count(DISTINCT time_bucket(to_seconds(tf_seconds('{size}')), ts, {ORIGIN})) "
            f"FROM fmadj('{root}', '1m', 'futures')"
        ).fetchone()[0]
        for clock in CLOCKS:
            if clock == "time":
                series = connection.execute(
                    f"SELECT time_bucket(to_seconds(tf_seconds('{size}')), ts, {ORIGIN}) AS ts, "
                    "arg_min(o, ts) AS o, max(h) AS h, min(l) AS l, arg_max(c, ts) AS c, sum(v) AS v "
                    f"FROM fmadj('{root}', '1m', 'futures') GROUP BY 1 ORDER BY 1"
                ).pl()
                threshold = float("nan")
            else:
                series = clocks.resample(base, clock, int(target), adj=adjustment)
                weight = base["v"].to_numpy().astype(np.float64)
                if clock == "dollar":
                    price = base["c"].to_numpy().astype(np.float64)
                    price = price / np.where(np.isfinite(adjustment) & (adjustment > 0), adjustment, 1.0)
                    weight = price * weight
                threshold = float(np.nansum(weight)) / int(target)

            standardised, timestamps = tailviz.standardise(series, DEVELOPMENT_FRACTION)
            log_returns, raw_timestamps = tailviz.raw_returns(series, DEVELOPMENT_FRACTION)
            assert standardised.size == log_returns.size and (timestamps == raw_timestamps).all(), (root, size, clock)
            mean = float(log_returns.mean()) if log_returns.size else float("nan")
            deviation = float(log_returns.std(ddof=1)) if log_returns.size > 1 else float("nan")
            developed = series.head(int(len(series) * DEVELOPMENT_FRACTION))
            summary_rows.append({
                "root": root, "bar_size": size, "clock": clock,
                "one_minute_bar_count": one_minute_bar_count,
                "calibration_target_bar_count": int(target),
                "bar_count": len(series),
                "development_bar_count": len(developed),
                "return_count": int(standardised.size),
                "development_first_bar_timestamp": developed["ts"].dt.replace_time_zone(None)[0] if len(developed) else None,
                "development_last_bar_timestamp": developed["ts"].dt.replace_time_zone(None)[-1] if len(developed) else None,
                "threshold_per_bar": threshold,
                "threshold_unit": {"time": "seconds", "volume": "contracts", "dollar": "dollars"}[clock],
                "log_return_mean": mean,
                "log_return_standard_deviation": deviation,
            })
            if standardised.size:
                returns_parts.append(pl.DataFrame({
                    "root": root, "bar_size": size, "clock": clock,
                    "bar_timestamp": naive(timestamps),
                    "log_return": log_returns,
                    "standardised_return": standardised,
                    "percent_return": 100.0 * (np.exp(log_returns) - 1.0),
                }))

    hourly = connection.execute(
        f"SELECT time_bucket(to_seconds(3600), ts, {ORIGIN}) AS hour_timestamp, sum(v) AS contracts_traded "
        f"FROM fmadj('{root}', '1m', 'futures') GROUP BY 1 ORDER BY 1"
    ).pl()
    hourly = hourly.head(int(len(hourly) * DEVELOPMENT_FRACTION)).with_columns(
        pl.lit(root).alias("root"),
        pl.col("hour_timestamp").dt.replace_time_zone(None),
    ).select("root", "hour_timestamp", "contracts_traded")

    summary = pl.DataFrame(summary_rows).with_columns(
        pl.col("development_first_bar_timestamp").cast(pl.Datetime("us")),
        pl.col("development_last_bar_timestamp").cast(pl.Datetime("us")),
    )
    return pl.concat(returns_parts), summary, hourly


def main() -> int:
    if already_landed():
        print(f"recipe {RECIPE} of {DATASET} is already in the lake; refusing to overwrite it.")
        return 1
    connection = open_connection()
    roots = futures_roots(connection)
    print("roots:", roots)
    returns_frames, summary_frames, hourly_frames = [], [], []
    for root, count in roots:
        started = time.time()
        load_root(connection, root)
        returns, summary, hourly = build_root(connection, root, count)
        returns_frames.append(returns)
        summary_frames.append(summary)
        hourly_frames.append(hourly)
        print(f"{root}: {returns.height:,} return rows, {hourly.height:,} hours ({time.time() - started:.1f}s)")

    tables = {
        "bar_returns": pl.concat(returns_frames).sort(["root", "bar_size", "clock", "bar_timestamp"]),
        "series_summary": pl.concat(summary_frames),
        "hourly_volume": pl.concat(hourly_frames).sort(["root", "hour_timestamp"]),
    }
    with tempfile.TemporaryDirectory(prefix="study_tail_clocks_") as directory:
        paths = {}
        for name, frame in tables.items():
            path = os.path.join(directory, f"{name}.parquet")
            frame.write_parquet(path, compression="zstd", row_group_size=250_000, statistics=True)
            paths[name] = path
        result = retrying(lambda: land(paths, RECIPE, "datalake notebooks/tails.py code path over lake.analytics fmadj + lake.clocks + lake.tailviz", dataset=DATASET))
    for name, info in result.items():
        print(f"{name}: {info['rows']:,} rows -> {info['uri']} (manifest {info['manifest']})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
