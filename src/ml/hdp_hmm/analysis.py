"""
HDP-HMM Regime Analysis
=========================

Decode regimes and build personality profiles with auto-labeling.
"""

import numpy as np

from .model import StickyHDPHMM


def _auto_label_regime(
    ret_z: float,
    rng_z: float,
    _body_z: float,
    upper_wick_z: float,
    lower_wick_z: float,
    atr_z: float,
    _vol_ratio_z: float,
    trend_20_z: float,
    avg_duration: float,
    pct: float,
) -> tuple[str, str]:
    """
    Assign a meaningful label and nickname based on z-score feature profiles.
    All feature values are z-scores (mean=0, std=1), so thresholds are in
    units of standard deviations from the population mean.
    Returns (label, nickname).
    """
    # Extreme outlier (< 0.05% of data)
    if pct < 0.05:
        if ret_z < -2:
            return ("flash_crash", "Flash Crash")
        elif ret_z > 2:
            return ("flash_rally", "Flash Rally")
        return ("extreme_outlier", "Extreme Outlier")

    # Wick rejection signatures (dominant wick + small body)
    if lower_wick_z > 1.0 and abs(ret_z) < 0.3:
        return ("wick_rejection_low", "Lower Wick Rejection")
    if upper_wick_z > 1.0 and abs(ret_z) < 0.3:
        return ("wick_rejection_high", "Upper Wick Rejection")

    # Quiet consolidation (low ATR + near-neutral + sticky)
    if atr_z < -0.3 and abs(ret_z) < 0.2 and avg_duration > 3.0:
        if trend_20_z < -0.3:
            return ("bearish_rest", "Bearish Rest")
        elif trend_20_z > 0.3:
            return ("bullish_rest", "Bullish Rest")
        return ("quiet_consolidation", "Quiet Drift")

    # Strong bearish
    if ret_z < -1.5:
        suffix = " (Wide)" if rng_z > 1.5 else ""
        return ("strong_selloff", f"Strong Selloff{suffix}")
    if ret_z < -0.5:
        return ("selling", "Normal Selling")
    if ret_z < -0.1:
        if avg_duration > 2.5:
            return ("bearish_consolidation", "Bearish Consolidation")
        return ("mild_selling", "Mild Selling")

    # Strong bullish
    if ret_z > 1.5:
        suffix = " (Wide)" if rng_z > 1.5 else ""
        return ("strong_rally", f"Strong Rally{suffix}")
    if ret_z > 0.5:
        return ("buying", "Normal Buying")
    if ret_z > 0.1:
        if avg_duration > 2.5:
            return ("bullish_consolidation", "Bullish Consolidation")
        return ("mild_buying", "Mild Buying")

    # Near-neutral
    if atr_z > 0.8:
        return ("volatile_chop", "Volatile Chop")
    if avg_duration > 3.0:
        return ("quiet_range", "Quiet Range")
    return ("transitional", "Transitional")


