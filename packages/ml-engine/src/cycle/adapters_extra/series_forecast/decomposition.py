"""Seasonal decomposition (STL, Cleveland et al. 1990) of the training span's
log price into trend + seasonal + remainder, turned into a forecaster by
freezing the seasonal part.

Fit: ``statsmodels.tsa.seasonal.STL`` on log close over the training span,
period = the bars of one session, seasonal smoother over
``seasonal_smoother_cycles`` sessions (odd), optionally robust. The seasonal
component is averaged per time-of-day slot into a session PROFILE (centred);
the trend and remainder of the training span are not carried forward — STL's
trend is a two-sided LOESS, so re-running it on test bars would read the
future.

Forecast at bar t: a trailing slope plus the profile,

    mean_t = h * slope_t + profile[slot(t + h)] - profile[slot(t)]
    slope_t = mean of the deseasonalised one-bar returns
              r_u - (profile[slot(u)] - profile[slot(u - 1)]) over u = t - W + 1 .. t

(W = ``trend_window_bars``; a return across a session gap is left out; at
least half of the window must be observed), the slot of t + h taken from
t's own timestamp plus h bar intervals. The spread is the standard deviation
of this forecast's h-bar errors over the fold's validation bars
(``calibrate``; the training span's errors when fewer than 30 are known).
"""

from __future__ import annotations

import numpy as np

from . import common


def _odd(value: int) -> int:
    value = max(3, int(value))
    return value if value % 2 == 1 else value + 1


