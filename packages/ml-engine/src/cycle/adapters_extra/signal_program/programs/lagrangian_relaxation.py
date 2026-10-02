"""Lagrangian relaxation: signal selection under a cardinality and a risk budget, with bound and repair.

Each signal j is an item with gain_j = |mu_j| - hurdle (its information
coefficient net of the hurdle) and risk_j = its profit-stream deviation over
the average one. The selection program is a two-constraint knapsack:

    maximise    sum_j gain_j z_j                  z_j in {0, 1}
    subject to  sum_j z_j <= maximum selected signals        (kept: the easy constraint)
                sum_j risk_j z_j <= risk budget              (relaxed with a multiplier lambda >= 0)

For a given lambda the relaxed problem is solved exactly by keeping the top
signals by gain_j - lambda * risk_j (at most the cardinality, only positive
ones), and L(lambda) = lambda * risk budget + that total is an upper bound on
the optimum. lambda follows the projected subgradient
lambda <- max(0, lambda - step_k * (risk budget - risk used)), step_k = step size
* decay^k, and the tightest bound is kept. The repair heuristic turns the
relaxed selection of the best bound into a feasible one: drop the selected
signal with the lowest gain per unit risk until the risk budget holds, then
add signals by gain per unit risk while they fit. The bound, the repaired
objective and their gap are logged. A selected signal is weighted sign(mu_j).
"""

from __future__ import annotations

import numpy as np

from . import PassUpdate, ProgramResult, number, selected_names, split_passes


def relaxed_selection(gain: np.ndarray, risk: np.ndarray, multiplier: float, most: int) -> np.ndarray:
    adjusted = gain - multiplier * risk
    order = np.argsort(-adjusted, kind="stable")
    chosen = np.zeros(gain.size, dtype=bool)
    for position in order[:most]:
        if adjusted[position] > 0.0:
            chosen[position] = True
    return chosen


def repair(chosen: np.ndarray, gain: np.ndarray, risk: np.ndarray, budget: float, most: int) -> np.ndarray:
    chosen = chosen.copy()
    ratio = gain / np.maximum(risk, 1e-12)
    while chosen.any() and float(risk[chosen].sum()) > budget + 1e-12:
        members = np.flatnonzero(chosen)
        chosen[members[np.argmin(ratio[members])]] = False
    for position in np.argsort(-ratio, kind="stable"):
        if chosen.sum() >= most:
            break
        if not chosen[position] and gain[position] > 0.0 and float(risk[chosen].sum() + risk[position]) <= budget + 1e-12:
            chosen[position] = True
    return chosen


def planned_passes(parameters: dict) -> int:
    return split_passes(int(parameters["iteration_count"]))[0]


def solve(statistics, parameters: dict, log, task: str = "classification"):
    columns = statistics.usable_columns()
    iterations = max(1, int(parameters["iteration_count"]))
    pass_count, per_pass = split_passes(iterations)
    if columns.size == 0:
        log("Lagrangian relaxation: no usable signal on the training span; every weight is 0")
        return ProgramResult(np.zeros(statistics.signal_count), "no_signal", 0.0)
    gain = np.abs(statistics.mu[columns]) - float(parameters["information_coefficient_hurdle"])
    risk = statistics.normalised_risk()[columns]
    most = max(1, int(parameters["maximum_selected_signals"]))
    budget = float(parameters["risk_budget"])
    step = float(parameters["subgradient_step_size"])
    decay = float(parameters["step_size_decay_rate"])
    tolerance = float(parameters["bound_improvement_tolerance"])
    multiplier = 0.0
    best_bound = np.inf
    best_multiplier = 0.0
    iteration = 0
    signs = np.sign(statistics.mu[columns])
    for pass_number in range(1, pass_count + 1):
        for _ in range(per_pass):
            if iteration >= iterations:
                break
            iteration += 1
            chosen = relaxed_selection(gain, risk, multiplier, most)
            bound = multiplier * budget + float((gain - multiplier * risk)[chosen].sum())
            if bound < best_bound - tolerance:
                best_bound, best_multiplier = bound, multiplier
            slack = budget - float(risk[chosen].sum())
            multiplier = max(0.0, multiplier - step * (decay ** (iteration - 1)) * slack)
        repaired = repair(relaxed_selection(gain, risk, best_multiplier, most), gain, risk, budget, most)
        primal = float(gain[repaired].sum())
        gap = best_bound - primal
        weights = statistics.scatter(np.where(repaired, signs, 0.0))
        log(f"Lagrangian relaxation pass {pass_number}: iteration {iteration}, multiplier {number(multiplier)}, "
            f"best bound {number(best_bound)}, repaired objective {number(primal)}, gap {number(gap)}")
        exact = gap <= tolerance
        if pass_number == pass_count or exact:
            status = "optimal" if exact else "bound_gap"
            log(f"Lagrangian relaxation: {status} after {iteration} subgradient iterations; {int(repaired.sum())} "
                f"signals, risk used {number(risk[repaired].sum())} of {number(budget)}; weights "
                f"{selected_names(statistics, weights)}")
            return ProgramResult(weights, status, primal,
                                 diagnostics={"subgradient_iterations": iteration, "dual_bound": float(best_bound),
                                              "gap": float(gap), "multiplier": float(best_multiplier),
                                              "selected_count": int(repaired.sum())})
        yield PassUpdate(pass_number, pass_count, weights, primal, float(gap))
