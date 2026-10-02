"""Land the label audit's numbers in the lake: ``s3://derived/study_label_audit_1m/recipe=<recipe>/table=<name>/``.

Replaces the computation of Trading/quant/model/notebooks/label_audit.py (the
"label-audit-1m" study page). The page computes everything that is plain SQL over
``mnq_labels_1m`` live (direction up-rates, per-year rates, the flat dead zone,
range-bucket occupancy, the log-range histogram, the shift control); this build
lands only what SQL cannot do and what the notebook hardcoded:

  provenance            lake row count against the span-aligned loader
  direction_by_horizon  up-rate and majority baseline per horizon (the record the
  direction_by_year     page's live SQL is checked against)
  flat_threshold
  range_occupancy       21 buckets of 2.0 points, the pinned pre-fix scheme
  volatility_summary    log-range moments, the zero-range floor, lag-1 autocorrelation
  volatility_baseline   exponentially weighted persistence R^2 per smoothing factor,
                        floored and masked (a recursion, not SQL)
  barrier_grid          triple-barrier class mix per (take profit, stop loss, clock)
  swing_grid            swing class mix per (fractal period, clock)
  inventory             the eleven label families and the two things that are not labels
  purge_audit           forward reach against the purge each consumer codes
  findings              the synthesis: eight findings, evidence and the action

Every number comes from the notebook's own generators in
``model/packages/ml-engine/src/cnn_transformer`` run on the bars its recorded results describe
(``mnq_ohlcv_1m`` up to the last bar of ``mnq_labels_1m``: 2,340,445 bars; see
``compute`` for why not today's loader), with the notebook's pinned pre-2026-08-02
parameters (flat 0, bucket 2.0, ``mask_zero_range=False``, the barrier and swing
grids). The quant workspace's ``shared`` package collides with the dashboard's, so
the computation runs here in the quant interpreter and the landing runs in the
datalake interpreter through ``cycle.store._land_job`` (one zstd parquet per table,
one manifest line per (recipe, table) in ``meta/ingest_manifests/study_label_audit_1m.jsonl``).

Run (about five minutes; the barrier sweep is most of it):
    E:/source/repos/ml_dashboard/Trading/quant/.venv/Scripts/python.exe packages/ml-engine/src/studies/label_audit_1m/build.py
Then ``POST /api/labels/catalog/refresh`` (or the next dashboard start) serves each
table as ``derived_study_label_audit_1m_<table>``.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

DASHBOARD = Path(__file__).resolve().parents[4]
MODEL = DASHBOARD / "Trading" / "quant" / "model"
DATASET = "study_label_audit_1m"
RECIPE = "mnq_1m_notebook_pinned_parameters"
SOURCE = "packages/ml-engine/src/studies/label_audit_1m/build.py (Trading/quant/model/notebooks/label_audit.py, pinned pre-2026-08-02 parameters)"
LAKE_PYTHON = os.environ.get("CYCLE_LAKE_PYTHON", "E:/source/repos/datalake/.venv/Scripts/python.exe")

SYMBOL, TIMEFRAME = "MNQ", "1m"
HORIZONS = [1, 5, 15, 60, 90, 240, 1440]
DEFAULT_HORIZON = 1440
FLATS = [0.0, 1.0, 2.0, 5.0, 10.0, 25.0]
LAMBDAS = (0.8, 0.9, 0.94, 0.97, 0.99)
BUCKET_SIZE, BUCKET_COUNT = 2.0, 21
BARRIER_GRID = [(1.5, 1.5, 60), (0.5, 0.5, 60), (1.5, 1.5, 5), (3.0, 3.0, 60), (5.0, 5.0, 15)]
SWING_GRID = [(5, 30), (5, 120), (15, 120), (15, 480), (60, 1440), (60, 15), (120, 30)]

INVENTORY = [
    ("model/packages/ml-engine/src/cnn_transformer/direction_labels.py", "direction",
     "1 if close[i+H] > close[i] else 0; NaN if |delta| < flat_threshold_pts", "H", "classification (2)", True),
    ("model/packages/ml-engine/src/cnn_transformer/volatility_labels.py", "volatility",
     "log(high[i+H] - low[i+H]) — forward log realised range", "H", "regression", True),
    ("model/packages/ml-engine/src/cnn_transformer/range_labels.py", "range_bucket",
     "digitize(close[i+1]-close[i]) into 21 symmetric 2.0-point buckets", "1", "classification (21)", True),
    ("model/packages/ml-engine/src/cnn_transformer/barrier_labels.py", "barrier_class",
     "triple barrier on ATR-scaled TP/SL; +1 TP / -1 SL / 0 vertical", "vertical_bars", "classification (3)", True),
    ("model/packages/ml-engine/src/cnn_transformer/swing_labels.py", "swing",
     "sign of the next centred-fractal pivot within vertical_bars; 0 = timeout",
     "vertical_bars + max(period)", "classification (3)", True),
    ("model/packages/ml-engine/src/cnn_transformer/auxiliary_labels.py", "vol_regime",
     "expanding trailing percentile tercile of rolling realised vol (CAUSAL — no lookahead)", "0",
     "classification (3)", True),
    ("model/scripts/train_close_volume.py", "fwd_log_return", "log(close[t+H] / close[t])", "H", "regression", True),
    ("model/scripts/train_path_geometry.py", "fwd_er_vs_rw / fwd_r2 / fwd_tbeta / fwd_abs_tbeta",
     "forward-window path SHAPE: efficiency ratio (random-walk normalised), regression R^2, slope t-stat",
     "H", "regression (4 variants)", True),
    ("analytics/features/generate.py", "next_log_range / direction",
     "log_range.shift(-1); (fwd 1-bar log return > 0)", "1", "regression + classification", True),
    ("analytics/strategy/labels.py", "meta_label",
     "symmetric ATR breakout armed, then triple barrier; 1 iff TP first (Lopez de Prado meta-label)",
     "horizon", "classification (2) + armed mask", True),
    ("blueprint/labeling/triple_barrier.py", "forward_max_range / tbl / forward_realized_vol",
     "max log(H/L) over next H bars (PRIMARY); triple barrier {-1,0,+1} with t1; std of forward log returns",
     "H", "regression + classification (3)", True),
    ("model/packages/ml-engine/src/agent/gym_env.py", "reward",
     "position * move * point_value - cost * |delta position|", "1 (step)", "RL reward — NOT a stored target", False),
    ("analytics/{regimes,zigzag,taxonomy}", "cluster id",
     "k-means / GMM / HDBSCAN / rule partition", "0", "unsupervised — no ground truth", False),
]

PURGE_AUDIT = [
    ("train_direction_ta.py", "direction H=15", 15, "max(H,50) = 50", True),
    ("train_bayesian_gate.py", "fwd_log_return H=90", 90, "max(H,50) = 90", True),
    ("train_close_volume.py", "fwd_log_return H=240", 240, "max(H,50) = 240", True),
    ("select_features_elasticnet.py", "direction H=1440", 1440, "max(H,50) = 1440", True),
    ("train_daily_direction_hpo.py", "direction H=1440", 1440, "walk_forward purge_bars", True),
    ("train_path_geometry.py", "fwd path shape H=60", 60, "max(H, *windows) = 1440", True),
    ("train_volatility_hpo.py", "volatility H=1", 1, "generate_folds purge", True),
    ("analytics/strategy/labels.py", "meta_label (armed + barrier)", None, "df.attrs['embargo'] = horizon", True),
    ("blueprint (triple_barrier)", "tbl with t1", None, "purge on t1 >= test_start", True),
    ("swing_labels.py (any consumer)", "swing vb + period", None, "consumers purge by vertical_bars only", False),
]


def log(message: str) -> None:
    print(f"[label-audit] {message}", flush=True)


def retried(read, attempts: int = 20, pause_seconds: float = 10.0):
    """A lake read that retries on an I/O error: the object store refuses
    connections while the machine is short of ephemeral ports, and the next
    attempt usually succeeds."""
    for attempt in range(attempts):
        try:
            return read()
        except Exception as error:  # noqa: BLE001
            if attempt == attempts - 1:
                raise
            log(f"lake read failed ({str(error)[:90]}), retrying")
            time.sleep(pause_seconds)
    return None


def class_shares(labels: np.ndarray) -> tuple[int, dict[float, float]]:
    finite = np.isfinite(labels)
    values, counts = np.unique(labels[finite], return_counts=True)
    return int(finite.sum()), dict(zip(values.tolist(), (counts / counts.sum()).tolist()))


def r_squared(y: np.ndarray, prediction: np.ndarray) -> float:
    y, prediction = np.asarray(y, float), np.asarray(prediction, float)
    return float(1.0 - np.sum((y - prediction) ** 2) / np.sum((y - y.mean()) ** 2))


def compute() -> dict[str, pd.DataFrame]:
    for path in (MODEL / "src" / "ml", MODEL / "scripts", MODEL):
        sys.path.insert(0, str(path))
    from cnn_transformer.barrier_labels import generate_triple_barrier_labels
    from cnn_transformer.direction_labels import generate_direction_labels
    from cnn_transformer.range_labels import generate_range_labels
    from cnn_transformer.swing_labels import generate_swing_labels
    from cnn_transformer.volatility_labels import (
        ewma_log_range_forecast,
        generate_volatility_labels,
    )
    from lake.serving import connect

    from shared.data import default_timeframe, load_ohlcv_arrays

    coverage = retried(lambda: connect(with_bars=False).execute(
        "SELECT count(*) n, min(timestamp) t0, max(timestamp) t1 FROM mnq_ohlcv_1m").fetchdf())
    # The notebook loaded through `load_ohlcv_arrays`, whose span-aligned series was
    # 2,340,445 bars (2019-05-05 .. 2025-12-24) when it ran and when mnq_labels_1m
    # was built from it. The loader now reads the Iceberg `bars` table, which starts
    # 2024-03-01, so today it returns a shorter series. The audit is computed on the
    # series its recorded results and the stored labels describe: mnq_ohlcv_1m up to
    # the last labelled bar (row-for-row the labels' timestamps). Today's loader span
    # is recorded in `provenance` beside it.
    started = time.time()
    loader = retried(lambda: load_ohlcv_arrays(SYMBOL, TIMEFRAME))
    loader_timestamps = pd.to_datetime(pd.Series(loader["timestamp"]), utc=True)
    frame = retried(lambda: connect(with_bars=False).execute(
        "SELECT o.timestamp, o.open, o.high, o.low, o.close FROM mnq_ohlcv_1m o "
        "WHERE o.timestamp <= (SELECT max(timestamp) FROM mnq_labels_1m) ORDER BY o.timestamp").fetchdf())
    close = frame["close"].to_numpy(dtype=np.float64)
    high = frame["high"].to_numpy(dtype=np.float64)
    low = frame["low"].to_numpy(dtype=np.float64)
    open_ = frame["open"].to_numpy(dtype=np.float64)
    timestamps = pd.to_datetime(frame["timestamp"], utc=True).reset_index(drop=True)
    n = len(close)
    log(f"loaded {n:,} bars ({timestamps.iloc[0]} .. {timestamps.iloc[-1]}) in {time.time() - started:.1f}s; "
        f"today's loader returns {len(loader_timestamps):,}")

    tables: dict[str, pd.DataFrame] = {}
    tables["provenance"] = pd.DataFrame([{
        "symbol": SYMBOL, "timeframe": TIMEFRAME, "default_timeframe": default_timeframe(),
        "lake_bar_count": int(coverage.n[0]),
        "lake_first_timestamp": pd.Timestamp(coverage.t0[0]).isoformat(),
        "lake_last_timestamp": pd.Timestamp(coverage.t1[0]).isoformat(),
        "audited_bar_count": n,
        "audited_first_timestamp": timestamps.iloc[0].isoformat(),
        "audited_last_timestamp": timestamps.iloc[-1].isoformat(),
        "bars_clipped_by_span_alignment": int(coverage.n[0]) - n,
        "current_loader_bar_count": len(loader_timestamps),
        "current_loader_first_timestamp": loader_timestamps.iloc[0].isoformat(),
        "current_loader_last_timestamp": loader_timestamps.iloc[-1].isoformat(),
        "built_at": datetime.now(timezone.utc).isoformat(),
    }])

    # 2. Direction.
    rows, direction_cache = [], {}
    for horizon in HORIZONS:
        result = generate_direction_labels(close, horizon=horizon, flat_threshold_pts=0.0)
        direction_cache[horizon] = result
        labels = result["labels"]
        valid = np.isfinite(labels)
        up = float(np.nanmean(labels[valid]))
        rows.append({"horizon_bars": horizon, "valid_bar_count": int(valid.sum()), "up_rate": up,
                     "majority_baseline": max(up, 1 - up), "free_edge_over_coin_flip": max(up, 1 - up) - 0.5,
                     "flat_bar_count": int(result["n_flat"])})
    direction = pd.DataFrame(rows)
    tables["direction_by_horizon"] = direction

    yearly = pd.DataFrame({"year": timestamps.dt.year.to_numpy(), "label": direction_cache[DEFAULT_HORIZON]["labels"]}).dropna()
    by_year = yearly.groupby("year")["label"].agg(up_rate="mean", valid_bar_count="size").reset_index()
    by_year["majority_baseline"] = by_year.up_rate.combine(1 - by_year.up_rate, max)
    by_year.insert(0, "horizon_bars", DEFAULT_HORIZON)
    by_year["year"] = by_year["year"].astype(int)
    tables["direction_by_year"] = by_year

    rows = []
    for threshold in FLATS:
        result = generate_direction_labels(close, horizon=DEFAULT_HORIZON, flat_threshold_pts=threshold)
        kept = int(np.isfinite(result["labels"]).sum())
        rows.append({"horizon_bars": DEFAULT_HORIZON, "flat_threshold_points": threshold, "kept_bar_count": kept,
                     "kept_share": kept / max(int(np.isfinite(result["delta_pts"]).sum()), 1),
                     "dropped_flat_bar_count": int(result["n_flat"])})
    tables["flat_threshold"] = pd.DataFrame(rows)
    log("direction done")

    # 3. Volatility, pinned pre-fix: mask_zero_range=False.
    volatility = generate_volatility_labels(high, low, horizon=1, mask_zero_range=False)
    target, log_range = volatility["labels"], volatility["log_range"]
    scored = np.isfinite(target)
    zero_mask = volatility["range_pts"] == 0
    zero_range = int(zero_mask.sum())
    sigma_out = (np.log(1e-09) - float(np.nanmean(log_range))) / float(np.nanstd(log_range))
    baseline_rows, best = [], None
    for smoothing in LAMBDAS:
        forecast = ewma_log_range_forecast(log_range, smoothing)
        score = r_squared(target[scored], forecast[scored])
        baseline_rows.append({"exponential_smoothing_factor": smoothing, "zero_range_policy": "floored",
                              "r_squared": score, "scored_bar_count": int(scored.sum())})
        if best is None or score > best[1]:
            best = (smoothing, score)
    cleaned = log_range.copy()
    cleaned[zero_mask] = np.nan
    cleaned = pd.Series(cleaned).ffill().bfill().to_numpy()
    cleaned_target = np.full(n, np.nan)
    cleaned_target[: n - 1] = cleaned[1:]
    candidates = []
    for smoothing in LAMBDAS:
        forecast = ewma_log_range_forecast(cleaned, smoothing)
        keep = np.isfinite(cleaned_target) & np.isfinite(forecast) & ~zero_mask
        keep[: n - 1] &= ~zero_mask[1:]
        score = r_squared(cleaned_target[keep], forecast[keep])
        candidates.append((score, smoothing, int(keep.sum())))
        baseline_rows.append({"exponential_smoothing_factor": smoothing, "zero_range_policy": "masked",
                              "r_squared": score, "scored_bar_count": int(keep.sum())})
    best_clean = max(candidates)
    tables["volatility_baseline"] = pd.DataFrame(baseline_rows)
    lag_one = float(np.corrcoef(log_range[:-1], log_range[1:])[0, 1])
    target_mean = r_squared(target[scored], np.full(scored.sum(), target[scored].mean()))
    tables["volatility_summary"] = pd.DataFrame([{
        "total_bar_count": n, "labelled_bar_count": int(volatility["n_valid"]),
        "log_range_mean": float(np.nanmean(log_range)), "log_range_standard_deviation": float(np.nanstd(log_range)),
        "log_range_minimum": float(np.nanmin(log_range)), "log_range_maximum": float(np.nanmax(log_range)),
        "zero_range_bar_count": zero_range, "zero_range_share": zero_range / n,
        "floor_log_value": float(np.log(1e-09)), "floor_distance_in_standard_deviations": sigma_out,
        "target_mean_r_squared": target_mean, "lag_one_autocorrelation": lag_one,
        "best_floored_smoothing_factor": best[0], "best_floored_r_squared": best[1],
        "best_masked_smoothing_factor": best_clean[1], "best_masked_r_squared": best_clean[0],
        "masked_scored_bar_count": best_clean[2],
        "floor_cost_r_squared": best_clean[0] - best[1],
    }])
    log(f"volatility done: best floored {best}, best masked {best_clean[:2]}")

    # 4. Range buckets, pinned 2.0 points x 21.
    buckets = generate_range_labels(close, bucket_size_pts=BUCKET_SIZE, n_buckets=BUCKET_COUNT)
    bucket_labels = buckets["labels"]
    occupancy = pd.Series(bucket_labels[np.isfinite(bucket_labels)]).value_counts().sort_index()
    share = occupancy / occupancy.sum()
    delta = np.abs(buckets["delta_pts"][np.isfinite(buckets["delta_pts"])])
    tables["range_occupancy"] = pd.DataFrame({
        "bucket_size_points": BUCKET_SIZE, "bucket_count": BUCKET_COUNT,
        "bucket_index": occupancy.index.astype(int),
        "bucket_centre_points": buckets["bucket_centers"][occupancy.index.astype(int)],
        "bar_count": occupancy.values.astype(int), "share": share.values,
    })
    log("range done")

    # 5. Triple barrier sweep (numba).
    rows = []
    for take_profit, stop_loss, clock in BARRIER_GRID:
        out = generate_triple_barrier_labels(close, high, low, open_, atr_period=14, tp_multiplier=take_profit,
                                             sl_multiplier=stop_loss, vertical_bars=clock)
        valid_count, shares = class_shares(np.asarray(out["labels"], dtype=np.float64))
        rows.append({"take_profit_multiple_of_average_true_range": take_profit,
                     "stop_loss_multiple_of_average_true_range": stop_loss, "vertical_barrier_bars": clock,
                     "is_shipped_default_before_fix": (take_profit, stop_loss, clock) == (1.5, 1.5, 60),
                     "labelled_bar_count": valid_count, "take_profit_first_share": shares.get(1.0, 0.0),
                     "stop_loss_first_share": shares.get(-1.0, 0.0), "vertical_timeout_share": shares.get(0.0, 0.0)})
        log(f"barrier {take_profit}/{stop_loss}/{clock} done")
    barrier = pd.DataFrame(rows)
    tables["barrier_grid"] = barrier

    # 6. Swing sweep.
    rows = []
    for period, clock in SWING_GRID:
        out = generate_swing_labels(high, low, close, period, period, clock)
        valid_count, shares = class_shares(out["labels"])
        rows.append({"fractal_period_bars": period, "vertical_barrier_bars": clock, "forward_reach_bars": clock + period,
                     "labelled_bar_count": valid_count, "next_pivot_high_share": shares.get(1.0, 0.0),
                     "next_pivot_low_share": shares.get(-1.0, 0.0), "timeout_share": shares.get(0.0, 0.0)})
        log(f"swing {period}/{clock} done")
    swing = pd.DataFrame(rows)
    tables["swing_grid"] = swing

    # 1 and 7. Static inventory and purge audit, as the notebook hardcodes them.
    tables["inventory"] = pd.DataFrame(INVENTORY, columns=["module_path", "label_name", "definition", "forward_bars",
                                                           "family", "is_supervised_label"])
    purge = pd.DataFrame(PURGE_AUDIT, columns=["script", "label_name", "forward_reach_bars", "purge_as_coded", "reach_covered"])
    purge["forward_reach_bars"] = purge["forward_reach_bars"].astype("Int64")
    tables["purge_audit"] = purge

    # 8. Synthesis, the notebook's strings with the notebook's numbers.
    shipped_barrier, shipped_swing = barrier.iloc[0], swing.iloc[2]
    h1 = direction.set_index("horizon_bars").loc[1]
    h1440 = direction.set_index("horizon_bars").loc[1440]
    synthesis = [
        ("Direction baseline is not 0.50, and it FLIPS SIDES with the horizon",
         f"H=1 up-rate {h1.up_rate:.4f} (majority class is DOWN, {h1.majority_baseline:.4f}); "
         f"H=1440 up-rate {h1440.up_rate:.4f} (majority class is UP, {h1440.majority_baseline:.4f}); "
         f"per-year majority ranges {by_year.majority_baseline.min():.4f}-{by_year.majority_baseline.max():.4f}",
         "Report `accuracy - max(up_rate, 1-up_rate)` computed per fold on that fold's TRAIN slice in "
         "train_direction_ta.py and select_features_elasticnet.py — a fixed 0.50 is wrong in both directions."),
        ("Range buckets concentrate but do not collapse at 1m",
         f"centre bucket holds {share.get(10, 0):.1%}; free majority accuracy {share.max():.4f} vs "
         f"chance {1 / 21:.4f}; every one of the 21 buckets still holds >0.1% of bars",
         f"Set bucket_size_pts={np.quantile(delta, 0.68) / 3:.2f} in range_labels.py so the median 1m move "
         f"({np.quantile(delta, 0.50):.2f} pts) spans several buckets, and grade the head against "
         f"{share.max():.4f}, not 1/21."),
        ("The triple barrier's third class is DEAD at the shipped settings",
         f"shipped tp=sl=1.5 ATR / vb=60 resolves TP {shipped_barrier.take_profit_first_share:.4f} / "
         f"SL {shipped_barrier.stop_loss_first_share:.4f} / vertical {shipped_barrier.vertical_timeout_share:.4f}; "
         f"60 one-minute bars is long enough that an ATR-scaled band is essentially always touched. Shortening the "
         f"clock revives it: tp=sl=1.5/vb=5 gives {barrier.iloc[2].vertical_timeout_share:.4f} vertical",
         f"Set vertical_bars=5 (measured {barrier.iloc[2].vertical_timeout_share:.2f} timeout mass) in "
         f"barrier_labels.py, or drop barrier_class to 2 classes — a 3-way softmax whose third unit sees "
         f"{shipped_barrier.vertical_timeout_share:.2%} of bars wastes capacity and inflates accuracy."),
        ("The swing head has the same dead third class",
         f"period=15 / vb=120 gives high {shipped_swing.next_pivot_high_share:.4f} / low "
         f"{shipped_swing.next_pivot_low_share:.4f} / timeout {shipped_swing.timeout_share:.4f} — a pivot always "
         f"exists within the lookahead at 1m. period=60/vb=15 flips it: timeout {swing.iloc[5].timeout_share:.4f}",
         f"Set vertical_bars below the fractal period in swing_labels.py (period=60/vb=15 measured "
         f"{swing.iloc[5].timeout_share:.2f} timeout mass), or drop the class to 2 outcomes."),
        ("Swing labels reach further than any consumer purges",
         f"forward reach = vertical_bars + fractal period, up to {int(swing.forward_reach_bars.max()):,} bars in "
         f"this sweep; consumers purge by vertical_bars alone",
         "Add `+ max(high_period, low_period)` to the purge passed to generate_folds by every swing-label consumer."),
        ("Zero-range bars are floored, not masked, and it costs the baseline measurably",
         f"{zero_range:,} bars ({zero_range / n:.3%}) get log(1e-9) = {np.log(1e-9):.1f}, which is "
         f"{sigma_out:.1f} sigma from the mean; masking them moves the EWMA baseline "
         f"{best[1]:+.4f} -> {best_clean[0]:+.4f} R^2",
         "Mask high==low bars to NaN in volatility_labels.py instead of flooring them."),
        ("Volatility persistence is the baseline every vol head must clear",
         f"EWMA lam={best[0]:.2f} scores R^2={best[1]:+.4f} raw / {best_clean[0]:+.4f} masked; "
         f"log_range lag-1 autocorrelation is {lag_one:+.4f}",
         "Make `median_skill_vs_ewma` the Optuna objective in train_volatility_hpo.py — it currently "
         "optimises median_test_r2 and only reports skill, which selects level-trackers."),
        ("Analytics CLIs do not share the 1m default",
         "model/ routes every --timeframe through default_timeframe(); analytics/ hardcodes literals, "
         "and correlation/cli.py says 1d while crossovers/moneytest.py says 5m",
         "Add a default_timeframe() helper to analytics/core and point correlation/cli.py and "
         "crossovers/moneytest.py at it."),
    ]
    tables["findings"] = pd.DataFrame([
        {"finding_number": number, "finding": finding, "evidence": evidence, "action": action,
         "status": "applied 2026-08-02"}
        for number, (finding, evidence, action) in enumerate(synthesis, start=1)
    ])
    return tables


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
    parser.add_argument("--no-land", action="store_true", help="compute and print, do not write the lake")
    args = parser.parse_args()
    tables = compute()
    for name, frame in tables.items():
        log(f"{name}: {len(frame)} rows")
    if args.no_land:
        print(tables["findings"].to_string())
        return
    with tempfile.TemporaryDirectory(prefix="study_label_audit_1m_") as directory:
        result = retried(lambda: land(tables, directory), attempts=6, pause_seconds=30.0)
    for name, info in result.items():
        log(f"landed {name}: {info['rows']} rows, manifest {info['manifest']}")


if __name__ == "__main__":
    main()
