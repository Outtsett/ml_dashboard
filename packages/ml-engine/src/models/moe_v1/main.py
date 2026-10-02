"""
moe_v1 — auto-generated from template composite_moe@0.1.0.

Catalog source : composite_moe
Generated at   : 2026-05-10T09:01:48+00:00
Symbol/TF      : MNQ/1m
Label strategy : triple_barrier

Standard CLI surface (orchestrator-compatible):

    python packages/ml-engine/src/moe_v1/main.py \\
        --symbol MNQ --timeframe 1m \\
        --model-id <run_id> --json [--max-bars N] \\
        [--date-start ... --date-end ...] \\
        [--feature-categories cat1,cat2,...] \\
        [--<hp> <value> ...]

Emits the standard JSON-line event stream consumed by the dashboard SSE
parser registry (`apps/api/training/runners/parsers/`):
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

import torch
import torch.nn as nn
import torch.nn.functional as F

# Gate imports - pick one of TopKGating / SoftmaxGating / HashGating per ctx.
from core.blocks.gating import TopKGating as _GateClass
from models.lightgbm_for_moe_v1_slot1.main import (
    predict as _predict_slot_1,
)
from models.lightgbm_for_moe_v1_slot1.main import (
    train_one_fold as _train_slot_1,
)
from models.random_forest_for_moe_v1_slot0.main import (
    predict as _predict_slot_0,
)

# Per-slot expert imports - one block per slot, generated in slot order.
# Depth-first post-order generation guarantees these modules already exist
# on disk by the time this composite is written.
from models.random_forest_for_moe_v1_slot0.main import (
    train_one_fold as _train_slot_0,
)
from core.shared.data import load_ohlcv_arrays
from core.shared.feature_cache import cached_features
from core.shared.features import compute_features, feature_context
from core.shared.protocol import (
    emit_done,
    emit_error,
    emit_log,
    emit_metric,
)

_N_EXPERTS: int = 2
_GATING_TYPE: str = "top_k"
_GATING_K: int = 1
_GATING_TEMP: float = 1.0
_HASH_DIM: int = 64
_DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")

# Module-level fold state - composite owns aggregation; experts also keep
# their own _FOLD_STATE inside their generated main.py modules.
_FOLD_STATE: dict = {"y": [], "preds": [], "expert_preds": [], "gates": []}


class _MoEHead(nn.Module):
    """Wraps the chosen gate so it can be trained jointly across folds.

    Stateful only for top_k / soft gates (which have a learnable Linear
    projection). Hash gating has no parameters and skips the optimizer step.
    """

    def __init__(self, d_in: int):
        super().__init__()
        self.d_in = d_in
        self.gate = _GateClass(
            d_model=d_in,
            n_experts=_N_EXPERTS,
            k=min(_GATING_K, _N_EXPERTS),
            temperature=_GATING_TEMP,
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # input:  (B, d_in)
        # output: (B, n_experts) - soft routing weights, sum=1 along axis=-1
        out = self.gate(x)
        if isinstance(out, tuple):
            # TopKGating returns (gates, top_k_idx, top_k_weights); we want gates.
            return out[0]
        return out


# --------------------------------------------------------------------------- #
# Numba JIT warmup — pay the cold-compile cost ONCE at import time so the
# first walk-forward fold doesn't eat the JIT latency. Per ml sub-plan §7
# risk #2.
# --------------------------------------------------------------------------- #

try:
    from core.shared.labels import _warmup_numba  # type: ignore[attr-defined]

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
    ap = argparse.ArgumentParser(description="moe_v1 — generated trainer")
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
        default="price_action,volatility",
        help="Comma-separated list of feature categories.",
    )
    # Hyperparameters (one ap.add_argument per key in the catalog spec)
    return ap.parse_args()


# --------------------------------------------------------------------------- #
# args → canonical config dict — pattern from xgb_classifier/main.py:232-256
# --------------------------------------------------------------------------- #


_HP_KEYS: tuple[str, ...] = ()


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
        matrix, names, _ts = compute_features({**ohlcv, **feature_context(raw)}, categories=categories, n_jobs=1)
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
        max_bars=int(args.max_bars or 0),
        bar_timestamps=raw["timestamp"],
    )
    return matrix, names, timestamps, raw


# --------------------------------------------------------------------------- #
# Label generation — uses src.ml.shared.labels.<strategy>_labels per the
# template-context label_strategy. Override the label_generation block in a
# child template to plug in a custom label fn.
# --------------------------------------------------------------------------- #

from core.shared.labels import triple_barrier_labels as _label_fn  # noqa: E402

_LABEL_PARAMS: dict = {"horizon_bars": 5, "threshold_bp": 5.0}


def generate_labels(raw, args):
    """Return (labels, valid_mask) per the configured label_strategy.

    Each shared.labels adapter takes a single ``params`` dict; the positional
    OHLCV args differ per strategy:

      triple_barrier        → (close, high, low, params)
      next_close_direction  → (close, params)
      range_bucket          → (close, params)
      structural            → (high, low, params)
    """
    return _label_fn(raw["close"], raw["high"], raw["low"], _LABEL_PARAMS)


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


def _expert_train_fns():
    """Tuple of (slot_idx, train_fn, predict_fn) per expert, in slot order."""
    return [
        (0, _train_slot_0, _predict_slot_0),
        (1, _train_slot_1, _predict_slot_1),
    ]


def _stack_expert_preds(preds_list: list[np.ndarray]) -> np.ndarray:
    """Stack per-expert predictions to a (B, n_experts) matrix.

    Each expert's `preds` is either:
      - shape (B,)        binary probability or scalar score
      - shape (B, K)      multi-class probabilities (we take col -1 = positive class proxy)
      - shape (B, n_states) clustering posteriors (we take .max(axis=1) confidence)
    The matrix returned is always (B, n_experts) of scalar scores so the
    gate can produce a single weighted sum per sample.
    """
    flat: list[np.ndarray] = []
    for p in preds_list:
        arr = np.asarray(p)
        if arr.ndim == 1:
            flat.append(arr.astype(np.float64))
        elif arr.ndim == 2:
            # Binary classifier predict_proba shape (B,2) => use column 1
            if arr.shape[1] == 2:
                flat.append(arr[:, 1].astype(np.float64))
            else:
                # Multi-class / posteriors - collapse to max-class probability
                flat.append(arr.max(axis=1).astype(np.float64))
        else:
            flat.append(arr.reshape(arr.shape[0], -1).max(axis=1).astype(np.float64))
    return np.stack(flat, axis=-1)  # (B, n_experts)


def _fit_gate(
    X_train: np.ndarray,
    expert_train_preds: np.ndarray,
    y_train: np.ndarray,
    n_epochs: int = 30,
    lr: float = 1e-3,
) -> _MoEHead:
    """Fit the routing head on training data.

    For top_k / soft gates we frame routing as supervised classification: the
    target expert is the one whose per-sample loss is minimal on the training
    fold. For hash gating, no training is needed (deterministic projection).
    """
    head = _MoEHead(d_in=int(X_train.shape[1])).to(_DEVICE)
    # Per-sample BCE loss for each expert against y_train, then argmin -> target.
    y_t = np.asarray(y_train, dtype=np.float64).reshape(-1)
    expert_p = np.clip(expert_train_preds, 1e-7, 1.0 - 1e-7)
    bce = -(y_t[:, None] * np.log(expert_p) + (1.0 - y_t[:, None]) * np.log(1.0 - expert_p))
    target_expert = bce.argmin(axis=-1).astype(np.int64)  # (B,)

    X_t = torch.as_tensor(X_train, dtype=torch.float32).to(_DEVICE)
    tgt_t = torch.as_tensor(target_expert, dtype=torch.long).to(_DEVICE)

    opt = torch.optim.AdamW(head.parameters(), lr=lr, weight_decay=1e-4)
    head.train()
    bs = 1024
    for epoch in range(int(n_epochs)):
        perm = torch.randperm(X_t.size(0), device=_DEVICE)
        loss_sum = 0.0
        for s in range(0, X_t.size(0), bs):
            idx = perm[s : s + bs]
            xb = X_t[idx]
            yb = tgt_t[idx]
            opt.zero_grad(set_to_none=True)
            gates = head(xb)  # (B, n_experts) softmax
            # Cross-entropy from probabilities: -log(gates[i, target[i]])
            loss = F.nll_loss((gates + 1e-12).log(), yb)
            loss.backward()
            opt.step()
            loss_sum += float(loss.item()) * xb.size(0)
        emit_metric(
            name=f"moe_gate_loss_epoch_{epoch}",
            value=loss_sum / max(1, X_t.size(0)),
            iteration=epoch,
        )
    return head


def _gate_weights(head: _MoEHead, X: np.ndarray) -> np.ndarray:
    """Run the trained gate head on X and return (B, n_experts) weights."""
    head.eval()
    X_t = torch.as_tensor(X, dtype=torch.float32).to(_DEVICE)
    with torch.no_grad():
        w = head(X_t)  # (B, n_experts)
    return w.detach().cpu().numpy().astype(np.float64)


def train_one_fold(X_train, y_train, X_test, y_test, args, *, fold_idx=None):
    """MoE fold trainer.

    1. For each expert slot, call its imported train_one_fold() on the same
       (X_train, y_train, X_test, y_test) - experts learn independently.
    2. Collect per-expert val preds via stacked array.
    3. Compute per-expert TRAIN preds (used to fit the gate router).
    4. Fit gate on (X_train, target_expert).
    5. Combine val preds via gate weights -> composite preds (B,).
    """
    fold_tag = "single" if fold_idx is None else str(fold_idx)
    expert_models: list = []
    expert_test_preds: list[np.ndarray] = []
    expert_train_preds: list[np.ndarray] = []
    for slot_idx, train_fn, predict_fn in _expert_train_fns():
        emit_log(f"[moe][fold={fold_tag}] training expert slot={slot_idx}")
        model_e, preds_e_test = train_fn(X_train, y_train, X_test, y_test, args, fold_idx=fold_idx)
        expert_models.append(model_e)
        expert_test_preds.append(np.asarray(preds_e_test))
        # Re-predict on X_train for gate fitting (some experts only return val preds).
        preds_e_train = predict_fn(model_e, X_train)
        expert_train_preds.append(np.asarray(preds_e_train))

    test_matrix = _stack_expert_preds(expert_test_preds)  # (B_test, n_experts)
    train_matrix = _stack_expert_preds(expert_train_preds)  # (B_train, n_experts)

    head = _fit_gate(
        X_train,
        train_matrix,
        y_train,
        n_epochs=int(getattr(args, "gate_epochs", 30)),
        lr=float(getattr(args, "gate_lr", 1e-3)),
    )
    val_gates = _gate_weights(head, X_test)  # (B_test, n_experts)

    # Composite prediction = gate-weighted sum of per-expert (binary) probs.
    composite_preds = (val_gates * test_matrix).sum(axis=-1)

    _FOLD_STATE["y"].append(np.asarray(y_test))
    _FOLD_STATE["preds"].append(composite_preds.astype(np.float64))
    _FOLD_STATE["expert_preds"].append(test_matrix)
    _FOLD_STATE["gates"].append(val_gates)

    composite_model = {"head": head, "experts": expert_models}
    return composite_model, composite_preds


def predict(model, X) -> np.ndarray:
    """Standard predict contract: returns 1D weighted-sum probability per row."""
    head = model["head"]
    experts = model["experts"]
    expert_predict_fns = [
        _predict_slot_0,
        _predict_slot_1,
    ]
    expert_preds = [fn(m, X) for fn, m in zip(expert_predict_fns, experts)]
    test_matrix = _stack_expert_preds(expert_preds)
    gate_weights = _gate_weights(head, X)
    return (gate_weights * test_matrix).sum(axis=-1).astype(np.float64)


# --------------------------------------------------------------------------- #
# Module-level eval helpers — family templates plug in the eval module
# (`_eval_classification.py.j2`, `_eval_regression.py.j2`, or future
# `_eval_clustering.py.j2`) here so its top-level functions land at module
# scope, not spliced into run_training()'s body.
# --------------------------------------------------------------------------- #

# ──────────────────────────────────────────────────────────────────────────────
# Shared classification eval (rendered from _eval_classification.py.j2)
# ──────────────────────────────────────────────────────────────────────────────
import json as _eval_json
import math as _eval_math
from pathlib import Path as _EvalPath

import numpy as _eval_np

try:
    from core.shared.protocol import emit_metric_declarations as _eval_emit_decls
except Exception:  # pragma: no cover — protocol must exist in real runs

    def _eval_emit_decls(_decls):  # type: ignore[no-redef]
        return None


def _eval_locate_cost_model() -> _EvalPath:
    """Walk up from this file looking for packages/config/cost_model.json.

    Generated models live at packages/ml-engine/src/<model_id>/eval_block.py — parents[3] is
    the project root. But this fragment may also be exercised standalone
    (smoke tests, ad-hoc imports), so we walk up defensively.
    """
    here = _EvalPath(__file__).resolve()
    for parent in [here, *here.parents]:
        candidate = parent / "src" / "config" / "cost_model.json"
        if candidate.is_file():
            return candidate
    # Fallback to the conventional path; loader catches FileNotFoundError
    return here.parents[min(3, len(here.parents) - 1)] / "src" / "config" / "cost_model.json"


_EVAL_COST_MODEL_PATH = _eval_locate_cost_model()


# ─── Internal helpers ─────────────────────────────────────────────────────────


def _eval_load_cost_model(symbol: str) -> dict:
    """Read packages/config/cost_model.json and return per-symbol cost dict.

    Matches the interface in packages/ml-engine/src/xgb_classifier/eval.py. Falls back to a
    generic 0.5bp slippage per side for unknown symbols.
    """
    try:
        cost = _eval_json.loads(_EVAL_COST_MODEL_PATH.read_text(encoding="utf-8"))
    except FileNotFoundError:
        cost = {}
    s = (symbol or "").upper()
    if s in cost:
        c = cost[s]
        return {
            "round_trip_points": float(
                c.get("total_round_trip_points", c.get("total_round_trip", 1.0))
            ),
            "point_value": float(c.get("point_value", c.get("tick_value", 1.0))),
            "tick_value": float(c.get("tick_value", 1.0)),
            "fallback_bp": 0.0,
        }
    return {
        "round_trip_points": 0.0,
        "point_value": 1.0,
        "tick_value": 1.0,
        "fallback_bp": 0.5,
    }


def _eval_to_binary_proba(y_pred: _eval_np.ndarray) -> _eval_np.ndarray:
    """Coerce predictions to a 1D vector of P(class==1).

    Accepts:
      - (n,) probabilities in [0, 1]
      - (n, 2) softmax outputs (binary)
      - (n, K) softmax outputs (multiclass) — returns max-class confidence
        for the positive direction (treats argmax==1 as 'up' for K==2 only)
    """
    arr = _eval_np.asarray(y_pred, dtype=_eval_np.float64)
    if arr.ndim == 1:
        return arr
    if arr.ndim == 2 and arr.shape[1] == 2:
        return arr[:, 1]
    if arr.ndim == 2 and arr.shape[1] >= 2:
        # Multiclass — use max class probability as 'confidence'
        return arr.max(axis=1)
    raise ValueError(f"Cannot interpret y_pred with shape {arr.shape}")


def _eval_to_class_labels(y_pred: _eval_np.ndarray) -> _eval_np.ndarray:
    """Convert predictions to integer class labels via argmax / >0.5 threshold."""
    arr = _eval_np.asarray(y_pred)
    if arr.ndim == 1:
        return (arr >= 0.5).astype(_eval_np.int64)
    return arr.argmax(axis=1).astype(_eval_np.int64)


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


# ─── Discrimination ───────────────────────────────────────────────────────────


def _eval_auc(y_true: _eval_np.ndarray, p_up: _eval_np.ndarray) -> float | None:
    """Rank-based ROC AUC via Mann-Whitney equivalence (handles ties)."""
    y = _eval_np.asarray(y_true).astype(_eval_np.int8)
    p = _eval_np.asarray(p_up, dtype=_eval_np.float64)
    if y.shape != p.shape:
        return None
    n_pos = int((y == 1).sum())
    n_neg = int((y == 0).sum())
    if n_pos == 0 or n_neg == 0:
        return None
    # Average ranks for ties
    order = _eval_np.argsort(p, kind="mergesort")
    sorted_p = p[order]
    sorted_y = y[order]
    ranks = _eval_np.empty(p.size, dtype=_eval_np.float64)
    i = 0
    while i < p.size:
        j = i + 1
        while j < p.size and sorted_p[j] == sorted_p[i]:
            j += 1
        avg_rank = (i + 1 + j) / 2.0
        ranks[i:j] = avg_rank
        i = j
    sum_pos = float(ranks[sorted_y == 1].sum())
    return float((sum_pos - n_pos * (n_pos + 1) / 2.0) / (n_pos * n_neg))


def _eval_log_loss(y_true: _eval_np.ndarray, p_up: _eval_np.ndarray, eps: float = 1e-7) -> float:
    p = _eval_np.clip(_eval_np.asarray(p_up, dtype=_eval_np.float64), eps, 1.0 - eps)
    y = _eval_np.asarray(y_true, dtype=_eval_np.float64)
    return float(-(y * _eval_np.log(p) + (1.0 - y) * _eval_np.log(1.0 - p)).mean())


def _eval_brier(y_true: _eval_np.ndarray, p_up: _eval_np.ndarray) -> float:
    return float(_eval_np.mean((_eval_np.asarray(p_up, dtype=_eval_np.float64) - y_true) ** 2))


# ─── Calibration ──────────────────────────────────────────────────────────────


def _eval_reliability(y_true: _eval_np.ndarray, p_up: _eval_np.ndarray, n_bins: int = 10) -> dict:
    """10-bin equal-width reliability diagram + ECE + MCE.

    ECE = sum(|acc(bin) - conf(bin)| * (n_bin / n_total)) over confidence bins.
    """
    p = _eval_np.asarray(p_up, dtype=_eval_np.float64)
    y = _eval_np.asarray(y_true, dtype=_eval_np.int8)
    edges = _eval_np.linspace(0.0, 1.0, n_bins + 1)
    bin_idx = _eval_np.clip(_eval_np.digitize(p, edges[1:-1]), 0, n_bins - 1)

    mids = _eval_np.zeros(n_bins)
    observed = _eval_np.zeros(n_bins)
    predicted = _eval_np.zeros(n_bins)
    counts = _eval_np.zeros(n_bins, dtype=_eval_np.int64)

    for b in range(n_bins):
        mask = bin_idx == b
        n = int(mask.sum())
        counts[b] = n
        mids[b] = (edges[b] + edges[b + 1]) / 2
        if n > 0:
            observed[b] = float(y[mask].mean())
            predicted[b] = float(p[mask].mean())
        else:
            observed[b] = float("nan")
            predicted[b] = float("nan")

    valid = counts > 0
    if valid.any():
        weights = counts[valid] / counts[valid].sum()
        diffs = _eval_np.abs(observed[valid] - predicted[valid])
        ece = float((weights * diffs).sum())
        mce = float(diffs.max())
    else:
        ece, mce = float("nan"), float("nan")

    return {
        "bin_midpoints": mids.tolist(),
        "observed_frequency": [None if (v != v) else float(v) for v in observed.tolist()],
        "predicted_frequency": [None if (v != v) else float(v) for v in predicted.tolist()],
        "counts": counts.tolist(),
        "ece": ece,
        "mce": mce,
    }


# ─── Standard sklearn-style metrics (precision/recall/F1) ────────────────────


def _eval_confusion_matrix(
    y_true: _eval_np.ndarray, y_pred_labels: _eval_np.ndarray, n_classes: int | None = None
) -> _eval_np.ndarray:
    yt = _eval_np.asarray(y_true, dtype=_eval_np.int64)
    yp = _eval_np.asarray(y_pred_labels, dtype=_eval_np.int64)
    if n_classes is None:
        n_classes = int(max(yt.max(initial=-1), yp.max(initial=-1)) + 1)
        n_classes = max(n_classes, 2)
    cm = _eval_np.zeros((n_classes, n_classes), dtype=_eval_np.int64)
    for t, p in zip(yt, yp):
        if 0 <= t < n_classes and 0 <= p < n_classes:
            cm[t, p] += 1
    return cm


def _eval_macro_prf(cm: _eval_np.ndarray) -> tuple[float, float, float]:
    """Macro-averaged precision / recall / F1 over rows of the confusion matrix."""
    n_classes = cm.shape[0]
    precisions = _eval_np.zeros(n_classes)
    recalls = _eval_np.zeros(n_classes)
    f1s = _eval_np.zeros(n_classes)
    for k in range(n_classes):
        tp = float(cm[k, k])
        fp = float(cm[:, k].sum() - tp)
        fn = float(cm[k, :].sum() - tp)
        precisions[k] = tp / (tp + fp) if (tp + fp) > 0 else 0.0
        recalls[k] = tp / (tp + fn) if (tp + fn) > 0 else 0.0
        f1s[k] = (
            2 * precisions[k] * recalls[k] / (precisions[k] + recalls[k])
            if (precisions[k] + recalls[k]) > 0
            else 0.0
        )
    return float(precisions.mean()), float(recalls.mean()), float(f1s.mean())


def _eval_hit_rate_at(
    y_true: _eval_np.ndarray, p_up: _eval_np.ndarray, threshold: float
) -> tuple[float | None, int]:
    """Direction accuracy among bars where conviction >= threshold (or <= 1-threshold)."""
    if threshold <= 0.5:
        preds = (p_up >= 0.5).astype(_eval_np.int8)
        n = preds.size
        if n == 0:
            return None, 0
        return float((preds == y_true).mean()), int(n)
    up_mask = p_up >= threshold
    dn_mask = p_up <= (1.0 - threshold)
    pick = up_mask | dn_mask
    n = int(pick.sum())
    if n == 0:
        return None, 0
    preds = up_mask.astype(_eval_np.int8)
    correct = int(((preds == y_true) & pick).sum())
    return correct / n, n


# ─── Cost-aware PnL simulation ────────────────────────────────────────────────


def simulate_pnl(
    preds,
    prices,
    ts=None,
    threshold: float = 0.55,
    *,
    horizon_bars: int = 1,
    symbol: str = "MNQ",
) -> dict:
    """Cost-adjusted PnL simulation (signature: preds, prices, ts, threshold).

    Lifts xgb_classifier/eval.py::simulate_pnl semantics. preds may be binary
    proba in [0, 1] or (n, K) softmax (uses _eval_to_binary_proba). One trade
    per signal, exit at close[i+horizon_bars]. Reads packages/config/cost_model.json
    for tick_value / cost_per_round_trip via _eval_load_cost_model.

    Returns
    -------
    dict with keys: total_pnl, n_trades, wins, losses, profit_factor, win_rate,
    mean_trade_pnl, sharpe, max_drawdown, plus extras for diagnostics
    consumption (cum_pnl_dollars, max_drawdown_pct, sharpe_after_costs,
    avg_win_dollars, avg_loss_dollars, n_long, n_short, trade_pnl_dollars).
    """
    p_up = _eval_to_binary_proba(preds)
    close = _eval_np.asarray(prices, dtype=_eval_np.float64)
    if close.shape != p_up.shape:
        raise ValueError(f"prices shape {close.shape} != preds shape {p_up.shape}")
    n = close.shape[0]
    cm = _eval_load_cost_model(symbol)
    rtp = cm["round_trip_points"]
    pv = cm["point_value"]
    fallback_bp = cm.get("fallback_bp", 0.0)

    trades_pnl: list[float] = []
    trade_dirs: list[int] = []
    last_exit = -1
    horizon = max(1, int(horizon_bars))
    for i in range(n - horizon):
        if i < last_exit:
            continue
        p = p_up[i]
        if p >= threshold:
            direction = +1
        elif p <= 1.0 - threshold:
            direction = -1
        else:
            continue
        c_in = close[i]
        c_out = close[i + horizon]
        move_points = (c_out - c_in) * direction
        if rtp > 0:
            cost_dollars = rtp * pv
        else:
            cost_dollars = (fallback_bp / 10000.0) * c_in * pv
        gross_dollars = move_points * pv
        net = gross_dollars - cost_dollars
        trades_pnl.append(net)
        trade_dirs.append(direction)
        last_exit = i + horizon

    pnl_arr = _eval_np.asarray(trades_pnl, dtype=_eval_np.float64)
    dirs = _eval_np.asarray(trade_dirs, dtype=_eval_np.int8)
    n_trades = pnl_arr.size

    if n_trades == 0:
        return {
            "total_pnl": 0.0,
            "n_trades": 0,
            "wins": 0,
            "losses": 0,
            "profit_factor": None,
            "win_rate": None,
            "mean_trade_pnl": 0.0,
            "sharpe": 0.0,
            "max_drawdown": 0.0,
            # Backward-compat keys
            "cum_pnl_dollars": 0.0,
            "max_drawdown_dollars": 0.0,
            "max_drawdown_pct": 0.0,
            "sharpe_after_costs": 0.0,
            "avg_win_dollars": 0.0,
            "avg_loss_dollars": 0.0,
            "hit_rate": None,
            "n_long": 0,
            "n_short": 0,
            "trade_pnl_dollars": [],
        }

    cum = _eval_np.cumsum(pnl_arr)
    running_peak = _eval_np.maximum.accumulate(cum)
    drawdown = cum - running_peak
    max_dd_dollars = float(drawdown.min())
    peak_at_dd = float(running_peak[drawdown.argmin()])
    max_dd_pct = float(max_dd_dollars / peak_at_dd) if peak_at_dd > 0 else 0.0
    wins_arr = pnl_arr[pnl_arr > 0]
    losses_arr = pnl_arr[pnl_arr < 0]
    sum_losses = float(losses_arr.sum())
    profit_factor = float(wins_arr.sum() / abs(sum_losses)) if sum_losses != 0 else float("inf")
    win_rate = float((pnl_arr > 0).mean())
    mean_pnl = float(pnl_arr.mean())
    if pnl_arr.std() > 0:
        sharpe_units = float(pnl_arr.mean() / pnl_arr.std() * _eval_math.sqrt(n_trades))
    else:
        sharpe_units = 0.0

    return {
        "total_pnl": float(cum[-1]),
        "n_trades": int(n_trades),
        "wins": int(wins_arr.size),
        "losses": int(losses_arr.size),
        "profit_factor": profit_factor,
        "win_rate": win_rate,
        "mean_trade_pnl": mean_pnl,
        "sharpe": sharpe_units,
        "max_drawdown": max_dd_dollars,
        # Backward-compat keys (mirror xgb_classifier/eval.py::simulate_pnl)
        "cum_pnl_dollars": float(cum[-1]),
        "max_drawdown_dollars": max_dd_dollars,
        "max_drawdown_pct": max_dd_pct,
        "sharpe_after_costs": sharpe_units,
        "avg_win_dollars": float(wins_arr.mean()) if wins_arr.size else 0.0,
        "avg_loss_dollars": float(losses_arr.mean()) if losses_arr.size else 0.0,
        "hit_rate": win_rate,
        "n_long": int((dirs == 1).sum()),
        "n_short": int((dirs == -1).sum()),
        "trade_pnl_dollars": pnl_arr.tolist(),
    }


# ─── Per-fold metric assembly ─────────────────────────────────────────────────


def compute_fold_metrics(y_true, y_pred, fold_idx: int) -> dict:
    """Per-fold classification metrics (flat dict).

    Called by ml-trainer's _walk_forward.py.j2 once per fold; each key is then
    emitted via emit_metric(name=f'fold_{i}_{key}', value, iteration=i).

    Parameters
    ----------
    y_true : array-like, shape (n,) — integer class labels (binary 0/1 or K-way)
    y_pred : array-like, shape (n,) probabilities in [0,1] or (n, K) softmax
    fold_idx : int — purely informational, not used in computation

    Returns
    -------
    dict with keys: auc, log_loss, brier, accuracy, hit_rate, precision, recall,
    f1, ece, pnl_after_costs, sharpe_after_costs, profit_factor, win_rate,
    n_trades. Values are floats or None when the metric is undefined for the
    inputs (e.g. AUC when one class is missing). All finite floats are JSON-safe.
    """
    yt = _eval_np.asarray(y_true).astype(_eval_np.int64)
    p_up = _eval_to_binary_proba(y_pred)
    y_labels = _eval_to_class_labels(y_pred)
    n_classes = int(max(yt.max(initial=1) + 1, y_labels.max(initial=1) + 1, 2))

    auc = _eval_safe_finite(_eval_auc(yt, p_up))
    ll = _eval_safe_finite(_eval_log_loss(yt, p_up))
    brier = _eval_safe_finite(_eval_brier(yt, p_up))
    acc = float((y_labels == yt).mean()) if yt.size > 0 else None
    rel = _eval_reliability(yt, p_up, n_bins=10)
    ece = _eval_safe_finite(rel["ece"])
    cm = _eval_confusion_matrix(yt, y_labels, n_classes=n_classes)
    precision, recall, f1 = _eval_macro_prf(cm)
    hr_55, _n_55 = _eval_hit_rate_at(yt, p_up, 0.55)

    # Synthesize a price proxy if the caller hasn't bound real prices yet — for
    # per-fold metrics we expose a hit-rate-driven win_rate estimate; the real
    # PnL gets computed in build_diagnostics() once per-fold prices are available
    pnl_proxy = {
        "total_pnl": None,
        "n_trades": int(_n_55) if _n_55 is not None else 0,
        "profit_factor": None,
        "win_rate": _eval_safe_finite(hr_55),
        "sharpe": None,
    }

    return {
        "auc": auc,
        "log_loss": ll,
        "brier": brier,
        "accuracy": _eval_safe_finite(acc),
        "hit_rate": _eval_safe_finite(hr_55),
        "precision": _eval_safe_finite(precision),
        "recall": _eval_safe_finite(recall),
        "f1": _eval_safe_finite(f1),
        "ece": ece,
        "pnl_after_costs": pnl_proxy["total_pnl"],
        "sharpe_after_costs": pnl_proxy["sharpe"],
        "profit_factor": pnl_proxy["profit_factor"],
        "win_rate": pnl_proxy["win_rate"],
        "n_trades": pnl_proxy["n_trades"],
    }


# ─── Metric declarations (dashboard schema) ──────────────────────────────────


def _emit_metric_declarations() -> None:
    """Publish the metric-rendering schema. Lifted from xgb_classifier/main.py."""
    _eval_emit_decls(
        {
            "auc": {
                "renderer": "gauge",
                "group": "discrimination",
                "mission": "Does the model rank positives above negatives?",
                "context": {"min": 0.5, "good": 0.55, "great": 0.60, "max": 1.0},
            },
            "log_loss": {
                "renderer": "number",
                "group": "discrimination",
                "mission": "Lower is better. ln(2)=0.693 is no-info baseline.",
                "context": {"min": 0.0, "baseline": 0.693, "decimals": 4},
            },
            "brier": {
                "renderer": "number",
                "group": "calibration",
                "mission": "Squared error of probabilities. 0.25 is uninformative.",
                "context": {"min": 0.0, "baseline": 0.25, "decimals": 4},
            },
            "ece": {
                "renderer": "number",
                "group": "calibration",
                "mission": "Expected calibration error (lower better).",
                "context": {"min": 0.0, "good": 0.05, "decimals": 4},
            },
            "accuracy": {
                "renderer": "percent",
                "group": "operating_points",
                "mission": "Top-1 classification accuracy.",
                "context": {"baseline": 0.5, "good": 0.55, "great": 0.60},
            },
            "hit_rate": {
                "renderer": "percent",
                "group": "operating_points",
                "mission": "Direction accuracy on conviction trades (p>=0.55 or p<=0.45).",
                "context": {"baseline": 0.5, "good": 0.55, "great": 0.60},
            },
            "precision": {
                "renderer": "percent",
                "group": "operating_points",
                "mission": "Macro-averaged precision across all classes.",
                "context": {"baseline": 0.5, "good": 0.6, "great": 0.7},
            },
            "recall": {
                "renderer": "percent",
                "group": "operating_points",
                "mission": "Macro-averaged recall across all classes.",
                "context": {"baseline": 0.5, "good": 0.6, "great": 0.7},
            },
            "f1": {
                "renderer": "percent",
                "group": "operating_points",
                "mission": "Macro-averaged F1 score across all classes.",
                "context": {"baseline": 0.5, "good": 0.6, "great": 0.7},
            },
            "profit_factor": {
                "renderer": "gauge",
                "group": "pnl",
                "mission": "Sum of wins / |sum of losses| after costs. 1.0 = breakeven.",
                "context": {"min": 0.0, "breakeven": 1.0, "good": 1.5, "great": 2.0},
            },
            "win_rate": {
                "renderer": "percent",
                "group": "pnl",
                "mission": "Fraction of trades closed for a profit after costs.",
                "context": {"baseline": 0.5, "good": 0.55, "great": 0.6},
            },
            "sharpe_after_costs": {
                "renderer": "number",
                "group": "pnl",
                "mission": "Sharpe ratio of trade-by-trade PnL after costs (unitless).",
                "context": {"baseline": 0.0, "good": 1.0, "great": 2.0, "decimals": 3},
            },
            "pnl_after_costs": {
                "renderer": "number",
                "group": "pnl",
                "mission": "Cumulative dollars of trade-by-trade PnL after costs.",
                "context": {"prefix": "$", "decimals": 0},
            },
            "max_drawdown": {
                "renderer": "number",
                "group": "pnl",
                "mission": "Worst drawdown of cumulative PnL ($).",
                "context": {"prefix": "$", "decimals": 0},
            },
            "n_trades": {
                "renderer": "number",
                "group": "pnl",
                "mission": "How many trades the model took at the conviction threshold.",
                "context": {"min": 0, "good": 50, "decimals": 0},
            },
            "calibration_curve": {
                "renderer": "calibration",
                "group": "calibration",
                "mission": "Predicted vs observed frequency in 10 equal-width bins.",
                "context": {},
            },
        }
    )


# ─── Diagnostics dict assembly ────────────────────────────────────────────────


def build_diagnostics(
    model,
    y_true,
    y_pred,
    ts=None,
    prices=None,
    fold_results: list | None = None,
    *,
    model_id: str = "",
    symbol: str = "MNQ",
    timeframe: str = "1m",
    n_train: int = 0,
    n_val: int | None = None,
    n_features: int = 0,
    extra: dict | None = None,
) -> dict:
    """Build the SelfDescribingDiagnostics dict.

    Mirrors packages/ml-engine/src/xgb_classifier/main.py lines 446-494. Includes per-fold
    metrics, calibration reliability diagram (10 bins), confusion matrix, ECE,
    and (when prices are provided) cost-aware PnL stats.
    """
    yt = _eval_np.asarray(y_true).astype(_eval_np.int64)
    p_up = _eval_to_binary_proba(y_pred)
    y_labels = _eval_to_class_labels(y_pred)
    nv = int(yt.size) if n_val is None else int(n_val)

    auc = _eval_safe_finite(_eval_auc(yt, p_up))
    ll = _eval_safe_finite(_eval_log_loss(yt, p_up))
    brier = _eval_safe_finite(_eval_brier(yt, p_up))
    acc = float((y_labels == yt).mean()) if yt.size > 0 else None
    rel = _eval_reliability(yt, p_up, n_bins=10)
    n_classes = int(max(yt.max(initial=1) + 1, y_labels.max(initial=1) + 1, 2))
    cm = _eval_confusion_matrix(yt, y_labels, n_classes=n_classes)
    precision, recall, f1 = _eval_macro_prf(cm)
    hr_50, n_50 = _eval_hit_rate_at(yt, p_up, 0.50)
    hr_55, n_55 = _eval_hit_rate_at(yt, p_up, 0.55)
    hr_60, n_60 = _eval_hit_rate_at(yt, p_up, 0.60)

    pnl: dict = {}
    if prices is not None:
        try:
            pnl = simulate_pnl(p_up, prices, ts=ts, threshold=0.55, symbol=symbol)
        except Exception:
            pnl = {}

    metrics_block = {
        "auc": {
            "value": auc,
            "renderer": "gauge",
            "group": "discrimination",
            "mission": "Rank positives above negatives",
        },
        "log_loss": {
            "value": ll,
            "renderer": "number",
            "group": "discrimination",
            "mission": "Lower better; baseline ln(2)=0.693",
        },
        "brier": {
            "value": brier,
            "renderer": "number",
            "group": "calibration",
            "mission": "Squared error of probabilities",
        },
        "ece": {
            "value": _eval_safe_finite(rel["ece"]),
            "renderer": "number",
            "group": "calibration",
            "mission": "Expected calibration error",
        },
        "accuracy": {
            "value": _eval_safe_finite(acc),
            "renderer": "percent",
            "group": "operating_points",
            "mission": "Top-1 accuracy",
        },
        "precision": {
            "value": _eval_safe_finite(precision),
            "renderer": "percent",
            "group": "operating_points",
            "mission": "Macro precision",
        },
        "recall": {
            "value": _eval_safe_finite(recall),
            "renderer": "percent",
            "group": "operating_points",
            "mission": "Macro recall",
        },
        "f1": {
            "value": _eval_safe_finite(f1),
            "renderer": "percent",
            "group": "operating_points",
            "mission": "Macro F1",
        },
        "hit_rate_50": {
            "value": _eval_safe_finite(hr_50),
            "renderer": "percent",
            "group": "operating_points",
            "mission": "Direction accuracy on all picks",
            "context": {"n_picks": int(n_50)},
        },
        "hit_rate_55": {
            "value": _eval_safe_finite(hr_55),
            "renderer": "percent",
            "group": "operating_points",
            "mission": "Direction accuracy at p>=0.55",
            "context": {"n_picks": int(n_55)},
        },
        "hit_rate_60": {
            "value": _eval_safe_finite(hr_60),
            "renderer": "percent",
            "group": "operating_points",
            "mission": "Direction accuracy at p>=0.60",
            "context": {"n_picks": int(n_60)},
        },
    }
    if pnl:
        metrics_block.update(
            {
                "profit_factor": {
                    "value": _eval_safe_finite(pnl.get("profit_factor")),
                    "renderer": "gauge",
                    "group": "pnl",
                    "mission": "Wins / |losses| after costs",
                },
                "sharpe_after_costs": {
                    "value": _eval_safe_finite(pnl.get("sharpe_after_costs")),
                    "renderer": "number",
                    "group": "pnl",
                    "mission": "Trade-by-trade Sharpe after costs",
                },
                "pnl_after_costs": {
                    "value": _eval_safe_finite(pnl.get("cum_pnl_dollars")),
                    "renderer": "number",
                    "group": "pnl",
                    "mission": "Total dollars after costs",
                },
                "max_drawdown": {
                    "value": _eval_safe_finite(pnl.get("max_drawdown_dollars")),
                    "renderer": "number",
                    "group": "pnl",
                    "mission": "Worst drawdown ($)",
                },
                "win_rate": {
                    "value": _eval_safe_finite(pnl.get("win_rate")),
                    "renderer": "percent",
                    "group": "pnl",
                    "mission": "Fraction of trades profitable",
                },
                "n_trades": {
                    "value": int(pnl.get("n_trades", 0)),
                    "renderer": "number",
                    "group": "pnl",
                    "mission": "Number of trades taken",
                },
            }
        )

    diagnostics = {
        "model_id": model_id,
        "symbol": symbol,
        "timeframe": timeframe,
        "n_train": int(n_train),
        "n_val": nv,
        "n_features": int(n_features),
        "task_kind": "classification",
        "n_classes": n_classes,
        "metrics": metrics_block,
        "calibration_curve": rel,
        "confusion_matrix": cm.tolist(),
        "fold_results": fold_results or [],
    }
    if pnl:
        diagnostics["pnl_curve"] = {
            "trade_pnl_dollars": pnl.get("trade_pnl_dollars", []),
            "n_long": int(pnl.get("n_long", 0)),
            "n_short": int(pnl.get("n_short", 0)),
        }
    if extra:
        diagnostics.update(extra)
    return diagnostics


# ─── OOS predictions writer ──────────────────────────────────────────────────


def write_oos_predictions(ts, y_true, y_pred, output_path, *, symbol: str = "MNQ") -> None:
    """Write oos_predictions.parquet via polars with the standard schema.

    Schema: {timestamp, symbol, prediction, confidence}. The existing backtest
    engine consumes this contract for any model with no per-model code.
    Predictions are integer class labels; confidence is the maximum class
    probability (or P(class==1) for binary heads).
    """
    import polars as _eval_pl

    ts_arr = _eval_np.asarray(ts)
    if ts_arr.dtype.kind == "M":
        ts_int = ts_arr.astype("datetime64[s]").astype(_eval_np.int64)
    else:
        ts_int = ts_arr.astype(_eval_np.int64)

    p_up = _eval_to_binary_proba(y_pred)
    y_labels = _eval_to_class_labels(y_pred)
    arr = _eval_np.asarray(y_pred)
    if arr.ndim == 2 and arr.shape[1] >= 2:
        confidence = arr.max(axis=1).astype(_eval_np.float32)
    else:
        confidence = _eval_np.where(p_up >= 0.5, p_up, 1.0 - p_up).astype(_eval_np.float32)

    out = _EvalPath(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    _eval_pl.DataFrame(
        {
            "timestamp": ts_int.astype(_eval_np.int64),
            "symbol": [symbol] * int(ts_int.size),
            "prediction": y_labels.astype(_eval_np.int64),
            "confidence": confidence,
        }
    ).write_parquet(str(out), compression="zstd", compression_level=3)


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
        f"[composite_moe] Loading {args.symbol}@{args.timeframe} "
        f"(categories={args.feature_categories or 'all'})"
    )
    matrix, names, timestamps, raw = load_features(args)
    n_total = matrix.shape[0]
    emit_log(f"[composite_moe] Loaded {n_total:,} bars x {matrix.shape[1]} features")

    emit_log(f"[composite_moe] Generating triple_barrier labels")
    labels, valid = generate_labels(raw, args)

    X, y, ts_kept = _filter_valid(matrix, labels, valid, timestamps)
    emit_log(f"[composite_moe] After dropping non-finite rows: {X.shape[0]:,} samples")

    from core.shared.protocol import emit_fold_complete

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

    # --- W5 MoE composite rollup -----------------------------------------
    if _FOLD_STATE["y"]:
        all_y = np.concatenate([np.asarray(y).reshape(-1) for y in _FOLD_STATE["y"]]).astype(
            np.int64
        )
        all_preds = np.concatenate(_FOLD_STATE["preds"]).astype(np.float64)
    else:
        all_y = np.asarray([0, 1], dtype=np.int64)
        all_preds = np.asarray([0.5, 0.5], dtype=np.float64)

    # Average per-expert utilization across folds (diagnostic).
    if _FOLD_STATE["gates"]:
        gates_concat = np.concatenate(_FOLD_STATE["gates"], axis=0)  # (sum_B, n_experts)
        expert_utilization = gates_concat.mean(axis=0).tolist()
    else:
        expert_utilization = [1.0 / max(1, _N_EXPERTS)] * _N_EXPERTS

    _emit_metric_declarations()

    diagnostics = build_diagnostics(
        model=None,
        y_true=all_y,
        y_pred=all_preds,
        ts=None,
        prices=None,
        fold_results=fold_results,
        model_id=args.model_id,
        symbol=args.symbol,
        timeframe=args.timeframe,
        n_train=int(X.shape[0]),
        n_val=int(all_y.size),
        n_features=int(X.shape[1]),
        extra={
            "template_id": "composite_moe",
            "template_version": "0.1.0",
            "catalog_id": "composite_moe",
            "composite_kind": "moe",
            "n_experts": int(_N_EXPERTS),
            "gating_type": _GATING_TYPE,
            "gating_k": int(_GATING_K),
            "gating_temperature": float(_GATING_TEMP),
            "expert_slots": [
                {
                    "slot_idx": 0,
                    "catalog_id": "random-forest",
                    "resolved_model_id": "random_forest_for_moe_v1_slot0",
                },
                {
                    "slot_idx": 1,
                    "catalog_id": "lightgbm",
                    "resolved_model_id": "lightgbm_for_moe_v1_slot1",
                },
            ],
            "expert_utilization": expert_utilization,
            "n_total_bars": int(n_total),
            "n_kept_samples": int(X.shape[0]),
            "feature_names": list(names),
        },
    )

    if all_y.size and all_preds.size:
        out_path = _PROJECT_ROOT / "data" / "models" / args.model_id / "oos_predictions.parquet"
        write_oos_predictions(
            ts=np.arange(all_y.size, dtype=np.int64),
            y_true=all_y,
            y_pred=all_preds,
            output_path=out_path,
            symbol=args.symbol,
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
