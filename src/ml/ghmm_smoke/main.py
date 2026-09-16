"""
ghmm_smoke — auto-generated from template hmm@0.1.0.

Catalog source : gaussian-hmm
Generated at   : 2026-05-10T08:32:06+00:00
Symbol/TF      : MNQ/1m
Label strategy : none

Standard CLI surface (orchestrator-compatible):

    python src/ml/ghmm_smoke/main.py \\
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

from hmmlearn.hmm import GaussianHMM as _HMMClass
from src.ml.shared.data import load_ohlcv_arrays
from src.ml.shared.feature_cache import cached_features
from src.ml.shared.features import compute_features
from src.ml.shared.protocol import (
    emit_done,
    emit_error,
    emit_log,
    emit_metric,
)

# Module-level state for per-fold OOS aggregation. Read by the eval_block
# after the walk-forward loop completes.
#
# Shape contract:
#   states[k]        np.ndarray[int64]   (n_test_k,)             Viterbi path
#   posteriors[k]    np.ndarray[float64] (n_test_k, n_states)    responsibilities
#   X_test[k]        np.ndarray[float64] (n_test_k, n_features)  held for silhouette
#   models[k]        _HMMClass instance                          fitted per-fold model
_FOLD_STATE: dict = {
    "states": [],
    "posteriors": [],
    "X_test": [],
    "models": [],
    "n_states": 0,
}


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
    ap = argparse.ArgumentParser(description="ghmm_smoke — generated trainer")
    # Standard orchestrator-required flags
    ap.add_argument("--symbol", required=True)
    ap.add_argument("--timeframe", required=True)
    ap.add_argument("--model-id", required=True)
    ap.add_argument("--json", action="store_true", help="Emit JSON-line events")
    ap.add_argument("--max-bars", type=int, default=0)
    ap.add_argument("--date-start", default=None)
    ap.add_argument("--date-end", default=None)
    ap.add_argument(
        "--feature-categories",
        default="volatility,momentum",
        help="Comma-separated list of feature categories.",
    )
    # Hyperparameters (one ap.add_argument per key in the catalog spec)
    ap.add_argument(
        "--n-states",
        default=4,
        type=int,
    )
    ap.add_argument(
        "--covariance-type",
        default="diag",
        type=str,
    )
    ap.add_argument(
        "--emission",
        default="gaussian",
        type=str,
    )
    ap.add_argument(
        "--n-iter",
        default=20,
        type=int,
    )
    ap.add_argument(
        "--tol",
        default=0.001,
        type=float,
    )
    ap.add_argument(
        "--random-state",
        default=42,
        type=int,
    )
    return ap.parse_args()


# --------------------------------------------------------------------------- #
# args → canonical config dict — pattern from xgb_classifier/main.py:232-256
# --------------------------------------------------------------------------- #


_HP_KEYS: tuple[str, ...] = (
    "n_states",
    "covariance_type",
    "emission",
    "n_iter",
    "tol",
    "random_state",
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

    raw = load_ohlcv_arrays(
        args.symbol, args.timeframe, max_bars=int(args.max_bars or 0), date_range=date_range
    )

    def _compute() -> tuple[np.ndarray, list[str], np.ndarray]:
        ohlcv = {
            "open_": raw["open"],
            "high": raw["high"],
            "low": raw["low"],
            "close": raw["close"],
            "volume": raw["volume"],
        }
        matrix, names, _ts = compute_features(ohlcv, categories=categories, n_jobs=1)
        ts_arr = np.asarray(
            [t.timestamp() if hasattr(t, "timestamp") else float(t) for t in raw["timestamp"]],
            dtype=np.int64,
        )
        return matrix.astype(np.float32), list(names), ts_arr

    matrix, names, timestamps = cached_features(
        symbol=args.symbol,
        timeframe=args.timeframe,
        date_range=date_range,
        categories=categories,
        compute_fn=_compute,
    )
    return matrix, names, timestamps, raw


# --------------------------------------------------------------------------- #
# Label generation — uses src.ml.shared.labels.<strategy>_labels per the
# template-context label_strategy. Override the label_generation block in a
# child template to plug in a custom label fn.
# --------------------------------------------------------------------------- #


def generate_labels(raw, args):
    """HMM is unsupervised — return placeholder zeros + all-True mask.

    The WF loop still passes y_train / y_test (the zeros from here); they're
    ignored by train_one_fold below. Mirrors gmm.py.j2's pattern.
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


