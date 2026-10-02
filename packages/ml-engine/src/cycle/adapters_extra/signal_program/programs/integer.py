"""Integer linear programming: a whole-lot scorecard, solved by HiGHS branch and bound.

Each signal gets an integer number of lots m_j in {-L..L} (L = the most lots per
signal), linearised as m_j = m_plus_j - m_minus_j with both parts integer in [0, L]:

    maximise    sum_j mu_j * m_j - hurdle * sum_j |m_j|
    subject to  sum_j |m_j| <= total lot budget
                sum_{j in category c} |m_j| <= category lot limit    (each features.json category)

The per-category rows make the choice combinatorial (a category's strongest
signals compete for its lots). ``scipy.optimize.milp`` (HiGHS) solves it with
the relative gap and node limit from the parameters; the status, the gap, the
node count and the dual bound are logged. The score is s = sum_j m_j * x_j.
"""

from __future__ import annotations

import numpy as np
from scipy.optimize import Bounds, LinearConstraint, milp

from . import ProgramResult, number, one_shot, selected_names


def _solve(statistics, parameters: dict, log, task: str = "classification") -> ProgramResult:
    columns = statistics.usable_columns()
    lots = int(parameters["maximum_lots_per_signal"])
    total = int(parameters["total_lot_budget"])
    category_limit = int(parameters["category_lot_limit"])
    hurdle = float(parameters["information_coefficient_hurdle"])
    if columns.size == 0:
        log("integer program: no usable signal on the training span; every weight is 0")
        return ProgramResult(np.zeros(statistics.signal_count), "no_signal", 0.0)
    mu = statistics.mu[columns]
    count = columns.size
    cost = np.concatenate([hurdle - mu, hurdle + mu])
    rows = [np.ones(2 * count)]
    upper = [float(total)]
    categories = [statistics.categories[column] if column < len(statistics.categories) else "other"
                  for column in columns]
    for category in sorted(set(categories)):
        member = np.array([name == category for name in categories], dtype=np.float64)
        rows.append(np.concatenate([member, member]))
        upper.append(float(category_limit))
    options = {"disp": False, "mip_rel_gap": float(parameters["relative_gap_tolerance"]),
               "node_limit": int(parameters["node_limit"]), "presolve": True}
    result = milp(cost, integrality=np.ones(2 * count), bounds=Bounds(0.0, float(lots)),
                  constraints=LinearConstraint(np.vstack(rows), -np.inf, np.asarray(upper)), options=options)
    if result.x is None:
        log(f"integer program: HiGHS status {result.status} ({result.message}); every weight is 0")
        return ProgramResult(np.zeros(statistics.signal_count), f"failed_{result.status}", 0.0)
    lots_chosen = np.round(result.x[:count]) - np.round(result.x[count:])
    weights = statistics.scatter(lots_chosen)
    objective = float(-result.fun)
    gap = float(getattr(result, "mip_gap", np.nan))
    nodes = int(getattr(result, "mip_node_count", 0) or 0)
    bound = float(-getattr(result, "mip_dual_bound", np.nan))
    log(f"integer program (HiGHS branch and bound): status {result.status} ({result.message}), objective "
        f"{number(objective)}, dual bound {number(bound)}, relative gap {number(gap)}, {nodes} nodes")
    log(f"integer program: {int(np.sum(np.abs(lots_chosen)))} of {total} lots over "
        f"{int(np.count_nonzero(lots_chosen))} signals, {len(set(categories))} category rows; "
        f"lots {selected_names(statistics, weights)}")
    return ProgramResult(weights, "optimal" if result.status == 0 else f"status_{result.status}", objective,
                         diagnostics={"relative_gap": gap, "node_count": nodes, "dual_bound": bound})


solve = one_shot(_solve)
