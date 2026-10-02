"""Land the MNQ EDA study's unit-root tests in the lake: ``s3://derived/study_mnq_eda_30m/recipe=<recipe>/table=stationarity_tests/``.

Replaces the statsmodels cells of Trading/quant/model/notebooks/eda_mnq_1d.py
(the "mnq-eda-30m" study page). The page computes everything else live from the
bars (moments, normality, autocorrelation, volatility, weekdays, the model's
input tensor, direction labels, walk-forward folds); this build lands the two
things that need statsmodels and a long lag search, exactly as the notebook
calls them:

    adfuller(log_returns, autolag="AIC")                 Augmented Dickey-Fuller
    kpss(log_returns, regression="c", nlags="auto")      KPSS
    adfuller(close, autolag="AIC")                       the prices, which should fail

for each bar size (5m, 15m, 30m, 1h, 4h) and each of two sources of bars:

    full      ``mnq_ohlcv_<tf>``: the dedicated MNQ view, every bar since 2019-05
              (the series the notebook's prose describes)
    notebook  ``shared.data.load_ohlcv_arrays("MNQ", tf)``: the notebook's OWN
              loader, which today reads the shared ``ohlcv_<tf>`` view whose
              history is cut to 2023-03 (33,443 bars at 30 minutes)

Two tables (full-word columns), served as ``derived_study_mnq_eda_30m_<table>``:

    stationarity_tests   one row per source x timeframe x series x test
    series_provenance    one row per source x timeframe: which bars each source holds
                         (count, first and last bar, median bars per calendar day) and
                         how many walk-forward folds the notebook's own
                         ``generate_folds`` finds in them at its defaults (12-month
                         tests, 240-bar purge, 24-month minimum train)

The quant workspace's ``shared`` package collides with the dashboard's, so the
computation runs in the quant interpreter and the landing in the datalake
interpreter through ``cycle.store._land_job`` (one zstd parquet, one manifest
line in ``meta/ingest_manifests/study_mnq_eda_30m.jsonl``).

Run (about twelve minutes; the 5m Augmented Dickey-Fuller lag search is most of it; ``--tables series_provenance`` alone takes seconds):
    E:/source/repos/ml_dashboard/Trading/quant/.venv/Scripts/python.exe packages/ml-engine/src/studies/mnq_eda_30m/build.py
Then ``POST /api/labels/catalog/refresh`` (or the next dashboard start) serves the table.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
import time
import warnings
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

DASHBOARD = Path(__file__).resolve().parents[4]
MODEL = DASHBOARD / "Trading" / "quant" / "model"
DATASET = "study_mnq_eda_30m"
RECIPE = "mnq_unit_root_tests_v1"
SOURCE = "packages/ml-engine/src/studies/mnq_eda_30m/build.py (Trading/quant/model/notebooks/eda_mnq_1d.py, statsmodels cells)"
LAKE_PYTHON = os.environ.get("CYCLE_LAKE_PYTHON", "E:/source/repos/datalake/.venv/Scripts/python.exe")

SYMBOL = "MNQ"
TIMEFRAMES = ["5m", "15m", "30m", "1h", "4h"]
SOURCES = ["full", "notebook"]
SIGNIFICANCE = 0.05

warnings.filterwarnings("ignore")


def log(message: str) -> None:
    print(f"[mnq-eda] {message}", flush=True)


def retried(read, attempts: int = 20, pause_seconds: float = 10.0):
    """A lake read that retries on an I/O error: the object store refuses
    connections while the machine is short of ephemeral ports, and the next
    attempt usually succeeds."""
    for attempt in range(attempts):
        try:
            return read()
        except Exception as error:  # noqa: BLE001
            retryable = "Could not connect" in str(error) or "HTTP" in str(error) or "IO Error" in str(error)
            if attempt == attempts - 1 or not retryable:
                raise
            log(f"lake read failed ({str(error)[:90]}), retrying")
            time.sleep(pause_seconds)
    return None


class RetryingConnection:
    """A DuckDB connection whose ``execute`` retries the connection errors above."""

    def __init__(self, connection) -> None:
        self._connection = connection

    def execute(self, *args):
        return retried(lambda: self._connection.execute(*args))


def serving_connection() -> RetryingConnection:
    from lake.serving import connect

    return RetryingConnection(retried(lambda: connect(with_bars=False, with_derived=False)))


def load_bars(connection: RetryingConnection, source: str, timeframe: str) -> tuple[np.ndarray, list]:
    """The close series and timestamps of one (source, timeframe), ascending in time."""
    if source == "full":
        rows = connection.execute(
            f"SELECT close, timestamp FROM mnq_ohlcv_{timeframe} WHERE symbol = '{SYMBOL}' ORDER BY timestamp"
        ).fetchall()
        return np.array([row[0] for row in rows], dtype=np.float64), [row[1] for row in rows]
    import shared.data as data

    data._SERVING = connection  # the loader's process-wide lake connection
    arrays = data.load_ohlcv_arrays(SYMBOL, timeframe)
    return arrays["close"], list(arrays["timestamp"])


def edge(p_value: float) -> bool:
    """statsmodels' KPSS p-value is interpolated inside a table and clipped to its edge."""
    return bool(np.isclose(p_value, 0.01) or np.isclose(p_value, 0.1))


