"""
Training diagnostics — pure functions for model state analysis.

All functions are side-effect-free (no I/O, no emit calls). They accept
numpy arrays and return plain dicts/lists suitable for JSON serialization.

Sections:
  A. compute_cluster_quality     — external cluster validation metrics
  B. compute_feature_attribution — per-regime feature importance
  C. evaluate_quality_gates      — deterministic rule engine
  D. compute_sampler_diagnostics — ESS + autocorrelation
  E. compute_emission_heatmap    — standardized emission matrix
"""

import numpy as np

# ── A. Cluster Quality ─────────────────────────────────────────────────────


def compute_cluster_quality(
    X, states, prev_states, model_means, model_vars, close, max_samples=5000
):
    """
    External cluster validation metrics.

    Args:
        X:            (T, D) normalized feature matrix
        states:       (T,) current state assignments
        prev_states:  (T,) previous iteration states (for ARI), or None
        model_means:  (K, D) emission means
        model_vars:   (K, D) emission variances
        close:        (T,) raw close prices for log-return computation
        max_samples:  cap for silhouette sampling

    Returns dict with: silhouette, calinski_harabasz, davies_bouldin,
    adjusted_rand_index, separation_pvalues, bhattacharyya_distances
    """
    result = {}
    n_unique = len(np.unique(states))

    # sklearn metrics require >= 2 clusters and < T clusters
    if n_unique >= 2 and n_unique < len(states):
        try:
            from sklearn.metrics import (
                calinski_harabasz_score,
                davies_bouldin_score,
                silhouette_score,
            )

            sample_size = min(max_samples, len(X))
            result["silhouette"] = float(silhouette_score(X, states, sample_size=sample_size))
            result["calinski_harabasz"] = float(calinski_harabasz_score(X, states))
            result["davies_bouldin"] = float(davies_bouldin_score(X, states))
        except Exception:
            result["silhouette"] = 0.0
            result["calinski_harabasz"] = 0.0
            result["davies_bouldin"] = 999.0

    else:
        result["silhouette"] = 0.0
        result["calinski_harabasz"] = 0.0
        result["davies_bouldin"] = 999.0

    # Adjusted Rand Index vs previous iteration
    if prev_states is not None:
        try:
            from sklearn.metrics import adjusted_rand_score

            result["adjusted_rand_index"] = float(adjusted_rand_score(prev_states, states))
        except Exception:
            result["adjusted_rand_index"] = 0.0
    else:
        result["adjusted_rand_index"] = 0.0

    # Per-regime log returns for separation tests
    close_arr = np.asarray(close, dtype=np.float64)
    if len(close_arr) > 1:
        log_returns = np.diff(np.log(np.maximum(close_arr, 1e-10)))
        # Pad to match states length (log_returns is T-1)
        lr_padded = np.concatenate([[0.0], log_returns])
    else:
        lr_padded = np.zeros(len(states))

    unique_regimes = np.unique(states)
    regime_returns = {}
    for k in unique_regimes:
        mask = states == k
        regime_returns[int(k)] = lr_padded[mask]

    # Welch's t-test between all regime pairs
    separation_pvalues = {}
    if len(unique_regimes) >= 2:
        try:
            from scipy.stats import ttest_ind

            for i_idx in range(len(unique_regimes)):
                for j_idx in range(i_idx + 1, len(unique_regimes)):
                    ki = int(unique_regimes[i_idx])
                    kj = int(unique_regimes[j_idx])
                    r_i = regime_returns[ki]
                    r_j = regime_returns[kj]
                    if len(r_i) >= 2 and len(r_j) >= 2:
                        _, pval = ttest_ind(r_i, r_j, equal_var=False)
                        separation_pvalues[f"{ki}_vs_{kj}"] = float(pval)
        except Exception:
            pass
    result["separation_pvalues"] = separation_pvalues

    # Bhattacharyya distance between regime pairs (averaged across D dimensions)
    bhatt_distances = {}
    if len(unique_regimes) >= 2:
        for i_idx in range(len(unique_regimes)):
            for j_idx in range(i_idx + 1, len(unique_regimes)):
                ki = int(unique_regimes[i_idx])
                kj = int(unique_regimes[j_idx])
                if ki < len(model_means) and kj < len(model_means):
                    m1 = model_means[ki]
                    m2 = model_means[kj]
                    v1 = np.maximum(model_vars[ki], 1e-10)
                    v2 = np.maximum(model_vars[kj], 1e-10)
                    # Per-dimension Bhattacharyya distance
                    db_per_d = 0.25 * np.log(0.25 * (v1 / v2 + v2 / v1 + 2.0)) + 0.25 * (
                        m1 - m2
                    ) ** 2 / (v1 + v2)
                    bhatt_distances[f"{ki}_vs_{kj}"] = float(np.mean(db_per_d))
    result["bhattacharyya_distances"] = bhatt_distances

    return result


# ── B. Feature Attribution ─────────────────────────────────────────────────


