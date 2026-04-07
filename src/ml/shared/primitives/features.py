import numpy as np
from numba import njit
from .core import (
    _rolling_mean, _rolling_std, _rolling_skew, _rolling_kurtosis,
    _rolling_autocorr, _rolling_entropy, _rolling_hurst,
    _rolling_linreg_slope, _first_diff, _second_diff
)


# Section 2: Core Primitive Functions (6 categories, ~60 total)
# =============================================================================

# -- Price-Derived Core (~20 unique) ------------------------------------------


@njit(cache=True)
def _price_displacement(close):
    """close[t] - close[t-1]."""
    return _first_diff(close)


@njit(cache=True)
def _log_return(close):
    """log(close[t] / close[t-1])."""
    n = len(close)
    out = np.empty(n, dtype=np.float64)
    out[0] = 0.0
    for i in range(1, n):
        if close[i - 1] > 1e-20:
            out[i] = np.log(close[i] / close[i - 1])
        else:
            out[i] = np.nan
    return out


def _local_volatility(close, N):
    """Rolling std of log returns over N bars."""
    lr = _log_return(close)
    return _rolling_std(lr, N)


def _trend_angle(close, N):
    """arctan(rolling OLS slope of close over N)."""
    slope = _rolling_linreg_slope(close, N)
    return np.arctan(slope)


@njit(cache=True)
def _directional_consistency(close, N):
    """Fraction of same-sign consecutive moves over N bars."""
    n = len(close)
    out = np.empty(n, dtype=np.float64)
    out[:] = np.nan
    if N < 2 or n < N + 1:
        return out
    signs = np.empty(n, dtype=np.float64)
    signs[0] = 0.0
    for i in range(1, n):
        d = close[i] - close[i - 1]
        if d > 0:
            signs[i] = 1.0
        elif d < 0:
            signs[i] = -1.0
        else:
            signs[i] = 0.0
    for i in range(N, n):
        same = 0
        for j in range(1, N):
            idx = i - N + 1 + j
            if signs[idx] != 0.0 and signs[idx] == signs[idx - 1]:
                same += 1
        out[i] = same / (N - 1)
    return out


def _normalized_impulse(close, N):
    """displacement / local_volatility."""
    disp = _price_displacement(close)
    vol = _local_volatility(close, N)
    safe_vol = np.where(vol > 1e-20, vol, np.nan)
    return disp / safe_vol


def _residual_displacement(close, N):
    """close - rolling_mean(close, N)."""
    ma = _rolling_mean(close, N)
    return close - ma


def _price_acceleration(close):
    """Second difference of close."""
    return _second_diff(close)


@njit(cache=True)
def _momentum_curvature(close, N):
    """2 * quadratic coeff from rolling poly fit (deg 2). Returns 2*c."""
    n = len(close)
    out = np.empty(n, dtype=np.float64)
    out[:] = np.nan
    if N < 3 or n < N:
        return out
    s0 = float(N)
    s1 = 0.0
    s2 = 0.0
    s3 = 0.0
    s4 = 0.0
    for j in range(N):
        xj = float(j)
        s1 += xj
        s2 += xj * xj
        s3 += xj * xj * xj
        s4 += xj * xj * xj * xj
    det = (s0 * (s2 * s4 - s3 * s3)
           - s1 * (s1 * s4 - s3 * s2)
           + s2 * (s1 * s3 - s2 * s2))
    if abs(det) < 1e-30:
        return out
    for i in range(N - 1, n):
        sy = 0.0
        sxy = 0.0
        sx2y = 0.0
        for j in range(N):
            y = close[i - N + 1 + j]
            xj = float(j)
            sy += y
            sxy += xj * y
            sx2y += xj * xj * y
        det_c = (s0 * (s2 * sx2y - sxy * s3)
                 - s1 * (s1 * sx2y - sxy * s2)
                 + sy * (s1 * s3 - s2 * s2))
        c = det_c / det
        out[i] = 2.0 * c
    return out


