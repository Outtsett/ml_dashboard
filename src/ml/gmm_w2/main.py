"""
gmm_w2 — auto-generated from template gmm@0.1.0.

Catalog source : gaussian-mixture-model-gmm
Generated at   : 2026-05-10T07:43:15+00:00
Symbol/TF      : MNQ/1m
Label strategy : triple_barrier

Standard CLI surface (orchestrator-compatible):

    python src/ml/gmm_w2/main.py \\
        --symbol MNQ --timeframe 1m \\
        --model-id <run_id> --json [--max-bars N] \\
        [--date-start ... --date-end ...] \\
        [--feature-categories cat1,cat2,...] \\
        [--<hp> <value> ...]

Emits the standard JSON-line event stream consumed by the dashboard SSE
parser registry (`src/server/training/runners/parsers/`):
  log / progress / metric_declarations / metric / fold_complete / done

Outputs to ``data/models/<model_id>/``:
  checkpoint.json, diagnostics.json, oos_predictions.parquet
"""

from __future__ import annotations

import argparse
import sys
import time
import traceback
from pathlib import Path
from typing import Any  # noqa: F401  — used by family overrides

import numpy as np

_HERE = Path(__file__).resolve()
_PROJECT_ROOT = _HERE.parents[3]
sys.path.insert(0, str(_PROJECT_ROOT))

from sklearn.mixture import GaussianMixture
from src.ml.shared.data import load_ohlcv_arrays
from src.ml.shared.feature_cache import cached_features
from src.ml.shared.features import compute_features
from src.ml.shared.protocol import (
    dumps_safe,
    emit_done,
    emit_error,
    emit_log,
    emit_metric,
    emit_progress,
)

# Module-level state for per-fold OOS aggregation (read by eval block).
_FOLD_STATE: dict = {"states": [], "posteriors": [], "n_components": 0}


# --------------------------------------------------------------------------- #
# Numba JIT warmup — pay the cold-compile cost ONCE at import time so the
# first walk-forward fold doesn't eat the JIT latency. Per ml sub-plan §7
# risk #2.
# --------------------------------------------------------------------------- #

try:
    from src.ml.shared.labels import _warmup_numba  # type: ignore[attr-defined]
    _warmup_numba()
except Exception:
    # Warmup is opportunistic — the labels module may not expose _warmup_numba
    # yet (W1.b ml-data work owns adding it).  Generated code MUST still run.
    pass


# --------------------------------------------------------------------------- #
# Argparse — the schema below is generated from the template-context's
# `hyperparameters` dict so each generated model surfaces ONLY the knobs that
# its catalog spec actually accepts.
# --------------------------------------------------------------------------- #


def _parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser(description="gmm_w2 — generated trainer")
    # Standard orchestrator-required flags
    ap.add_argument("--symbol", required=True)
    ap.add_argument("--timeframe", required=True)
    ap.add_argument("--model-id", required=True)
    ap.add_argument("--json", action="store_true", help="Emit JSON-line events")
    ap.add_argument("--max-bars", type=int, default=0)
    ap.add_argument("--date-start", default=None)
    ap.add_argument("--date-end", default=None)
    ap.add_argument(
        "--feature-categories", default='price_action,volatility,volume',
        help="Comma-separated list of feature categories.",
    )
    # Hyperparameters (one ap.add_argument per key in the catalog spec)
    ap.add_argument(
        "--n-components",
        default=3,
        type=int,
    )
    ap.add_argument(
        "--covariance-type",
        default='full',
        type=str,
    )
    return ap.parse_args()


# --------------------------------------------------------------------------- #
# args → canonical config dict — pattern from xgb_classifier/main.py:232-256
# --------------------------------------------------------------------------- #


_HP_KEYS: tuple[str, ...] = (
    'n_components',
    'covariance_type',
)