def compute_feature_attribution(model_means, model_vars, feature_names, active_mask):
    """
    Per-regime and global feature importance via standardized deviation.

    Importance_kd = |mu_kd - mu_global_d| / sqrt(var_kd)

    Args:
        model_means:   (K, D) emission means
        model_vars:    (K, D) emission variances
        feature_names: list of D feature name strings
        active_mask:   (K,) boolean — which regimes are active

    Returns dict with: per_regime, global_importance, interactions, dead_features
    """
    K, D = model_means.shape
    active_indices = np.where(active_mask)[0]

    if len(active_indices) == 0 or D == 0:
        return {
            "per_regime": {},
            "global_importance": {},
            "interactions": [],
            "dead_features": list(feature_names) if feature_names else [],
        }

    # Global mean across active regimes
    mu_global = np.mean(model_means[active_indices], axis=0)  # (D,)

    # Per-regime importance: |mu_kd - mu_global_d| / sqrt(var_kd)
    per_regime = {}
    importance_matrix = np.zeros((len(active_indices), D))
    for idx, k in enumerate(active_indices):
        std_k = np.sqrt(np.maximum(model_vars[k], 1e-10))
        imp = np.abs(model_means[k] - mu_global) / std_k
        importance_matrix[idx] = imp
        per_regime[int(k)] = {fn: round(float(imp[d]), 4) for d, fn in enumerate(feature_names)}

    # Global importance: mean across active regimes
    global_imp = np.mean(importance_matrix, axis=0)
    global_importance = {fn: round(float(global_imp[d]), 4) for d, fn in enumerate(feature_names)}

    # Feature interaction scores: pairwise correlation of importance vectors
    # Each regime is a sample, each feature is a variable
    interactions = []
    if len(active_indices) >= 2 and D >= 2:
        # importance_matrix is (n_active, D) — correlate columns (features)
        # Only compute for top features to keep payload small
        top_indices = np.argsort(-global_imp)[: min(10, D)]
        sub_matrix = importance_matrix[:, top_indices]
        if sub_matrix.shape[0] >= 2:
            # Correlation matrix of feature importance across regimes
            corr = np.corrcoef(sub_matrix.T)  # (n_top, n_top)
            for i in range(len(top_indices)):
                for j in range(i + 1, len(top_indices)):
                    fi = int(top_indices[i])
                    fj = int(top_indices[j])
                    val = corr[i, j] if np.isfinite(corr[i, j]) else 0.0
                    if abs(val) > 0.3:  # only report meaningful correlations
                        interactions.append(
                            {
                                "feature_a": feature_names[fi],
                                "feature_b": feature_names[fj],
                                "correlation": round(float(val), 4),
                            }
                        )

    # Dead feature detection: max importance < 0.1 across all active regimes
    max_imp_per_feature = np.max(importance_matrix, axis=0)
    dead_features = [feature_names[d] for d in range(D) if max_imp_per_feature[d] < 0.1]

    return {
        "per_regime": per_regime,
        "global_importance": global_importance,
        "interactions": interactions,
        "dead_features": dead_features,
    }


# ── C. Quality Gates ──────────────────────────────────────────────────────


def evaluate_quality_gates(
    cluster_metrics,
    n_active_regimes,
    self_transition,
    switch_rate,
    avg_dwell,
    beta_entropy,
    hyperparams,
):
    """
    Deterministic rule engine for training quality assessment.

    Args:
        cluster_metrics:   dict from compute_cluster_quality
        n_active_regimes:  int
        self_transition:   float, mean self-transition probability
        switch_rate:       float, fraction of consecutive bars changing state
        avg_dwell:         float, mean dwell time in bars
        beta_entropy:      float, entropy of global base measure
        hyperparams:       dict with alpha, gamma, kappa

    Returns list of {metric, value, status, recommendation}
    """
    gates = []

    # Silhouette score
    sil = cluster_metrics.get("silhouette", 0.0)
    if sil < 0.15:
        status = "fail"
        rec = "Reduce alpha or remove noisy features"
    elif sil < 0.25:
        status = "warn"
        rec = "Reduce alpha or remove noisy features"
    else:
        status = "pass"
        rec = ""
    gates.append(
        {"metric": "silhouette", "value": round(sil, 4), "status": status, "recommendation": rec}
    )

    # Davies-Bouldin index (lower is better)
    db = cluster_metrics.get("davies_bouldin", 999.0)
    if db > 2.0:
        status = "fail"
        rec = "Reduce K_max or increase gamma"
    elif db > 1.5:
        status = "warn"
        rec = "Reduce K_max or increase gamma"
    else:
        status = "pass"
        rec = ""
    gates.append(
        {"metric": "davies_bouldin", "value": round(db, 4), "status": status, "recommendation": rec}
    )

    # Number of active regimes
    n = n_active_regimes
    if n < 2 or n > 10:
        status = "fail"
        rec = "Adjust alpha"
    elif 7 <= n <= 10:
        status = "warn"
        rec = "Adjust alpha"
    else:
        status = "pass"
        rec = ""
    gates.append({"metric": "n_regimes", "value": n, "status": status, "recommendation": rec})

    # Self-transition probability
    st = self_transition
    if st < 0.5:
        status = "fail"
        rec = "Increase kappa"
    else:
        status = "pass"
        rec = ""
    gates.append(
        {
            "metric": "self_transition",
            "value": round(st, 4),
            "status": status,
            "recommendation": rec,
        }
    )

    # Average dwell time
    dw = avg_dwell
    if dw < 2.0:
        status = "fail"
        rec = "Increase kappa"
    elif dw < 5.0:
        status = "warn"
        rec = "Increase kappa"
    else:
        status = "pass"
        rec = ""
    gates.append(
        {"metric": "avg_dwell", "value": round(dw, 2), "status": status, "recommendation": rec}
    )

    # Max regime dominance (from cluster_metrics or compute from switch_rate context)
    # We receive n_active_regimes; dominance needs per-regime counts.
    # The caller should include max_regime_pct in cluster_metrics if available.
    max_dom = cluster_metrics.get("max_regime_pct", 0.0)
    if max_dom > 0.70:
        status = "fail"
        rec = "Increase alpha or add features"
    elif max_dom > 0.50:
        status = "warn"
        rec = "Increase alpha or add features"
    else:
        status = "pass"
        rec = ""
    gates.append(
        {
            "metric": "max_regime_dominance",
            "value": round(max_dom, 4),
            "status": status,
            "recommendation": rec,
        }
    )

    return gates


