r"""Land the quantlab walk-forward out-of-sample results in the lake.

The notebook ``Trading/quantlab/notebooks/oos_results.py`` read three tables
from ``s3://derived/recipe=quant_oos_v1/`` (``folds``, ``conviction``,
``summary``). That recipe was never landed under that name: the run wrote the
same tables to ``s3://derived/recipe=quantgo_oos_v1/`` (before the repository
rename), a layout the dashboard's manifest-driven views do not match, and the
notebook hard-coded two numbers it could not read back (E|y| = 1.8344e-04 and
the pooled accuracy 0.506579).

This job takes the run's own output, ``Trading/quantlab/results/{folds,
conviction}.parquet`` and ``summary.json`` (written by
``scripts/run_oos_evaluation.py``, 2026-09-16), checks it cell for cell against
the copy in the lake when that is reachable, re-measures the two hard-coded
numbers with the run's own data pipeline (no training, no GPU), and lands:

    s3://derived/study_quant_oos_results/recipe=<recipe>/table=folds/
    s3://derived/study_quant_oos_results/recipe=<recipe>/table=conviction/
    s3://derived/study_quant_oos_results/recipe=<recipe>/table=summary/
    s3://derived/study_quant_oos_results/recipe=<recipe>/table=fold_targets/

The dashboard serves them as ``derived_study_quant_oos_results_<table>`` once
the manifest lines land (``POST /api/labels/catalog/refresh`` or the next boot).

An existing recipe is never overwritten: pass ``--recipe`` for a new one.

    E:/source/repos/ml_dashboard/Trading/quant/.venv/Scripts/python.exe packages/ml-engine/src/studies/quant_oos_results/build.py
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
import time
from pathlib import Path

import numpy as np
import pandas as pd

ML_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ML_ROOT))

from ta_strategy.store import land, write_local  # noqa: E402

DATASET = "study_quant_oos_results"
DEFAULT_RECIPE = "walk_forward_2026_09_16"
QUANTLAB = ML_ROOT.parents[1] / "Trading" / "quantlab"
LAKE_BARS_DIR = ML_ROOT.parents[1] / "Trading" / "legacy_strategies" / "research"
LAKE_COPY = "s3://derived/recipe=quantgo_oos_v1"


def read_results() -> tuple[pd.DataFrame, pd.DataFrame, dict]:
    results = QUANTLAB / "results"
    folds = pd.read_parquet(results / "folds.parquet")
    conviction = pd.read_parquet(results / "conviction.parquet")
    summary = json.loads((results / "summary.json").read_text(encoding="utf-8"))
    return folds, conviction, summary


def compare_with_lake_copy(folds: pd.DataFrame, conviction: pd.DataFrame) -> None:
    """Report whether the landed quantgo_oos_v1 tables equal the run's output. Read-only.

    The lake's object store answers a connection refusal now and then, so each
    read is tried a few times before the comparison is skipped.
    """
    try:
        import duckdb

        connection = duckdb.connect()
        connection.execute("INSTALL httpfs")
        connection.execute("LOAD httpfs")
        connection.execute("SET s3_endpoint='127.0.0.1:9100'")
        connection.execute("SET s3_access_key_id='" + os.environ.get("MINIO_USER", "lakeadmin") + "'")
        connection.execute("SET s3_secret_access_key='" + os.environ.get("MINIO_PASSWORD", "lakeadmin-dev") + "'")
        connection.execute("SET s3_use_ssl=false")
        connection.execute("SET s3_url_style='path'")
        for name, local, order in (("folds", folds, "fold_index"), ("conviction", conviction, "fold_index, traded_fraction")):
            remote = None
            for _attempt in range(10):
                try:
                    remote = connection.execute(f"SELECT * FROM read_parquet('{LAKE_COPY}/table={name}/*.parquet', hive_partitioning = false) ORDER BY {order}").fetchdf()
                    break
                except Exception:
                    time.sleep(2)
            if remote is None:
                print(f"lake copy table={name}: not reachable, not compared")
                continue
            local = local.sort_values(order.split(", ")).reset_index(drop=True)
            same = list(remote.columns) == list(local.columns) and len(remote) == len(local)
            if same:
                for column in local.columns:
                    a, b = local[column].reset_index(drop=True), remote[column].reset_index(drop=True)
                    if a.dtype.kind in "fc":
                        same = same and bool(np.allclose(a.to_numpy(float), b.to_numpy(float), rtol=0, atol=0, equal_nan=True))
                    else:
                        same = same and bool((a.astype(str) == b.astype(str)).all())
            print(f"lake copy {LAKE_COPY} table={name}: {'identical to the run output' if same else 'DIFFERS from the run output'} ({len(remote)} rows)")
    except Exception as exception:  # the lake copy is a cross-check, not an input
        print(f"lake copy not compared ({type(exception).__name__}: {exception})")


def remeasure_targets(summary: dict) -> tuple[pd.DataFrame, dict]:
    """The pooled out-of-sample targets, rebuilt with the run's own pipeline and fold arithmetic.

    Nothing is trained: ``evaluate_walk_forward`` cuts the windowed dataset into
    equal slices with a purge gap, so the test targets of every fold are a pure
    function of the bars. Bars, windows and the fold sizes are checked against
    what the run recorded before anything is used.
    """
    sys.path.insert(0, str(QUANTLAB / "src"))
    from quant import data as data_module

    data_module.LAKE_BARS_DIR = str(LAKE_BARS_DIR)  # the research folder moved under ml_dashboard/Trading
    config = summary["context"]["config"]
    bars = data_module.load_bars(config["symbol_root"], config["start_date"], config["end_date"], config["timeframe"])
    vectors = data_module.vectorize(bars)
    normalized = data_module.normalize(vectors, window=config["normalization_window"])
    dataset = data_module.window_into_tensor(normalized, config["sequence_length"])

    recorded = summary["context"]
    if len(bars) != recorded["bar_count"] or len(dataset) != recorded["window_count"]:
        raise RuntimeError(
            f"the lake's bars no longer match the run: {len(bars)} bars / {len(dataset)} windows "
            f"now, {recorded['bar_count']} / {recorded['window_count']} recorded"
        )

    total = len(dataset)
    slice_size = total // (config["fold_count"] + 1)
    rows = []
    pooled_targets = []
    pooled_prices = []
    for fold_index in range(config["fold_count"]):
        train_end = slice_size * (fold_index + 1)
        test_start = train_end + config["purge_windows"]
        test_end = min(test_start + slice_size, total)
        targets = np.asarray(dataset.targets[test_start:test_end], dtype=np.float64)
        prices = np.asarray(dataset.window_end_close_price[test_start:test_end], dtype=np.float64)
        pooled_targets.append(targets)
        pooled_prices.append(prices)
        rows.append(
            {
                "fold_index": fold_index,
                "test_window_count": int(targets.size),
                "nonzero_target_window_count": int((targets != 0).sum()),
                "mean_absolute_target": float(np.abs(targets).mean()),
                "mean_window_end_close_price": float(prices.mean()),
            }
        )
    fold_targets = pd.DataFrame(rows)
    targets = np.concatenate(pooled_targets)
    prices = np.concatenate(pooled_prices)
    measured = {
        "pooled_mean_absolute_target": float(np.abs(targets).mean()),
        "pooled_target_standard_deviation": float(targets.std(ddof=1)),
        "pooled_nonzero_target_window_count": int((targets != 0).sum()),
        "pooled_mean_window_end_close_price": float(prices.mean()),
        "pooled_minimum_window_end_close_price": float(prices.min()),
        "pooled_maximum_window_end_close_price": float(prices.max()),
    }
    return fold_targets, measured


def build_summary(folds: pd.DataFrame, fold_targets: pd.DataFrame, measured: dict, summary: dict) -> pd.DataFrame:
    pooled = summary["pooled"]
    context = summary["context"]
    config = context["config"]
    if int(fold_targets["test_window_count"].sum()) != pooled["total_test_windows"]:
        raise RuntimeError("re-measured fold sizes do not add up to the run's total_test_windows")
    if not np.array_equal(fold_targets["test_window_count"].to_numpy(), folds["test_window_count"].to_numpy()):
        raise RuntimeError("re-measured fold sizes differ from the run's per-fold test_window_count")

    nonzero = fold_targets["nonzero_target_window_count"].to_numpy(dtype=float)
    accuracy_nonzero = float((folds["directional_accuracy"].to_numpy() * nonzero).sum() / nonzero.sum())
    row: dict = {key: value for key, value in pooled.items()}
    row.update(
        {
            "pooled_directional_accuracy_nonzero_weighted": accuracy_nonzero,
            "bar_count": context["bar_count"],
            "window_count": context["window_count"],
            "first_timestamp": context["first_timestamp"],
            "last_timestamp": context["last_timestamp"],
            "symbol_root": config["symbol_root"],
            "timeframe": config["timeframe"],
            "sequence_length": config["sequence_length"],
            "purge_windows": config["purge_windows"],
            "maximum_training_steps": config["max_steps"],
            "round_turn_cost_points": config["round_turn_cost_points"],
            "round_turn_cost_log_return": config["round_turn_cost_log_return"],
        }
    )
    row.update(measured)
    for key, value in context["target_distribution"].items():
        row[f"target_{key}"] = value
    return pd.DataFrame([row])


def recipe_exists(recipe: str) -> bool:
    from lake.layout import arrow_fs, arrow_key, derived_root

    key = arrow_key(derived_root(DATASET, recipe) / "table=folds" / "part-0.parquet")
    return arrow_fs().get_file_info(key).type.name != "NotFound"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--recipe", default=DEFAULT_RECIPE)
    parser.add_argument("--dry-run", action="store_true", help="measure and print, land nothing")
    args = parser.parse_args()

    if not args.dry_run and recipe_exists(args.recipe):
        print(f"recipe {args.recipe} is already landed under {DATASET}; pass --recipe for a new one", file=sys.stderr)
        return 1

    folds, conviction, summary = read_results()
    print(f"read results: folds {folds.shape}, conviction {conviction.shape}")
    compare_with_lake_copy(folds, conviction)
    fold_targets, measured = remeasure_targets(summary)
    print("re-measured pooled out-of-sample targets:")
    for key, value in measured.items():
        print(f"  {key} = {value}")
    summary_frame = build_summary(folds, fold_targets, measured, summary)
    print(f"pooled accuracy, test-window weighted {summary['pooled']['pooled_directional_accuracy']:.6f}; "
          f"nonzero-target weighted {summary_frame['pooled_directional_accuracy_nonzero_weighted'].iloc[0]:.6f}")
    if args.dry_run:
        return 0

    tables = {"folds": folds, "conviction": conviction, "summary": summary_frame, "fold_targets": fold_targets}
    with tempfile.TemporaryDirectory() as scratch:
        paths = write_local(tables, scratch)
        landed = land(
            paths,
            args.recipe,
            source=(
                "Trading/quantlab/results/{folds,conviction}.parquet + summary.json from scripts/run_oos_evaluation.py "
                "(2026-09-16, recipe quantgo_oos_v1 in the lake); pooled target statistics re-measured from the lake's "
                "MNQ 1m bars with quant.data"
            ),
            dataset=DATASET,
        )
    for name, detail in landed.items():
        print(f"  {name}: {detail['rows']:,} rows, {detail['bytes']:,} bytes, manifest {detail['manifest']}, {detail['uri']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
