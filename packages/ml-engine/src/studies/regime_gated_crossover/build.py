"""Land the regime-gated crossover study in the lake, so the dashboard's study page can read it.

    E:/source/repos/ml_dashboard/Trading/quant/.venv/Scripts/python.exe packages/ml-engine/src/studies/regime_gated_crossover/build.py

Replaces ``Trading/quant/analytics/notebooks/regime_gated_crossover.py``, which
recomputed everything inside marimo and landed nothing. This script runs the
notebook's computation exactly, cell for cell, with the notebook's own modules
(``core.lake``, ``regimes.features``, ``regimes.cluster``, ``flow.model._folds``,
``crossovers.crossover``, ``latent.robust``):

* MNQ 1m and 5m bars 2024-03-01 .. 2025-12-01 through ``load_ohlcv_tf`` (the
  naive bare-root splice, as the notebook read it);
* six expanding walk-forward folds on the 5m index with a 100-bar embargo;
* per fold a StandardScaler + k-means (``fit_regimes``, seed 0) on the 1m
  (size, flow) features up to the fold's train end, labelling that fold's own
  test-window 1m rows (fold 0 also labels its own train rows);
* the EMA5 / SMA100 long-short crossover's cost-adjusted 5m net return;
* each 5m bar tagged with the latest 1m regime (merge_asof backward), and the
  25-row future-shifted negative control;
* per regime a circular-block bootstrap BCa interval on the mean net return
  (Politis-White block length floored at 390, 2,000 replicates, one generator
  seeded 0 shared across regimes then the gate, as in the notebook), verdict
  ``trade`` when the interval's low end is above zero;
* the gate: zero the net return outside the trade regimes, Sharpe of both, and
  the BCa interval of the per-bar difference.

It does this for every regime count in ``--regime-counts`` (default 2..8; the
notebook's own run is 4), so the page's regime-count control reads landed
numbers. The notebook's assertions are recorded as ``*_check_passes`` columns
instead of stopping the run.

Tables land under ``s3://derived/study_regime_gated_crossover/recipe=<recipe>/table=<name>/``
with one manifest line each and are served as
``derived_study_regime_gated_crossover_<name>``. A recipe already in the
manifest is never overwritten.
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
from crossovers.crossover import _sharpe as sharpe  # noqa: E402
from crossovers.crossover import ann_factor, backtest, moving_average  # noqa: E402
from flow.model import _folds as folds  # noqa: E402
from latent.robust import (  # noqa: E402
    BLOCK_FLOOR,
    bca_interval,
    block_jackknife_means,
    circular_block_means,
    politis_white_block_length,
)
from regimes.cluster import fit_regimes, transition_matrix  # noqa: E402
from regimes.features import build_features  # noqa: E402

DATASET = "study_regime_gated_crossover"
RECIPE = "notebook_mnq_20240301_20251201"
NOTEBOOK = "Trading/quant/analytics/notebooks/regime_gated_crossover.py"

SYMBOL = "MNQ"
START, END = "2024-03-01", "2025-12-01"
FAST, SLOW, FAST_KIND, SLOW_KIND = 5, 100, "ema", "sma"
FOLD_COUNT = 6
EMBARGO_BARS = 100
FEATURE_WINDOW_BARS = 64
BOOTSTRAP_REPLICATES = 2000
MINIMUM_BARS_FOR_BOOTSTRAP = 500
LEAK_SHIFT_ROWS = 25
SEED = 0


def retrying_lake_connection() -> None:
    """The notebook's lake views, on a DuckDB connection that retries HTTP.

    Same views ``core.lake._serving()`` builds; only the object store's
    transient connection refusals are retried instead of failing the run.
    """
    import duckdb
    from lake.serving import connect

    connection = duckdb.connect()
    for setting in ("SET http_retries=60", "SET http_retry_wait_ms=1000", "SET http_retry_backoff=1.1"):
        connection.execute(setting)
    core_lake._CONNECTION = connect(connection, with_derived=False)


def bootstrap_interval(values: np.ndarray, rng: np.random.Generator) -> dict:
    """The notebook's per-series interval: block length, replicates, jackknife, BCa."""
    politis_white = politis_white_block_length(values)
    block = max(BLOCK_FLOOR, politis_white["b_politis_white"])
    block = min(block, len(values) // 3)
    replicates = circular_block_means(values, block, BOOTSTRAP_REPLICATES, rng)
    jackknife = block_jackknife_means(values, block)
    interval = bca_interval(float(values.mean()), replicates, jackknife)
    return {"block": int(block), "politis_white": int(politis_white["b_politis_white"]), **interval}


def load_frames() -> dict:
    df_1m = load_ohlcv_tf(SYMBOL, "1m", start=START, end=END)
    df_5m = load_ohlcv_tf(SYMBOL, "5m", start=START, end=END)
    print(f"1m: {len(df_1m):,} rows  {df_1m.index[0]} .. {df_1m.index[-1]}")
    print(f"5m: {len(df_5m):,} rows  {df_5m.index[0]} .. {df_5m.index[-1]}")
    folds_5m = list(folds(len(df_5m), FOLD_COUNT, EMBARGO_BARS))
    if len(folds_5m) != FOLD_COUNT:
        raise RuntimeError(f"expected {FOLD_COUNT} folds, got {len(folds_5m)}")
    features_1m = build_features(df_1m, window=FEATURE_WINDOW_BARS)
    cost = cost_points_per_side(SYMBOL)
    net_5m = backtest(df_5m, FAST, SLOW, FAST_KIND, SLOW_KIND, cost, mode="long_short")
    ann = ann_factor(net_5m.index, len(net_5m))

    # The position each net return was earned with (backtest's own lines, shifted one bar).
    close = df_5m["close"]
    fast_line = moving_average(close, FAST, FAST_KIND)
    slow_line = moving_average(close, SLOW, SLOW_KIND)
    position = pd.Series(np.where(fast_line > slow_line, 1.0, -1.0), index=close.index)
    position[fast_line.isna() | slow_line.isna()] = 0.0
    held = position.shift(1).reindex(net_5m.index)

    test_fold = pd.Series(-1, index=net_5m.index, dtype="int64")
    fold_rows = []
    for index, (train, test) in enumerate(folds_5m):
        test_stamps = df_5m.index[test]
        net_test = net_5m.reindex(test_stamps).dropna()
        test_fold.loc[net_test.index] = index
        fold_rows.append({
            "fold": index,
            "train_end_index": int(train.stop),
            "train_bar_count": int(train.stop),
            "train_end_timestamp": df_5m.index[train.stop - 1],
            "test_start_index": int(test.start),
            "test_end_index": int(test.stop),
            "test_bar_count": int(test.stop - test.start),
            "test_start_timestamp": df_5m.index[test.start],
            "test_end_timestamp": df_5m.index[test.stop - 1],
            "out_of_sample_sharpe": sharpe(net_test.to_numpy(), ann),
            "out_of_sample_bar_count": int(len(net_test)),
        })
    net_frame = pd.DataFrame({
        "timestamp": net_5m.index,
        "close": close.reindex(net_5m.index).to_numpy(dtype=np.float64),
        "position_held": held.to_numpy(dtype=np.float64),
        "net_return": net_5m.to_numpy(dtype=np.float64),
        "test_fold": test_fold.to_numpy(dtype=np.int64),
    })
    return {"df_1m": df_1m, "df_5m": df_5m, "folds_5m": folds_5m, "features_1m": features_1m, "cost": cost,
            "net_5m": net_5m, "ann": ann, "fold_rows": fold_rows, "net_frame": net_frame}


def run_regime_count(frames: dict, regime_count: int) -> dict:
    df_5m, features_1m, net_5m, ann = frames["df_5m"], frames["features_1m"], frames["net_5m"], frames["ann"]
    regime_labels = pd.Series(index=features_1m.index, dtype="Int64")
    labelled_by = pd.Series(-1, index=features_1m.index, dtype="int64")
    in_sample = pd.Series(False, index=features_1m.index)
    stickiness, transitions, centers = [], [], []
    for index, (train, test) in enumerate(frames["folds_5m"]):
        train_end = df_5m.index[train.stop - 1]
        test_end = df_5m.index[test.stop - 1]
        train_mask = features_1m.index <= train_end
        fold_mask = features_1m.index <= test_end
        train_1m = features_1m.loc[train_mask]
        if len(train_1m) < regime_count * 50:
            raise RuntimeError(f"fold {index}: only {len(train_1m)} 1m train rows, too few for k={regime_count}")
        model = fit_regimes(train_1m, k=regime_count, seed=0)
        to_assign = features_1m.loc[fold_mask & ~train_mask]
        if len(to_assign) > 0:
            regime_labels.loc[to_assign.index] = model.assign(to_assign)
            labelled_by.loc[to_assign.index] = index
            in_sample.loc[to_assign.index] = False
        train_labels = model.assign(train_1m)
        if index == 0:
            regime_labels.loc[train_1m.index] = train_labels
            labelled_by.loc[train_1m.index] = 0
            in_sample.loc[train_1m.index] = True
        matrix = transition_matrix(train_labels, regime_count)
        counts = np.zeros((regime_count, regime_count))
        for a, b in zip(train_labels[:-1], train_labels[1:]):
            counts[a, b] += 1.0
        diagonal = float(np.diag(matrix).mean())
        stickiness.append({"fold": index, "training_one_minute_rows": int(len(train_1m)), "transition_diagonal_mean": diagonal})
        for source in range(regime_count):
            for target in range(regime_count):
                transitions.append({"regime_count": regime_count, "fold": index, "from_regime": source, "to_regime": target,
                                    "transition_count": int(counts[source, target]),
                                    "probability": float(matrix.iloc[source, target])})
        center_frame = model.centers()
        occupancy = np.bincount(train_labels, minlength=regime_count)
        for regime in range(regime_count):
            centers.append({"regime_count": regime_count, "fold": index, "regime": regime,
                            "size_center": float(center_frame.loc[regime, "size"]),
                            "flow_center": float(center_frame.loc[regime, "flow"]),
                            "training_rows": int(occupancy[regime]),
                            "training_share": float(occupancy[regime] / len(train_labels))})
    labelled = regime_labels.notna()
    labels_frame = pd.DataFrame({
        "regime_count": regime_count,
        "timestamp": features_1m.index[labelled.to_numpy()],
        "regime": regime_labels[labelled].astype(int).to_numpy(dtype=np.int64),
        "labelled_by_fold": labelled_by[labelled].to_numpy(dtype=np.int64),
        "labelled_in_sample": in_sample[labelled].to_numpy(dtype=bool),
    })
    regime_labels = regime_labels.dropna().astype(int)
    mean_diagonal = float(np.mean([row["transition_diagonal_mean"] for row in stickiness]))

    # Tag each 5m net-return bar with the latest 1m regime (notebook cell 9).
    regime_frame = regime_labels.rename("regime").to_frame()
    net_frame = net_5m.rename("net").to_frame()
    tagged = pd.merge_asof(net_frame.sort_index(), regime_frame.sort_index(), left_index=True, right_index=True, direction="backward")
    untagged = int(tagged["regime"].isna().sum())
    tagged = tagged.dropna(subset=["regime"])
    tagged["regime"] = tagged["regime"].astype(int)

    # Negative control: labels shifted 25 rows into the future (notebook cell 10).
    shifted = regime_labels.shift(-LEAK_SHIFT_ROWS).rename("regime").dropna().to_frame()
    tagged_leaky = pd.merge_asof(net_frame.sort_index(), shifted.sort_index(), left_index=True, right_index=True,
                                 direction="backward").dropna(subset=["regime"])
    tagged_leaky["regime"] = tagged_leaky["regime"].astype(int)
    causal_means = tagged.groupby("regime")["net"].mean()
    leaky_means = tagged_leaky.groupby("regime")["net"].mean()
    difference = (causal_means - leaky_means).abs()
    leak_rows = [{"regime_count": regime_count, "regime": int(regime),
                  "causal_mean_net_return": float(causal_means.get(regime, np.nan)),
                  "leaky_mean_net_return": float(leaky_means.get(regime, np.nan)),
                  "absolute_difference": float(difference.get(regime, np.nan)),
                  "causal_bar_count": int((tagged["regime"] == regime).sum()),
                  "leaky_bar_count": int((tagged_leaky["regime"] == regime).sum())}
                 for regime in sorted(set(causal_means.index) | set(leaky_means.index))]

    # Per-regime verdicts (notebook cell 11); one generator, seeded once, shared with the gate.
    rng = np.random.default_rng(SEED)
    verdict_rows = []
    for regime in sorted(tagged["regime"].unique()):
        values = tagged.loc[tagged["regime"] == regime, "net"].to_numpy(dtype=np.float64)
        row = {"regime_count": regime_count, "regime": int(regime), "bar_count": int(len(values)),
               "mean_net_return": float(values.mean()), "standard_deviation": float(values.std(ddof=1)),
               "bca_low": None, "bca_high": None, "percentile_low": None, "percentile_high": None,
               "block_length": None, "politis_white_block_length": None, "bias_correction": None,
               "acceleration": None, "fraction_replicates_at_or_below_zero": None, "verdict": "insufficient_sample"}
        if len(values) >= MINIMUM_BARS_FOR_BOOTSTRAP:
            interval = bootstrap_interval(values, rng)
            row.update({"bca_low": interval["bca_lo"], "bca_high": interval["bca_hi"],
                        "percentile_low": interval["pct_lo"], "percentile_high": interval["pct_hi"],
                        "block_length": interval["block"], "politis_white_block_length": interval["politis_white"],
                        "bias_correction": interval["z0"], "acceleration": interval["acceleration"],
                        "fraction_replicates_at_or_below_zero": interval["frac_reps_le_zero"],
                        "verdict": "trade" if interval["bca_lo"] > 0.0 else "sit_out"})
        verdict_rows.append(row)
        print(f"  k={regime_count} regime {regime}: n={len(values):,} mean={values.mean():.3e} "
              f"CI [{row['bca_low']}, {row['bca_high']}] -> {row['verdict']}")
    trade = sorted(row["regime"] for row in verdict_rows if row["verdict"] == "trade")

    # The gate (notebook cells 13-14).
    baseline = tagged["net"].to_numpy(dtype=np.float64)
    gate_mask = tagged["regime"].isin(trade).to_numpy()
    gated = np.where(gate_mask, baseline, 0.0)
    effect = gated - baseline
    gate = {"regime_count": regime_count, "trade_regimes": ",".join(str(r) for r in trade),
            "sit_out_regimes": ",".join(str(r["regime"]) for r in verdict_rows if r["verdict"] == "sit_out"),
            "baseline_sharpe": sharpe(baseline, ann), "gated_sharpe": sharpe(gated, ann),
            "mean_per_bar_effect": float(effect.mean()), "bar_count": int(len(effect)),
            "bars_gated_out": int((~gate_mask).sum()),
            "bca_low": None, "bca_high": None, "percentile_low": None, "percentile_high": None,
            "block_length": None, "politis_white_block_length": None, "bias_correction": None, "acceleration": None,
            "bootstrap_mean": None, "bootstrap_standard_deviation": None,
            "fraction_replicates_at_or_below_zero": None, "status": "no_op"}
    if not np.allclose(effect, 0.0):
        interval = bootstrap_interval(effect, rng)
        gate.update({"bca_low": interval["bca_lo"], "bca_high": interval["bca_hi"],
                     "percentile_low": interval["pct_lo"], "percentile_high": interval["pct_hi"],
                     "block_length": interval["block"], "politis_white_block_length": interval["politis_white"],
                     "bias_correction": interval["z0"], "acceleration": interval["acceleration"],
                     "bootstrap_mean": interval["boot_mean"], "bootstrap_standard_deviation": interval["boot_std"],
                     "fraction_replicates_at_or_below_zero": interval["frac_reps_le_zero"],
                     "status": "ship" if interval["bca_lo"] > 0.0 else "do_not_ship"})
    print(f"  k={regime_count} gate: baseline {gate['baseline_sharpe']:.3f} gated {gate['gated_sharpe']:.3f} "
          f"effect {gate['mean_per_bar_effect']:.3e} CI [{gate['bca_low']}, {gate['bca_high']}] -> {gate['status']}")

    fold_rows = [{"regime_count": regime_count, **base,
                  "training_one_minute_rows": extra["training_one_minute_rows"],
                  "transition_diagonal_mean": extra["transition_diagonal_mean"]}
                 for base, extra in zip(frames["fold_rows"], stickiness)]
    oos = [row["out_of_sample_sharpe"] for row in frames["fold_rows"]]
    run = {
        "regime_count": regime_count, "symbol": SYMBOL, "window_start": START, "window_end": END,
        "fast_period": FAST, "slow_period": SLOW, "fast_kind": FAST_KIND, "slow_kind": SLOW_KIND,
        "fold_count": FOLD_COUNT, "embargo_bars": EMBARGO_BARS, "feature_window_bars": FEATURE_WINDOW_BARS,
        "bootstrap_replicates": BOOTSTRAP_REPLICATES, "minimum_bars_for_bootstrap": MINIMUM_BARS_FOR_BOOTSTRAP,
        "block_floor_bars": BLOCK_FLOOR, "leak_shift_rows": LEAK_SHIFT_ROWS, "seed": SEED,
        "cost_points_per_side": frames["cost"], "annualisation_bars_per_year": ann,
        "one_minute_rows": len(frames["df_1m"]), "five_minute_rows": len(df_5m),
        "feature_rows": len(features_1m), "labelled_one_minute_rows": len(labels_frame),
        "net_return_bars": len(net_5m), "tagged_bar_count": len(tagged), "untagged_bar_count": untagged,
        "mean_transition_diagonal": mean_diagonal, "chance_transition_diagonal": 1.0 / regime_count,
        "stickiness_check_passes": bool(mean_diagonal > 1.3 / regime_count),
        "mean_walk_forward_sharpe": float(np.mean(oos)),
        "walk_forward_sharpe_check_passes": bool(np.mean(oos) > 0.3),
        "leak_control_maximum_difference": float(difference.max()),
        "leak_control_check_passes": bool(difference.max() > 1e-6),
        "resolved_regime_count": int(sum(r["verdict"] != "insufficient_sample" for r in verdict_rows)),
        "resolved_regime_check_passes": bool(sum(r["verdict"] != "insufficient_sample" for r in verdict_rows) >= 2),
        "notebook": NOTEBOOK,
    }
    return {"runs": [run], "folds": fold_rows, "transitions": transitions, "centers": centers,
            "verdicts": verdict_rows, "leak_control": leak_rows, "gate": [gate], "labels_1m": labels_frame}


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
    parser.add_argument("--regime-counts", default="2,3,4,5,6,7,8", help="comma-separated k values (the notebook ran 4)")
    parser.add_argument("--dry-run", action="store_true", help="compute and write local parquet, do not land")
    parser.add_argument("--output", default=None, help="local directory for the parquet files (default: a temp dir)")
    arguments = parser.parse_args()
    regime_counts = [int(value) for value in arguments.regime_counts.split(",") if value.strip()]

    if not arguments.dry_run and manifest_has_recipe():
        print(f"recipe {RECIPE} is already landed in {DATASET}; refusing to overwrite it")
        return 1

    started = time.time()
    retrying_lake_connection()
    frames = load_frames()
    collected: dict[str, list] = {}
    for regime_count in regime_counts:
        print(f"regime count {regime_count}")
        result = run_regime_count(frames, regime_count)
        for name, value in result.items():
            collected.setdefault(name, []).append(value if isinstance(value, pd.DataFrame) else pd.DataFrame(value))

    tables = {name: pd.concat(parts, ignore_index=True) for name, parts in collected.items()}
    tables["net_returns_5m"] = frames["net_frame"]
    features = frames["features_1m"].rename_axis("timestamp").reset_index()
    tables["features_1m"] = features[["timestamp", "log_range", "log_volume", "size", "flow", "next_log_range"]]

    directory = arguments.output or tempfile.mkdtemp(prefix="regime_gated_crossover_")
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

    landing = store.land(paths, RECIPE, f"{NOTEBOOK} via packages/ml-engine/src/studies/regime_gated_crossover/build.py", dataset=DATASET)
    for name, info in landing.items():
        print(f"landed {name}: {info['rows']:,} rows, manifest {info['manifest']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
