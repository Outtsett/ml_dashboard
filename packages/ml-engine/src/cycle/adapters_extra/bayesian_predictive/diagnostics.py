"""Convergence diagnostics of the samplers: split R-hat and a bulk effective sample size.

``split_r_hat(draws)`` for draws of shape (chains, iterations): each chain is
cut in two halves, and R-hat = sqrt(((n - 1)/n W + B/n) / W) over the 2m half
chains (Gelman et al., Bayesian Data Analysis 3rd ed., 11.4), W the mean
within-half variance, B/n the variance of the half means. 1.0 means the
halves agree; above about 1.05 the sampler has not mixed.

``effective_sample_size(draws)`` uses the initial positive sequence of the
pooled autocorrelation (Geyer), the same estimator family as arviz's "bulk"
ESS without the rank normalisation.
"""

from __future__ import annotations

import math

import numpy as np


def _halves(draws: np.ndarray) -> np.ndarray:
    draws = np.asarray(draws, dtype=np.float64)
    if draws.ndim == 1:
        draws = draws[None, :]
    half = draws.shape[1] // 2
    if half < 2:
        raise ValueError("split R-hat needs at least 4 draws per chain")
    return np.concatenate([draws[:, :half], draws[:, half:2 * half]], axis=0)


def split_r_hat(draws) -> float:
    chains = _halves(draws)
    count = chains.shape[1]
    within = float(np.mean(np.var(chains, axis=1, ddof=1)))
    between = float(count * np.var(np.mean(chains, axis=1), ddof=1))
    if within <= 0.0:
        return 1.0 if between <= 0.0 else math.inf
    pooled = (count - 1) / count * within + between / count
    return float(math.sqrt(pooled / within))


def effective_sample_size(draws) -> float:
    chains = _halves(draws)
    chain_count, count = chains.shape
    centred = chains - chains.mean(axis=1, keepdims=True)
    variance = float(np.mean(np.var(chains, axis=1, ddof=1)))
    if variance <= 0.0:
        return float(chain_count * count)
    spectrum = np.fft.rfft(centred, n=2 * count, axis=1)
    autocovariance = np.fft.irfft(spectrum * np.conj(spectrum), axis=1)[:, :count] / count
    correlation = autocovariance.mean(axis=0) / autocovariance.mean(axis=0)[0]
    total = 0.0
    for lag in range(0, count - 1, 2):
        pair = correlation[lag] + correlation[lag + 1]
        if pair <= 0.0:
            break
        total += pair
    tau = max(-1.0 + 2.0 * total, 1.0 / math.log10(chain_count * count + 10))
    return float(chain_count * count / tau)


def worst(draws_by_name: dict[str, np.ndarray]) -> tuple[float, float]:
    """(largest split R-hat, smallest effective sample size) over every scalar
    series in ``draws_by_name`` ({name: (chains, iterations[, ...])})."""
    r_hat, effective = 1.0, math.inf
    for draws in draws_by_name.values():
        draws = np.asarray(draws, dtype=np.float64)
        series = draws.reshape(draws.shape[0], draws.shape[1], -1)
        for column in range(series.shape[2]):
            r_hat = max(r_hat, split_r_hat(series[:, :, column]))
            effective = min(effective, effective_sample_size(series[:, :, column]))
    return r_hat, effective


__all__ = ["effective_sample_size", "split_r_hat", "worst"]
