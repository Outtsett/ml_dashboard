"""Bayesian optimisation (scikit-optimize): a Gaussian-process surrogate with
expected improvement, searching a low-dimensional form of the policy.

A GP does not scale to one weight per feature, so the policy is searched over
the first d = ``principal_component_count`` principal components of the
TRAINING rows' features (fitted on those rows only, each component scaled to
unit variance): theta = (v, b) in R^(d+1), and the policy in feature space is
w = V_d^T diag(1 / sd) v, bias b - mean . w. ``skopt.Optimizer`` (isotropic
Matern 5/2 kernel plus noise, a Sobol initial design of ``initial_random_evaluations`` points, then
expected improvement) proposes one point at a time; every evaluation is the
problem's full training loss. One epoch is ``evaluations_per_epoch``
evaluations; ``current`` is the best point actually evaluated so far (never
the surrogate's own optimum).
"""

from __future__ import annotations

import warnings

import numpy as np

from .base import Searcher


class BayesianSearcher(Searcher):
    name = "Bayesian optimisation"

    def __init__(self, problem, parameters, seed, bound) -> None:
        super().__init__(problem, parameters, seed, bound)
        import skopt

        inputs = problem.inputs
        self.mean = inputs.mean(axis=0) if inputs.shape[0] else np.zeros(problem.feature_count)
        centred = inputs - self.mean
        count = int(min(max(1, int(self.parameters["principal_component_count"])), problem.feature_count,
                        max(1, inputs.shape[0])))
        if inputs.shape[0] >= 2:
            _, singular, basis = np.linalg.svd(centred, full_matrices=False)
            basis = basis[:count]
            # a component's sign is arbitrary: fix it so its largest loading is positive (reproducible)
            signs = np.sign(basis[np.arange(count), np.argmax(np.abs(basis), axis=1)])
            basis = basis * np.where(signs == 0, 1.0, signs)[:, None]
            spread = singular[:count] / np.sqrt(max(inputs.shape[0] - 1, 1))
        else:
            basis = np.eye(problem.feature_count)[:count]
            spread = np.ones(count)
        spread = np.where(spread > 1e-12, spread, 1.0)
        self.projection = basis.T / spread[None, :]          # (F, d): w = projection @ v
        self.component_count = count
        self.reduced_dimension = count + 1
        from skopt.learning import GaussianProcessRegressor
        from skopt.learning.gaussian_process.kernels import ConstantKernel, Matern, WhiteKernel

        # one isotropic Matern 5/2 length scale plus a noise level, refitted by maximum likelihood at every
        # evaluation (an ARD kernel with restarts costs about ten times as much for no gain at this budget)
        kernel = (ConstantKernel(1.0, (0.01, 100.0)) * Matern(length_scale=0.5, length_scale_bounds=(0.02, 20.0), nu=2.5)
                  + WhiteKernel(0.01, (1e-6, 1.0)))
        surrogate = GaussianProcessRegressor(kernel=kernel, normalize_y=True, n_restarts_optimizer=0, noise=None)
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")            # Sobol's power-of-two balance note
            self.optimizer = self._optimizer(skopt, surrogate)

    def _optimizer(self, skopt, surrogate):
        return skopt.Optimizer(
            [(-self.bound, self.bound)] * self.reduced_dimension, base_estimator=surrogate, acq_func="EI",
            n_initial_points=max(1, int(self.parameters["initial_random_evaluations"])),
            initial_point_generator="sobol", random_state=self.seed % (2 ** 31), acq_optimizer="lbfgs",
            acq_optimizer_kwargs={"n_restarts_optimizer": 2, "n_points": 1000},
        )

    def expand(self, reduced) -> np.ndarray:
        """(population, d + 1) reduced points -> (population, F + 1) policy vectors."""
        reduced = np.atleast_2d(np.asarray(reduced, dtype=np.float64))
        weights = reduced[:, :-1] @ self.projection.T
        bias = reduced[:, -1] - weights @ self.mean
        return np.column_stack([weights, bias])

    def _step(self) -> None:
        for _ in range(max(1, int(self.parameters["evaluations_per_epoch"]))):
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")          # the surrogate's convergence notes, not the model's
                point = [float(value) for value in self.optimizer.ask()]
                loss = float(self.evaluate(self.expand(point))[0])
                self.optimizer.tell(point, loss if np.isfinite(loss) else 1e6)
        self.statistics = {"evaluations": int(self.evaluations), "principal_components": int(self.component_count)}


__all__ = ["BayesianSearcher"]