@njit(cache=True)
def _oscillation_frequency(close, N):
    """Dominant DFT frequency in rolling window of N close values."""
    n = len(close)
    out = np.empty(n, dtype=np.float64)
    out[:] = np.nan
    if N < 4 or n < N:
        return out
    n_freq = N // 2
    for i in range(N - 1, n):
        start = i - N + 1
        m_y = 0.0
        m_x = 0.0
        for j in range(N):
            m_x += j
            m_y += close[start + j]
        m_x /= N
        m_y /= N
        sxy = 0.0
        sxx = 0.0
        for j in range(N):
            dx = j - m_x
            dy = close[start + j] - m_y
            sxy += dx * dy
            sxx += dx * dx
        slope = sxy / (sxx + 1e-30)
        max_power = 0.0
        max_freq = 0.0
        for k in range(1, n_freq):
            re = 0.0
            im = 0.0
            for j in range(N):
                detrended = close[start + j] - (m_y + slope * (j - m_x))
                angle = 2.0 * np.pi * k * j / N
                re += detrended * np.cos(angle)
                im += detrended * np.sin(angle)
            power = re * re + im * im
            if power > max_power:
                max_power = power
                max_freq = float(k) / float(N)
        out[i] = max_freq
    return out


def _inertia(close, N, k):
    """Rolling autocorrelation of displacement at lag k."""
    disp = _price_displacement(close)
    return _rolling_autocorr(disp, N, k)


def _noise_ratio(close, N):
    """|displacement| / rolling_std(displacement, N)."""
    disp = _price_displacement(close)
    std = _rolling_std(disp, N)
    safe_std = np.where(std > 1e-20, std, np.nan)
    return np.abs(disp) / safe_std


def _kinetic_energy(close):
    """|displacement| * |acceleration|."""
    disp = _price_displacement(close)
    accel = _price_acceleration(close)
    return np.abs(disp) * np.abs(accel)


def _price_entropy(close, N):
    """Rolling Shannon entropy of displacement over N bars, 10 bins."""
    disp = _price_displacement(close)
    return _rolling_entropy(disp, N, 10)


def _hurst_exponent(close, N):
    """Rolling Hurst exponent via R/S analysis."""
    return _rolling_hurst(close, N)


def _fractal_dimension(close, N):
    """2 - hurst (Mandelbrot approximation of fractal dimension)."""
    h = _rolling_hurst(close, N)
    return 2.0 - h


def _trend_strength(close, N):
    """|trend_angle| * |displacement|."""
    angle = _trend_angle(close, N)
    disp = _price_displacement(close)
    return np.abs(angle) * np.abs(disp)


@njit(cache=True)
def _mean_reversion_rate(close, N):
    """|residual| / bars_since_cross(close, MA)."""
    n = len(close)
    out = np.empty(n, dtype=np.float64)
    out[:] = np.nan
    if N < 2 or n < N:
        return out
    ma = np.empty(n, dtype=np.float64)
    ma[:] = np.nan
    s = 0.0
    for j in range(N):
        s += close[j]
    ma[N - 1] = s / N
    for i in range(N, n):
        s += close[i] - close[i - N]
        ma[i] = s / N
    bars_since = 0
    prev_side = 0.0
    for i in range(N - 1, n):
        residual = close[i] - ma[i]
        side = 1.0 if residual >= 0 else -1.0
        if side != prev_side and prev_side != 0.0:
            bars_since = 0
        bars_since += 1
        prev_side = side
        out[i] = abs(residual) / float(bars_since)
    return out


@njit(cache=True)
def _cycle_amplitude(close, N):
    """Rolling peak-to-trough distance within window N."""
    n = len(close)
    out = np.empty(n, dtype=np.float64)
    out[:] = np.nan
    if N < 2 or n < N:
        return out
    for i in range(N - 1, n):
        wmax = close[i - N + 1]
        wmin = close[i - N + 1]
        for j in range(1, N):
            v = close[i - N + 1 + j]
            if v > wmax:
                wmax = v
            if v < wmin:
                wmin = v
        out[i] = wmax - wmin
    return out


@njit(cache=True)
def _cycle_asymmetry(close, N):
    """Ratio of up-cycle to down-cycle duration within rolling window N."""
    n = len(close)
    out = np.empty(n, dtype=np.float64)
    out[:] = np.nan
    if N < 2 or n < N + 1:
        return out
    for i in range(N, n):
        up_bars = 0
        down_bars = 0
        for j in range(N):
            idx = i - N + 1 + j
            if close[idx] > close[idx - 1]:
                up_bars += 1
            elif close[idx] < close[idx - 1]:
                down_bars += 1
        out[i] = float(up_bars) / max(float(down_bars), 1.0)
    return out


# -- OHLC Core (~15 unique) ---------------------------------------------------


@njit(cache=True)
def _candle_range(high, low):
    """H - L."""
    return high - low


