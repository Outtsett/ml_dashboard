"""Land the chart-CNN direction round (2D chart image vs 1D numeric control) in the lake for the study page.

Replaces what ``Trading/quant/chart_cnn/pkg/report.py`` (a marimo notebook) computed on every open. The
notebook read three local files:

    pkg/cnn_results.csv      one row per (tag, model): n, out-of-sample AUC, long_top20_R, short_bottom20_R, naive_long_R
    pkg/pred_<tag>.npz       p2 (2D image CNN score), p1 (1D sequence CNN score), y (hit +B*ATR first), r (R in ATR multiples)
    pkg/cnn2d.pt             the 2D model's state dict; ``f.0.weight`` is the 32 first-layer filters (5 price x 3 time pixels)

and this reads them read-only, computes the same tables, and lands four under
``s3://derived/study_chart_cnn_direction_null_result/recipe=seed0_last_40_percent/`` with a manifest line each,
so the dashboard serves them as ``derived_study_chart_cnn_direction_null_result_<table>``:

    model_results      6 rows: the results CSV with full-word columns, a DeLong 95% interval on each AUC, the base rate
    model_comparison   3 rows: 2D minus 1D AUC per tag with a paired DeLong 95% interval
    score_bins         210 rows: up-rate and mean R by predicted-score bin (5, 10 and 20 equal-count bins per tag and model);
                       the 10-bin rows are the notebook's ``pd.qcut(p, 10, labels=False, duplicates="drop")`` deciles exactly
    first_layer_filters 480 rows: the 32 filters x 5 price rows x 3 time columns of weights

The raw 187k-row score arrays are not landed. The one deliberate addition over the notebook is the interval on
each AUC and on the 2D-1D difference (DeLong, which treats the test rows as independent: adjacent bars overlap in
their barrier windows, so these intervals are narrower than the truth and the null is, if anything, understated).

Run once:  E:\\source\\repos\\datalake\\.venv\\Scripts\\python.exe packages/ml-engine/src/studies/chart_cnn_direction_null_result/build.py
It refuses to land when the recipe is already in the manifest (write-once). ``--dry-run`` computes and prints only.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import tempfile
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT / "src" / "ml"))

PACKAGE = ROOT / "Trading" / "quant" / "chart_cnn" / "pkg"
DATASET = "study_chart_cnn_direction_null_result"
RECIPE = "seed0_last_40_percent"
BIN_COUNTS = (5, 10, 20)
MODEL_NAMES = {"p2": "2D image", "p1": "1D sequence"}
Z_95 = 1.959963984540054


# ---------------------------------------------------------------- DeLong (Sun and Xu 2014, O(n log n)) ---------------


def _midrank(values: np.ndarray) -> np.ndarray:
    order = np.argsort(values, kind="mergesort")
    sorted_values = values[order]
    count = len(values)
    ranks = np.zeros(count, dtype=np.float64)
    start = 0
    while start < count:
        stop = start
        while stop < count and sorted_values[stop] == sorted_values[start]:
            stop += 1
        ranks[start:stop] = 0.5 * (start + stop - 1) + 1
        start = stop
    out = np.empty(count, dtype=np.float64)
    out[order] = ranks
    return out


def delong_components(scores: np.ndarray, label: np.ndarray) -> tuple[float, np.ndarray, np.ndarray]:
    """AUC, plus the structural components V10 (per positive) and V01 (per negative)."""
    positive = scores[label == 1].astype(np.float64)
    negative = scores[label == 0].astype(np.float64)
    m, n = len(positive), len(negative)
    both = np.concatenate([positive, negative])
    ranks_all = _midrank(both)
    ranks_positive = _midrank(positive)
    ranks_negative = _midrank(negative)
    v10 = (ranks_all[:m] - ranks_positive) / n
    v01 = 1.0 - (ranks_all[m:] - ranks_negative) / m
    auc = float(ranks_all[:m].sum() / (m * n) - (m + 1.0) / (2.0 * n))
    return auc, v10, v01


def delong_interval(scores: np.ndarray, label: np.ndarray) -> tuple[float, float, float]:
    auc, v10, v01 = delong_components(scores, label)
    m, n = len(v10), len(v01)
    variance = v10.var(ddof=1) / m + v01.var(ddof=1) / n
    half = Z_95 * math.sqrt(variance)
    return auc, auc - half, auc + half


def delong_paired_difference(first: np.ndarray, second: np.ndarray, label: np.ndarray) -> tuple[float, float, float, float]:
    """(difference, low, high, z) for AUC(first) - AUC(second) on the same rows."""
    auc_a, a10, a01 = delong_components(first, label)
    auc_b, b10, b01 = delong_components(second, label)
    m, n = len(a10), len(a01)
    cov10 = np.cov(a10, b10, ddof=1)
    cov01 = np.cov(a01, b01, ddof=1)
    variance = (cov10[0, 0] + cov10[1, 1] - 2 * cov10[0, 1]) / m + (cov01[0, 0] + cov01[1, 1] - 2 * cov01[0, 1]) / n
    difference = auc_a - auc_b
    sd = math.sqrt(max(variance, 0.0))
    return difference, difference - Z_95 * sd, difference + Z_95 * sd, (difference / sd if sd > 0 else float("nan"))


def wilson(successes: np.ndarray, totals: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    p = successes / totals
    denominator = 1 + Z_95**2 / totals
    centre = (p + Z_95**2 / (2 * totals)) / denominator
    half = Z_95 * np.sqrt(p * (1 - p) / totals + Z_95**2 / (4 * totals**2)) / denominator
    return centre - half, centre + half


# ---------------------------------------------------------------- the notebook's computations -----------------------


def load() -> tuple[pd.DataFrame, dict[str, dict[str, np.ndarray]], np.ndarray]:
    results = pd.read_csv(PACKAGE / "cnn_results.csv")
    predictions: dict[str, dict[str, np.ndarray]] = {}
    for tag in sorted(results["tag"].unique()):
        with np.load(PACKAGE / f"pred_{tag}.npz") as archive:  # numeric arrays only: no pickle
            predictions[tag] = {key: archive[key] for key in archive.files}
    import torch

    weights = torch.load(PACKAGE / "cnn2d.pt", map_location="cpu", weights_only=True)["f.0.weight"].numpy()[:, 0]
    return results, predictions, weights


def model_tables(results: pd.DataFrame, predictions: dict[str, dict[str, np.ndarray]]) -> tuple[pd.DataFrame, pd.DataFrame]:
    from sklearn.metrics import roc_auc_score

    rows = []
    comparisons = []
    for tag, data in predictions.items():
        y = data["y"]
        for key, name in MODEL_NAMES.items():
            csv_row = results[(results["tag"] == tag) & (results["model"] == name)].iloc[0]
            auc, low, high = delong_interval(data[key], y)
            if abs(auc - float(csv_row["auc"])) > 1e-9 or abs(auc - roc_auc_score(y, data[key])) > 1e-9:
                raise SystemExit(f"{tag} {name}: DeLong AUC {auc} disagrees with the notebook's {csv_row['auc']}")
            rows.append({
                "dataset_tag": tag,
                "model_name": name,
                "test_observation_count": int(csv_row["n"]),
                "area_under_curve": float(csv_row["auc"]),
                "area_under_curve_interval_low": low,
                "area_under_curve_interval_high": high,
                "long_top_20_percent_mean_return_atr_multiples": float(csv_row["long_top20_R"]),
                "short_bottom_20_percent_mean_return_atr_multiples": float(csv_row["short_bottom20_R"]),
                "naive_long_mean_return_atr_multiples": float(csv_row["naive_long_R"]),
                "base_up_rate": float(y.mean()),
                "return_standard_deviation_atr_multiples": float(data["r"].std(ddof=1)),
            })
        difference, low, high, z = delong_paired_difference(data["p2"], data["p1"], y)
        comparisons.append({
            "dataset_tag": tag,
            "test_observation_count": int(len(y)),
            "image_area_under_curve": float(roc_auc_score(y, data["p2"])),
            "sequence_area_under_curve": float(roc_auc_score(y, data["p1"])),
            "area_under_curve_difference_image_minus_sequence": difference,
            "difference_interval_low": low,
            "difference_interval_high": high,
            "difference_z_statistic": z,
        })
    return pd.DataFrame(rows), pd.DataFrame(comparisons)


def score_bins(predictions: dict[str, dict[str, np.ndarray]]) -> pd.DataFrame:
    """The notebook's ``pd.qcut(p, q, labels=False, duplicates="drop")`` group-by, for q = 5, 10 and 20."""
    frames = []
    for tag, data in predictions.items():
        y, r = data["y"], data["r"]
        for key, name in MODEL_NAMES.items():
            score = data[key].astype(np.float64)
            for bin_count in BIN_COUNTS:
                bin_index = pd.qcut(score, bin_count, labels=False, duplicates="drop")
                grouped = pd.DataFrame({"bin": bin_index, "score": score, "y": y, "r": r}).groupby("bin")
                table = grouped.agg(
                    observation_count=("y", "size"),
                    up_count=("y", "sum"),
                    up_rate=("y", "mean"),
                    mean_return_atr_multiples=("r", "mean"),
                    return_standard_deviation_atr_multiples=("r", "std"),
                    mean_score=("score", "mean"),
                    score_minimum=("score", "min"),
                    score_maximum=("score", "max"),
                ).reset_index()
                low, high = wilson(table["up_count"].to_numpy(dtype=np.float64), table["observation_count"].to_numpy(dtype=np.float64))
                frames.append(pd.DataFrame({
                    "dataset_tag": tag,
                    "model_name": name,
                    "bin_count_requested": bin_count,
                    "bin_number": table["bin"].astype("int64") + 1,
                    "observation_count": table["observation_count"].astype("int64"),
                    "mean_score": table["mean_score"],
                    "score_minimum": table["score_minimum"],
                    "score_maximum": table["score_maximum"],
                    "up_rate": table["up_rate"],
                    "up_rate_interval_low": low,
                    "up_rate_interval_high": high,
                    "base_up_rate": float(y.mean()),
                    "mean_return_atr_multiples": table["mean_return_atr_multiples"],
                    "mean_return_standard_error_atr_multiples": table["return_standard_deviation_atr_multiples"] / np.sqrt(table["observation_count"]),
                }))
    return pd.concat(frames, ignore_index=True)


