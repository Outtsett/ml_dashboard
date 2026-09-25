"""Direction labels for the Model Cycle.

The label of bar t is the sign of the forward move over ``horizon`` bars:

    move[t] = close[t + horizon] - close[t]
    label[t] = 1.0   if move[t] >  threshold_ticks * tick_size
               0.0   if move[t] < -threshold_ticks * tick_size
               NaN   otherwise (inside the threshold — with threshold 0 an
                     exactly-zero move — or t + horizon past the data)

The label of bar t becomes KNOWN at bar t + horizon (``label_known_index``);
the engine purges ``horizon`` bars between spans so no training label resolves
inside a later span.
"""

from __future__ import annotations

import numpy as np


def make_labels(close: np.ndarray, horizon: int, threshold_ticks: float, tick_size: float) -> np.ndarray:
    """float32 labels, one per bar (see the module docstring)."""
    if horizon < 1:
        raise ValueError(f"label horizon must be >= 1 bar, got {horizon}")
    if threshold_ticks < 0:
        raise ValueError(f"label threshold must be >= 0 ticks, got {threshold_ticks}")
    close = np.asarray(close, dtype=np.float64)
    n = close.shape[0]
    labels = np.full(n, np.nan, dtype=np.float32)
    if n <= horizon:
        return labels
    move = close[horizon:] - close[:-horizon]
    threshold = float(threshold_ticks) * float(tick_size)
    head = labels[: n - horizon]
    head[move > threshold] = 1.0
    head[move < -threshold] = 0.0
    return labels


def actual_direction(close: np.ndarray, index: int, horizon: int, threshold_ticks: float, tick_size: float) -> int:
    """1 up, -1 down, 0 inside the threshold, for bar ``index`` (needs index + horizon in range)."""
    move = float(close[index + horizon]) - float(close[index])
    threshold = float(threshold_ticks) * float(tick_size)
    if move > threshold:
        return 1
    if move < -threshold:
        return -1
    return 0


def label_known_index(index: int | np.ndarray, horizon: int):
    """The bar at which the label of ``index`` becomes known."""
    return index + horizon