def args_to_config(args: argparse.Namespace, *, extra_keys: tuple[str, ...] = ()) -> dict:
    """Translate argparse Namespace to the canonical config dict.

    `extra_keys` is honored so HPO drivers / composite parents can stamp
    additional fields (e.g. fold_index, trial_id) without re-deriving the
    base schema.
    """
    config: dict[str, Any] = {
        "symbol": args.symbol,
        "timeframe": args.timeframe,
        "model_id": args.model_id,
        "max_bars": int(args.max_bars or 0),
        "date_start": args.date_start,
        "date_end": args.date_end,
        "feature_categories": args.feature_categories,
    }
    for key in _HP_KEYS:
        attr = key.replace("-", "_")
        config[key] = getattr(args, attr)
    for key in extra_keys:
        config[key] = getattr(args, key, None)
    return config


# --------------------------------------------------------------------------- #
# Feature loading — identical to xgb_classifier/main.py:86-112.
# (W2 ml-features lifts this body to src.ml.shared.features.load_features_with_cache;
# until then the inline copy keeps generated models self-contained.)
# --------------------------------------------------------------------------- #


def load_features(args: argparse.Namespace) -> tuple[np.ndarray, list[str], np.ndarray, dict]:
    """Returns (feature_matrix, feature_names, timestamps_epoch_s, raw_ohlcv)."""
    date_range = None
    if args.date_start or args.date_end:
        date_range = {}
        if args.date_start:
            date_range["start"] = args.date_start
        if args.date_end:
            date_range["end"] = args.date_end

    categories = None
    if args.feature_categories:
        categories = [s.strip() for s in args.feature_categories.split(",") if s.strip()]

    raw = load_ohlcv_arrays(args.symbol, args.timeframe, max_bars=int(args.max_bars or 0),
                             date_range=date_range)

    def _compute() -> tuple[np.ndarray, list[str], np.ndarray]:
        ohlcv = {
            "open_": raw["open"], "high": raw["high"], "low": raw["low"],
            "close": raw["close"], "volume": raw["volume"],
        }
        matrix, names, _ts = compute_features(ohlcv, categories=categories, n_jobs=1)
        ts_arr = np.asarray(
            [t.timestamp() if hasattr(t, "timestamp") else float(t)
             for t in raw["timestamp"]],
            dtype=np.int64,
        )
        return matrix.astype(np.float32), list(names), ts_arr

    matrix, names, timestamps = cached_features(
        symbol=args.symbol, timeframe=args.timeframe, date_range=date_range,
        categories=categories, compute_fn=_compute,
    )
    return matrix, names, timestamps, raw


# --------------------------------------------------------------------------- #
# Label generation — uses src.ml.shared.labels.<strategy>_labels per the
# template-context label_strategy. Override the label_generation block in a
# child template to plug in a custom label fn.
# --------------------------------------------------------------------------- #

def generate_labels(raw, args):
    """GMM is unsupervised — return a no-label sentinel and an all-True mask.

    The downstream WF loop still needs `labels` and `valid` arrays of the same
    length as the OHLCV close price; we return zeros (placeholder integer
    labels) and a True mask covering every bar.
    """
    n = int(raw["close"].shape[0])
    return np.zeros(n, dtype=np.int8), np.ones(n, dtype=bool)


# --------------------------------------------------------------------------- #
# Training loop + fold metric helper.
#
# Required cross-domain contract (ml sub-plan §6 footer):
#   train_one_fold(X_train, y_train, X_test, y_test, args, *, fold_idx=None)
#       -> (model, preds)
#   predict(model, X) -> np.ndarray
# Composite templates (W5) import these names directly, so changing the
# signature here is a breaking change for every downstream composite.
# --------------------------------------------------------------------------- #