def _build_hmm() -> _HMMClass:
    """Instantiate the hmmlearn estimator with the catalog hyperparameters.

    Splits the kwargs by emission family because GMMHMM accepts `n_mix` but
    GaussianHMM does not — passing it to GaussianHMM raises TypeError.
    """
    return _HMMClass(
        n_components=4,
        covariance_type="diag",
        n_iter=20,
        tol=0.001,
        random_state=42,
    )


def train_one_fold(X_train, y_train, X_test, y_test, args, *, fold_idx=None):
    """HMM unsupervised fit on X_train; Viterbi decode + posteriors on X_test.

    Returns (model, posteriors_2d) per the cross-domain contract documented
    in _base.py.j2: composite templates (W5) import this signature directly.
    Posteriors are 2-D (B, n_states); the WF compute_fold_metrics helper
    in _eval_clustering accepts both 1-D state IDs and 2-D posteriors via
    its `_eval_to_state_labels()` argmax branch.
    """
    model = _build_hmm()
    # hmmlearn's fit() accepts a single contiguous sequence by default; for
    # multi-sequence training (e.g. multiple symbols) the caller passes
    # `lengths`. The generated runner is single-sequence per fold.
    model.fit(X_train)
    state_path = model.predict(X_test)  # (n_test,) int Viterbi
    posteriors = model.predict_proba(X_test)  # (n_test, n_states) float

    _FOLD_STATE["states"].append(np.asarray(state_path, dtype=np.int64))
    _FOLD_STATE["posteriors"].append(np.asarray(posteriors, dtype=np.float64))
    # X_test is held by reference so the per-fold silhouette computation in
    # the eval block can run on the same rows the model decoded against.
    _FOLD_STATE["X_test"].append(np.asarray(X_test, dtype=np.float64))
    _FOLD_STATE["models"].append(model)
    _FOLD_STATE["n_states"] = int(model.n_components)
    return model, posteriors


def predict(model, X):
    """Standard predict contract for unsupervised HMM: posterior matrix.

    Returns (B, n_states) array of state responsibilities. Composite templates
    in W5 that consume this as a sub-model expert will typically argmax to
    a single regime label or take the max-posterior as a confidence proxy.
    """
    return model.predict_proba(X)


# --------------------------------------------------------------------------- #
# Module-level eval helpers — family templates plug in the eval module
# (`_eval_classification.py.j2`, `_eval_regression.py.j2`, or future
# `_eval_clustering.py.j2`) here so its top-level functions land at module
# scope, not spliced into run_training()'s body.
# --------------------------------------------------------------------------- #

# ──────────────────────────────────────────────────────────────────────────────
# Shared clustering eval (rendered from _eval_clustering.py.j2)
# ──────────────────────────────────────────────────────────────────────────────
from pathlib import Path as _EvalPath

import numpy as _eval_np

try:
    from src.ml.shared.protocol import (
        emit_metric_declarations as _eval_emit_decls,
    )
    from src.ml.shared.protocol import (
        emit_overlay as _eval_emit_overlay,
    )
except Exception:  # pragma: no cover — protocol must exist in real runs

    def _eval_emit_decls(_decls):  # type: ignore[no-redef]
        return None

    def _eval_emit_overlay(*_args, **_kwargs):  # type: ignore[no-redef]
        return None

# sklearn metrics are imported lazily inside compute_clustering_metrics_full
# so the template still compiles + imports cleanly when sklearn is missing.


# ─── Internal helpers ─────────────────────────────────────────────────────────


def _eval_safe_finite(x) -> float | None:
    """Convert numeric to float or None if non-finite."""
    if x is None:
        return None
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    if not _eval_np.isfinite(v):
        return None
    return v


def _eval_to_state_labels(predictions) -> _eval_np.ndarray:
    """Coerce predictions to a 1-D integer state vector.

    Accepts:
      - (n,) integer or float state IDs
      - (n, K) posterior probability matrix (returns argmax per row)
    """
    arr = _eval_np.asarray(predictions)
    if arr.ndim == 1:
        return arr.astype(_eval_np.int64)
    if arr.ndim == 2:
        return arr.argmax(axis=1).astype(_eval_np.int64)
    raise ValueError(f"Cannot interpret clustering predictions with shape {arr.shape}")


