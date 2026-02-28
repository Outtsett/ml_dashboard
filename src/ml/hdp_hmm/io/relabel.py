"""State relabeling — contiguous IDs sorted by frequency."""

import numpy as np

from .constants import REGIME_COLORS as _DEFAULT_COLORS


def relabel_states(states, X, regime_colors=None):
    """
    Relabel states to contiguous 0..N-1 sorted by frequency.
    Returns (relabeled, colors, labels, n_regimes).
    """
    if regime_colors is None:
        regime_colors = _DEFAULT_COLORS

    T = len(states)
    unique, counts = np.unique(states, return_counts=True)

    # Filter tiny regimes (< 1% of bars)
    threshold = max(1, T * 0.01)
    active_mask = counts > threshold
    active = unique[active_mask]
    active_counts = counts[active_mask]

    # Sort by frequency (most common first)
    order = np.argsort(-active_counts)
    active = active[order]

    label_map = {int(old): new for new, old in enumerate(active)}
    n_regimes = len(active)

    # Relabel
    relabeled = np.array([label_map.get(int(s), -1) for s in states])
    # Fill gaps with nearest valid assignment
    for i in range(len(relabeled)):
        if relabeled[i] == -1:
            relabeled[i] = relabeled[max(0, i - 1)]

    # Compute regime labels using percentile-based thresholds (scale-invariant)
    colors = {}
    labels = {}
    ret_col = 0  # return_1 is first feature

    # Gather per-regime means and vols for percentile computation
    regime_means = []
    regime_vols = []
    for old_id in active:
        mask = states == old_id
        if np.any(mask) and X.shape[1] > ret_col:
            regime_means.append(np.mean(X[mask, ret_col]))
            regime_vols.append(np.std(X[mask, ret_col]))
        else:
            regime_means.append(0.0)
            regime_vols.append(0.0)
    regime_means = np.array(regime_means)
    regime_vols = np.array(regime_vols)

    # Percentile-based thresholds (adapts to any timeframe/instrument)
    if len(regime_means) >= 3:
        ret_high = np.percentile(regime_means, 75)
        ret_low = np.percentile(regime_means, 25)
        vol_high = np.percentile(regime_vols, 75)
        vol_low = np.percentile(regime_vols, 25)
    else:
        ret_high = np.mean(regime_means) + np.std(regime_means)
        ret_low = np.mean(regime_means) - np.std(regime_means)
        vol_high = np.mean(regime_vols) + np.std(regime_vols)
        vol_low = np.mean(regime_vols) - np.std(regime_vols)

    for idx, (new_id, old_id) in enumerate(enumerate(active)):
        mean_ret = regime_means[idx]
        vol = regime_vols[idx]

        if mean_ret >= ret_high and vol <= vol_low:
            label = "Low Vol Bull"
        elif mean_ret >= ret_high:
            label = "High Vol Bull"
        elif mean_ret <= ret_low and vol <= vol_low:
            label = "Low Vol Bear"
        elif mean_ret <= ret_low:
            label = "High Vol Bear"
        elif vol <= vol_low:
            label = "Quiet Range"
        elif vol >= vol_high:
            label = "High Volatility"
        else:
            label = "Trending"

        colors[str(new_id)] = regime_colors[new_id % len(regime_colors)]
        labels[str(new_id)] = label

    return relabeled, colors, labels, n_regimes