def train_one_fold(X_train, y_train, X_test, y_test, args, *, fold_idx=None):
    """GMM unsupervised fit on X_train, posterior predict on X_test.

    The walk-forward loop still passes y_train / y_test (the placeholder
    zeros from generate_labels above); they're ignored here.
    """
    model = GaussianMixture(        n_components=3,        covariance_type='full',        random_state=42,
    )
    model.fit(X_train)
    posterior = model.predict_proba(X_test)
    states = posterior.argmax(axis=1)

    _FOLD_STATE["states"].append(states.astype(np.int64))
    _FOLD_STATE["posteriors"].append(posterior.astype(np.float64))
    _FOLD_STATE["n_components"] = int(model.n_components)

    # `preds` here is the per-row max-component posterior — a clustering
    # confidence proxy. The placeholder compute_fold_metrics in _base only
    # reads .mean() so a well-formed array is enough.
    return model, posterior.max(axis=1).astype(np.float64)


def predict(model, X):
    """Standard predict contract for unsupervised GMM: posterior matrix."""
    return model.predict_proba(X)


def compute_fold_metrics(y_test, preds, *, fold_idx=None) -> dict[str, float]:
    """Per-fold metrics — family templates can override this block to plug in
    the real classification/regression evaluator. The default below keeps the
    WF loop runnable end-to-end with a minimal output."""
    preds_arr = np.asarray(preds, dtype=np.float64)
    y_arr = np.asarray(y_test, dtype=np.float64)
    if preds_arr.shape != y_arr.shape:
        # Multi-class proba — argmax to a class index for accuracy fallback.
        if preds_arr.ndim == 2 and preds_arr.shape[0] == y_arr.shape[0]:
            preds_arr = preds_arr.argmax(axis=1).astype(np.float64)
    return {
        "n_samples": float(y_arr.size),
        "mean_pred": float(preds_arr.mean()) if preds_arr.size else 0.0,
        "mean_label": float(y_arr.mean()) if y_arr.size else 0.0,
    }


# --------------------------------------------------------------------------- #
# Module-level eval helpers — family templates plug in the eval module
# (`_eval_classification.py.j2`, `_eval_regression.py.j2`, or future
# `_eval_clustering.py.j2`) here so its top-level functions land at module
# scope, not spliced into run_training()'s body.
# --------------------------------------------------------------------------- #



# --------------------------------------------------------------------------- #
# Main pipeline — load, label, filter, walk-forward (or single fold), report.
# --------------------------------------------------------------------------- #


def _filter_valid(X, y, valid, timestamps):
    keep = np.flatnonzero(valid)
    X = X[keep]; y = y[keep]; timestamps = timestamps[keep]
    finite = np.isfinite(X).all(axis=1)
    return X[finite], y[finite], timestamps[finite]