def _eval_to_confidence(predictions) -> _eval_np.ndarray:
    """Per-sample confidence: max posterior if 2-D, else 1.0 fallback."""
    arr = _eval_np.asarray(predictions)
    if arr.ndim == 2:
        return arr.max(axis=1).astype(_eval_np.float32)
    n = int(arr.shape[0]) if arr.ndim >= 1 else 0
    return _eval_np.ones(n, dtype=_eval_np.float32)


def _eval_state_population_stats(states: _eval_np.ndarray) -> dict:
    """Return n_clusters / n_samples / cluster_balance / state_counts."""
    n_samples = int(states.size)
    if n_samples == 0:
        return {
            "n_clusters": 0,
            "n_samples": 0,
            "cluster_balance": None,
            "state_counts": {},
        }
    unique, counts = _eval_np.unique(states, return_counts=True)
    n_clusters = int(unique.size)
    if n_clusters <= 1:
        balance: float | None = 1.0 if n_clusters == 1 else None
    else:
        cmax = float(counts.max())
        cmin = float(counts.min())
        balance = float(cmin / cmax) if cmax > 0 else None
    state_counts = {int(s): int(c) for s, c in zip(unique.tolist(), counts.tolist())}
    return {
        "n_clusters": n_clusters,
        "n_samples": n_samples,
        "cluster_balance": balance,
        "state_counts": state_counts,
    }


# ─── Per-fold metric assembly ─────────────────────────────────────────────────


def compute_fold_metrics(y_test, predictions, *, fold_idx=None) -> dict:
    """2-arg per-fold clustering metrics — no X_test access.

    Returns cluster-population stats only. silhouette / davies_bouldin are
    set to None because both sklearn metrics need the original feature
    matrix. Family templates that have X_test in scope should call
    compute_clustering_metrics_full instead (or in addition).

    Parameters
    ----------
    y_test : array-like
        Unsupervised placeholder labels (zeros, from generate_labels). Read
        for shape parity only; values are not used.
    predictions : array-like, shape (n,) or (n, K)
        Per-sample state assignments (int) or posterior probability matrix.
    fold_idx : int | None
        Informational; not used in computation.

    Returns
    -------
    dict
        Keys: silhouette (None), davies_bouldin (None), n_clusters,
        n_samples, cluster_balance.
    """
    states = _eval_to_state_labels(predictions)
    pop = _eval_state_population_stats(states)
    return {
        "silhouette": None,
        "davies_bouldin": None,
        "n_clusters": pop["n_clusters"],
        "n_samples": pop["n_samples"],
        "cluster_balance": _eval_safe_finite(pop["cluster_balance"]),
    }


def compute_clustering_metrics_full(
    X_test,
    predictions,
    *,
    fold_idx=None,
    sample_cap: int = 10000,
) -> dict:
    """3-arg per-fold clustering metrics — full version with sklearn metrics.

    Parameters
    ----------
    X_test : array-like, shape (n, d)
        Feature matrix the clustering ran over. Required by silhouette and
        Davies-Bouldin scores.
    predictions : array-like, shape (n,) or (n, K)
        Per-sample state assignments (int) or posterior probability matrix.
    fold_idx : int | None
        Informational; not used in computation.
    sample_cap : int
        Cap for the silhouette random subsample. silhouette is O(n^2) so we
        cap at 10k by default to keep eval responsive on large folds. The
        Davies-Bouldin score is computed on the full set (it's only O(K^2 d)).

    Returns
    -------
    dict
        Keys: silhouette, davies_bouldin, n_clusters, n_samples,
        cluster_balance. silhouette / davies_bouldin are None when the
        metric is undefined (e.g. only one cluster present).
    """
    X = _eval_np.asarray(X_test)
    states = _eval_to_state_labels(predictions)
    pop = _eval_state_population_stats(states)

    silhouette: float | None = None
    davies_bouldin: float | None = None

    # Both sklearn metrics require >= 2 distinct labels.
    if pop["n_clusters"] >= 2 and X.ndim == 2 and X.shape[0] == states.size and X.shape[0] > 1:
        try:
            from sklearn.metrics import (
                davies_bouldin_score as _db_score,
            )
            from sklearn.metrics import (
                silhouette_score as _silhouette_score,
            )

            n = int(X.shape[0])
            cap = max(2, min(int(sample_cap), n))
            try:
                silhouette = _eval_safe_finite(
                    _silhouette_score(
                        X,
                        states,
                        metric="euclidean",
                        sample_size=cap if cap < n else None,
                        random_state=42,
                    )
                )
            except Exception:
                silhouette = None
            try:
                davies_bouldin = _eval_safe_finite(_db_score(X, states))
            except Exception:
                davies_bouldin = None
        except ImportError:  # pragma: no cover — sklearn is a hard dep in ml env
            silhouette = None
            davies_bouldin = None

    return {
        "silhouette": silhouette,
        "davies_bouldin": davies_bouldin,
        "n_clusters": pop["n_clusters"],
        "n_samples": pop["n_samples"],
        "cluster_balance": _eval_safe_finite(pop["cluster_balance"]),
    }


