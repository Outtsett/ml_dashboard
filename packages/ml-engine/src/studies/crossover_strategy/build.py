"""Land the crossover-strategy study's authoritative numbers in the lake.

    E:/source/repos/datalake/.venv/Scripts/python.exe packages/ml-engine/src/studies/crossover_strategy/build.py

Replaces ``Trading/quant/analytics/notebooks/crossover_visualization.py``. The
notebook computed the EMA(5) x SMA(100) equity curve and drawdown inline (the
study page recomputes those live from the lake's 5-minute bars) but its prose
quoted figures that it never computed ("validated ~1.8", "OOS 0.203"). Those
come from the analytics package's own sweep and reality check, which this
script runs with the package's own modules (``core.lake``, ``core.costs``,
``crossovers.crossover``, ``crossovers.moneytest``) on the notebook's exact
window (MNQ 5m, 2024-03-01 .. 2025-12-01, the bare-root splice through
``load_ohlcv_tf``) and lands:

* ``run_information``   one row: window, cost, annualisation, split, search size;
* ``sweep``             every (fast kind, slow kind, fast, slow) pair in the
                        moneytest grid with in-sample / out-of-sample / full
                        Sharpe, total return, maximum drawdown, trade count and
                        the in-sample rank the selection used;
* ``reality_check``     per candidate (the notebook's pair and the in-sample
                        winner): block-bootstrap interval on the Sharpe and the
                        Deflated Sharpe Ratio against the whole search;
* ``walk_forward_folds`` per candidate, the after-cost Sharpe of each of six
                        equal time chunks;
* ``reference_rules``   the same engine on two baselines: MACD(12,26,9)
                        signal-line crossing, and buy and hold.

Tables land under ``s3://derived/study_crossover_strategy/recipe=<recipe>/table=<name>/``
with one manifest line each and are served as
``derived_study_crossover_strategy_<name>``. A recipe already in the manifest
is never overwritten.
"""

from __future__ import annotations

import argparse
import json
import sys
import tempfile
import time
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[4]
ANALYTICS = ROOT / "Trading" / "quant" / "analytics"
sys.path.insert(0, str(ROOT / "src" / "ml"))
sys.path.insert(0, str(ANALYTICS))

import core.lake as core_lake  # noqa: E402
from core.costs import cost_points_per_side  # noqa: E402
from core.lake import load_ohlcv_tf  # noqa: E402
from crossovers import moneytest  # noqa: E402
from crossovers.crossover import _max_drawdown, _sharpe, ann_factor, backtest, sweep  # noqa: E402

DATASET = "study_crossover_strategy"
RECIPE = "notebook_mnq_5m_20240301_20251201"
NOTEBOOK = "Trading/quant/analytics/notebooks/crossover_visualization.py"

SYMBOL = "MNQ"
TIMEFRAME = "5m"
START, END = "2024-03-01", "2025-12-01"
NOTEBOOK_PAIR = {"fast_kind": "ema", "slow_kind": "sma", "fast": 5, "slow": 100}
TRAIN_FRACTION = 0.70
MODE = "long_short"
FOLD_COUNT = 6
SEARCH_TIMEFRAMES = 7
NOTEBOOK_CLAIMED_MACD_OUT_OF_SAMPLE_SHARPE = 0.203


def retrying_lake_connection() -> None:
    """The notebook's lake views, on a DuckDB connection that retries HTTP."""
    import duckdb
    from lake.serving import connect

    connection = duckdb.connect()
    for setting in ("SET http_retries=60", "SET http_retry_wait_ms=1000", "SET http_retry_backoff=1.1"):
        connection.execute(setting)
    core_lake._CONNECTION = connect(connection, with_derived=False)


def split_sharpes(net: pd.Series, annualisation: float, split_timestamp) -> dict:
    in_sample = net[net.index < split_timestamp].to_numpy()
    out_of_sample = net[net.index >= split_timestamp].to_numpy()
    return {
        "in_sample_sharpe": _sharpe(in_sample, annualisation),
        "out_of_sample_sharpe": _sharpe(out_of_sample, annualisation),
        "full_sample_sharpe": _sharpe(net.to_numpy(), annualisation),
    }