def filter_table(weights: np.ndarray) -> pd.DataFrame:
    filter_count, price_rows, time_columns = weights.shape
    index = np.indices(weights.shape)
    return pd.DataFrame({
        "filter_number": (index[0].ravel() + 1).astype("int64"),
        "price_row": (index[1].ravel() + 1).astype("int64"),
        "time_column": (index[2].ravel() + 1).astype("int64"),
        "weight": weights.ravel().astype("float64"),
    })


# ---------------------------------------------------------------- landing ------------------------------------------


def already_landed() -> bool:
    from lake.layout import INGEST_MANIFESTS, arrow_fs, arrow_key

    key = arrow_key(INGEST_MANIFESTS / f"{DATASET}.jsonl")
    try:
        with arrow_fs().open_input_stream(key) as source:
            text = source.read().decode("utf-8")
    except (FileNotFoundError, OSError):
        return False
    return any(json.loads(line).get("recipe") == RECIPE for line in text.splitlines() if line.strip())


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dry-run", action="store_true", help="compute and print row counts, land nothing")
    arguments = parser.parse_args()

    results, predictions, weights = load()
    results_table, comparison_table = model_tables(results, predictions)
    tables = {
        "model_results": results_table,
        "model_comparison": comparison_table,
        "score_bins": score_bins(predictions),
        "first_layer_filters": filter_table(weights),
    }
    for name, frame in tables.items():
        print(f"{name}: {len(frame):,} rows x {frame.shape[1]} columns")
    print(comparison_table.round(5).to_string(index=False))
    if arguments.dry_run:
        return
    if already_landed():
        raise SystemExit(f"{DATASET} recipe={RECIPE} is already in the manifest; write-once, nothing landed")

    from ta_strategy.store import land, write_local

    with tempfile.TemporaryDirectory(prefix="chart_cnn_direction_") as directory:
        paths = write_local(tables, directory)
        landed = land(paths, RECIPE, source="chart_cnn pkg: cnn_results.csv, pred_<tag>.npz, cnn2d.pt "
                      "(Trading/quant/chart_cnn), bins as report.py, DeLong intervals added", dataset=DATASET)
    print(json.dumps(landed, indent=1))


if __name__ == "__main__":
    os.environ.setdefault("PYTHONIOENCODING", "utf-8")
    main()
