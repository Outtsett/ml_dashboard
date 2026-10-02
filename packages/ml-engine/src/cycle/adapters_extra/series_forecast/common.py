"""What the five series models share: the return series, the bar clock and the
P(up) / price-target conversions.

Every series model reads the bar-return series of the bound
``cycle.market.MarketView`` (``one_bar_returns()``: log return of each close
over the previous one, NaN across a session gap), never the feature row
(Prophet is the exception, see ``additive.py``). The fit reads the returns of
the training span only (``view.fit_rows(train_index)``); the forecast at bar t
reads returns up to t, so a filter run once over every row of the view is
causal row by row.

A model's forecast at bar t is the h-bar cumulative log return
``mean`` and its standard deviation ``spread``:

- P(up) = Phi(mean / spread), the probability the h-bar move is positive under
  the model's own Gaussian forecast (GARCH replaces it by the share of
  simulated paths);
- the price target (the engine's h-bar move divided by the bar's causal move
  scale) = close_t * (exp(mean) - 1) / move_scale_t.
"""

from __future__ import annotations

import math

import numpy as np
from scipy.special import ndtr

SECONDS_PER_DAY = 86_400


def returns_of(view) -> np.ndarray:
    """float64 one-bar log returns of the view (NaN at row 0 and across session gaps)."""
    return np.asarray(view.one_bar_returns(), dtype=np.float64)


def fit_span(view, train_index: np.ndarray) -> np.ndarray:
    """The contiguous rows of the training span (``view.fit_rows``)."""
    rows = view.fit_rows(train_index)
    if rows.size < 2:
        raise ValueError("the training span is shorter than two bars")
    return rows


def bar_interval_seconds(timestamps: np.ndarray, rows: np.ndarray) -> float:
    """The median positive step between consecutive timestamps of ``rows``."""
    stamps = np.asarray(timestamps, dtype=np.int64)[rows]
    steps = np.diff(stamps)
    steps = steps[steps > 0]
    if steps.size == 0:
        raise ValueError("the training span has no positive time step")
    return float(np.median(steps))


def session_period_bars(view, rows: np.ndarray, interval_seconds: float) -> int:
    """Bars in one session: the median length of the complete sessions inside
    ``rows`` (a session ends where ``one_bar_crosses_gap`` is set), or one
    calendar day of bars when the span holds fewer than two complete sessions."""
    breaks = np.flatnonzero(np.asarray(view.one_bar_crosses_gap, dtype=bool)[rows[:-1]])
    lengths = np.diff(breaks)
    if lengths.size >= 1:
        return max(2, int(round(float(np.median(lengths)))))
    return max(2, int(round(SECONDS_PER_DAY / interval_seconds)))


def time_of_day_slot(timestamps: np.ndarray, interval_seconds: float) -> np.ndarray:
    """int64 slot of each timestamp within its calendar day, one slot per bar interval."""
    interval = max(1, int(round(interval_seconds)))
    return (np.asarray(timestamps, dtype=np.int64) % SECONDS_PER_DAY) // interval


def slot_count(interval_seconds: float) -> int:
    interval = max(1, int(round(interval_seconds)))
    return int(math.ceil(SECONDS_PER_DAY / interval))


def up_probability(mean: np.ndarray, spread: np.ndarray) -> np.ndarray:
    """Phi(mean / spread); NaN where either is missing or the spread is not positive."""
    mean = np.asarray(mean, dtype=np.float64)
    spread = np.asarray(spread, dtype=np.float64)
    out = np.full(mean.shape, np.nan)
    usable = np.isfinite(mean) & np.isfinite(spread) & (spread > 0)
    out[usable] = ndtr(mean[usable] / spread[usable])
    return out


def scaled_move(view, rows: np.ndarray, mean: np.ndarray) -> np.ndarray:
    """The forecast h-bar move in the engine's price-target units:
    close_t * (exp(mean) - 1) / move_scale_t."""
    rows = np.asarray(rows, dtype=np.int64)
    close = np.asarray(view.close, dtype=np.float64)[rows]
    scale = np.asarray(view.move_scale, dtype=np.float64)[rows]
    with np.errstate(invalid="ignore", divide="ignore", over="ignore"):
        value = close * np.expm1(np.asarray(mean, dtype=np.float64)) / scale
    value[~np.isfinite(value)] = np.nan
    return value


def realised_log_move(view, rows: np.ndarray) -> np.ndarray:
    """log close[r + h] - log close[r] for ``rows`` (a fit-time quantity: the
    caller passes only rows whose horizon ends inside what the fit may read);
    NaN where the horizon crosses a session gap or leaves the view."""
    rows = np.asarray(rows, dtype=np.int64)
    horizon = int(view.horizon)
    close = np.asarray(view.close, dtype=np.float64)
    out = np.full(rows.shape, np.nan)
    inside = rows + horizon < close.shape[0]
    start, end = close[rows[inside]], close[rows[inside] + horizon]
    with np.errstate(invalid="ignore", divide="ignore"):
        out[inside] = np.log(end / start)
    out[np.asarray(view.crosses_gap, dtype=bool)[rows]] = np.nan
    out[~np.isfinite(out)] = np.nan
    return out