# ─── Metric declarations (dashboard schema) ──────────────────────────────────


def _emit_metric_declarations() -> None:
    """Publish the clustering metric-rendering schema to the dashboard.

    Mirrors the shape used by `_eval_classification.py.j2::_emit_metric_declarations`
    so the dashboard's metric-renderer registry can pre-configure renderers
    before per-fold metrics start streaming.
    """
    _eval_emit_decls(
        {
            "silhouette": {
                "renderer": "gauge",
                "group": "clustering quality",
                "mission": "How well-separated are the clusters? 1=perfect, 0=overlap, <0=mis-assigned.",
                "context": {
                    "min": -1.0,
                    "baseline": 0.0,
                    "good": 0.25,
                    "great": 0.5,
                    "max": 1.0,
                    "decimals": 4,
                },
            },
            "davies_bouldin": {
                "renderer": "number",
                "group": "clustering quality",
                "mission": "Avg ratio of within-cluster scatter to between-cluster separation. LOWER is better; 0 = perfect.",
                "context": {"min": 0.0, "good": 1.0, "great": 0.5, "decimals": 4},
            },
            "n_clusters": {
                "renderer": "number",
                "group": "clustering structure",
                "mission": "Number of distinct state IDs the model assigned in this fold.",
                "context": {"min": 1, "decimals": 0},
            },
            "n_samples": {
                "renderer": "number",
                "group": "clustering structure",
                "mission": "Number of OOS samples assigned in this fold.",
                "context": {"min": 0, "decimals": 0},
            },
            "cluster_balance": {
                "renderer": "percent",
                "group": "clustering structure",
                "mission": "min(state population) / max(state population). 1.0 = perfectly balanced.",
                "context": {
                    "min": 0.0,
                    "baseline": 0.0,
                    "good": 0.25,
                    "great": 0.5,
                    "max": 1.0,
                    "decimals": 4,
                },
            },
        }
    )


# ─── Diagnostics dict assembly ────────────────────────────────────────────────


