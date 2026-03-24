"""
Normalize pre-computed indicator parquets for model consumption.

Reads raw 344-indicator parquets from data/{futures|forex}/{symbol}/{tf}/
and produces normalized versions in data/features/{futures|forex}/{symbol}/{tf}/.

Normalization types (7 categories):
  1. skip         - Raw OHLCV duplicates, broken columns (HWPCT_1)
  2. binary       - CDL_* candle patterns, signal flags (0/1/-1)
  3. bounded      - Oscillators with known range (RSI 0-100, etc.) -> scale [0,1]
  4. pct_from_close - Price-level overlays (SMA, EMA, BB bands, SUPERT, PSAR,
                     Ichimoku, Pivots, VWAP) -> (indicator - close) / close
                     then rolling z-score
  5. price_ratio  - Price-unit measures (ATR, TRUERANGE, STDEV, HW bands)
                     -> indicator / close, then rolling z-score
  6. cumulative   - Cumulative volume (OBV, AD, PVT, NVI, PVI)
                     -> rate of change (diff / rolling_std)
  7. rolling_zscore - Unbounded oscillators (MACD, AO, MOM, etc.)
                     -> (val - rolling_mean) / rolling_std, clip [-5,5]
  8. passthrough  - Already normalized (Z-scores, percentile ranks)

Output:
    data/features/{futures|forex}/{symbol}/{tf}/normalized.parquet
    data/features/{futures|forex}/{symbol}/{tf}/normalization_stats.json

Usage:
    python scripts/normalize-indicators.py
    python scripts/normalize-indicators.py --symbols ES,MNQ --timeframes 1d,1h
    python scripts/normalize-indicators.py --force

Requires: pandas, numpy, pyarrow, duckdb
"""

import argparse
import json
import sys
import time
import warnings
from datetime import datetime, timezone
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd

# Add project root to sys.path so we can import from src/
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))

from ml.shared.normalizer import (  # noqa: E402
    CLIP_RANGE,
    ROLLING_WINDOW,
    SKIP_COLUMNS,
    classify_normalization,
    cumulative_roc,
    pct_from_close,
    price_ratio,
    rolling_zscore,
    scale_bounded,
)

warnings.filterwarnings("ignore", category=RuntimeWarning)

# ==============================================================================
# Configuration
# ==============================================================================

DATA_DIR = ROOT / "data"
FEATURES_DIR = ROOT / "data" / "features"
ASSET_CLASSES = ("futures", "forex")


# ==============================================================================
# Close Price Loading
# ==============================================================================

MARKET_DB = ROOT / "data" / "market.duckdb"
# Timeframe label -> seconds for aggregation
TF_SECONDS = {
    "5m": 300, "15m": 900, "30m": 1800,
    "1h": 3600, "4h": 14400, "1d": 86400, "1w": 604800,
}


