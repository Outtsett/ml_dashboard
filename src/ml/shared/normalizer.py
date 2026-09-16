"""
Shared normalization constants, classification, and transform functions.

Used by:
  - scripts/normalize-indicators.py  (batch indicator normalization)
  - src/ml/shared/features.py        (rolling z-score for regime features)

Normalization types (8 categories):
  1. skip            - Raw OHLCV duplicates, broken columns
  2. binary          - CDL_* candle patterns, signal flags (0/1/-1)
  3. bounded         - Oscillators with known range -> scale [0,1]
  4. pct_from_close  - Price-level overlays -> (ind - close) / close, then rolling z-score
  5. price_ratio     - Price-unit measures -> ind / close, then rolling z-score
  6. cumulative      - Cumulative volume (OBV, AD, etc.) -> rate of change
  7. rolling_zscore  - Unbounded oscillators -> rolling z-score, clip [-5,5]
  8. passthrough     - Already normalized (z-scores, percentile ranks)
"""

import numpy as np
import pandas as pd

# ==============================================================================
# Global Parameters
# ==============================================================================

ROLLING_WINDOW = 50
CLIP_RANGE = 5.0

# ==============================================================================
# Classification Constants
# ==============================================================================

# Columns to completely skip (raw OHLCV duplicates or broken data)
SKIP_COLUMNS = {
    "timestamp",
    "ts",
    "open",
    "high",
    "low",
    "close",
    "volume",
    "HA_open",
    "HA_high",
    "HA_low",
    "HA_close",
    "HL2",
    "HLC3",
    "OHLC4",
    "WCP",
    "MIDPOINT_2",
    "MIDPRICE_2",
    "HWPCT_1",  # numerically broken (values reach +/-2.6e15)
}

# ---------------------------------------------------------------------------
# Binary / signal columns (pass through as-is)
# ---------------------------------------------------------------------------
BINARY_PREFIXES = (
    "CDL_",  # candle patterns: -100, 0, 100
    "AMATe_",  # Archer MA signal: 0/1
    "AOBV_",  # Archer OBV signal: 0/1
    "EXHC_",  # exhaustion count: small integers
    "microstructured_",  # microstructure direction: -1/0/1
)

BINARY_EXACT = {
    "DEC_1",
    "INC_1",
    "PSARr_0.02_0.2",  # PSAR reversal flag
    "SQZ_NO",
    "SQZ_ON",
    "SQZ_OFF",
    "SQZPRO_NO",
    "SQZPRO_OFF",
    "SQZPRO_ON_NARROW",
    "SQZPRO_ON_NORMAL",
    "SQZPRO_ON_WIDE",
    "SUPERTd_7_3.0",  # SuperTrend direction
    "CHDLREXTd_22_22_14_2.0",
    "THERMOl_20_2_0.5",
    "THERMOs_20_2_0.5",
    "SMCbf_14_50_20_5",
    "SMChv_14_50_20_5",
    "SMCtf_14_50_20_5",
    "TMOM_14_5_3",
    "TMOMs_14_5_3",
    "PVR",
    "LDECAY_1",
}

