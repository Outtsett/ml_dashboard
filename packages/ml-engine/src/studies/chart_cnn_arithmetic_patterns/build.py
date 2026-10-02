"""Land the chart-CNN arithmetic-pattern control round in the lake for the study page.

Replaces what ``Trading/quant/chart_cnn/pkg/report_patterns.py`` (a marimo
notebook) read on every open:

    pkg/pattern_results_<tag>.csv      one row per arithmetic pattern (prevalence, AUC, AP, positives)
    pkg/pred_patterns_<tag>.npz        network scores p, pattern labels y, names, for the 187,849 test windows

The notebook's own numbers are landed as they are; two things are added so the
page can be checked and can draw more than the notebook did, both read from the
same run's files:

    * the window's New York clock time, from ``images48_<tag>.npz`` (``T``) for the
      test rows (the last 40% of the windows, the same ``int(n * 0.6)`` cut
      ``train_patterns.py`` makes);
    * each pattern's rule in words and how many bars it reads, transcribed from
      ``patterns.py`` (the labels' own module; its NAMES are imported and the
      keys of the wording table are asserted equal to them).

It asserts, before landing, that the prediction file's labels equal
``patterns_<tag>.npz``'s labels at the test rows, that the CSV's positive
counts and prevalences equal the labels', and that the CSV's AUC and average
precision equal scikit-learn's on the stored scores. Two tables land under
``s3://derived/study_chart_cnn_arithmetic_patterns/recipe=arithmetic_<tag>/``
with a manifest line each, served as
``derived_study_chart_cnn_arithmetic_patterns_<table>``:

    pattern_scores   17 rows: the results CSV with full-word columns, each rule in words and its bar count
    window_scores    187,849 rows: window clock time, network score and arithmetic label per pattern (wide, 2 x 17 columns)

Run once:  E:\\source\\repos\\datalake\\.venv\\Scripts\\python.exe packages/ml-engine/src/studies/chart_cnn_arithmetic_patterns/build.py
It refuses to land when the recipe is already in the manifest (write-once).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import average_precision_score, roc_auc_score

ROOT = Path(__file__).resolve().parents[4]
PACKAGE = ROOT / "Trading" / "quant" / "chart_cnn" / "pkg"
sys.path.insert(0, str(ROOT / "src" / "ml"))
sys.path.insert(0, str(PACKAGE))

from patterns import NAMES  # noqa: E402  the labels' own module: the order of the 17 patterns

DATASET = "study_chart_cnn_arithmetic_patterns"
TEST_FRACTION_START = 0.6  # train_patterns.py: cut = int(len(Y) * 0.6); the test rows are Y[cut:]

#: (bars the rule reads, the rule in words), transcribed from patterns.labels().
RULES: dict[str, tuple[int, str]] = {
    "doji": (1, "body is at most 10% of the bar's range"),
    "hammer": (1, "lower shadow is at least 60% of the range and upper shadow at most 15%"),
    "shooting_star": (1, "upper shadow is at least 60% of the range and lower shadow at most 15%"),
    "bull_marubozu": (1, "rising bar (close above open) whose body is at least 90% of the range"),
    "bear_marubozu": (1, "falling bar (close below open) whose body is at least 90% of the range"),
    "spinning_top": (1, "body is at most 30% of the range with both shadows at least 25% of the range"),
    "wide_range_bar": (1, "range is at least 2.0 times the 14-bar average true range"),
    "bull_engulfing": (2, "falling bar, then a rising bar that opens at or below its close, closes at or above its open, with a larger body"),
    "bear_engulfing": (2, "rising bar, then a falling bar that opens at or above its close, closes at or below its open, with a larger body"),
    "inside_bar": (2, "high at or below the previous high, low at or above the previous low, and a smaller range"),
    "outside_bar": (2, "high above the previous high and low below the previous low"),
    "bull_harami": (2, "falling bar whose body is at least 50% of its range, then a rising bar whose body sits inside it"),
    "bear_harami": (2, "rising bar whose body is at least 50% of its range, then a falling bar whose body sits inside it"),
    "morning_star": (3, "falling bar with a body of at least 50% of its range, a small-body bar (at most 30%), then a rising bar closing above the first bar's body midpoint"),
    "evening_star": (3, "rising bar with a body of at least 50% of its range, a small-body bar (at most 30%), then a falling bar closing below the first bar's body midpoint"),
    "three_soldiers": (3, "three rising bars, each closing higher than the last, each with a body of at least 50% of its range"),
    "three_crows": (3, "three falling bars, each closing lower than the last, each with a body of at least 50% of its range"),
}


def load(tag: str) -> tuple[pd.DataFrame, np.lib.npyio.NpzFile, np.ndarray]:
    results = pd.read_csv(PACKAGE / f"pattern_results_{tag}.csv")
    predictions = np.load(PACKAGE / f"pred_patterns_{tag}.npz")  # float and unsigned arrays plus fixed-width unicode: no pickle
    labels = np.load(PACKAGE / f"patterns_{tag}.npz")
    images = np.load(PACKAGE / f"images48_{tag}.npz", allow_pickle=True)  # our own local build output; T is an object array of strings (trusted, not downloaded)
    names = [str(name) for name in predictions["names"]]
    if names != list(NAMES):
        raise SystemExit("the prediction file's pattern order differs from patterns.NAMES")
    if sorted(RULES) != sorted(NAMES):
        raise SystemExit("the rule wording table does not cover exactly patterns.NAMES")
    cut = int(len(labels["Y"]) * TEST_FRACTION_START)
    if not np.array_equal(predictions["y"], labels["Y"][cut:]):
        raise SystemExit("pred_patterns labels differ from patterns_<tag>.npz at the test rows: not the same windows")
    times = np.asarray(images["T"])[cut:].astype(str)
    if len(times) != len(predictions["y"]):
        raise SystemExit("window times and predictions have different lengths")
    return results, predictions, times


def check_against_notebook_numbers(results: pd.DataFrame, predictions) -> None:
    """The CSV's numbers must be what the stored scores give (they are the same run's output)."""
    names = [str(name) for name in predictions["names"]]
    labels, scores = predictions["y"], predictions["p"]
    for index, name in enumerate(names):
        row = results.loc[results["pattern"] == name].iloc[0]
        positives = int(labels[:, index].sum())
        if positives != int(row["n_pos"]):
            raise SystemExit(f"{name}: CSV says {row['n_pos']} positives, the labels hold {positives}")
        if abs(float(labels[:, index].mean()) - float(row["prevalence"])) > 1e-6:
            raise SystemExit(f"{name}: CSV prevalence {row['prevalence']} is not the labels' mean")
        auc = roc_auc_score(labels[:, index], scores[:, index])
        ap = average_precision_score(labels[:, index], scores[:, index])
        if abs(auc - float(row["auc"])) > 1e-6 or abs(ap - float(row["avg_precision"])) > 1e-6:
            raise SystemExit(f"{name}: CSV AUC/AP ({row['auc']}, {row['avg_precision']}) differ from the stored scores ({auc}, {ap})")


def pattern_scores(results: pd.DataFrame, window_count: int) -> pd.DataFrame:
    out = pd.DataFrame({
        "pattern_name": results["pattern"].astype(str),
        "pattern_bar_count": [RULES[name][0] for name in results["pattern"]],
        "rule_in_words": [RULES[name][1] for name in results["pattern"]],
        "window_count": np.full(len(results), window_count, dtype="int64"),
        "positive_window_count": results["n_pos"].astype("int64"),
        "prevalence": results["prevalence"].astype("float64"),
        "area_under_curve": results["auc"].astype("float64"),
        "average_precision": results["avg_precision"].astype("float64"),
    })
    return out.sort_values("pattern_name").reset_index(drop=True)


def window_scores(predictions, times: np.ndarray) -> pd.DataFrame:
    names = [str(name) for name in predictions["names"]]
    columns: dict[str, np.ndarray] = {
        "window_id": np.arange(predictions["p"].shape[0], dtype=np.int64),
        "window_time_new_york": times,
    }
    for index, name in enumerate(names):
        columns[f"network_score_{name}"] = predictions["p"][:, index].astype(np.float32)
    for index, name in enumerate(names):
        columns[f"arithmetic_label_{name}"] = predictions["y"][:, index].astype(np.int8)
    return pd.DataFrame(columns)


def already_landed(recipe: str) -> bool:
    from lake.layout import INGEST_MANIFESTS, arrow_fs, arrow_key

    key = arrow_key(INGEST_MANIFESTS / f"{DATASET}.jsonl")
    try:
        with arrow_fs().open_input_stream(key) as source:
            text = source.read().decode("utf-8")
    except (FileNotFoundError, OSError):
        return False
    return any(json.loads(line).get("recipe") == recipe for line in text.splitlines() if line.strip())


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--tag", default="mnq5m", help="the run's dataset tag (pattern_results_<tag>.csv); only mnq5m exists")
    parser.add_argument("--dry-run", action="store_true", help="compute, check and print row counts, land nothing")
    arguments = parser.parse_args()
    recipe = f"arithmetic_{arguments.tag}"

    results, predictions, times = load(arguments.tag)
    check_against_notebook_numbers(results, predictions)
    tables = {
        "pattern_scores": pattern_scores(results, len(times)),
        "window_scores": window_scores(predictions, times),
    }
    for name, frame in tables.items():
        print(f"{name}: {len(frame):,} rows x {frame.shape[1]} columns")
    print(f"test windows {times[0]} to {times[-1]} (New York); CSV numbers equal scikit-learn on the stored scores")
    if arguments.dry_run:
        return
    if already_landed(recipe):
        raise SystemExit(f"{DATASET} recipe={recipe} is already in the manifest; write-once, nothing landed")

    from ta_strategy.store import land, write_local

    with tempfile.TemporaryDirectory(prefix="chart_cnn_arithmetic_") as directory:
        paths = write_local(tables, directory)
        landed = land(
            paths, recipe,
            source=f"chart_cnn pkg: pattern_results_{arguments.tag}.csv, pred_patterns_{arguments.tag}.npz, "
                   f"images48_{arguments.tag}.npz (window times), patterns_{arguments.tag}.npz (label parity) (Trading/quant/chart_cnn)",
            dataset=DATASET,
        )
    print(json.dumps(landed, indent=1))


if __name__ == "__main__":
    os.environ.setdefault("PYTHONIOENCODING", "utf-8")
    main()
