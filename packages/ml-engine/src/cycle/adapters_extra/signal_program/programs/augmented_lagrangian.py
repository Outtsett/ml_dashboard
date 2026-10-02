"""Augmented Lagrangian method: signal allocation under a volatility-target equality.

    maximise    mu' w
    subject to  g(w) = w' Sigma w - target_variance = 0      (the book runs at exactly the target risk)
                |w_j| <= per_signal_cap

The equality is non-convex (a sphere-like surface), so it is handled by the
method of multipliers: each outer iteration k minimises

    L_rho(w, lambda) = -mu' w + lambda * g(w) + (rho / 2) * g(w)^2

over the box with L-BFGS-B (analytic gradient, warm-started from the previous
w), then updates the multiplier lambda <- lambda + rho * g(w) and multiplies the
penalty rho by the growth factor when |g| did not fall below a quarter of its
previous value. Every outer iteration is one solver pass; the multiplier, the
penalty (bounded, see MAXIMUM_PENALTY_WEIGHT) and the violation |g| are logged. Without binding caps the exact
answer is w = sqrt(target / mu' Sigma^-1 mu) * Sigma^-1 mu, which the unit test
checks.
"""

from __future__ import annotations

import numpy as np
from scipy.optimize import minimize

from . import PassUpdate, ProgramResult, number, selected_names

# The penalty stops growing here: on a target no point of the box reaches (caps too small for the
# variance asked), an unbounded penalty would only overflow; the fit ends as infeasible_target.
MAXIMUM_PENALTY_WEIGHT = 1e10


def planned_passes(parameters: dict) -> int:
    return int(parameters["iteration_count"])


def solve(statistics, parameters: dict, log, task: str = "classification"):
    columns = statistics.usable_columns()
    outer = max(1, int(parameters["iteration_count"]))
    if columns.size == 0 or not np.any(statistics.mu[columns] != 0.0):
        log("augmented Lagrangian: no usable signal with a non-zero information coefficient; every weight is 0")
        return ProgramResult(np.zeros(statistics.signal_count), "no_signal", 0.0)
    mu = statistics.mu[columns]
    sigma = statistics.covariance[np.ix_(columns, columns)]
    sigma = (sigma + sigma.T) / 2.0
    target = float(parameters["target_variance"])
    cap = float(parameters["per_signal_cap"])
    rho = float(parameters["initial_penalty_weight"])
    growth = float(parameters["penalty_growth_factor"])
    tolerance = float(parameters["constraint_violation_tolerance"])
    multiplier = 0.0
    # start on the constraint surface along mu (clipped to the box)
    start_variance = float(mu @ sigma @ mu)
    weights = np.clip(mu * np.sqrt(target / start_variance) if start_variance > 0 else mu, -cap, cap)
    previous_violation = np.inf
    bounds = [(-cap, cap)] * columns.size

    def constraint(w):
        return float(w @ sigma @ w) - target

    for iteration in range(1, outer + 1):
        def lagrangian(w, multiplier=multiplier, rho=rho):
            g = constraint(w)
            value = -mu @ w + multiplier * g + 0.5 * rho * g * g
            gradient = -mu + (multiplier + rho * g) * 2.0 * (sigma @ w)
            return float(value), gradient

        inner = minimize(lagrangian, weights, jac=True, method="L-BFGS-B", bounds=bounds,
                         options={"maxiter": 1000, "ftol": 1e-15, "gtol": 1e-12})
        moved = float(np.max(np.abs(inner.x - weights)))
        weights = np.asarray(inner.x, dtype=np.float64)
        violation = constraint(weights)
        multiplier = multiplier + rho * violation
        grew = abs(violation) > 0.25 * abs(previous_violation)
        log(f"augmented Lagrangian outer iteration {iteration}: mu'w {number(mu @ weights)}, violation "
            f"{number(violation)}, multiplier {number(multiplier)}, penalty {number(rho)}"
            f"{' (grows)' if grew else ''}, L-BFGS-B {inner.nit} iterations")
        if grew:
            rho = min(rho * growth, MAXIMUM_PENALTY_WEIGHT)
        previous_violation = violation
        converged = abs(violation) <= tolerance and moved <= 1e-9
        if converged or iteration == outer:
            full = statistics.scatter(weights)
            if abs(violation) <= tolerance:
                status = "converged"
            elif rho >= MAXIMUM_PENALTY_WEIGHT:
                # the penalty is at its ceiling and the target is still missed: no point of the box reaches it
                status = "infeasible_target"
            else:
                status = "iteration_limit"
            log(f"augmented Lagrangian: {status} after {iteration} outer iterations, |violation| "
                f"{number(abs(violation))}; weights {selected_names(statistics, full)}")
            return ProgramResult(full, status, float(mu @ weights),
                                 diagnostics={"outer_iterations": iteration, "violation": float(violation),
                                              "multiplier": float(multiplier), "penalty_weight": float(rho)})
        yield PassUpdate(iteration, outer, statistics.scatter(weights), float(mu @ weights), abs(violation))
