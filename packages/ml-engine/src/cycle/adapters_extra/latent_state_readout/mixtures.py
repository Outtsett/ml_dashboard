"""Mixture densities as state models: GMM, Dirichlet-process mixture, class-conditional mixture, scenarios.

Every mixture is fitted by scikit-learn (EM, or variational inference for the
Dirichlet process) on standardised training rows, then kept as plain arrays
(``common.GaussianComponents``): a bar's state is SOFT, the posterior
responsibility of each component, computed from the component's mean,
precision factor and log weight exactly as the fitted model's own
``predict_proba`` computes it.

- ``GaussianMixtureStates``: a finite mixture of ``component_count`` Gaussians
  (full or diagonal covariance).
- ``DirichletProcessStates``: a truncated stick-breaking Dirichlet-process
  mixture (``truncation_level`` components, ``concentration`` the DP's alpha):
  the data decide how many components carry weight; unused ones keep a
  near-zero weight and read the prior rate.
- ``MixtureBayesStates``: ``mixture_mode`` ``class_conditional`` fits one
  mixture on the up-labelled training rows and one on the down-labelled rows
  (on the training rows' leading principal components) and joins them with the
  training class priors, so the summed responsibility of the up components IS
  Bayes' rule P(up | x) = pi_up f_up(x) / (pi_up f_up(x) + pi_down f_down(x));
  ``regime_posterior`` fits one unsupervised mixture read out like the GMM.
- ``ScenarioStates``: scenario analysis. Scenarios are the components of a
  mixture on the leading principal components, their number chosen by BIC on
  the training rows between 2 and ``scenario_count``; each scenario records its
  driver table (the mean standardised value of every feature) and its outcome
  table (up-rate, mean and 10/50/90% quantiles of the scaled h-bar move), and
  today's bar is weighted across scenarios by how much it looks like each.
"""

from __future__ import annotations

import warnings

import numpy as np

from .common import GaussianComponents, Projection, single_thread
from .state_model import FitContext, StateModel


def _gaussian_mixture(points: np.ndarray, count: int, structure: str, regularization: float, seed: int,
                      iterations: int = 200):
    from sklearn.exceptions import ConvergenceWarning
    from sklearn.mixture import GaussianMixture

    count = max(1, min(int(count), points.shape[0]))
    with single_thread(), warnings.catch_warnings():
        warnings.simplefilter("ignore", ConvergenceWarning)
        return GaussianMixture(n_components=count, covariance_type=structure, reg_covar=float(regularization),
                               max_iter=int(iterations), n_init=1, random_state=int(seed)).fit(points)


def _components_arrays(prefix: str, components: GaussianComponents) -> dict[str, np.ndarray]:
    return {f"{prefix}_{k}": v for k, v in components.arrays().items()}


def _components_restore(prefix: str, arrays: dict[str, np.ndarray]) -> GaussianComponents:
    head = f"{prefix}_"
    return GaussianComponents.from_arrays({k[len(head):]: v for k, v in arrays.items() if k.startswith(head)})


def _projection_arrays(projection: Projection) -> dict[str, np.ndarray]:
    return {f"projection_{k}": v for k, v in projection.arrays().items()}


def _projection_restore(arrays: dict[str, np.ndarray]) -> Projection:
    return Projection.from_arrays({k[len("projection_"):]: v for k, v in arrays.items() if k.startswith("projection_")})


def _weight_summary(weights: np.ndarray) -> str:
    return "/".join(f"{weight:.2f}" for weight in np.sort(np.asarray(weights))[::-1][:12])


class GaussianMixtureStates(StateModel):
    variant = "gaussian_mixture"
    soft = True

    def fit(self, space: np.ndarray, context: FitContext) -> None:
        model = _gaussian_mixture(space, int(self.parameters["component_count"]),
                                  str(self.parameters["covariance_structure"]),
                                  float(self.parameters["covariance_regularization"]), self.seed)
        self.components = GaussianComponents.from_sklearn(model, space)
        self._weights = np.asarray(model.weights_)
        self._converged = bool(model.converged_)

    @property
    def state_count(self) -> int:
        return self.components.component_count

    def responsibilities(self, space: np.ndarray) -> np.ndarray:
        return self.components.responsibilities(space)

    def arrays(self) -> dict[str, np.ndarray]:
        return _components_arrays("mixture", self.components)

    def restore(self, arrays: dict[str, np.ndarray]) -> None:
        self.components = _components_restore("mixture", arrays)

    def describe(self) -> str:
        return (f"Gaussian mixture of {self.state_count} components ({self.components.structure} covariance, EM "
                f"{'converged' if self._converged else 'stopped at its iteration limit'}), weights {_weight_summary(self._weights)}")


