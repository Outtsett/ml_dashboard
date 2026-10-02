"""Constraint satisfaction: a weighted (soft) CSP over the bar's side, with hard constraints.

Per bar there is one decision variable, ``side`` in {long, short}. Constraints
come from the training span:

- **hard constraints**: every mined or authored rule whose smoothed training
  up-rate is at least ``hard_constraint_confidence`` away from even odds
  (rate >= c or rate <= 1 - c) and that fired at least ``minimum_fire_count``
  times: "if the rule fires, side must be its conclusion". Feasibility is
  decided by python-constraint (arc consistency over the domain, then
  backtracking); two firing hard constraints that disagree leave no solution,
  and the bar falls back to the soft constraints alone (counted in the log);
- **soft constraints**: every directional predicate says "side = my
  suggestion" with weight log(r / (1 - r)) of its training reliability r
  (predicates no better than even odds are dropped).

The cost of a side is the weight of the soft constraints it violates, plus
``infeasible_side_penalty`` when the hard constraints exclude it. The score
is cost(short) - cost(long): the soft-CSP optimum's margin. Solutions are
memoised by the bar's pattern of firing hard constraints.
"""

from __future__ import annotations

from functools import lru_cache

import numpy as np

from cycle.adapters_extra.symbolic_reasoner.predicates import Rule, fired, mine_rules, smoothed_rate
from cycle.adapters_extra.symbolic_reasoner.reasoning import Engine, to_list


@lru_cache(maxsize=4096)
def feasible_sides(required: tuple[str, ...]) -> tuple[str, ...]:
    """The sides python-constraint finds consistent with every firing hard constraint's requirement."""
    import constraint

    problem = constraint.Problem(constraint.BacktrackingSolver())
    problem.addVariable("side", ["long", "short"])
    for needed in required:
        problem.addConstraint(lambda side, needed=needed: side == needed, ["side"])
    return tuple(sorted(solution["side"] for solution in problem.getSolutions()))


class SoftConstraintProblem(Engine):
    def fit(self, context, train_rows, target, direction):
        p = self.parameters
        pseudo = float(p["smoothing_pseudo_count"])
        truth = context.truth(train_rows)
        y = direction[train_rows]
        rules, base = mine_rules(context.bank, truth, y, atom_order=int(p["atom_order"]),
                                 minimum_fire_count=int(p["minimum_fire_count"]), rule_count=int(p["rule_count"]),
                                 pseudo_count=pseudo)
        confidence = float(p["hard_constraint_confidence"])
        self.hard = [rule for rule in rules if rule.support >= int(p["minimum_fire_count"])
                     and (rule.rate >= confidence or rule.rate <= 1.0 - confidence)]
        signs = context.bank.signs
        known = np.isfinite(y)
        weights = np.zeros(truth.shape[1])
        for index in range(truth.shape[1]):
            if signs[index] == 0:
                continue
            hit = known & (truth[:, index] == 1.0)
            fires = float(hit.sum())
            if fires < 1:
                continue
            correct = y[hit] if signs[index] > 0 else 1.0 - y[hit]
            reliability = float(smoothed_rate(correct.sum(), fires, 0.5, pseudo))
            weights[index] = max(0.0, float(np.log(reliability / (1.0 - reliability))))
        self.soft_weights = weights
        self.signs = signs.copy()
        self.margin(context, train_rows)          # counts the training bars whose hard constraints contradict
        self.summary = {"hard_constraint_count": len(self.hard), "soft_constraint_count": int((weights > 0).sum()),
                        "base_rate": base}
        context.log(f"constraint satisfaction: {len(self.hard)} hard and {int((weights > 0).sum())} soft constraints; "
                    f"{self._conflicts} training bars had contradictory hard constraints")
        return None

    def margin(self, context, rows) -> np.ndarray:
        rows = np.asarray(rows, dtype=np.int64)
        truth = context.truth(rows)
        true = np.nan_to_num(truth, nan=0.0) == 1.0
        long_violations = (true & (self.signs < 0)[None, :]) @ self.soft_weights
        short_violations = (true & (self.signs > 0)[None, :]) @ self.soft_weights
        penalty = float(self.parameters["infeasible_side_penalty"])
        firing = np.column_stack([fired(truth, rule.atoms) == 1.0 for rule in self.hard]) if self.hard \
            else np.zeros((rows.size, 0), dtype=bool)
        needs = np.array(["long" if rule.conclusion == "up" else "short" for rule in self.hard])
        cost_long = long_violations.astype(np.float64)
        cost_short = short_violations.astype(np.float64)
        self._conflicts = 0
        if self.hard:
            patterns, inverse = np.unique(firing, axis=0, return_inverse=True)
            inverse = np.asarray(inverse).reshape(-1)
            for code, pattern in enumerate(patterns):
                if not pattern.any():
                    continue
                sides = feasible_sides(tuple(sorted(set(needs[pattern]))))
                members = inverse == code
                if not sides:                  # contradictory hard constraints: no solution, soft only
                    self._conflicts += int(members.sum())
                    continue
                if "long" not in sides:
                    cost_long[members] += penalty
                if "short" not in sides:
                    cost_short[members] += penalty
        return cost_short - cost_long

    def score(self, context, rows):
        return self.margin(context, rows)

    def state(self):
        return {"hard": [rule.to_dict() for rule in self.hard], "softWeights": to_list(self.soft_weights),
                "signs": to_list(self.signs)}

    def load(self, state):
        self.hard = [Rule.from_dict(item) for item in state["hard"]]
        self.soft_weights = np.asarray(state["softWeights"], dtype=np.float64)
        self.signs = np.asarray(state["signs"], dtype=np.float64)
