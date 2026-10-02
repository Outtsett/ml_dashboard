"""First-order logic inference: resolution refutation with unification.

The knowledge base is a set of universally quantified, function-free Horn
clauses over lookback windows W in {5, 10, 20, 50} bars and directions D in
{up, down} (variables are capitalised):

    trend(D, W)    <- moves(D, W), beyond(D, W)
    aligned(D)     <- trend(D, W1), trend(D, W2), shorter(W1, W2)
    leaning(D)     <- trend(D, W), supports(D, E)
    confirmed(D)   <- aligned(D), supports(D, E)

Ground facts for bar t read closes at rows <= t only: ``moves(up, w)`` when
close[t] > close[t - w] (``moves(down, w)`` when below), ``beyond(up, w)`` when
close[t] is above the mean of its last w closes (``beyond(down, w)`` below),
the static ``shorter(w1, w2)``, and ``supports(D, evidence)`` when one of the
``evidence_predicate_count`` most reliable directional predicates (ranked on
the training span) holds and argues for D.

For each direction the prover establishes the strongest provable conclusion
(confirmed 3, aligned 2, leaning 1, none 0) by refutation: the negated goal is
resolved against the clauses (linear input resolution, variables renamed
apart, most general unifier) until the empty clause appears, within
``maximum_resolution_steps``. The two levels index a 4 x 4 table of smoothed
training up-rates; the score is its log-odds. Proofs are memoised by the
bar's set of ground facts (entailment depends on nothing else).
"""

from __future__ import annotations

import itertools
from functools import lru_cache

import numpy as np

from cycle.adapters_extra.symbolic_reasoner.predicates import rule_strength, smoothed_rate
from cycle.adapters_extra.symbolic_reasoner.reasoning import Engine, logit, to_list

WINDOWS = (5, 10, 20, 50)
DIRECTIONS = ("up", "down")
GOALS = ("confirmed", "aligned", "leaning")      # levels 3, 2, 1

# (head, body): terms are tuples (predicate, argument...), variables are capitalised strings
PROGRAM_RULES = (
    (("trend", "D", "W"), (("moves", "D", "W"), ("beyond", "D", "W"))),
    (("aligned", "D"), (("trend", "D", "W1"), ("trend", "D", "W2"), ("shorter", "W1", "W2"))),
    (("leaning", "D"), (("trend", "D", "W"), ("supports", "D", "E"))),
    (("confirmed", "D"), (("aligned", "D"), ("supports", "D", "E"))),
)
STATIC_FACTS = tuple(("shorter", first, second) for first, second in itertools.combinations(WINDOWS, 2))


def is_variable(term) -> bool:
    return isinstance(term, str) and term[:1].isupper()


def walk(term, substitution: dict):
    while is_variable(term) and term in substitution:
        term = substitution[term]
    return term


def unify(left: tuple, right: tuple, substitution: dict) -> dict | None:
    """Most general unifier of two atoms (function-free), extending ``substitution``; None if they clash."""
    if left[0] != right[0] or len(left) != len(right):
        return None
    out = dict(substitution)
    for a, b in zip(left[1:], right[1:]):
        a, b = walk(a, out), walk(b, out)
        if a == b:
            continue
        if is_variable(a):
            out[a] = b
        elif is_variable(b):
            out[b] = a
        else:
            return None
    return out


def rename(clause: tuple, suffix: int) -> tuple:
    head, body = clause
    change = lambda atom: tuple(f"{t}_{suffix}" if is_variable(t) else t for t in atom)   # noqa: E731
    return change(head), tuple(change(atom) for atom in body)


def refute(goal: tuple, facts: frozenset, maximum_steps: int) -> tuple[bool, int]:
    """Resolution refutation of the negated ``goal`` against the program plus
    ``facts``: depth-first linear input resolution. Returns (proved, steps)."""
    clauses = [(fact, ()) for fact in sorted(facts | set(STATIC_FACTS), key=repr)] + list(PROGRAM_RULES)
    steps = 0
    counter = itertools.count()
    stack = [((goal,), {})]                   # the negative clause (literals to refute) and its substitution
    while stack:
        literals, substitution = stack.pop()
        if not literals:
            return True, steps
        steps += 1
        if steps > maximum_steps:
            return False, steps
        selected, rest = literals[0], literals[1:]
        selected = tuple(walk(term, substitution) for term in selected)
        resolvents = []
        for clause in clauses:
            if clause[0][0] != selected[0]:
                continue
            head, body = rename(clause, next(counter)) if clause[1] else clause
            unifier = unify(selected, head, substitution)
            if unifier is not None:
                resolvents.append((tuple(body) + tuple(rest), unifier))
        stack.extend(reversed(resolvents))
    return False, steps


@lru_cache(maxsize=65536)
def entailed_levels(facts: frozenset, maximum_steps: int) -> tuple[int, int, int]:
    """(level up, level down, resolution steps) of one fact set."""
    levels = []
    total = 0
    for direction in DIRECTIONS:
        level = 0
        for goal, value in zip(GOALS, (3, 2, 1)):
            proved, steps = refute((goal, direction), facts, maximum_steps)
            total += steps
            if proved:
                level = value
                break
        levels.append(level)
    return levels[0], levels[1], total


