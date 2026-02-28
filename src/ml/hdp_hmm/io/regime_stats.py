"""Regime analysis: statistics, classification, and feature importance."""

import numpy as np


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


def generate_regime_description(regime_features, feature_names, avg_return, avg_volatility, avg_duration, pct):
    """
    Classify regime by market structure using price features and swing structure.

    Returns (label, nickname) where:
      - label: Market structure type (e.g., "Bull Trend", "Choppy", "Breakout")
      - nickname: Numeric fingerprint (e.g., "+3.2bp/bar, 1.1% vol, 12-bar swings, 6-bar hold")
    """
    def _feat(name):
        if name in feature_names:
            return float(np.mean(regime_features[:, feature_names.index(name)]))
        return None

    ret1 = _feat("return_1")       # 1-bar return
    ret5 = _feat("return_5")       # 5-bar return
    ret20 = _feat("return_20")     # 20-bar return (trend)
    vol10 = _feat("volatility_10") # short vol
    vol50 = _feat("volatility_50") # long vol
    roc5 = _feat("roc_5")          # short momentum
    roc20 = _feat("roc_20")        # long momentum
    ma10 = _feat("ma_dist_10")     # distance from 10-bar MA
    ma50 = _feat("ma_dist_50")     # distance from 50-bar MA
    body = _feat("body_ratio")
    bar_range = _feat("bar_range")
    vol_ratio = _feat("volume_ratio_10")

    # Swing features (causal zigzag)
    swing_dir = _feat("swing_direction")
    swing_pct = _feat("swing_pct")
    swing_dur = _feat("swing_duration")
    swing_vel = _feat("swing_velocity")
    prev_swing_pct = _feat("prev_swing_pct")
    retrace = _feat("retracement_ratio")
    swing_count = _feat("swing_count_50")

    ret_bps = (ret1 or 0) * 10000
    vol_pct = avg_volatility * 100

    # ── Directional alignment: short vs long ──
    short_dir = 1 if (ret1 or 0) > 0 else -1
    long_dir = 1 if (ret20 or 0) > 0 else -1
    aligned = short_dir == long_dir
    trending = abs(ret_bps) > 1.5

    # Vol expansion/contraction (short vol vs long vol)
    vol_expanding = (vol10 is not None and vol50 is not None and vol10 > vol50 * 1.2)
    vol_contracting = (vol10 is not None and vol50 is not None and vol10 < vol50 * 0.8)

    # Momentum accelerating or decelerating
    accel = (roc5 is not None and roc20 is not None and
             abs(roc5) > abs(roc20) * 1.3 and
             (roc5 > 0) == (roc20 > 0))
    decel = (roc5 is not None and roc20 is not None and
             abs(roc5) < abs(roc20) * 0.6 and
             (roc5 > 0) == (roc20 > 0))

    # Extended from MA
    extended = (ma50 is not None and abs(ma50) > 0.01)

    # Volume surge
    vol_surge = (vol_ratio is not None and vol_ratio > 1.5)

    # ── Swing structure signals ──
    has_swing = swing_count is not None
    choppy = has_swing and swing_count is not None and swing_count > 8
    long_swings = has_swing and swing_dur is not None and swing_dur > 10
    big_swings = has_swing and swing_pct is not None and abs(swing_pct) > 0.005
    deep_retrace = has_swing and retrace is not None and retrace > 0.6
    shallow_retrace = has_swing and retrace is not None and retrace < 0.3

    # ── Label: market structure classification ──
    bull = short_dir > 0
    prefix = "Bull" if bull else "Bear"

    # Swing-aware classification (takes priority when swing features available)
    if has_swing and choppy and not trending:
        label = "Choppy"
    elif has_swing and choppy and vol_expanding:
        label = "Whipsaw"
    elif not aligned and trending and vol_expanding:
        label = f"{prefix} Reversal"
    elif not aligned and trending:
        label = f"{prefix} Reversal"
    elif aligned and vol_expanding and vol_surge and trending:
        label = f"{prefix} Breakout"
    elif aligned and vol_expanding and trending:
        label = f"{prefix} Breakout"
    elif has_swing and long_swings and big_swings and aligned:
        label = f"{prefix} Trend"
    elif aligned and accel:
        label = f"{prefix} Acceleration"
    elif aligned and decel and extended:
        label = f"{prefix} Exhaustion"
    elif has_swing and deep_retrace and trending:
        label = f"{prefix} Pullback"
    elif aligned and trending:
        label = f"{prefix} Continuation"
    elif vol_contracting and abs(ret_bps) < 1.0:
        label = "Compression"
    elif has_swing and shallow_retrace and not trending:
        label = "Coiling"
    elif abs(ret_bps) < 0.3 and vol_pct < 0.3:
        label = "Dead Zone"
    elif has_swing and choppy:
        label = "Range-Bound"
    elif abs(ret_bps) < 1.0:
        label = "Range-Bound"
    elif bull:
        label = f"{prefix} Drift"
    else:
        label = f"{prefix} Drift"

    # ── Nickname: real numbers ──
    ret_sign = "+" if ret_bps >= 0 else ""
    parts = [f"{ret_sign}{ret_bps:.1f}bp/bar"]
    parts.append(f"{vol_pct:.2f}% vol")

    if vol_expanding:
        parts.append("expanding vol")
    elif vol_contracting:
        parts.append("contracting vol")

    if bar_range is not None:
        parts.append(f"{bar_range * 100:.2f}% range")

    if body is not None:
        if body < 0.15:
            parts.append("doji bars")
        elif body > 0.7:
            parts.append("impulse bars")

    if vol_surge:
        parts.append(f"{vol_ratio:.1f}x vol")

    # Swing structure in nickname
    if has_swing and swing_dur is not None:
        parts.append(f"{swing_dur:.0f}-bar swings")
    if has_swing and swing_count is not None:
        parts.append(f"{swing_count:.0f} pivots/50bars")

    parts.append(f"{avg_duration:.0f}-bar hold")
    parts.append(f"{pct:.0f}% of data")

    nickname = ", ".join(parts)

    return label, nickname


# ── Regime Stats + Transitions ───────────────────────────────────────────────

def compute_regime_stats(relabeled, features, feature_names):
    """Compute full RegimeStat[] matching the UI interface."""
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

        # Label + nickname
        label, nickname = generate_regime_description(
            regime_feats, feature_names, avg_return, avg_volatility, avg_duration, pct
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
            "label": label,
            "nickname": nickname,
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
