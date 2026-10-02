"""The technical-analysis battery (TA-Lib), made safe for a back-adjusted futures series.

Ported from ``Trading/quant/model/scripts/ta_features.py`` (the battery behind
``train_direction_ta.py``) with one deliberate change. The original expressed
price-level indicators as ``close / moving_average - 1``. On an additively
back-adjusted series that ratio is wrong: every bar before a roll is shifted by
the roll gaps, so the ratio shrinks by ``level / (level + adjustment)`` — up to
about 20% on 2019 bars. Here every price-level indicator is a DIFFERENCE divided
by the 14-bar Average True Range (ATR). A difference is exactly unchanged by an
additive shift, and dividing by ATR makes it scale-free across 2019's 8,000 and
2025's 25,000 index levels. Oscillators that are already bounded ratios of
differences (RSI, Stochastic, Williams %R, CCI, ADX, Bollinger %B, ...) are used
as TA-Lib returns them. No absolute price enters the model.

Invariance is also a causality requirement here: a back-adjusted bar's level
includes the gaps of every roll AFTER it, so a feature that changes when the
whole series is shifted reads the future. Measured on a shifted random walk,
TA-Lib's Hilbert-transform family (HT_TRENDLINE, HT_DCPERIOD, HT_DCPHASE,
HT_PHASOR, HT_SINE, HT_TRENDMODE), MAMA/FAMA and the money flow index move
under a shift, so they are left out (``tests/test_ta_strategy.py`` holds every
remaining column to a shift of 2,500 points).

Every function is causal (TA-Lib indicators only read past bars). Rows inside
the longest warmup (the 200-bar moving averages) are NaN and never scored.

Calendar features use the Pacific clock the lake stamps futures in.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import talib

PERIODS = (7, 14, 21, 28)
MOMENTUM_LAGS = (1, 3, 6, 12, 24, 48)
MOVING_AVERAGE_PERIODS = (10, 20, 50, 100, 200)
REGRESSION_PERIODS = (14, 30, 60)
RTH_OPEN_MINUTE = 6 * 60 + 30    # 06:30 Pacific
RTH_CLOSE_MINUTE = 13 * 60       # 13:00 Pacific


def _safe_divide(numerator: np.ndarray, denominator: np.ndarray) -> np.ndarray:
    with np.errstate(divide="ignore", invalid="ignore"):
        out = numerator / denominator
    out[~np.isfinite(out)] = np.nan
    return out


def compute(frame: pd.DataFrame) -> pd.DataFrame:
    """Feature matrix, one row per bar of ``frame`` (timestamp, open, high, low, close, volume)."""
    o = frame["open"].to_numpy(np.float64)
    h = frame["high"].to_numpy(np.float64)
    l = frame["low"].to_numpy(np.float64)
    c = frame["close"].to_numpy(np.float64)
    v = frame["volume"].to_numpy(np.float64)
    atr = talib.ATR(h, l, c, 14)
    f: dict[str, np.ndarray] = {}

    def per_atr(values: np.ndarray) -> np.ndarray:
        return _safe_divide(values, atr)

    # ── momentum oscillators (bounded; differences only) ───────────────────
    for p in PERIODS:
        f[f"rsi_{p}"] = talib.RSI(c, p)
        f[f"williams_percent_r_{p}"] = talib.WILLR(h, l, c, p)
        f[f"commodity_channel_index_{p}"] = talib.CCI(h, l, c, p)
        f[f"chande_momentum_oscillator_{p}"] = talib.CMO(c, p)
        f[f"average_directional_index_{p}"] = talib.ADX(h, l, c, p)
        f[f"average_directional_index_rating_{p}"] = talib.ADXR(h, l, c, p)
        f[f"directional_movement_index_{p}"] = talib.DX(h, l, c, p)
        f[f"plus_directional_indicator_{p}"] = talib.PLUS_DI(h, l, c, p)
        f[f"minus_directional_indicator_{p}"] = talib.MINUS_DI(h, l, c, p)
        f[f"aroon_oscillator_{p}"] = talib.AROONOSC(h, l, p)
    for lag in MOMENTUM_LAGS:
        f[f"momentum_{lag}_bars_per_atr"] = per_atr(talib.MOM(c, lag))
    slow_k, slow_d = talib.STOCH(h, l, c)
    f["stochastic_slow_k"], f["stochastic_slow_d"] = slow_k, slow_d
    fast_k, fast_d = talib.STOCHF(h, l, c)
    f["stochastic_fast_k"], f["stochastic_fast_d"] = fast_k, fast_d
    rsi_k, rsi_d = talib.STOCHRSI(c)
    f["stochastic_rsi_k"], f["stochastic_rsi_d"] = rsi_k, rsi_d
    f["ultimate_oscillator"] = talib.ULTOSC(h, l, c)
    f["balance_of_power"] = talib.BOP(o, h, l, c)
    macd, signal, histogram = talib.MACD(c)
    f["macd_line_per_atr"] = per_atr(macd)
    f["macd_signal_per_atr"] = per_atr(signal)
    f["macd_histogram_per_atr"] = per_atr(histogram)
    # TA-Lib's "absolute price oscillator" (APO): the 12-bar minus the 26-bar average.
    # Not named apo/absolute_*, which this repo reserves for raw price levels.
    f["exponential_average_12_minus_26_per_atr"] = per_atr(talib.APO(c, 12, 26, matype=1))

    # ── overlap studies: distance from each average, in ATRs ──────────────
    averages = {
        "simple_moving_average": talib.SMA,
        "exponential_moving_average": talib.EMA,
        "weighted_moving_average": talib.WMA,
        "kaufman_adaptive_moving_average": talib.KAMA,
        "triple_exponential_moving_average": talib.TEMA,
        "midpoint": talib.MIDPOINT,
    }
    for name, function in averages.items():
        for p in MOVING_AVERAGE_PERIODS:
            f[f"close_minus_{name}_{p}_per_atr"] = per_atr(c - function(c, p))
    upper, middle, lower = talib.BBANDS(c, 20, 2.0, 2.0)
    f["bollinger_percent_b_20"] = _safe_divide(c - lower, upper - lower)
    f["bollinger_width_20_per_atr"] = per_atr(upper - lower)
    f["close_minus_parabolic_sar_per_atr"] = per_atr(c - talib.SAR(h, l))

    # ── volatility ─────────────────────────────────────────────────────────
    f["atr_14_over_atr_100_ratio"] = _safe_divide(atr, talib.ATR(h, l, c, 100))
    f["true_range_per_atr"] = per_atr(talib.TRANGE(h, l, c))
    f["close_change_standard_deviation_20_per_atr"] = per_atr(talib.STDDEV(np.r_[np.nan, np.diff(c)], 20))
    f["bar_range_per_atr"] = per_atr(h - l)
    f["bar_body_per_atr"] = per_atr(c - o)

    # ── volume ─────────────────────────────────────────────────────────────
    volume_series = pd.Series(v)
    volume_mean = volume_series.rolling(50, min_periods=50).mean().to_numpy()
    volume_std = volume_series.rolling(50, min_periods=50).std().to_numpy()
    f["log_volume"] = np.log1p(v)
    f["volume_zscore_50"] = _safe_divide(v - volume_mean, volume_std)
    f["on_balance_volume_slope_14_per_mean_volume"] = _safe_divide(talib.LINEARREG_SLOPE(talib.OBV(c, v), 14), volume_mean)
    f["accumulation_distribution_slope_14_per_mean_volume"] = _safe_divide(talib.LINEARREG_SLOPE(talib.AD(h, l, c, v), 14), volume_mean)
    f["chaikin_oscillator_per_mean_volume"] = _safe_divide(talib.ADOSC(h, l, c, v), volume_mean)

    # ── regression statistics ─────────────────────────────────────────────
    for p in REGRESSION_PERIODS:
        f[f"linear_regression_slope_{p}_per_atr"] = per_atr(talib.LINEARREG_SLOPE(c, p))
        f[f"close_minus_time_series_forecast_{p}_per_atr"] = per_atr(c - talib.TSF(c, p))
        f[f"high_low_correlation_{p}"] = talib.CORREL(h, l, p)

    # ── candlestick patterns: +1 bullish, -1 bearish, 0 none ──────────────
    for name in talib.get_function_groups()["Pattern Recognition"]:
        f[f"candle_{name.lower().removeprefix('cdl')}"] = getattr(talib, name)(o, h, l, c).astype(np.float64) / 100.0

    # ── calendar, Pacific clock ────────────────────────────────────────────
    stamps = pd.to_datetime(frame["timestamp"].to_numpy(np.int64), unit="s")
    minute = (stamps.hour * 60 + stamps.minute).to_numpy(np.float64)
    f["hour_of_day_sine"] = np.sin(2 * np.pi * minute / 1440.0)
    f["hour_of_day_cosine"] = np.cos(2 * np.pi * minute / 1440.0)
    session_weekday = (stamps + pd.Timedelta(hours=9)).dayofweek.to_numpy(np.float64)
    f["session_day_of_week_sine"] = np.sin(2 * np.pi * session_weekday / 7.0)
    f["session_day_of_week_cosine"] = np.cos(2 * np.pi * session_weekday / 7.0)
    in_rth = (minute >= RTH_OPEN_MINUTE) & (minute < RTH_CLOSE_MINUTE)
    f["regular_trading_hours_flag"] = in_rth.astype(np.float64)
    f["minutes_since_regular_open"] = np.where(minute >= RTH_OPEN_MINUTE, minute - RTH_OPEN_MINUTE, minute + 1440 - RTH_OPEN_MINUTE)

    out = pd.DataFrame(f, index=frame.index)
    return out.astype(np.float32)


def usable_columns(features: pd.DataFrame, train_rows: np.ndarray) -> list[str]:
    """Columns that vary and are mostly present in the TRAINING rows only (the
    original dropped constant columns using the full sample, a small leak)."""
    train = features.iloc[train_rows]
    finite_share = np.isfinite(train.to_numpy()).mean(axis=0)
    spread = train.std(skipna=True).to_numpy()
    keep = (finite_share > 0.95) & np.isfinite(spread) & (spread > 0)
    return [column for column, k in zip(features.columns, keep) if k]
