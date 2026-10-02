"""Submodular optimisation: lazy-greedy maximisation of coverage plus relevance under a cardinality limit.

    f(S) = sum_i max_{j in S} |corr(x_i, x_j)|  +  relevance_weight * sum_{j in S} |mu_j| / max_k |mu_k|

The first term is facility-location coverage (how well the chosen signals
represent every signal of the fold), the second a modular relevance term; the
sum is monotone and submodular, so greedy selection of k signals reaches at
least (1 - 1/e) of the best possible f (Nemhauser, Wolsey and Fisher). The
lazy greedy (Minoux) keeps each signal's last marginal gain in a priority
queue: by submodularity it can only fall, so a stale gain is an upper bound
and a signal is re-evaluated only when it reaches the top. The number of gain
evaluations (against plain greedy's), f(S) and the resulting upper bound on
the optimum f(S) / (1 - 1/e) are logged. Chosen signals are weighted sign(mu_j) / k.
"""

from __future__ import annotations

import heapq
import math

import numpy as np

from . import ProgramResult, number, one_shot, selected_names


def set_value(similarity: np.ndarray, relevance: np.ndarray, members) -> float:
    members = list(members)
    if not members:
        return 0.0
    return float(similarity[:, members].max(axis=1).sum() + relevance[members].sum())


def lazy_greedy(similarity: np.ndarray, relevance: np.ndarray, size: int) -> tuple[list[int], list[float], int]:
    """(chosen signals, their marginal gains, gain evaluations)."""
    count = relevance.size
    covered = np.zeros(similarity.shape[0])
    chosen: list[int] = []
    gains: list[float] = []

    def gain_of(candidate: int) -> float:
        return float(np.maximum(similarity[:, candidate] - covered, 0.0).sum() + relevance[candidate])

    evaluations = count
    queue = [(-gain_of(candidate), candidate) for candidate in range(count)]
    heapq.heapify(queue)
    while queue and len(chosen) < size:
        stale_gain, candidate = heapq.heappop(queue)
        fresh = gain_of(candidate)
        evaluations += 1
        if not queue or fresh >= -queue[0][0] - 1e-15:
            if fresh <= 0.0:
                break
            chosen.append(candidate)
            gains.append(fresh)
            covered = np.maximum(covered, similarity[:, candidate])
        else:
            heapq.heappush(queue, (-fresh, candidate))
    return chosen, gains, evaluations


def plain_greedy(similarity: np.ndarray, relevance: np.ndarray, size: int) -> list[int]:
    """The textbook greedy (every remaining gain recomputed each step); the unit test's reference."""
    chosen: list[int] = []
    for _ in range(size):
        base = set_value(similarity, relevance, chosen)
        best, best_gain = None, 0.0
        for candidate in range(relevance.size):
            if candidate in chosen:
                continue
            gain = set_value(similarity, relevance, chosen + [candidate]) - base
            if gain > best_gain + 1e-15:
                best, best_gain = candidate, gain
        if best is None:
            break
        chosen.append(best)
    return chosen


def _solve(statistics, parameters: dict, log, task: str = "classification") -> ProgramResult:
    columns = statistics.usable_columns()
    if columns.size == 0:
        log("submodular selection: no usable signal on the training span; every weight is 0")
        return ProgramResult(np.zeros(statistics.signal_count), "no_signal", 0.0)
    size = min(max(1, int(parameters["maximum_selected_signals"])), columns.size)
    mu = statistics.mu[columns]
    similarity = np.abs(statistics.correlation[np.ix_(columns, columns)])
    strongest = float(np.max(np.abs(mu)))
    relevance = float(parameters["relevance_weight"]) * (np.abs(mu) / strongest if strongest > 0 else np.zeros(columns.size))
    chosen, gains, evaluations = lazy_greedy(similarity, relevance, size)
    value = set_value(similarity, relevance, chosen)
    upper = value / (1.0 - 1.0 / math.e)
    on_usable = np.zeros(columns.size)
    for member in chosen:
        on_usable[member] = np.sign(mu[member]) / max(1, len(chosen))
    weights = statistics.scatter(on_usable)
    log(f"submodular selection (lazy greedy): {len(chosen)} of {columns.size} signals, f(S) {number(value)}, "
        f"optimum at most {number(upper)} (the (1 - 1/e) guarantee), {evaluations} gain evaluations against "
        f"{size * columns.size} for plain greedy")
    log("submodular selection gains: " + ", ".join(
        f"{statistics.names[columns[member]]} {number(gain)}" for member, gain in zip(chosen, gains)))
    log(f"submodular selection: weights {selected_names(statistics, weights)}")
    return ProgramResult(weights, "complete", value,
                         diagnostics={"set_value": value, "optimum_upper_bound": upper, "gain_evaluations": evaluations,
                                      "selection_order": [statistics.names[columns[member]] for member in chosen]})


solve = one_shot(_solve)