class DirichletProcessStates(StateModel):
    variant = "dirichlet_process"
    soft = True

    def fit(self, space: np.ndarray, context: FitContext) -> None:
        from sklearn.exceptions import ConvergenceWarning
        from sklearn.mixture import BayesianGaussianMixture

        count = max(1, min(int(self.parameters["truncation_level"]), space.shape[0]))
        with single_thread(), warnings.catch_warnings():
            warnings.simplefilter("ignore", ConvergenceWarning)
            model = BayesianGaussianMixture(
                n_components=count, weight_concentration_prior_type="dirichlet_process",
                weight_concentration_prior=float(self.parameters["concentration"]),
                covariance_type=str(self.parameters["covariance_structure"]),
                reg_covar=float(self.parameters["covariance_regularization"]),
                max_iter=int(self.parameters["iteration_count"]), random_state=self.seed, init_params="kmeans",
            ).fit(space)
        self.components = GaussianComponents.from_sklearn(model, space)
        self._weights = np.asarray(model.weights_)
        self._converged = bool(model.converged_)

    @property
    def state_count(self) -> int:
        return self.components.component_count

    def responsibilities(self, space: np.ndarray) -> np.ndarray:
        return self.components.responsibilities(space)

    def arrays(self) -> dict[str, np.ndarray]:
        return _components_arrays("mixture", self.components)

    def restore(self, arrays: dict[str, np.ndarray]) -> None:
        self.components = _components_restore("mixture", arrays)

    def describe(self) -> str:
        used = int(np.sum(self._weights >= 0.01))
        return (f"Dirichlet-process mixture: {used} of {self.state_count} stick-breaking components carry at least 1% "
                f"of the weight (alpha {float(self.parameters['concentration']):g}, variational inference "
                f"{'converged' if self._converged else 'stopped at its iteration limit'}), weights {_weight_summary(self._weights)}")


