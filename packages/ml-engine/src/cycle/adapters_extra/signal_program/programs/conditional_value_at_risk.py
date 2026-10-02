"""Convex optimisation: the minimum tail-risk book of signals for a required edge (cvxpy, CLARABEL).

Rockafellar and Uryasev's mean-CVaR program over the signals' profit streams:

    minimise    CVaR_alpha(loss) + strength * (mixing * ||w||_1 + (1 - mixing) / 2 * ||w||_2^2)
    subject to  mu' w >= required edge fraction * exposure budget * max_j |mu_j|
                ||w||_1 <= exposure budget
                w_j * sign(mu_j) >= 0          (a signal is traded only in the direction of its information coefficient)

loss_t = -p_t' w is the book's loss on training bar t (p_t the signals' profit
streams). The required edge is a fraction of the most the budget can buy (all
of it on the strongest signal), so the program asks: of every book earning at
least that much, which has the smallest expected loss on its worst
(1 - alpha) share of bars? (Maximising edge minus a multiple of CVaR instead
is positively homogeneous: with the weak information coefficients of real bars
its optimum is the empty book.) CVaR uses the Rockafellar-Uryasev
linearisation, CVaR_alpha = min over zeta of zeta + sum_t max(0, loss_t - zeta) / ((1 - alpha) T),
one auxiliary slack per scenario bar. The scenario bars are the training bars
thinned evenly to at most ``maximum_scenario_rows``. The problem is checked to
be DCP and solved by CLARABEL (interior point); the CVaR reached and the dual
price of the edge requirement (the tail risk one more unit of edge costs) are logged.
"""

from __future__ import annotations

import numpy as np

from . import ProgramResult, number, one_shot, selected_names


def scenario_rows(count: int, maximum: int) -> np.ndarray:
    """At most ``maximum`` row positions spread evenly over ``count`` rows (deterministic, first and last kept)."""
    if count <= maximum:
        return np.arange(count, dtype=np.int64)
    return np.unique(np.round(np.linspace(0, count - 1, maximum)).astype(np.int64))


def empirical_cvar(losses: np.ndarray, confidence: float) -> float:
    """The Rockafellar-Uryasev CVaR of a finite sample: its minimum over zeta is attained at a sample value."""
    ordered = np.sort(np.asarray(losses, dtype=np.float64))[::-1]          # largest loss first
    tail = 1.0 / ((1.0 - confidence) * ordered.size)
    # at zeta = ordered[k] the excess sum is sum_{i < k} (ordered[i] - ordered[k])
    before = np.concatenate([[0.0], np.cumsum(ordered)[:-1]])
    positions = np.arange(ordered.size)
    values = ordered + tail * (before - positions * ordered)
    return float(values.min())


def required_edge(statistics, parameters: dict) -> float:
    columns = statistics.usable_columns()
    strongest = float(np.max(np.abs(statistics.mu[columns]))) if columns.size else 0.0
    return float(parameters["required_edge_fraction"]) * float(parameters["exposure_budget"]) * strongest


def _solve(statistics, parameters: dict, log, task: str = "classification") -> ProgramResult:
    import cvxpy

    columns = statistics.usable_columns()
    edge = required_edge(statistics, parameters)
    if columns.size == 0 or statistics.pnl is None or statistics.pnl.shape[0] < 2 or edge <= 0.0:
        log("convex program: no usable signal with a non-zero information coefficient; every weight is 0")
        return ProgramResult(np.zeros(statistics.signal_count), "no_signal", 0.0)
    confidence = float(parameters["tail_confidence_level"])
    strength = float(parameters["elastic_net_strength"])
    mixing = float(parameters["elastic_net_mixing"])
    budget = float(parameters["exposure_budget"])
    rows = scenario_rows(statistics.pnl.shape[0], int(parameters["maximum_scenario_rows"]))
    scenarios = statistics.pnl[rows][:, columns]
    mu = statistics.mu[columns]
    count = scenarios.shape[0]
    weights = cvxpy.Variable(columns.size)
    value_at_risk = cvxpy.Variable()
    losses = -scenarios @ weights
    cvar = value_at_risk + cvxpy.sum(cvxpy.pos(losses - value_at_risk)) / ((1.0 - confidence) * count)
    penalty = strength * (mixing * cvxpy.norm1(weights) + (1.0 - mixing) / 2.0 * cvxpy.sum_squares(weights))
    edge_row = mu @ weights >= edge
    constraints = [edge_row, cvxpy.norm1(weights) <= budget, cvxpy.multiply(np.sign(mu), weights) >= 0]
    problem = cvxpy.Problem(cvxpy.Minimize(cvar + penalty), constraints)
    convex = bool(problem.is_dcp())
    problem.solve(solver=cvxpy.CLARABEL, max_iter=500, verbose=False)
    if weights.value is None:
        log(f"convex program: CLARABEL ended {problem.status}; every weight is 0")
        return ProgramResult(np.zeros(statistics.signal_count), str(problem.status), 0.0)
    solution = np.asarray(weights.value, dtype=np.float64)
    solution[np.abs(solution) < 1e-10] = 0.0
    full = statistics.scatter(solution)
    tail = empirical_cvar(-scenarios @ solution, confidence)
    edge_price = float(edge_row.dual_value) if edge_row.dual_value is not None else float("nan")
    log(f"convex program (DCP {'verified' if convex else 'NOT verified'}, CLARABEL): status {problem.status}, "
        f"CVaR at {number(confidence)} {number(tail)} over {count} scenario bars (of {statistics.pnl.shape[0]}) for "
        f"a required edge {number(edge)} (reached {number(mu @ solution)}), edge dual price {number(edge_price)}, "
        f"{int(problem.solver_stats.num_iters or 0)} iterations")
    log(f"convex program: weights {selected_names(statistics, full)}")
    return ProgramResult(full, str(problem.status), -float(problem.value),
                         diagnostics={"scenario_rows": int(count), "conditional_value_at_risk": tail,
                                      "required_edge": edge, "edge_dual_price": edge_price,
                                      "disciplined_convex": convex})


solve = one_shot(_solve)
