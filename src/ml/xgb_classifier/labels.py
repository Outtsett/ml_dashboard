"""
Triple-barrier-style binary direction labels with embargo.

For each bar t we look forward `horizon_bars` and label:
    1 if the +barrier is touched strictly before the -barrier
    0 if the -barrier is touched strictly before the +barrier
   -1 (drop) otherwise — neither barrier touched within the horizon, or both
      touched inside the SAME forward bar (with only high/low we cannot know
      which came first, so the bar is dropped rather than guessed)

This is the Lopez de Prado meta-labeling scheme reduced to direction-only.

--- Barrier width: volatility-scaled by default -------------------------------

A barrier quoted as a fixed number of basis points is only meaningful relative
to how far the instrument actually travels in one bar. 5 bp is a real barrier
on a 1-minute MNQ bar and is noise on a daily one: the median MNQ daily bar
spans ~154 bp, so a +/-5 bp barrier is touched on BOTH sides inside forward bar
1 and the sample is dropped as a tie. Measured on MNQ 1d, 2019-05..2025-12:
a fixed 5 bp barrier keeps 303 of 2,074 bars (14.6%); an ATR-scaled barrier
keeps ~1,950 (94%). Lowering a fixed threshold makes this strictly WORSE,
because a narrower barrier is tied even more often.

So the default barrier is ``atr_multiple * trailing ATR``, expressed in bp at
each bar. That is timeframe-agnostic and regime-adaptive, and it is strictly
causal: the ATR at bar i is Wilder's true range averaged over bars
i-window+1 ... i, with ``min_periods == window`` — the first ``window`` bars
are NaN (never zero) and are dropped, never imputed. Nothing after bar i is
read.

``threshold_mode="fixed_bp"`` restores the old constant-bp behaviour verbatim.
In ``"atr"`` mode ``threshold_bp`` acts as an absolute FLOOR on the barrier, so
a tick-scale floor can be kept without capping the barrier on slow timeframes.

To kill train->test leakage, we additionally embargo the last `horizon_bars`
samples from train when splitting, so the train labels' look-ahead windows
cannot peek into the test set.

Implementation note: vectorized numpy with a numba JIT inner loop; ~50x faster
than a pandas apply on 2M-row data.
"""

from __future__ import annotations

import numpy as np
from numba import njit


@njit(cache=True)
def _barrier_label(
    high: np.ndarray,
    low: np.ndarray,
    close: np.ndarray,
    horizon: int,
    threshold_bp: np.ndarray,
):
    """Label each bar against its own barrier width.

    Returns
    -------
    out : int8 (N,)   1 up, 0 down, -1 dropped
    why : int8 (N,)   0 labelled, 1 horizon overflow, 2 bad close,
                      3 barrier warmup/NaN, 4 neither barrier touched,
                      5 both barriers touched inside the same forward bar
    """
    n = close.shape[0]
    out = np.empty(n, dtype=np.int8)
    why = np.zeros(n, dtype=np.int8)

    for i in range(n):
        if i + horizon >= n:
            out[i] = -1
            why[i] = 1
            continue
        c0 = close[i]
        if c0 <= 0 or not np.isfinite(c0):
            out[i] = -1
            why[i] = 2
            continue
        thr_bp = threshold_bp[i]
        # Warmup of the trailing volatility window is NaN, never zero — such a
        # bar has no barrier yet and is dropped rather than given a made-up one.
        if not np.isfinite(thr_bp) or thr_bp <= 0.0:
            out[i] = -1
            why[i] = 3
            continue
        thr = thr_bp / 10000.0
        up_target = c0 * (1.0 + thr)
        dn_target = c0 * (1.0 - thr)

        up_hit = -1
        dn_hit = -1
        for j in range(1, horizon + 1):
            k = i + j
            if up_hit < 0 and high[k] >= up_target:
                up_hit = j
            if dn_hit < 0 and low[k] <= dn_target:
                dn_hit = j
            if up_hit > 0 and dn_hit > 0:
                break

        if up_hit > 0 and (dn_hit < 0 or up_hit < dn_hit):
            out[i] = 1
        elif dn_hit > 0 and (up_hit < 0 or dn_hit < up_hit):
            out[i] = 0
        else:
            out[i] = -1
            why[i] = 5 if (up_hit > 0 and dn_hit > 0) else 4
    return out, why


@njit(cache=True)
def _true_range(high: np.ndarray, low: np.ndarray, close: np.ndarray) -> np.ndarray:
    """Wilder true range. Bar 0 is NaN — it has no previous close."""
    n = close.shape[0]
    tr = np.empty(n, dtype=np.float64)
    tr[0] = np.nan
    for i in range(1, n):
        prev = close[i - 1]
        a = high[i] - low[i]
        b = abs(high[i] - prev)
        c = abs(low[i] - prev)
        m = a
        if b > m:
            m = b
        if c > m:
            m = c
        tr[i] = m
    return tr


