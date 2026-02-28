"""Analytical SHAP values for diagonal Gaussian HMM emissions."""

import numpy as np


def compute_shap_values(model, features, relabeled, feature_names, n_regimes):
    """
    Exact SHAP values for diagonal Gaussian HMM emissions.

    For bar t assigned to regime k, feature d's SHAP contribution measures how
    much regime k's emission log-likelihood for feature d exceeds the population-
    weighted average across all regimes.  Positive = supports this regime
    assignment, negative = argues against it.

    Uses model.means / model.vars (Bayesian posterior from Gibbs sampler) for
    the true model-based decomposition.

    Returns (shap_matrix, shap_summary):
      shap_matrix : ndarray (T, D) — per-bar per-feature SHAP values
      shap_summary: list[dict]     — per-regime mean |SHAP| per feature (top 10)
    """
    T, D = features.shape

    if not hasattr(model, "means") or not hasattr(model, "vars"):
        return np.zeros((T, D)), []

    # Map relabeled IDs → original model state IDs
    original_ids = []
    for k in range(n_regimes):
        mask = relabeled == k
        if np.any(mask):
            orig = model.state_sequence[mask]
            vals, cnts = np.unique(orig, return_counts=True)
            original_ids.append(int(vals[np.argmax(cnts)]))
        else:
            original_ids.append(0)

    # Extract emission parameters (posterior means/variances from Gibbs sampler)
    means = np.zeros((n_regimes, D))
    variances = np.zeros((n_regimes, D))
    proportions = np.zeros(n_regimes)

    for k in range(n_regimes):
        oid = original_ids[k]
        means[k] = model.means[oid, :D]
        variances[k] = np.maximum(model.vars[oid, :D], 1e-10)
        proportions[k] = np.sum(relabeled == k) / T

    log_var = np.log(variances)  # (K, D)

    # Population-weighted baseline: E_k[LL_d(x_t | k)] per (bar, feature)
    # Computed one regime at a time to keep peak memory at O(T*D)
    baseline = np.zeros((T, D))
    for k in range(n_regimes):
        diff = features - means[k]
        baseline += proportions[k] * (-0.5 * (log_var[k] + diff ** 2 / variances[k]))

    # SHAP = assigned regime's emission LL contribution - baseline
    shap_matrix = np.zeros((T, D))
    for k in range(n_regimes):
        mask = relabeled == k
        if not np.any(mask):
            continue
        diff_k = features[mask] - means[k]
        raw_k = -0.5 * (log_var[k] + diff_k ** 2 / variances[k])
        shap_matrix[mask] = raw_k - baseline[mask]

    # Per-regime summary (top 10 features by mean |SHAP|)
    shap_summary = []
    for k in range(n_regimes):
        mask = relabeled == k
        if np.sum(mask) == 0:
            continue
        regime_shap = shap_matrix[mask]
        mean_abs = np.mean(np.abs(regime_shap), axis=0)
        mean_dir = np.mean(regime_shap, axis=0)

        indices = np.argsort(-mean_abs)[:10]
        top_features = [{
            "feature": feature_names[idx],
            "mean_abs_shap": round(float(mean_abs[idx]), 6),
            "mean_shap": round(float(mean_dir[idx]), 6),
        } for idx in indices]

        shap_summary.append({
            "regime_id": int(k),
            "top_features": top_features,
        })

    return shap_matrix, shap_summary