def unit_root_rows(source: str, timeframe: str, close: np.ndarray) -> list[dict]:
    from statsmodels.tsa.stattools import adfuller, kpss

    returns = np.diff(np.log(close))
    returns = returns[~np.isnan(returns)]
    rows: list[dict] = []
    common = {"source": source, "timeframe": timeframe}

    def adf_row(series: str, values: np.ndarray, expected: str) -> dict:
        statistic, p_value, lags, observations, critical, _ = adfuller(values, autolag="AIC")
        stationary = p_value < SIGNIFICANCE
        return {
            **common, "series": series, "test": "augmented_dickey_fuller", "bar_count": int(len(values)),
            "statistic": float(statistic), "p_value": float(p_value), "p_value_is_table_edge": False,
            "lags_used": int(lags), "observations_used": int(observations),
            "critical_value_1_percent": float(critical["1%"]), "critical_value_2_5_percent": None,
            "critical_value_5_percent": float(critical["5%"]), "critical_value_10_percent": float(critical["10%"]),
            "null_hypothesis": "a unit root is present (the series is not stationary)",
            "verdict": "stationary (the unit root is rejected)" if stationary else f"not stationary{expected}",
            "computed_with": "statsmodels adfuller(autolag='AIC')",
        }

    started = time.time()
    rows.append(adf_row("log_return", returns, ""))
    statistic, p_value, lags, critical = kpss(returns, regression="c", nlags="auto")
    rows.append({
        **common, "series": "log_return", "test": "kpss", "bar_count": int(len(returns)),
        "statistic": float(statistic), "p_value": float(p_value), "p_value_is_table_edge": edge(float(p_value)),
        "lags_used": int(lags), "observations_used": int(len(returns)),
        "critical_value_1_percent": float(critical["1%"]), "critical_value_2_5_percent": float(critical["2.5%"]),
        "critical_value_5_percent": float(critical["5%"]), "critical_value_10_percent": float(critical["10%"]),
        "null_hypothesis": "the series is stationary around a constant",
        "verdict": "stationary (stationarity is not rejected)" if p_value > SIGNIFICANCE else "not stationary",
        "computed_with": "statsmodels kpss(regression='c', nlags='auto')",
    })
    rows.append(adf_row("close", close, " (as expected for prices)"))
    log(f"{source} {timeframe}: {len(close):,} bars, {time.time() - started:.0f}s")
    return rows


