"""
HDP-HMM Feature Engineering
============================

UNIVERSAL (self-referential rolling z-scores) feature computation.

Think of it as a doctor comparing YOUR vital signs to YOUR recent history,
not to some other patient. "Is YOUR heart rate high for YOU?" — not "is your
heart rate the same as a hummingbird's?"

Every feature is either:
  (a) Already dimensionless (0-1 ratio, like wick %)
  (b) Locally z-scored against its own rolling window
  (c) Rank-normalized (rolling percentile 0-1)

This means a "2σ spike" on ES means the same thing as a "2σ spike" on EURUSD,
even though ES moves in 0.25-tick increments and EURUSD moves in 0.0001 pips.
"""

import numpy as np
import pandas as pd  # type: ignore[import-untyped]

from .config import ROLLING_WINDOW, WARMUP_BARS


def rolling_zscore(arr: np.ndarray, window: int = ROLLING_WINDOW) -> np.ndarray:
    """
    Compute rolling z-score: (value - rolling_mean) / rolling_std.

    Think of it as: "How far is this bar from its own recent average,
    measured in its own recent standard deviations?"
    """
    series = pd.Series(arr)
    rolling_mean = series.rolling(window, min_periods=5).mean()
    rolling_std = series.rolling(window, min_periods=5).std()
    # Avoid division by zero — if std is 0, the z-score is 0 (no deviation)
    zscore = (series - rolling_mean) / rolling_std.replace(0, np.nan)
    return np.asarray(zscore.fillna(0).values)


def rolling_rank(arr: np.ndarray, window: int = ROLLING_WINDOW) -> np.ndarray:
    """
    Compute rolling percentile rank (0 to 1).

    Think of it as: "Where does this bar's value sit among the last N bars?
    0.0 = smallest, 1.0 = largest, 0.5 = median."
    """
    series = pd.Series(arr)
    result = series.rolling(window, min_periods=5).rank(pct=True)
    return np.asarray(result.fillna(0.5).values)


def compute_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Compute UNIVERSAL regime-relevant features from OHLCV.

    Every feature is self-normalized: either a dimensionless ratio (0-1),
    a rolling z-score (vs own recent history), or a rolling percentile rank.

    Think of it as: taking the instrument's "fingerprint" not in absolute terms
    (dollars, pips) but in relative terms (is today unusual FOR ME?).
    A quiet day on ES and a quiet day on EURUSD will produce similar feature
    vectors, even though one moves in points and the other in pips.
    """
    feat = pd.DataFrame(index=df.index)
    feat["ts"] = df["ts"]

    close = df["close"].values.astype(np.float64)
    open_ = df["open"].values.astype(np.float64)
    high = df["high"].values.astype(np.float64)
    low = df["low"].values.astype(np.float64)
    volume = df["volume"].values.astype(np.float64)

    # ── Raw intermediate signals (not features themselves) ──
    log_return = np.log(close / np.roll(close, 1))
    log_return[0] = 0

    range_pct = (high - low) / np.where(close > 0, close, 1)
    body_pct = (close - open_) / np.where(close > 0, close, 1)

    bar_range = high - low

    trend_5 = (close - np.roll(close, 5)) / np.where(
        np.roll(close, 5) > 0, np.roll(close, 5), 1
    )
    trend_5[:5] = 0

    trend_20 = (close - np.roll(close, 20)) / np.where(
        np.roll(close, 20) > 0, np.roll(close, 20), 1
    )
    trend_20[:20] = 0

    # ── UNIVERSAL FEATURES (rolling z-scores) ──
    # Each z-scored against its OWN recent window — "is this unusual for ME?"

    feat["log_return_z"] = rolling_zscore(log_return)
    feat["range_pct_z"] = rolling_zscore(range_pct)
    feat["body_pct_z"] = rolling_zscore(body_pct)

    # Wick features — already 0-1 (fraction of bar range), perfectly universal
    safe_bar_range = np.where(bar_range > 0, bar_range, 1.0)
    feat["upper_wick_pct"] = np.where(
        bar_range > 0, (high - np.maximum(close, open_)) / safe_bar_range, 0
    )
    feat["lower_wick_pct"] = np.where(
        bar_range > 0, (np.minimum(close, open_) - low) / safe_bar_range, 0
    )

    # Volume: rolling percentile rank (0 = quiet, 1 = busiest in recent window)
    # This works for both futures (real contracts) and forex (tick counts)
    # because we only ask "is volume high FOR THIS INSTRUMENT recently?"
    vol_safe = np.asarray(np.where(volume > 0, volume, 1))
    feat["vol_rank"] = rolling_rank(vol_safe)

    # ATR ratio — current bar range / rolling 20-bar average range
    # Already a self-referential ratio — 1.0 = normal, 2.0 = double avg range
    range_series = pd.Series(bar_range)
    rolling_range_20 = np.asarray(range_series.rolling(20, min_periods=1).mean().values)
    feat["atr_ratio"] = bar_range / np.where(rolling_range_20 > 0, rolling_range_20, 1)

    # Trend z-scores — "is the 5-bar trend unusually strong for this instrument?"
    feat["trend_5_z"] = rolling_zscore(trend_5)
    feat["trend_20_z"] = rolling_zscore(trend_20)

    # Volatility ratio — short-term vol / long-term vol (already dimensionless)
    ret_series = pd.Series(log_return)
    vol_5 = np.asarray(ret_series.rolling(5, min_periods=1).std().values)
    vol_20 = np.asarray(ret_series.rolling(20, min_periods=1).std().values)
    feat["vol_ratio_5_20"] = vol_5 / np.where(vol_20 > 0, vol_20, 1)

    # NEW: Rank-based features for additional universality
    feat["range_rank"] = rolling_rank(range_pct)  # bar range percentile
    feat["return_rank"] = rolling_rank(np.abs(log_return))  # abs return percentile

    # Clean up warmup bars (need ROLLING_WINDOW bars for z-scores to warm up)
    feat = feat.iloc[WARMUP_BARS:].copy()
    feat = feat.replace([np.inf, -np.inf], 0)
    feat = feat.fillna(0)
    return feat
