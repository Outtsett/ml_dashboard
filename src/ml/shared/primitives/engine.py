import numpy as np
from numba import njit
from .core import _rolling_mean, _rolling_std, _rolling_skew, _rolling_kurtosis, _rolling_autocorr, _rolling_hurst, _rolling_linreg_slope, _first_diff, _second_diff
from .features import *


# Section 3: Derivation Engine
# =============================================================================


def _apply_derivations(name, arr, sigma_t, N, k):
    """Apply 7 standard derivations to a base primitive.

    Args:
        name: Base primitive name (used as prefix for derived names).
        arr: Base primitive array (n_bars,).
        sigma_t: Local volatility array (n_bars,) for vol-adjusted derivation.
        N: Rolling window size.
        k: Autocorrelation lag.

    Returns:
        Dict mapping derived_name -> array.
    """
    derivations = {}
    derivations[f"{name}_volatility"] = _rolling_std(arr, N)
    derivations[f"{name}_autocorr"] = _rolling_autocorr(arr, N, k)
    derivations[f"{name}_change"] = _first_diff(arr)
    safe_sigma = np.where(sigma_t > 1e-10, sigma_t, np.nan)
    derivations[f"{name}_vol_adj"] = arr / safe_sigma
    derivations[f"{name}_skew"] = _rolling_skew(arr, N)
    derivations[f"{name}_kurtosis"] = _rolling_kurtosis(arr, N)
    derivations[f"{name}_accel"] = _second_diff(arr)
    return derivations


# =============================================================================
# Section 4: Entry Point
# =============================================================================


def compute_primitives(ohlcv, N=20, k=1):
    """Compute all primitives from OHLCV data.

    Generates ~60 core primitives across 6 categories, then applies 7 standard
    derivations to each, producing ~480 total features.

    Args:
        ohlcv: Dict with keys 'open', 'high', 'low', 'close', 'volume'.
               All values must be float64 numpy arrays of the same length.
        N: Lookback window for rolling statistics (default 20).
        k: Lag for autocorrelation computations (default 1).

    Returns:
        X: (n_bars, n_primitives) float64 array.
        names: List of primitive names, same order as columns.
    """
    open_ = ohlcv["open"].astype(np.float64)
    high = ohlcv["high"].astype(np.float64)
    low = ohlcv["low"].astype(np.float64)
    close = ohlcv["close"].astype(np.float64)
    volume = ohlcv["volume"].astype(np.float64)

    sigma_t = _local_volatility(close, N)

    all_arrays = {}

    # -- Price-Derived Core (20) -----------------------------------------------
    all_arrays["price_displacement"] = _price_displacement(close)
    all_arrays["log_return"] = _log_return(close)
    all_arrays["local_volatility"] = sigma_t.copy()
    all_arrays["trend_angle"] = _trend_angle(close, N)
    all_arrays["directional_consistency"] = _directional_consistency(close, N)
    all_arrays["normalized_impulse"] = _normalized_impulse(close, N)
    all_arrays["residual_displacement"] = _residual_displacement(close, N)
    all_arrays["price_acceleration"] = _price_acceleration(close)
    all_arrays["momentum_curvature"] = _momentum_curvature(close, N)
    all_arrays["oscillation_frequency"] = _oscillation_frequency(close, N)
    all_arrays["inertia"] = _inertia(close, N, k)
    all_arrays["noise_ratio"] = _noise_ratio(close, N)
    all_arrays["kinetic_energy"] = _kinetic_energy(close)
    all_arrays["price_entropy"] = _price_entropy(close, N)
    all_arrays["hurst_exponent"] = _hurst_exponent(close, N)
    all_arrays["fractal_dimension"] = _fractal_dimension(close, N)
    all_arrays["trend_strength"] = _trend_strength(close, N)
    all_arrays["mean_reversion_rate"] = _mean_reversion_rate(close, N)
    all_arrays["cycle_amplitude"] = _cycle_amplitude(close, N)
    all_arrays["cycle_asymmetry"] = _cycle_asymmetry(close, N)

    # -- OHLC Core (15) --------------------------------------------------------
    all_arrays["candle_range"] = _candle_range(high, low)
    all_arrays["body_ratio"] = _body_ratio(open_, high, low, close)
    all_arrays["wick_asymmetry"] = _wick_asymmetry(open_, high, low, close)
    all_arrays["candle_momentum"] = _candle_momentum(close)
    all_arrays["gap_magnitude"] = _gap_magnitude(open_, close)
    all_arrays["reversal_strength"] = _reversal_strength(open_, high, low, close, N)
    all_arrays["trend_continuity"] = _trend_continuity(open_, close, N)
    all_arrays["volatility_expansion"] = _volatility_expansion(high, low)
    all_arrays["body_momentum"] = _body_momentum(open_, close)
    all_arrays["wick_ratio"] = _wick_ratio(open_, high, low, close)
    all_arrays["bullish_momentum"] = _bullish_momentum(open_, close)
    all_arrays["bearish_momentum"] = _bearish_momentum(open_, close)
    all_arrays["doji_strength"] = _doji_strength(open_, high, low, close)
    all_arrays["engulfing_strength"] = _engulfing_strength(open_, close)
    all_arrays["gap_frequency"] = _gap_frequency(open_, close, N)

    # -- Temporal Core (13) ----------------------------------------------------
    all_arrays["time_to_peak"] = _time_to_peak(close, N)
    all_arrays["cycle_duration"] = _cycle_duration(close, N)
    all_arrays["price_autocorrelation"] = _price_autocorrelation(close, N, k)
    all_arrays["volatility_clustering"] = _volatility_clustering(close, N)
    all_arrays["mean_reversion_time"] = _mean_reversion_time(close, N)
    all_arrays["event_latency"] = _event_latency(close, N)
    all_arrays["trend_duration"] = _trend_duration(close, N)
    all_arrays["time_asymmetry"] = _time_asymmetry(close, N)
    all_arrays["momentum_persistence"] = _momentum_persistence(close, N)
    all_arrays["reversal_latency"] = _reversal_latency(close, N)
    all_arrays["autocorrelation_decay"] = _autocorrelation_decay(close, N)
    all_arrays["cycle_frequency"] = _cycle_frequency(close, N)
    all_arrays["trend_change_frequency"] = _trend_change_frequency(close, N)

    # -- Volume Core (7) -------------------------------------------------------
    all_arrays["raw_volume"] = _raw_volume(volume)
    all_arrays["volume_momentum"] = _volume_momentum(volume)
    all_arrays["volume_skew"] = _volume_skew(open_, high, low, close, volume)
    all_arrays["volume_clustering"] = _volume_clustering(volume, N)
    all_arrays["flow_intensity"] = _flow_intensity(close, volume)
    all_arrays["trade_frequency_proxy"] = _trade_frequency_proxy(volume, N)
    all_arrays["volume_price_corr"] = _volume_price_corr(close, volume, N)

    # -- Structure Core (10) ---------------------------------------------------
    all_arrays["compression_volatility"] = _compression_volatility(close, N)
    all_arrays["range_contraction"] = _range_contraction(high, low)
    all_arrays["pattern_slope"] = _pattern_slope(high, low, N)
    all_arrays["structural_break"] = _structural_break(close, N)
    all_arrays["compression_duration"] = _compression_duration(high, low, close, N)
    all_arrays["fractal_dimension_structure"] = _fractal_dimension_structure(
        high, low, close, N
    )
    all_arrays["breakout_intensity"] = _breakout_intensity(high, low, close, N)
    all_arrays["consolidation_entropy"] = _consolidation_entropy(close, N)
    all_arrays["range_expansion"] = _range_expansion(high, low, N)
    all_arrays["pattern_curvature"] = _pattern_curvature(high, low, N)

    # -- Regime Cues Core (8) --------------------------------------------------
    all_arrays["volatility_regime"] = _volatility_regime(close, N)
    all_arrays["trend_regime"] = _trend_regime(close, N)
    all_arrays["regime_persistence"] = _regime_persistence(close, N)
    all_arrays["regime_divergence"] = _regime_divergence(close, N)
    all_arrays["correlation_shift"] = _correlation_shift(close, N)
    all_arrays["volatility_break"] = _volatility_break(close, N)
    all_arrays["regime_entropy"] = _regime_entropy(close, N)
    all_arrays["regime_transition_frequency"] = _regime_transition_frequency(close, N)

    # -- Apply 7 derivations to every core primitive ---------------------------
    core_names = list(all_arrays.keys())
    for base_name in core_names:
        base_arr = all_arrays[base_name]
        derivations = _apply_derivations(base_name, base_arr, sigma_t, N, k)
        all_arrays.update(derivations)

    # -- Stack into (n_bars, D) matrix -----------------------------------------
    names = list(all_arrays.keys())
    n_bars = len(close)
    n_features = len(names)
    X = np.empty((n_bars, n_features), dtype=np.float64)
    for col_idx, name in enumerate(names):
        X[:, col_idx] = all_arrays[name]

    return X, names