def evidence_ranking(truth: np.ndarray, direction: np.ndarray, signs: np.ndarray, count: int, pseudo: float) -> list[int]:
    """The ``count`` directional predicates whose suggestion was most reliable on the training rows."""
    y = direction
    known = np.isfinite(y)
    base = float(np.mean(y[known])) if known.any() else 0.5
    ranked = []
    for index in range(truth.shape[1]):
        if signs[index] == 0:
            continue
        hit = known & (truth[:, index] == 1.0)
        fires = float(hit.sum())
        if fires < 1:
            continue
        rate = float(smoothed_rate(y[hit].sum(), fires, base, pseudo))
        strength = float(rule_strength(rate, fires, base, pseudo)) * signs[index]
        ranked.append((-strength, index))
    ranked.sort()
    return [index for _, index in ranked[: max(0, count)]]


def window_facts(close: np.ndarray, rows: np.ndarray) -> np.ndarray:
    """(rows, windows, 2) codes: [moves, beyond] with +1 up, -1 down, 0 neither or unknown."""
    close = np.asarray(close, dtype=np.float64)
    out = np.zeros((rows.size, len(WINDOWS), 2), dtype=np.int64)
    cumulative = np.concatenate([[0.0], np.cumsum(np.nan_to_num(close))])
    finite = np.concatenate([[0], np.cumsum(np.isfinite(close))])
    for position, window in enumerate(WINDOWS):
        start = rows - window
        ok = (start >= 0) & np.isfinite(close[rows])
        safe_start = np.maximum(start, 0)
        previous = close[safe_start]
        ok &= np.isfinite(previous)
        change = close[rows] - previous
        out[ok, position, 0] = np.sign(change[ok]).astype(np.int64)
        first = rows - window + 1
        full = ok & (first >= 0) & ((finite[rows + 1] - finite[np.maximum(first, 0)]) == window)
        mean = (cumulative[rows + 1] - cumulative[np.maximum(first, 0)]) / window
        out[full, position, 1] = np.sign(close[rows][full] - mean[full]).astype(np.int64)
    return out


def fact_set(codes: np.ndarray, support_up: bool, support_down: bool) -> frozenset:
    facts = set()
    for position, window in enumerate(WINDOWS):
        for kind, code in (("moves", codes[position, 0]), ("beyond", codes[position, 1])):
            if code > 0:
                facts.add((kind, "up", window))
            elif code < 0:
                facts.add((kind, "down", window))
    if support_up:
        facts.add(("supports", "up", "evidence"))
    if support_down:
        facts.add(("supports", "down", "evidence"))
    return frozenset(facts)


class FirstOrderLogic(Engine):
    def _levels(self, context, rows) -> np.ndarray:
        rows = np.asarray(rows, dtype=np.int64)
        truth = context.truth(rows)
        signs = context.bank.signs
        evidence = np.asarray(self.evidence, dtype=np.int64)
        up = np.any(truth[:, evidence[signs[evidence] > 0]] == 1.0, axis=1) if evidence.size else np.zeros(rows.size, bool)
        down = np.any(truth[:, evidence[signs[evidence] < 0]] == 1.0, axis=1) if evidence.size else np.zeros(rows.size, bool)
        codes = window_facts(context.view.close, rows)
        steps = int(self.parameters["maximum_resolution_steps"])
        out = np.zeros((rows.size, 2), dtype=np.int64)
        for position in range(rows.size):
            level_up, level_down, _ = entailed_levels(fact_set(codes[position], bool(up[position]), bool(down[position])), steps)
            out[position] = (level_up, level_down)
        return out

    def fit(self, context, train_rows, target, direction):
        p = self.parameters
        pseudo = float(p["smoothing_pseudo_count"])
        truth = context.truth(train_rows)
        self.evidence = evidence_ranking(truth, direction[train_rows], context.bank.signs, int(p["evidence_predicate_count"]),
                                         pseudo)
        levels = self._levels(context, train_rows)
        y = direction[train_rows]
        known = np.isfinite(y)
        base = float(np.mean(y[known])) if known.any() else 0.5
        cells = levels[known, 0] * 4 + levels[known, 1]
        fires = np.bincount(cells, minlength=16).astype(np.float64)
        ups = np.bincount(cells, weights=y[known], minlength=16)
        self.table = smoothed_rate(ups, fires, base, pseudo)
        self.cell_counts = fires
        self.summary = {"evidence_predicates": [context.bank.names[i] for i in self.evidence],
                        "cells_seen": int((fires > 0).sum()), "base_rate": base}
        context.log(f"first-order logic: {int((fires > 0).sum())} of 16 entailment cells seen in training, "
                    f"{entailed_levels.cache_info().currsize} distinct fact sets proved")
        return None

    def score(self, context, rows):
        levels = self._levels(context, rows)
        return logit(self.table[levels[:, 0] * 4 + levels[:, 1]])

    def state(self):
        return {"evidence": [int(i) for i in self.evidence], "table": to_list(self.table),
                "cellCounts": to_list(self.cell_counts)}

    def load(self, state):
        self.evidence = [int(i) for i in state["evidence"]]
        self.table = np.asarray(state["table"], dtype=np.float64)
        self.cell_counts = np.asarray(state["cellCounts"], dtype=np.float64)
