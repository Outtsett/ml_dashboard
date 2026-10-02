import numpy as np

from .features import _rolling_mean, _rolling_std


def _compute_book_imbalance(depth, **kwargs):
    """
    Calculate bid/ask depth imbalance.
    Requires bid_sz_00...bid_sz_09 and ask_sz_00...ask_sz_09 in kwargs.
    """
    bid_sum = np.zeros_like(kwargs.get("close", next(iter(kwargs.values()))))
    ask_sum = np.zeros_like(bid_sum)

    for i in range(depth):
        pad = str(i).zfill(2)
        bid_sz = kwargs.get(f"bid_sz_{pad}")
        ask_sz = kwargs.get(f"ask_sz_{pad}")
        if bid_sz is not None:
            bid_sum += bid_sz
        if ask_sz is not None:
            ask_sum += ask_sz

    denominator = bid_sum + ask_sum
    # Avoid division by zero
    return np.where(denominator > 0, (bid_sum - ask_sum) / denominator, 0.0)


def _compute_absorption_score(volume, high, low, window, **_):
    """Effort vs Result: High volume relative to price range."""
    # Normalized range
    candle_range = high - low
    # Median range and volume over window
    # Note: _rolling_mean is available, but for median we might need a fallback or another numba fn
    # Using rolling mean as a proxy for the 'baseline' in this shared context
    avg_range = _rolling_mean(candle_range, window)
    avg_vol = _rolling_mean(volume, window)

    compression = candle_range / np.where(avg_range > 0, avg_range, 1e-10)
    vol_relative = volume / np.where(avg_vol > 0, avg_vol, 1e-10)

    # Absorption = High relative volume with low relative range
    return np.where(compression < 0.8, vol_relative, 0.0)


def _compute_closing_strength(high, low, close, **_):
    """Where price closed relative to its range (0 to 1)."""
    r = high - low
    return np.where(r > 0, (close - low) / r, 0.5)


def _compute_vwap_stretch(close, high, low, volume, window, **_):
    """Distance from rolling VWAP in standard deviations."""
    typical_price = (high + low + close) / 3.0
    vol_price = typical_price * volume

    cum_vol_price = np.convolve(vol_price, np.ones(window), mode="full")[: len(close)]
    cum_vol = np.convolve(volume, np.ones(window), mode="full")[: len(close)]

    vwap = cum_vol_price / np.where(cum_vol > 0, cum_vol, 1e-10)
    std = _rolling_std(close, window)

    return (close - vwap) / np.where(std > 0, std, 1e-10)


def _compute_vwap_distance(close, high, low, volume, window, **_):
    """Percentage distance from rolling VWAP."""
    typical_price = (high + low + close) / 3.0
    vol_price = typical_price * volume

    cum_vol_price = np.convolve(vol_price, np.ones(window), mode="full")[: len(close)]
    cum_vol = np.convolve(volume, np.ones(window), mode="full")[: len(close)]

    vwap = cum_vol_price / np.where(cum_vol > 0, cum_vol, 1e-10)
    return (close - vwap) / np.where(vwap > 0, vwap, 1e-10) * 100.0
