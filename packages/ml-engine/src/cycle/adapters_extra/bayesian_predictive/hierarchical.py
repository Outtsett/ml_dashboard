"""A hierarchical linear model sampled by Gibbs (the ``hierarchical_gibbs`` engine).

Groups are time-of-day session blocks: the day as the lake stamps it is cut
into ``session_block_count`` equal blocks, and a bar belongs to the block of
its own timestamp (a run holds one instrument, so the spec's instruments
cannot be the groups). With x the intercept plus the standardised features:

    y_i        ~ N(x_i' b_g(i), sigma^2)
    b_g,j      ~ N(mu_j, tau_j^2)                  each block's weights around the shared ones
    mu_j       ~ N(0, prior_scale^2)
    tau_j^2    ~ InverseGamma(2, 0.1)
    sigma^2    ~ InverseGamma(2, 1)

Every full conditional is conjugate, so one Gibbs sweep draws exactly:

    b_g | .    ~ N(P^-1 (X_g'y_g / sigma^2 + D^-1 mu), P^-1),  P = X_g'X_g / sigma^2 + D^-1, D = diag(tau^2)
    mu_j | .   ~ N(m, v),  v = 1 / (G / tau_j^2 + 1 / prior_scale^2),  m = v sum_g b_g,j / tau_j^2
    tau_j^2 |  ~ InverseGamma(2 + G/2, 0.1 + sum_g (b_g,j - mu_j)^2 / 2)
    sigma^2 |  ~ InverseGamma(2 + n/2, 1 + |y - X b|^2 / 2)

A block with no training bars draws its weights from N(mu, tau^2) (no data,
prior only), so it is still defined. Each chain is one epoch of the fit;
``warmup_iterations`` sweeps are discarded, ``draw_count`` kept (evenly thinned
to at most ``STORED_DRAWS`` over all chains). Split R-hat and the effective
sample size of sigma^2 and mu are logged. Predictive: P(up) = mean over draws
of Phi(x'b_g / sigma); the price model is the mean of x'b_g.
"""

from __future__ import annotations

import math

import numpy as np
from scipy import special

from . import diagnostics

STORED_DRAWS = 1000
SHAPE_PRIOR = 2.0
GROUP_SCALE_PRIOR = 0.1
NOISE_SCALE_PRIOR = 1.0
CHECK_EVERY = 100
R_HAT_LIMIT = 1.05
SECONDS_PER_DAY = 86400


def session_blocks(timestamps, block_count: int) -> np.ndarray:
    """int64 block of each bar from its own timestamp: floor(time of day / (day / block_count))."""
    seconds = np.asarray(timestamps, dtype=np.int64) % SECONDS_PER_DAY
    return (seconds * int(block_count)) // SECONDS_PER_DAY


def _inverse_gamma(generator, shape, scale) -> np.ndarray:
    return np.asarray(scale, dtype=np.float64) / generator.gamma(shape, 1.0, size=np.shape(scale))


