"""Distribution and significance numbers for a daily net-ticks series.

- ``eight_numbers``: mean, median, standard deviation, skewness, excess
  kurtosis, 25th / 75th percentile, minimum, maximum (NaN when too few values).
- ``block_bootstrap_mean_interval``: a 95% interval for the mean daily ticks
  from a moving-block bootstrap over session days (days are autocorrelated, so
  single-day resampling would understate the width).
- ``deflated_sharpe_probability``: Bailey & Lopez de Prado (2014). The chance
  the best configuration's Sharpe ratio beats the maximum Sharpe expected from
  ``trial_count`` tries of pure noise, given the skew and kurtosis of its days.
"""

from __future__ import annotations

import math

import numpy as np
from scipy import stats

EULER_GAMMA = 0.5772156649015329


def eight_numbers(values: np.ndarray, prefix: str) -> dict:
    x = np.asarray(values, dtype=float)
    x = x[np.isfinite(x)]
    n = x.size
    return {
        f"{prefix}_mean": float(x.mean()) if n else math.nan,
        f"{prefix}_median": float(np.median(x)) if n else math.nan,
        f"{prefix}_standard_deviation": float(x.std(ddof=1)) if n > 1 else math.nan,
        f"{prefix}_skewness": float(stats.skew(x)) if n > 2 else math.nan,
        f"{prefix}_excess_kurtosis": float(stats.kurtosis(x)) if n > 3 else math.nan,
        f"{prefix}_percentile_25": float(np.percentile(x, 25)) if n else math.nan,
        f"{prefix}_percentile_75": float(np.percentile(x, 75)) if n else math.nan,
        f"{prefix}_minimum": float(x.min()) if n else math.nan,
        f"{prefix}_maximum": float(x.max()) if n else math.nan,
    }


def block_bootstrap_mean_interval(values: np.ndarray, block_days: int = 10, repetitions: int = 2000,
                                  seed: int = 7) -> tuple[float, float]:
    x = np.asarray(values, dtype=float)
    n = x.size
    if n < 2 * block_days:
        return math.nan, math.nan
    rng = np.random.default_rng(seed)
    blocks_needed = int(math.ceil(n / block_days))
    starts = rng.integers(0, n - block_days + 1, size=(repetitions, blocks_needed))
    offsets = np.arange(block_days)
    samples = x[(starts[:, :, None] + offsets).reshape(repetitions, -1)[:, :n]]
    means = samples.mean(axis=1)
    return float(np.percentile(means, 2.5)), float(np.percentile(means, 97.5))


def annualised_sharpe(daily: np.ndarray, days_per_year: float = 252.0) -> float:
    x = np.asarray(daily, dtype=float)
    if x.size < 2 or x.std(ddof=1) == 0:
        return math.nan
    return float(x.mean() / x.std(ddof=1) * math.sqrt(days_per_year))


def expected_maximum_sharpe(sharpe_variance: float, trial_count: int) -> float:
    """Expected maximum of ``trial_count`` per-period Sharpe ratios of pure noise."""
    if trial_count < 2 or not np.isfinite(sharpe_variance) or sharpe_variance <= 0:
        return 0.0
    z = stats.norm.ppf
    return math.sqrt(sharpe_variance) * (
        (1 - EULER_GAMMA) * z(1 - 1.0 / trial_count) + EULER_GAMMA * z(1 - 1.0 / (trial_count * math.e))
    )


def deflated_sharpe_probability(daily: np.ndarray, benchmark_sharpe_per_day: float) -> float:
    x = np.asarray(daily, dtype=float)
    n = x.size
    if n < 4 or x.std(ddof=1) == 0:
        return math.nan
    sharpe = x.mean() / x.std(ddof=1)
    skew = stats.skew(x)
    kurtosis = stats.kurtosis(x, fisher=False)
    denominator = 1 - skew * sharpe + (kurtosis - 1) / 4.0 * sharpe**2
    if denominator <= 0:
        return math.nan
    return float(stats.norm.cdf((sharpe - benchmark_sharpe_per_day) * math.sqrt(n - 1) / math.sqrt(denominator)))