@njit(cache=True)
def _body_ratio(open_, high, low, close):
    """(C - O) / (H - L). Positive = bullish, negative = bearish."""
    n = len(close)
    out = np.empty(n, dtype=np.float64)
    for i in range(n):
        rng = high[i] - low[i]
        if rng < 1e-20:
            out[i] = 0.0
        else:
            out[i] = (close[i] - open_[i]) / rng
    return out


@njit(cache=True)
def _wick_asymmetry(open_, high, low, close):
    """upper_wick / max(lower_wick, epsilon)."""
    n = len(close)
    out = np.empty(n, dtype=np.float64)
    eps = 1e-10
    for i in range(n):
        body_top = max(open_[i], close[i])
        body_bot = min(open_[i], close[i])
        upper = high[i] - body_top
        lower = body_bot - low[i]
        out[i] = upper / max(lower, eps)
    return out


@njit(cache=True)
def _candle_momentum(close):
    """C_t - C_{t-1}."""
    return _first_diff(close)


@njit(cache=True)
def _gap_magnitude(open_, close):
    """|O_t - C_{t-1}|."""
    n = len(close)
    out = np.empty(n, dtype=np.float64)
    out[0] = 0.0
    for i in range(1, n):
        out[i] = abs(open_[i] - close[i - 1])
    return out


def _reversal_strength(open_, high, low, close, N):
    """(1 - |body_ratio|) * range / volatility."""
    br = _body_ratio(open_, high, low, close)
    rng = _candle_range(high, low)
    vol = _local_volatility(close, N)
    safe_vol = np.where(vol > 1e-20, vol, np.nan)
    return (1.0 - np.abs(br)) * rng / safe_vol


@njit(cache=True)
def _trend_continuity(open_, close, N):
    """Fraction of bullish candles (C > O) in rolling window N."""
    n = len(close)
    out = np.empty(n, dtype=np.float64)
    out[:] = np.nan
    if N < 1 or n < N:
        return out
    bull_count = 0
    for j in range(N):
        if close[j] > open_[j]:
            bull_count += 1
    out[N - 1] = float(bull_count) / N
    for i in range(N, n):
        if close[i - N] > open_[i - N]:
            bull_count -= 1
        if close[i] > open_[i]:
            bull_count += 1
        out[i] = float(bull_count) / N
    return out


@njit(cache=True)
def _volatility_expansion(high, low):
    """Delta of candle range: (H-L)_t - (H-L)_{t-1}."""
    n = len(high)
    out = np.empty(n, dtype=np.float64)
    out[0] = 0.0
    for i in range(1, n):
        out[i] = (high[i] - low[i]) - (high[i - 1] - low[i - 1])
    return out


@njit(cache=True)
def _body_momentum(open_, close):
    """|body_t| / max(|body_{t-1}|, epsilon)."""
    n = len(close)
    out = np.empty(n, dtype=np.float64)
    eps = 1e-10
    out[0] = 0.0
    for i in range(1, n):
        body_curr = abs(close[i] - open_[i])
        body_prev = abs(close[i - 1] - open_[i - 1])
        out[i] = body_curr / max(body_prev, eps)
    return out


@njit(cache=True)
def _wick_ratio(open_, high, low, close):
    """total_wick / range."""
    n = len(close)
    out = np.empty(n, dtype=np.float64)
    for i in range(n):
        rng = high[i] - low[i]
        if rng < 1e-20:
            out[i] = 0.0
        else:
            body = abs(close[i] - open_[i])
            total_wick = rng - body
            out[i] = total_wick / rng
    return out


@njit(cache=True)
def _bullish_momentum(open_, close):
    """max(0, C - O)."""
    n = len(close)
    out = np.empty(n, dtype=np.float64)
    for i in range(n):
        d = close[i] - open_[i]
        out[i] = d if d > 0 else 0.0
    return out


@njit(cache=True)
def _bearish_momentum(open_, close):
    """max(0, O - C)."""
    n = len(close)
    out = np.empty(n, dtype=np.float64)
    for i in range(n):
        d = open_[i] - close[i]
        out[i] = d if d > 0 else 0.0
    return out


@njit(cache=True)
def _doji_strength(open_, high, low, close):
    """|C - O| / max(H - L, epsilon). Low values = doji-like."""
    n = len(close)
    out = np.empty(n, dtype=np.float64)
    eps = 1e-10
    for i in range(n):
        rng = high[i] - low[i]
        out[i] = abs(close[i] - open_[i]) / max(rng, eps)
    return out