class SeasonalDecompositionForecaster:
    name = "stl"

    def __init__(self, trend_window_bars: int, seasonal_smoother_cycles: int, robust_fit: bool, horizon: int) -> None:
        self.trend_window_bars = int(trend_window_bars)
        if self.trend_window_bars < 2:
            raise ValueError("trend_window_bars must be at least 2")
        self.seasonal_smoother_cycles = _odd(seasonal_smoother_cycles)
        self.robust_fit = bool(robust_fit)
        self.horizon = int(horizon)
        self.interval_seconds = float("nan")
        self.period = 0
        self.profile = np.empty(0)
        self.spread = float("nan")
        self.summary: dict = {}

    def fit(self, view, rows: np.ndarray, log) -> dict:
        from statsmodels.tsa.seasonal import STL

        self.interval_seconds = common.bar_interval_seconds(view.timestamps, rows)
        self.period = common.session_period_bars(view, rows, self.interval_seconds)
        close = np.asarray(view.close, dtype=np.float64)[rows]
        usable = np.isfinite(close) & (close > 0)
        if int(usable.sum()) < 2 * self.period + 1:
            raise ValueError(f"STL needs two sessions ({2 * self.period + 1} bars) in the training span, "
                             f"got {int(usable.sum())}")
        log_close = np.log(np.where(usable, close, np.nan))
        # STL needs a gap-free series: a missing close is carried from the bar before (the first from the next)
        filled = log_close.copy()
        missing = ~np.isfinite(filled)
        if missing.any():
            index = np.where(~missing, np.arange(filled.size), 0)
            np.maximum.accumulate(index, out=index)
            filled = filled[index]
            first = int(np.flatnonzero(np.isfinite(log_close))[0])
            filled[:first] = log_close[first]
        decomposition = STL(filled, period=self.period, seasonal=self.seasonal_smoother_cycles,
                            robust=self.robust_fit).fit()
        seasonal = np.asarray(decomposition.seasonal, dtype=np.float64)
        slots = common.time_of_day_slot(np.asarray(view.timestamps)[rows], self.interval_seconds)
        count = common.slot_count(self.interval_seconds)
        totals = np.bincount(slots, weights=np.where(usable, seasonal, 0.0), minlength=count)
        counts = np.bincount(slots, weights=usable.astype(np.float64), minlength=count)
        profile = np.zeros(count)
        seen = counts > 0
        profile[seen] = totals[seen] / counts[seen]
        profile[seen] -= float(np.mean(profile[seen]))
        self.profile = profile

        # the spread: this forecast's own h-bar errors over the training span (targets resolve by the span end + h)
        mean = self._mean(view, int(rows[-1]) + 1)
        realised = common.realised_log_move(view, rows)
        error = realised - mean[rows]
        error = error[np.isfinite(error)]
        if error.size < 10:
            raise ValueError("fewer than 10 training bars have both a forecast and a realised h-bar move")
        self.spread = float(np.sqrt(np.mean(error ** 2)))
        remainder = np.asarray(decomposition.resid, dtype=np.float64)
        self.summary = {"seasonal_period_bars": self.period, "bar_interval_seconds": self.interval_seconds,
                        "seasonal_amplitude": float(np.ptp(profile[seen])) if seen.any() else 0.0,
                        "remainder_standard_deviation": float(np.std(remainder[usable])),
                        "forecast_error_standard_deviation": self.spread}
        return self.summary

    def _mean(self, view, end: int) -> np.ndarray:
        """The h-bar mean forecast at rows 0..end-1 (reads rows < end only)."""
        stamps = np.asarray(view.timestamps, dtype=np.int64)[:end]
        returns = common.returns_of(view)[:end]
        slots = common.time_of_day_slot(stamps, self.interval_seconds)
        seasonal_step = np.full(end, np.nan)
        seasonal_step[1:] = self.profile[slots[1:]] - self.profile[slots[:-1]]
        deseasonalised = returns - seasonal_step
        observed = np.isfinite(deseasonalised)
        values = np.concatenate([[0.0], np.cumsum(np.where(observed, deseasonalised, 0.0))])
        counts = np.concatenate([[0], np.cumsum(observed.astype(np.int64))])
        window = self.trend_window_bars
        stop = np.arange(1, end + 1)
        start = np.maximum(stop - window, 0)
        observed_count = counts[stop] - counts[start]
        with np.errstate(invalid="ignore", divide="ignore"):
            slope = (values[stop] - values[start]) / observed_count
        slope[observed_count < max(2, window // 2)] = np.nan
        future_slots = common.time_of_day_slot(stamps + int(round(self.horizon * self.interval_seconds)),
                                               self.interval_seconds)
        return self.horizon * slope + self.profile[future_slots] - self.profile[slots]

    def calibrate(self, view, rows: np.ndarray, log) -> None:
        """The spread from this forecast's h-bar errors on the fold's VALIDATION
        rows (the documented validation calibration: the training span's own
        errors are in-sample for the profile, so they understate the spread).
        Needs 30 validation bars with a realised move; the training spread stays otherwise."""
        rows = np.asarray(rows, dtype=np.int64)
        if rows.size == 0:
            return
        mean = self._mean(view, int(rows[-1]) + 1)[rows]
        error = common.realised_log_move(view, rows) - mean
        error = error[np.isfinite(error)]
        if error.size < 30:
            log(f"STL: only {error.size} validation bars have a realised move; the spread stays the training one")
            return
        self.spread = float(np.sqrt(np.mean(error ** 2)))
        self.summary["validation_forecast_error_standard_deviation"] = self.spread

    def forecast(self, view) -> tuple[np.ndarray, np.ndarray]:
        mean = self._mean(view, len(view))
        return mean, np.full(mean.shape, self.spread)

    # ── persistence ──
    def to_state(self) -> tuple[dict, dict]:
        info = {"trend_window_bars": self.trend_window_bars, "seasonal_smoother_cycles": self.seasonal_smoother_cycles,
                "robust_fit": self.robust_fit, "horizon": self.horizon, "interval_seconds": self.interval_seconds,
                "period": self.period, "spread": self.spread, "summary": self.summary}
        return {"profile": np.asarray(self.profile, dtype=np.float64)}, info

    @classmethod
    def from_state(cls, arrays: dict, info: dict) -> SeasonalDecompositionForecaster:
        model = cls(info["trend_window_bars"], info["seasonal_smoother_cycles"], info["robust_fit"], info["horizon"])
        model.profile = np.asarray(arrays["profile"], dtype=np.float64)
        model.interval_seconds = float(info["interval_seconds"])
        model.period = int(info["period"])
        model.spread = float(info["spread"])
        model.summary = dict(info.get("summary") or {})
        return model