def analyze_regimes(
    model: StickyHDPHMM,
    features: np.ndarray,
    feature_names: list[str],
    _timestamps: np.ndarray,
    close_prices: np.ndarray,
) -> dict:
    """
    Decode regimes and build personality profiles.
    """
    n_components = model.n_components
    state_sequence = model.predict(features)
    state_probs = model.predict_proba(features)
    transmat = model.transmat_.tolist() if model.transmat_ is not None else []

    # Compute actual per-bar returns from close prices (not z-scores)
    all_bar_returns = np.zeros(len(close_prices))
    all_bar_returns[1:] = np.diff(close_prices) / close_prices[:-1]

    regime_stats: list[dict] = []
    for k in range(n_components):
        mask = state_sequence == k
        count = int(mask.sum())
        pct = float(count / len(state_sequence)) * 100

        if count == 0:
            regime_stats.append(
                {
                    "regime_id": k,
                    "count": 0,
                    "pct": 0,
                    "avg_return": 0,
                    "avg_return_pct": 0,
                    "avg_volatility": 0,
                    "avg_range": 0,
                    "avg_atr_ratio": 0,
                    "avg_vol_ratio_5_20": 0,
                    "avg_duration": 0,
                    "max_duration": 0,
                    "median_duration": 0,
                    "label": f"regime_{k}",
                    "nickname": f"Regime {k}",
                    "volatility_state": "unknown",
                    "bar_character": "unknown",
                    "characteristics": {},
                }
            )
            continue

        regime_features = features[mask]
        feature_means: dict[str, float] = {}
        for i, name in enumerate(feature_names):
            feature_means[name] = float(np.mean(regime_features[:, i]))

        # Actual per-bar returns for this regime (from raw close prices)
        regime_bar_returns = all_bar_returns[mask]

        # Duration analysis
        durations: list[int] = []
        current_run = 0
        for s in state_sequence:
            if s == k:
                current_run += 1
            else:
                if current_run > 0:
                    durations.append(current_run)
                current_run = 0
        if current_run > 0:
            durations.append(current_run)
        avg_duration = float(np.mean(durations)) if durations else 0

        # Feature profiles for labeling (using universal z-scored feature names)
        ret_z = feature_means.get("log_return_z", 0)
        rng_z = feature_means.get("range_pct_z", 0)
        body_z = feature_means.get("body_pct_z", 0)
        upper_wick_z = feature_means.get("upper_wick_pct", 0)
        lower_wick_z = feature_means.get("lower_wick_pct", 0)
        atr_z = feature_means.get("atr_ratio", 0)
        vol_ratio_z = feature_means.get("vol_ratio_5_20", 0)
        trend_20_z = feature_means.get("trend_20_z", 0)

        # Auto-label using z-score profiles
        label, nickname = _auto_label_regime(
            ret_z,
            rng_z,
            body_z,
            upper_wick_z,
            lower_wick_z,
            atr_z,
            vol_ratio_z,
            trend_20_z,
            avg_duration,
            pct,
        )

        # Volatility state classification
        if atr_z > 1.0:
            volatility_state = "extreme"
        elif atr_z > 0.3:
            volatility_state = "high"
        elif atr_z > -0.3:
            volatility_state = "normal"
        elif atr_z > -0.6:
            volatility_state = "low"
        else:
            volatility_state = "quiet"

        # Bar character classification
        if rng_z > 1.5 and abs(body_z) > 1.5:
            bar_character = "wide_impulse"
        elif lower_wick_z > 1.0 and abs(body_z) < 0.3:
            bar_character = "hammer"
        elif upper_wick_z > 1.0 and abs(body_z) < 0.3:
            bar_character = "shooting_star"
        elif abs(body_z) < 0.15 and abs(rng_z) < 0.3:
            bar_character = "doji"
        elif rng_z > 1.0:
            bar_character = "wide_range"
        elif rng_z < -0.5 and abs(body_z) < 0.3:
            bar_character = "narrow_range"
        else:
            bar_character = "normal"

        regime_stats.append(
            {
                "regime_id": k,
                "count": count,
                "pct": round(pct, 2),
                "avg_return": round(float(ret_z), 6),
                "avg_return_pct": round(float(np.mean(regime_bar_returns)) * 100, 6),
                "avg_volatility": round(float(np.std(regime_bar_returns)) * 100, 6)
                if len(regime_bar_returns) > 1
                else 0,
                "avg_range": round(float(rng_z), 6),
                "avg_atr_ratio": round(float(atr_z), 4),
                "avg_vol_ratio_5_20": round(float(vol_ratio_z), 4),
                "avg_duration": round(avg_duration, 1),
                "max_duration": int(max(durations)) if durations else 0,
                "median_duration": round(float(np.median(durations)), 1)
                if durations
                else 0,
                "label": label,
                "nickname": nickname,
                "volatility_state": volatility_state,
                "bar_character": bar_character,
                "characteristics": {
                    k_name: round(v, 6) for k_name, v in feature_means.items()
                },
            }
        )

    # Sort by avg_return
    regime_stats.sort(key=lambda r: float(r["avg_return"]))
    id_remap = {r["regime_id"]: i for i, r in enumerate(regime_stats)}
    for i, r in enumerate(regime_stats):
        r["regime_id"] = i

    remapped_sequence = np.array([id_remap[s] for s in state_sequence])
    remapped_probs = state_probs[
        :, [k for k, _ in sorted(id_remap.items(), key=lambda x: x[1])]
    ]

    transitions: list[dict] = []
    for i in range(n_components):
        for j in range(n_components):
            val = transmat[i][j] if i < len(transmat) and j < len(transmat[i]) else 0
            if val > 0.01:
                ri, rj = id_remap.get(i, i), id_remap.get(j, j)
                transitions.append({"from": ri, "to": rj, "probability": round(val, 4)})

    return {
        "state_sequence": remapped_sequence,
        "state_probs": remapped_probs,
        "regime_stats": regime_stats,
        "transitions": transitions,
        "n_components": n_components,
    }
