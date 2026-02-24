"""
HDP-HMM SHAP Explainability
=============================

Real SHAP (SHapley Additive exPlanations) for regime assignments.

Think of it as asking: "For each bar, which features PUSHED the model
to assign THIS regime instead of another?" SHAP gives each feature a
score: positive means it pushed toward this regime, negative means it
pushed away. The bigger the score, the more that feature mattered.

Uses the SHAP KernelExplainer which works with ANY model that has a
predict function — perfect for our Bayesian HDP-HMM since it's not a
standard sklearn estimator.

Output:
  - Per-regime feature importance rankings
  - Global feature importance (mean |SHAP| across all bars)
  - Top features per regime (which indicators define each regime)
  - Saved as shap_values.npz + shap_summary.json alongside model artifacts
"""

import json
import sys
import time
from pathlib import Path
from typing import Any

import numpy as np

from .model import StickyHDPHMM


def compute_shap_explanations(
    model: StickyHDPHMM,
    X: np.ndarray,
    feature_names: list[str],
    n_background: int = 200,
    n_explain: int = 500,
    random_state: int = 42,
) -> dict[str, Any]:
    """
    Compute SHAP values for HDP-HMM regime assignments.

    Think of it as: for each bar in the dataset, asking "which features
    were most responsible for putting this bar in its assigned regime?"

    We use KernelExplainer because HDP-HMM is a generative model (not a
    simple sklearn classifier), so tree/gradient-based SHAP won't work.
    KernelExplainer treats the model as a black box: perturb inputs,
    observe output changes, compute Shapley values.

    Args:
        model: Fitted StickyHDPHMM model
        X: Feature matrix (T x D), already standardized
        feature_names: Column names matching X's D dimension
        n_background: Number of background samples for KernelExplainer
            (more = slower but more accurate; 200 is a good trade-off)
        n_explain: Number of bars to explain (subset for speed)
        random_state: Reproducibility seed

    Returns:
        Dictionary with SHAP analysis results:
        - global_importance: {feature_name: mean_abs_shap} (sorted)
        - per_regime_importance: {regime_id: {feature_name: mean_abs_shap}}
        - top_features_per_regime: {regime_id: [(feature, importance), ...]}
        - shap_values: raw SHAP values array (n_explain x D x K)
        - explained_indices: which bar indices were explained
    """
    try:
        import shap  # type: ignore[import-untyped]
    except ImportError:
        print("  WARNING: SHAP not installed. Run: pip install shap")
        return {"error": "shap not installed"}

    rng = np.random.RandomState(random_state)  # type: ignore[attr-defined]
    T, D = X.shape
    K = model.n_components

    print(f"  SHAP Analysis: {K} regimes, {D} features, {T:,} bars")
    print(f"  Background samples: {n_background}, Explaining: {min(n_explain, T)} bars")
    sys.stdout.flush()

    t0 = time.time()

    # ── Background data: stratified sample across regimes ──
    assignments = model.predict(X)
    bg_indices: list[int] = []
    per_regime_budget = max(n_background // K, 10)
    for k in range(K):
        regime_idx = np.where(assignments == k)[0]
        if len(regime_idx) > 0:
            sample_n = min(per_regime_budget, len(regime_idx))
            bg_indices.extend(rng.choice(regime_idx, size=sample_n, replace=False).tolist())
    # Fill remaining budget randomly
    remaining = n_background - len(bg_indices)
    if remaining > 0:
        all_idx = np.arange(T)
        extra = rng.choice(all_idx, size=min(remaining, T), replace=False)
        bg_indices.extend(extra.tolist())
    bg_indices = list(set(bg_indices))[:n_background]
    X_background = X[bg_indices]

    # ── Explain subset: stratified sample across regimes ──
    explain_indices: list[int] = []
    per_regime_explain = max(n_explain // K, 20)
    for k in range(K):
        regime_idx = np.where(assignments == k)[0]
        if len(regime_idx) > 0:
            sample_n = min(per_regime_explain, len(regime_idx))
            explain_indices.extend(rng.choice(regime_idx, size=sample_n, replace=False).tolist())
    explain_indices = sorted(set(explain_indices))[:n_explain]
    X_explain = X[explain_indices]

    print(f"  Background: {len(X_background)} samples, Explaining: {len(X_explain)} bars")
    sys.stdout.flush()

    # ── Prediction function: returns regime probabilities (T x K) ──
    def predict_fn(x: np.ndarray) -> np.ndarray:
        return model.predict_proba(x)

    # ── KernelExplainer ──
    print("  Building SHAP KernelExplainer...")
    sys.stdout.flush()
    explainer = shap.KernelExplainer(predict_fn, X_background)

    print("  Computing SHAP values (this may take a few minutes)...")
    sys.stdout.flush()
    # shap_values is a list of K arrays, each (n_explain x D)
    shap_values_raw = explainer.shap_values(X_explain, nsamples=100, silent=True)

    elapsed_shap = time.time() - t0
    print(f"  SHAP computation complete in {elapsed_shap:.1f}s")
    sys.stdout.flush()

    # ── Restructure: (K, n_explain, D) -> analysis ──
    # shap_values_raw: list of K arrays, each (n_explain, D)
    if isinstance(shap_values_raw, list):
        shap_array = np.array(shap_values_raw)  # (K, n_explain, D)
    else:
        # Single output case (shouldn't happen with predict_proba, but safety)
        shap_array = shap_values_raw[np.newaxis, :, :]  # (1, n_explain, D)

    K_actual = shap_array.shape[0]
    n_explained = shap_array.shape[1]

    # ── Global feature importance: mean |SHAP| across all regimes and bars ──
    global_importance_raw = np.mean(np.abs(shap_array), axis=(0, 1))  # (D,)
    global_sorted_idx = np.argsort(-global_importance_raw)
    global_importance: dict[str, float] = {}
    for idx in global_sorted_idx:
        global_importance[feature_names[idx]] = round(float(global_importance_raw[idx]), 6)

    # ── Per-regime feature importance ──
    per_regime_importance: dict[int, dict[str, float]] = {}
    top_features_per_regime: dict[int, list[tuple[str, float]]] = {}

    explained_assignments = assignments[explain_indices]

    for k in range(K_actual):
        # Mean |SHAP| for regime k across all explained bars
        regime_shap = np.mean(np.abs(shap_array[k]), axis=0)  # (D,)
        sorted_idx = np.argsort(-regime_shap)

        importance: dict[str, float] = {}
        top_features: list[tuple[str, float]] = []
        for i, idx in enumerate(sorted_idx):
            feat_name = feature_names[idx]
            feat_importance = round(float(regime_shap[idx]), 6)
            importance[feat_name] = feat_importance
            if i < 20:  # top 20 per regime
                top_features.append((feat_name, feat_importance))

        per_regime_importance[k] = importance
        top_features_per_regime[k] = top_features

    # ── Per-regime: which features DEFINE this regime (bars assigned to it) ──
    regime_defining_features: dict[int, list[dict[str, Any]]] = {}
    for k in range(K_actual):
        mask = explained_assignments == k
        if mask.sum() == 0:
            regime_defining_features[k] = []
            continue

        # For bars in regime k, compute mean SHAP toward regime k
        regime_k_shap = shap_array[k][mask]  # (n_in_regime, D)
        mean_shap = np.mean(regime_k_shap, axis=0)  # (D,) — signed
        abs_shap = np.mean(np.abs(regime_k_shap), axis=0)  # (D,) — magnitude

        sorted_idx = np.argsort(-abs_shap)
        features_list: list[dict[str, Any]] = []
        for idx in sorted_idx[:30]:  # top 30 defining features
            features_list.append({
                "feature": feature_names[idx],
                "mean_shap": round(float(mean_shap[idx]), 6),
                "abs_shap": round(float(abs_shap[idx]), 6),
                "direction": "pushes_toward" if mean_shap[idx] > 0 else "pushes_away",
            })
        regime_defining_features[k] = features_list

    # ── Summary stats ──
    print("\n  SHAP Global Top 15 Features:")
    for i, (feat, imp) in enumerate(list(global_importance.items())[:15]):
        print(f"    {i+1:>2}. {feat:<30s} importance={imp:.6f}")
    sys.stdout.flush()

    for k in range(K_actual):
        n_in_regime = int(np.sum(explained_assignments == k))
        top3 = top_features_per_regime.get(k, [])[:3]
        top3_str = ", ".join([f"{f[0]}={f[1]:.4f}" for f in top3])
        print(f"  Regime {k} ({n_in_regime} bars): top 3 = [{top3_str}]")
    sys.stdout.flush()

    return {
        "global_importance": global_importance,
        "per_regime_importance": {str(k): v for k, v in per_regime_importance.items()},
        "top_features_per_regime": {
            str(k): [{"feature": f, "importance": i} for f, i in v]
            for k, v in top_features_per_regime.items()
        },
        "regime_defining_features": {str(k): v for k, v in regime_defining_features.items()},
        "shap_values_shape": list(shap_array.shape),
        "n_explained": n_explained,
        "explained_indices": [int(i) for i in explain_indices],
        "computation_time_sec": round(elapsed_shap, 2),
        "_shap_array": shap_array,  # kept in memory, not serialized to JSON
    }


def save_shap_results(
    shap_results: dict[str, Any],
    output_dir: Path,
) -> None:
    """
    Save SHAP results to disk alongside model artifacts.

    Saves:
      - shap_summary.json: Human-readable importance rankings
      - shap_values.npz: Raw SHAP values for further analysis/visualization
    """
    output_dir.mkdir(parents=True, exist_ok=True)

    # Extract the raw array before JSON serialization
    shap_array = shap_results.pop("_shap_array", None)

    # Save JSON summary
    json_path = output_dir / "shap_summary.json"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(shap_results, f, indent=2, default=str)
    print(f"  Saved SHAP summary: {json_path} ({json_path.stat().st_size / 1024:.1f} KB)")

    # Save raw SHAP values as compressed numpy
    if shap_array is not None:
        npz_path = output_dir / "shap_values.npz"
        np.savez_compressed(
            npz_path,
            shap_values=shap_array,
            explained_indices=np.array(shap_results.get("explained_indices", [])),
        )
        print(f"  Saved SHAP values: {npz_path} ({npz_path.stat().st_size / 1024:.1f} KB)")

    sys.stdout.flush()
