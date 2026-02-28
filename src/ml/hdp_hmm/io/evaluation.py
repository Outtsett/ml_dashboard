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

def compute_walk_forward(wf_counts, n_regimes, n_windows=5):
    """Walk-forward stability from windowed mode counters (no re-training).

    Args:
        wf_counts: list of n_windows numpy arrays, each (T, K) int16/int32.
                   Each array holds per-timestep regime vote counts for that
                   window of the Gibbs sampling chain.
        n_regimes: number of active regimes.
        n_windows: expected number of windows.
    """
    if not wf_counts or len(wf_counts) < n_windows:
        return None

    # Check that at least some counts were accumulated
    if all(c.sum() == 0 for c in wf_counts):
        return None

    window_results = []
    distributions = []
    K = min(n_regimes, wf_counts[0].shape[1])

    for w in range(n_windows):
        counts = wf_counts[w]  # (T, K_max)
        counts_k = counts[:, :K]  # restrict to active regimes

        # Mode assignment for this window
        mode_states = np.argmax(counts_k, axis=1)

        # Distribution
        dist = compute_distribution(mode_states, n_regimes)
        distributions.append(dist)

        T = len(mode_states)
        # Switch rate
        switches = float(np.sum(mode_states[1:] != mode_states[:-1]) / max(1, T - 1))

        # Confidence: fraction of samples agreeing with mode per timestep
        total_per_t = np.maximum(counts.sum(axis=1), 1).astype(np.float64)
        mode_count_per_t = counts[np.arange(T), mode_states]
        avg_confidence = float(np.mean(mode_count_per_t / total_per_t))

        # Sample count for this window
        sample_count = int(counts.sum(axis=1).max())

        window_results.append({
            "window": w + 1,
            "train_size": sample_count,
            "test_size": sample_count,
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
