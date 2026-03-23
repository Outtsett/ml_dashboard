"""Regime analysis: statistics, classification, and feature importance.

Label logic has been moved to ``shared.labeling`` (Strategy pattern).
This module computes **statistics only** and delegates labeling to an
injected ``RegimeLabeler``.
"""

import numpy as np

from shared.labeling import RegimeLabeler, get_labeler


# ── Helpers ──────────────────────────────────────────────────────────────────

def compute_run_lengths(states, regime_id):
    """Collect lengths of consecutive runs of a specific regime."""
    runs = []
    current_run = 0
    for s in states:
        if s == regime_id:
            current_run += 1
        else:
            if current_run > 0:
                runs.append(current_run)
            current_run = 0
    if current_run > 0:
        runs.append(current_run)
    return runs


def classify_volatility(vol, all_vols):
    """Classify regime volatility into state categories based on percentile rank."""
    if len(all_vols) < 2:
        return "normal"
    rank = np.searchsorted(np.sort(all_vols), vol) / len(all_vols)
    if rank >= 0.90:
        return "extreme"
    if rank >= 0.75:
        return "high"
    if rank <= 0.10:
        return "quiet"
    if rank <= 0.25:
        return "low"
    return "normal"


def classify_bar_character(regime_features, feature_names):
    """Classify the dominant bar shape in a regime from structural features."""
    def _get_mean(name):
        if name in feature_names:
            idx = feature_names.index(name)
            return float(np.mean(regime_features[:, idx]))
        return None

    body = _get_mean("body_ratio")
    upper = _get_mean("upper_shadow")
    lower = _get_mean("lower_shadow")
    bar_range = _get_mean("bar_range")

    if body is not None and body < 0.15:
        return "doji"
    if lower is not None and lower > 0.5:
        return "hammer"
    if upper is not None and upper > 0.5:
        return "shooting_star"
    if bar_range is not None and body is not None:
        if bar_range > 0.02 and body > 0.7:
            return "wide_impulse"
        if bar_range > 0.015:
            return "wide_range"
        if bar_range < 0.003:
            return "narrow_range"
    return "normal"


def compute_feature_importance(regime_X, global_X, feature_names):
    """
    Emission parameter z-scores: Bayesian analog of SHAP for unsupervised models.

    For each feature, computes how much the regime's mean differs from the global
    mean relative to global spread. Features with high |z| are the most "defining".

    Returns dict {feature_name: z_score} (top 10 by absolute value).
    """
    global_mean = np.mean(global_X, axis=0)
    global_std = np.std(global_X, axis=0)
    global_std = np.where(global_std < 1e-10, 1.0, global_std)

    regime_mean = np.mean(regime_X, axis=0)
    z_scores = (regime_mean - global_mean) / global_std

    # Return top 10 by absolute z-score
    indices = np.argsort(-np.abs(z_scores))[:10]
    return {feature_names[i]: round(float(z_scores[i]), 4) for i in indices}


# ── Regime Stats + Transitions ───────────────────────────────────────────────

def compute_regime_stats(relabeled, features, feature_names, labeler=None):
    """Compute full RegimeStat[] matching the UI interface.

    Args:
        relabeled:     1-D array of contiguous regime IDs.
        features:      2-D feature matrix (T × D).
        feature_names: Ordered feature names.
        labeler:       Optional RegimeLabeler (defaults to StructuralLabeler).
    """
    if labeler is None:
        labeler = get_labeler("structural")

    T = len(relabeled)
    unique_regimes = sorted(np.unique(relabeled))

    # Pre-compute all regime volatilities for percentile-based classification
    all_vols = []
    for rid in unique_regimes:
        mask = relabeled == rid
        regime_feats = features[mask]
        if regime_feats.shape[0] > 0 and regime_feats.shape[1] > 0:
            all_vols.append(float(np.std(regime_feats[:, 0])))
        else:
            all_vols.append(0.0)

    stats = []
    for i, regime_id in enumerate(unique_regimes):
        mask = relabeled == regime_id
        count = int(np.sum(mask))
        pct = round(count / T * 100, 2)

        regime_feats = features[mask]
        ret_col = 0  # return_1 is first feature

        avg_return = float(np.mean(regime_feats[:, ret_col])) if count > 0 else 0.0
        avg_volatility = float(np.std(regime_feats[:, ret_col])) if count > 0 else 0.0

        # Bar range
        range_idx = feature_names.index("bar_range") if "bar_range" in feature_names else -1
        avg_range = float(np.mean(regime_feats[:, range_idx])) if range_idx >= 0 and count > 0 else 0.0

        # ATR ratio (short vol / long vol)
        vol10_idx = feature_names.index("volatility_10") if "volatility_10" in feature_names else -1
        vol20_idx = feature_names.index("volatility_20") if "volatility_20" in feature_names else -1
        if vol10_idx >= 0 and vol20_idx >= 0 and count > 0:
            v10 = float(np.mean(regime_feats[:, vol10_idx]))
            v20 = float(np.mean(regime_feats[:, vol20_idx]))
            avg_atr_ratio = round(v10 / (v20 + 1e-10), 4)
        else:
            avg_atr_ratio = 1.0

        # Duration stats
        runs = compute_run_lengths(relabeled, regime_id)
        avg_duration = round(float(np.mean(runs)), 1) if runs else 0.0
        max_duration = int(np.max(runs)) if runs else 0

        # Volatility state
        volatility_state = classify_volatility(avg_volatility, all_vols)

        # Bar character
        bar_character = classify_bar_character(regime_feats, feature_names) if count > 0 else "unknown"

        # Feature importance (z-scores)
        characteristics = compute_feature_importance(regime_feats, features, feature_names) if count > 0 else {}

        # Label + nickname via injected labeler (Strategy pattern)
        label_result = labeler.label(
            regime_id, regime_feats, feature_names,
            avg_return, avg_volatility, avg_duration, pct,
        )

        stats.append({
            "regime_id": int(regime_id),
            "count": count,
            "pct": pct,
            "avg_return": round(avg_return, 6),
            "avg_return_pct": round(avg_return * 100, 4),
            "avg_volatility": round(avg_volatility, 6),
            "avg_range": round(avg_range, 6),
            "avg_atr_ratio": avg_atr_ratio,
            "avg_duration": avg_duration,
            "max_duration": max_duration,
            "label": label_result.label,
            "nickname": label_result.nickname,
            "category": label_result.category,
            "volatility_state": volatility_state,
            "bar_character": bar_character,
            "characteristics": characteristics,
        })

    # Deduplicate labels — number them if two regimes share the same short tag
    _deduplicate_labels(stats)

    return stats


def _deduplicate_labels(stats):
    """Number duplicate labels (e.g., 'Choppy' → 'Choppy 1', 'Choppy 2')."""
    from collections import Counter
    counts = Counter(s["label"] for s in stats)
    dupes = {name for name, cnt in counts.items() if cnt > 1}
    if not dupes:
        return
    for dupe_label in dupes:
        group = [s for s in stats if s["label"] == dupe_label]
        # Sort by pct descending so #1 is the most common
        group.sort(key=lambda s: s["pct"], reverse=True)
        for i, s in enumerate(group):
            s["label"] = f"{dupe_label} {i + 1}"


def compute_transitions(transition_matrix, n_regimes, threshold=0.01):
    """Convert transition matrix to flat array, filtering tiny probabilities."""
    transitions = []
    for i in range(n_regimes):
        for j in range(n_regimes):
            prob = float(transition_matrix[i][j])
            if prob >= threshold:
                transitions.append({"from": i, "to": j, "probability": round(prob, 4)})
    return transitions
