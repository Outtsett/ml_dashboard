"""
Normalize pre-computed indicator parquets for model consumption.

Reads raw 344-indicator parquets from data/indicators/{tf}/{symbol}/
and produces normalized versions in data/features/{tf}/{symbol}/.

Normalization rules (from ml/hdp_hmm/config.py):
  - Binary/pattern columns (CDL_*, signal flags): Pass through as-is
  - Bounded oscillators (RSI, Stochastic, Williams %R): Scale to [0, 1]
  - Unbounded continuous (everything else): Rolling z-score, clip [-5, 5]
  - Skip broken columns (HWPCT_1 etc.)

Output:
    data/features/{tf}/{symbol}/normalized.parquet
    data/features/{tf}/{symbol}/normalization_stats.json

Usage:
    python scripts/normalize-indicators.py
    python scripts/normalize-indicators.py --symbols ES,MNQ --timeframes 1d,1h
    python scripts/normalize-indicators.py --force

Requires: pandas, numpy, pyarrow, duckdb
"""

import argparse
import json
import os
import sys
import time
import warnings
from datetime import datetime, timezone
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd

warnings.filterwarnings("ignore", category=RuntimeWarning)

# ==============================================================================
# Configuration
# ==============================================================================

ROOT = Path(__file__).resolve().parent.parent
INDICATORS_DIR = ROOT / "data" / "indicators"
FEATURES_DIR = ROOT / "data" / "features"

ROLLING_WINDOW = 50
CLIP_RANGE = 5.0

# Columns to completely skip (raw OHLCV duplicates or broken data)
SKIP_COLUMNS = {
    "timestamp", "ts", "open", "high", "low", "close", "volume",
    "HA_open", "HA_high", "HA_low", "HA_close",
    "HL2", "HLC3", "OHLC4", "WCP",
    "MIDPOINT_2", "MIDPRICE_2",
    "HWPCT_1",  # numerically broken (values reach +/-2.6e15)
}

# Prefixes that are binary/signal type (keep as-is)
BINARY_PREFIXES = (
    "CDL_",     # candle patterns: -100, 0, 100
    "AMATe_",   # Archer MA signal: 0/1
    "AOBV_",    # Archer OBV signal: 0/1
    "EXHC_",    # exhaustion count: small integers
)

# Exact column names that are binary/signal
BINARY_EXACT = {
    "DEC_1", "INC_1",
    "PSARr_0.02_0.2",
    "SQZ_NO", "SQZ_ON", "SQZ_OFF",
    "SQZPRO_NO", "SQZPRO_OFF", "SQZPRO_ON_NARROW", "SQZPRO_ON_NORMAL", "SQZPRO_ON_WIDE",
    "SUPERTd_7_3.0", "CHDLREXTd_22_22_14_2.0",
    "THERMOl_20_2_0.5", "THERMOs_20_2_0.5",
    "SMCbf_14_50_20_5", "SMChv_14_50_20_5", "SMCtf_14_50_20_5",
    "TMOM_14_5_3", "TMOMs_14_5_3", "PVR",
}

# Bounded oscillators that should be scaled to [0, 1]
# These have known ranges (0-100, -100 to 0, 0-1, etc.)
BOUNDED_OSCILLATORS = {
    # RSI family: 0-100
    "RSI_": (0, 100),
    "RSX_": (0, 100),
    "STOCHk_": (0, 100),
    "STOCHd_": (0, 100),
    "STOCHRSIk_": (0, 100),
    "STOCHRSId_": (0, 100),
    "MFI_": (0, 100),
    "CMO_": (-100, 100),
    "CCI_": (-200, 200),  # typical range, will clip
    "WILLR_": (-100, 0),
    "UO_": (0, 100),
    "ADX_": (0, 100),
    "ADXR_": (0, 100),
    "AROONU_": (0, 100),
    "AROOND_": (0, 100),
    "AROONOSC_": (-100, 100),
    "CHOP_": (0, 100),
    "BBP_": (0, 1),   # Bollinger %B: typically 0-1
    "BBB_": (0, 1),   # Bollinger bandwidth: already ratio
    # Normalized ATR is already a ratio
    "NATR_": (0, 100),
}


# ==============================================================================
# Classification
# ==============================================================================


def classify_normalization(col_name: str, series: pd.Series) -> tuple[str, dict]:
    """Classify a column into its normalization type.

    Returns (type_name, params) where type_name is one of:
      - "binary": pass through as-is
      - "bounded": scale to [0, 1] with known min/max
      - "rolling_zscore": rolling z-score, clip to [-5, 5]
      - "skip": exclude from output
    """
    if col_name in SKIP_COLUMNS:
        return "skip", {}

    # Binary checks
    if col_name in BINARY_EXACT:
        return "binary", {}
    for prefix in BINARY_PREFIXES:
        if col_name.startswith(prefix):
            return "binary", {}
    # Heuristic: int columns with few unique values in signal range
    if series.dtype in ("int64", "int32"):
        uniques = set(series.dropna().unique())
        if uniques.issubset({-100, -1, 0, 1, 100}):
            return "binary", {}

    # Bounded oscillator checks
    for prefix, (lo, hi) in BOUNDED_OSCILLATORS.items():
        if col_name.startswith(prefix):
            return "bounded", {"min": lo, "max": hi}

    # Everything else: rolling z-score
    return "rolling_zscore", {"window": ROLLING_WINDOW}