def build_diagnostics(
    model,
    X_test,
    y_test,
    predictions,
    ts_test=None,
    fold_results: list | None = None,
    output_dir=None,
    *,
    model_id: str = "",
    symbol: str = "MNQ",
    timeframe: str = "1m",
    n_train: int = 0,
    n_val: int | None = None,
    n_features: int = 0,
    template_id: str = "",
    template_version: str = "",
    catalog_id: str = "",
    extra: dict | None = None,
) -> dict:
    """Build the SelfDescribingDiagnostics dict for clustering models.

    Mirrors the structure of `_eval_classification.build_diagnostics` and
    `_eval_regression.build_diagnostics`, swapping in clustering metrics. The
    returned dict is suitable for direct json.dump to ``diagnostics.json``.

    Parameters
    ----------
    model : object
        The fitted clustering estimator. Stored only via type name + n_clusters
        attribute when present (no pickling).
    X_test : array-like, shape (n, d) | None
        Feature matrix for OOS metric computation. When None, sklearn metrics
        fall back to None.
    y_test : array-like
        Unsupervised placeholder labels (zeros). Carried in the diagnostics
        dict via its length only.
    predictions : array-like, shape (n,) or (n, K)
        Per-sample state assignments or posterior matrix.
    ts_test : array-like | None
        Timestamps aligned with predictions. Used for the regime-tag
        emission summary; otherwise informational.
    fold_results : list | None
        Per-fold dicts emitted by the walk-forward harness.
    output_dir : str | Path | None
        When provided, ``diagnostics.json`` is written under this directory.
    """
    states = _eval_to_state_labels(predictions)
    pop = _eval_state_population_stats(states)
    nv = int(states.size) if n_val is None else int(n_val)

    # Full clustering metrics — silhouette / DB require X_test.
    if X_test is not None:
        full = compute_clustering_metrics_full(X_test, predictions)
    else:
        full = {
            "silhouette": None,
            "davies_bouldin": None,
            "n_clusters": pop["n_clusters"],
            "n_samples": pop["n_samples"],
            "cluster_balance": _eval_safe_finite(pop["cluster_balance"]),
        }

    # Posterior summary (when 2-D predictions were provided).
    pred_arr = _eval_np.asarray(predictions)
    confidence_summary: dict | None = None
    if pred_arr.ndim == 2 and pred_arr.shape[0] > 0:
        conf = _eval_to_confidence(predictions)
        confidence_summary = {
            "mean_max_posterior": _eval_safe_finite(conf.mean()),
            "min_max_posterior": _eval_safe_finite(conf.min()),
            "max_max_posterior": _eval_safe_finite(conf.max()),
        }

    metrics_block = {
        "silhouette": {
            "value": full["silhouette"],
            "renderer": "gauge",
            "group": "clustering quality",
            "mission": "How well-separated are the clusters?",
        },
        "davies_bouldin": {
            "value": full["davies_bouldin"],
            "renderer": "number",
            "group": "clustering quality",
            "mission": "Avg within-vs-between scatter ratio (lower better)",
        },
        "n_clusters": {
            "value": int(full["n_clusters"]),
            "renderer": "number",
            "group": "clustering structure",
            "mission": "Distinct states observed",
        },
        "n_samples": {
            "value": int(full["n_samples"]),
            "renderer": "number",
            "group": "clustering structure",
            "mission": "OOS samples assigned",
        },
        "cluster_balance": {
            "value": full["cluster_balance"],
            "renderer": "percent",
            "group": "clustering structure",
            "mission": "min/max state population ratio",
        },
    }

    # Try to surface model attributes that are useful for downstream UI.
    model_summary: dict = {"type_name": type(model).__name__ if model is not None else None}
    for attr in ("n_components", "n_clusters", "covariance_type"):
        if model is not None and hasattr(model, attr):
            try:
                model_summary[attr] = getattr(model, attr)
            except Exception:
                pass
    if model is not None and hasattr(model, "transmat_"):
        try:
            model_summary["transition_matrix"] = _eval_np.asarray(
                model.transmat_,
                dtype=_eval_np.float64,
            ).tolist()
        except Exception:
            pass

    diagnostics = {
        "model_id": model_id,
        "symbol": symbol,
        "timeframe": timeframe,
        "template_id": template_id,
        "template_version": template_version,
        "catalog_id": catalog_id,
        "task_kind": "clustering",
        "n_train": int(n_train),
        "n_val": nv,
        "n_features": int(n_features),
        "metrics": metrics_block,
        "state_counts": pop["state_counts"],
        "model_summary": model_summary,
        "fold_results": fold_results or [],
    }
    if confidence_summary is not None:
        diagnostics["posterior_summary"] = confidence_summary
    if extra:
        diagnostics.update(extra)

    if output_dir is not None:
        out_dir = _EvalPath(output_dir)
        out_dir.mkdir(parents=True, exist_ok=True)
        # dumps_safe, not json.dumps — a bare NaN makes the whole file
        # unparseable by JSON.parse and 500s the diagnostics endpoint.
        from src.ml.shared.protocol import dumps_safe as _eval_dumps_safe

        (out_dir / "diagnostics.json").write_text(
            _eval_dumps_safe(diagnostics, indent=2),
            encoding="utf-8",
        )
    return diagnostics


# ─── OOS predictions writer ──────────────────────────────────────────────────


