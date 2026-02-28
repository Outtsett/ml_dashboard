"""Composite quality score computation."""

import numpy as np


def compute_quality_score(model, relabeled, n_regimes, T, oos=None, walk_forward=None):
    """
    Composite quality score: convergence + stability + balance + OOS + WF + regime count.
    Returns int 0-100.
    """
    # Active states for self-transition check
    active_states = [i for i in range(model.K) if np.sum(model.state_sequence == i) > T * 0.01]
    self_trans = float(np.mean([model.transition_matrix[i, i] for i in active_states])) if active_states else 0.0

    # Convergence: how much LL improved in last 20% vs first 20%
    lls = model.log_likelihoods
    if len(lls) > 10:
        early_improvement = abs(lls[len(lls) // 5] - lls[0])
        late_improvement = abs(lls[-1] - lls[-len(lls) // 5])
        convergence_ratio = 1.0 - min(1.0, late_improvement / (early_improvement + 1e-10))
    else:
        convergence_ratio = 0.5

    # Regime balance: penalize if one regime dominates (>50% of bars)
    _, counts = np.unique(relabeled, return_counts=True)
    max_pct = max(float(cnt) / T for cnt in counts) if len(counts) > 0 else 1.0
    balance_score = 1.0 - max(0, max_pct - 0.5)

    regime_count_score = min(1.0, n_regimes / 10)

    # OOS and walk-forward (default 0.5 if not available)
    oos_score = oos["distribution_similarity"] if oos else 0.5
    wf_score = walk_forward["stability_score"] if walk_forward else 0.5

    # Weighted: convergence 25% + self_trans 20% + balance 15% + OOS 20% + WF 10% + count 10%
    return min(100, max(0, int(
        convergence_ratio * 25 + self_trans * 20 + balance_score * 15 +
        oos_score * 20 + wf_score * 10 + regime_count_score * 10
    )))
