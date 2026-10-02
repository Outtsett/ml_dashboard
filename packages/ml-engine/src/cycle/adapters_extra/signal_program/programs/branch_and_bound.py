"""Branch and bound: the exact best subset of K signals for a least-squares fit of the move.

Among all subsets S of exactly K usable signals, find the one whose least-squares
fit of the standardised forward move y on the signals X_S (training span) has the
smallest residual sum of squares RSS(S) = y'y - b_S' G_SS^-1 b_S (G = X'X/n, b = X'y/n).

The search tree fixes signals in or out, strongest first (signals ordered by
|corr(x_j, y)|). At a node with included set I and undecided signals U, every
completion is a subset of I + U, and adding regressors never raises the RSS, so
RSS(I + U) is a lower bound for the whole subtree (the leaps-and-bounds bound of
Furnival and Wilson): a subtree whose bound is not below the incumbent (less the
relative gap tolerance) is pruned. The incumbent starts from forward stepwise
selection. The search visits nodes depth first until the tree is exhausted or
the node limit is reached, in which case the incumbent is returned with its
proven gap to the smallest open bound. A pass is a block of nodes; the node
count, the incumbent and the bound are logged. The weights are the OLS
coefficients of the chosen subset (zero elsewhere).
"""

from __future__ import annotations

import math

import numpy as np

from . import PassUpdate, ProgramResult, number, selected_names

PASS_COUNT = 20


def residual_sum(gram: np.ndarray, cross: np.ndarray, second_moment: float, members) -> float:
    members = list(members)
    if not members:
        return float(second_moment)
    block = gram[np.ix_(members, members)]
    vector = cross[members]
    try:
        coefficients = np.linalg.solve(block, vector)
    except np.linalg.LinAlgError:
        coefficients = np.linalg.lstsq(block, vector, rcond=None)[0]
    return float(second_moment - vector @ coefficients)


def coefficients_of(gram: np.ndarray, cross: np.ndarray, members) -> np.ndarray:
    members = list(members)
    block = gram[np.ix_(members, members)]
    try:
        return np.linalg.solve(block, cross[members])
    except np.linalg.LinAlgError:
        return np.linalg.lstsq(block, cross[members], rcond=None)[0]


def forward_selection(gram, cross, second_moment, candidates, size) -> list[int]:
    chosen: list[int] = []
    for _ in range(size):
        best, best_value = None, math.inf
        for candidate in candidates:
            if candidate in chosen:
                continue
            value = residual_sum(gram, cross, second_moment, chosen + [candidate])
            if value < best_value - 1e-15:
                best, best_value = candidate, value
        if best is None:
            break
        chosen.append(best)
    return chosen


def planned_passes(parameters: dict) -> int:
    return PASS_COUNT


def solve(statistics, parameters: dict, log, task: str = "classification"):
    columns = [int(column) for column in statistics.usable_columns()]
    size = min(max(1, int(parameters["maximum_selected_signals"])), len(columns))
    node_limit = max(1, int(parameters["node_limit"]))
    gap_tolerance = float(parameters["relative_gap_tolerance"])
    if not columns:
        log("branch and bound: no usable signal on the training span; every weight is 0")
        return ProgramResult(np.zeros(statistics.signal_count), "no_signal", 0.0)
    gram, cross, second = statistics.gram, statistics.cross, float(statistics.target_second_moment)
    strength = np.array([abs(cross[column]) / math.sqrt(max(gram[column, column], 1e-300)) for column in columns])
    order = [columns[position] for position in np.argsort(-strength, kind="stable")]
    incumbent = forward_selection(gram, cross, second, order, size)
    incumbent_value = residual_sum(gram, cross, second, incumbent)
    log(f"branch and bound: best {size} of {len(columns)} signals; forward-selection incumbent RSS "
        f"{number(incumbent_value)}")
    # a node: (next position in `order`, included signals)
    stack: list[tuple[int, tuple[int, ...]]] = [(0, ())]
    nodes = 0
    per_pass = max(1, -(-node_limit // PASS_COUNT))
    pruned = 0
    for pass_number in range(1, PASS_COUNT + 1):
        pass_end = min(node_limit, pass_number * per_pass)
        while stack and nodes < pass_end:
            position, included = stack.pop()
            nodes += 1
            if len(included) == size:
                value = residual_sum(gram, cross, second, included)
                if value < incumbent_value - 1e-15:
                    incumbent, incumbent_value = list(included), value
                continue
            remaining = len(order) - position
            if len(included) + remaining < size:
                continue
            bound = residual_sum(gram, cross, second, list(included) + order[position:])
            if bound >= incumbent_value - gap_tolerance * abs(incumbent_value):
                pruned += 1
                continue
            # exclude branch pushed first so the include branch is explored first (depth first)
            stack.append((position + 1, included))
            stack.append((position + 1, included + (order[position],)))
        open_bound = min((residual_sum(gram, cross, second, list(included) + order[position:])
                          for position, included in stack), default=incumbent_value)
        best_bound = min(open_bound, incumbent_value)
        gap = (incumbent_value - best_bound) / max(abs(incumbent_value), 1e-300)
        weights = statistics.scatter(np.zeros(len(columns)))
        weights[incumbent] = coefficients_of(gram, cross, incumbent)
        log(f"branch and bound pass {pass_number}: {nodes} nodes, {pruned} pruned, {len(stack)} open, incumbent RSS "
            f"{number(incumbent_value)}, lower bound {number(best_bound)}, relative gap {number(gap)}")
        finished = not stack or nodes >= node_limit or pass_number == PASS_COUNT
        if finished:
            status = "optimal" if not stack else "node_limit"
            log(f"branch and bound: {status}; chosen {selected_names(statistics, weights)}")
            return ProgramResult(weights, status, -incumbent_value,
                                 diagnostics={"node_count": nodes, "pruned_count": pruned, "relative_gap": float(gap),
                                              "residual_sum_of_squares": float(incumbent_value),
                                              "lower_bound": float(best_bound)})
        yield PassUpdate(pass_number, PASS_COUNT, weights, -incumbent_value, float(gap))