def reference_rules(frame: pd.DataFrame, cost_points: float, annualisation: float, split_timestamp) -> pd.DataFrame:
    close = frame["close"]
    percent = close.pct_change()
    rows = []

    macd = close.ewm(span=12, adjust=False).mean() - close.ewm(span=26, adjust=False).mean()
    signal = macd.ewm(span=9, adjust=False).mean()
    macd_position = np.sign(macd - signal)
    macd_cost = (cost_points / close) * macd_position.diff().abs()
    macd_net = (macd_position.shift(1) * percent - macd_cost).dropna()
    rows.append({
        "rule": "macd_signal_line_crossing",
        "description": "long above the MACD(12,26,9) signal line, short below, always in, same cost per side",
        **split_sharpes(macd_net, annualisation, split_timestamp),
        "total_return_fraction": float(np.prod(1.0 + macd_net.to_numpy()) - 1.0),
        "maximum_drawdown_fraction": _max_drawdown(macd_net.to_numpy()),
        "trade_count": int((macd_position.diff().fillna(0) != 0).sum()),
        "notebook_claimed_out_of_sample_sharpe": NOTEBOOK_CLAIMED_MACD_OUT_OF_SAMPLE_SHARPE,
    })

    buy_hold_net = percent.iloc[1:]
    rows.append({
        "rule": "buy_and_hold",
        "description": "long one contract throughout, no trading cost after entry",
        **split_sharpes(buy_hold_net, annualisation, split_timestamp),
        "total_return_fraction": float(np.prod(1.0 + buy_hold_net.to_numpy()) - 1.0),
        "maximum_drawdown_fraction": _max_drawdown(buy_hold_net.to_numpy()),
        "trade_count": 1,
        "notebook_claimed_out_of_sample_sharpe": None,
    })
    return pd.DataFrame(rows)


