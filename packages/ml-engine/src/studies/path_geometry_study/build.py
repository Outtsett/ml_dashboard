r"""Land the path-geometry forecasting results in the lake.

The notebook ``Trading/quant/model/notebooks/path_geometry_study.py`` read four
``best_meta.json`` files written by ``scripts/train_path_geometry.py`` on
2026-08-03 (MNQ 1m, horizon 60, 34 causal path-geometry features, ridge and
gradient boosting, 5 purged walk-forward folds, bar-level Diebold-Mariano
intervals from a circular block bootstrap):

    Trading/quant/model/data/models/MNQ_1m_path_geometry_fwd_<target>_h60/best_meta.json
    target in fwd_er_vs_rw, fwd_tbeta, fwd_r2, fwd_abs_tbeta

They are local files, unreadable from the dashboard's DuckDB. This job copies
them as they are (read only, no recomputation) and lands two tables:

    s3://derived/study_path_geometry_study/recipe=<recipe>/table=targets/   one row per target: the config, both models' summaries, the trivial baselines, the verdict
    s3://derived/study_path_geometry_study/recipe=<recipe>/table=folds/     one row per (target, fold): every per-fold score

The dashboard serves them as ``derived_study_path_geometry_study_targets`` and
``derived_study_path_geometry_study_folds`` once the manifest lines land
(``POST /api/labels/catalog/refresh`` or the next dashboard start). Column names
are spelled out (``r2`` is ``r_squared``, ``ic`` is ``information_coefficient``,
``dm`` is ``diebold_mariano``, ``gbm`` is ``gradient_boosting``).

The efficiency-ratio panels of the page (sections 1 to 3) and the direction
label panels (section 5) are computed live from ``mnq_ohlcv_1m`` by SQL, not
landed here.

An existing recipe is never overwritten: a second run refuses unless given a
new ``--recipe``.

Run with the datalake interpreter (it carries ``lake``, pandas and pyarrow):

    E:/source/repos/datalake/.venv/Scripts/python.exe packages/ml-engine/src/studies/path_geometry_study/build.py
"""

from __future__ import annotations

import argparse
import datetime as dt
import glob
import json
import os
import sys
import tempfile

import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from ta_strategy.store import land, write_local  # noqa: E402

DATASET = "study_path_geometry_study"
DEFAULT_RECIPE = "trained_2026_08_03"
MODELS_ROOT = r"E:\source\repos\ml_dashboard\Trading\quant\model\data\models"
#: the glob the notebook used: the older MNQ_1m_path_geometry_h60 directory is not matched
PATTERN = "MNQ_1m_path_geometry_fwd*/best_meta.json"

MODEL_PREFIXES = {"ridge": "ridge", "gbm": "gradient_boosting"}


def _interval(pair: object) -> tuple[float | None, float | None]:
    if isinstance(pair, (list, tuple)) and len(pair) == 2:
        return float(pair[0]), float(pair[1])
    return None, None


def _diebold_mariano(prefix: str, block: dict | None) -> dict[str, object]:
    block = block or {}
    low, high = _interval(block.get("ci95"))
    return {
        f"{prefix}_diebold_mariano_available": bool(block.get("available", False)),
        f"{prefix}_diebold_mariano_mean_loss_differential": block.get("mean_d"),
        f"{prefix}_diebold_mariano_block_length": block.get("block_length"),
        f"{prefix}_diebold_mariano_block_length_politis_white": block.get("block_politis_white"),
        f"{prefix}_diebold_mariano_interval_low": low,
        f"{prefix}_diebold_mariano_interval_high": high,
        f"{prefix}_diebold_mariano_bar_count": block.get("n_bars"),
        f"{prefix}_diebold_mariano_effective_sample_size": block.get("effective_n"),
        f"{prefix}_diebold_mariano_beats_baseline": block.get("significant"),
    }