@njit(cache=True)
def _engulfing_strength(open_, close):
    """|body_t| / max(|body_{t-1}|, epsilon)."""
    n = len(close)
    out = np.empty(n, dtype=np.float64)
    eps = 1e-10
    out[0] = 0.0
    for i in range(1, n):
        out[i] = abs(close[i] - open_[i]) / max(abs(close[i - 1] - open_[i - 1]), eps)
    return out


@njit(cache=True)
def _gap_frequency(open_, close, N):
    """Rolling count of gaps (|O_t - C_{t-1}| > 0) / N."""
    n = len(close)
    out = np.empty(n, dtype=np.float64)
    out[:] = np.nan
    if N < 1 or n < N + 1:
        return out
    gaps = np.empty(n, dtype=np.float64)
    gaps[0] = 0.0
    for i in range(1, n):
        gaps[i] = 1.0 if abs(open_[i] - close[i - 1]) > 1e-10 else 0.0
    s = 0.0
    for j in range(1, N + 1):
        s += gaps[j]
    out[N] = s / N
    for i in range(N + 1, n):
        s += gaps[i] - gaps[i - N]
        out[i] = s / N
    return out


# -- Temporal Core (~13 unique) ------------------------------------------------


@njit(cache=True)
def _time_to_peak(close, N):
    """Bars since last local max within rolling window N."""
    n = len(close)
    out = np.empty(n, dtype=np.float64)
    out[:] = np.nan
    if N < 2 or n < N:
        return out
    for i in range(N - 1, n):
        peak_idx = 0
        peak_val = close[i - N + 1]
        for j in range(1, N):
            v = close[i - N + 1 + j]
            if v >= peak_val:
                peak_val = v
                peak_idx = j
        out[i] = float(N - 1 - peak_idx)
    return out


@njit(cache=True)
def _cycle_duration(close, N):
    """Mean inter-peak interval within rolling window N."""
    n = len(close)
    out = np.empty(n, dtype=np.float64)
    out[:] = np.nan
    if N < 4 or n < N:
        return out
    for i in range(N - 1, n):
        start = i - N + 1
        prev_peak = -1
        total_gap = 0.0
        n_gaps = 0
        for j in range(1, N - 1):
            idx = start + j
            if close[idx] > close[idx - 1] and close[idx] > close[idx + 1]:
                if prev_peak >= 0:
                    total_gap += float(j - prev_peak)
                    n_gaps += 1
                prev_peak = j
        if n_gaps > 0:
            out[i] = total_gap / n_gaps
        else:
            out[i] = float(N)
    return out


def _price_autocorrelation(close, N, k):
    """Rolling autocorrelation of close at lag k."""
    return _rolling_autocorr(close, N, k)


def _volatility_clustering(close, N):
    """Autocorrelation of squared returns -- measures ARCH effect."""
    lr = _log_return(close)
    sq = lr * lr
    return _rolling_autocorr(sq, N, 1)


@njit(cache=True)
def _mean_reversion_time(close, N):
    """Rolling average bars between consecutive MA crosses within window."""
    n = len(close)
    out = np.empty(n, dtype=np.float64)
    out[:] = np.nan
    if N < 2 or n < N:
        return out
    for i in range(N - 1, n):
        start = i - N + 1
        s = 0.0
        for j in range(N):
            s += close[start + j]
        ma = s / N
        prev_side = 1.0 if close[start] >= ma else -1.0
        total_bars = 0.0
        n_crosses = 0
        bars_since_cross = 0
        for j in range(1, N):
            bars_since_cross += 1
            side = 1.0 if close[start + j] >= ma else -1.0
            if side != prev_side:
                total_bars += float(bars_since_cross)
                n_crosses += 1
                bars_since_cross = 0
            prev_side = side
        if n_crosses > 0:
            out[i] = total_bars / n_crosses
        else:
            out[i] = float(N)
    return out


@njit(cache=True)
def _event_latency(close, N):
    """Rolling average bars between > 2-sigma moves."""
    n = len(close)
    out = np.empty(n, dtype=np.float64)
    out[:] = np.nan
    if N < 3 or n < N + 1:
        return out
    for i in range(N, n):
        start = i - N + 1
        m = 0.0
        for j in range(1, N):
            m += close[start + j] - close[start + j - 1]
        m /= (N - 1)
        s2 = 0.0
        for j in range(1, N):
            d = (close[start + j] - close[start + j - 1]) - m
            s2 += d * d
        std = np.sqrt(s2 / (N - 2)) if N > 2 else 0.0
        threshold = 2.0 * std
        if std < 1e-20:
            out[i] = float(N)
            continue
        prev_event = -1
        total_gap = 0.0
        n_gaps = 0
        for j in range(1, N):
            ret = abs(close[start + j] - close[start + j - 1])
            if ret > threshold:
                if prev_event >= 0:
                    total_gap += float(j - prev_event)
                    n_gaps += 1
                prev_event = j
        if n_gaps > 0:
            out[i] = total_gap / n_gaps
        else:
            out[i] = float(N)
    return out


