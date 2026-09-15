"""
Indicator-to-feature derivation transforms — high-performance pipeline.

Reads pre-computed indicators (parquet files) and derives model-ready features
using vectorized numpy/numba operations with parallel execution via joblib.
(The `talib_features` table has been dropped; parquet is the only source.)

Performance architecture:
  - Indicator load: parquet files read through Polars, cached for repeat runs
  - Transforms: pure numpy vectorized, no Python loops
  - Parallelism: joblib Parallel across indicator categories
  - Memory: float32 throughout, in-place operations where possible

Config-driven via src/config/feature_extraction.json.
"""

import hashlib
import json
import os
import time
from pathlib import Path

import numpy as np
import pandas as pd
import polars as pl

# ── Numba-accelerated kernels ─────────────────────────────────────────────

try:
    from numba import njit

    @njit(cache=True, fastmath=True)
    def _rolling_zscore_numba(arr, window, clip_lo, clip_hi):
        """Rolling z-score — numba JIT, ~50x faster than pandas."""
        n = len(arr)
        out = np.empty(n, dtype=np.float64)
        out[:window] = np.nan

        # Initial window stats
        buf = arr[:window].copy()
        s = 0.0
        s2 = 0.0
        cnt = 0
        for j in range(window):
            v = buf[j]
            if not np.isnan(v):
                s += v
                s2 += v * v
                cnt += 1

        for i in range(window, n):
            # Add new value
            new_val = arr[i]
            if not np.isnan(new_val):
                s += new_val
                s2 += new_val * new_val
                cnt += 1

            # Remove oldest value
            old_val = arr[i - window]
            if not np.isnan(old_val):
                s -= old_val
                s2 -= old_val * old_val
                cnt -= 1

            if cnt < 5:
                out[i] = np.nan
                continue

            mean = s / cnt
            var = s2 / cnt - mean * mean
            if var < 1e-20:
                out[i] = 0.0
            else:
                std = np.sqrt(var)
                z = (new_val - mean) / std
                if z < clip_lo:
                    z = clip_lo
                elif z > clip_hi:
                    z = clip_hi
                out[i] = z

        return out

    @njit(cache=True, fastmath=True)
    def _roc_numba(arr, horizon):
        """Rate of change — numba JIT."""
        n = len(arr)
        out = np.empty(n, dtype=np.float64)
        out[:horizon] = np.nan
        for i in range(horizon, n):
            prev = arr[i - horizon]
            cur = arr[i]
            if np.isnan(prev) or np.isnan(cur):
                out[i] = np.nan
            else:
                denom = abs(prev) + 1e-10
                out[i] = (cur - prev) / denom
        return out

    @njit(cache=True, fastmath=True)
    def _percentile_rank_numba(arr, window):
        """Rolling percentile rank — numba JIT."""
        n = len(arr)
        out = np.empty(n, dtype=np.float64)
        out[:window] = np.nan
        for i in range(window, n):
            val = arr[i]
            if np.isnan(val):
                out[i] = np.nan
                continue
            count = 0
            total = 0
            for j in range(i - window, i):
                v = arr[j]
                if not np.isnan(v):
                    total += 1
                    if v <= val:
                        count += 1
            out[i] = count / total if total > 0 else np.nan
        return out

    _HAS_NUMBA = True
except ImportError:
    _HAS_NUMBA = False


# ── Config loading ────────────────────────────────────────────────────────


def load_extraction_config() -> dict:
    """Read feature extraction config from src/config/feature_extraction.json."""
    config_path = os.path.join(
        os.path.dirname(__file__), "..", "..", "config", "feature_extraction.json"
    )
    with open(config_path) as f:
        return json.load(f)


# ── Transform functions ──────────────────────────────────────────────────
# Each: (arr: np.ndarray, close: np.ndarray | None, **params) -> np.ndarray


def _roc(arr: np.ndarray, close: np.ndarray | None = None, *, horizon: int = 5) -> np.ndarray:
    """Rate of change of the indicator itself, then rolling z-score."""
    if _HAS_NUMBA:
        raw = _roc_numba(arr, horizon)
        return _rolling_zscore_numba(raw, 50, -5.0, 5.0)
    eps = 1e-10
    shifted = np.roll(arr, horizon)
    shifted[:horizon] = np.nan
    raw_roc = (arr - shifted) / (np.abs(shifted) + eps)
    return _rolling_zscore(raw_roc)


