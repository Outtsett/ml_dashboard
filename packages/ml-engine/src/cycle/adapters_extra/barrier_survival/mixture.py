"""Mixture of exponentials with covariate-dependent weights, fitted by EM on
right-censored durations (own code: no library fits a censored covariate
mixture of exponentials).

For each barrier side c the time to the touch is

    S_c(t | x) = sum_k pi_ck(x) exp(-lambda_ck t),   pi_c(x) = softmax(W_c [1, x])

(K = ``component_count`` exponential clocks, fast and slow, whose mixing
weights move with the feature row: the spec's component-wise covariate
extension). A touch of the other side, or the end of the walk, right-censors
the duration. One EM iteration per epoch for both sides:

- E: w_ik = pi_k(x_i) lambda_k^d_i exp(-lambda_k t_i) / sum_j (same), d_i the event flag;
- M: lambda_k = sum_i w_ik d_i / sum_i w_ik t_i (closed form), and W by a few
  L-BFGS steps on the weighted softmax log-likelihood with an L2 penalty
  ``penalty_strength`` (warm-started from the previous W).

The first rates are spread geometrically around the overall event rate
(deterministic, so a refit is identical); W starts at 0. P(up) comes from the
race of the two sides' survival curves (``incidence.race``), which treats the
up and down clocks as independent given x.
"""

from __future__ import annotations

import numpy as np
from scipy.optimize import minimize
from scipy.special import logsumexp

from . import incidence
from .hazards import CAUSES

MINIMUM_RATE = 1e-8
GATING_STEPS = 25


def _design(features: np.ndarray) -> np.ndarray:
    values = np.asarray(features, dtype=np.float64)
    return np.concatenate([np.ones((values.shape[0], 1)), values], axis=1)


def _log_weights(design: np.ndarray, gating: np.ndarray) -> np.ndarray:
    scores = design @ gating.T                              # (n, K)
    return scores - logsumexp(scores, axis=1, keepdims=True)


class ExponentialMixture:
    name = "exponential_mixture"

    def __init__(self, component_count: int, penalty_strength: float, maximum_hold_bars: int) -> None:
        self.component_count = max(1, int(component_count))
        self.penalty_strength = float(penalty_strength)
        self.maximum_hold_bars = int(maximum_hold_bars)
        self.rates: dict[str, np.ndarray] = {}
        self.gating: dict[str, np.ndarray] = {}
        self.summary: dict = {}

    def initialise(self, features: np.ndarray, durations) -> None:
        width = int(features.shape[1]) + 1
        total_time = float(np.sum(durations.duration))
        for cause_index, name in enumerate(CAUSES, start=1):
            events = float(np.count_nonzero(durations.cause == cause_index))
            if events < 5:
                raise ValueError(f"mixture of exponentials: only {int(events)} {name}-barrier touches")
            overall = events / max(total_time, 1.0)
            if self.component_count == 1:
                spread = np.zeros(1)
            else:
                spread = np.linspace(-1.0, 1.0, self.component_count)
            self.rates[name] = overall * np.power(4.0, spread)
            self.gating[name] = np.zeros((self.component_count, width))

    def _responsibilities(self, design, duration, event, name):
        rates = self.rates[name]
        log_joint = (_log_weights(design, self.gating[name]) + event[:, None] * np.log(rates)[None, :]
                     - duration[:, None] * rates[None, :])
        normaliser = logsumexp(log_joint, axis=1, keepdims=True)
        return np.exp(log_joint - normaliser), float(np.sum(normaliser))

    def em_step(self, features: np.ndarray, durations) -> float:
        """One EM iteration for both sides; returns the mean negative log-likelihood per walk before the step."""
        design = _design(features)
        duration = durations.duration.astype(np.float64)
        negative_log_likelihood = 0.0
        for cause_index, name in enumerate(CAUSES, start=1):
            event = (durations.cause == cause_index).astype(np.float64)
            weights, log_likelihood = self._responsibilities(design, duration, event, name)
            negative_log_likelihood -= log_likelihood
            mass_events = weights.T @ event
            mass_time = weights.T @ duration
            self.rates[name] = np.maximum(mass_events / np.maximum(mass_time, 1e-12), MINIMUM_RATE)
            if self.component_count > 1:
                self.gating[name] = self._gating_step(design, weights, self.gating[name])
        return negative_log_likelihood / max(1, len(durations))

    def _gating_step(self, design: np.ndarray, weights: np.ndarray, start: np.ndarray) -> np.ndarray:
        count, width = self.component_count, design.shape[1]
        rows = design.shape[0]

        def objective(flat: np.ndarray) -> tuple[float, np.ndarray]:
            gating = flat.reshape(count, width)
            log_pi = _log_weights(design, gating)
            value = -float(np.sum(weights * log_pi)) / rows
            gradient = -((weights - np.exp(log_pi)).T @ design) / rows
            penalty = self.penalty_strength
            value += 0.5 * penalty * float(np.sum(gating[:, 1:] ** 2))
            gradient[:, 1:] += penalty * gating[:, 1:]
            return value, gradient.ravel()

        result = minimize(objective, start.ravel(), jac=True, method="L-BFGS-B", options={"maxiter": GATING_STEPS})
        return np.asarray(result.x, dtype=np.float64).reshape(count, width)

    def survival(self, features: np.ndarray, name: str) -> np.ndarray:
        weights = np.exp(_log_weights(_design(features), self.gating[name]))
        t = np.arange(self.maximum_hold_bars + 1, dtype=np.float64)
        return weights @ np.exp(-np.outer(self.rates[name], t))

    def incidence(self, features: np.ndarray, horizon: int) -> tuple[np.ndarray, np.ndarray]:
        return incidence.race(self.survival(features, "up"), self.survival(features, "down"), horizon)

    def snapshot(self) -> dict:
        return {"rates": {k: v.copy() for k, v in self.rates.items()},
                "gating": {k: v.copy() for k, v in self.gating.items()}}

    def restore(self, state: dict) -> None:
        self.rates = {k: v.copy() for k, v in state["rates"].items()}
        self.gating = {k: v.copy() for k, v in state["gating"].items()}

    def to_state(self) -> tuple[dict, dict]:
        arrays = {}
        for name in CAUSES:
            arrays[f"{name}_rates"] = self.rates[name]
            arrays[f"{name}_gating"] = self.gating[name]
        info = {"component_count": self.component_count, "penalty_strength": self.penalty_strength,
                "maximum_hold_bars": self.maximum_hold_bars, "summary": self.summary}
        return arrays, info

    @classmethod
    def from_state(cls, arrays: dict, info: dict) -> ExponentialMixture:
        model = cls(info["component_count"], info["penalty_strength"], info["maximum_hold_bars"])
        for name in CAUSES:
            model.rates[name] = np.asarray(arrays[f"{name}_rates"], dtype=np.float64)
            model.gating[name] = np.asarray(arrays[f"{name}_gating"], dtype=np.float64)
        model.summary = dict(info.get("summary") or {})
        return model
