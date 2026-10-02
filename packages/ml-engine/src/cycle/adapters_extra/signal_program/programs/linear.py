"""Linear programming: the signal-allocation LP, solved by the dual simplex (HiGHS).

    maximise    sum_j (mu_j * w_j) - hurdle * sum_j |w_j|
    subject to  sum_j |w_j| <= exposure_budget
                |w_j| <= per_signal_cap

with |w_j| linearised by w_j = w_plus_j - w_minus_j, both in [0, cap]. The
optimum is a vertex: the signals whose |information coefficient| clears the
hurdle, strongest first, each at its cap until the budget is spent (the last
one fractional). The dual prices of the budget row and of each cap are logged:
the budget's price is the gain one more unit of exposure would buy.
"""

from __future__ import annotations

import numpy as np
from scipy.optimize import linprog

from . import ProgramResult, number, one_shot, selected_names


def _solve(statistics, parameters: dict, log, task: str = "classification") -> ProgramResult:
    columns = statistics.usable_columns()
    budget = float(parameters["exposure_budget"])
    cap = float(parameters["per_signal_cap"])
    hurdle = float(parameters["information_coefficient_hurdle"])
    if columns.size == 0:
        log("linear program: no usable signal on the training span; every weight is 0")
        return ProgramResult(np.zeros(statistics.signal_count), "no_signal", 0.0)
    mu = statistics.mu[columns]
    count = columns.size
    cost = np.concatenate([hurdle - mu, hurdle + mu])            # minimise -(mu . w) + hurdle * |w|
    result = linprog(cost, A_ub=np.ones((1, 2 * count)), b_ub=[budget], bounds=[(0.0, cap)] * (2 * count),
                     method="highs-ds")
    if result.x is None:
        log(f"linear program: HiGHS status {result.status} ({result.message}); every weight is 0")
        return ProgramResult(np.zeros(statistics.signal_count), f"failed_{result.status}", 0.0)
    weights = statistics.scatter(result.x[:count] - result.x[count:])
    budget_price = float(-result.ineqlin.marginals[0]) if result.ineqlin.marginals.size else 0.0
    at_cap = int(np.sum(np.isclose(np.abs(weights), cap, rtol=0.0, atol=1e-12)))
    objective = float(-result.fun)
    log(f"linear program (HiGHS dual simplex): status {result.status} ({result.message}), objective "
        f"{number(objective)}, {result.nit} simplex iterations")
    log(f"linear program: exposure budget shadow price {number(budget_price)}, {at_cap} signals at the cap "
        f"{number(cap)}, weights {selected_names(statistics, weights)}")
    return ProgramResult(weights, "optimal" if result.status == 0 else f"status_{result.status}", objective,
                         diagnostics={"simplex_iterations": int(result.nit), "budget_shadow_price": budget_price,
                                      "signals_at_cap": at_cap})


solve = one_shot(_solve)