def _distance_from(
    arr: np.ndarray, close: np.ndarray | None = None, *, level: float | str = 0.0
) -> np.ndarray:
    """Distance from a neutral level (e.g., RSI 50, CCI 0)."""
    if level == "midpoint":
        window = 100
        # Vectorized rolling min/max via stride tricks
        from numpy.lib.stride_tricks import sliding_window_view
        n = len(arr)
        mid = np.full(n, np.nan, dtype=np.float64)
        if n > window:
            windows = sliding_window_view(arr, window)
            roll_min = np.nanmin(windows, axis=1)
            roll_max = np.nanmax(windows, axis=1)
            mid[window - 1:] = (roll_min + roll_max) / 2.0
    else:
        mid = float(level)
    dist = arr - mid
    if _HAS_NUMBA:
        return _rolling_zscore_numba(dist, 50, -5.0, 5.0)
    return _rolling_zscore(dist)


def _percentile_rank(
    arr: np.ndarray, close: np.ndarray | None = None, *, window: int = 100
) -> np.ndarray:
    """Rolling percentile rank [0, 1]."""
    if _HAS_NUMBA:
        return _percentile_rank_numba(arr, window)
    series = pd.Series(arr, dtype=np.float64)
    return series.rolling(window, min_periods=10).rank(pct=True).values


def _zscore(
    arr: np.ndarray, close: np.ndarray | None = None, *, window: int = 50
) -> np.ndarray:
    """Rolling z-score, clipped [-5, 5]."""
    if _HAS_NUMBA:
        return _rolling_zscore_numba(arr, window, -5.0, 5.0)
    return _rolling_zscore(arr, window=window)


