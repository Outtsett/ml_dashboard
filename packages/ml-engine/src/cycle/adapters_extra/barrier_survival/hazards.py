"""Cause-specific Cox proportional hazards (Cox 1972), the standard
competing-risks reading of a Cox model.

Two partial-likelihood fits on the training span's barrier walks
(``lifelines.CoxPHFitter``, L2 penalty ``penalty_strength``, Efron ties):
one where an up-touch is the event and a down-touch or the end of the walk
censors it, and the mirror for the down-touch. Each gives
lambda_c(t | x) = lambda_0c(t) exp((x - xbar) beta_c) with the Breslow
baseline Lambda_0c. The two cumulative hazards on the bar grid give CIF_up and
CIF_down (``incidence.from_cumulative_hazards``).

Saved as plain arrays: the coefficients, the centring means and each baseline
evaluated at t = 0 .. H (a step function of the event times); prediction is
numpy only and equals ``CoxPHFitter.predict_cumulative_hazard`` on the grid.
"""

from __future__ import annotations

import warnings

import numpy as np

from . import incidence

CAUSES = ("up", "down")


def _frame(features: np.ndarray, durations, cause: int):
    import pandas as pd

    frame = pd.DataFrame(np.asarray(features, dtype=np.float64),
                         columns=[f"feature_{index:03d}" for index in range(features.shape[1])])
    frame["duration"] = durations.duration.astype(np.float64)
    frame["event"] = (durations.cause == cause).astype(np.int64)
    return frame


def baseline_on_grid(baseline, hold: int) -> np.ndarray:
    """A lifelines baseline cumulative hazard (indexed by time) evaluated at t = 0 .. hold (right-continuous steps)."""
    times = np.asarray(baseline.index, dtype=np.float64)
    values = np.asarray(baseline.iloc[:, 0], dtype=np.float64)
    grid = np.arange(hold + 1, dtype=np.float64)
    position = np.searchsorted(times, grid, side="right") - 1
    return np.where(position >= 0, values[np.maximum(position, 0)], 0.0)


class CauseSpecificCox:
    name = "cox"

    def __init__(self, penalty_strength: float, maximum_hold_bars: int) -> None:
        self.penalty_strength = float(penalty_strength)
        self.maximum_hold_bars = int(maximum_hold_bars)
        self.coefficients: dict[str, np.ndarray] = {}
        self.means: dict[str, np.ndarray] = {}
        self.baselines: dict[str, np.ndarray] = {}
        self.summary: dict = {}

    def fit(self, features: np.ndarray, durations, log) -> dict:
        from lifelines import CoxPHFitter

        self.summary = {}
        for cause_index, name in enumerate(CAUSES, start=1):
            events = int(np.count_nonzero(durations.cause == cause_index))
            if events < 5:
                raise ValueError(f"Cox: only {events} {name}-barrier touches in the training span")
            fitter = CoxPHFitter(penalizer=self.penalty_strength, baseline_estimation_method="breslow")
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                fitter.fit(_frame(features, durations, cause_index), duration_col="duration", event_col="event")
            self.coefficients[name] = np.asarray(fitter.params_.to_numpy(), dtype=np.float64)
            self.means[name] = np.asarray(fitter._norm_mean.to_numpy(), dtype=np.float64)
            self.baselines[name] = baseline_on_grid(fitter.baseline_cumulative_hazard_, self.maximum_hold_bars)
            self.summary[name] = {"events": events, "concordance": float(fitter.concordance_index_),
                                  "log_likelihood": float(fitter.log_likelihood_)}
        return self.summary

    def cumulative_hazard(self, features: np.ndarray, name: str) -> np.ndarray:
        values = np.asarray(features, dtype=np.float64)
        risk = np.exp((values - self.means[name]) @ self.coefficients[name])
        return risk[:, None] * self.baselines[name][None, :]

    def incidence(self, features: np.ndarray, horizon: int) -> tuple[np.ndarray, np.ndarray]:
        return incidence.from_cumulative_hazards(self.cumulative_hazard(features, "up"),
                                                 self.cumulative_hazard(features, "down"), horizon)

    def to_state(self) -> tuple[dict, dict]:
        arrays = {}
        for name in CAUSES:
            arrays[f"{name}_coefficients"] = self.coefficients[name]
            arrays[f"{name}_means"] = self.means[name]
            arrays[f"{name}_baseline"] = self.baselines[name]
        info = {"penalty_strength": self.penalty_strength, "maximum_hold_bars": self.maximum_hold_bars,
                "summary": self.summary}
        return arrays, info

    @classmethod
    def from_state(cls, arrays: dict, info: dict) -> CauseSpecificCox:
        model = cls(info["penalty_strength"], info["maximum_hold_bars"])
        for name in CAUSES:
            model.coefficients[name] = np.asarray(arrays[f"{name}_coefficients"], dtype=np.float64)
            model.means[name] = np.asarray(arrays[f"{name}_means"], dtype=np.float64)
            model.baselines[name] = np.asarray(arrays[f"{name}_baseline"], dtype=np.float64)
        model.summary = dict(info.get("summary") or {})
        return model