def newey_west_mean_t(values: np.ndarray, lags: int = 10) -> float:
    """t-statistic of the mean with a Newey-West (heteroskedasticity- and
    autocorrelation-consistent, Bartlett-weighted) standard error."""
    x = np.asarray(values, dtype=float)
    x = x[np.isfinite(x)]
    n = x.size
    if n < lags + 2:
        return math.nan
    e = x - x.mean()
    variance = e @ e / n
    for lag in range(1, lags + 1):
        variance += 2 * (1 - lag / (lags + 1)) * (e[lag:] @ e[:-lag]) / n
    return float(x.mean() / math.sqrt(variance / n)) if variance > 0 else math.nan


def alpha_beta(net: np.ndarray, market: np.ndarray, lags: int = 10) -> dict:
    """OLS of daily net ticks on daily buy-and-hold ticks: ``net = alpha + beta * market``.

    ``beta * mean(market)`` is what the configuration earned by being long a rising
    market; ``alpha`` is what is left. The alpha series (alpha + residual) is what
    the significance numbers are computed on; its HAC t is the headline test."""
    y = np.asarray(net, dtype=float)
    x = np.asarray(market, dtype=float)
    keep = np.isfinite(y) & np.isfinite(x)
    y, x = y[keep], x[keep]
    if y.size < 20 or x.std() == 0:
        return {"beta": math.nan, "alpha": math.nan, "alpha_series": np.full(keep.sum(), np.nan)}
    beta = float(np.cov(y, x, ddof=1)[0, 1] / x.var(ddof=1))
    alpha_series = y - beta * x
    return {"beta": beta, "alpha": float(alpha_series.mean()), "alpha_series": alpha_series,
            "beta_contribution": beta * float(x.mean()), "alpha_newey_west_t": newey_west_mean_t(alpha_series, lags),
            "excess_newey_west_t": newey_west_mean_t(y - x, lags)}


def effective_trial_count(matrix: np.ndarray) -> float:
    """Participation ratio of the eigenvalues of the configurations' correlation
    matrix: how many independent tests a grid of correlated configurations is."""
    m = np.asarray(matrix, dtype=float)
    m = m[:, np.nanstd(m, axis=0) > 0]
    if m.shape[1] < 2:
        return float(m.shape[1])
    eigenvalues = np.clip(np.linalg.eigvalsh(np.corrcoef(m, rowvar=False)), 0, None)
    return float(eigenvalues.sum() ** 2 / (eigenvalues**2).sum())


def reality_check_p_value(matrix: np.ndarray, block_days: int = 10, repetitions: int = 2000, seed: int = 11) -> float:
    """White's (2000) Reality Check with studentized means: the chance that the
    best configuration's t looks this good when every configuration's true mean
    is zero, from a joint moving-block bootstrap over the shared session days."""
    m = np.asarray(matrix, dtype=float)
    n, k = m.shape
    if n < 2 * block_days or k == 0:
        return math.nan
    means = m.mean(axis=0)
    scale = m.std(axis=0, ddof=1) / math.sqrt(n)
    scale[scale == 0] = np.inf
    observed = float(np.max(means / scale))
    rng = np.random.default_rng(seed)
    blocks = int(math.ceil(n / block_days))
    offsets = np.arange(block_days)
    exceed = 0
    for _ in range(repetitions):
        rows = (rng.integers(0, n - block_days + 1, size=blocks)[:, None] + offsets).reshape(-1)[:n]
        simulated = (m[rows].mean(axis=0) - means) / scale
        exceed += simulated.max() >= observed
    return float(exceed / repetitions)


def maximum_drawdown(cumulative: np.ndarray) -> float:
    x = np.asarray(cumulative, dtype=float)
    if x.size == 0:
        return math.nan
    peak = np.maximum.accumulate(np.r_[0.0, x])[1:]
    return float((x - peak).min())
