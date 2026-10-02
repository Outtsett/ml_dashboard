"""Land the candle-vocabulary study's stored results in the lake, so the dashboard's study page reads them.

The two experiments behind ``Trading/quant/model/notebooks/candle_vocab.py`` wrote plain files the dashboard
cannot query:

* ``scripts/train_candle_seq.py``  -> ``data/analysis/candle_seq/<symbol>_<tf>_k<K>_w<W>_h<H>_scale<0|1>.json``
  (forward-volatility R-squared of each representation alone and added to a HAR-RV baseline) and
  ``..._scale<0|1>_archetypes.npz`` (the mean real window of each code of the K-symbol vocabulary);
* ``scripts/train_candle_lm.py``   -> ``data/analysis/candle_lm/<symbol>_<tf>_k<K>_w<W>_s<stride>.json``
  (next-symbol prediction against unigram, bigram and trigram baselines).

This build reads those files read-only, computes exactly what the notebook computed (``added_to_har`` = the
representation's HAR-plus R-squared minus the HAR row's own R-squared, now selected by name rather than by the
HAR row happening to come first; ``nats_vs_unigram`` = the unigram negative log-likelihood minus the model's,
matched on timeframe, code count, width and symbol stride), renames every column in full words, and lands four
tables as dataset ``study_candle_vocabulary`` (one recipe, one manifest line per table, through the Model Cycle
landing job as ``ta_strategy/store.py`` does). The dashboard serves each as
``derived_study_candle_vocabulary_<table>``:

    sequence_results            one row per (run, representation): R-squared alone, with HAR-RV, added to HAR-RV
    archetypes                  one row per (archetype set, code, bar): the mean shape channels and the code's count
    language_model_results      one row per (run, model): next-symbol accuracy and negative log-likelihood
    language_model_direction    one row per (run, model): direction accuracy read off the predicted next symbol

Nothing is refit: the notebook was a pure read of these files and so is this. Run once with::

    E:\\source\\repos\\datalake\\.venv\\Scripts\\python.exe src\\ml\\studies\\candle_vocabulary\\build.py
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import tempfile
import time
from pathlib import Path

import numpy as np
import pandas as pd

ML_ROOT = Path(__file__).resolve().parents[2]
if str(ML_ROOT) not in sys.path:
    sys.path.insert(0, str(ML_ROOT))

from ta_strategy.store import land  # noqa: E402

DATASET = "study_candle_vocabulary"
RECIPE = "candle_vocabulary_v1"
MODEL_ROOT = Path(os.environ.get("CANDLE_VOCABULARY_ROOT", r"E:\source\repos\ml_dashboard\Trading\quant\model"))
SEQUENCE_DIRECTORY = MODEL_ROOT / "data" / "analysis" / "candle_seq"
LANGUAGE_MODEL_DIRECTORY = MODEL_ROOT / "data" / "analysis" / "candle_lm"

#: candle_geometry's five channels (scripts/discover_candle_patterns.py), then train_candle_seq.py --with-scale's two
SHAPE_CHANNELS = ("open_position_fraction", "close_position_fraction", "body_fraction", "upper_wick_fraction", "lower_wick_fraction")
MAGNITUDE_CHANNELS = ("log_range_zscore", "log_volume_zscore")

#: the stored model names, and the full-word names the lake carries
REPRESENTATIONS = {
    "har": "har_rv_baseline",
    "code_rand": "code_with_random_embedding",
    "code_book": "code_with_codebook_embedding",
    "latent_z": "continuous_latent_without_quantisation",
}
LANGUAGE_MODELS = {
    "unigram": "unigram",
    "bigram": "bigram",
    "trigram": "trigram",
    "causal only": "causal_transformer_only",
    "MLM + causal": "masked_and_causal_transformer",
}


def log(message: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {message}", flush=True)


def load_json(path: Path) -> dict:
    # the LM files carry bare NaN, which json.loads accepts
    return json.loads(path.read_text(encoding="utf-8"))


def clean(value: float | None) -> float | None:
    """NaN becomes a null, so the lake holds a missing number as missing, never as a value."""
    if value is None:
        return None
    return None if isinstance(value, float) and math.isnan(value) else float(value)


def sequence_results() -> pd.DataFrame:
    rows = []
    for path in sorted(SEQUENCE_DIRECTORY.glob("*_h*.json")):
        run = load_json(path)
        args = run["args"]
        har = next((r for r in run["results"] if r["model"] == "har"), None)
        if har is None:
            raise RuntimeError(f"{path.name} has no 'har' row to measure added_to_har against")
        for result in run["results"]:
            rows.append({
                "run_name": path.stem,
                "symbol": args["symbol"],
                "timeframe": args["timeframe"],
                "code_count": int(args["n_codes"]),
                "width_bars": int(args["width"]),
                "horizon_bars": int(args["horizon"]),
                "history_months": float(args["months"]),
                "with_magnitude_channels": bool(args.get("with_scale", False)),
                "channel_count": int(run["channels"]),
                "representation": REPRESENTATIONS.get(result["model"], result["model"]),
                "stored_model_name": result["model"],
                "out_of_sample_r_squared": clean(result["oos_r2"]),
                "har_plus_r_squared": clean(result.get("har_plus")),
                "added_to_har_r_squared": clean(result["har_plus"] - har["oos_r2"]) if result.get("har_plus") is not None else None,
                "codebook_perplexity": clean(run["codebook"]["code_perplexity"]),
                "codes_used_count": int(run["codebook"]["codes_used"]),
                "windows_assigned_count": int(run["codebook"]["n_assigned"]),
                "bar_count": int(run["bars"]),
                "train_sequence_count": int(run["sequences_train"]),
                "test_sequence_count": int(run["sequences_test"]),
                "random_seed": int(args["seed"]),
                "test_fraction": float(args["test_frac"]),
                "elapsed_seconds": clean(run.get("elapsed_s")),
                "source_file": path.name,
            })
    return pd.DataFrame(rows)


def archetypes() -> pd.DataFrame:
    rows = []
    for path in sorted(SEQUENCE_DIRECTORY.glob("*_archetypes.npz")):
        data = np.load(path)
        shapes, counts = data["shapes"], data["counts"]
        code_count, channel_count, width = shapes.shape
        with_magnitude = bool(data["with_scale"])
        stem = path.stem.removesuffix("_archetypes")
        symbol, timeframe = stem.split("_")[0], stem.split("_")[1]
        total = int(counts.sum())
        order = {int(code): rank + 1 for rank, code in enumerate(np.argsort(-counts, kind="stable"))}
        names = SHAPE_CHANNELS + (MAGNITUDE_CHANNELS if channel_count == len(SHAPE_CHANNELS) + len(MAGNITUDE_CHANNELS) else ())
        if len(names) != channel_count:
            raise RuntimeError(f"{path.name}: {channel_count} channels but {len(names)} names")
        for code in range(code_count):
            for bar in range(width):
                row = {
                    "run_name": stem,
                    "symbol": symbol,
                    "timeframe": timeframe,
                    "code_count": int(code_count),
                    "width_bars": int(width),
                    "with_magnitude_channels": with_magnitude,
                    "code": code,
                    "bar_position": bar,
                    "windows_assigned_count": int(counts[code]),
                    "share_of_windows_fraction": float(counts[code]) / total if total else None,
                    "rank_by_window_count": order[code],
                }
                for channel, name in enumerate(names):
                    row[name] = clean(float(shapes[code, channel, bar]))
                for name in MAGNITUDE_CHANNELS:
                    row.setdefault(name, None)
                row["source_file"] = path.name
                rows.append(row)
    return pd.DataFrame(rows)


def language_model() -> tuple[pd.DataFrame, pd.DataFrame]:
    results, direction = [], []
    for path in sorted(LANGUAGE_MODEL_DIRECTORY.glob("*.json")):
        run = load_json(path)
        args = run["args"]
        stride = int(args.get("symbol_stride") or args["width"])  # the notebook's fallback: no stride means the width
        common = {
            "run_name": path.stem,
            "symbol": args["symbol"],
            "timeframe": args["timeframe"],
            "code_count": int(args["n_codes"]),
            "width_bars": int(args["width"]),
            "symbol_stride_bars": stride,
        }
        unigram = next((r for r in run["results"] if r["model"] == "unigram"), None)
        if unigram is None:
            raise RuntimeError(f"{path.name} has no 'unigram' row to measure nats_vs_unigram against")
        for result in run["results"]:
            results.append({
                **common,
                "history_months": float(args["months"]),
                "model": LANGUAGE_MODELS.get(result["model"], result["model"]),
                "stored_model_name": result["model"],
                "accuracy_next_symbol": clean(result["acc_t1"]),
                "negative_log_likelihood_next_symbol_nats": clean(result["nll_t1"]),
                "accuracy_two_symbols_ahead": clean(result["acc_t2"]),
                "negative_log_likelihood_two_symbols_ahead_nats": clean(result["nll_t2"]),
                "nats_better_than_unigram": clean(unigram["nll_t1"] - result["nll_t1"]),
                "train_window_count": int(run["windows_train"]),
                "test_window_count": int(run["windows_test"]),
                "train_sequence_count": int(run["sequences_train"]),
                "test_sequence_count": int(run["sequences_test"]),
                "train_codebook_perplexity": clean(run["codebook_train"]["code_perplexity"]),
                "test_codebook_perplexity": clean(run["codebook_test"]["code_perplexity"]),
                "masked_model_final_loss": clean(run.get("mlm_final_loss")),
                "elapsed_seconds": clean(run.get("elapsed_s")),
                "source_file": path.name,
            })
        for row in run.get("direction", []):
            direction.append({
                **common,
                "model": LANGUAGE_MODELS.get(row["model"], row["model"]),
                "stored_model_name": row["model"],
                "direction_accuracy": clean(row["direction_acc"]),
                "test_count": int(row["n"]),
                "majority_direction_accuracy": clean(run.get("majority_direction")),
                "accuracy_minus_majority": clean(row["direction_acc"] - run["majority_direction"]) if run.get("majority_direction") is not None else None,
                "source_file": path.name,
            })
    return pd.DataFrame(results), pd.DataFrame(direction)


def compute() -> dict[str, pd.DataFrame]:
    tables = {"sequence_results": sequence_results(), "archetypes": archetypes()}
    tables["language_model_results"], tables["language_model_direction"] = language_model()
    for name, frame in tables.items():
        if frame.empty:
            raise RuntimeError(f"{name} is empty: is {MODEL_ROOT} the right place?")
        log(f"{name}: {len(frame)} rows, {len(frame.columns)} columns")
    return tables


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--no-land", action="store_true", help="compute and print, do not write the lake")
    args = parser.parse_args()
    tables = compute()
    for name in ("sequence_results", "language_model_results"):
        print(tables[name].drop(columns=["source_file"]).to_string())
    if args.no_land:
        return
    from ta_strategy.store import write_local

    with tempfile.TemporaryDirectory(prefix="study_candle_vocabulary_") as directory:
        paths = write_local(tables, directory)
        source = f"{SEQUENCE_DIRECTORY};{LANGUAGE_MODEL_DIRECTORY}"
        landed = land(paths, RECIPE, source=source, dataset=DATASET)
    for name, info in landed.items():
        log(f"landed {name}: {info['rows']} rows, manifest {info['manifest']}")


if __name__ == "__main__":
    main()
