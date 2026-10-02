"""
Walk-forward aggregator — combines per-fold diagnostics.json files into a single
aggregated summary. Spawned by the Node orchestrator after the last window
completes, so the dashboard sees a single ``walk-forward-summary`` event with
mean/CI of headline metrics across all folds.

Usage::

    python -m src.ml.xgb_classifier.wf_aggregate \\
        --base-model-id MNQ_5m_xgb_classifier_<ts> \\
        --window-count 4 \\
        [--out path/to/wf_summary.json]

Output JSON shape::

    {
        "base_model_id": "...",
        "n_windows": 4,
        "per_fold": [{"window": 1, "model_id": "...", "metrics": {...}}, ...],
        "aggregated": {
            "auc":                {"mean": ..., "std": ..., "min": ..., "max": ..., "ci95_lo": ..., "ci95_hi": ...},
            "profit_factor":      {...},
            "sharpe_after_costs": {...},
            "cum_pnl_dollars":    {"sum": ..., "mean": ..., ...},
            "n_trades":           {"sum": ..., "mean": ...}
        }
    }
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any

import numpy as np
from core.shared.protocol import emit, emit_log

_PROJECT_ROOT = Path(__file__).resolve().parents[3]
_MODELS_ROOT = _PROJECT_ROOT / "data" / "models"

_AGG_METRICS_DIST = (
    "auc",
    "log_loss",
    "brier_score",
    "ece",
    "hit_rate_50",
    "hit_rate_55",
    "hit_rate_60",
    "profit_factor",
    "sharpe_after_costs",
    "max_drawdown_pct",
)
_AGG_METRICS_SUM = ("cum_pnl_dollars", "n_trades", "max_drawdown_dollars")


def _ci95(values: np.ndarray) -> tuple[float, float]:
    n = values.size
    if n < 2:
        return float("nan"), float("nan")
    mean = float(values.mean())
    se = float(values.std(ddof=1) / math.sqrt(n))
    return mean - 1.96 * se, mean + 1.96 * se


def _summarize_distribution(name: str, vals: list[float]) -> dict:
    arr = np.asarray(
        [v for v in vals if v is not None and not (isinstance(v, float) and math.isnan(v))]
    )
    if arr.size == 0:
        return {
            "name": name,
            "n": 0,
            "mean": float("nan"),
            "std": float("nan"),
            "min": float("nan"),
            "max": float("nan"),
            "ci95_lo": float("nan"),
            "ci95_hi": float("nan"),
        }
    lo, hi = _ci95(arr)
    return {
        "name": name,
        "n": int(arr.size),
        "mean": float(arr.mean()),
        "std": float(arr.std(ddof=1)) if arr.size > 1 else 0.0,
        "min": float(arr.min()),
        "max": float(arr.max()),
        "ci95_lo": lo,
        "ci95_hi": hi,
    }


def _summarize_sum(name: str, vals: list[float]) -> dict:
    arr = np.asarray([v for v in vals if v is not None])
    if arr.size == 0:
        return {"name": name, "n": 0, "sum": 0.0, "mean": 0.0}
    return {"name": name, "n": int(arr.size), "sum": float(arr.sum()), "mean": float(arr.mean())}


def aggregate(base_model_id: str, window_count: int) -> dict:
    per_fold: list[dict[str, Any]] = []
    for w in range(1, window_count + 1):
        window_id = f"{base_model_id}_w{w}"
        diag_path = _MODELS_ROOT / window_id / "diagnostics.json"
        if not diag_path.exists():
            emit_log(f"[wf_agg] Missing diagnostics for window {w}: {diag_path}", level="warning")
            continue
        with diag_path.open(encoding="utf-8") as fh:
            diag = json.load(fh)
        flat = {
            k: v["value"] if isinstance(v, dict) and "value" in v else v
            for k, v in diag.get("metrics", {}).items()
        }
        per_fold.append(
            {
                "window": w,
                "model_id": window_id,
                "metrics": flat,
                "best_iteration": diag.get("best_iteration"),
                "n_train": diag.get("n_train"),
                "n_val": diag.get("n_val"),
            }
        )

    aggregated: dict[str, Any] = {}
    for m in _AGG_METRICS_DIST:
        aggregated[m] = _summarize_distribution(m, [f["metrics"].get(m) for f in per_fold])
    for m in _AGG_METRICS_SUM:
        aggregated[m] = _summarize_sum(m, [f["metrics"].get(m) for f in per_fold])

    return {
        "base_model_id": base_model_id,
        "n_windows": len(per_fold),
        "per_fold": per_fold,
        "aggregated": aggregated,
    }


def main() -> None:
    ap = argparse.ArgumentParser(description="Walk-forward aggregator for xgb_classifier")
    ap.add_argument("--base-model-id", required=True)
    ap.add_argument("--window-count", type=int, required=True)
    ap.add_argument(
        "--out",
        default=None,
        help="Optional output path; defaults to data/models/<base>/wf_summary.json",
    )
    args = ap.parse_args()

    summary = aggregate(args.base_model_id, args.window_count)

    out_path = Path(args.out) if args.out else _MODELS_ROOT / args.base_model_id / "wf_summary.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(summary, indent=2, default=str), encoding="utf-8")

    emit(
        {
            "type": "walk-forward-summary",
            "baseModelId": args.base_model_id,
            "nWindows": summary["n_windows"],
            "aggregated": summary["aggregated"],
            "perFold": summary["per_fold"],
        }
    )
    emit_log(f"[wf_agg] Wrote {out_path}")


if __name__ == "__main__":
    main()