# =============================================================================
# Section 5: Convenience Functions
# =============================================================================


def compute_and_normalize_primitives(ohlcv, N=20, k=1, norm_lookback=250, clip=5.0):
    """Compute + rolling z-score normalize all primitives.

    Args:
        ohlcv: Dict with keys 'open', 'high', 'low', 'close', 'volume'.
        N: Lookback window for rolling statistics.
        k: Autocorrelation lag.
        norm_lookback: Rolling z-score normalization window.
        clip: Symmetric clip range for z-scores.

    Returns:
        X_norm: (n_bars, n_primitives) normalized float64 array.
        names: List of primitive names.
    """
    X, names = compute_primitives(ohlcv, N, k)
    from .features import normalize_features

    X_norm = normalize_features(X, lookback=norm_lookback, clip_range=(-clip, clip))
    return X_norm, names


def list_primitives(N=20, k=1):
    """Return the full list of primitive names without computing on real data."""
    dummy_len = max(6 * N, 100)
    rng_state = np.random.RandomState(42)
    base = 100.0
    walk = np.cumsum(rng_state.randn(dummy_len) * 0.01)
    dummy = {
        "open": base + walk + rng_state.randn(dummy_len) * 0.001,
        "high": base + walk + np.abs(rng_state.randn(dummy_len) * 0.005),
        "low": base + walk - np.abs(rng_state.randn(dummy_len) * 0.005),
        "close": base + walk + rng_state.randn(dummy_len) * 0.001,
        "volume": np.abs(rng_state.randn(dummy_len) * 1000.0) + 100.0,
    }
    _, names = compute_primitives(dummy, N, k)
    return names

