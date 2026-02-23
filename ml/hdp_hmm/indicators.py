"""
HDP-HMM Indicator Loading & Universal Normalization
====================================================

Think of it as: your 344 pre-computed technical indicators are like 344
different thermometers. Some read in Fahrenheit (price-level: SMA=5400),
some in Celsius (oscillators: RSI=70), some just say "yes/no" (candle
patterns: CDL_HAMMER=100). For a universal model, we need every thermometer
to answer the SAME question: "Is this reading unusual for THIS instrument?"

Strategy:
  - SKIP: raw OHLCV duplicates, broken columns (17 cols)
  - KEEP AS-IS: binary signals that are already 0/1 or -100/0/100 (80 cols)
  - ROLLING Z-SCORE: everything else (253 cols) -- "how unusual is this
    reading compared to this instrument's recent history?"
"""

from typing import Any, Optional

import duckdb
import numpy as np
import pandas as pd  # type: ignore[import-untyped]

from .config import (
    BINARY_EXACT,
    BINARY_PREFIXES,
    INDICATOR_GROUPS,
    INDICATORS_DIR,
    ROLLING_WINDOW,
    SKIP_COLUMNS,
    WARMUP_BARS,
)
from .features import rolling_zscore


def is_binary_column(col_name: str, series: pd.Series) -> bool:
    """Check if a column is a binary/signal type (keep as-is, no normalization)."""
    if col_name in BINARY_EXACT:
        return True
    for prefix in BINARY_PREFIXES:
        if col_name.startswith(prefix):
            return True
    # Heuristic: int64 with <= 5 unique values in {-100, -1, 0, 1, 100}
    if series.dtype in ("int64", "int32"):
        uniques = set(series.dropna().unique())
        if uniques.issubset({-100, -1, 0, 1, 100}):
            return True
    return False


def load_indicator_data(symbol: str, timeframe: str) -> pd.DataFrame:
    """
    Load pre-computed indicator parquet for a symbol+timeframe.
    Returns DataFrame with timestamp converted to match OHLCV ts format.
    """
    # Try direct file first (e.g., ES_1d.parquet)
    parquet_path = INDICATORS_DIR / f"{symbol}_{timeframe}.parquet"
    if not parquet_path.exists():
        # Try subdirectory (e.g., 1d/ES_1d.parquet)
        parquet_path = INDICATORS_DIR / timeframe / f"{symbol}_{timeframe}.parquet"
    if not parquet_path.exists():
        return pd.DataFrame()

    conn = duckdb.connect(":memory:")
    fpath = str(parquet_path).replace("\\", "/")
    df = conn.execute(f"SELECT * FROM read_parquet('{fpath}')").fetchdf()
    conn.close()

    # Convert epoch-seconds timestamp to pandas Timestamp for joining with OHLCV
    if "timestamp" in df.columns:
        df["ts"] = pd.to_datetime(df["timestamp"], unit="s")
    return df


def normalize_indicators(
    ind_df: pd.DataFrame,
    groups: Optional[list[Any]] = None,
    window: int = ROLLING_WINDOW,
) -> pd.DataFrame:
    """
    Normalize indicator columns for universal cross-symbol training.

    Think of it as: running every indicator through the same "unusual-for-me?"
    filter. SMA_200 at 5400 on ES and SMA_200 at 1.08 on EURUSD both become
    "how far is this MA from where it usually sits?" -- a number near 0 means
    normal, +2 means unusually high, -2 means unusually low.

    Args:
        ind_df: Raw indicator DataFrame (from load_indicator_data)
        groups: List of indicator group names to include (None = all non-skip)
        window: Rolling z-score window size

    Returns:
        DataFrame with 'ts' + normalized indicator columns
    """
    if ind_df.empty or "ts" not in ind_df.columns:
        return pd.DataFrame()

    result = pd.DataFrame()
    result["ts"] = ind_df["ts"]

    # Determine which columns to include
    if groups:
        # Only include columns from specified groups
        wanted_cols: set[str] = set()
        for g in groups:
            if g in INDICATOR_GROUPS:
                wanted_cols.update(INDICATOR_GROUPS[g])
        candidate_cols = [c for c in ind_df.columns if c in wanted_cols]
    else:
        # Include all non-skip columns
        candidate_cols = [
            c for c in ind_df.columns if c not in SKIP_COLUMNS and c != "ts"
        ]

    n_binary = 0
    n_zscore = 0
    n_skipped = 0

    for col in candidate_cols:
        if col in SKIP_COLUMNS:
            n_skipped += 1
            continue

        series = ind_df[col]

        # Check if too many NaNs (>80% missing = useless)
        nan_frac = series.isna().mean()
        if nan_frac > 0.8:
            n_skipped += 1
            continue

        if is_binary_column(col, series):
            # Binary signals: keep as-is (already universal)
            result[col] = series.fillna(0).values
            n_binary += 1
        else:
            # Everything else: rolling z-score for universality
            # Suffix with _z to indicate normalized
            z_col = f"{col}_z" if not col.endswith("_z") else col
            result[z_col] = rolling_zscore(np.asarray(series.values), window)
            n_zscore += 1

    # Trim warmup bars and clean
    result = result.iloc[WARMUP_BARS:].copy()
    result = result.replace([np.inf, -np.inf], 0)
    result = result.fillna(0)

    print(
        f"    Indicators: {n_zscore} z-scored, {n_binary} binary, {n_skipped} skipped"
    )
    return result


def merge_features_with_indicators(
    feat_df: pd.DataFrame,
    symbol: str,
    timeframe: str,
    indicator_groups: Optional[list[Any]] = None,
) -> pd.DataFrame:
    """
    Load indicator parquet, normalize it, and merge with core features.

    Think of it as: your core 12 features are the vital signs (heart rate,
    blood pressure, temperature). The indicators are specialist lab results
    (blood tests, imaging, hormone levels). We normalize the lab results
    the same way -- "unusual for you?" -- and add them to the patient chart.

    Returns:
        Merged DataFrame with core features + normalized indicators
    """
    ind_df = load_indicator_data(symbol, timeframe)
    if ind_df.empty:
        print(f"    No indicator data found for {symbol}_{timeframe}")
        return feat_df

    norm_df = normalize_indicators(ind_df, groups=indicator_groups)
    if norm_df.empty or len(norm_df) == 0:
        return feat_df

    # Merge on timestamp -- indicators may have slightly different row counts
    # due to different warmup periods
    merged = pd.merge(feat_df, norm_df, on="ts", how="inner")

    indicator_cols = [c for c in merged.columns if c not in feat_df.columns]
    print(
        f"    Merged {len(indicator_cols)} indicator features ({len(merged)} bars after join)"
    )
    return merged
