"""Markov chain Monte Carlo: a Bayesian model of the h-bar move sampled by
adaptive random-walk Metropolis-Hastings.

Model (training span only): the scaled h-bar move y_r (the price target) of
each usable training bar follows a Student-t with ``student_degrees_of_freedom``
degrees of freedom, location b0 + b . c_r and scale sigma, where c_r are the
bar's first ``principal_component_count`` principal components (unit
variance). Priors: b ~ Normal(0, 2^2) per coefficient, log sigma ~ Normal(0, 1).

Sampler: ``chain_count`` chains, run together, start ``chain_starting_dispersion``
standard errors around the least-squares fit (over-dispersed, so R-hat can see
chains that have not met). The Gaussian random-walk proposal adapts during the
burn-in only (its covariance to the pooled draws, its scale toward
``target_acceptance_rate``) and is frozen afterwards, so the kept draws are an
ordinary Metropolis-Hastings chain. Every ``thinning_interval``-th draw after
the burn-in is kept. arviz computes R-hat and the effective sample size of
every parameter; a fit whose largest R-hat exceeds ``RHAT_LIMIT`` is refused
with a message, never used.

P(up) at bar t is the posterior-predictive mean of P(y > 0) = mean over draws
of T_nu((b0 + b . c_t) / sigma) (the raw score is its logit, then the
validation curve); the price forecast is the posterior mean of the location.
"""

from __future__ import annotations

import math

import numpy as np
from scipy import special, stats

from .common import Embedding, Simulated, Simulator, fit_generator, rows_of, usable_training_rows

RHAT_LIMIT = 1.05
EPOCH_BLOCKS = 10
PRIOR_COEFFICIENT_SCALE = 2.0
ADAPTATION_INTERVAL = 50


class ConvergenceError(RuntimeError):
    """The chains did not converge; the fit is refused."""


