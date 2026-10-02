"""Rule-based system: an ordered decision list, first match wins.

The rule base is the config file's authored rules plus conjunctions of one or
two predicates mined on the training span (``predicates.mine_rules``), ordered
by how far their training up-rate sits from the base rate. A bar walks the
list top-down; the first rule whose every condition is true fires, and the
bar's score is the log-odds of that rule's smoothed training up-rate. No rule
firing leaves the default action: the training base rate. The fired rule's
position is kept (``fired_rule``) for audit.
"""

from __future__ import annotations

import numpy as np

from cycle.adapters_extra.symbolic_reasoner.predicates import Rule, fired, mine_rules
from cycle.adapters_extra.symbolic_reasoner.reasoning import Engine, logit


class DecisionList(Engine):
    def fit(self, context, train_rows, target, direction):
        truth = context.truth(train_rows)
        p = self.parameters
        self.rules, self.base = mine_rules(context.bank, truth, direction[train_rows], atom_order=int(p["atom_order"]),
                                           minimum_fire_count=int(p["minimum_fire_count"]), rule_count=int(p["rule_count"]),
                                           pseudo_count=float(p["smoothing_pseudo_count"]))
        first = self.fired_rule(truth)
        covered = float(np.mean(first >= 0)) if first.size else 0.0
        self.summary = {"rule_count": len(self.rules), "training_coverage": covered, "base_rate": self.base}
        context.log(f"decision list: {len(self.rules)} rules, first match covers {covered:.1%} of training bars")
        return None

    def fired_rule(self, truth: np.ndarray) -> np.ndarray:
        """Index of the first rule that fires on each row (-1: the default action)."""
        out = np.full(truth.shape[0], -1, dtype=np.int64)
        open_rows = np.ones(truth.shape[0], dtype=bool)
        for position, rule in enumerate(self.rules):
            hit = open_rows & (fired(truth, rule.atoms) == 1.0)
            out[hit] = position
            open_rows &= ~hit
        return out

    def score(self, context, rows):
        truth = context.truth(rows)
        first = self.fired_rule(truth)
        rates = np.array([rule.rate for rule in self.rules] + [self.base], dtype=np.float64)
        return logit(rates[np.where(first >= 0, first, len(self.rules))])

    def state(self):
        return {"rules": [rule.to_dict() for rule in self.rules], "base": float(self.base)}

    def load(self, state):
        self.rules = [Rule.from_dict(item) for item in state["rules"]]
        self.base = float(state["base"])