def write_oos_predictions(ts, y_test, predictions, output_path, *, symbol: str = "MNQ") -> None:
    """Write oos_predictions.parquet via polars with the standard schema.

    Schema: {timestamp, symbol, prediction, confidence}. For clustering:
      - prediction = state ID (cast to int64 for cross-task schema parity
        with classification's class labels)
      - confidence = max posterior probability when 2-D predictions were
        provided; 1.0 otherwise.
    """
    import polars as _eval_pl

    ts_arr = _eval_np.asarray(ts)
    if ts_arr.dtype.kind == "M":
        ts_int = ts_arr.astype("datetime64[s]").astype(_eval_np.int64)
    else:
        ts_int = ts_arr.astype(_eval_np.int64)

    states = _eval_to_state_labels(predictions)
    confidence = _eval_to_confidence(predictions)

    out = _EvalPath(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    _eval_pl.DataFrame(
        {
            "timestamp": ts_int.astype(_eval_np.int64),
            "symbol": [symbol] * int(ts_int.size),
            "prediction": states.astype(_eval_np.int64),
            "confidence": confidence.astype(_eval_np.float32),
        }
    ).write_parquet(str(out), compression="zstd", compression_level=3)


# ─── Regime-tag emission for chart overlays ──────────────────────────────────


# Default colour palette (consistent with the live_dashboard regime-band style).
_EVAL_REGIME_PALETTE: tuple[str, ...] = (
    "#4C78A8",  # blue
    "#F58518",  # orange
    "#54A24B",  # green
    "#E45756",  # red
    "#72B7B2",  # teal
    "#EECA3B",  # yellow
    "#B279A2",  # purple
    "#FF9DA6",  # pink
    "#9D755D",  # brown
    "#BAB0AC",  # gray
)


def _eval_regime_label(state_id: int) -> str:
    return f"Regime {int(state_id)}"


def emit_regime_tags(
    ts_test,
    predictions,
    *,
    palette: tuple[str, ...] = _EVAL_REGIME_PALETTE,
    transition_matrix=None,
) -> None:
    """Emit a chart-overlay event so the dashboard can render regime bands.

    Wraps `protocol.emit_overlay`. Sends a single overlay event carrying the
    full per-sample assignment vector — the dashboard collapses consecutive
    same-state runs into coloured bands client-side, which is cheaper than
    emitting one event per segment when n is large.

    Parameters
    ----------
    ts_test : array-like
        Per-sample timestamps (datetime, epoch seconds, or epoch ms).
        emit_overlay coerces these to epoch seconds via _to_epoch_sec.
    predictions : array-like
        Per-sample state assignments or 2-D posterior matrix.
    palette : tuple[str, ...]
        CSS colour list; cycled when the model has more states than colours.
    transition_matrix : array-like | None
        Optional KxK transition matrix; passed through to emit_overlay so
        the dashboard's regime-graph view can render the Markov topology.
    """
    states = _eval_to_state_labels(predictions)
    if states.size == 0:
        return

    n_regimes = int(states.max()) + 1 if states.size else 0
    # Always provide a colour + label per regime ID 0..n_regimes-1.
    colors = [palette[i % len(palette)] for i in range(n_regimes)]
    labels = [_eval_regime_label(i) for i in range(n_regimes)]

    if transition_matrix is not None:
        try:
            tm = _eval_np.asarray(transition_matrix, dtype=_eval_np.float64)
        except Exception:
            tm = None
    else:
        tm = None

    _eval_emit_overlay(
        timestamps=list(_eval_np.asarray(ts_test).tolist()),
        assignments=states.tolist(),
        regime_colors=colors,
        regime_labels=labels,
        transition_matrix=tm,
        n_regimes=n_regimes,
    )


# --------------------------------------------------------------------------- #
# Main pipeline — load, label, filter, walk-forward (or single fold), report.
# --------------------------------------------------------------------------- #


def _filter_valid(X, y, valid, timestamps):
    keep = np.flatnonzero(valid)
    X = X[keep]
    y = y[keep]
    timestamps = timestamps[keep]
    finite = np.isfinite(X).all(axis=1)
    return X[finite], y[finite], timestamps[finite]


def run_training(args: argparse.Namespace) -> dict:
    emit_log(
        f"[hmm] Loading {args.symbol}@{args.timeframe} "
        f"(categories={args.feature_categories or 'all'})"
    )
    matrix, names, timestamps, raw = load_features(args)
    n_total = matrix.shape[0]
    emit_log(f"[hmm] Loaded {n_total:,} bars x {matrix.shape[1]} features")

    emit_log(f"[hmm] Generating none labels")
    labels, valid = generate_labels(raw, args)

    X, y, ts_kept = _filter_valid(matrix, labels, valid, timestamps)
    emit_log(f"[hmm] After dropping non-finite rows: {X.shape[0]:,} samples")

    from src.ml.shared.protocol import emit_fold_complete

    n_kept = X.shape[0]
    split = max(1, int(n_kept * 0.8))
    train_idx = np.arange(0, split, dtype=np.int64)
    test_idx = np.arange(split, n_kept, dtype=np.int64)
    emit_log(f"[single-fold] train={train_idx.size:,} test={test_idx.size:,} (80/20 time split)")

    X_train, y_train = X[train_idx], y[train_idx]
    X_test, y_test = X[test_idx], y[test_idx]
    model, preds = train_one_fold(X_train, y_train, X_test, y_test, args, fold_idx=0)
    fold_metrics = compute_fold_metrics(y_test, preds, fold_idx=0)
    for name, value in fold_metrics.items():
        if value is None:
            continue
        try:
            fv = float(value)
        except (TypeError, ValueError):
            continue
        if fv != fv:  # NaN
            continue
        emit_metric(name=f"fold_0_{name}", value=fv, iteration=0)
    emit_fold_complete(fold_idx=0, metrics=fold_metrics)

    fold_results = [
        {
            "fold": 0,
            "n_train": int(train_idx.size),
            "n_test": int(test_idx.size),
            "metrics": fold_metrics,
        }
    ]

    # ─── W4.a HMM clustering rollup + diagnostics ────────────────────────
    # Concatenate per-fold OOS arrays accumulated by train_one_fold.
    if _FOLD_STATE["states"]:
        all_states = np.concatenate(_FOLD_STATE["states"]).astype(np.int64)
        all_X = np.concatenate(_FOLD_STATE["X_test"]).astype(np.float64)
        all_posteriors = np.concatenate(_FOLD_STATE["posteriors"]).astype(np.float64)
    else:
        all_states = np.asarray([], dtype=np.int64)
        all_X = np.zeros((0, X.shape[1]), dtype=np.float64)
        all_posteriors = np.zeros((0, _FOLD_STATE["n_states"] or 1), dtype=np.float64)

    n_states_configured = int(_FOLD_STATE["n_states"])
    n_states_used = int(np.unique(all_states).size) if all_states.size else 0

    # Publish the dashboard metric-rendering schema BEFORE rollup metric
    # events flow.  _emit_metric_declarations comes from _eval_clustering.
    _emit_metric_declarations()

    # Pull per-fold log-likelihood + convergence from the fitted models.
    last_model = _FOLD_STATE["models"][-1] if _FOLD_STATE["models"] else None
    converged = bool(last_model.monitor_.converged) if last_model is not None else False
    last_ll = (
        float(last_model.monitor_.history[-1])
        if last_model is not None and last_model.monitor_.history
        else None
    )

    per_fold_convergence: list[dict] = []
    for k, m in enumerate(_FOLD_STATE["models"]):
        per_fold_convergence.append(
            {
                "fold": k,
                "converged": bool(m.monitor_.converged),
                "n_iter": int(len(m.monitor_.history)) if m.monitor_.history else 0,
                "log_likelihood": float(m.monitor_.history[-1]) if m.monitor_.history else None,
            }
        )

    # Compute clustering quality on the concatenated OOS span. The shared
    # helper handles the n_clusters >= 2 guard + sample-cap silhouette.
    full_metrics = (
        compute_clustering_metrics_full(all_X, all_posteriors)
        if all_X.size
        else {
            "silhouette": None,
            "davies_bouldin": None,
            "n_clusters": n_states_used,
            "n_samples": int(all_states.size),
            "cluster_balance": None,
        }
    )

    # Emit run-level rollup metrics so the live dashboard shows clustering
    # quality once the WF loop closes. iteration=0 because these are
    # post-fold rollups, not per-fold streamed values.
    if full_metrics.get("silhouette") is not None:
        emit_metric(name="silhouette", value=full_metrics["silhouette"], iteration=0)
    if full_metrics.get("davies_bouldin") is not None:
        emit_metric(name="davies_bouldin", value=full_metrics["davies_bouldin"], iteration=0)
    if last_ll is not None:
        emit_metric(name="log_likelihood", value=last_ll, iteration=0)
    emit_metric(name="n_states_used", value=float(n_states_used), iteration=0)

    # Regime-tag overlay (chart paints colored regime bands on the OOS span).
    # Align overlay timestamps to the OOS portion of ts_kept by walking
    # fold_results in order; falls back to ts_kept[-N:] when the per-fold
    # geometry isn't available.
    overlay_cap = 50_000
    if all_states.size and ts_kept.size:
        try:
            test_ts_chunks: list[np.ndarray] = []
            cursor = 0
            for fr in fold_results:
                n_test = int(fr.get("n_test", 0))
                if n_test <= 0:
                    continue
                test_ts_chunks.append(ts_kept[cursor : cursor + n_test])
                cursor += n_test
            if test_ts_chunks:
                overlay_ts = np.concatenate(test_ts_chunks)
            else:
                overlay_ts = ts_kept[-all_states.size :]
        except Exception:
            overlay_ts = ts_kept[-all_states.size :]

        if overlay_ts.size and overlay_ts.size == all_states.size:
            if overlay_ts.size > overlay_cap:
                step = max(1, overlay_ts.size // overlay_cap)
                overlay_ts = overlay_ts[::step]
                overlay_states_capped = all_states[::step]
            else:
                overlay_states_capped = all_states
            try:
                tm_for_overlay = last_model.transmat_ if last_model is not None else None
                emit_regime_tags(
                    ts_test=overlay_ts,
                    predictions=overlay_states_capped,
                    transition_matrix=tm_for_overlay,
                )
            except Exception:
                # Overlay is best-effort — never block diagnostics on it.
                pass

    # HMM-specific diagnostics keys — these are W4.a's cross-domain contract.
    # build_diagnostics already surfaces type_name + n_components + transmat_
    # under model_summary; we also lift the HMM-specific keys to the TOP
    # LEVEL so frontend's W7 LineageCard can read them directly without
    # walking into model_summary.
    hmm_extra: dict = {
        "transition_matrix": (last_model.transmat_.tolist() if last_model is not None else None),
        "start_probabilities": (last_model.startprob_.tolist() if last_model is not None else None),
        "n_states": n_states_configured,
        "n_states_used": n_states_used,
        "converged": converged,
        "log_likelihood": last_ll,
        "emission": "gaussian",
        "covariance_type": "diag",
        "per_fold_convergence": per_fold_convergence,
        "n_total_bars": int(n_total),
        "n_kept_samples": int(X.shape[0]),
        "feature_names": list(names),
    }

    out_dir = _PROJECT_ROOT / "data" / "models" / args.model_id

    diagnostics = build_diagnostics(
        model=last_model,
        X_test=all_X if all_X.size else None,
        y_test=all_states,
        predictions=all_posteriors if all_posteriors.size else all_states,
        ts_test=ts_kept[-int(all_states.size) :] if all_states.size else None,
        fold_results=fold_results,
        output_dir=out_dir,
        model_id=args.model_id,
        symbol=args.symbol,
        timeframe=args.timeframe,
        n_train=int(X.shape[0]) - int(all_states.size),
        n_val=int(all_states.size),
        n_features=int(X.shape[1]),
        template_id="hmm",
        template_version="0.1.0",
        catalog_id="gaussian-hmm",
        extra=hmm_extra,
    )

    # Write OOS predictions parquet for downstream backtest/eval consumers.
    # Schema {timestamp, symbol, prediction, confidence} per W1.c contract;
    # for HMM: prediction = state ID, confidence = max posterior.
    if all_states.size and ts_kept.size:
        oos_path = out_dir / "oos_predictions.parquet"
        try:
            oos_ts = (
                ts_kept[-int(all_states.size) :]
                if int(all_states.size) <= ts_kept.size
                else np.arange(int(all_states.size), dtype=np.int64)
            )
            write_oos_predictions(
                ts=oos_ts,
                y_test=all_states,
                predictions=all_posteriors if all_posteriors.size else all_states,
                output_path=oos_path,
                symbol=args.symbol,
            )
        except Exception:
            # OOS parquet is best-effort — diagnostics is the canonical artifact.
            pass

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
