"""Triple barrier label generation (Lopez de Prado, 2018).

Labels each bar with the outcome of a hypothetical trade:
  +1 = take-profit hit first
  -1 = stop-loss hit first
   0 = vertical barrier (timeout) reached first

Barriers are ATR-scaled with parameterized multipliers.
All parameters are HPO-tunable.
"""

from __future__ import annotations

import numpy as np
from numba import njit


@njit
def compute_atr(
    high: np.ndarray,
    low: np.ndarray,
    close: np.ndarray,
    period: int,
) -> np.ndarray:
    """Wilder's ATR. Returns NaN for first period-1 bars (warmup).

    Bar at index period-1 has the SMA seed value.
    Subsequent bars use EMA smoothing with alpha = 1/period.
    """
    n = len(close)
    tr = np.empty(n)
    tr[0] = high[0] - low[0]
    for i in range(1, n):
        hl = high[i] - low[i]
        hpc = abs(high[i] - close[i - 1])
        lpc = abs(low[i] - close[i - 1])
        tr[i] = max(hl, max(hpc, lpc))

    atr = np.full(n, np.nan)
    if n < period:
        return atr

    # SMA seed
    sma_sum = 0.0
    for i in range(period):
        sma_sum += tr[i]
    atr[period - 1] = sma_sum / period

    # EMA smoothing
    alpha = 1.0 / period
    for i in range(period, n):
        atr[i] = atr[i - 1] * (1.0 - alpha) + tr[i] * alpha

    return atr


@njit
def _barrier_walk(
    close: np.ndarray,
    high: np.ndarray,
    low: np.ndarray,
    open_: np.ndarray,
    atr: np.ndarray,
    tp_mult: float,
    sl_mult: float,
    vertical_bars: int,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Numba-compiled inner loop for barrier label assignment.

    For each bar i with valid ATR, walks forward up to vertical_bars
    to determine which barrier is hit first.

    Returns:
        labels: +1 (TP), -1 (SL), 0 (timeout), NaN (no label)
        exit_bars: absolute index of exit bar (NaN if no label)
        barrier_types: 1=TP, -1=SL, 0=VERT (NaN if no label)
        returns_at_exit: close[exit] - close[entry] (NaN if no label)
    """
    n = len(close)
    labels = np.full(n, np.nan)
    exit_bars = np.full(n, np.nan)
    barrier_types = np.full(n, np.nan)
    returns_at_exit = np.full(n, np.nan)

    for i in range(n):
        if np.isnan(atr[i]):
            continue

        upper = close[i] + tp_mult * atr[i]
        lower = close[i] - sl_mult * atr[i]
        deadline = min(i + vertical_bars, n - 1)

        # Need at least one forward bar
        if i + 1 > deadline:
            continue

        found = False
        for j in range(i + 1, deadline + 1):
            hit_upper = high[j] >= upper
            hit_lower = low[j] <= lower

            if hit_upper and hit_lower:
                # Same-bar dual hit: resolve by open direction
                if open_[j] >= close[i]:
                    labels[i] = 1.0
                    barrier_types[i] = 1.0
                else:
                    labels[i] = -1.0
                    barrier_types[i] = -1.0
                exit_bars[i] = float(j)
                returns_at_exit[i] = close[j] - close[i]
                found = True
                break
            elif hit_upper:
                labels[i] = 1.0
                exit_bars[i] = float(j)
                barrier_types[i] = 1.0
                returns_at_exit[i] = close[j] - close[i]
                found = True
                break
            elif hit_lower:
                labels[i] = -1.0
                exit_bars[i] = float(j)
                barrier_types[i] = -1.0
                returns_at_exit[i] = close[j] - close[i]
                found = True
                break

        if not found:
            # Vertical barrier (timeout)
            labels[i] = 0.0
            exit_bars[i] = float(deadline)
            barrier_types[i] = 0.0
            returns_at_exit[i] = close[deadline] - close[i]

    return labels, exit_bars, barrier_types, returns_at_exit


def generate_triple_barrier_labels(
    close: np.ndarray,
    high: np.ndarray,
    low: np.ndarray,
    open_: np.ndarray,
    atr_period: int = 14,
    tp_multiplier: float = 2.0,
    sl_multiplier: float = 2.0,
    vertical_bars: int = 60,
) -> dict[str, np.ndarray]:
    """Generate triple barrier labels for every bar.

    Args:
        close, high, low, open_: OHLC price arrays (float64).
        atr_period: lookback for ATR computation.
        tp_multiplier: take-profit distance in ATRs above entry close.
        sl_multiplier: stop-loss distance in ATRs below entry close.
        vertical_bars: max bars to hold before timeout.

    Returns:
        dict with keys:
            labels: +1 (TP hit), -1 (SL hit), 0 (timeout), NaN (warmup/tail)
            exit_bars: absolute bar index where trade exits
            barrier_types: which barrier was hit (1, -1, 0)
            atr_at_entry: ATR value at each bar
            returns_at_exit: close[exit] - close[entry]
    """
    atr = compute_atr(high, low, close, atr_period)

    labels, exit_bars, barrier_types, returns_at_exit = _barrier_walk(
        close, high, low, open_, atr,
        tp_multiplier, sl_multiplier, vertical_bars,
    )

    return {
        "labels": labels,
        "exit_bars": exit_bars,
        "barrier_types": barrier_types,
        "atr_at_entry": atr,
        "returns_at_exit": returns_at_exit,
    }
