"""Dual decomposition: one subproblem per feature category, coordinated by a price on shared risk.

The signals are split into blocks by their ``features.json`` category (returns,
volatility, volume, microstructure, momentum, sentiment, ...; ``bridges.groups``).
The coupled program

    minimise    sum_g [ -mu_g' w_g + (risk_aversion / 2) w_g' Sigma_gg w_g ]
    subject to  sum_g ||w_g||_1 <= exposure budget          (the shared risk budget)
                |w_j| <= per_signal_cap

drops the covariance between categories (block-diagonal Sigma: the price of
decomposing). Relaxing the one coupling row with a price eta >= 0 separates it:
each block solves

    minimise    -mu_g' w_g + (risk_aversion / 2) w_g' Sigma_gg w_g + eta * ||w_g||_1   over its box

exactly, by cyclic coordinate descent with soft-thresholding (a convex,
box-constrained lasso-type QP), and the coordinator moves the price by the
projected subgradient step eta <- max(0, eta + step_k * (usage - budget)) with
step_k = step size * decay^k. The dual value sum_g subproblem_g(eta) - eta * budget
is a lower bound on the coupled minimum; the best one is tracked. A pass is a
block of coordination iterations; eta, the budget use and the violation are
logged. The coordination stops when the budget holds with complementary
slackness at the price the blocks were solved at (then the assembled blocks
are optimal for the block-diagonal program). The final weights are the best
feasible iterate seen (each within the budget, scaled onto it when just above);
when no iterate was feasible, the last block solutions scaled onto the budget.
"""

from __future__ import annotations

import numpy as np

from . import PassUpdate, ProgramResult, number, selected_names, split_passes

SWEEP_LIMIT = 2000


def block_solution(mu: np.ndarray, sigma: np.ndarray, risk: float, price: float, cap: float,
                   start: np.ndarray | None = None) -> np.ndarray:
    """argmin over |w| <= cap of -mu'w + risk/2 w'Sigma w + price ||w||_1 by cyclic coordinate descent."""
    weights = np.zeros(mu.size) if start is None else np.array(start, dtype=np.float64)
    curvature = risk * np.diag(sigma)
    for _ in range(SWEEP_LIMIT):
        largest = 0.0
        for column in range(mu.size):
            if curvature[column] <= 0.0:
                new = float(np.clip(np.sign(mu[column]) * cap if abs(mu[column]) > price else 0.0, -cap, cap))
            else:
                rest = risk * (sigma[column] @ weights - sigma[column, column] * weights[column])
                pull = mu[column] - rest
                shrunk = np.sign(pull) * max(abs(pull) - price, 0.0)
                new = float(np.clip(shrunk / curvature[column], -cap, cap))
            largest = max(largest, abs(new - weights[column]))
            weights[column] = new
        if largest <= 1e-13:
            break
    return weights


def block_objective(mu, sigma, risk, weights) -> float:
    return float(-mu @ weights + 0.5 * risk * weights @ sigma @ weights)


def planned_passes(parameters: dict) -> int:
    return split_passes(int(parameters["iteration_count"]))[0]


def category_blocks(statistics) -> dict[str, np.ndarray]:
    blocks: dict[str, list[int]] = {}
    for column in statistics.usable_columns():
        name = statistics.categories[column] if column < len(statistics.categories) else "other"
        blocks.setdefault(name, []).append(int(column))
    return {name: np.asarray(members, dtype=np.int64) for name, members in blocks.items()}


def solve(statistics, parameters: dict, log, task: str = "classification"):
    iterations = max(1, int(parameters["iteration_count"]))
    pass_count, per_pass = split_passes(iterations)
    blocks = category_blocks(statistics)
    if not blocks:
        log("dual decomposition: no usable signal on the training span; every weight is 0")
        return ProgramResult(np.zeros(statistics.signal_count), "no_signal", 0.0)
    risk = float(parameters["risk_aversion"])
    budget = float(parameters["exposure_budget"])
    cap = float(parameters["per_signal_cap"])
    step = float(parameters["subgradient_step_size"])
    decay = float(parameters["step_size_decay_rate"])
    tolerance = float(parameters["constraint_violation_tolerance"])
    parts = {name: (statistics.mu[members], statistics.covariance[np.ix_(members, members)])
             for name, members in blocks.items()}
    log(f"dual decomposition: {len(blocks)} category subproblems ("
        + ", ".join(f"{name} {members.size}" for name, members in blocks.items()) + ")")
    price = 0.0
    best_bound = -np.inf
    best_feasible: np.ndarray | None = None
    best_feasible_value = -np.inf
    solutions = {name: np.zeros(members.size) for name, members in blocks.items()}
    slack_allowed = tolerance * max(1.0, budget)

    def assembled() -> np.ndarray:
        weights = np.zeros(statistics.signal_count)
        for name, members in blocks.items():
            weights[members] = solutions[name]
        return weights

    def coupled_value(weights: np.ndarray) -> float:
        return -sum(block_objective(mu, sigma, risk, weights[blocks[name]]) for name, (mu, sigma) in parts.items())

    iteration = 0
    converged = False
    price_used = 0.0
    for pass_number in range(1, pass_count + 1):
        for _ in range(per_pass):
            if iteration >= iterations:
                break
            iteration += 1
            price_used = price
            usage = 0.0
            value = 0.0
            for name, (mu, sigma) in parts.items():
                solutions[name] = block_solution(mu, sigma, risk, price_used, cap, solutions[name])
                used = float(np.abs(solutions[name]).sum())
                usage += used
                value += block_objective(mu, sigma, risk, solutions[name]) + price_used * used
            best_bound = max(best_bound, value - price_used * budget)
            if usage <= budget + slack_allowed:
                # primal recovery: the best feasible iterate (scaled onto the budget when just above it)
                candidate = assembled() * (min(1.0, budget / usage) if usage > 0 else 1.0)
                candidate_value = coupled_value(candidate)
                if candidate_value > best_feasible_value:
                    best_feasible, best_feasible_value = candidate, candidate_value
            # complementary slackness at the price the blocks were solved at: optimal for the coupled program
            if usage <= budget + slack_allowed and (price_used <= 0.0 or abs(usage - budget) <= slack_allowed):
                converged = True
                break
            price = max(0.0, price + step * (decay ** (iteration - 1)) * (usage - budget))
        weights = assembled()
        usage = float(np.abs(weights).sum())
        violation = max(0.0, usage - budget)
        primal = coupled_value(weights)
        log(f"dual decomposition pass {pass_number}: iteration {iteration}, risk price {number(price_used)}, budget "
            f"use {number(usage)} of {number(budget)}, violation {number(violation)}, best dual bound "
            f"{number(-best_bound)}")
        if pass_number == pass_count or converged or iteration >= iterations:
            if best_feasible is None:
                best_feasible = weights * (budget / usage if usage > budget else 1.0)
            weights = best_feasible
            final = coupled_value(weights)
            gap = float(max(-best_bound - final, 0.0))
            status = "converged" if converged else "iteration_limit"
            log(f"dual decomposition: {status} after {iteration} coordination iterations; objective {number(final)}, "
                f"dual bound {number(-best_bound)}, gap {number(gap)}; weights {selected_names(statistics, weights)}")
            return ProgramResult(weights, status, final,
                                 diagnostics={"coordination_iterations": iteration, "risk_price": float(price_used),
                                              "dual_bound": float(-best_bound), "duality_gap": gap,
                                              "category_count": len(blocks)})
        yield PassUpdate(pass_number, pass_count, weights, primal, violation)