def target_row(meta: dict, source_file: str) -> dict[str, object]:
    config, summary, verdict = meta["config"], meta["summary"], meta["verdict"]
    row: dict[str, object] = {
        "target": config["target"],
        "model_family": config["model"],
        "symbol": config["symbol"],
        "timeframe": config["timeframe"],
        "horizon_bars": config["horizon"],
        "training_row_count": config["n_rows"],
        "feature_count": config["n_features"],
        "feature_windows": ",".join(str(w) for w in config["windows"]),
        "models_fitted": ",".join(config["models"]),
        "fold_months": config["fold_months"],
        "fold_count": config["n_folds"],
        "purge_bars": config["purge_bars"],
        "random_seed": config["seed"],
        "persistence_baseline": config["persistence_baseline"],
    }
    for key, prefix in MODEL_PREFIXES.items():
        block = summary[key]
        low, high = _interval(block.get("skill_vs_baseline_ci95"))
        row.update({
            f"{prefix}_r_squared_median": block["r2_median"],
            f"{prefix}_information_coefficient_median": block["ic_median"],
            f"{prefix}_skill_median": block["skill_vs_baseline_median"],
            f"{prefix}_skill_fold_interval_low": low,
            f"{prefix}_skill_fold_interval_high": high,
            f"{prefix}_folds_with_positive_skill": block["folds_with_positive_skill"],
            f"{prefix}_beats_baseline_fold_level": block["beats_best_trivial_baseline"],
        })
        row.update(_diebold_mariano(prefix, block.get("bar_level_dm")))
    row["persistence_r_squared_median"] = summary["persistence"]["r2_median"]
    row["persistence_information_coefficient_median"] = summary["persistence"]["ic_median"]
    row["train_mean_r_squared_median"] = summary["train_mean"]["r2_median"]
    skill_low, skill_high = _interval(verdict.get("skill_ci95"))
    row.update({
        "verdict_best_model": verdict["best_model"],
        "verdict_skill_vs_baseline": verdict["skill_vs_baseline"],
        "verdict_skill_fold_interval_low": skill_low,
        "verdict_skill_fold_interval_high": skill_high,
        "verdict_beats_baseline_fold_level": verdict["beats_best_trivial_baseline"],
        "verdict_beats_baseline_bar_level": verdict["beats_baseline_bar_level"],
        "verdict_persistence_r_squared": verdict["persistence_r2"],
        "verdict_note": verdict["note"],
        "source_file": source_file,
    })
    row.update(_diebold_mariano("verdict", verdict.get("bar_level_dm")))
    return row


FOLD_RENAMES = {
    "fold": "fold",
    "n_train": "training_row_count",
    "n_test": "test_row_count",
    "r2_persistence": "persistence_r_squared",
    "r2_train_mean": "train_mean_r_squared",
    "r2_baseline": "baseline_r_squared",
    "ic_persistence": "persistence_information_coefficient",
    "corr_persistence_target": "persistence_target_correlation",
    "baseline_used": "baseline_used",
    "r2_ridge": "ridge_r_squared",
    "ic_ridge": "ridge_information_coefficient",
    "skill_ridge": "ridge_skill",
    "r2_gbm": "gradient_boosting_r_squared",
    "ic_gbm": "gradient_boosting_information_coefficient",
    "skill_gbm": "gradient_boosting_skill",
}


def fold_rows(meta: dict) -> list[dict[str, object]]:
    target = meta["config"]["target"]
    rows = []
    for fold in meta["per_fold"]:
        row: dict[str, object] = {"target": target}
        for source, name in FOLD_RENAMES.items():
            row[name] = fold.get(source)
        rows.append(row)
    return rows


def read_results(root: str) -> tuple[pd.DataFrame, pd.DataFrame, list[str]]:
    paths = sorted(glob.glob(os.path.join(root, PATTERN)))
    if not paths:
        raise FileNotFoundError(f"no best_meta.json under {os.path.join(root, PATTERN)}")
    targets: list[dict[str, object]] = []
    folds: list[dict[str, object]] = []
    for path in paths:
        with open(path, encoding="utf-8") as handle:
            meta = json.load(handle)
        targets.append(target_row(meta, os.path.relpath(path, root).replace("\\", "/")))
        folds.extend(fold_rows(meta))
    return pd.DataFrame(targets), pd.DataFrame(folds), paths


def recipe_exists(recipe: str) -> bool:
    from lake.layout import arrow_fs, arrow_key, derived_root

    key = arrow_key(derived_root(DATASET, recipe) / "table=targets" / "part-0.parquet")
    return arrow_fs().get_file_info(key).type.name != "NotFound"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--recipe", default=DEFAULT_RECIPE)
    parser.add_argument("--models-root", default=MODELS_ROOT)
    args = parser.parse_args()

    if recipe_exists(args.recipe):
        print(f"recipe {args.recipe} is already landed under {DATASET}; pass --recipe for a new one", file=sys.stderr)
        return 1
    targets, folds, paths = read_results(args.models_root)
    written = sorted({dt.datetime.fromtimestamp(os.path.getmtime(path), dt.timezone.utc).strftime("%Y-%m-%d") for path in paths})
    print(f"read {len(targets)} targets ({', '.join(targets['target'])}) and {len(folds)} fold rows; files written {', '.join(written)}")
    with tempfile.TemporaryDirectory() as scratch:
        local = write_local({"targets": targets, "folds": folds}, scratch)
        landed = land(
            local,
            args.recipe,
            source=f"{args.models_root}\\MNQ_1m_path_geometry_fwd_*_h60\\best_meta.json (written {', '.join(written)} by scripts/train_path_geometry.py)",
            dataset=DATASET,
        )
    for name, detail in landed.items():
        print(f"  {name}: {detail['rows']:,} rows, {detail['bytes']:,} bytes, manifest {detail['manifest']}, {detail['uri']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