# ---------------------------------------------------------------------------
# Bounded oscillators -> scale to [0, 1]
# ---------------------------------------------------------------------------
BOUNDED_OSCILLATORS = {
    # RSI family: 0-100
    "RSI_": (0, 100),
    "RSX_": (0, 100),
    # Stochastic family: 0-100
    "STOCHk_": (0, 100),
    "STOCHd_": (0, 100),
    "STOCHh_": (0, 100),
    "STOCHFk_": (0, 100),
    "STOCHFd_": (0, 100),
    "STOCHRSIk_": (0, 100),
    "STOCHRSId_": (0, 100),
    "K_": (0, 100),  # KDJ K
    "D_": (0, 100),  # KDJ D
    # Money flow / momentum: 0-100
    "MFI_": (0, 100),
    "UO_": (0, 100),
    "PSL_": (0, 100),  # Psychological line
    "CRSI_": (0, 100),  # Connors RSI
    "STC_": (0, 100),  # Schaff Trend Cycle
    # Directional / trend strength: 0-100
    "ADX_": (0, 100),
    "ADXR_": (0, 100),
    "AROONU_": (0, 100),
    "AROOND_": (0, 100),
    "CHOP_": (0, 100),
    "NATR_": (0, 100),  # Normalized ATR (already %)
    # Symmetric bounded: -100 to 100
    "CMO_": (-100, 100),
    "AROONOSC_": (-100, 100),
    "CCI_": (-200, 200),  # typical range, clips beyond
    "WILLR_": (-100, 0),
    # 0-1 bounded
    "BBP_": (0, 1),  # Bollinger %B
    "BBB_": (0, 1),  # Bollinger bandwidth ratio
    "ER_": (0, 1),  # Efficiency Ratio
    "ATRr_": (0, 1),  # ATR ratio (already normalized)
    # -1 to 1 bounded
    "CMF_": (-1, 1),  # Chaikin Money Flow
    "EBSW_": (-1, 1),  # Even Better Sinewave
    "CTI_": (-1, 1),  # Correlation Trend Indicator
    "BOP": (-1, 1),  # Balance of Power (exact match handled below)
    # RVI: 0-100 typical
    "RVI_": (0, 100),
}

# Exact bounded matches (columns that don't follow prefix patterns)
BOUNDED_EXACT = {
    "BOP": (-1, 1),
    "J_9_3": (-50, 150),  # KDJ J-line overshoots
}

# ---------------------------------------------------------------------------
# Price-level overlays -> (indicator - close) / close, then rolling z-score
# These track absolute price and vary across instruments.
# ---------------------------------------------------------------------------
PRICE_LEVEL_PREFIXES = (
    # Moving averages (all types)
    "SMA_",
    "EMA_",
    "DEMA_",
    "TEMA_",
    "TRIMA_",
    "WMA_",
    "FWMA_",
    "HMA_",
    "KAMA_",
    "ALMA_",
    "PWMA_",
    "RMA_",
    "SINWMA_",
    "SMMA_",
    "SWMA_",
    "VIDYA_",
    "VWMA_",
    "ZL_EMA_",
    "MCGD_",
    "T3_",
    "JMA_",
    "HWMA_",
    "SSF_",
    "SSF3_",
    "MAMA_",
    "FAMA_",  # MESA Adaptive MA
    "LINREG_",  # Linear regression value
    "HT_TL",  # Hilbert Trendline
    "ALPHAT_",
    "ALPHATl_",  # Alpha Trend (price-tracking)
    # Bollinger / Keltner / Donchian / Acceleration bands (the LEVELS, not %B/%bandwidth)
    "BBL_",
    "BBM_",
    "BBU_",
    "KCLe_",
    "KCBe_",
    "KCUe_",
    "DCL_",
    "DCM_",
    "DCU_",
    "ACCBL_",
    "ACCBM_",
    "ACCBU_",
    # SuperTrend price levels (not direction flag)
    "SUPERT_",
    "SUPERTl_",
    "SUPERTs_",
    # PSAR price levels (not reversal flag)
    "PSARl_",
    "PSARs_",
    "PSARaf_",
    # Ichimoku lines (all track price)
    "ISA_",
    "ISB_",
    "ITS_",
    "IKS_",
    "ICS_",
    # Pivot points
    "PIVOTS_",
    # HILO channel
    "HILO_",
    "HILOl_",
    "HILOs_",
    # Chande Kroll Stop (price-level)
    "CKSPl_",
    "CKSPs_",
    "CHDLREXTl_",
    "CHDLREXTs_",
    # TOS StdDev bands (price levels)
    "TOS_STDEVALL_",
    # ATR Trailing Stop (price level)
    "ATRTSe_",
)

PRICE_LEVEL_EXACT = {
    "HT_TL",
    "VWAP_D",  # Volume-weighted average price
    "MEDIAN_30",  # Rolling median of price
    "QTL_30_0.5",  # Rolling quantile of price
}

