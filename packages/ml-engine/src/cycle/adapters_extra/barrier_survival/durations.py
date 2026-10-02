"""Barrier-touch durations: the survival data every model of the family fits.

For a sampled bar r (every ``sampling_stride_bars``-th bar of the training
span) the two barriers sit at close[r] +/- b * move_scale[r] (b =
``barrier_distance``, move_scale the run's causal trailing standard deviation
of h-bar moves). Walking the closes after r, the duration is the first bar k
(1 <= k <= ``maximum_hold_bars``) whose close is at or beyond a barrier, and
the cause is which one (1 up, 2 down). The walk is CENSORED (cause 0, the
duration = the last bar watched) when it reaches

- the maximum hold,
- a session gap (the bar before the gap is the last one watched: a close
  across the break is a different market), or
- the fold limit ``limit_row`` = train_index[-1] + h: the training labels
  themselves resolve by that bar, and nothing after it is read.

A walk that watched no bar at all (r is the last bar before a gap or the
limit) is dropped. Only closes are read (``close``, ``move_scale`` and the gap
flags of the view), never open, high or low.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

CENSORED, UP, DOWN = 0, 1, 2


@dataclass(frozen=True)
class Durations:
    rows: np.ndarray        # int64 the sampled bars kept
    duration: np.ndarray    # int64 bars to the touch (cause 1 / 2) or to censoring (cause 0), >= 1
    cause: np.ndarray       # int64 0 censored, 1 up barrier first, 2 down barrier first

    def __len__(self) -> int:
        return int(self.rows.shape[0])

    def event(self, cause: int) -> np.ndarray:
        return (self.cause == cause).astype(np.int64)


def barrier_durations(view, rows: np.ndarray, barrier_distance: float, maximum_hold_bars: int,
                      limit_row: int) -> Durations:
    """Durations of ``rows`` (see the module docstring). ``limit_row`` is the last bar that may be read."""
    rows = np.asarray(rows, dtype=np.int64)
    close = np.asarray(view.close, dtype=np.float64)
    scale = np.asarray(view.move_scale, dtype=np.float64)
    gap_after = np.asarray(view.one_bar_crosses_gap, dtype=bool)
    hold = int(maximum_hold_bars)
    limit_row = min(int(limit_row), close.shape[0] - 1)
    rows = rows[(rows < limit_row) & np.isfinite(close[rows]) & np.isfinite(scale[rows]) & (scale[rows] > 0)]
    if rows.size == 0:
        empty = np.empty(0, dtype=np.int64)
        return Durations(empty, empty, empty)
    steps = np.arange(1, hold + 1)
    ahead = rows[:, None] + steps[None, :]                          # (m, hold): the bars watched
    inside = ahead <= limit_row
    ahead_clipped = np.minimum(ahead, limit_row)
    # a bar is watched only if no session gap lies between r and it: the gap after bar u is between u and u + 1
    gap_before = gap_after[np.minimum(ahead_clipped - 1, close.shape[0] - 1)]
    blocked = np.logical_or.accumulate(gap_before | ~inside, axis=1)
    watched = ~blocked
    move = close[ahead_clipped] - close[rows][:, None]
    width = barrier_distance * scale[rows][:, None]
    up = watched & (move >= width)
    down = watched & (move <= -width)
    touched = up | down
    any_touch = touched.any(axis=1)
    first = np.argmax(touched, axis=1)
    last_watched = watched.sum(axis=1)                              # bars watched before the walk stopped
    duration = np.where(any_touch, first + 1, last_watched).astype(np.int64)
    cause = np.where(any_touch, np.where(up[np.arange(rows.size), first], UP, DOWN), CENSORED).astype(np.int64)
    keep = duration >= 1
    return Durations(rows[keep], duration[keep], cause[keep])


def sampled_rows(train_rows: np.ndarray, stride: int) -> np.ndarray:
    """Every ``stride``-th bar of the training span, from its first bar."""
    return np.asarray(train_rows, dtype=np.int64)[:: max(1, int(stride))]


def trace_one(close: np.ndarray, scale: float, row: int, barrier_distance: float, maximum_hold_bars: int,
              limit_row: int, gap_after: np.ndarray) -> tuple[int, int]:
    """The same walk for one bar, one step at a time (the reference the tests compare against)."""
    width = barrier_distance * scale
    watched = 0
    for step in range(1, maximum_hold_bars + 1):
        bar = row + step
        if bar > limit_row or gap_after[bar - 1]:
            break
        watched = step
        move = close[bar] - close[row]
        if move >= width:
            return step, UP
        if move <= -width:
            return step, DOWN
    return watched, CENSORED
