"""
Shared label generators for supervised ML models.

This module is the canonical home for label-generation code consumed by
generated training scripts (W2+ Jinja2 templates) and by the xgb_classifier
reference model (whose own ``labels.py`` re-exports from here since 2026-09-26;
the two had drifted — this file only knew a fixed basis-point barrier while
the reference model had moved to an ATR-scaled one). Four label strategies
are wired to the workshop UI:

  1. triple_barrier         — Lopez de Prado direction labels (binary), with
                              a CAUSAL volatility-scaled barrier by default
  2. next_close_direction   — sign(close[t+H] - close[t]) with optional
                              flat-zone threshold (binary or ternary)
  3. range_bucket           — quantize next-N-bar close-to-close delta into
                              K symmetric buckets (multiclass, mirrors the
                              `range_class` head in trading_model)
  4. structural             — 5-class bar-level swing classification
                              (HH/HL/Inside/LH/LL) using a strictly causal
                              lookback to MAX/MIN over [t-N..t-1]; it describes
                              the bar itself and has no forward horizon

Plus walk-forward helpers (time_split_indices) and the label-horizon helper
the trainers derive their purge from.

Adapter contract (every workshop adapter):
    fn(close, high, low, params)  ->  (labels: np.ndarray, valid: np.ndarray[bool])
or  fn(close, params)             ->  (labels: np.ndarray, valid: np.ndarray[bool])

Where `labels.shape == valid.shape == close.shape` and rows with
valid[i] == False must be filtered out by the caller. All numeric inner loops
use Numba @njit(cache=True) for ~50x speedups over pandas.

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

``threshold_mode="fixed_bp"`` restores the constant-bp behaviour verbatim. In
``"atr"`` mode ``threshold_bp`` acts as an absolute FLOOR on the barrier.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from numba import njit

# ─── Triple-barrier core ─────────────────────────────────────────────────────


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


# ─── Workshop adapter: triple_barrier ───────────────────────────────────────


def triple_barrier_labels(
    close: np.ndarray,
    high: np.ndarray,
    low: np.ndarray,
    params: dict[str, Any] | None = None,
) -> tuple[np.ndarray, np.ndarray]:
    """Triple-barrier direction labels (binary up/down, no-touch dropped).

    Wraps make_labels() with workshop-style param-dict ingestion.

    Params:
      horizon_bars (int, required)   : forward window length
      threshold_mode (str, 'atr')    : 'atr' (barrier = atr_multiple × trailing
                                       ATR, threshold_bp as a floor) or 'fixed_bp'
      threshold_bp (float)           : the barrier in fixed_bp mode; a floor in atr mode
      atr_window (int, 20)           : trailing ATR window, NaN until full
      atr_multiple (float, 1.0)      : barrier width in ATRs

    Returns:
      labels: int8 array shape-(N,); rows with valid==False contain -1
      valid:  bool array shape-(N,)
    """
    if params is None:
        raise ValueError("triple_barrier_labels requires params with horizon_bars")
    horizon = int(params["horizon_bars"])
    threshold_mode = str(params.get("threshold_mode", "atr"))
    threshold_bp = params.get("threshold_bp")
    if threshold_mode == "fixed_bp" and threshold_bp is None:
        raise ValueError("triple_barrier_labels: threshold_mode='fixed_bp' needs threshold_bp")
    return make_labels(
        high=high,
        low=low,
        close=close,
        horizon_bars=horizon,
        threshold_bp=float(threshold_bp) if threshold_bp is not None else None,
        threshold_mode=threshold_mode,
        atr_window=int(params.get("atr_window", 20)),
        atr_multiple=float(params.get("atr_multiple", 1.0)),
    )


# ─── Workshop adapter: next_close_direction ─────────────────────────────────


@njit(cache=True)
def _next_close_direction(
    close: np.ndarray,
    horizon: int,
    threshold_pts: float,
) -> tuple[np.ndarray, np.ndarray]:
    """Compute sign(close[t+H] - close[t]) with optional flat-zone threshold.

    Returns (labels: int8, valid: bool):
      labels[i] in {0, 1} when threshold_pts == 0  (binary down/up)
      labels[i] in {0, 1, 2} when threshold_pts > 0 where 0=down, 1=flat, 2=up
      valid[i] == False for the trailing `horizon` bars (no future close).
    """
    n = close.shape[0]
    labels = np.zeros(n, dtype=np.int8)
    valid = np.zeros(n, dtype=np.bool_)
    use_flat = threshold_pts > 0.0

    for i in range(n - horizon):
        delta = close[i + horizon] - close[i]
        if use_flat:
            if delta > threshold_pts:
                labels[i] = 2
            elif delta < -threshold_pts:
                labels[i] = 0
            else:
                labels[i] = 1
        else:
            labels[i] = 1 if delta > 0.0 else 0
        valid[i] = True
    return labels, valid


def next_close_direction_labels(
    close: np.ndarray,
    params: dict[str, Any] | None = None,
) -> tuple[np.ndarray, np.ndarray]:
    """Next-close direction labels: sign(close[t+H] - close[t]).

    Params:
      horizon_bars (int, default 1)   : forward look distance H
      threshold_pts (float, default 0): flat-zone half-width in absolute
        price points; if > 0, returns ternary {0=down, 1=flat, 2=up};
        if 0, returns binary {0=down, 1=up}.

    Returns:
      labels: int8 array shape-(N,)
      valid:  bool array shape-(N,) — last `horizon_bars` rows are False.
    """
    p = params or {}
    horizon = int(p.get("horizon_bars", 1))
    threshold_pts = float(p.get("threshold_pts", 0.0))
    if horizon < 1:
        raise ValueError(f"horizon_bars must be >= 1, got {horizon}")
    if threshold_pts < 0:
        raise ValueError(f"threshold_pts must be >= 0, got {threshold_pts}")
    c = np.ascontiguousarray(close, dtype=np.float64)
    return _next_close_direction(c, horizon, threshold_pts)


# ─── Workshop adapter: range_bucket ─────────────────────────────────────────


@njit(cache=True)
def _range_bucket(
    close: np.ndarray,
    horizon: int,
    bucket_width_pts: float,
    n_buckets: int,
) -> tuple[np.ndarray, np.ndarray]:
    """Quantize next-H-bar close-to-close delta into K symmetric buckets.

    half_range = (n_buckets / 2.0) * bucket_width_pts
    bucket_idx = floor((delta + half_range) / bucket_width_pts) clamped to [0, K-1]

    Mirrors the trading_model `range_class` head from project CLAUDE.md.

    Returns (labels: int16, valid: bool); trailing `horizon` rows have valid=False.
    """
    n = close.shape[0]
    labels = np.zeros(n, dtype=np.int16)
    valid = np.zeros(n, dtype=np.bool_)
    half_range = (n_buckets / 2.0) * bucket_width_pts

    last_idx = n_buckets - 1
    for i in range(n - horizon):
        delta = close[i + horizon] - close[i]
        b = int(np.floor((delta + half_range) / bucket_width_pts))
        if b < 0:
            b = 0
        elif b > last_idx:
            b = last_idx
        labels[i] = b
        valid[i] = True
    return labels, valid


def range_bucket_labels(
    close: np.ndarray,
    params: dict[str, Any] | None = None,
) -> tuple[np.ndarray, np.ndarray]:
    """Range-bucket multiclass labels for next-H-bar close-to-close delta.

    Quantizes the signed delta into K symmetric buckets centered on zero.
    Bucket 0 captures all deltas <= -half_range (downside tail);
    bucket K-1 captures all deltas >= +half_range (upside tail);
    buckets in between span `bucket_width_pts` each.

    Params:
      horizon_bars (int, default 1)        : forward look distance H
      bucket_width_pts (float, default 2.0): width of each bucket in price points
      n_buckets (int, default 21)          : K (must be odd to be symmetric around zero)

    Returns:
      labels: int16 array shape-(N,) in [0, K-1]
      valid:  bool array shape-(N,)
    """
    p = params or {}
    horizon = int(p.get("horizon_bars", 1))
    bucket_width_pts = float(p.get("bucket_width_pts", 2.0))
    n_buckets = int(p.get("n_buckets", 21))
    if horizon < 1:
        raise ValueError(f"horizon_bars must be >= 1, got {horizon}")
    if bucket_width_pts <= 0:
        raise ValueError(f"bucket_width_pts must be > 0, got {bucket_width_pts}")
    if n_buckets < 2:
        raise ValueError(f"n_buckets must be >= 2, got {n_buckets}")
    c = np.ascontiguousarray(close, dtype=np.float64)
    return _range_bucket(c, horizon, bucket_width_pts, n_buckets)


# ─── Workshop adapter: structural ───────────────────────────────────────────


@njit(cache=True)
def _structural(
    high: np.ndarray,
    low: np.ndarray,
    lookback: int,
) -> tuple[np.ndarray, np.ndarray]:
    """5-class bar-level swing classification.

    For each row t with at least `lookback` prior bars:
      prev_max_high = MAX(high[t-lookback : t])     (excludes t)
      prev_min_low  = MIN(low[t-lookback : t])      (excludes t)
      hh = high[t] > prev_max_high
      ll = low[t]  < prev_min_low

    Class assignment (strictly causal — uses ONLY past bars, no future leak):
      0 = LL   (low[t] < prev_min_low and high[t] <= prev_max_high)
      1 = LH   (low[t] >= prev_min_low and high[t] <= prev_max_high)
      2 = INSIDE (low[t] >= prev_min_low and high[t] <= prev_max_high
                  and high[t] < prev_max_high and low[t] > prev_min_low)
      3 = HL   (low[t] >= prev_min_low and high[t] > prev_max_high)
      4 = HH   (low[t] < prev_min_low and high[t] > prev_max_high)
                                 — both broken: outside bar treated as HH

    Practical mapping used here (resolves overlap):
      both extremes broken (hh and ll)        -> 4 (HH, outside)
      only high broken (hh and not ll)        -> 3 (HL, breakout up)
      only low broken (ll and not hh)         -> 0 (LL, breakdown)
      neither broken, strict inside           -> 2 (INSIDE)
      neither broken, equal high              -> 1 (LH, lower-high candidate)
      otherwise (touched but not broken)      -> 1 (LH)

    First `lookback` rows have valid=False.
    """
    n = high.shape[0]
    labels = np.zeros(n, dtype=np.int8)
    valid = np.zeros(n, dtype=np.bool_)

    for i in range(lookback, n):
        prev_max_high = high[i - lookback]
        prev_min_low = low[i - lookback]
        for j in range(i - lookback + 1, i):
            if high[j] > prev_max_high:
                prev_max_high = high[j]
            if low[j] < prev_min_low:
                prev_min_low = low[j]
        hi_t = high[i]
        lo_t = low[i]
        hh = hi_t > prev_max_high
        ll = lo_t < prev_min_low
        if hh and ll:
            labels[i] = 4  # HH (outside bar)
        elif hh and not ll:
            labels[i] = 3  # HL (breakout up; low held)
        elif ll and not hh:
            labels[i] = 0  # LL (breakdown; high held)
        elif (hi_t < prev_max_high) and (lo_t > prev_min_low):
            labels[i] = 2  # INSIDE
        else:
            labels[i] = 1  # LH (touched but neither extreme broken)
        valid[i] = True
    return labels, valid


def structural_labels(
    high: np.ndarray,
    low: np.ndarray,
    params: dict[str, Any] | None = None,
) -> tuple[np.ndarray, np.ndarray]:
    """5-class bar-level swing classification (HH/HL/Inside/LH/LL).

    Compares bar t's high/low against MAX/MIN of high/low over the
    preceding `lookback_bars` rows. Strictly causal — uses only past bars,
    so labels are leak-free for supervised classification. The label describes
    the bar itself: there is no forward horizon, and nothing to purge for.

    Params:
      lookback_bars (int, default 20): how many prior bars define the
        rolling extremes (excludes the current bar)

    Returns:
      labels: int8 array shape-(N,) in {0=LL, 1=LH, 2=INSIDE, 3=HL, 4=HH}
      valid:  bool array shape-(N,) — first `lookback_bars` rows are False
    """
    p = params or {}
    lookback = int(p.get("lookback_bars", 20))
    if lookback < 1:
        raise ValueError(f"lookback_bars must be >= 1, got {lookback}")
    if high.shape != low.shape:
        raise ValueError("high and low must have identical shape")
    h = np.ascontiguousarray(high, dtype=np.float64)
    low_arr = np.ascontiguousarray(low, dtype=np.float64)
    return _structural(h, low_arr, lookback)


# ─── Horizon ─────────────────────────────────────────────────────────────────


def label_horizon_bars(strategy: str, params: dict[str, Any] | None) -> int:
    """Bars after the event bar at which a strategy's label is known.

    This is the purge a walk-forward split needs between a training window and
    the test window that follows it: a training label whose horizon reaches
    into the test window would let the model see test outcomes. ``structural``
    describes the bar itself and needs none.
    """
    p = params or {}
    if strategy == "structural":
        return 0
    if strategy in ("triple_barrier", "next_close_direction", "range_bucket"):
        return max(1, int(p.get("horizon_bars", 1)))
    raise ValueError(f"unknown label strategy {strategy!r}")


__all__ = [
    "make_labels",
    "resolve_threshold_bp",
    "trailing_atr_bp",
    "time_split_indices",
    "label_horizon_bars",
    "triple_barrier_labels",
    "next_close_direction_labels",
    "range_bucket_labels",
    "structural_labels",
]