def rolling_zscore(arr: np.ndarray, window: int = ROLLING_WINDOW) -> np.ndarray:
    """Compute rolling z-score: (value - rolling_mean) / rolling_std, clipped."""
    series = pd.Series(arr)
    rolling_mean = series.rolling(window, min_periods=5).mean()
    rolling_std = series.rolling(window, min_periods=5).std()
    z = (series - rolling_mean) / rolling_std.replace(0, np.nan)
    z = z.clip(-CLIP_RANGE, CLIP_RANGE)
    return z.values


def scale_bounded(arr: np.ndarray, lo: float, hi: float) -> np.ndarray:
    """Scale bounded values to [0, 1]."""
    if hi == lo:
        return np.zeros_like(arr)
    scaled = (arr - lo) / (hi - lo)
    return np.clip(scaled, 0.0, 1.0)


# ==============================================================================
# Main Processing
# ==============================================================================


def normalize_symbol_timeframe(
    symbol: str,
    timeframe: str,
    force: bool = False,
) -> dict | None:
    """Normalize all indicators for one symbol/timeframe combo.

    Returns metadata dict or None if skipped.
    """
    indicator_dir = INDICATORS_DIR / timeframe / symbol
    meta_path = indicator_dir / "_meta.json"

    if not meta_path.exists():
        return None

    output_dir = FEATURES_DIR / timeframe / symbol
    normalized_path = output_dir / "normalized.parquet"
    stats_path = output_dir / "normalization_stats.json"

    # Skip if already normalized (unless force)
    if normalized_path.exists() and not force:
        # Check if indicators are newer than normalized output
        ind_mtime = meta_path.stat().st_mtime
        norm_mtime = normalized_path.stat().st_mtime
        if norm_mtime >= ind_mtime:
            return {"status": "skipped", "symbol": symbol, "timeframe": timeframe}

    # Read indicator metadata
    with open(meta_path) as f:
        ind_meta = json.load(f)

    # Load all category parquets and join on timestamp
    conn = duckdb.connect(":memory:")
    all_dfs = []

    for category in sorted(ind_meta.get("categories", {}).keys()):
        cat_path = indicator_dir / f"{category}.parquet"
        if not cat_path.exists():
            continue
        safe_path = str(cat_path).replace("\\", "/")
        df = conn.execute(f"SELECT * FROM read_parquet('{safe_path}')").fetchdf()
        all_dfs.append(df)

    conn.close()

    if not all_dfs:
        return None

    # Merge all categories on timestamp
    merged = all_dfs[0]
    for df in all_dfs[1:]:
        merged = pd.merge(merged, df, on="timestamp", how="inner")

    if len(merged) < 100:
        print(f"  [{symbol}/{timeframe}] Skip: only {len(merged)} rows (need 100+)")
        return None

    # Build normalized output
    result = pd.DataFrame()
    result["timestamp"] = merged["timestamp"]

    stats: dict[str, dict] = {}
    n_binary = 0
    n_bounded = 0
    n_zscore = 0
    n_skipped = 0

    indicator_cols = [c for c in merged.columns if c != "timestamp"]

    for col in indicator_cols:
        series = merged[col]

        # Skip columns with >80% NaN
        nan_frac = series.isna().mean()
        if nan_frac > 0.8:
            n_skipped += 1
            continue

        norm_type, params = classify_normalization(col, series)

        if norm_type == "skip":
            n_skipped += 1
            continue
        elif norm_type == "binary":
            result[col] = series.fillna(0).values
            stats[col] = {"type": "binary"}
            n_binary += 1
        elif norm_type == "bounded":
            lo, hi = params["min"], params["max"]
            result[col] = scale_bounded(series.fillna((lo + hi) / 2).values, lo, hi)
            stats[col] = {"type": "bounded", "min": lo, "max": hi}
            n_bounded += 1
        elif norm_type == "rolling_zscore":
            window = params["window"]
            z_values = rolling_zscore(series.values, window)
            # Replace NaN/inf from warmup period with 0
            z_values = np.nan_to_num(z_values, nan=0.0, posinf=CLIP_RANGE, neginf=-CLIP_RANGE)
            result[col] = z_values.astype(np.float32)

            # Store stats for this column
            valid = series.dropna()
            stats[col] = {
                "type": "rolling_zscore",
                "window": window,
                "clip": CLIP_RANGE,
                "mean": round(float(valid.mean()), 6) if len(valid) > 0 else 0,
                "std": round(float(valid.std()), 6) if len(valid) > 0 else 1,
            }
            n_zscore += 1

    # Downcast float64 -> float32 for space efficiency
    for col in result.columns:
        if result[col].dtype == "float64":
            result[col] = result[col].astype("float32")

    # Write output
    output_dir.mkdir(parents=True, exist_ok=True)

    result.to_parquet(
        str(normalized_path),
        index=False,
        engine="pyarrow",
        compression="zstd",
        compression_level=3,
    )

    # Write normalization stats
    norm_stats = {
        "computed_at": datetime.now(timezone.utc).isoformat(),
        "source_indicators": str(meta_path),
        "symbol": symbol,
        "timeframe": timeframe,
        "row_count": len(result),
        "columns_total": len(result.columns) - 1,  # exclude timestamp
        "columns_binary": n_binary,
        "columns_bounded": n_bounded,
        "columns_zscore": n_zscore,
        "columns_skipped": n_skipped,
        "rolling_window": ROLLING_WINDOW,
        "clip_range": CLIP_RANGE,
        "columns": stats,
    }

    with open(stats_path, "w") as f:
        json.dump(norm_stats, f, indent=2)

    file_size_mb = normalized_path.stat().st_size / (1024 * 1024)
    n_total = n_binary + n_bounded + n_zscore
    print(
        f"  [{symbol}/{timeframe}] {len(result):,} rows, {n_total} columns "
        f"({n_zscore} z-scored, {n_bounded} bounded, {n_binary} binary, {n_skipped} skipped) "
        f"-> {file_size_mb:.1f}MB",
        flush=True,
    )

    return {
        "status": "computed",
        "symbol": symbol,
        "timeframe": timeframe,
        "rows": len(result),
        "columns": n_total,
        "size_mb": round(file_size_mb, 1),
    }


