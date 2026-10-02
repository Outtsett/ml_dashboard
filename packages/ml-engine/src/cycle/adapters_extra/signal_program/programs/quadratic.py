"""Quadratic programming: Markowitz mean-variance over the signals' profit streams (cvxpy, OSQP).

    minimise    (risk_aversion / 2) * w' Sigma w - mu' w
    subject to  sum_j |w_j| <= exposure budget
                |w_j| <= per_signal_cap

Sigma is the Ledoit-Wolf covariance of the per-signal profit streams on the
training span (``SignalStatistics.covariance``), so a signal that only repeats
another adds risk without adding return and is down-weighted. The convex QP is
solved by OSQP (operator splitting, no polishing step) to the tolerance
given; the status, iterations and the dual prices of the budget and the caps
are logged.
"""

from __future__ import annotations

import numpy as np

from . import ProgramResult, number, one_shot, selected_names


def _solve(statistics, parameters: dict, log, task: str = "classification") -> ProgramResult:
    import cvxpy

    columns = statistics.usable_columns()
    if columns.size == 0:
        log("quadratic program: no usable signal on the training span; every weight is 0")
        return ProgramResult(np.zeros(statistics.signal_count), "no_signal", 0.0)
    mu = statistics.mu[columns]
    sigma = statistics.covariance[np.ix_(columns, columns)]
    sigma = (sigma + sigma.T) / 2.0
    risk_aversion = float(parameters["risk_aversion"])
    budget = float(parameters["exposure_budget"])
    cap = float(parameters["per_signal_cap"])
    tolerance = float(parameters["solver_tolerance"])
    weights = cvxpy.Variable(columns.size)
    budget_row = cvxpy.norm1(weights) <= budget
    cap_rows = cvxpy.abs(weights) <= cap
    problem = cvxpy.Problem(
        cvxpy.Minimize(0.5 * risk_aversion * cvxpy.quad_form(weights, cvxpy.psd_wrap(sigma)) - mu @ weights),
        [budget_row, cap_rows])
    # polish=False: OSQP prints its polishing notice to stdout, the engine's JSON-line protocol channel
    problem.solve(solver=cvxpy.OSQP, eps_abs=tolerance, eps_rel=tolerance, max_iter=200000, polishing=False,
                  verbose=False)
    if weights.value is None:
        log(f"quadratic program: OSQP ended {problem.status}; every weight is 0")
        return ProgramResult(np.zeros(statistics.signal_count), str(problem.status), 0.0)
    solution = np.asarray(weights.value, dtype=np.float64)
    full = statistics.scatter(solution)
    objective = float(mu @ solution - 0.5 * risk_aversion * solution @ sigma @ solution)
    budget_price = float(budget_row.dual_value) if budget_row.dual_value is not None else float("nan")
    cap_prices = np.asarray(cap_rows.dual_value if cap_rows.dual_value is not None else np.zeros(columns.size))
    iterations = int(problem.solver_stats.num_iters or 0)
    log(f"quadratic program (OSQP): status {problem.status}, mean minus half risk-weighted variance "
        f"{number(objective)}, {iterations} iterations, budget dual price {number(budget_price)}, "
        f"{int(np.sum(cap_prices > 1e-9))} caps binding")
    log(f"quadratic program: weights {selected_names(statistics, full)}")
    return ProgramResult(full, str(problem.status), objective,
                         diagnostics={"iterations": iterations, "budget_dual_price": budget_price,
                                      "binding_caps": int(np.sum(cap_prices > 1e-9))})


solve = one_shot(_solve)
