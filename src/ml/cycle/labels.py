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

The price model's target (``price_target``) is the same forward move, NOT
thresholded (a zero move is a valid target), divided by a causal volatility:

    forward_move[t] = close[t + horizon] - close[t]         NaN past the data
    backward_move[k] = close[k] - close[k - horizon]        NaN for k < horizon
    scale[t] = max(std(backward_move[t-W+1 .. t], ddof=1), tick_size)
               NaN until all W backward moves in the window exist
               (min_periods = W; W = the features' lookback, 250)
    scaled_target[t] = forward_move[t] / scale[t]

``scale[t]`` reads closes <= t only, so the engine can multiply a prediction
made at bar t back into points at bar t. ``scaled_target[t]``, like the
direction label, is known only at bar t + horizon.
"""

from __future__ import annotations

import numpy as np


def median_bar_interval(timestamps: np.ndarray) -> float:
    """The typical spacing of the bars in seconds (the median gap), or NaN."""
    timestamps = np.asarray(timestamps, dtype=np.int64)
    if timestamps.shape[0] < 2:
        return float("nan")
    return float(np.median(np.diff(timestamps)))


def horizon_crosses_gap(timestamps: np.ndarray, horizon: int, gap_multiple: float) -> np.ndarray:
    """True at bar t when the ``horizon`` bars after it span a gap longer than
    ``gap_multiple`` typical bar intervals: a session break, a weekend, an
    outage. A 6-bar move that straddles a weekend is not a 30-minute move, so
    such a bar gets no label, no price target and no forecast. ``gap_multiple
    <= 0`` turns the rule off. The last ``horizon`` bars are False (they have
    no horizon at all; the label functions already leave them NaN)."""
    timestamps = np.asarray(timestamps, dtype=np.int64)
    n = timestamps.shape[0]
    crosses = np.zeros(n, dtype=bool)
    if gap_multiple <= 0 or n <= horizon or horizon < 1:
        return crosses
    typical = median_bar_interval(timestamps)
    if not np.isfinite(typical) or typical <= 0:
        return crosses
    limit = gap_multiple * typical
    gaps = np.diff(timestamps).astype(np.float64)           # gaps[t] = ts[t+1] - ts[t]
    wide = gaps > limit
    # bar t crosses a gap when any of gaps[t .. t+horizon-1] is wide
    counts = np.concatenate([[0], np.cumsum(wide)])         # counts[k] = wide gaps before index k
    head = counts[horizon:n] - counts[0:n - horizon]        # for t in 0..n-horizon-1
    crosses[: n - horizon] = head > 0
    return crosses


def make_labels(close: np.ndarray, horizon: int, threshold_ticks: float, tick_size: float,
                crosses_gap: np.ndarray | None = None) -> np.ndarray:
    """float32 labels, one per bar (see the module docstring). Bars whose
    horizon crosses a session gap (``crosses_gap``) are NaN, unlabelled."""
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
    if crosses_gap is not None:
        labels[np.asarray(crosses_gap, dtype=bool)] = np.nan
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


def forward_move(close: np.ndarray, horizon: int) -> np.ndarray:
    """close[t + horizon] - close[t] in points (float64); NaN past the data."""
    if horizon < 1:
        raise ValueError(f"label horizon must be >= 1 bar, got {horizon}")
    close = np.asarray(close, dtype=np.float64)
    move = np.full(close.shape[0], np.nan, dtype=np.float64)
    if close.shape[0] > horizon:
        move[: close.shape[0] - horizon] = close[horizon:] - close[:-horizon]
    return move


def move_scale(close: np.ndarray, horizon: int, window: int, tick_size: float) -> np.ndarray:
    """Causal trailing standard deviation (ddof=1) of the ``horizon``-bar moves
    ending at bars t-window+1..t, floored at one tick; NaN in the warmup."""
    if window < 2:
        raise ValueError(f"volatility window must be >= 2 bars, got {window}")
    if tick_size <= 0:
        raise ValueError(f"tick size must be > 0, got {tick_size}")
    import pandas as pd

    close = np.asarray(close, dtype=np.float64)
    backward = np.full(close.shape[0], np.nan, dtype=np.float64)
    if close.shape[0] > horizon:
        backward[horizon:] = close[horizon:] - close[:-horizon]
    deviation = pd.Series(backward).rolling(window=window, min_periods=window).std(ddof=1).to_numpy()
    scale = np.where(np.isfinite(deviation), np.maximum(deviation, float(tick_size)), np.nan)
    return scale.astype(np.float64)


def price_target(close: np.ndarray, horizon: int, window: int, tick_size: float,
                 crosses_gap: np.ndarray | None = None) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """(scaled_target float32, scale float64, forward_move float64) — see the
    module docstring. ``scaled_target`` is NaN wherever either part is, and at
    every bar whose horizon crosses a session gap (``crosses_gap``); the scale
    (a trailing statistic) is untouched by the gap rule."""
    move = forward_move(close, horizon)
    if crosses_gap is not None:
        move = move.copy()
        move[np.asarray(crosses_gap, dtype=bool)] = np.nan
    scale = move_scale(close, horizon, window, tick_size)
    with np.errstate(invalid="ignore", divide="ignore"):
        scaled = move / scale
    scaled[~np.isfinite(scaled)] = np.nan
    return scaled.astype(np.float32), scale, move