# ---------------------------------------------------------------------------
# Price-unit measures -> indicator / close, then rolling z-score
# These are in absolute price units (dollars, points) not ratios.
# ---------------------------------------------------------------------------
PRICE_UNIT_PREFIXES = (
    "TRUERANGE_",
    "HWM_",
    "HWL_",
    "HWU_",
    "HWW_",  # Holt-Winter bands & width
    "STDEV_",  # Standard deviation of price
    "MAD_",  # Mean absolute deviation
    "VAR_",  # Variance of price
    "ABER_ZG_",
    "ABER_SG_",
    "ABER_XG_",  # Aberration zone/signal levels
    "BULLP_",
    "BEARP_",  # Bull/Bear power (distance from EMA)
    "PDIST",  # Price distance
    "DPO_",  # Detrended Price Oscillator
    "MOM_",  # Momentum (price difference)
)

PRICE_UNIT_EXACT = {
    "PDIST",
}

# ---------------------------------------------------------------------------
# Cumulative indicators -> rate of change (diff / rolling_std)
# These accumulate over time and trend toward infinity.
# ---------------------------------------------------------------------------
CUMULATIVE_EXACT = {
    "AD",  # Accumulation/Distribution
    "OBV",  # On Balance Volume
    "OBV_min_2",
    "OBV_max_2",
    "OBVe_4",
    "OBVe_12",  # OBV EMAs (still cumulative)
    "NVI_1",  # Negative Volume Index
    "PVI",  # Positive Volume Index
    "PVIe_255",  # PVI EMA
    "PVT",  # Price Volume Trend
}

# ---------------------------------------------------------------------------
# Already-normalized / passthrough columns
# These are already z-scores, percentile ranks, or dimensionless ratios.
# ---------------------------------------------------------------------------
PASSTHROUGH_PREFIXES = (
    "open_Z_",
    "high_Z_",
    "low_Z_",
    "close_Z_",  # Pre-computed z-scores
)

PASSTHROUGH_EXACT = {
    "ZS_30",  # Z-score (already normalized)
    "SLOPE_1",  # Price slope (already rate)
    "LOGRET_1",  # Log return (already %)
    "PCTRET_1",  # Pct return (already %)
    "BIAS_SMA_26",  # Bias (already % from MA)
}


# ==============================================================================
# Classification
# ==============================================================================


def classify_normalization(col_name: str, series: pd.Series) -> tuple[str, dict]:
    """Classify a column into its normalization type.

    Returns (type_name, params) where type_name is one of:
      skip, binary, bounded, pct_from_close, price_ratio,
      cumulative, passthrough, rolling_zscore
    """
    if col_name in SKIP_COLUMNS:
        return "skip", {}

    # 1. Binary / signal
    if col_name in BINARY_EXACT:
        return "binary", {}
    for prefix in BINARY_PREFIXES:
        if col_name.startswith(prefix):
            return "binary", {}
    if series.dtype in ("int64", "int32"):
        uniques = set(series.dropna().unique())
        if uniques.issubset({-100, -1, 0, 1, 100}):
            return "binary", {}

    # 2. Passthrough (already normalized)
    if col_name in PASSTHROUGH_EXACT:
        return "passthrough", {}
    for prefix in PASSTHROUGH_PREFIXES:
        if col_name.startswith(prefix):
            return "passthrough", {}

    # 3. Bounded oscillators
    if col_name in BOUNDED_EXACT:
        lo, hi = BOUNDED_EXACT[col_name]
        return "bounded", {"min": lo, "max": hi}
    for prefix, (lo, hi) in BOUNDED_OSCILLATORS.items():
        if col_name.startswith(prefix):
            return "bounded", {"min": lo, "max": hi}

    # 4. Price-level overlays (need close price for % distance)
    if col_name in PRICE_LEVEL_EXACT:
        return "pct_from_close", {}
    for prefix in PRICE_LEVEL_PREFIXES:
        if col_name.startswith(prefix):
            return "pct_from_close", {}

    # 5. Price-unit measures (need close price for ratio)
    if col_name in PRICE_UNIT_EXACT:
        return "price_ratio", {}
    for prefix in PRICE_UNIT_PREFIXES:
        if col_name.startswith(prefix):
            return "price_ratio", {}

    # 6. Cumulative indicators
    if col_name in CUMULATIVE_EXACT:
        return "cumulative", {}

    # 7. Everything else: rolling z-score
    return "rolling_zscore", {"window": ROLLING_WINDOW}


