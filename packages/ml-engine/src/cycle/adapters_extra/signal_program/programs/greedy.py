"""Greedy algorithm: ratio-greedy signal selection under a risk budget.

Starting from no signal, repeatedly add the remaining signal with the highest
marginal gain per unit of risk,

    gain(e | S) = mu_e^2 * (1 - max_{j in S} corr(x_e, x_j)^2)     (its information, less what S already carries)
    risk(e)     = the profit-stream deviation of e over the average one

among the signals that still fit the risk budget, until the budget or the
signal limit is reached or no marginal gain clears the minimum. The choice at
each step is final (no backtracking): that is the greedy algorithm. The order,
the marginal gains and the ratios are logged. A chosen signal is weighted by
mu_e / var(p_e), its information coefficient over its profit-stream variance.
"""

from __future__ import annotations

import numpy as np

from . import ProgramResult, number, one_shot, selected_names


def greedy_order(mu, correlation, risk, budget: float, most: int, minimum_gain: float) -> list[tuple[int, float]]:
    """[(signal, marginal gain)] in the order chosen."""
    chosen: list[tuple[int, float]] = []
    used = 0.0
    remaining = list(range(mu.size))
    while remaining and len(chosen) < most:
        best, best_ratio, best_gain = None, -np.inf, 0.0
        for candidate in remaining:
            if used + risk[candidate] > budget + 1e-12:
                continue
            overlap = max((correlation[candidate, member] ** 2 for member, _ in chosen), default=0.0)
            gain = float(mu[candidate] ** 2 * (1.0 - overlap))
            ratio = gain / max(float(risk[candidate]), 1e-12)
            if gain >= minimum_gain and gain > 0.0 and ratio > best_ratio:
                best, best_ratio, best_gain = candidate, ratio, gain
        if best is None:
            break
        chosen.append((best, best_gain))
        used += float(risk[best])
        remaining.remove(best)
    return chosen


def _solve(statistics, parameters: dict, log, task: str = "classification") -> ProgramResult:
    columns = statistics.usable_columns()
    if columns.size == 0:
        log("greedy selection: no usable signal on the training span; every weight is 0")
        return ProgramResult(np.zeros(statistics.signal_count), "no_signal", 0.0)
    mu = statistics.mu[columns]
    correlation = statistics.correlation[np.ix_(columns, columns)]
    risk = statistics.normalised_risk()[columns]
    budget = float(parameters["risk_budget"])
    chosen = greedy_order(mu, correlation, risk, budget, int(parameters["maximum_selected_signals"]),
                          float(parameters["minimum_marginal_gain"]))
    variance = np.maximum(statistics.pnl_deviation[columns] ** 2, 1e-12)
    on_usable = np.zeros(columns.size)
    for member, _gain in chosen:
        on_usable[member] = mu[member] / variance[member]
    weights = statistics.scatter(on_usable)
    for step, (member, gain) in enumerate(chosen, start=1):
        log(f"greedy selection step {step}: {statistics.names[columns[member]]}, marginal gain {number(gain)}, "
            f"risk {number(risk[member])}, gain per risk {number(gain / max(risk[member], 1e-12))}")
    total = float(sum(gain for _, gain in chosen))
    log(f"greedy selection: {len(chosen)} signals, total gain {number(total)}, risk used "
        f"{number(sum(risk[member] for member, _ in chosen))} of {number(budget)}; weights "
        f"{selected_names(statistics, weights)}")
    return ProgramResult(weights, "complete", total,
                         diagnostics={"selection_order": [statistics.names[columns[member]] for member, _ in chosen],
                                      "marginal_gains": [float(gain) for _, gain in chosen]})


solve = one_shot(_solve)