class HierarchicalGibbs:
    name = "hierarchical_gibbs"

    def __init__(self, parameters: dict, seed: int) -> None:
        self.parameters = dict(parameters)
        self.seed = int(seed)
        self.summary: dict = {}
        self.chains: list[dict] = []

    # the adapter runs one chain per epoch
    def start(self, x: np.ndarray, y: np.ndarray, groups: np.ndarray) -> None:
        self.block_count = int(self.parameters["session_block_count"])
        design = np.column_stack([np.ones(x.shape[0]), x])
        self.design_width = design.shape[1]
        self.gram = np.zeros((self.block_count, self.design_width, self.design_width))
        self.moment = np.zeros((self.block_count, self.design_width))
        self.block_rows = np.zeros(self.block_count, dtype=np.int64)
        for group in range(self.block_count):
            mask = groups == group
            self.gram[group] = design[mask].T @ design[mask]
            self.moment[group] = design[mask].T @ y[mask]
            self.block_rows[group] = int(mask.sum())
        self.design, self.target, self.groups = design, y, groups
        self.chains = []

    def run_chain(self, chain: int, checkpoint) -> None:
        p = self.parameters
        generator = np.random.default_rng((self.seed, int(chain)))
        width, blocks = self.design_width, self.block_count
        prior_variance = float(p["prior_scale"]) ** 2
        mu = np.zeros(width)
        tau = np.ones(width)
        sigma = float(np.var(self.target)) or 1.0
        weights = np.zeros((blocks, width))
        warmup, kept = int(p["warmup_iterations"]), int(p["draw_count"])
        record = {"weights": np.empty((kept, blocks, width)), "sigma": np.empty(kept), "mu": np.empty((kept, width))}
        count = self.target.size
        for sweep in range(warmup + kept):
            if sweep % CHECK_EVERY == 0:
                checkpoint()
            for group in range(blocks):
                precision = self.gram[group] / sigma + np.diag(1.0 / tau)
                lower = np.linalg.cholesky(precision)
                mean = np.linalg.solve(precision, self.moment[group] / sigma + mu / tau)
                weights[group] = mean + np.linalg.solve(lower.T, generator.standard_normal(width))
            shared_variance = 1.0 / (blocks / tau + 1.0 / prior_variance)
            mu = shared_variance * (weights.sum(axis=0) / tau) + np.sqrt(shared_variance) * generator.standard_normal(width)
            tau = _inverse_gamma(generator, SHAPE_PRIOR + blocks / 2.0,
                                 GROUP_SCALE_PRIOR + 0.5 * np.sum((weights - mu) ** 2, axis=0))
            residual = self.target - np.einsum("ij,ij->i", self.design, weights[self.groups])
            sigma = float(_inverse_gamma(generator, SHAPE_PRIOR + count / 2.0,
                                         NOISE_SCALE_PRIOR + 0.5 * float(residual @ residual)))
            if sweep >= warmup:
                slot = sweep - warmup
                record["weights"][slot], record["sigma"][slot], record["mu"][slot] = weights, math.sqrt(sigma), mu
        self.chains.append(record)
        self._collect()

    def _collect(self) -> None:
        stacked = {name: np.concatenate([chain[name] for chain in self.chains]) for name in ("weights", "sigma", "mu")}
        total = stacked["sigma"].shape[0]
        keep = np.unique(np.linspace(0, total - 1, min(STORED_DRAWS, total)).round().astype(np.int64))
        self.weights, self.sigma, self.mu = stacked["weights"][keep], stacked["sigma"][keep], stacked["mu"][keep]

    def finish(self, context) -> None:
        series = {"noise_variance": np.stack([chain["sigma"] ** 2 for chain in self.chains]),
                  "shared_weights": np.stack([chain["mu"] for chain in self.chains])}
        r_hat, effective = diagnostics.worst(series)
        level = "warning" if not math.isfinite(r_hat) or r_hat > R_HAT_LIMIT else "info"
        self.summary = {"blockRows": [int(rows) for rows in self.block_rows], "maximumSplitRHat": r_hat,
                        "minimumEffectiveSampleSize": effective, "posteriorMeanNoiseStandardDeviation": float(self.sigma.mean())}
        context.log(f"bayesian_hierarchical_model: {len(self.chains)} chains, training bars per block "
                    f"{', '.join(str(int(rows)) for rows in self.block_rows)}; largest split R-hat {r_hat:.3f}, "
                    f"smallest effective sample size {effective:.0f}", level)
        del self.design, self.target, self.groups

    def predictive(self, x: np.ndarray, groups) -> tuple[np.ndarray, np.ndarray]:
        design = np.column_stack([np.ones(x.shape[0]), x])
        groups = np.asarray(groups, dtype=np.int64)
        location = np.einsum("rj,srj->rs", design, self.weights[:, groups, :])     # (rows, draws)
        probability = special.ndtr(location / self.sigma[None, :]).mean(axis=1)
        return location.mean(axis=1), probability

    def arrays(self) -> dict:
        return {"weights": self.weights, "sigma": self.sigma, "mu": self.mu,
                "block_count": np.array([self.block_count], dtype=np.int64)}

    def document(self) -> dict:
        return {}

    def restore(self, arrays: dict, document: dict) -> None:
        self.weights, self.sigma, self.mu = arrays["weights"], arrays["sigma"], arrays["mu"]
        self.block_count = int(arrays["block_count"][0])


__all__ = ["HierarchicalGibbs", "session_blocks"]
