"""
HDP-HMM Configuration
=====================

Centralized paths, constants, symbol lists, feature definitions,
and indicator group mappings used across all HDP-HMM modules.
"""

from pathlib import Path

# ==============================================================================
# Paths
# ==============================================================================

SCRIPT_DIR = Path(__file__).parent
PROJECT_DIR = SCRIPT_DIR.parent.parent
DB_PATH = PROJECT_DIR / "data" / "market.duckdb"
OUTPUT_DIR = PROJECT_DIR / "data" / "models" / "hdp-hmm"
INDICATORS_DIR = PROJECT_DIR / "data" / "indicators"

# ==============================================================================
# Timeframe Map (label -> seconds)
# ==============================================================================

TIMEFRAME_MAP = {
    "1m": 60,
    "5m": 300,
    "15m": 900,
    "30m": 1800,
    "1h": 3600,
    "1H": 3600,
    "4h": 14400,
    "4H": 14400,
    "1d": 86400,
    "1D": 86400,
    "1w": 604800,
    "1W": 604800,
}

# ==============================================================================
# Symbol Lists
# ==============================================================================

ALL_SYMBOLS = [
    "ES",
    "NQ",
    "MNQ",
    "YM",
    "RTY",
    "CL",
    "GC",
    "ZB",
    "EURUSD",
    "GBPUSD",
    "USDJPY",
    "AUDUSD",
    "USDCAD",
    "NZDUSD",
    "USDCHF",
    "EURJPY",
    "GBPJPY",
    "EURGBP",
    "AUDCAD",
    "AUDNZD",
    "CADJPY",
    "CHFJPY",
    "EURAUD",
    "EURNZD",
]

# ==============================================================================
# Feature Definitions
# ==============================================================================

DEFAULT_FEATURES = [
    "log_return_z",  # Rolling z-score of log returns (self-referential)
    "range_pct_z",  # Rolling z-score of bar range % (vs own recent history)
    "body_pct_z",  # Rolling z-score of body size % (vs own recent history)
    "upper_wick_pct",  # Already 0-1 (fraction of bar range) — universal
    "lower_wick_pct",  # Already 0-1 (fraction of bar range) — universal
    "vol_rank",  # Rolling percentile rank of volume (0-1, universal)
    "atr_ratio",  # Current range / rolling avg range — already universal ratio
    "trend_5_z",  # Rolling z-score of 5-bar momentum
    "trend_20_z",  # Rolling z-score of 20-bar momentum
    "vol_ratio_5_20",  # Short/long vol ratio — already universal dimensionless
    "range_rank",  # Rolling percentile rank of bar range (0-1)
    "return_rank",  # Rolling percentile rank of absolute return (0-1)
]

WARMUP_BARS = 50  # Increased for rolling z-score windows (need 50-bar lookback)
ROLLING_WINDOW = 50  # Window for rolling z-scores — self-referential normalization

# ==============================================================================
# Indicator Column Filtering
# ==============================================================================

# Columns to completely skip (raw price/volume duplicates or broken data)
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

# Prefixes that are always binary/signal type (keep as-is, no normalization)
BINARY_PREFIXES = (
    "CDL_",  # candle patterns: -100, 0, 100
    "AMATe_",  # Archer MA signal: 0/1
    "AOBV_",  # Archer OBV signal: 0/1
    "EXHC_",  # exhaustion count: small integers
)

# Exact column names that are binary/signal
BINARY_EXACT = {
    "DEC_1",
    "INC_1",
    "PSARr_0.02_0.2",
    "SQZ_NO",
    "SQZ_ON",
    "SQZ_OFF",
    "SQZPRO_NO",
    "SQZPRO_OFF",
    "SQZPRO_ON_NARROW",
    "SQZPRO_ON_NORMAL",
    "SQZPRO_ON_WIDE",
    "SUPERTd_7_3.0",
    "CHDLREXTd_22_22_14_2.0",
    "THERMOl_20_2_0.5",
    "THERMOs_20_2_0.5",
    "SMCbf_14_50_20_5",
    "SMChv_14_50_20_5",
    "SMCtf_14_50_20_5",
    "TMOM_14_5_3",
    "TMOMs_14_5_3",
    "PVR",
}

# ==============================================================================
# Bounded Oscillator Rescaling
# ==============================================================================
# Indicators with fixed universal ranges that should be rescaled to 0-1
# instead of z-scored. Key: column prefix. Value: (min, max) of the raw range.
# Rescale formula: np.clip((x - lo) / (hi - lo), 0, 1)

BOUNDED_COLUMNS: dict[str, tuple[float, float]] = {
    # --- 0 to 100 oscillators (rescale: x / 100) ---
    "RSI_": (0.0, 100.0),  # Relative Strength Index
    "RSX_": (0.0, 100.0),  # Relative Strength Xtra (Jurik smoothed RSI)
    "STOCHk_": (0.0, 100.0),  # Stochastic %K
    "STOCHd_": (0.0, 100.0),  # Stochastic %D
    "STOCHRSIk_": (0.0, 100.0),  # StochRSI %K
    "STOCHRSId_": (0.0, 100.0),  # StochRSI %D
    "MFI_": (0.0, 100.0),  # Money Flow Index
    "UO_": (0.0, 100.0),  # Ultimate Oscillator
    "ADX_": (0.0, 100.0),  # Average Directional Index
    "ADXR_": (0.0, 100.0),  # ADX Rating
    "AROONU_": (0.0, 100.0),  # Aroon Up
    "AROOND_": (0.0, 100.0),  # Aroon Down
    "DMP_": (0.0, 100.0),  # Directional Movement Plus
    "DMN_": (0.0, 100.0),  # Directional Movement Minus
    "CHOP_": (0.0, 100.0),  # Choppiness Index
    "STC_": (0.0, 100.0),  # Schaff Trend Cycle
    "INERTIA_": (0.0, 100.0),  # Inertia (RSI of linear regression slope)
    # --- -100 to 0 oscillators ---
    "WILLR_": (-100.0, 0.0),  # Williams %R
    # --- -100 to 100 oscillators ---
    "CMO_": (-100.0, 100.0),  # Chande Momentum Oscillator
    "AROONOSC_": (-100.0, 100.0),  # Aroon Oscillator
    "TSI_": (-100.0, 100.0),  # True Strength Index (line)
    "TSIs_": (-100.0, 100.0),  # True Strength Index (signal)
    # --- -1 to 1 oscillators ---
    "CTI_": (-1.0, 1.0),  # Correlation Trend Indicator
    "EBSW_": (-1.0, 1.0),  # Even Better Sinewave
    # --- 0 to ~3 (vortex, clip to 1 after rescale) ---
    "VTXP_": (0.0, 3.0),  # Vortex Positive
    "VTXM_": (0.0, 3.0),  # Vortex Negative
}

