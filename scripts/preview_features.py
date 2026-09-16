"""
Features preview — compute the feature matrix + correlation diagnostics for a
selected pipeline on a small recent OHLCV window. Used by ML Studio's
`POST /api/training/features/preview` to expose mean/max-abs correlation,
redundant pairs, and per-feature stats before training.

Output: single JSON object on stdout.

CLI:
    python scripts/preview_features.py
        --symbol MNQ --timeframe 1m
        --pipeline-id self-contained
        [--max-bars 50000]
        [--start 2025-01-01] [--end 2025-02-01]
        [--redundancy-threshold 0.95]
        [--top-redundant 50]

Cost model: pure-numpy + numba JIT (first cold-load ~10-15s; warm ~50ms for
50k bars × 35 features). All stats computed in a single pass over the
finite-row subset (rows where every feature has a non-NaN value).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time

# Make the project root importable so `src.ml.shared.*` resolves whether the
# script is launched from the repo root or anywhere else.
_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _REPO_ROOT not in sys.path:
    sys.path.insert(0, _REPO_ROOT)

import numpy as np  # noqa: E402
from src.ml.shared.data import load_ohlcv_arrays  # noqa: E402
from src.ml.shared.features import compute_features  # noqa: E402


def _load_pipeline_categories(pipeline_id: str) -> list[str] | None:
    """Resolve a pipeline id to its category filter list. None = all features."""
    cfg_path = os.path.join(_REPO_ROOT, "src", "config", "features.json")
    with open(cfg_path, "r", encoding="utf-8") as f:
        cfg = json.load(f)
    pipelines = cfg.get("pipelines", {})
    pipeline = pipelines.get(pipeline_id)
    if pipeline is None:
        # Unknown pipeline — caller decides whether this is fatal. We treat it
        # as "use all features" for forward-compat with future pipelines that
        # haven't been registered yet.
        return None
    cats = pipeline.get("categories")
    if not cats:
        return None
    return list(cats)


def _percentile_robust(arr: np.ndarray, q: float) -> float:
    """Percentile that handles all-NaN input cleanly."""
    finite = arr[np.isfinite(arr)]
    if finite.size == 0:
        return float("nan")
    return float(np.percentile(finite, q))


def _per_feature_stats(matrix: np.ndarray, names: list[str]) -> list[dict]:
    """Per-feature mean/std/skew/kurt/finite-ratio + p1/p99 tail markers."""
    n_rows, n_feats = matrix.shape
    out: list[dict] = []
    for j in range(n_feats):
        col = matrix[:, j]
        mask = np.isfinite(col)
        finite = col[mask]
        finite_ratio = float(mask.sum() / n_rows) if n_rows else 0.0
        if finite.size == 0:
            out.append(
                {
                    "name": names[j],
                    "mean": None,
                    "std": None,
                    "skew": None,
                    "kurt": None,
                    "finiteRatio": finite_ratio,
                    "p1": None,
                    "p99": None,
                }
            )
            continue
        mu = float(finite.mean())
        sigma = float(finite.std(ddof=0))
        # Manual skew / excess-kurtosis to avoid scipy dependency on hot path.
        if sigma > 0:
            z = (finite - mu) / sigma
            skew = float((z**3).mean())
            kurt = float((z**4).mean() - 3.0)
        else:
            skew = 0.0
            kurt = 0.0
        out.append(
            {
                "name": names[j],
                "mean": mu,
                "std": sigma,
                "skew": skew,
                "kurt": kurt,
                "finiteRatio": finite_ratio,
                "p1": _percentile_robust(finite, 1.0),
                "p99": _percentile_robust(finite, 99.0),
            }
        )
    return out


def _compute_correlations(
    matrix: np.ndarray,
    names: list[str],
    redundancy_threshold: float,
    top_redundant: int,
) -> dict:
    """
    Pairwise Pearson correlations on the finite-row subset.

    NaN strategy: drop rows where ANY feature has a NaN (typical for rolling-
    window features — leading rows are NaN until the window fills). This keeps
    the correlation aligned across features without resorting to per-pair
    pairwise-deletion (which produces non-PSD matrices).
    """
    n_rows, n_feats = matrix.shape
    finite_mask = np.isfinite(matrix).all(axis=1)
    finite_rows = int(finite_mask.sum())
    cleaned = matrix[finite_mask]

    if n_feats < 2 or cleaned.shape[0] < 2:
        return {
            "meanAbsCorr": 0.0,
            "maxAbsCorr": 0.0,
            "correlationMatrix": [[1.0] * n_feats for _ in range(n_feats)] if n_feats == 1 else [],
            "redundantPairs": [],
            "finiteRows": finite_rows,
        }

    # Zero-variance columns return NaN from corrcoef — replace with 0 so the
    # downstream UI doesn't break.
    corr = np.corrcoef(cleaned, rowvar=False)
    corr = np.nan_to_num(corr, nan=0.0, posinf=1.0, neginf=-1.0)

    iu = np.triu_indices(n_feats, k=1)
    abs_off_diag = np.abs(corr[iu])
    mean_abs = float(abs_off_diag.mean()) if abs_off_diag.size else 0.0
    max_abs = float(abs_off_diag.max()) if abs_off_diag.size else 0.0

    # Redundant pairs (|r| >= threshold), sorted by |r| descending.
    flagged_idx = np.where(abs_off_diag >= redundancy_threshold)[0]
    if flagged_idx.size > 0:
        order = np.argsort(-abs_off_diag[flagged_idx])
        flagged_idx = flagged_idx[order]
    pairs = []
    for k in flagged_idx[:top_redundant]:
        i, j = int(iu[0][k]), int(iu[1][k])
        pairs.append(
            {
                "a": names[i],
                "b": names[j],
                "corr": float(corr[i, j]),
            }
        )

    return {
        "meanAbsCorr": mean_abs,
        "maxAbsCorr": max_abs,
        "correlationMatrix": corr.tolist(),
        "redundantPairs": pairs,
        "finiteRows": finite_rows,
    }


def _run(args: argparse.Namespace) -> dict:
    t0 = time.perf_counter()

    categories = _load_pipeline_categories(args.pipeline_id)
    date_range = None
    if args.start and args.end:
        date_range = (args.start, args.end)
    elif args.start or args.end:
        return {
            "success": False,
            "error": "Both --start and --end must be provided together (or neither).",
        }

    bars = load_ohlcv_arrays(
        symbol=args.symbol,
        timeframe=args.timeframe,
        max_bars=args.max_bars,
        date_range=date_range,
    )
    if bars is None or (hasattr(bars, "__len__") and len(bars) == 0):
        return {
            "success": False,
            "error": f"No OHLCV data for {args.symbol} {args.timeframe} in requested window.",
            "rawBars": 0,
        }

    # `load_ohlcv_arrays` returns a dict-of-arrays; convert to the dict shape
    # `compute_features` expects (it accepts dict with 'close' key directly).
    if isinstance(bars, dict):
        n_bars = int(len(bars.get("close", [])))
        ohlcv_input = bars
    else:
        # Fall back to list-of-dicts (old API)
        n_bars = len(bars)
        ohlcv_input = bars

    if n_bars == 0:
        return {
            "success": False,
            "error": "OHLCV loader returned empty arrays.",
            "rawBars": 0,
        }

    t_load = time.perf_counter() - t0

    matrix, feature_names, _timestamps = compute_features(
        ohlcv_input, categories=categories, n_jobs=1
    )

    t_compute = time.perf_counter() - t0 - t_load

    stats = _per_feature_stats(matrix, feature_names)
    corr_block = _compute_correlations(
        matrix,
        feature_names,
        redundancy_threshold=args.redundancy_threshold,
        top_redundant=args.top_redundant,
    )

    t_total = time.perf_counter() - t0

    return {
        "success": True,
        "symbol": args.symbol,
        "timeframe": args.timeframe,
        "pipelineId": args.pipeline_id,
        "categories": categories,
        "rawBars": n_bars,
        "sampleSize": int(matrix.shape[0]),
        "finiteRows": corr_block["finiteRows"],
        "featureCount": len(feature_names),
        "featureNames": feature_names,
        "stats": stats,
        "meanAbsCorr": corr_block["meanAbsCorr"],
        "maxAbsCorr": corr_block["maxAbsCorr"],
        "correlationMatrix": corr_block["correlationMatrix"],
        "redundantPairs": corr_block["redundantPairs"],
        "redundancyThreshold": args.redundancy_threshold,
        "timings": {
            "loadSec": round(t_load, 3),
            "computeSec": round(t_compute, 3),
            "totalSec": round(t_total, 3),
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="ML Studio features-preview computation.")
    parser.add_argument("--symbol", required=True)
    parser.add_argument(
        "--timeframe",
        required=True,
        choices=["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w"],
    )
    parser.add_argument("--pipeline-id", required=True)
    parser.add_argument("--max-bars", type=int, default=50000)
    parser.add_argument("--start", default=None)
    parser.add_argument("--end", default=None)
    parser.add_argument("--redundancy-threshold", type=float, default=0.95)
    parser.add_argument("--top-redundant", type=int, default=50)
    args = parser.parse_args()

    try:
        result = _run(args)
    except Exception as exc:  # noqa: BLE001
        result = {
            "success": False,
            "error": f"{type(exc).__name__}: {exc}",
        }

    sys.stdout.write(json.dumps(result, separators=(",", ":")))
    sys.stdout.flush()
    return 0 if result.get("success") else 1


if __name__ == "__main__":
    sys.exit(main())