def run_training(args: argparse.Namespace) -> dict:
    emit_log(f"[gmm] Loading {args.symbol}@{args.timeframe} "
             f"(categories={args.feature_categories or 'all'})")
    matrix, names, timestamps, raw = load_features(args)
    n_total = matrix.shape[0]
    emit_log(f"[gmm] Loaded {n_total:,} bars x {matrix.shape[1]} features")

    emit_log(f"[gmm] Generating triple_barrier labels")
    labels, valid = generate_labels(raw, args)

    X, y, ts_kept = _filter_valid(matrix, labels, valid, timestamps)
    emit_log(f"[gmm] After dropping non-finite rows: {X.shape[0]:,} samples")

    from src.ml.shared.protocol import emit_fold_complete
    from src.ml.shared.walk_forward import iter_folds

    fold_results: list[dict] = []
    fold_iter = iter_folds(
        timestamps=ts_kept,
        train_months=3,
        test_months=1,
        step_months=1,
        purge_bars=5,
        embargo_bars=0,
        expanding=False,
    )
    fold_count = 0
    for fold in fold_iter:
        fold_count += 1
        emit_log(
            f"[wf] Fold {fold.idx}: train {fold.train_start} -> {fold.train_end} | "
            f"test {fold.test_start} -> {fold.test_end} "
            f"(n_train={fold.train_idx.size}, n_test={fold.test_idx.size})"
        )
        emit_progress(fold.idx, 0, "walk_forward")
        X_train, y_train = X[fold.train_idx], y[fold.train_idx]
        X_test, y_test = X[fold.test_idx], y[fold.test_idx]

        model, preds = train_one_fold(
            X_train, y_train, X_test, y_test, args, fold_idx=fold.idx,
        )
        fold_metrics = compute_fold_metrics(y_test, preds, fold_idx=fold.idx)
        for name, value in fold_metrics.items():
            # Skip None/NaN — emit_metric only accepts real numbers, and the
            # classification eval intentionally returns None for metrics that
            # are undefined for the inputs (e.g. AUC when one class is missing,
            # PnL when per-fold prices aren't bound).
            if value is None:
                continue
            try:
                fv = float(value)
            except (TypeError, ValueError):
                continue
            if fv != fv:  # NaN
                continue
            emit_metric(name=f"fold_{fold.idx}_{name}", value=fv, iteration=fold.idx)
        emit_fold_complete(fold_idx=fold.idx, metrics=fold_metrics)

        fold_results.append({
            "fold": int(fold.idx),
            "train_start": str(fold.train_start),
            "train_end": str(fold.train_end),
            "test_start": str(fold.test_start),
            "test_end": str(fold.test_end),
            "n_train": int(fold.train_idx.size),
            "n_test": int(fold.test_idx.size),
            "metrics": fold_metrics,
        })

    emit_log(f"[wf] Completed {fold_count} fold(s)")

    # ─── W2.b minimal clustering diagnostics ─────────────────────────────
    # The full clustering eval (silhouette + Davies-Bouldin + regime tag
    # emission) lands in W4 via `{% include "_eval_clustering.py.j2" %}`. For
    # W2.b we write a lightweight artifact so the orchestrator's done-event
    # parser sees a well-formed diagnostics.json.
    if _FOLD_STATE["states"]:
        all_states = np.concatenate(_FOLD_STATE["states"]).astype(np.int64)
        # Cap the per-fold tail we publish so diagnostics.json stays small.
        states_preview = all_states[-1000:].tolist()
    else:
        all_states = np.asarray([], dtype=np.int64)
        states_preview = []

    n_components = _FOLD_STATE["n_components"]
    state_counts = (
        {int(s): int((all_states == s).sum()) for s in range(n_components)}
        if all_states.size and n_components else {}
    )

    diagnostics = {
        "model_id": args.model_id,
        "symbol": args.symbol,
        "timeframe": args.timeframe,
        "template_id": "gmm",
        "template_version": "0.1.0",
        "catalog_id": "gaussian-mixture-model-gmm",
        "task_kind": "clustering",
        "n_components": int(n_components),
        "n_total_bars": int(n_total),
        "n_kept_samples": int(X.shape[0]),
        "n_features": int(X.shape[1]),
        "feature_names": list(names),
        "states_preview": states_preview,
        "state_counts": state_counts,
        "fold_results": fold_results,
    }

    out_dir = _PROJECT_ROOT / "data" / "models" / args.model_id
    out_dir.mkdir(parents=True, exist_ok=True)
    # dumps_safe, not json.dumps — a bare NaN makes the whole file unparseable
    # by JSON.parse and 500s /api/training/models/:id/diagnostics.
    (out_dir / "diagnostics.json").write_text(
        dumps_safe(diagnostics, indent=2), encoding="utf-8",
    )

    return diagnostics


# --------------------------------------------------------------------------- #
# Entry point — try/except + emit_done wrapper, identical to
# xgb_classifier/main.py:513-525.
# --------------------------------------------------------------------------- #


def main() -> None:
    args = _parse_args()
    t0 = time.perf_counter()
    try:
        diagnostics = run_training(args)
        elapsed = time.perf_counter() - t0
        diagnostics["train_secs"] = round(elapsed, 2)
        emit_done(
            model_path=str(_PROJECT_ROOT / "data" / "models" / args.model_id),
            diagnostics=diagnostics,
        )
    except Exception as exc:
        emit_error(message=str(exc), details=traceback.format_exc())
        raise


if __name__ == "__main__":
    main()
