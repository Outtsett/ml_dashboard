"""Mixed-integer programming: cardinality-constrained signal allocation with linking constraints.

Continuous weights w_j = w_plus_j - w_minus_j and binary selectors z_j:

    maximise    sum_j mu_j * w_j - selection_cost * sum_j z_j
    subject to  w_plus_j + w_minus_j <= cap * z_j                 (a weight only on a selected signal; big-M = cap)
                w_plus_j + w_minus_j >= minimum weight * z_j      (a selected signal carries at least this much)
                sum_j z_j <= maximum selected signals
                sum_j (w_plus_j + w_minus_j) <= exposure budget
                z_i + z_j <= 1  for every pair with |corr(x_i, x_j)| > the redundancy limit

The last rows forbid holding two signals that say the same thing, which makes
the selection a genuine combinatorial problem (an independent set under a
budget). ``scipy.optimize.milp`` (HiGHS branch and cut) solves it; the status,
the gap, the node count and the dual bound are logged.
"""

from __future__ import annotations

import numpy as np
from scipy.optimize import Bounds, LinearConstraint, milp

from . import ProgramResult, number, one_shot, selected_names


def _solve(statistics, parameters: dict, log, task: str = "classification") -> ProgramResult:
    columns = statistics.usable_columns()
    cap = float(parameters["per_signal_cap"])
    budget = float(parameters["exposure_budget"])
    minimum = min(float(parameters["minimum_signal_weight"]), cap)
    selection_cost = float(parameters["selection_cost"])
    most = int(parameters["maximum_selected_signals"])
    limit = float(parameters["redundancy_correlation_limit"])
    if columns.size == 0:
        log("mixed-integer program: no usable signal on the training span; every weight is 0")
        return ProgramResult(np.zeros(statistics.signal_count), "no_signal", 0.0)
    mu = statistics.mu[columns]
    count = columns.size
    # variables: w_plus (count), w_minus (count), z (count)
    cost = np.concatenate([-mu, mu, np.full(count, selection_cost)])
    identity = np.eye(count)
    rows, lower, upper = [], [], []
    rows.append(np.hstack([identity, identity, -cap * identity]))
    lower.append(np.full(count, -np.inf))
    upper.append(np.zeros(count))
    rows.append(np.hstack([identity, identity, -minimum * identity]))
    lower.append(np.zeros(count))
    upper.append(np.full(count, np.inf))
    rows.append(np.concatenate([np.zeros(2 * count), np.ones(count)])[None, :])
    lower.append([-np.inf])
    upper.append([float(most)])
    rows.append(np.concatenate([np.ones(2 * count), np.zeros(count)])[None, :])
    lower.append([-np.inf])
    upper.append([budget])
    correlation = statistics.correlation[np.ix_(columns, columns)]
    first, second = np.triu_indices(count, k=1)
    conflicts = np.abs(correlation[first, second]) > limit
    if conflicts.any():
        pairs = np.zeros((int(conflicts.sum()), 3 * count))
        pairs[np.arange(pairs.shape[0]), 2 * count + first[conflicts]] = 1.0
        pairs[np.arange(pairs.shape[0]), 2 * count + second[conflicts]] = 1.0
        rows.append(pairs)
        lower.append(np.full(pairs.shape[0], -np.inf))
        upper.append(np.ones(pairs.shape[0]))
    bounds = Bounds(np.zeros(3 * count), np.concatenate([np.full(2 * count, cap), np.ones(count)]))
    integrality = np.concatenate([np.zeros(2 * count), np.ones(count)])
    options = {"disp": False, "mip_rel_gap": float(parameters["relative_gap_tolerance"]),
               "node_limit": int(parameters["node_limit"]), "presolve": True}
    result = milp(cost, integrality=integrality, bounds=bounds,
                  constraints=LinearConstraint(np.vstack(rows), np.concatenate(lower), np.concatenate(upper)),
                  options=options)
    if result.x is None:
        log(f"mixed-integer program: HiGHS status {result.status} ({result.message}); every weight is 0")
        return ProgramResult(np.zeros(statistics.signal_count), f"failed_{result.status}", 0.0)
    selected = np.round(result.x[2 * count:]) > 0.5
    weights_on = np.where(selected, result.x[:count] - result.x[count:2 * count], 0.0)
    weights = statistics.scatter(weights_on)
    objective = float(-result.fun)
    gap = float(getattr(result, "mip_gap", np.nan))
    nodes = int(getattr(result, "mip_node_count", 0) or 0)
    bound = float(-getattr(result, "mip_dual_bound", np.nan))
    log(f"mixed-integer program (HiGHS branch and cut): status {result.status} ({result.message}), objective "
        f"{number(objective)}, dual bound {number(bound)}, relative gap {number(gap)}, {nodes} nodes, "
        f"{int(conflicts.sum())} redundancy rows")
    log(f"mixed-integer program: {int(selected.sum())} of at most {most} signals selected: "
        f"{selected_names(statistics, weights)}")
    return ProgramResult(weights, "optimal" if result.status == 0 else f"status_{result.status}", objective,
                         diagnostics={"relative_gap": gap, "node_count": nodes, "dual_bound": bound,
                                      "redundancy_rows": int(conflicts.sum()), "selected_count": int(selected.sum())})


solve = one_shot(_solve)