def _load_close_prices(
    timestamps: pd.Series, symbol: str, timeframe: str
) -> np.ndarray | None:
    """Load close prices from market.duckdb aligned to indicator timestamps."""
    if not MARKET_DB.exists():
        return None

    db_path = str(MARKET_DB).replace("\\", "/")
    conn = duckdb.connect(db_path, read_only=True)

    try:
        tf_sec = TF_SECONDS.get(timeframe)
        if tf_sec is None:
            return None

        interval = f"{tf_sec} seconds"

        # Check if symbol is a futures root (has rollovers)
        has_rollovers = conn.execute(
            f"SELECT count(*) FROM rollovers WHERE root = '{symbol}'"
        ).fetchone()[0] > 0

        if has_rollovers:
            # Continuous contract with Panama adjustment
            df = conn.execute(f"""
                WITH schedule AS (
                    SELECT to_contract as contract,
                           rollover_date as start_date,
                           LEAD(rollover_date) OVER (
                               PARTITION BY root ORDER BY rollover_date
                           ) as end_date,
                           cumulative_adjustment as adj
                    FROM rollovers WHERE root = '{symbol}'
                    UNION ALL
                    SELECT from_contract as contract,
                           DATE '1900-01-01' as start_date,
                           rollover_date as end_date,
                           cumulative_adjustment + price_gap as adj
                    FROM rollovers
                    WHERE root = '{symbol}'
                      AND rollover_date = (
                          SELECT MIN(rollover_date) FROM rollovers WHERE root = '{symbol}'
                      )
                ),
                stitched AS (
                    SELECT o.ts, o.close + s.adj as close
                    FROM ohlcv o
                    JOIN schedule s ON o.symbol = s.contract
                        AND CAST(o.ts AS DATE) >= s.start_date
                        AND (s.end_date IS NULL OR CAST(o.ts AS DATE) < s.end_date)
                )
                SELECT
                    time_bucket(INTERVAL '{interval}', ts) as timestamp,
                    last(close ORDER BY ts) as close
                FROM stitched
                GROUP BY time_bucket(INTERVAL '{interval}', ts)
                ORDER BY timestamp
            """).fetchdf()
        else:
            # Simple symbol (forex, single contract)
            df = conn.execute(f"""
                SELECT
                    time_bucket(INTERVAL '{interval}', ts) as timestamp,
                    last(close ORDER BY ts) as close
                FROM ohlcv
                WHERE symbol = '{symbol}'
                GROUP BY time_bucket(INTERVAL '{interval}', ts)
                ORDER BY timestamp
            """).fetchdf()

        if df.empty:
            return None

        # Convert market.duckdb TIMESTAMP -> epoch seconds to match indicator int64 timestamps
        # datetime64[us] stores microseconds since epoch; indicators use seconds
        if str(df["timestamp"].dtype).startswith("datetime64"):
            df["timestamp"] = (df["timestamp"].astype("int64") // 10**6).astype("int64")

        # Align close prices to indicator timestamps via merge
        close_df = pd.DataFrame({"timestamp": timestamps})
        merged = pd.merge(close_df, df, on="timestamp", how="left")
        close_arr = merged["close"].ffill().bfill().values
        return close_arr.astype(np.float64)

    except Exception as e:
        print(f"    Warning: close price load failed: {e}")
        return None
    finally:
        conn.close()


def _load_ohlcv(symbol: str, timeframe: str) -> pd.DataFrame | None:
    """Load full OHLCV from market.duckdb for core feature computation."""
    if not MARKET_DB.exists():
        return None

    db_path = str(MARKET_DB).replace("\\", "/")
    conn = duckdb.connect(db_path, read_only=True)

    try:
        tf_sec = TF_SECONDS.get(timeframe)
        if tf_sec is None:
            return None

        interval = f"{tf_sec} seconds"

        has_rollovers = conn.execute(
            f"SELECT count(*) FROM rollovers WHERE root = '{symbol}'"
        ).fetchone()[0] > 0

        if has_rollovers:
            df = conn.execute(f"""
                WITH schedule AS (
                    SELECT to_contract as contract,
                           rollover_date as start_date,
                           LEAD(rollover_date) OVER (
                               PARTITION BY root ORDER BY rollover_date
                           ) as end_date,
                           cumulative_adjustment as adj
                    FROM rollovers WHERE root = '{symbol}'
                    UNION ALL
                    SELECT from_contract as contract,
                           DATE '1900-01-01' as start_date,
                           rollover_date as end_date,
                           cumulative_adjustment + price_gap as adj
                    FROM rollovers
                    WHERE root = '{symbol}'
                      AND rollover_date = (
                          SELECT MIN(rollover_date) FROM rollovers WHERE root = '{symbol}'
                      )
                ),
                stitched AS (
                    SELECT o.ts,
                           o.open + s.adj as open,
                           o.high + s.adj as high,
                           o.low + s.adj as low,
                           o.close + s.adj as close,
                           o.volume
                    FROM ohlcv o
                    JOIN schedule s ON o.symbol = s.contract
                        AND CAST(o.ts AS DATE) >= s.start_date
                        AND (s.end_date IS NULL OR CAST(o.ts AS DATE) < s.end_date)
                )
                SELECT
                    time_bucket(INTERVAL '{interval}', ts) as timestamp,
                    first(open ORDER BY ts) as open,
                    max(high) as high,
                    min(low) as low,
                    last(close ORDER BY ts) as close,
                    sum(volume) as volume
                FROM stitched
                GROUP BY time_bucket(INTERVAL '{interval}', ts)
                ORDER BY timestamp
            """).fetchdf()
        else:
            df = conn.execute(f"""
                SELECT
                    time_bucket(INTERVAL '{interval}', ts) as timestamp,
                    first(open ORDER BY ts) as open,
                    max(high) as high,
                    min(low) as low,
                    last(close ORDER BY ts) as close,
                    sum(volume) as volume
                FROM ohlcv
                WHERE symbol = '{symbol}'
                GROUP BY time_bucket(INTERVAL '{interval}', ts)
                ORDER BY timestamp
            """).fetchdf()

        if df.empty:
            return None

        if str(df["timestamp"].dtype).startswith("datetime64"):
            df["timestamp"] = (df["timestamp"].astype("int64") // 10**6).astype("int64")

        return df

    except Exception as e:
        print(f"    Warning: OHLCV load failed: {e}")
        return None
    finally:
        conn.close()


def _rolling_rank(arr: np.ndarray, window: int = ROLLING_WINDOW) -> np.ndarray:
    """Rolling percentile rank (0 to 1)."""
    series = pd.Series(arr)
    result = series.rolling(window, min_periods=5).rank(pct=True)
    return result.fillna(0.5).values


def compute_core_features(
    ohlcv: pd.DataFrame, timestamps: np.ndarray
) -> pd.DataFrame:
    """Compute the 12 core OHLCV-derived features.

    All features are self-referential: rolling z-scores, percentile ranks,
    or dimensionless ratios. Universal across instruments.

    Returns DataFrame with timestamp + 12 feature columns, trimmed by ROLLING_WINDOW warmup.
    """
    close = ohlcv["close"].values.astype(np.float64)
    open_ = ohlcv["open"].values.astype(np.float64)
    high = ohlcv["high"].values.astype(np.float64)
    low = ohlcv["low"].values.astype(np.float64)
    volume = ohlcv["volume"].values.astype(np.float64)

    # Raw intermediate signals
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

    # Build features
    safe_bar_range = np.where(bar_range > 0, bar_range, 1.0)
    vol_safe = np.where(volume > 0, volume, 1).astype(np.float64)

    range_series = pd.Series(bar_range)
    rolling_range_20 = range_series.rolling(20, min_periods=1).mean().values
    atr_ratio = bar_range / np.where(rolling_range_20 > 0, rolling_range_20, 1)

    ret_series = pd.Series(log_return)
    vol_5 = ret_series.rolling(5, min_periods=1).std().values
    vol_20 = ret_series.rolling(20, min_periods=1).std().values

    feat = pd.DataFrame({
        "timestamp": timestamps,
        "log_return_z": rolling_zscore(log_return).astype(np.float32),
        "range_pct_z": rolling_zscore(range_pct).astype(np.float32),
        "body_pct_z": rolling_zscore(body_pct).astype(np.float32),
        "upper_wick_pct": np.where(
            bar_range > 0, (high - np.maximum(close, open_)) / safe_bar_range, 0
        ).astype(np.float32),
        "lower_wick_pct": np.where(
            bar_range > 0, (np.minimum(close, open_) - low) / safe_bar_range, 0
        ).astype(np.float32),
        "vol_rank": _rolling_rank(vol_safe).astype(np.float32),
        "atr_ratio": atr_ratio.astype(np.float32),
        "trend_5_z": rolling_zscore(trend_5).astype(np.float32),
        "trend_20_z": rolling_zscore(trend_20).astype(np.float32),
        "vol_ratio_5_20": (vol_5 / np.where(vol_20 > 0, vol_20, 1)).astype(np.float32),
        "range_rank": _rolling_rank(range_pct).astype(np.float32),
        "return_rank": _rolling_rank(np.abs(log_return)).astype(np.float32),
    })

    # Trim warmup
    feat = feat.iloc[ROLLING_WINDOW:].copy()
    feat = feat.replace([np.inf, -np.inf], 0)
    feat = feat.fillna(0)
    return feat


# ==============================================================================
# Main Processing
# ==============================================================================


def normalize_symbol_timeframe(
    symbol: str,
    timeframe: str,
    asset_class: str = "futures",
    force: bool = False,
) -> dict | None:
    """Normalize all indicators for one symbol/timeframe combo.

    Returns metadata dict or None if skipped.
    """
    indicator_dir = DATA_DIR / asset_class / symbol / timeframe
    meta_path = indicator_dir / "_meta.json"

    if not meta_path.exists():
        return None

    output_dir = FEATURES_DIR / asset_class / symbol / timeframe
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

    # We need close prices for price-relative normalization.
    # Close is NOT in indicator parquets (stripped during computation).
    # Load from market.duckdb OHLCV source.
    close_arr = _load_close_prices(merged["timestamp"], symbol, timeframe)
    if close_arr is None:
        print(f"  [{symbol}/{timeframe}] ERROR: could not load close prices from market.duckdb")
        return None

    # Build normalized output
    result = pd.DataFrame()
    result["timestamp"] = merged["timestamp"]

    stats: dict[str, dict] = {}
    counts = {"binary": 0, "bounded": 0, "pct_from_close": 0,
              "price_ratio": 0, "cumulative": 0, "passthrough": 0,
              "rolling_zscore": 0, "core_ohlcv": 0, "skipped": 0}

    indicator_cols = [c for c in merged.columns if c != "timestamp"]

    for col in indicator_cols:
        series = merged[col]

        # Skip columns with >80% NaN
        nan_frac = series.isna().mean()
        if nan_frac > 0.8:
            counts["skipped"] += 1
            continue

        norm_type, params = classify_normalization(col, series)

        if norm_type == "skip":
            counts["skipped"] += 1
            continue

        elif norm_type == "binary":
            result[col] = series.fillna(0).values
            stats[col] = {"type": "binary"}
            counts["binary"] += 1

        elif norm_type == "bounded":
            lo, hi = params["min"], params["max"]
            result[col] = scale_bounded(series.fillna((lo + hi) / 2).values, lo, hi)
            stats[col] = {"type": "bounded", "min": lo, "max": hi}
            counts["bounded"] += 1

        elif norm_type == "pct_from_close":
            values = pct_from_close(series.values, close_arr)
            values = np.nan_to_num(values, nan=0.0, posinf=CLIP_RANGE, neginf=-CLIP_RANGE)
            result[col] = values.astype(np.float32)
            stats[col] = {"type": "pct_from_close", "window": ROLLING_WINDOW, "clip": CLIP_RANGE}
            counts["pct_from_close"] += 1

        elif norm_type == "price_ratio":
            values = price_ratio(series.values, close_arr)
            values = np.nan_to_num(values, nan=0.0, posinf=CLIP_RANGE, neginf=-CLIP_RANGE)
            result[col] = values.astype(np.float32)
            stats[col] = {"type": "price_ratio", "window": ROLLING_WINDOW, "clip": CLIP_RANGE}
            counts["price_ratio"] += 1

        elif norm_type == "cumulative":
            values = cumulative_roc(series.values)
            values = np.nan_to_num(values, nan=0.0, posinf=CLIP_RANGE, neginf=-CLIP_RANGE)
            result[col] = values.astype(np.float32)
            stats[col] = {"type": "cumulative", "window": ROLLING_WINDOW, "clip": CLIP_RANGE}
            counts["cumulative"] += 1

        elif norm_type == "passthrough":
            values = series.fillna(0).values
            result[col] = values.astype(np.float32)
            stats[col] = {"type": "passthrough"}
            counts["passthrough"] += 1

        elif norm_type == "rolling_zscore":
            window = params["window"]
            z_values = rolling_zscore(series.values, window)
            z_values = np.nan_to_num(z_values, nan=0.0, posinf=CLIP_RANGE, neginf=-CLIP_RANGE)
            result[col] = z_values.astype(np.float32)
            valid = series.dropna()
            stats[col] = {
                "type": "rolling_zscore",
                "window": window,
                "clip": CLIP_RANGE,
                "mean": round(float(valid.mean()), 6) if len(valid) > 0 else 0,
                "std": round(float(valid.std()), 6) if len(valid) > 0 else 1,
            }
            counts["rolling_zscore"] += 1

    # ── Compute and merge 12 core OHLCV features ──
    ohlcv = _load_ohlcv(symbol, timeframe)
    if ohlcv is not None and len(ohlcv) >= 100:
        core = compute_core_features(ohlcv, ohlcv["timestamp"].values)
        # Merge on timestamp (inner join — only matching rows)
        result = pd.merge(result, core, on="timestamp", how="inner")
        n_core = len(core.columns) - 1  # exclude timestamp
        for c in core.columns:
            if c != "timestamp":
                stats[c] = {"type": "core_ohlcv"}
        counts["core_ohlcv"] = n_core
        print(f"    + {n_core} core OHLCV features merged")
    else:
        print(f"    Warning: could not compute core OHLCV features")

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
    n_output = len(result.columns) - 1  # exclude timestamp
    norm_stats = {
        "computed_at": datetime.now(timezone.utc).isoformat(),
        "source_indicators": str(meta_path),
        "symbol": symbol,
        "timeframe": timeframe,
        "row_count": len(result),
        "columns_total": n_output,
        "counts": counts,
        "rolling_window": ROLLING_WINDOW,
        "clip_range": CLIP_RANGE,
        "columns": stats,
    }

    with open(stats_path, "w") as f:
        json.dump(norm_stats, f, indent=2)

    file_size_mb = normalized_path.stat().st_size / (1024 * 1024)
    parts = []
    for k, v in counts.items():
        if v > 0 and k != "skipped":
            parts.append(f"{v} {k}")
    print(
        f"  [{symbol}/{timeframe}] {len(result):,} rows, {n_output} cols "
        f"({', '.join(parts)}, {counts['skipped']} skipped) "
        f"-> {file_size_mb:.1f}MB",
        flush=True,
    )

    return {
        "status": "computed",
        "symbol": symbol,
        "timeframe": timeframe,
        "rows": len(result),
        "columns": n_output,
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
Output: data/features/{futures|forex}/{symbol}/{timeframe}/normalized.parquet
        data/features/{futures|forex}/{symbol}/{timeframe}/normalization_stats.json

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

    # Discover all symbol/timeframe combos from data/{futures|forex}/{symbol}/{tf}/
    combos: list[tuple[str, str, str]] = []  # (symbol, timeframe, asset_class)
    for ac in ASSET_CLASSES:
        ac_dir = DATA_DIR / ac
        if not ac_dir.exists():
            continue
        for sym_dir in sorted(ac_dir.iterdir()):
            if not sym_dir.is_dir():
                continue
            sym = sym_dir.name
            if args.symbols:
                selected_syms = set(args.symbols.upper().split(","))
                if sym.upper() not in selected_syms:
                    continue
            for tf_dir in sorted(sym_dir.iterdir()):
                if not tf_dir.is_dir():
                    continue
                tf = tf_dir.name
                if args.timeframes:
                    selected_tfs = set(args.timeframes.lower().split(","))
                    if tf.lower() not in selected_tfs:
                        continue
                if (tf_dir / "_meta.json").exists():
                    combos.append((sym, tf, ac))

    if not combos:
        print("[normalize] No indicator data found. Run compute-indicators.py first.")
        sys.exit(1)

    print(f"[normalize] Found {len(combos)} symbol/timeframe combinations to normalize")
    print(f"[normalize] Output: data/features/{{ac}}/{{symbol}}/{{timeframe}}/normalized.parquet")
    print()

    computed = 0
    skipped = 0
    errors = 0

    for i, (sym, tf, ac) in enumerate(combos, 1):
        try:
            result = normalize_symbol_timeframe(sym, tf, asset_class=ac, force=args.force)
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
