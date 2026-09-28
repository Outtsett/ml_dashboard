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


def maximum_drawdown(cumulative: np.ndarray) -> float:
    x = np.asarray(cumulative, dtype=float)
    if x.size == 0:
        return math.nan
    peak = np.maximum.accumulate(np.r_[0.0, x])[1:]
    return float((x - peak).min())