def trailing_atr_bp(
    high: np.ndarray,
    low: np.ndarray,
    close: np.ndarray,
    window: int = 20,
) -> np.ndarray:
    """Causal trailing ATR at each bar, expressed in basis points of that close.

    Trailing only: the value at bar i averages the true ranges of bars
    i-window+1 ... i inclusive. ``min_periods == window`` — bars 0 ... window-1
    are NaN (bar 0 has no previous close, so the first complete window ends at
    bar ``window``). No centring, no whole-series statistic, no zero-fill.
    """
    if window < 1:
        raise ValueError(f"atr_window must be >= 1, got {window}")
    h = np.ascontiguousarray(high, dtype=np.float64)
    low_arr = np.ascontiguousarray(low, dtype=np.float64)
    c = np.ascontiguousarray(close, dtype=np.float64)
    tr = _true_range(h, low_arr, c)

    n = tr.shape[0]
    atr = np.full(n, np.nan, dtype=np.float64)
    if n > window:
        # Cumulative sum over tr[1:]; tr[0] is NaN by construction and excluded.
        cs = np.concatenate((np.zeros(1, dtype=np.float64), np.cumsum(tr[1:])))
        # atr[i] covers tr[i-window+1 .. i]; needs i-window+1 >= 1, i.e. i >= window
        idx = np.arange(window, n)
        atr[idx] = (cs[idx] - cs[idx - window]) / float(window)

    with np.errstate(divide="ignore", invalid="ignore"):
        out = np.where(c > 0, atr / c * 10000.0, np.nan)
    return out


def resolve_threshold_bp(
    high: np.ndarray,
    low: np.ndarray,
    close: np.ndarray,
    *,
    threshold_mode: str = "atr",
    threshold_bp: float | None = None,
    atr_window: int = 20,
    atr_multiple: float = 1.0,
) -> np.ndarray:
    """Per-bar barrier width in bp. See the module docstring for the rationale."""
    c = np.ascontiguousarray(close, dtype=np.float64)
    if threshold_mode == "fixed_bp":
        if threshold_bp is None or threshold_bp <= 0:
            raise ValueError("threshold_mode='fixed_bp' needs threshold_bp > 0")
        return np.full(c.shape[0], float(threshold_bp), dtype=np.float64)
    if threshold_mode != "atr":
        raise ValueError(f"threshold_mode must be 'atr' or 'fixed_bp', got {threshold_mode!r}")
    if atr_multiple <= 0:
        raise ValueError(f"atr_multiple must be > 0, got {atr_multiple}")
    bar = trailing_atr_bp(high, low, close, window=int(atr_window)) * float(atr_multiple)
    if threshold_bp is not None and threshold_bp > 0:
        # Floor only. np.maximum propagates NaN, so the warmup stays NaN/dropped.
        bar = np.maximum(bar, float(threshold_bp))
    return bar


def make_labels(
    high: np.ndarray,
    low: np.ndarray,
    close: np.ndarray,
    horizon_bars: int,
    threshold_bp: float | None = None,
    *,
    threshold_mode: str = "atr",
    atr_window: int = 20,
    atr_multiple: float = 1.0,
    return_diagnostics: bool = False,
):
    """Return (labels, valid_mask[, diagnostics]).

    labels: shape-(N,) int8 in {0, 1, -1}; -1 means "drop this bar"
    valid_mask: shape-(N,) bool, True where label in {0, 1}
    diagnostics (opt-in): why each bar was dropped, plus the realised barrier
        width distribution — so a low label yield is explained, not guessed at.
    """
    if horizon_bars < 1:
        raise ValueError(f"horizon_bars must be >= 1, got {horizon_bars}")
    h = np.ascontiguousarray(high, dtype=np.float64)
    low_arr = np.ascontiguousarray(low, dtype=np.float64)
    c = np.ascontiguousarray(close, dtype=np.float64)
    if not (h.shape == low_arr.shape == c.shape):
        raise ValueError("high/low/close must have identical shape")

    thr_arr = resolve_threshold_bp(
        h,
        low_arr,
        c,
        threshold_mode=threshold_mode,
        threshold_bp=threshold_bp,
        atr_window=atr_window,
        atr_multiple=atr_multiple,
    )
    labels, why = _barrier_label(h, low_arr, c, int(horizon_bars), thr_arr)
    valid = labels >= 0
    if not return_diagnostics:
        return labels, valid

    finite_thr = thr_arr[np.isfinite(thr_arr)]
    diag = {
        "n_bars": int(c.shape[0]),
        "n_valid": int(valid.sum()),
        "threshold_mode": threshold_mode,
        "atr_window": int(atr_window),
        "atr_multiple": float(atr_multiple),
        "threshold_floor_bp": float(threshold_bp) if threshold_bp else None,
        "dropped_horizon_overflow": int((why == 1).sum()),
        "dropped_bad_close": int((why == 2).sum()),
        "dropped_barrier_warmup": int((why == 3).sum()),
        "dropped_no_barrier_touched": int((why == 4).sum()),
        "dropped_both_barriers_same_bar": int((why == 5).sum()),
        "barrier_bp_median": float(np.median(finite_thr)) if finite_thr.size else float("nan"),
        "barrier_bp_min": float(finite_thr.min()) if finite_thr.size else float("nan"),
        "barrier_bp_max": float(finite_thr.max()) if finite_thr.size else float("nan"),
    }
    return labels, valid, diag


def time_split_indices(
    n_valid: int,
    train_frac: float = 0.8,
    embargo: int = 0,
) -> tuple[np.ndarray, np.ndarray]:
    """Return (train_idx, val_idx) for a time-ordered split with embargo.

    n_valid is the count of *labeled* (post-mask) samples; the caller passes
    the indices array after filtering by valid_mask. Embargo trims the last
    `embargo` samples off train so the label-horizon doesn't bleed into val.
    """
    if not (0.0 < train_frac < 1.0):
        raise ValueError(f"train_frac out of range: {train_frac}")
    cut = int(n_valid * train_frac)
    train_end = max(0, cut - embargo)
    train = np.arange(0, train_end, dtype=np.int64)
    val = np.arange(cut, n_valid, dtype=np.int64)
    return train, val
