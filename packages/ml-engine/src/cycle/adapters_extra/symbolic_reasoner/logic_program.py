"""Logic programming: a Horn-clause program answered by SLD resolution (miniKanren).

The program (``kanren``: relations, ``conde`` for alternative clauses, depth-
first interleaving search with backtracking)::

    signal(D, nested(W1, W2))   :- trend(W1, D), trend(W2, D), shorter(W1, W2).
    signal(D, confirmed(W, A))  :- trend(W, D), support(D, A).
    signal(D, rule(R))          :- fired(R, D).

Facts for bar t (rows <= t only): ``trend(w, D)`` when the close has moved in
direction D over the last w bars AND sits beyond its w-bar mean on that side
(w in 5, 10, 20, 50), the static ``shorter(w1, w2)``, ``support(D, A)`` for each
of the ``evidence_predicate_count`` most reliable directional predicates (ranked
on the training span) that holds, and ``fired(R, D)`` for each of the
``rule_count`` strongest mined or authored rules that fires.

The queries ``?- signal(up, X)`` and ``?- signal(down, X)`` enumerate distinct
derivations (up to ``answer_limit`` each). Prolog answers "is it provable", not
a probability: the score is the count difference, mapped to P(up) by the
validation curve. Answers are tabled by the bar's fact set.
"""

from __future__ import annotations

from functools import lru_cache

import numpy as np

from cycle.adapters_extra.symbolic_reasoner.predicates import Rule, fired, mine_rules
from cycle.adapters_extra.symbolic_reasoner.reasoning import Engine
from cycle.adapters_extra.symbolic_reasoner.resolution import (
    WINDOWS,
    evidence_ranking,
    window_facts,
)


@lru_cache(maxsize=65536)
def derivation_counts(trends: frozenset, supports: frozenset, rules_fired: frozenset, answer_limit: int) -> tuple[int, int]:
    """(derivations of signal(up, X), derivations of signal(down, X)) for one fact set."""
    from kanren import Relation, conde, eq, facts, run, var

    trend, shorter, support, fired_rule = Relation("trend"), Relation("shorter"), Relation("support"), Relation("fired")
    if trends:
        facts(trend, *sorted(trends))
    facts(shorter, *[(first, second) for first in WINDOWS for second in WINDOWS if first < second])
    if supports:
        facts(support, *sorted(supports))
    if rules_fired:
        facts(fired_rule, *sorted(rules_fired))

    def signal(direction, derivation):
        first, second, window, atom, rule = var(), var(), var(), var(), var()
        clauses = [[trend(first, direction), trend(second, direction), shorter(first, second),
                    eq(derivation, ("nested", first, second))]]
        if supports:
            clauses.append([trend(window, direction), support(direction, atom), eq(derivation, ("confirmed", window, atom))])
        if rules_fired:
            clauses.append([fired_rule(rule, direction), eq(derivation, ("rule", rule))])
        return conde(*clauses)

    counts = []
    for direction in ("up", "down"):
        answer = var()
        counts.append(len(set(run(int(answer_limit), answer, signal(direction, answer)))) if trends or rules_fired else 0)
    return counts[0], counts[1]


class LogicProgram(Engine):
    def fit(self, context, train_rows, target, direction):
        p = self.parameters
        truth = context.truth(train_rows)
        self.evidence = evidence_ranking(truth, direction[train_rows], context.bank.signs, int(p["evidence_predicate_count"]),
                                         float(p["smoothing_pseudo_count"]))
        self.rules, _ = mine_rules(context.bank, truth, direction[train_rows], atom_order=int(p["atom_order"]),
                                   minimum_fire_count=int(p["minimum_fire_count"]), rule_count=int(p["rule_count"]),
                                   pseudo_count=float(p["smoothing_pseudo_count"]))
        difference = self.difference(context, train_rows)
        self.summary = {"evidence_predicates": [context.bank.names[i] for i in self.evidence], "rule_count": len(self.rules),
                        "training_mean_absolute_derivation_difference": float(np.mean(np.abs(difference)))}
        context.log(f"logic program: {len(self.rules)} fired/2 rules, {len(self.evidence)} support/2 predicates, "
                    f"{derivation_counts.cache_info().currsize} tabled fact sets")
        return None

    def difference(self, context, rows) -> np.ndarray:
        rows = np.asarray(rows, dtype=np.int64)
        truth = context.truth(rows)
        names = context.bank.names
        signs = context.bank.signs
        codes = window_facts(context.view.close, rows)
        firing = np.column_stack([fired(truth, rule.atoms) == 1.0 for rule in self.rules]) if self.rules \
            else np.zeros((rows.size, 0), dtype=bool)
        limit = int(self.parameters["answer_limit"])
        out = np.zeros(rows.size)
        for position in range(rows.size):
            trends = frozenset((window, "up" if codes[position, k, 0] > 0 else "down")
                               for k, window in enumerate(WINDOWS)
                               if codes[position, k, 0] != 0 and codes[position, k, 0] == codes[position, k, 1])
            supports = frozenset(("up" if signs[i] > 0 else "down", names[i]) for i in self.evidence
                                 if truth[position, i] == 1.0)
            rules_fired = frozenset((f"rule_{k}", rule.conclusion) for k, rule in enumerate(self.rules)
                                    if firing[position, k])
            up, down = derivation_counts(trends, supports, rules_fired, limit)
            out[position] = up - down
        return out

    def score(self, context, rows):
        return self.difference(context, rows)

    def state(self):
        return {"evidence": [int(i) for i in self.evidence], "rules": [rule.to_dict() for rule in self.rules]}

    def load(self, state):
        self.evidence = [int(i) for i in state["evidence"]]
        self.rules = [Rule.from_dict(item) for item in state["rules"]]
