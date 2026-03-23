"""State relabeling — DEPRECATED thin wrapper.

All logic has moved to ``shared.labeling``.  This module exists only for
backward compatibility.  Import from ``shared.labeling`` directly.
"""

import warnings

import numpy as np

from shared.labeling import renumber_states as _renumber, assign_colors as _colors, get_labeler


def relabel_states(states, X, regime_colors=None):
    """
    **Deprecated** — use ``renumber_states`` + ``get_labeler`` from
    ``shared.labeling`` instead.

    Returns (relabeled, colors, labels, n_regimes) for backward compat.
    """
    warnings.warn(
        "relabel_states() is deprecated. Use shared.labeling.renumber_states() "
        "and shared.labeling.get_labeler() instead.",
        DeprecationWarning,
        stacklevel=2,
    )
    renum = _renumber(states)
    relabeled = renum.states
    n_regimes = renum.n_regimes

    colors = _colors(n_regimes)

    # Use SimpleLabeler for backward-compat (matches old 7-label output)
    labeler = get_labeler("simple")
    ret_col = 0
    regime_means = np.array([
        float(np.mean(X[relabeled == rid, ret_col])) if np.any(relabeled == rid) else 0.0
        for rid in range(n_regimes)
    ])
    regime_vols = np.array([
        float(np.std(X[relabeled == rid, ret_col])) if np.any(relabeled == rid) else 0.0
        for rid in range(n_regimes)
    ])
    labeler.fit(regime_means, regime_vols)

    labels = {}
    for rid in range(n_regimes):
        mask = relabeled == rid
        regime_feats = X[mask]
        avg_ret = regime_means[rid]
        avg_vol = regime_vols[rid]
        pct = float(np.sum(mask)) / len(relabeled) * 100
        lr = labeler.label(rid, regime_feats, [], avg_ret, avg_vol, 0.0, pct)
        labels[str(rid)] = lr.label

    return relabeled, colors, labels, n_regimes
