"""Expert system: forward chaining over a working memory with MYCIN certainty factors.

Knowledge base (built on the training span):

- **base facts** are the bar's grounded predicates, each with certainty
  CF = 2 * degree - 1 in [-1, 1] (graded membership; an unknown input is not
  asserted);
- **pattern rules** (layer 1): IF every predicate of a mined or authored rule
  THEN assert the fact ``pattern_k``, CF = the premise's CF (the minimum of its
  conditions, MYCIN's AND);
- **hypothesis rules** (layer 2): IF ``pattern_k`` THEN ``up`` with the rule's
  certainty factor calibrated on the training span by MYCIN's own definition,
  CF = (P(up | pattern) - P(up)) / (1 - P(up)) when the pattern raises belief
  and (P(up | pattern) - P(up)) / P(up) when it lowers it.

Inference is the recognise-act cycle: each cycle collects the rules whose
premise facts are all in working memory, whose premise CF clears
``certainty_threshold`` and which have not fired on that bar (refraction), and
fires them in priority order (|strength|, then rule order); a conclusion
reached twice is merged by MYCIN's combination function. The cycle repeats
until nothing fires or ``maximum_inference_cycles`` is reached. The score is the
final CF of ``up`` (0 when nothing concluded).
"""

from __future__ import annotations

import numpy as np

from cycle.adapters_extra.symbolic_reasoner.predicates import Rule, mine_rules
from cycle.adapters_extra.symbolic_reasoner.reasoning import Engine


def combine(first: np.ndarray, second: np.ndarray) -> np.ndarray:
    """MYCIN's parallel combination of two certainty factors in [-1, 1]."""
    both_positive = (first >= 0) & (second >= 0)
    both_negative = (first < 0) & (second < 0)
    out = np.empty_like(first)
    out[both_positive] = first[both_positive] + second[both_positive] * (1 - first[both_positive])
    out[both_negative] = first[both_negative] + second[both_negative] * (1 + first[both_negative])
    mixed = ~(both_positive | both_negative)
    denominator = 1 - np.minimum(np.abs(first[mixed]), np.abs(second[mixed]))
    out[mixed] = (first[mixed] + second[mixed]) / np.maximum(denominator, 1e-12)
    return np.clip(out, -1.0, 1.0)


def mycin_certainty(rate: float, base: float) -> float:
    if rate >= base:
        return (rate - base) / max(1.0 - base, 1e-12)
    return (rate - base) / max(base, 1e-12)


class ForwardChainer(Engine):
    def fit(self, context, train_rows, target, direction):
        p = self.parameters
        truth = context.truth(train_rows)
        self.rules, self.base = mine_rules(context.bank, truth, direction[train_rows], atom_order=int(p["atom_order"]),
                                           minimum_fire_count=int(p["minimum_fire_count"]), rule_count=int(p["rule_count"]),
                                           pseudo_count=float(p["smoothing_pseudo_count"]))
        self.certainties = [mycin_certainty(rule.rate, self.base) for rule in self.rules]
        certainty, cycles = self._chain(context.degree(train_rows))
        self.summary = {"rule_count": len(self.rules), "training_mean_cycles": float(np.mean(cycles)) if cycles.size else 0.0,
                        "training_concluded_share": float(np.mean(certainty != 0)) if certainty.size else 0.0}
        context.log(f"expert system: {len(self.rules)} pattern rules, {2 * len(self.rules)} rules in the knowledge base, "
                    f"a conclusion on {self.summary['training_concluded_share']:.1%} of training bars")
        return None

    def _chain(self, degree: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        rows = degree.shape[0]
        threshold = float(self.parameters["certainty_threshold"])
        maximum_cycles = int(self.parameters["maximum_inference_cycles"])
        # working memory: fact -> (certainty, asserted)
        memory: dict[str, tuple[np.ndarray, np.ndarray]] = {}
        for index in range(degree.shape[1]):
            known = np.isfinite(degree[:, index])
            memory[f"atom_{index}"] = (np.where(known, 2.0 * np.nan_to_num(degree[:, index]) - 1.0, 0.0), known)
        knowledge = []   # (premise facts, conclusion fact, rule certainty)
        for position, rule in enumerate(self.rules):
            knowledge.append(([f"atom_{a}" for a in rule.atoms], f"pattern_{position}", 1.0))
        for position, certainty in enumerate(self.certainties):
            knowledge.append(([f"pattern_{position}"], "up", float(certainty)))
        refracted = [np.zeros(rows, dtype=bool) for _ in knowledge]
        cycles = np.zeros(rows, dtype=np.int64)
        for cycle in range(maximum_cycles):
            conflict_set = []
            for index, (premises, conclusion, certainty) in enumerate(knowledge):
                if not all(fact in memory for fact in premises):
                    continue
                premise = np.min(np.column_stack([memory[fact][0] for fact in premises]), axis=1)
                present = np.all(np.column_stack([memory[fact][1] for fact in premises]), axis=1)
                eligible = present & (premise >= threshold) & ~refracted[index]
                if eligible.any():
                    conflict_set.append((index, eligible, premise * certainty))
            if not conflict_set:
                break
            for index, eligible, contribution in conflict_set:
                conclusion = knowledge[index][1]
                current, asserted = memory.get(conclusion, (np.zeros(rows), np.zeros(rows, dtype=bool)))
                current = current.copy()
                asserted = asserted.copy()
                new = eligible & ~asserted
                again = eligible & asserted
                current[new] = contribution[new]
                current[again] = combine(current[again], contribution[again])
                asserted |= eligible
                memory[conclusion] = (current, asserted)
                refracted[index] |= eligible
                cycles[eligible] = cycle + 1
        up, asserted = memory.get("up", (np.zeros(rows), np.zeros(rows, dtype=bool)))
        return np.where(asserted, up, 0.0), cycles

    def score(self, context, rows):
        degree = context.degree(rows)
        certainty, _ = self._chain(degree)
        return certainty

    def state(self):
        return {"rules": [rule.to_dict() for rule in self.rules], "base": float(self.base),
                "certainties": [float(value) for value in self.certainties]}

    def load(self, state):
        self.rules = [Rule.from_dict(item) for item in state["rules"]]
        self.base = float(state["base"])
        self.certainties = [float(value) for value in state["certainties"]]