def provenance_row(source: str, timeframe: str, close: np.ndarray, timestamps: list) -> dict:
    """What one source holds, and the notebook's own fold count over it at the notebook's defaults."""
    from cnn_transformer.walk_forward import generate_folds

    stamps = pd.to_datetime(pd.Series(timestamps))
    # The notebook stringifies the stamps before generate_folds (which parses strptime formats).
    as_text = [str(t).split("+")[0].rstrip("Z").strip() for t in timestamps]
    bars_per_day = float(stamps.groupby(stamps.dt.date).size().median())
    folds = generate_folds(len(close), as_text, fold_months=12, purge_bars=240)
    view = f"mnq_ohlcv_{timeframe}" if source == "full" else ("ohlcv_1h_v" if timeframe == "1h" else f"ohlcv_{timeframe}")
    return {
        "source": source, "timeframe": timeframe, "view": view,
        "loader": "the dedicated MNQ view, every bar since 2019-05" if source == "full"
        else "shared.data.load_ohlcv_arrays('MNQ', timeframe), the notebook's own loader",
        "bar_count": int(len(close)),
        "first_bar_label": stamps.iloc[0].strftime("%Y-%m-%d %H:%M"), "last_bar_label": stamps.iloc[-1].strftime("%Y-%m-%d %H:%M"),
        "close_minimum": float(np.nanmin(close)), "close_maximum": float(np.nanmax(close)),
        "median_bars_per_calendar_day": bars_per_day,
        "default_walk_forward_fold_count": int(len(folds)),
        "note": "timestamps are the lake's stamps: Pacific wall clock stored as UTC",
    }


def compute(timeframes: list[str], sources: list[str], tables: list[str]) -> dict[str, pd.DataFrame]:
    sys.path.insert(0, str(MODEL / "src" / "ml"))
    connection = serving_connection()
    tests: list[dict] = []
    provenance: list[dict] = []
    for timeframe in timeframes:
        for source in sources:
            close, timestamps = load_bars(connection, source, timeframe)
            if "stationarity_tests" in tables:
                tests.extend(unit_root_rows(source, timeframe, close))
            if "series_provenance" in tables:
                provenance.append(provenance_row(source, timeframe, close, timestamps))
    computed_at = datetime.now(timezone.utc).isoformat()
    out: dict[str, pd.DataFrame] = {}
    for name, rows in (("stationarity_tests", tests), ("series_provenance", provenance)):
        if name in tables:
            frame = pd.DataFrame(rows)
            frame["computed_at"] = computed_at
            out[name] = frame
    return out


LANDING = r"""
import json, sys
sys.path.insert(0, %r)
from cycle.store import _land_job
print(json.dumps(_land_job(json.loads(sys.argv[1]))))
""" % str(DASHBOARD / "src" / "ml")


def land(tables: dict[str, pd.DataFrame], directory: str) -> dict:
    paths = {}
    for name, frame in tables.items():
        path = os.path.join(directory, f"{name}.parquet")
        frame.to_parquet(path, index=False)
        paths[name] = path
    job = {"dataset": DATASET, "recipe": RECIPE, "tables": paths, "manifest_for": list(paths), "source": SOURCE}
    completed = subprocess.run([LAKE_PYTHON, "-c", LANDING, json.dumps(job)], capture_output=True, text=True,
                               timeout=1800, stdin=subprocess.DEVNULL)
    if completed.returncode != 0:
        raise RuntimeError(f"landing exited {completed.returncode}: {(completed.stderr or completed.stdout)[-2000:]}")
    return json.loads(completed.stdout.strip().splitlines()[-1])


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--timeframes", nargs="+", default=TIMEFRAMES, choices=TIMEFRAMES)
    parser.add_argument("--sources", nargs="+", default=SOURCES, choices=SOURCES)
    parser.add_argument("--tables", nargs="+", default=["stationarity_tests", "series_provenance"],
                        choices=["stationarity_tests", "series_provenance"],
                        help="which tables to compute and land (a table already landed is replaced, so name only new ones)")
    parser.add_argument("--no-land", action="store_true", help="compute and print, do not write the lake")
    args = parser.parse_args()
    tables = compute(args.timeframes, args.sources, args.tables)
    for name, frame in tables.items():
        log(f"{name}: {len(frame)} rows")
        print(frame.drop(columns=[c for c in ("note", "loader", "null_hypothesis", "computed_with", "computed_at") if c in frame.columns]).to_string())
    if args.no_land:
        return
    with tempfile.TemporaryDirectory(prefix="study_mnq_eda_30m_") as directory:
        result = retried(lambda: land(tables, directory), attempts=6, pause_seconds=30.0)
    for name, info in result.items():
        log(f"landed {name}: {info['rows']} rows, manifest {info['manifest']}")


if __name__ == "__main__":
    main()