class MetropolisMoveModel(Simulator):
    variant = "metropolis"
    step_unit = "epoch"
    libraries = ("arviz",)

    def prepare(self, context) -> None:
        p = self.parameters
        view, features = context.view, context.features
        rows = usable_training_rows(view, features, context.train_index, int(p["maximum_training_bars"]))
        if rows.size < 30:
            raise ValueError(f"metropolis: only {rows.size} usable training bars; need at least 30")
        self.embedding = Embedding.fit(features, rows, int(p["principal_component_count"]))
        components = self.embedding.apply(features, rows)
        self.design = np.column_stack([np.ones(rows.size), components])
        self.target = np.asarray(view.price_targets, dtype=np.float64)[rows]
        self.rows = rows
        self.degrees = float(p["student_degrees_of_freedom"])
        self.constant = (special.gammaln((self.degrees + 1) / 2) - special.gammaln(self.degrees / 2)
                         - 0.5 * math.log(self.degrees * math.pi))
        self.chain_count = int(p["chain_count"])
        self.iterations = int(p["iteration_count"])
        self.burn_in = int(round(self.iterations * float(p["burn_in_fraction"])))
        self.thinning = max(1, int(p["thinning_interval"]))
        self.target_acceptance = float(p["target_acceptance_rate"])
        dimension = self.design.shape[1] + 1
        self.dimension = dimension
        # least squares: the starting centre and the scale of the first proposal
        coefficients, *_ = np.linalg.lstsq(self.design, self.target, rcond=None)
        residual = self.target - self.design @ coefficients
        sigma = max(float(np.std(residual)), 1e-6)
        information = self.design.T @ self.design
        errors = np.sqrt(np.diag(np.linalg.pinv(information)) * sigma ** 2)
        errors = np.append(errors, 1.0 / math.sqrt(2.0 * rows.size))
        centre = np.append(coefficients, math.log(sigma))
        self.generator = fit_generator(self.seed, 1)
        dispersion = float(p["chain_starting_dispersion"])
        self.current = centre + dispersion * errors * self.generator.standard_normal((self.chain_count, dimension))
        self.current_log_posterior = self._log_posterior(self.current)
        self.proposal_covariance = np.diag(errors ** 2) * (2.38 ** 2 / dimension)
        self.proposal_scale = 1.0
        self.iteration = 0
        self.accepted_window = 0
        self.accepted_total_after_burn_in = 0
        self.history: list[np.ndarray] = []
        self.kept: list[np.ndarray] = []

    def _log_posterior(self, theta: np.ndarray) -> np.ndarray:
        """(chains,) log posterior of each chain's (b0, b..., log sigma)."""
        coefficients, log_sigma = theta[:, :-1], theta[:, -1]
        sigma = np.exp(log_sigma)
        location = self.design @ coefficients.T                      # (n, chains)
        standardized = (self.target[:, None] - location) / sigma[None, :]
        likelihood = (self.constant - log_sigma[None, :]
                      - 0.5 * (self.degrees + 1.0) * np.log1p(standardized ** 2 / self.degrees)).sum(axis=0)
        prior = -0.5 * np.sum(coefficients ** 2, axis=1) / PRIOR_COEFFICIENT_SCALE ** 2 - 0.5 * log_sigma ** 2
        return likelihood + prior

    def epoch_count(self) -> int:
        return EPOCH_BLOCKS

    def train_epoch(self, epoch, report_batch, context) -> float | None:
        end = int(round(self.iterations * epoch / EPOCH_BLOCKS))
        while self.iteration < end:
            self._step()
        report_batch(1, 1, int(self.rows[0]), int(self.rows[-1]), None)
        # the reported loss: the chains' mean negative log posterior per training bar
        return float(-np.mean(self.current_log_posterior) / self.rows.size)

    def _step(self) -> None:
        chains, dimension = self.current.shape
        covariance = self.proposal_covariance * self.proposal_scale ** 2
        factor = np.linalg.cholesky(covariance + 1e-14 * np.eye(dimension))
        proposal = self.current + self.generator.standard_normal((chains, dimension)) @ factor.T
        proposed = self._log_posterior(proposal)
        accept = np.log(self.generator.random(chains)) < proposed - self.current_log_posterior
        self.current = np.where(accept[:, None], proposal, self.current)
        self.current_log_posterior = np.where(accept, proposed, self.current_log_posterior)
        self.iteration += 1
        if self.iteration <= self.burn_in:
            self.accepted_window += int(accept.sum())
            self.history.append(self.current.copy())
            if self.iteration % ADAPTATION_INTERVAL == 0:
                rate = self.accepted_window / (ADAPTATION_INTERVAL * chains)
                self.proposal_scale *= math.exp((rate - self.target_acceptance) * 2.0)
                self.accepted_window = 0
                if self.iteration >= 4 * ADAPTATION_INTERVAL:
                    pooled = np.concatenate(self.history[len(self.history) // 2:], axis=0)
                    empirical = np.cov(pooled, rowvar=False)
                    if np.all(np.isfinite(empirical)):
                        self.proposal_covariance = empirical * (2.38 ** 2 / dimension) + 1e-12 * np.eye(dimension)
                        self.proposal_scale = 1.0
        else:
            self.accepted_total_after_burn_in += int(accept.sum())
            if (self.iteration - self.burn_in) % self.thinning == 0:
                self.kept.append(self.current.copy())

    def finish(self, context) -> None:
        import arviz

        self.history = []
        if len(self.kept) < 4:
            raise ConvergenceError(f"metropolis: only {len(self.kept)} draws kept after the burn-in; raise iteration_count "
                                   "or lower thinning_interval")
        draws = np.stack(self.kept, axis=1)                             # (chains, draws, dimension)
        self.rhat = np.asarray(arviz.rhat(draws), dtype=np.float64).reshape(-1)
        self.effective_sample_size = np.asarray(arviz.ess(draws), dtype=np.float64).reshape(-1)
        post = max(1, self.iterations - self.burn_in)
        self.acceptance_rate = self.accepted_total_after_burn_in / (post * self.chain_count)
        worst = float(np.nanmax(self.rhat)) if np.isfinite(self.rhat).any() else float("inf")
        context.reporter.log(f"metropolis: {draws.shape[0]} chains x {draws.shape[1]} kept draws, acceptance "
                             f"{self.acceptance_rate:.2f}, largest R-hat {worst:.3f}, smallest effective sample size "
                             f"{float(np.nanmin(self.effective_sample_size)):.0f}")
        if not worst <= RHAT_LIMIT:
            name = self.parameter_names()[int(np.nanargmax(self.rhat))] if np.isfinite(self.rhat).any() else "every parameter"
            raise ConvergenceError(f"metropolis: the chains did not converge (R-hat {worst:.3f} on {name}, limit "
                                   f"{RHAT_LIMIT}); the fit is refused - raise iteration_count or burn_in_fraction")
        self.draws = draws.reshape(-1, self.dimension)

    def parameter_names(self) -> list[str]:
        return ["intercept", *[f"component_{i + 1}" for i in range(self.dimension - 2)], "log_scale"]

    def simulate(self, features, view, rows) -> Simulated:
        rows = rows_of(rows)
        count = rows.size
        probability = np.full(count, np.nan)
        mean_move = np.full(count, np.nan)
        finite = np.all(np.isfinite(features[rows]), axis=1) if count else np.zeros(0, dtype=bool)
        if finite.any():
            design = np.column_stack([np.ones(int(finite.sum())), self.embedding.apply(features, rows[finite])])
            location = design @ self.draws[:, :-1].T                   # (rows, draws)
            sigma = np.exp(self.draws[:, -1])
            probability[finite] = stats.t.cdf(location / sigma[None, :], self.degrees).mean(axis=1)
            mean_move[finite] = location.mean(axis=1)
        clipped = np.clip(probability, 1e-9, 1.0 - 1e-9)
        score = np.log(clipped) - np.log1p(-clipped)
        return Simulated(score, mean_move, probability)

    def state(self) -> tuple[dict, dict]:
        arrays = {"draws": self.draws, "rhat": self.rhat, "effective_sample_size": self.effective_sample_size,
                  **self.embedding.arrays("embedding")}
        return arrays, {"degrees": self.degrees}

    def restore(self, arrays, document) -> None:
        self.draws = arrays["draws"]
        self.rhat = arrays["rhat"]
        self.effective_sample_size = arrays["effective_sample_size"]
        self.embedding = Embedding.from_arrays(arrays, "embedding")
        self.degrees = float(document["degrees"])
        self.dimension = int(self.draws.shape[1])

    def summary(self) -> dict:
        return {"largest_rhat": float(np.nanmax(self.rhat)),
                "smallest_effective_sample_size": float(np.nanmin(self.effective_sample_size)),
                "kept_draws": int(self.draws.shape[0]), "acceptance_rate": float(self.acceptance_rate)}
