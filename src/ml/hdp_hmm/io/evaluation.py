"""Out-of-sample evaluation and walk-forward stability analysis."""

import numpy as np


# ── Shared Utilities ─────────────────────────────────────────────────────────

def compute_distribution(states, n_regimes):
    """Compute regime frequency distribution as percentages."""
    counts = np.zeros(n_regimes)
    for s in states:
        if 0 <= s < n_regimes:
            counts[int(s)] += 1
    total = np.sum(counts)
    return (counts / total).tolist() if total > 0 else [0.0] * n_regimes


def jensen_shannon(p, q):
    """Jensen-Shannon divergence (0 = identical, 1 = maximally different)."""
    p = np.array(p, dtype=np.float64)
    q = np.array(q, dtype=np.float64)
    p = np.maximum(p, 1e-10)
    q = np.maximum(q, 1e-10)
    p = p / np.sum(p)
    q = q / np.sum(q)
    m = 0.5 * (p + q)
    kl_pm = np.sum(p * np.log(p / m))
    kl_qm = np.sum(q * np.log(q / m))
    return float(0.5 * (kl_pm + kl_qm))


# ── OOS Evaluation ───────────────────────────────────────────────────────────

def compute_oos_evaluation(relabeled, features, split_idx, n_regimes):
    """Out-of-sample evaluation: compare train vs test regime behavior."""
    train_states = relabeled[:split_idx]
    test_states = relabeled[split_idx:]
    train_features = features[:split_idx]
    test_features = features[split_idx:]

    if len(test_states) < 20:
        return None

    # 1. Distribution similarity
    train_dist = compute_distribution(train_states, n_regimes)
    test_dist = compute_distribution(test_states, n_regimes)
    js_div = jensen_shannon(train_dist, test_dist)
    distribution_similarity = round(1.0 - js_div, 4)

    # 2. Per-regime profile correlation
    profile_consistency = []
    for r in range(n_regimes):
        train_mask = train_states == r
        test_mask = test_states == r
        if np.sum(train_mask) < 10 or np.sum(test_mask) < 10:
            profile_consistency.append({
                "regime": r, "correlation": None, "insufficient_data": True,
            })
        else:
            train_profile = np.mean(train_features[train_mask], axis=0)
            test_profile = np.mean(test_features[test_mask], axis=0)
            corr = float(np.corrcoef(train_profile, test_profile)[0, 1])
            if np.isnan(corr):
                corr = 0.0
            profile_consistency.append({
                "regime": r, "correlation": round(corr, 4), "insufficient_data": False,
            })

    valid_corrs = [p["correlation"] for p in profile_consistency if p["correlation"] is not None]
    avg_profile_correlation = round(float(np.mean(valid_corrs)), 4) if valid_corrs else 0.0

    # 3. Switch rates
    train_switches = float(np.sum(train_states[1:] != train_states[:-1]) / max(1, len(train_states) - 1))
    test_switches = float(np.sum(test_states[1:] != test_states[:-1]) / max(1, len(test_states) - 1))

    # 4. Average test confidence (composite of distribution match and profile correlation)
    avg_test_confidence = round(distribution_similarity * max(avg_profile_correlation, 0), 4)

    return {
        "distribution_similarity": distribution_similarity,
        "train_distribution": [round(x, 4) for x in train_dist],
        "test_distribution": [round(x, 4) for x in test_dist],
        "profile_consistency": profile_consistency,
        "avg_profile_correlation": avg_profile_correlation,
        "avg_test_confidence": avg_test_confidence,
        "train_switch_rate": round(train_switches, 4),
        "test_switch_rate": round(test_switches, 4),
        "switch_rate_ratio": round(test_switches / (train_switches + 1e-10), 4),
    }


# ── Walk-Forward Stability ───────────────────────────────────────────────────

def compute_walk_forward(state_samples, n_regimes, n_windows=5):
    """Walk-forward stability from post-burn-in Gibbs samples (no re-training)."""
    if not state_samples or len(state_samples) < n_windows * 2:
        return None

    samples = np.array(state_samples)
    n_samples = len(samples)
    window_size = n_samples // n_windows

    window_results = []
    distributions = []

    for w in range(n_windows):
        start = w * window_size
        end = start + window_size if w < n_windows - 1 else n_samples
        window_samples = samples[start:end]

        # Mode assignment for this window
        T = window_samples.shape[1]
        mode_states = np.zeros(T, dtype=int)
        for t in range(T):
            vals, cnts = np.unique(window_samples[:, t], return_counts=True)
            mode_states[t] = vals[np.argmax(cnts)]

        # Distribution
        dist = compute_distribution(mode_states, n_regimes)
        distributions.append(dist)

        # Switch rate
        switches = float(np.sum(mode_states[1:] != mode_states[:-1]) / max(1, T - 1))

        # Confidence: fraction of samples agreeing with mode per timestep
        agreement_per_t = np.zeros(T)
        for t in range(T):
            agreement_per_t[t] = np.mean(window_samples[:, t] == mode_states[t])
        avg_confidence = float(np.mean(agreement_per_t))

        window_results.append({
            "window": w + 1,
            "train_size": int(end - start),
            "test_size": int(window_size),
            "regime_distribution": [round(x, 4) for x in dist],
            "switch_rate": round(switches, 4),
            "avg_confidence": round(avg_confidence, 4),
            "failed": avg_confidence < 0.5,
        })

    # Stability: average pairwise JS similarity between window distributions
    pairwise_sims = []
    for i in range(len(distributions)):
        for j in range(i + 1, len(distributions)):
            pairwise_sims.append(1.0 - jensen_shannon(distributions[i], distributions[j]))
    stability_score = round(float(np.mean(pairwise_sims)), 4) if pairwise_sims else 0.0

    return {
        "n_windows": n_windows,
        "window_results": window_results,
        "stability_score": stability_score,
        "avg_oos_confidence": round(float(np.mean([w["avg_confidence"] for w in window_results])), 4),
        "avg_switch_rate": round(float(np.mean([w["switch_rate"] for w in window_results])), 4),
    }
