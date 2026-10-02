"""``LatentStateReadoutAdapter``: an unsupervised state model plus a readout of what each state was followed by.

Fit (one pass, reported as a single fit):

1. standardise the features with the training rows' mean and deviation;
2. fit the state model named by the registry entry's ``direction.fixed.variant``
   on the training rows (``STATE_MODELS``) — without labels, except the
   class-conditional mixture, which fits one density per class by design;
3. read out each state: its Beta-smoothed training up-rate (direction) or its
   shrunk mean scaled move (price), from the training rows' responsibilities
   and targets only (``readout.StateReadout``);
4. for an entry whose ``direction.probability`` is
   ``logistic_curve_on_validation``, fit P(up) = sigmoid(a * logit(raw) + b) on
   the validation rows (``bridges.calibration.ValidationCurve``);
5. score the validation rows and log the state counts.

Predict at bar t: the responsibilities of row t (for the hidden Markov model,
the forward filter over rows <= t), times the state values.

Causality: the state model and the readout read training rows only (targets
through ``train_index``; the scenario outcome table reads the view's price
target on training rows); validation rows are read only by the calibration
curve and the reported score; a prediction reads rows <= t.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np

from cycle.bridges import persistence
from cycle.bridges.base import BridgeAdapter
from cycle.bridges.calibration import ValidationCurve
from cycle.bridges.training import score, single_fit

from .anomaly import (
    IsolationForestStates,
    LocalOutlierStates,
    OneClassSupportStates,
    RobustCovarianceStates,
)
from .clustering import (
    AffinityPropagationStates,
    DensityStates,
    HierarchicalStates,
    KMeansStates,
    MeanShiftStates,
    SpectralStates,
)
from .common import Standardiser, rows_of
from .hidden_markov import HiddenMarkovStates
from .mixtures import (
    DirichletProcessStates,
    GaussianMixtureStates,
    MixtureBayesStates,
    ScenarioStates,
)
from .readout import StateReadout
from .self_organizing_map import SelfOrganizingMapStates
from .state_model import FitContext, StateModel

STATE_MODELS: dict[str, type[StateModel]] = {
    "kmeans": KMeansStates,
    "gaussian_mixture": GaussianMixtureStates,
    "hierarchical": HierarchicalStates,
    "dbscan": DensityStates,
    "mean_shift": MeanShiftStates,
    "affinity_propagation": AffinityPropagationStates,
    "spectral": SpectralStates,
    "som": SelfOrganizingMapStates,
    "isolation_forest": IsolationForestStates,
    "local_outlier_factor": LocalOutlierStates,
    "one_class_svm": OneClassSupportStates,
    "robust_covariance": RobustCovarianceStates,
    "mixture_bayes": MixtureBayesStates,
    "dirichlet_process": DirichletProcessStates,
    "hmm_forward": HiddenMarkovStates,
    "scenario_mixture": ScenarioStates,
}

PROBABILITY_FLOOR = 1e-6


def _logit(probability: np.ndarray) -> np.ndarray:
    clipped = np.clip(np.asarray(probability, dtype=np.float64), PROBABILITY_FLOOR, 1.0 - PROBABILITY_FLOOR)
    out = np.log(clipped / (1.0 - clipped))
    out[~np.isfinite(np.asarray(probability, dtype=np.float64))] = np.nan
    return out


class LatentStateReadoutAdapter(BridgeAdapter):
    step_unit = "single_fit"
    model_file = "model.npz"

    def __init__(self, key: str, entry: dict, parameters: dict, device: str, seed: int,
                 task: str = "classification") -> None:
        super().__init__(key, entry, parameters, device, seed, task)
        if self.variant not in STATE_MODELS:
            raise ValueError(f"{key}: unknown latent state variant {self.variant!r}; valid: {', '.join(STATE_MODELS)}")
        self.calibrated = ((entry or {}).get("direction") or {}).get("probability") == "logistic_curve_on_validation"
        self.states: StateModel | None = None
        self.standardiser: Standardiser | None = None
        self.readout: StateReadout | None = None
        self.curve: ValidationCurve | None = None

    # ── the pieces ──
    def _space(self, features: np.ndarray, rows) -> np.ndarray:
        return self.standardiser.transform(features, rows)

    def _responsibilities(self, features: np.ndarray, rows) -> np.ndarray:
        rows = rows_of(rows)
        if getattr(self.states, "sequential", False):
            return self.states.filtered(features, rows, self._space)
        return self.states.responsibilities(self._space(features, rows))

    def _raw(self, features: np.ndarray, rows) -> np.ndarray:
        """The readout's value per row before any calibration curve."""
        return self.readout.apply(self._responsibilities(features, rows))

    def _fit_rows(self, features: np.ndarray, train_index: np.ndarray) -> np.ndarray:
        """The training rows the state model is fitted on (finite feature rows)."""
        rows = train_index[np.any(np.isfinite(np.asarray(features[train_index], dtype=np.float64)), axis=1)]
        if rows.size == 0:
            raise ValueError(f"{self.key}: no training row has a finite feature")
        return rows

    def _sequence_space(self, features: np.ndarray, train_index: np.ndarray) -> np.ndarray:
        """The standardised training span in time order (the hidden Markov fit); all-missing rows NaN."""
        span = self.market.fit_rows(train_index) if self.market is not None else train_index
        space = self._space(features, span)
        missing = ~np.any(np.isfinite(np.asarray(features[span], dtype=np.float64)), axis=1)
        space[missing] = np.nan
        return space

    # ── BridgeAdapter ──
    def _fit(self, features, labels, train_index, validation_index, timestamps, reporter) -> None:
        targets = np.asarray(labels, dtype=np.float64)
        rows = self._fit_rows(features, train_index)
        self.standardiser = Standardiser.fit(features, rows)
        moves = None
        if self.market is not None:
            moves = np.asarray(self.market.price_targets, dtype=np.float64)[rows] if self.task == "classification" \
                else targets[rows]
        names = tuple(self.market.feature_names) if self.market is not None else ()
        context = FitContext(task=self.task, targets=targets[rows], moves=moves, feature_names=names,
                             log=lambda message: reporter.log(f"{self.key}: {message}"))
        self.states = STATE_MODELS[self.variant](self.parameters, self.seed)
        strength = float(self.parameters.get("readout_prior_strength", 10.0))

        def fit_once():
            if getattr(self.states, "sequential", False):
                self.states.fit(self._sequence_space(features, train_index), context)
            else:
                self.states.fit(self._space(features, rows), context)
            responsibilities = self._responsibilities(features, rows)
            fixed = self.states.fixed_rates() if self.task == "classification" else None
            if fixed is not None:
                labelled = targets[rows][np.isfinite(targets[rows])]          # an unlabelled row is not a down row
                self.readout = StateReadout(np.asarray(fixed, dtype=np.float64), responsibilities.sum(axis=0),
                                            float(np.mean(labelled >= 0.5)) if labelled.size else 0.5)
            else:
                self.readout = StateReadout.fit(responsibilities, targets[rows], self.task, strength,
                                                self.states.smoothing())
            fitted = self.readout.apply(responsibilities)
            known = np.isfinite(fitted) & np.isfinite(targets[rows])
            if self.task == "classification":
                clipped = np.clip(fitted[known], PROBABILITY_FLOOR, 1 - PROBABILITY_FLOOR)
                up = targets[rows][known] >= 0.5
                return float(-np.mean(np.where(up, np.log(clipped), np.log(1 - clipped)))) if known.any() else None
            return float(np.mean(np.abs(fitted[known] - targets[rows][known]))) if known.any() else None

        def validate():
            if self.task == "classification" and self.calibrated:
                self.curve = None
                if validation_index.size:
                    raw = self._raw(features, validation_index)
                    self.curve = ValidationCurve.fit(_logit(raw), targets[validation_index])
                    reporter.log(f"{self.key}: validation curve P(up) = sigmoid({self.curve.slope:.3f} * logit(raw) "
                                 f"+ {self.curve.intercept:.3f}) on {self.curve.row_count} rows")
            if validation_index.size == 0:
                return score(self.task, np.empty(0), np.empty(0))
            prediction = self._predict_probability(features, validation_index) if self.task == "classification" \
                else self._predict_value(features, validation_index)
            return score(self.task, prediction, targets[validation_index])

        self.fit_summary = single_fit(reporter, train_index=train_index, fit=fit_once, validate=validate, name=self.key)
        reporter.log(f"{self.key}: {self.states.describe()}")
        if hasattr(self.states, "scenario_lines"):
            for line in self.states.scenario_lines():
                reporter.log(f"{self.key}: {line}")
        values = ", ".join(f"{value:.3f}" for value in self.readout.values[:16])
        more = ", ..." if self.readout.state_count > 16 else ""
        what = "up-rate" if self.task == "classification" else "mean scaled move"
        reporter.log(f"{self.key}: readout {what} per state {values}{more} (prior {self.readout.prior:.3f})")

    def _predict_probability(self, features, index) -> np.ndarray:
        raw = self._raw(features, index)
        if self.calibrated and self.curve is not None:
            return self.curve.apply(_logit(raw))
        return raw

    def _predict_value(self, features, index) -> np.ndarray:
        return self._raw(features, index)

    # ── save / load ──
    def _save_state(self, folder: Path) -> str:
        arrays = {f"standardiser__{k}": v for k, v in self.standardiser.arrays().items()}
        arrays.update({f"states__{k}": np.asarray(v) for k, v in self.states.arrays().items()})
        arrays.update({f"readout__{k}": v for k, v in self.readout.arrays().items()})
        if self.curve is not None:
            arrays["curve__slope"] = np.asarray(self.curve.slope)
            arrays["curve__intercept"] = np.asarray(self.curve.intercept)
            arrays["curve__row_count"] = np.asarray(self.curve.row_count)
        persistence.save_arrays(folder / self.model_file, **arrays)
        return self.model_file

    def _load_state(self, folder: Path, metadata: dict) -> None:
        arrays = persistence.load_arrays(folder / (metadata.get("model_file") or self.model_file))

        def part(prefix: str) -> dict[str, np.ndarray]:
            head = f"{prefix}__"
            return {name[len(head):]: value for name, value in arrays.items() if name.startswith(head)}

        if self.variant not in STATE_MODELS:
            raise ValueError(f"{self.key}: saved with unknown latent state variant {self.variant!r}")
        self.calibrated = ((self.entry or {}).get("direction") or {}).get("probability") == "logistic_curve_on_validation"
        self.standardiser = Standardiser.from_arrays(part("standardiser"))
        self.states = STATE_MODELS[self.variant](self.parameters, self.seed)
        self.states.restore(part("states"))
        self.readout = StateReadout.from_arrays(part("readout"))
        curve = part("curve")
        self.curve = ValidationCurve(float(curve["slope"]), float(curve["intercept"]), int(curve["row_count"])) \
            if curve else None

    def _library_versions(self) -> dict[str, str]:
        return persistence.library_versions("numpy", "scikit-learn", "scipy", "minisom", "hmmlearn")


__all__ = ["LatentStateReadoutAdapter", "STATE_MODELS"]