class MixtureBayesStates(StateModel):
    variant = "mixture_bayes"
    soft = True

    def fit(self, space: np.ndarray, context: FitContext) -> None:
        self.projection = Projection.fit(space, int(self.parameters["principal_component_count"]))
        points = self.projection.transform(space)
        structure = str(self.parameters["covariance_structure"])
        regularization = float(self.parameters["covariance_regularization"])
        count = int(self.parameters["component_count"])
        self.mode = str(self.parameters["mixture_mode"])
        if self.mode == "regime_posterior":
            model = _gaussian_mixture(points, count, structure, regularization, self.seed)
            self.components = GaussianComponents.from_sklearn(model, points)
            self.up_component_count = -1
            self._summary = f"one unsupervised mixture of {self.state_count} regimes read out by their training up-rates"
            return
        if self.mode != "class_conditional":
            raise ValueError(f"unknown mixture_mode {self.mode!r}")
        targets = np.asarray(context.targets, dtype=np.float64)
        up = targets >= 0.5 if context.task == "classification" else targets > 0
        known = np.isfinite(targets)
        parts = []
        for chosen, name in ((known & up, "up"), (known & ~up, "down")):
            rows = points[chosen]
            if rows.shape[0] < 2:
                raise ValueError(f"the class-conditional mixture needs training rows of both classes; {name} has {rows.shape[0]}")
            model = _gaussian_mixture(rows, min(count, rows.shape[0] // 2), structure, regularization, self.seed)
            parts.append((GaussianComponents.from_sklearn(model, rows), float(chosen.sum())))
        total = parts[0][1] + parts[1][1]
        (up_part, up_rows), (down_part, down_rows) = parts
        self.components = GaussianComponents(
            np.concatenate([up_part.means, down_part.means]),
            np.concatenate([up_part.precision_cholesky, down_part.precision_cholesky]),
            np.concatenate([up_part.log_constant + np.log(up_rows / total), down_part.log_constant + np.log(down_rows / total)]),
            structure,
        )
        self.up_component_count = up_part.component_count
        self._summary = (f"class-conditional densities: {up_part.component_count} components on {int(up_rows)} up rows, "
                         f"{down_part.component_count} on {int(down_rows)} down rows, prior P(up) {up_rows / total:.3f}")

    @property
    def state_count(self) -> int:
        return self.components.component_count

    def responsibilities(self, space: np.ndarray) -> np.ndarray:
        return self.components.responsibilities(self.projection.transform(space))

    def fixed_rates(self) -> np.ndarray | None:
        if self.up_component_count < 0:
            return None
        rates = np.zeros(self.state_count)
        rates[: self.up_component_count] = 1.0
        return rates

    def arrays(self) -> dict[str, np.ndarray]:
        return {**_projection_arrays(self.projection), **_components_arrays("mixture", self.components),
                "up_component_count": np.asarray(self.up_component_count)}

    def restore(self, arrays: dict[str, np.ndarray]) -> None:
        self.projection = _projection_restore(arrays)
        self.components = _components_restore("mixture", arrays)
        self.up_component_count = int(arrays["up_component_count"])

    def describe(self) -> str:
        return f"{self._summary} ({self.projection.components.shape[0] or 'all'} principal components)"


class ScenarioStates(StateModel):
    variant = "scenario_mixture"
    soft = True

    def fit(self, space: np.ndarray, context: FitContext) -> None:
        self.projection = Projection.fit(space, int(self.parameters["principal_component_count"]))
        points = self.projection.transform(space)
        structure = str(self.parameters["covariance_structure"])
        regularization = float(self.parameters["covariance_regularization"])
        best = None
        criteria = []
        for count in range(2, max(2, int(self.parameters["scenario_count"])) + 1):
            if count > points.shape[0]:
                break
            model = _gaussian_mixture(points, count, structure, regularization, self.seed)
            criterion = float(model.bic(points))
            criteria.append((count, criterion))
            if best is None or criterion < best[1]:
                best = (model, criterion)
        model = best[0]
        self.components = GaussianComponents.from_sklearn(model, points)
        membership = np.argmax(self.components.responsibilities(points), axis=1)
        count = self.state_count
        self.drivers = np.zeros((count, space.shape[1]))
        self.outcomes = np.full((count, 5), np.nan)       # up-rate, mean move, 10%, 50%, 90% of the scaled move
        self.members = np.bincount(membership, minlength=count).astype(np.int64)
        moves = None if context.moves is None else np.asarray(context.moves, dtype=np.float64)
        targets = np.asarray(context.targets, dtype=np.float64)
        for k in range(count):
            chosen = membership == k
            if not chosen.any():
                continue
            self.drivers[k] = space[chosen].mean(axis=0)
            if context.task == "classification":
                known = chosen & np.isfinite(targets)
                self.outcomes[k, 0] = float(np.mean(targets[known] >= 0.5)) if known.any() else np.nan
            if moves is not None:
                finite = moves[chosen][np.isfinite(moves[chosen])]
                if finite.size:
                    self.outcomes[k, 1] = float(finite.mean())
                    self.outcomes[k, 2:] = np.quantile(finite, [0.1, 0.5, 0.9])
        self._criteria = criteria
        self._names = tuple(context.feature_names)

    @property
    def state_count(self) -> int:
        return self.components.component_count

    def responsibilities(self, space: np.ndarray) -> np.ndarray:
        return self.components.responsibilities(self.projection.transform(space))

    def arrays(self) -> dict[str, np.ndarray]:
        return {**_projection_arrays(self.projection), **_components_arrays("mixture", self.components),
                "drivers": self.drivers, "outcomes": self.outcomes, "members": self.members}

    def restore(self, arrays: dict[str, np.ndarray]) -> None:
        self.projection = _projection_restore(arrays)
        self.components = _components_restore("mixture", arrays)
        self.drivers = np.asarray(arrays["drivers"], dtype=np.float64)
        self.outcomes = np.asarray(arrays["outcomes"], dtype=np.float64)
        self.members = np.asarray(arrays["members"], dtype=np.int64)

    def scenario_lines(self) -> list[str]:
        """One ASCII line per scenario: rows, top drivers, outcome table."""
        lines = []
        for k in range(self.state_count):
            order = np.argsort(-np.abs(self.drivers[k]), kind="stable")[:2]
            drivers = ", ".join(
                f"{self._names[j] if j < len(self._names) else f'feature {j}'} {self.drivers[k, j]:+.2f} sd" for j in order)
            up, mean, low, middle, high = self.outcomes[k]
            lines.append(f"scenario {k + 1}: {int(self.members[k])} training rows; drivers {drivers}; up-rate "
                         f"{up:.3f}; scaled move mean {mean:+.3f}, 10/50/90% {low:+.2f}/{middle:+.2f}/{high:+.2f}")
        return lines

    def describe(self) -> str:
        chosen = ", ".join(f"{count}:{criterion:.0f}" for count, criterion in self._criteria)
        return f"scenario analysis: {self.state_count} scenarios chosen by BIC (scenarios:BIC {chosen})"


__all__ = ["DirichletProcessStates", "GaussianMixtureStates", "MixtureBayesStates", "ScenarioStates"]