@njit(cache=True)
def _trend_duration(close, N):
    """Rolling max consecutive bars in same direction within window N."""
    n = len(close)
    out = np.empty(n, dtype=np.float64)
    out[:] = np.nan
    if N < 2 or n < N + 1:
        return out
    for i in range(N, n):
        start = i - N + 1
        max_run = 0
        current_run = 0
        prev_dir = 0.0
        for j in range(1, N):
            idx = start + j
            d = close[idx] - close[idx - 1]
            direction = 1.0 if d > 0 else (-1.0 if d < 0 else 0.0)
            if direction != 0.0 and direction == prev_dir:
                current_run += 1
            else:
                if current_run > max_run:
                    max_run = current_run
                current_run = 1
            if direction != 0.0:
                prev_dir = direction
        if current_run > max_run:
            max_run = current_run
        out[i] = float(max_run)
    return out


@njit(cache=True)
def _time_asymmetry(close, N):
    """uptrend_bars / max(downtrend_bars, 1) in rolling window N."""
    n = len(close)
    out = np.empty(n, dtype=np.float64)
    out[:] = np.nan
    if N < 2 or n < N + 1:
        return out
    for i in range(N, n):
        start = i - N + 1
        up = 0
        down = 0
        for j in range(1, N):
            idx = start + j
            if close[idx] > close[idx - 1]:
                up += 1
            elif close[idx] < close[idx - 1]:
                down += 1
        out[i] = float(up) / max(float(down), 1.0)
    return out


@njit(cache=True)
def _momentum_persistence(close, N):
    """Current run of sustained momentum direction (clipped to N)."""
    n = len(close)
    out = np.empty(n, dtype=np.float64)
    out[:] = np.nan
    if n < 2:
        return out
    run = 0
    prev_dir = 0.0
    for i in range(1, n):
        d = close[i] - close[i - 1]
        direction = 1.0 if d > 0 else (-1.0 if d < 0 else 0.0)
        if direction != 0.0 and direction == prev_dir:
            run += 1
        else:
            run = 1
        if direction != 0.0:
            prev_dir = direction
        out[i] = float(min(run, N))
    out[0] = np.nan
    return out


@njit(cache=True)
def _reversal_latency(close, N):
    """Bars from most recent local extremum within rolling window N."""
    n = len(close)
    out = np.empty(n, dtype=np.float64)
    out[:] = np.nan
    if N < 3 or n < N:
        return out
    for i in range(N - 1, n):
        start = i - N + 1
        latest_ext = -1
        for j in range(N - 2, 0, -1):
            idx = start + j
            if close[idx] > close[idx - 1] and close[idx] > close[idx + 1]:
                latest_ext = j
                break
            if close[idx] < close[idx - 1] and close[idx] < close[idx + 1]:
                latest_ext = j
                break
        if latest_ext >= 0:
            out[i] = float(N - 1 - latest_ext)
        else:
            out[i] = float(N)
    return out