# ── D. Sampler Diagnostics ─────────────────────────────────────────────────


def compute_sampler_diagnostics(log_likelihoods, state_stabilities):
    """
    Effective sample size and autocorrelation from MCMC chain.

    ESS = N / (1 + 2 * sum(rho_k for k until rho_k < 0.05))
    from autocorrelation of the log-likelihood chain.

    Args:
        log_likelihoods:   list/array of per-iteration log-likelihoods
        state_stabilities: list/array of per-iteration assignment stability values

    Returns dict with: ess, autocorrelation_lag1
    """
    result = {"ess": 0.0, "autocorrelation_lag1": 0.0}

    ll = np.asarray(log_likelihoods, dtype=np.float64)
    N = len(ll)
    if N < 10:
        return result

    # Autocorrelation function for ESS computation
    ll_centered = ll - np.mean(ll)
    var_ll = np.var(ll)
    if var_ll < 1e-15:
        result["ess"] = float(N)
        return result

    # Compute autocorrelation using FFT for efficiency
    n_fft = 2 ** int(np.ceil(np.log2(2 * N)))
    fft_ll = np.fft.rfft(ll_centered, n=n_fft)
    acf_full = np.fft.irfft(fft_ll * np.conj(fft_ll), n=n_fft)[:N]
    acf_full /= acf_full[0] + 1e-300  # normalize to correlation

    # ESS: sum autocorrelations until they drop below 0.05
    tau_sum = 0.0
    for k in range(1, N):
        rho_k = acf_full[k]
        if rho_k < 0.05:
            break
        tau_sum += rho_k

    ess = N / (1.0 + 2.0 * tau_sum)
    result["ess"] = round(float(np.clip(ess, 1.0, N)), 2)

    # Autocorrelation at lag-1 of stability sequence
    stab = np.asarray(state_stabilities, dtype=np.float64)
    if len(stab) >= 2:
        stab_centered = stab - np.mean(stab)
        var_stab = np.var(stab)
        if var_stab > 1e-15:
            lag1 = np.sum(stab_centered[:-1] * stab_centered[1:]) / ((len(stab) - 1) * var_stab)
            result["autocorrelation_lag1"] = round(float(np.clip(lag1, -1.0, 1.0)), 4)

    return result


# ── E. Emission Heatmap ────────────────────────────────────────────────────


def compute_emission_heatmap(model_means, model_vars, active_mask):
    """
    Standardized emission matrix for heatmap visualization.

    Returns (K_active, D) matrix of (mu_kd - mu_global_d) / sqrt(var_kd)
    as a list-of-lists for JSON serialization.

    Args:
        model_means:  (K, D) emission means
        model_vars:   (K, D) emission variances
        active_mask:  (K,) boolean mask

    Returns dict with: matrix (list of lists), active_regime_ids (list of int)
    """
    active_indices = np.where(active_mask)[0]

    if len(active_indices) == 0:
        return {"matrix": [], "active_regime_ids": []}

    active_means = model_means[active_indices]  # (K_active, D)
    active_vars = model_vars[active_indices]  # (K_active, D)

    mu_global = np.mean(active_means, axis=0)  # (D,)
    std_k = np.sqrt(np.maximum(active_vars, 1e-10))

    heatmap = (active_means - mu_global[np.newaxis, :]) / std_k

    # Clip extreme values for visualization
    heatmap = np.clip(heatmap, -5.0, 5.0)

    return {
        "matrix": [[round(float(v), 4) for v in row] for row in heatmap],
        "active_regime_ids": [int(k) for k in active_indices],
    }