# Columns already on a normalized 0-1 or z-score scale — keep as-is
ALREADY_NORMALIZED_PREFIXES = (
    "BBP_",  # Bollinger %B: ~0 to 1
    "ER_",  # Efficiency Ratio: 0 to 1
    "ZS_",  # Already a z-score
)

# ==============================================================================
# Indicator Groups for Selective Inclusion
# ==============================================================================

INDICATOR_GROUPS: dict[str, list[str]] = {
    "momentum": [
        "RSI_14",
        "RSI_7",
        "RSI_21",
        "RSX_14",
        "STOCHk_14_3_3",
        "STOCHd_14_3_3",
        "STOCHRSIk_14_14_3_3",
        "STOCHRSId_14_14_3_3",
        "WILLR_14",
        "CCI_14_0.015",
        "CMO_14",
        "MFI_14",
        "UO_7_14_28",
        "ROC_10",
        "ROC_20",
        "PPO_12_26_9",
        "PPOh_12_26_9",
        "TSI_13_25_13",
        "TSIs_13_25_13",
        "AO_5_34",
        "APO_12_26",
        "MACD_12_26_9",
        "MACDh_12_26_9",
        "MACDs_12_26_9",
    ],
    "trend": [
        "ADX_14",
        "ADXR_14_2",
        "AROONU_14",
        "AROOND_14",
        "AROONOSC_14",
        "DMP_14",
        "DMN_14",
        "VTXP_14",
        "VTXM_14",
        "CHOP_14_1_100.0",
        "VHF_28",
        "SUPERT_7_3.0",
        "SUPERTd_7_3.0",
        "PSARl_0.02_0.2",
        "PSARs_0.02_0.2",
        "STC_10_12_26_0.5",
        "INERTIA_20_14",
        "ER_10",
    ],
    "volatility": [
        "ATRr_14",
        "NATR_14",
        "TRUERANGE_1",
        "BBB_5_2.0_2.0",
        "BBP_5_2.0_2.0",
        "KCBe_20_2",
        "KCLe_20_2",
        "KCUe_20_2",
        "SQZ_20_2.0_20_1.5",
        "ABER_ATR_5_15",
        "UI_14",
        "THERMO_20_2_0.5",
        "STDEV_30",
        "MAD_30",
        "HWW_1",
    ],
    "volume": [
        "AD",
        "ADOSC_3_10",
        "OBV",
        "CMF_20",
        "EFI_13",
        "MFI_14",
        "KVO_34_55_13",
        "KVOs_34_55_13",
        "NVI_1",
        "PVI",
        "PVT",
        "EOM_14_100000000",
        "TSV_18_10",
        "PVO_12_26_9",
        "PVOh_12_26_9",
    ],
    "overlap": [
        "SMA_10",
        "SMA_50",
        "SMA_200",
        "EMA_10",
        "EMA_50",
        "EMA_200",
        "BBL_5_2.0_2.0",
        "BBM_5_2.0_2.0",
        "BBU_5_2.0_2.0",
        "DEMA_10",
        "TEMA_10",
        "KAMA_10_2_30",
        "HMA_10",
        "VWAP_D",
    ],
    "candle": [
        "CDL_DOJI_10_0.1",
        "CDL_HAMMER",
        "CDL_ENGULFING",
        "CDL_MORNINGSTAR",
        "CDL_EVENINGSTAR",
        "CDL_SHOOTINGSTAR",
        "CDL_HANGINGMAN",
        "CDL_3WHITESOLDIERS",
        "CDL_3BLACKCROWS",
        "CDL_MARUBOZU",
        "CDL_SPINNINGTOP",
        "CDL_HARAMI",
        "CDL_PIERCING",
        "CDL_DARKCLOUDCOVER",
    ],
    "statistics": [
        "ZS_30",
        "ENTP_10",
        "KURT_30",
        "SKEW_30",
        "LOGRET_1",
        "PCTRET_1",
        "BIAS_SMA_26",
    ],
    "cycle": [
        "EBSW_40_10",
        "REFLEX_20_20_0.04",
        "TRENDFLEX_20_20_0.04",
        "FISHERT_9_1",
        "FISHERTs_9_1",
        "CG_10",
        "CTI_12",
    ],
}

# Default groups when --include-indicators is used without specifying groups
# ALL groups included by default -- the whole point is to use all 340+ features
DEFAULT_INDICATOR_GROUPS = [
    "momentum",
    "trend",
    "volatility",
    "volume",
    "overlap",
    "candle",
    "statistics",
    "cycle",
]