def _divergence(
    arr: np.ndarray, close: np.ndarray | None = None, *, window: int = 14
) -> np.ndarray:
    """Price-indicator divergence detection (fully vectorized)."""
    if close is None:
        return np.zeros(len(arr), dtype=np.float64)

    half = max(window // 2, 1)

    # Cumulative sum trick for rolling means — O(n) instead of O(n*w)
    def _rolling_mean_cumsum(x, w):
        cs = np.nancumsum(x)
        cs = np.insert(cs, 0, 0.0)
        rm = (cs[w:] - cs[:-w]) / w
        out = np.full(len(x), np.nan, dtype=np.float64)
        out[w - 1:] = rm
        return out

    ind_late = _rolling_mean_cumsum(arr, half)
    ind_early = np.roll(_rolling_mean_cumsum(arr, half), half)
    ind_early[:half * 2] = np.nan
    ind_dir = np.sign(ind_late - ind_early)

    price_late = _rolling_mean_cumsum(close, half)
    price_early = np.roll(_rolling_mean_cumsum(close, half), half)
    price_early[:half * 2] = np.nan
    price_dir = np.sign(price_late - price_early)

    result = np.zeros(len(arr), dtype=np.float64)
    mask = (ind_dir != price_dir) & (ind_dir != 0) & (price_dir != 0)
    mask &= ~np.isnan(ind_dir) & ~np.isnan(price_dir)
    result[mask] = ind_dir[mask]
    return result


def _squeeze(
    arr: np.ndarray,
    close: np.ndarray | None = None,
    *,
    percentile: int = 20,
    window: int = 100,
) -> np.ndarray:
    """Volatility squeeze detection (vectorized)."""
    series = pd.Series(arr, dtype=np.float64)
    threshold = series.rolling(window, min_periods=10).quantile(percentile / 100.0)
    result = np.where(series.values < threshold.values, 1.0, 0.0)
    result[:window] = 0.0
    return result


def _crossover_dist(
    arr: np.ndarray,
    close: np.ndarray | None = None,
    *,
    signal_series: np.ndarray | None = None,
    signal_prefix: str = "",
) -> np.ndarray:
    """Distance from crossover point (fast - slow), z-scored."""
    if signal_series is None:
        return np.zeros(len(arr), dtype=np.float64)
    diff = arr - signal_series
    if _HAS_NUMBA:
        return _rolling_zscore_numba(diff, 50, -5.0, 5.0)
    return _rolling_zscore(diff)


def _acceleration(
    arr: np.ndarray,
    close: np.ndarray | None = None,
    *,
    horizon1: int = 3,
    horizon2: int = 3,
) -> np.ndarray:
    """Second derivative: roc(roc(x)), then rolling z-score."""
    eps = 1e-10
    # First ROC
    shifted1 = np.empty_like(arr)
    shifted1[:horizon1] = np.nan
    shifted1[horizon1:] = arr[:-horizon1]
    roc1 = (arr - shifted1) / (np.abs(shifted1) + eps)
    # Second ROC
    shifted2 = np.empty_like(roc1)
    shifted2[:horizon2] = np.nan
    shifted2[horizon2:] = roc1[:-horizon2]
    roc2 = (roc1 - shifted2) / (np.abs(shifted2) + eps)
    # NaN propagation
    roc2[~np.isfinite(roc2)] = np.nan
    if _HAS_NUMBA:
        return _rolling_zscore_numba(roc2, 50, -5.0, 5.0)
    return _rolling_zscore(roc2)


# ── Fallback rolling z-score (pandas, used only without numba) ────────────


def _rolling_zscore(arr: np.ndarray, window: int = 50, clip_range: float = 5.0) -> np.ndarray:
    """Rolling z-score — pandas fallback when numba unavailable."""
    series = pd.Series(arr, dtype=np.float64)
    rolling_mean = series.rolling(window, min_periods=5).mean()
    rolling_std = series.rolling(window, min_periods=5).std()
    z = (series - rolling_mean) / rolling_std.replace(0, np.nan)
    z = z.clip(-clip_range, clip_range)
    return z.values


# ── Dispatch table ────────────────────────────────────────────────────────


DERIVATION_FUNCTIONS = {
    "roc": _roc,
    "distance_from": _distance_from,
    "percentile_rank": _percentile_rank,
    "zscore": _zscore,
    "divergence": _divergence,
    "squeeze": _squeeze,
    "crossover_dist": _crossover_dist,
    "acceleration": _acceleration,
}


# ── Column matching ───────────────────────────────────────────────────────


def _match_columns(
    columns: list[str],
    match_prefixes: list[str] | None = None,
    match_exact: list[str] | None = None,
    match_exclude_prefixes: list[str] | None = None,
) -> list[str]:
    """Find columns matching prefix/exact rules, excluding specified prefixes."""
    col_set = set(columns)
    matched = set()

    if match_exact:
        matched.update(col_set & set(match_exact))

    if match_prefixes:
        for col in columns:
            for prefix in match_prefixes:
                if col.startswith(prefix):
                    matched.add(col)
                    break

    if match_exclude_prefixes:
        excluded = set()
        for col in matched:
            for prefix in match_exclude_prefixes:
                if col.startswith(prefix):
                    excluded.add(col)
                    break
        matched -= excluded

    return sorted(matched)


def _resolve_signal_series(
    df: pd.DataFrame, source_col: str, signal_prefix: str
) -> np.ndarray | None:
    """Resolve signal series for crossover_dist (MACD line → signal)."""
    for src, sig in [
        ("macd_macd", "macd_macdsignal"),
        ("macdext_macd", "macdext_macdsignal"),
        ("macdfix_macd", "macdfix_macdsignal"),
    ]:
        if source_col == src and sig in df.columns:
            return df[sig].values

    for prefix_candidate in ["MACD_", "MACDh_"]:
        if source_col.startswith(prefix_candidate):
            param_suffix = source_col[len(prefix_candidate):]
            signal_col = signal_prefix + param_suffix
            if signal_col in df.columns:
                return df[signal_col].values
            break
    return None


# ── Parallel category processor ──────────────────────────────────────────


def _process_category(
    cat_name: str,
    cat_spec: dict,
    col_data: dict[str, np.ndarray],
    close: np.ndarray,
    signal_lookup: dict[str, np.ndarray],
    existing_keys: set[str],
) -> list[tuple[str, np.ndarray]]:
    """Process one indicator category — returns list of (name, array) pairs.

    Designed to be called in parallel via joblib.
    """
    matched_cols = _match_columns(
        list(col_data.keys()),
        match_prefixes=cat_spec.get("match_prefixes"),
        match_exact=cat_spec.get("match_exact"),
        match_exclude_prefixes=cat_spec.get("match_exclude_prefixes"),
    )

    if not matched_cols:
        return []

    results = []
    for col in matched_cols:
        arr = col_data[col]
        for deriv_spec in cat_spec.get("derivations", []):
            suffix = deriv_spec.get("suffix", f"_{deriv_spec['name']}")
            output_col = f"{col}{suffix}"
            if output_col in existing_keys:
                continue

            deriv_fn = DERIVATION_FUNCTIONS.get(deriv_spec["name"])
            if deriv_fn is None:
                continue

            params = dict(deriv_spec.get("params", {}))
            if deriv_spec["name"] == "crossover_dist":
                # pop() for its side effect — strips signal_prefix out of the
                # kwargs before they are splatted into deriv_fn below.
                params.pop("signal_prefix", None)
                params["signal_series"] = signal_lookup.get(col)

            result = deriv_fn(arr, close, **params)
            results.append((output_col, result))
            existing_keys.add(output_col)

    return results


# ── Main extraction function ──────────────────────────────────────────────


def extract_derived_features(
    df: pd.DataFrame,
    close: np.ndarray,
    config: dict | None = None,
    n_jobs: int = 24,
) -> tuple[pd.DataFrame, list[str]]:
    """Apply config-driven derivation transforms to indicator columns.

    Uses joblib parallel processing across indicator categories.

    Args:
        df: DataFrame with pre-computed indicator columns.
        close: Close price array (same length as df).
        config: Feature extraction config dict. If None, loads from file.
        n_jobs: Parallel jobs (-1 = all cores, 1 = serial for debugging).

    Returns:
        (derived_df, derived_names)
    """
    if config is None:
        config = load_extraction_config()

    t0 = time.time()

    # Pre-extract all column data as contiguous float64 arrays
    col_data = {}
    for col in df.columns:
        try:
            col_data[col] = df[col].values.astype(np.float64, copy=False)
        except (ValueError, TypeError):
            continue

    # Pre-resolve signal series for crossover_dist
    signal_lookup = {}
    for col in df.columns:
        for src, sig in [
            ("macd_macd", "macd_macdsignal"),
            ("macdext_macd", "macdext_macdsignal"),
            ("macdfix_macd", "macdfix_macdsignal"),
        ]:
            if col == src and sig in df.columns:
                signal_lookup[col] = df[sig].values.astype(np.float64)

    categories = list(config.get("categories", {}).items())
    existing_keys = set()

    if n_jobs == 1 or len(categories) <= 2:
        # Serial execution
        all_results = []
        for cat_name, cat_spec in categories:
            results = _process_category(
                cat_name, cat_spec, col_data, close, signal_lookup, existing_keys
            )
            all_results.extend(results)
    else:
        # Parallel execution across categories
        from joblib import Parallel, delayed

        def _safe_process(cat_name, cat_spec):
            return _process_category(
                cat_name, cat_spec, col_data, close, signal_lookup, set()
            )

        parallel_results = Parallel(n_jobs=min(n_jobs if n_jobs > 0 else 8, len(categories)), prefer="threads")(
            delayed(_safe_process)(name, spec) for name, spec in categories
        )

        # Merge results, deduplicating
        all_results = []
        seen = set()
        for batch in parallel_results:
            for name, arr in batch:
                if name not in seen:
                    all_results.append((name, arr))
                    seen.add(name)

    # Build output DataFrame
    derived_names = [name for name, _ in all_results]
    if all_results:
        # Stack arrays into contiguous 2D array first, then wrap in DataFrame
        arrays = np.column_stack([arr for _, arr in all_results])
        derived_df = pd.DataFrame(arrays, columns=derived_names, index=df.index)
    else:
        derived_df = pd.DataFrame(index=df.index)

    elapsed = time.time() - t0
    print(f"[extract] {len(derived_names)} features in {elapsed:.1f}s "
          f"({'numba+parallel' if _HAS_NUMBA else 'numpy'})")

    return derived_df, derived_names


# ── Parquet cache layer ──────────────────────────────────────────────────


_CACHE_DIR = Path(os.environ.get("ML_CACHE_DIR", "data/.cache"))


def _cache_key(symbol: str, timeframe: str, max_bars: int, source: str) -> str:
    """Generate deterministic cache key."""
    raw = f"{source}:{symbol}:{timeframe}:{max_bars}"
    return hashlib.md5(raw.encode()).hexdigest()[:12]


def _load_from_cache(symbol: str, timeframe: str, max_bars: int, source: str) -> pd.DataFrame | None:
    """Load indicator data from parquet cache if available and fresh."""
    key = _cache_key(symbol, timeframe, max_bars, source)
    cache_path = _CACHE_DIR / f"{key}.parquet"
    meta_path = _CACHE_DIR / f"{key}.json"

    if not cache_path.exists() or not meta_path.exists():
        return None

    # Check staleness (24h max age) — delete stale files proactively
    age_hours = (time.time() - cache_path.stat().st_mtime) / 3600
    if age_hours > 24:
        try:
            cache_path.unlink(missing_ok=True)
            meta_path.unlink(missing_ok=True)
            print(f"[cache] Stale: deleted {cache_path.name} ({age_hours:.1f}h old)")
        except OSError:
            pass
        return None

    try:
        df = pd.read_parquet(str(cache_path))
        print(f"[cache] Hit: {len(df):,} rows from {cache_path.name} ({age_hours:.1f}h old)")
        return df
    except Exception:
        return None


def _save_to_cache(df: pd.DataFrame, symbol: str, timeframe: str, max_bars: int, source: str):
    """Save indicator data to parquet cache."""
    _CACHE_DIR.mkdir(parents=True, exist_ok=True)
    key = _cache_key(symbol, timeframe, max_bars, source)
    cache_path = _CACHE_DIR / f"{key}.parquet"
    meta_path = _CACHE_DIR / f"{key}.json"

    df.to_parquet(str(cache_path), compression="zstd", compression_level=1)
    with open(meta_path, "w") as f:
        json.dump({
            "symbol": symbol, "timeframe": timeframe,
            "max_bars": max_bars, "source": source,
            "rows": len(df), "cols": len(df.columns),
        }, f)
    print(f"[cache] Saved {len(df):,} rows to {cache_path.name}")


# ── Data loading helpers ──────────────────────────────────────────────────


def load_indicators_from_parquet(
    symbol: str,
    timeframe: str,
    data_dir: str = "data",
    asset_class: str = "futures",
) -> pd.DataFrame:
    """
    Institutional-Grade parallel parquet loader using Polars.
    Bypasses slow pandas concat for high-performance multi-threaded joining.
    """
    base = Path(data_dir) / asset_class / symbol / timeframe
    if not base.exists():
        raise FileNotFoundError(f"No indicator data at {base}")

    parquet_files = sorted([str(f) for f in base.glob("*.parquet") if not f.name.startswith("_")])
    if not parquet_files:
        raise FileNotFoundError(f"No parquet files found in {base}")

    # Use Polars to read and join all files in a single lazy graph
    try:
        # First file is the base
        main_df = pl.read_parquet(parquet_files[0])
        
        # Join subsequent files on timestamp if available, otherwise horizontal concat
        for pf in parquet_files[1:]:
            next_df = pl.read_parquet(pf)
            # Deduplicate columns (except timestamp)
            overlap = set(main_df.columns) & set(next_df.columns)
            if overlap:
                next_df = next_df.drop([c for c in overlap if c != 'timestamp'])
            
            if 'timestamp' in main_df.columns and 'timestamp' in next_df.columns:
                main_df = main_df.join(next_df, on='timestamp', how='left')
            else:
                main_df = pl.concat([main_df, next_df], how='horizontal')

        return main_df.to_pandas()
    except Exception as e:
        print(f"[load_parquet] Polars load failed: {e}")
        # Minimal fallback
        return pd.concat([pd.read_parquet(f) for f in parquet_files], axis=1)


def load_indicators_from_questdb(
    symbol: str,
    timeframe: str,
    max_bars: int = 0,
    date_range: dict | None = None,
) -> pd.DataFrame:
    """DEPRECATED: the `talib_features` table has been dropped.

    Use load_indicators_from_parquet() instead. Kept only so the existing
    import in scripts/feature-research.py resolves; it raises immediately
    rather than returning an empty frame.
    """
    raise RuntimeError(
        "The 'talib_features' table no longer exists. "
        "Use load_indicators_from_parquet() instead."
    )
