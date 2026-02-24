"""
HDP-HMM Indicator Loading & 4-Tier Universal Normalization
==========================================================

344 pre-computed technical indicators fall into four categories:

  1. SKIP: raw OHLCV duplicates, broken columns (~17 cols)
  2. BINARY: candle patterns, squeeze signals — already 0/1 or -100/0/100 (~80 cols)
  3. BOUNDED: oscillators with known universal ranges (RSI 0-100, WILLR -100-0,
     Stoch 0-100, etc.) — rescaled to 0-1 via (x - lo) / (hi - lo).
     These preserve absolute meaning: RSI=70 means overbought on ANY instrument.
  4. UNBOUNDED: price-level indicators (SMA, EMA, MACD, OBV, etc.) — rolling
     z-score normalizes to "how unusual is this reading for THIS instrument?"

Standalone: reads parquet files via pyarrow/pandas. No DuckDB required.
"""

from typing import Any, Optional

import numpy as np
import pandas as pd  # type: ignore[import-untyped]

from .config import (
    ALREADY_NORMALIZED_PREFIXES,
    BINARY_EXACT,
    BINARY_PREFIXES,
    BOUNDED_COLUMNS,
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


def get_bounded_range(col_name: str) -> Optional[tuple[float, float]]:
    """Return (lo, hi) if column is a bounded oscillator, else None."""
    for prefix, bounds in BOUNDED_COLUMNS.items():
        if col_name.startswith(prefix):
            return bounds
    return None


def is_already_normalized(col_name: str) -> bool:
    """Check if column is already on a 0-1 or z-score scale (keep as-is)."""
    for prefix in ALREADY_NORMALIZED_PREFIXES:
        if col_name.startswith(prefix):
            return True
    return False


def rescale_bounded(values: np.ndarray, lo: float, hi: float) -> np.ndarray:
    """Rescale bounded oscillator to 0-1 range. Clips outliers."""
    span = hi - lo  # range of the oscillator
    if span <= 0:
        return np.zeros_like(values)
    return np.clip((values - lo) / span, 0.0, 1.0)


def load_indicator_data(symbol: str, timeframe: str) -> pd.DataFrame:
    """
    Load pre-computed indicator parquet for a symbol+timeframe.
    Returns DataFrame with timestamp converted to match OHLCV ts format.

    Supports both formats:
      - Flat file: data/indicators/{symbol}_{timeframe}.parquet
      - Partitioned: data/indicators/{timeframe}/{symbol}/{category}.parquet

    Standalone: uses pandas/pyarrow — no DuckDB required.
    """
    # Try partitioned directory first (current format from compute-indicators.py)
    partitioned_dir = INDICATORS_DIR / timeframe / symbol
    if partitioned_dir.is_dir():
        parquet_files = sorted(partitioned_dir.glob("*.parquet"))
        if parquet_files:
            dfs = []
            for pf in parquet_files:
                part_df = pd.read_parquet(pf)
                dfs.append(part_df)

            # Merge all category DataFrames on timestamp
            merged = dfs[0]
            for part_df in dfs[1:]:
                # Drop duplicate columns (timestamp appears in every file)
                new_cols = [c for c in part_df.columns if c not in merged.columns]
                if "timestamp" in part_df.columns:
                    part_df = part_df[["timestamp"] + new_cols]
                    merged = pd.merge(merged, part_df, on="timestamp", how="inner")
                else:
                    # No timestamp column — concat by index
                    merged = pd.concat([merged, part_df[new_cols]], axis=1)

            if "timestamp" in merged.columns:
                merged["ts"] = pd.to_datetime(merged["timestamp"], unit="s")
            return merged

    # Fallback: flat file (e.g., ES_1d.parquet)
    parquet_path = INDICATORS_DIR / f"{symbol}_{timeframe}.parquet"
    if not parquet_path.exists():
        parquet_path = INDICATORS_DIR / timeframe / f"{symbol}_{timeframe}.parquet"
    if not parquet_path.exists():
        return pd.DataFrame()

    df = pd.read_parquet(parquet_path)

    if "timestamp" in df.columns:
        df["ts"] = pd.to_datetime(df["timestamp"], unit="s")
    return df


def normalize_indicators(
    ind_df: pd.DataFrame,
    groups: Optional[list[Any]] = None,
    window: int = ROLLING_WINDOW,
) -> pd.DataFrame:
    """
    4-tier normalization of indicator columns for universal cross-symbol training.

    Tiers:
      1. SKIP — raw OHLCV duplicates, broken data (dropped entirely)
      2. BINARY — candle patterns, squeeze flags (kept as-is)
      3. BOUNDED — oscillators with known (lo, hi) (rescaled to 0-1)
      4. UNBOUNDED — price-level or cumulative indicators (rolling z-score)

    Args:
        ind_df: Raw indicator DataFrame (from load_indicator_data)
        groups: List of indicator group names to include (None = all non-skip)
        window: Rolling z-score window size for unbounded indicators

    Returns:
        DataFrame with 'ts' + normalized indicator columns
    """
    if ind_df.empty or "ts" not in ind_df.columns:
        return pd.DataFrame()

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

    # Collect all columns in a dict first (avoids DataFrame fragmentation warning)
    col_data: dict[str, np.ndarray] = {"ts": ind_df["ts"].values}

    # Counters for diagnostics
    n_binary = 0
    n_bounded = 0
    n_already = 0
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

        # --- Tier 2: Binary signals (keep as-is) ---
        if is_binary_column(col, series):
            col_data[col] = series.fillna(0).values
            n_binary += 1
            continue

        # --- Tier 3a: Already normalized (BBP, ER, ZS) — keep as-is ---
        if is_already_normalized(col):
            col_data[col] = series.fillna(0).values
            n_already += 1
            continue

        # --- Tier 3b: Bounded oscillators — rescale to 0-1 ---
        bounds = get_bounded_range(col)
        if bounds is not None:
            lo, hi = bounds
            col_data[col] = rescale_bounded(
                series.fillna((lo + hi) / 2.0).values,  # NaN → midpoint
                lo,
                hi,
            )
            n_bounded += 1
            continue

        # --- Tier 4: Unbounded — rolling z-score ---
        z_col = f"{col}_z" if not col.endswith("_z") else col
        col_data[z_col] = rolling_zscore(np.asarray(series.values), window)
        n_zscore += 1

    # Build DataFrame from dict (no fragmentation)
    result = pd.DataFrame(col_data)
    result["ts"] = pd.to_datetime(result["ts"])

    # Trim warmup bars and clean
    result = result.iloc[WARMUP_BARS:].copy()
    result = result.replace([np.inf, -np.inf], 0)
    result = result.fillna(0)

    print(
        f"    Indicators: {n_bounded} bounded(0-1), {n_zscore} z-scored, "
        f"{n_binary} binary, {n_already} pre-normalized, {n_skipped} skipped"
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

    Core 12 features are the vital signs (heart rate, blood pressure, temp).
    The indicators are specialist lab results — bounded labs (RSI, Stoch)
    are rescaled to 0-1 preserving absolute meaning, unbounded labs (SMA, MACD)
    are z-scored to answer "unusual for this patient?"

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

    # Merge on timestamp — indicators may have slightly different row counts
    # due to different warmup periods
    merged = pd.merge(feat_df, norm_df, on="ts", how="inner")

    indicator_cols = [c for c in merged.columns if c not in feat_df.columns]
    print(
        f"    Merged {len(indicator_cols)} indicator features ({len(merged)} bars after join)"
    )
    return merged