# ==============================================================================
# Transform Functions
# ==============================================================================


def rolling_zscore(arr: np.ndarray, window: int = ROLLING_WINDOW) -> np.ndarray:
    """Rolling z-score: (value - rolling_mean) / rolling_std, clipped.

    Uses Numba JIT for ~10-50x speedup over pandas on large arrays.
    Falls back to pandas if Numba unavailable.
    """
    try:
        return _rolling_zscore_numba(arr.astype(np.float64), window, CLIP_RANGE)
    except Exception:
        # Fallback to pandas
        series = pd.Series(arr)
        rolling_mean = series.rolling(window, min_periods=5).mean()
        rolling_std = series.rolling(window, min_periods=5).std()
        z = (series - rolling_mean) / rolling_std.replace(0, np.nan)
        z = z.clip(-CLIP_RANGE, CLIP_RANGE)
        return z.values


def _rolling_zscore_numba(arr, window, clip):
    """Numba-accelerated rolling z-score."""
    from numba import njit as _njit

    @_njit(cache=True)
    def _impl(a, w, c):
        n = len(a)
        out = np.empty(n, dtype=np.float64)
        out[:w] = np.nan
        for i in range(w, n):
            s = a[i - w : i]
            m = 0.0
            for j in range(w):
                m += s[j]
            m /= w
            v = 0.0
            for j in range(w):
                d = s[j] - m
                v += d * d
            std = np.sqrt(v / (w - 1)) if w > 1 else 1.0
            if std < 1e-12:
                out[i] = 0.0
            else:
                z = (a[i] - m) / std
                out[i] = max(-c, min(c, z))
        return out

    return _impl(arr, window, clip)


def scale_bounded(arr: np.ndarray, lo: float, hi: float) -> np.ndarray:
    """Scale bounded values to [0, 1]."""
    if hi == lo:
        return np.zeros_like(arr)
    scaled = (arr - lo) / (hi - lo)
    return np.clip(scaled, 0.0, 1.0)


def pct_from_close(indicator: np.ndarray, close: np.ndarray) -> np.ndarray:
    """Convert price-level indicator to % distance from close, then rolling z-score.

    For a moving average at 4500 with close at 4520:
      pct = (4500 - 4520) / 4520 = -0.0044  (0.44% below)
    Then rolling z-score of that pct series.
    """
    safe_close = np.where(close == 0, np.nan, close)
    pct = (indicator - close) / safe_close
    return rolling_zscore(pct)


def price_ratio(indicator: np.ndarray, close: np.ndarray) -> np.ndarray:
    """Convert price-unit measure to ratio of close, then rolling z-score.

    For ATR of 50 with close at 4500: ratio = 50/4500 = 0.011
    Then rolling z-score of that ratio series.
    """
    safe_close = np.where(close == 0, np.nan, close)
    ratio = indicator / safe_close
    return rolling_zscore(ratio)


def cumulative_roc(arr: np.ndarray, window: int = ROLLING_WINDOW) -> np.ndarray:
    """Rate of change for cumulative indicators.

    diff / rolling_std normalizes the change magnitude.
    """
    series = pd.Series(arr)
    diff = series.diff()
    rolling_std = diff.rolling(window, min_periods=5).std()
    roc = diff / rolling_std.replace(0, np.nan)
    roc = roc.clip(-CLIP_RANGE, CLIP_RANGE)
    return roc.values