def _autocorrelation_decay(close, N):
    """Rate of autocorrelation decline: autocorr(lag=1) - autocorr(lag=N//4)."""
    ac1 = _rolling_autocorr(close, N, 1)
    lag2 = max(N // 4, 2)
    ac2 = _rolling_autocorr(close, N, lag2)
    return ac1 - ac2


@njit(cache=True)
def _cycle_frequency(close, N):
    """Number of local peaks per N bars in rolling window."""
    n = len(close)
    out = np.empty(n, dtype=np.float64)
    out[:] = np.nan
    if N < 3 or n < N:
        return out
    for i in range(N - 1, n):
        start = i - N + 1
        peaks = 0
        for j in range(1, N - 1):
            idx = start + j
            if close[idx] > close[idx - 1] and close[idx] > close[idx + 1]:
                peaks += 1
        out[i] = float(peaks)
    return out


@njit(cache=True)
def _trend_change_frequency(close, N):
    """Direction changes per rolling window N."""
    n = len(close)
    out = np.empty(n, dtype=np.float64)
    out[:] = np.nan
    if N < 3 or n < N + 1:
        return out
    for i in range(N, n):
        start = i - N + 1
        changes = 0
        prev_dir = 0.0
        for j in range(1, N):
            idx = start + j
            d = close[idx] - close[idx - 1]
            direction = 1.0 if d > 0 else (-1.0 if d < 0 else 0.0)
            if direction != 0.0 and prev_dir != 0.0 and direction != prev_dir:
                changes += 1
            if direction != 0.0:
                prev_dir = direction
        out[i] = float(changes)
    return out


# -- Volume Core (~7 unique) ---------------------------------------------------


def _raw_volume(volume):
    """Volume directly (identity copy)."""
    return volume.copy()


@njit(cache=True)
def _volume_momentum(volume):
    """Delta of volume: V_t - V_{t-1}."""
    return _first_diff(volume)


@njit(cache=True)
def _volume_skew(open_, high, low, close, volume):
    """Approximate buy/sell split: (2*(C-L)/(H-L) - 1) * V."""
    n = len(close)
    out = np.empty(n, dtype=np.float64)
    for i in range(n):
        rng = high[i] - low[i]
        if rng < 1e-20:
            out[i] = 0.0
        else:
            out[i] = (2.0 * (close[i] - low[i]) / rng - 1.0) * volume[i]
    return out


def _volume_clustering(volume, N):
    """Autocorrelation of volume at lag 1."""
    return _rolling_autocorr(volume, N, 1)


def _flow_intensity(close, volume):
    """V * |delta_P|."""
    disp = np.abs(_price_displacement(close))
    return volume * disp


def _trade_frequency_proxy(volume, N):
    """volume / rolling_mean(volume, N) -- relative activity."""
    ma = _rolling_mean(volume, N)
    safe_ma = np.where(ma > 1e-20, ma, np.nan)
    return volume / safe_ma


@njit(cache=True)
def _rolling_corr(x, y, N):
    """Rolling Pearson correlation between x and y over window N."""
    n = len(x)
    out = np.empty(n, dtype=np.float64)
    out[:] = np.nan
    if N < 3 or n < N:
        return out
    for i in range(N - 1, n):
        mx = 0.0
        my = 0.0
        for j in range(N):
            mx += x[i - N + 1 + j]
            my += y[i - N + 1 + j]
        mx /= N
        my /= N
        cov = 0.0
        vx = 0.0
        vy = 0.0
        for j in range(N):
            dx = x[i - N + 1 + j] - mx
            dy = y[i - N + 1 + j] - my
            cov += dx * dy
            vx += dx * dx
            vy += dy * dy
        denom = np.sqrt(vx * vy)
        if denom < 1e-20:
            out[i] = np.nan
        else:
            out[i] = cov / denom
    return out


def _volume_price_corr(close, volume, N):
    """Rolling correlation of |returns| and volume over N bars."""
    lr = _log_return(close)
    abs_ret = np.abs(lr)
    return _rolling_corr(abs_ret, volume, N)


# -- Structure Core (~10 unique) -----------------------------------------------


def _compression_volatility(close, N):
    """Rolling std of close in a narrow window (N//2)."""
    half = max(N // 2, 2)
    return _rolling_std(close, half)


@njit(cache=True)
def _range_contraction(high, low):
    """(H-L)_t / max((H-L)_{t-1}, epsilon)."""
    n = len(high)
    out = np.empty(n, dtype=np.float64)
    eps = 1e-10
    out[0] = 1.0
    for i in range(1, n):
        curr_rng = high[i] - low[i]
        prev_rng = high[i - 1] - low[i - 1]
        out[i] = curr_rng / max(prev_rng, eps)
    return out


def _pattern_slope(high, low, N):
    """Average of linreg_slope(high) and linreg_slope(low) over N."""
    slope_h = _rolling_linreg_slope(high, N)
    slope_l = _rolling_linreg_slope(low, N)
    return (slope_h + slope_l) / 2.0


@njit(cache=True)
def _structural_break(close, N):
    """|close - channel_midpoint| / channel_width."""
    n = len(close)
    out = np.empty(n, dtype=np.float64)
    out[:] = np.nan
    if N < 2 or n < N:
        return out
    for i in range(N - 1, n):
        cmax = close[i - N + 1]
        cmin = close[i - N + 1]
        for j in range(1, N):
            v = close[i - N + 1 + j]
            if v > cmax:
                cmax = v
            if v < cmin:
                cmin = v
        width = cmax - cmin
        if width < 1e-20:
            out[i] = 0.0
        else:
            mid = (cmax + cmin) / 2.0
            out[i] = abs(close[i] - mid) / width
    return out


@njit(cache=True)
def _compression_duration(high, low, close, N):
    """Bars of range < median range within rolling window N."""
    n = len(close)
    out = np.empty(n, dtype=np.float64)
    out[:] = np.nan
    if N < 3 or n < N:
        return out
    ranges = np.empty(n, dtype=np.float64)
    for i in range(n):
        ranges[i] = high[i] - low[i]
    for i in range(N - 1, n):
        buf = np.empty(N, dtype=np.float64)
        for j in range(N):
            buf[j] = ranges[i - N + 1 + j]
        for a in range(1, N):
            key = buf[a]
            b = a - 1
            while b >= 0 and buf[b] > key:
                buf[b + 1] = buf[b]
                b -= 1
            buf[b + 1] = key
        median = buf[N // 2]
        count = 0
        for j in range(N):
            if ranges[i - N + 1 + j] < median:
                count += 1
        out[i] = float(count)
    return out


@njit(cache=True)
def _fractal_dimension_structure(high, low, close, N):
    """Fractal dimension via Higuchi-like path-length method."""
    n = len(close)
    out = np.empty(n, dtype=np.float64)
    out[:] = np.nan
    if N < 4 or n < N:
        return out
    for i in range(N - 1, n):
        start = i - N + 1
        path = 0.0
        for j in range(1, N):
            path += abs(close[start + j] - close[start + j - 1])
        wmax = high[start]
        wmin = low[start]
        for j in range(1, N):
            if high[start + j] > wmax:
                wmax = high[start + j]
            if low[start + j] < wmin:
                wmin = low[start + j]
        rng = wmax - wmin
        if rng < 1e-20 or path < 1e-20:
            out[i] = np.nan
        else:
            L = path / rng
            out[i] = 1.0 + np.log(L) / np.log(2.0 * N)
    return out


def _breakout_intensity(high, low, close, N):
    """range_expansion * structural_break magnitude."""
    rng = _candle_range(high, low)
    avg_rng = _rolling_mean(rng, N)
    safe_avg = np.where(avg_rng > 1e-20, avg_rng, np.nan)
    expansion = (rng - avg_rng) / safe_avg
    sb = _structural_break(close, N)
    return expansion * sb


def _consolidation_entropy(close, N):
    """Shannon entropy of close values within rolling window N."""
    return _rolling_entropy(close, N, 10)


def _range_expansion(high, low, N):
    """current_range / rolling_mean(range, N)."""
    rng = _candle_range(high, low)
    avg_rng = _rolling_mean(rng, N)
    safe_avg = np.where(avg_rng > 1e-20, avg_rng, np.nan)
    return rng / safe_avg


def _pattern_curvature(high, low, N):
    """Second derivative of trendline slopes (high+low average)."""
    slope = _pattern_slope(high, low, N)
    return _second_diff(slope)


# -- Regime Cues Core (~8 unique) ----------------------------------------------


def _volatility_regime(close, N):
    """local_vol / rolling_mean(local_vol, 5*N). Relative volatility state."""
    vol = _local_volatility(close, N)
    long_ma = _rolling_mean(vol, 5 * N)
    safe_ma = np.where(long_ma > 1e-20, long_ma, np.nan)
    return vol / safe_ma


def _trend_regime(close, N):
    """|trend_angle| / rolling_mean(|trend_angle|, 5*N)."""
    angle = _trend_angle(close, N)
    abs_angle = np.abs(angle)
    long_ma = _rolling_mean(abs_angle, 5 * N)
    safe_ma = np.where(long_ma > 1e-20, long_ma, np.nan)
    return abs_angle / safe_ma


@njit(cache=True)
def _regime_persistence(close, N):
    """Bars in current vol regime (high/low relative to long-term average)."""
    n = len(close)
    out = np.empty(n, dtype=np.float64)
    out[:] = np.nan
    if N < 3 or n < N + 1:
        return out
    lr = np.empty(n, dtype=np.float64)
    lr[0] = 0.0
    for i in range(1, n):
        if close[i - 1] > 1e-20:
            lr[i] = np.log(close[i] / close[i - 1])
        else:
            lr[i] = 0.0
    vol = np.empty(n, dtype=np.float64)
    vol[:] = np.nan
    for i in range(N - 1, n):
        m = 0.0
        for j in range(N):
            m += lr[i - N + 1 + j]
        m /= N
        v = 0.0
        for j in range(N):
            d = lr[i - N + 1 + j] - m
            v += d * d
        vol[i] = np.sqrt(v / (N - 1)) if N > 1 else 0.0
    long_n = 5 * N
    long_ma = np.empty(n, dtype=np.float64)
    long_ma[:] = np.nan
    if n > long_n + N:
        s = 0.0
        cnt = 0
        for j in range(N - 1, N - 1 + long_n):
            if not np.isnan(vol[j]):
                s += vol[j]
                cnt += 1
        if cnt > 0:
            long_ma[N - 1 + long_n - 1] = s / cnt
        for i in range(N - 1 + long_n, n):
            old_v = vol[i - long_n]
            new_v = vol[i]
            if not np.isnan(old_v):
                s -= old_v
                cnt -= 1
            if not np.isnan(new_v):
                s += new_v
                cnt += 1
            if cnt > 0:
                long_ma[i] = s / cnt
    run = 0
    prev_regime = 0
    for i in range(N - 1, n):
        if np.isnan(vol[i]) or np.isnan(long_ma[i]):
            out[i] = np.nan
            continue
        regime = 1 if vol[i] >= long_ma[i] else -1
        if regime == prev_regime:
            run += 1
        else:
            run = 1
        prev_regime = regime
        out[i] = float(run)
    return out


def _regime_divergence(close, N):
    """actual_vol - expected_vol (EWMA variance proxy)."""
    lr = _log_return(close)
    sq_ret = lr * lr
    alpha = 2.0 / (N + 1.0)
    n = len(close)
    ewma = np.empty(n, dtype=np.float64)
    ewma[:] = np.nan
    if n > 0:
        ewma[0] = sq_ret[0]
        for i in range(1, n):
            ewma[i] = alpha * sq_ret[i] + (1.0 - alpha) * ewma[i - 1]
    expected_vol = np.sqrt(np.maximum(ewma, 0.0))
    actual_vol = _local_volatility(close, N)
    return actual_vol - expected_vol


def _correlation_shift(close, N):
    """Delta of rolling autocorrelation at lag 1."""
    ac = _rolling_autocorr(close, N, 1)
    return _first_diff(ac)


def _volatility_break(close, N):
    """|sigma_t - sigma_{t-1}| / sigma_{t-1}."""
    vol = _local_volatility(close, N)
    n = len(vol)
    out = np.empty(n, dtype=np.float64)
    out[0] = np.nan
    for i in range(1, n):
        if np.isnan(vol[i]) or np.isnan(vol[i - 1]) or vol[i - 1] < 1e-20:
            out[i] = np.nan
        else:
            out[i] = abs(vol[i] - vol[i - 1]) / vol[i - 1]
    return out


def _regime_entropy(close, N):
    """Entropy of local volatility distribution over N bars."""
    vol = _local_volatility(close, N)
    return _rolling_entropy(vol, N, 10)


@njit(cache=True)
def _regime_transition_frequency(close, N):
    """Regime changes per window. Regime = above/below median local vol."""
    n = len(close)
    out = np.empty(n, dtype=np.float64)
    out[:] = np.nan
    if N < 3 or n < N + 1:
        return out
    lr = np.empty(n, dtype=np.float64)
    lr[0] = 0.0
    for i in range(1, n):
        if close[i - 1] > 1e-20:
            lr[i] = np.log(close[i] / close[i - 1])
        else:
            lr[i] = 0.0
    half = max(N // 4, 2)
    vol = np.empty(n, dtype=np.float64)
    vol[:] = np.nan
    for i in range(half - 1, n):
        m = 0.0
        for j in range(half):
            m += lr[i - half + 1 + j]
        m /= half
        v = 0.0
        for j in range(half):
            d = lr[i - half + 1 + j] - m
            v += d * d
        vol[i] = np.sqrt(v / max(half - 1, 1))
    for i in range(N - 1 + half, n):
        start = i - N + 1
        buf = np.empty(N, dtype=np.float64)
        valid = 0
        for j in range(N):
            if not np.isnan(vol[start + j]):
                buf[valid] = vol[start + j]
                valid += 1
        if valid < 3:
            out[i] = np.nan
            continue
        for a in range(1, valid):
            key = buf[a]
            b = a - 1
            while b >= 0 and buf[b] > key:
                buf[b + 1] = buf[b]
                b -= 1
            buf[b + 1] = key
        median_vol = buf[valid // 2]
        transitions = 0
        prev_regime = 0
        for j in range(N):
            v = vol[start + j]
            if np.isnan(v):
                continue
            regime = 1 if v >= median_vol else -1
            if prev_regime != 0 and regime != prev_regime:
                transitions += 1
            prev_regime = regime
        out[i] = float(transitions)
    return out


