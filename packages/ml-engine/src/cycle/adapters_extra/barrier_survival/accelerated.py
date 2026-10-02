"""Accelerated failure time: log T = x beta + sigma epsilon, one parametric
model for the time to the up barrier and one for the time to the down barrier.

Each is fitted by penalised maximum likelihood on the training span's walks
(``lifelines`` ``WeibullAFTFitter`` / ``LogNormalAFTFitter`` /
``LogLogisticAFTFitter``; the other barrier's touch and the end of the walk
right-censor it). ``survival_distribution`` fixes the family, or
``best_by_information_criterion`` fits all three and keeps the lowest AIC,
separately for each side. The two survival curves meet in the race of two
independent clocks (``incidence.race``).

Saved as plain coefficients; the survival functions are evaluated here:

    Weibull       S(t) = exp(-(t / lambda)^rho),      lambda = exp(x b + b0),  rho = exp(r0)
    log-normal    S(t) = 1 - Phi((ln t - mu) / sigma), mu = x b + b0,          sigma = exp(s0)
    log-logistic  S(t) = 1 / (1 + (t / alpha)^beta),  alpha = exp(x b + b0),   beta = exp(c0)

(``tests/test_cycle_bridge_barrier_survival.py`` checks them against lifelines'
own ``predict_survival_function``.)
"""

from __future__ import annotations

import warnings

import numpy as np
from scipy.special import ndtr

from . import incidence
from .hazards import CAUSES, _frame

FAMILIES = {"weibull": ("WeibullAFTFitter", "lambda_", "rho_"),
            "log_normal": ("LogNormalAFTFitter", "mu_", "sigma_"),
            "log_logistic": ("LogLogisticAFTFitter", "alpha_", "beta_")}
BEST = "best_by_information_criterion"


def survival_curve(family: str, location: np.ndarray, shape_parameter: float, hold: int) -> np.ndarray:
    """(rows, hold + 1) survival at t = 0 .. hold from the linear predictor ``location`` (x b + b0)."""
    t = np.arange(1, hold + 1, dtype=np.float64)[None, :]
    location = np.asarray(location, dtype=np.float64)[:, None]
    ancillary = float(np.exp(shape_parameter))
    if family == "weibull":
        survival = np.exp(-np.power(t / np.exp(location), ancillary))
    elif family == "log_normal":
        survival = 1.0 - ndtr((np.log(t) - location) / ancillary)
    elif family == "log_logistic":
        survival = 1.0 / (1.0 + np.power(t / np.exp(location), ancillary))
    else:
        raise ValueError(f"unknown survival distribution {family!r}")
    return np.concatenate([np.ones((location.shape[0], 1)), survival], axis=1)


class AcceleratedFailureTime:
    name = "aft"

    def __init__(self, survival_distribution: str, penalty_strength: float, maximum_hold_bars: int) -> None:
        if survival_distribution != BEST and survival_distribution not in FAMILIES:
            raise ValueError(f"survival_distribution must be {BEST!r} or one of {sorted(FAMILIES)}")
        self.survival_distribution = survival_distribution
        self.penalty_strength = float(penalty_strength)
        self.maximum_hold_bars = int(maximum_hold_bars)
        self.families: dict[str, str] = {}
        self.coefficients: dict[str, np.ndarray] = {}
        self.intercepts: dict[str, float] = {}
        self.shapes: dict[str, float] = {}
        self.summary: dict = {}

    def fit(self, features: np.ndarray, durations, log) -> dict:
        import lifelines

        count = int(features.shape[1])
        candidates = sorted(FAMILIES) if self.survival_distribution == BEST else [self.survival_distribution]
        self.summary = {}
        for cause_index, name in enumerate(CAUSES, start=1):
            events = int(np.count_nonzero(durations.cause == cause_index))
            if events < 5:
                raise ValueError(f"AFT: only {events} {name}-barrier touches in the training span")
            frame = _frame(features, durations, cause_index)
            columns = [f"feature_{index:03d}" for index in range(count)]
            criteria = {}
            best = None
            for family in candidates:
                class_name, primary, ancillary = FAMILIES[family]
                fitter = getattr(lifelines, class_name)(penalizer=self.penalty_strength)
                try:
                    with warnings.catch_warnings():
                        warnings.simplefilter("ignore")
                        fitter.fit(frame, duration_col="duration", event_col="event")
                except Exception as error:  # noqa: BLE001 - lifelines raises several convergence types
                    log(f"AFT: the {family} fit for the {name} barrier failed ({type(error).__name__}); skipped", "warn")
                    continue
                criteria[family] = float(fitter.AIC_)
                if best is None or criteria[family] < best[0]:
                    params = fitter.params_
                    best = (criteria[family], family,
                            np.array([float(params[(primary, column)]) for column in columns]),
                            float(params[(primary, "Intercept")]), float(params[(ancillary, "Intercept")]))
            if best is None:
                raise ValueError(f"AFT: no survival distribution could be fitted for the {name} barrier")
            _, family, coefficients, intercept, shape_parameter = best
            self.families[name] = family
            self.coefficients[name] = coefficients
            self.intercepts[name] = intercept
            self.shapes[name] = shape_parameter
            self.summary[name] = {"events": events, "distribution": family, "akaike_information_criterion": criteria}
        return self.summary

    def survival(self, features: np.ndarray, name: str) -> np.ndarray:
        location = np.asarray(features, dtype=np.float64) @ self.coefficients[name] + self.intercepts[name]
        return survival_curve(self.families[name], location, self.shapes[name], self.maximum_hold_bars)

    def incidence(self, features: np.ndarray, horizon: int) -> tuple[np.ndarray, np.ndarray]:
        return incidence.race(self.survival(features, "up"), self.survival(features, "down"), horizon)

    def to_state(self) -> tuple[dict, dict]:
        arrays = {f"{name}_coefficients": self.coefficients[name] for name in CAUSES}
        info = {"survival_distribution": self.survival_distribution, "penalty_strength": self.penalty_strength,
                "maximum_hold_bars": self.maximum_hold_bars, "families": self.families,
                "intercepts": self.intercepts, "shapes": self.shapes, "summary": self.summary}
        return arrays, info

    @classmethod
    def from_state(cls, arrays: dict, info: dict) -> AcceleratedFailureTime:
        model = cls(info["survival_distribution"], info["penalty_strength"], info["maximum_hold_bars"])
        for name in CAUSES:
            model.coefficients[name] = np.asarray(arrays[f"{name}_coefficients"], dtype=np.float64)
        model.families = dict(info["families"])
        model.intercepts = {name: float(value) for name, value in info["intercepts"].items()}
        model.shapes = {name: float(value) for name, value in info["shapes"].items()}
        model.summary = dict(info.get("summary") or {})
        return model
