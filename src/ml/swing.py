"""
Swing ZigZag — causal bar-by-bar swing detection and feature extraction.

Port of computeSwingZigZag() from client/src/lib/chartOverlays.ts, redesigned
to be strictly CAUSAL: features at bar i use only information available at bar i.

Lookahead-bias prevention:
  A swing pivot at bar t (e.g. the highest high) is only CONFIRMED when a
  reversal is detected at bar t+k (k >= 1). Features at bars t through t+k-1
  must NOT use this pivot — it wasn't known yet. Only at bar t+k (the
  confirmation bar) do we add it to the confirmed pivot list.

  This means bars between a pivot and its confirmation still reference the
  PREVIOUS pivot, which is correct — at those bars, the trader doesn't yet
  know the swing has ended.

Eight per-bar features:
  swing_direction     +1 (up-swing from low pivot) or -1 (down-swing from high)
  swing_pct           cumulative % move from last confirmed pivot to current close
  swing_duration      bars since last confirmed pivot
  swing_velocity      swing_pct / duration (rate of swing move per bar)
  prev_swing_pct      previous completed swing's magnitude (%)
  prev_swing_duration previous completed swing's duration (bars)
  retracement_ratio   |current swing| / |previous swing|  (Fibonacci-like)
  swing_count_50      confirmed pivots in rolling 50-bar window (choppiness measure)
"""

import numpy as np


def compute_swing_features(
    high: np.ndarray,
    low: np.ndarray,
    close: np.ndarray,
) -> dict[str, np.ndarray]:
    """
    Compute 8 per-bar swing features, strictly causal (no lookahead).

    Processes bars left-to-right. At each bar:
      1. Run zigzag reversal detection (same logic as TypeScript)
      2. If reversal detected, confirm the pivot and add to confirmed list
      3. Compute features using ONLY confirmed pivots

    Args:
        high:  1-D float64 array of high prices
        low:   1-D float64 array of low prices
        close: 1-D float64 array of close prices

    Returns:
        dict mapping feature_name → numpy array of shape (n,)
    """
    n = len(high)
    names = [
        "swing_direction", "swing_pct", "swing_duration", "swing_velocity",
        "prev_swing_pct", "prev_swing_duration", "retracement_ratio",
        "swing_count_50",
    ]
    features = {name: np.zeros(n, dtype=np.float64) for name in names}

    if n < 3:
        return features

    # ── Zigzag state (causal, bar-by-bar) ──────────────────────────────────

    # Each confirmed pivot: (pivot_bar, pivot_price, pivot_type, confirmation_bar)
    # pivot_type: +1 = swing high, -1 = swing low
    confirmed: list[tuple[int, float, int, int]] = []

    last_high = high[0]
    last_high_idx = 0
    last_low = low[0]
    last_low_idx = 0
    direction = 0  # 0 = undecided, 1 = up, -1 = down

    for i in range(1, n):
        new_pivot = None

        if direction == 0:
            if high[i] > last_high:
                direction = 1
                new_pivot = (last_low_idx, float(last_low), -1, i)
                last_high = high[i]
                last_high_idx = i
            elif low[i] < last_low:
                direction = -1
                new_pivot = (last_high_idx, float(last_high), +1, i)
                last_low = low[i]
                last_low_idx = i
            else:
                if high[i] > last_high:
                    last_high = high[i]
                    last_high_idx = i
                if low[i] < last_low:
                    last_low = low[i]
                    last_low_idx = i

        elif direction == 1:  # currently in an up-swing
            if high[i] >= last_high:
                # Continue up — extend current high
                last_high = high[i]
                last_high_idx = i
            elif low[i] < low[i - 1]:
                # Reversal: bar made lower low than previous bar
                # Confirm the swing high pivot (detected NOW at bar i)
                new_pivot = (last_high_idx, float(last_high), +1, i)
                direction = -1
                last_low = low[i]
                last_low_idx = i

        else:  # direction == -1, currently in a down-swing
            if low[i] <= last_low:
                # Continue down — extend current low
                last_low = low[i]
                last_low_idx = i
            elif high[i] > high[i - 1]:
                # Reversal: bar made higher high than previous bar
                # Confirm the swing low pivot (detected NOW at bar i)
                new_pivot = (last_low_idx, float(last_low), -1, i)
                direction = 1
                last_high = high[i]
                last_high_idx = i

        if new_pivot is not None:
            confirmed.append(new_pivot)

        # ── Compute features at bar i using ONLY confirmed pivots ──────────

        n_conf = len(confirmed)
        if n_conf == 0:
            continue

        last_piv = confirmed[-1]
        piv_bar, piv_price, piv_type, _ = last_piv

        # Direction: after a low pivot (-1) we swing up (+1); after high (+1) we swing down (-1)
        features["swing_direction"][i] = float(-piv_type)

        # Duration: bars since last confirmed pivot
        dur = i - piv_bar
        features["swing_duration"][i] = float(dur)

        # Magnitude: current close vs pivot price (signed %)
        if piv_price > 0:
            features["swing_pct"][i] = (close[i] - piv_price) / piv_price

        # Velocity: % per bar
        if dur > 0:
            features["swing_velocity"][i] = features["swing_pct"][i] / dur

        # Previous completed swing (from confirmed[-2] to confirmed[-1])
        if n_conf >= 2:
            prev_piv = confirmed[-2]
            if prev_piv[1] > 0:
                features["prev_swing_pct"][i] = (piv_price - prev_piv[1]) / prev_piv[1]
            features["prev_swing_duration"][i] = float(piv_bar - prev_piv[0])

        # Retracement ratio: |current| / |previous|
        prev_mag = abs(features["prev_swing_pct"][i])
        curr_mag = abs(features["swing_pct"][i])
        if prev_mag > 1e-10:
            features["retracement_ratio"][i] = curr_mag / prev_mag

    # ── Swing count in rolling 50-bar window (uses confirmation bars) ──────

    if confirmed:
        conf_bars = np.array([p[3] for p in confirmed])  # sorted by construction
        for i in range(n):
            lo = int(np.searchsorted(conf_bars, max(0, i - 50), side="left"))
            hi = int(np.searchsorted(conf_bars, i, side="right"))
            features["swing_count_50"][i] = float(hi - lo)

    return features