# ==============================================================================
# Main
# ==============================================================================


def main():
    parser = argparse.ArgumentParser(
        description="Normalize pre-computed indicators for model consumption",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Output: data/features/{timeframe}/{symbol}/normalized.parquet
        data/features/{timeframe}/{symbol}/normalization_stats.json

Examples:
  python scripts/normalize-indicators.py                          # All computed indicators
  python scripts/normalize-indicators.py --symbols ES,MNQ         # Specific symbols
  python scripts/normalize-indicators.py --timeframes 1d,1h       # Specific timeframes
  python scripts/normalize-indicators.py --force                   # Recompute all
        """,
    )
    parser.add_argument("--symbols", type=str, help="Comma-separated symbols (default: all)")
    parser.add_argument("--timeframes", type=str, help="Comma-separated timeframes (default: all)")
    parser.add_argument("--force", action="store_true", help="Overwrite existing normalized files")
    args = parser.parse_args()

    total_start = time.time()
    FEATURES_DIR.mkdir(parents=True, exist_ok=True)

    if not INDICATORS_DIR.exists():
        print("[normalize] No indicators directory found. Run compute-indicators.py first.")
        sys.exit(1)

    # Discover all symbol/timeframe combos from indicators dir
    combos: list[tuple[str, str]] = []
    for tf_dir in sorted(INDICATORS_DIR.iterdir()):
        if not tf_dir.is_dir():
            continue
        tf = tf_dir.name
        if args.timeframes:
            selected_tfs = set(args.timeframes.lower().split(","))
            if tf.lower() not in selected_tfs:
                continue
        for sym_dir in sorted(tf_dir.iterdir()):
            if not sym_dir.is_dir():
                continue
            sym = sym_dir.name
            if args.symbols:
                selected_syms = set(args.symbols.upper().split(","))
                if sym.upper() not in selected_syms:
                    continue
            if (sym_dir / "_meta.json").exists():
                combos.append((sym, tf))

    print(f"[normalize] Found {len(combos)} symbol/timeframe combinations to normalize")
    print(f"[normalize] Output: data/features/{{timeframe}}/{{symbol}}/normalized.parquet")
    print()

    computed = 0
    skipped = 0
    errors = 0

    for i, (sym, tf) in enumerate(combos, 1):
        try:
            result = normalize_symbol_timeframe(sym, tf, force=args.force)
            if result is None:
                errors += 1
            elif result["status"] == "skipped":
                skipped += 1
            else:
                computed += 1
        except Exception as e:
            print(f"  [{sym}/{tf}] ERROR: {e}", flush=True)
            errors += 1

        if i % 20 == 0:
            print(f"[normalize] Progress: {i}/{len(combos)}", flush=True)

    total_time = time.time() - total_start

    # Summary
    print(f"\n{'=' * 60}")
    print(f"[normalize] Finished in {total_time:.0f}s")
    print(f"  Computed: {computed}")
    print(f"  Skipped:  {skipped}")
    print(f"  Errors:   {errors}")

    # Disk usage
    total_bytes = 0
    file_count = 0
    for p in FEATURES_DIR.rglob("*.parquet"):
        total_bytes += p.stat().st_size
        file_count += 1
    print(f"  Files:    {file_count} parquets")
    print(f"  Disk:     {total_bytes / (1024**3):.2f} GB")
    print(f"{'=' * 60}")


if __name__ == "__main__":
    main()