def reality_check_for(candidate: str, row: pd.Series, frame: pd.DataFrame, table: pd.DataFrame, cost_points: float,
                      annualisation: float) -> tuple[dict, list[dict]]:
    """moneytest's three tests on one (fast kind, slow kind, fast, slow) pair."""
    net = backtest(frame, int(row["fast"]), int(row["slow"]), row["fast_kind"], row["slow_kind"], cost_points, MODE).to_numpy()
    edges = np.linspace(0, len(net), FOLD_COUNT + 1, dtype=int)
    fold_sharpes = [_sharpe(net[edges[i]:edges[i + 1]], annualisation) for i in range(FOLD_COUNT)]
    block = moneytest._acf_block_size(net)
    low, median, high = moneytest._bootstrap_sharpe_ci(net, annualisation, block)
    trials = int(len(table)) * SEARCH_TIMEFRAMES
    deflated = moneytest._deflated_sharpe(net, table["sharpe_full"].to_numpy(), annualisation, trials)
    losing = int(sum(value <= 0 for value in fold_sharpes))
    result = {
        "candidate": candidate,
        "configuration_label": row["config"],
        "fast_kind": row["fast_kind"],
        "slow_kind": row["slow_kind"],
        "fast_period": int(row["fast"]),
        "slow_period": int(row["slow"]),
        "full_sample_sharpe": float(row["sharpe_full"]),
        "total_return_fraction": float(row["total_return"]),
        "walk_forward_fold_count": FOLD_COUNT,
        "walk_forward_median_sharpe": float(np.median(fold_sharpes)),
        "walk_forward_losing_fold_count": losing,
        "bootstrap_block_bars": int(block),
        "bootstrap_replicate_count": 2000,
        "bootstrap_seed": 42,
        "bootstrap_interval_low": low,
        "bootstrap_median": median,
        "bootstrap_interval_high": high,
        "bootstrap_interval_includes_zero": bool(low <= 0.0 <= high),
        "per_bar_sharpe": deflated["sr_perobs"],
        "selection_null_per_bar_sharpe": deflated["sr0_perobs"],
        "return_skewness": deflated["skew"],
        "return_kurtosis_pearson": deflated["kurtosis"],
        "trial_count": deflated["n_trials"],
        "deflated_sharpe_ratio": deflated["dsr"],
        "survives_reality_check": bool(low > 0 and deflated["dsr"] > 0.95 and losing <= FOLD_COUNT // 3),
    }
    folds = [{"candidate": candidate, "fold": i, "start_index": int(edges[i]), "end_index": int(edges[i + 1]), "sharpe": fold_sharpes[i]}
             for i in range(FOLD_COUNT)]
    return result, folds


def compute() -> dict[str, pd.DataFrame]:
    cost_points = cost_points_per_side(SYMBOL)
    frame = load_ohlcv_tf(SYMBOL, TIMEFRAME, start=START, end=END)
    annualisation = ann_factor(frame.index, len(frame))
    table, meta = sweep(frame, moneytest.FAST_GRID, moneytest.SLOW_GRID, cost_pts=cost_points, mode=MODE, train_frac=TRAIN_FRACTION)
    split_timestamp = frame.index[int(len(frame) * TRAIN_FRACTION)]

    table = table.copy()
    table["in_sample_rank"] = np.arange(1, len(table) + 1)
    is_notebook_pair = (
        (table["fast_kind"] == NOTEBOOK_PAIR["fast_kind"]) & (table["slow_kind"] == NOTEBOOK_PAIR["slow_kind"])
        & (table["fast"] == NOTEBOOK_PAIR["fast"]) & (table["slow"] == NOTEBOOK_PAIR["slow"])
    )
    notebook_row = table[is_notebook_pair].iloc[0]
    winner_row = table.iloc[0]

    checks, folds = [], []
    for candidate, row in (("notebook_pair", notebook_row), ("in_sample_winner", winner_row)):
        check, fold_rows = reality_check_for(candidate, row, frame, table, cost_points, annualisation)
        checks.append(check)
        folds.extend(fold_rows)

    sweep_frame = pd.DataFrame({
        "configuration_label": table["config"],
        "fast_kind": table["fast_kind"],
        "slow_kind": table["slow_kind"],
        "fast_period": table["fast"].astype(int),
        "slow_period": table["slow"].astype(int),
        "in_sample_sharpe": table["sharpe_is"],
        "out_of_sample_sharpe": table["sharpe_oos"],
        "full_sample_sharpe": table["sharpe_full"],
        "total_return_fraction": table["total_return"],
        "maximum_drawdown_fraction": table["max_drawdown"],
        "trade_count": table["n_trades"].astype(int),
        "in_sample_rank": table["in_sample_rank"],
        "is_notebook_pair": is_notebook_pair.to_numpy(),
        "is_in_sample_winner": (table["in_sample_rank"] == 1).to_numpy(),
    })

    run = {
        "symbol": SYMBOL,
        "timeframe": TIMEFRAME,
        "price_series": "bare-root MNQ symbol of ohlcv_5m (naive front-month splice, roll gaps left in), as the notebook read it",
        "window_start": START,
        "window_end": END,
        "bar_count": int(len(frame)),
        "first_bar_timestamp": frame.index[0].isoformat(),
        "last_bar_timestamp": frame.index[-1].isoformat(),
        "mode": MODE,
        "cost_points_per_side": float(cost_points),
        "train_fraction": TRAIN_FRACTION,
        "split_timestamp": split_timestamp.isoformat(),
        "annualisation_bars_per_year": float(annualisation),
        "sweep_pair_count": int(len(table)),
        "search_timeframe_count": SEARCH_TIMEFRAMES,
        "notebook_fast_kind": NOTEBOOK_PAIR["fast_kind"],
        "notebook_slow_kind": NOTEBOOK_PAIR["slow_kind"],
        "notebook_fast_period": NOTEBOOK_PAIR["fast"],
        "notebook_slow_period": NOTEBOOK_PAIR["slow"],
        "notebook_pair_in_sample_rank": int(notebook_row["in_sample_rank"]),
        "notebook": NOTEBOOK,
    }
    return {
        "run_information": pd.DataFrame([run]),
        "sweep": sweep_frame,
        "reality_check": pd.DataFrame(checks),
        "walk_forward_folds": pd.DataFrame(folds),
        "reference_rules": reference_rules(frame, cost_points, annualisation, split_timestamp),
    }


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
    parser.add_argument("--dry-run", action="store_true", help="compute and write local parquet, do not land")
    parser.add_argument("--output", default=None, help="local directory for the parquet files (default: a temp dir)")
    arguments = parser.parse_args()

    if not arguments.dry_run and manifest_has_recipe():
        print(f"recipe {RECIPE} is already landed in {DATASET}; refusing to overwrite it")
        return 1

    started = time.time()
    retrying_lake_connection()
    tables = compute()

    directory = arguments.output or tempfile.mkdtemp(prefix="crossover_strategy_")
    Path(directory).mkdir(parents=True, exist_ok=True)
    paths = {}
    for name, frame in tables.items():
        path = str(Path(directory) / f"{name}.parquet")
        frame.to_parquet(path, index=False)
        paths[name] = path
        print(f"{name}: {len(frame):,} rows -> {path}")
    print(f"computed in {time.time() - started:.0f} s")
    if arguments.dry_run:
        return 0

    from ta_strategy import store

    landing = store.land(paths, RECIPE, f"{NOTEBOOK} via packages/ml-engine/src/studies/crossover_strategy/build.py", dataset=DATASET)
    for name, info in landing.items():
        print(f"landed {name}: {info['rows']:,} rows, manifest {info['manifest']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
