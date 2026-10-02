"""Cumulative incidence: the probability that the up (or down) barrier is
touched first within the first h bars — the quantity every model of the family
turns into P(up) = CIF_up(h) / (CIF_up(h) + CIF_down(h)).

Durations are whole bars, so everything is on the grid t = 1 .. H.

- ``aalen_johansen``: the nonparametric competing-risks estimator from counts
  (at risk n(t), events d_c(t)): S(t) = prod_{u<=t} (1 - d(u)/n(u)),
  CIF_c(t) = sum_{u<=t} S(u-1) d_c(u) / n(u).
- ``from_cumulative_hazards``: cause-specific cumulative hazards
  Lambda_c(t) (Cox): the discrete-time incidence
  sum_{u<=t} S(u-1) (1 - exp(-dLambda(u))) dLambda_c(u) / dLambda(u),
  S(u) = exp(-Lambda_up(u) - Lambda_down(u)).
- ``race``: two survival curves of latent, independent up and down clocks
  (AFT, exponential mixture): P(up first by h) = sum_{t<=h}
  (S_up(t-1) - S_up(t)) (S_down(t-1) + S_down(t)) / 2 (the other clock taken
  at the middle of the bar).
"""

from __future__ import annotations

import numpy as np


def aalen_johansen(duration: np.ndarray, cause: np.ndarray, horizon: int) -> tuple[np.ndarray, np.ndarray]:
    """(CIF_up, CIF_down) at t = 0 .. horizon (index t) from one group's durations and causes."""
    duration = np.asarray(duration, dtype=np.int64)
    cause = np.asarray(cause, dtype=np.int64)
    cif_up = np.zeros(horizon + 1)
    cif_down = np.zeros(horizon + 1)
    survival = 1.0
    for t in range(1, horizon + 1):
        at_risk = int(np.count_nonzero(duration >= t))
        if at_risk == 0:
            cif_up[t:] = cif_up[t - 1]
            cif_down[t:] = cif_down[t - 1]
            break
        up = int(np.count_nonzero((duration == t) & (cause == 1)))
        down = int(np.count_nonzero((duration == t) & (cause == 2)))
        cif_up[t] = cif_up[t - 1] + survival * up / at_risk
        cif_down[t] = cif_down[t - 1] + survival * down / at_risk
        survival *= 1.0 - (up + down) / at_risk
    return cif_up, cif_down


def from_cumulative_hazards(hazard_up: np.ndarray, hazard_down: np.ndarray, horizon: int) -> tuple[np.ndarray, np.ndarray]:
    """(CIF_up(horizon), CIF_down(horizon)) per row from (rows, H + 1) cumulative hazards on t = 0 .. H."""
    hazard_up = np.atleast_2d(np.asarray(hazard_up, dtype=np.float64))
    hazard_down = np.atleast_2d(np.asarray(hazard_down, dtype=np.float64))
    step_up = np.diff(hazard_up[:, : horizon + 1], axis=1)
    step_down = np.diff(hazard_down[:, : horizon + 1], axis=1)
    total = step_up + step_down
    survival_before = np.exp(-(hazard_up[:, :horizon] + hazard_down[:, :horizon]))
    with np.errstate(invalid="ignore", divide="ignore"):
        share_up = np.where(total > 0, step_up / total, 0.0)
    event = survival_before * -np.expm1(-total)
    return np.sum(event * share_up, axis=1), np.sum(event * (1.0 - share_up) * (total > 0), axis=1)


def race(survival_up: np.ndarray, survival_down: np.ndarray, horizon: int) -> tuple[np.ndarray, np.ndarray]:
    """(P(up first by horizon), P(down first by horizon)) per row from (rows, >= horizon + 1) survival curves on t = 0 ..."""
    survival_up = np.atleast_2d(np.asarray(survival_up, dtype=np.float64))[:, : horizon + 1]
    survival_down = np.atleast_2d(np.asarray(survival_down, dtype=np.float64))[:, : horizon + 1]
    falls_up = survival_up[:, :-1] - survival_up[:, 1:]
    falls_down = survival_down[:, :-1] - survival_down[:, 1:]
    middle_up = 0.5 * (survival_up[:, :-1] + survival_up[:, 1:])
    middle_down = 0.5 * (survival_down[:, :-1] + survival_down[:, 1:])
    return np.sum(falls_up * middle_down, axis=1), np.sum(falls_down * middle_up, axis=1)


def up_share(cif_up: np.ndarray, cif_down: np.ndarray) -> np.ndarray:
    """CIF_up / (CIF_up + CIF_down); 0.5 when neither barrier is expected within h; NaN stays NaN."""
    cif_up = np.asarray(cif_up, dtype=np.float64)
    cif_down = np.asarray(cif_down, dtype=np.float64)
    total = cif_up + cif_down
    out = np.full(total.shape, 0.5)
    positive = np.isfinite(total) & (total > 1e-12)
    out[positive] = cif_up[positive] / total[positive]
    out[~np.isfinite(total)] = np.nan
    return out
