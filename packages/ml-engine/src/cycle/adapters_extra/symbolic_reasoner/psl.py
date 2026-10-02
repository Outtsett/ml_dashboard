"""Probabilistic Soft Logic: a hinge-loss Markov random field with exact MAP.

Soft atoms are the grounded predicates' degrees in [0, 1]. Each rule r (mined
and authored conjunctions, ``mine_rules``) is a Lukasiewicz implication
``body_r -> Up`` (or ``-> Down``, with Down = 1 - Up by mutual exclusion) whose
body truth is max(0, sum of its degrees - (k - 1)). Its distance to
satisfaction is max(0, body_r - y) for an Up rule and max(0, y - (1 - body_r))
for a Down rule; two prior rules pull y toward 1 and toward 0. The energy is

    E(y) = sum_r w_r d_r(y)^p + w_up (1 - y)^p + w_down y^p,     y in [0, 1],

with p = ``hinge_exponent`` (1 or 2). For one bar the only free variable is
the truth of Up, so MAP inference is exact: for p = 1 the energy is convex
piecewise linear and its minimum sits at a breakpoint (0, 1, the bodies and
their complements; the middle of a flat minimum is taken); for p = 2 it is
convex piecewise quadratic and the root of its derivative is found segment by
segment in closed form.

Weight learning is PSL's structured perceptron on the training span: each
epoch moves w_r by ``learning_rate`` times the mean of (d_r at the MAP state
- d_r at the observed outcome) over the training bars, minus ``weight_decay``
w_r, floored at zero. Early stopping reads the calibrated log loss on the
validation rows. The score is the MAP truth of Up.
"""

from __future__ import annotations

import numpy as np

from cycle.adapters_extra.symbolic_reasoner.predicates import Rule, mine_rules
from cycle.adapters_extra.symbolic_reasoner.reasoning import Engine, logit, to_list


def bodies(degree: np.ndarray, rules: list[Rule]) -> np.ndarray:
    """(rows, rules) Lukasiewicz conjunction of each rule's degrees (unknown degree = 0)."""
    degree = np.nan_to_num(degree, nan=0.0)
    if not rules:
        return np.zeros((degree.shape[0], 0))
    return np.column_stack([np.maximum(0.0, degree[:, list(rule.atoms)].sum(axis=1) - (len(rule.atoms) - 1))
                            for rule in rules])


def distances(y: np.ndarray, body: np.ndarray, up: np.ndarray) -> np.ndarray:
    """(rows, rules + 2) distances to satisfaction at truth y (rows,): the rules, then the two priors."""
    y = np.asarray(y, dtype=np.float64)[:, None]
    rule_distance = np.where(up[None, :], np.maximum(0.0, body - y), np.maximum(0.0, y - (1.0 - body)))
    return np.column_stack([rule_distance, 1.0 - y[:, 0], y[:, 0]])


def map_truth(body: np.ndarray, up: np.ndarray, weights: np.ndarray, exponent: int) -> np.ndarray:
    """Exact MAP truth of Up for each row (weights: rules then the Up and Down priors)."""
    rows = body.shape[0]
    rule_weights = weights[:-2]
    breakpoints = np.column_stack([np.zeros(rows), np.ones(rows), np.where(up[None, :], body, 1.0 - body)])
    breakpoints = np.clip(breakpoints, 0.0, 1.0)
    if exponent == 1:
        energy = np.stack([(distances(breakpoints[:, k], body, up) * weights[None, :]).sum(axis=1)
                           for k in range(breakpoints.shape[1])], axis=1)
        lowest = energy.min(axis=1, keepdims=True)
        tied = np.isclose(energy, lowest, rtol=0.0, atol=1e-12)
        low = np.where(tied, breakpoints, np.inf).min(axis=1)
        high = np.where(tied, breakpoints, -np.inf).max(axis=1)
        return 0.5 * (low + high)
    # exponent 2: the derivative 2 [ -sum_up w (b - y)+ + sum_down w (y - c)+ - w_up (1 - y) + w_down y ] is increasing
    centre = np.where(up[None, :], body, 1.0 - body)                 # where each hinge switches on or off
    ordered = np.sort(breakpoints, axis=1)

    def slope_and_offset(y):
        y = y[:, None]
        active_up = up[None, :] & (body > y)
        active_down = ~up[None, :] & (y > centre)
        slope = (rule_weights * (active_up | active_down)).sum(axis=1) + weights[-2] + weights[-1]
        offset = (-(rule_weights * body * active_up).sum(axis=1) - (rule_weights * centre * active_down).sum(axis=1)
                  - weights[-2])
        return slope, offset                                          # derivative / 2 = slope * y + offset

    out = np.empty(rows)
    solved = np.zeros(rows, dtype=bool)
    slope, offset = slope_and_offset(np.zeros(rows))
    at_zero = offset >= 0                                             # derivative at 0 already non-negative
    out[at_zero] = 0.0
    solved |= at_zero
    for k in range(ordered.shape[1] - 1):
        left, right = ordered[:, k], ordered[:, k + 1]
        middle = 0.5 * (left + right)
        slope, offset = slope_and_offset(middle)
        with np.errstate(invalid="ignore", divide="ignore"):
            root = np.where(slope > 0, -offset / slope, np.nan)
        inside = ~solved & (right > left) & np.isfinite(root) & (root >= left - 1e-12) & (root <= right + 1e-12)
        out[inside] = np.clip(root[inside], left[inside], right[inside])
        solved |= inside
    out[~solved] = 1.0
    return out


class SoftLogic(Engine):
    iterative = True

    def begin(self, context, train_rows, target, direction):
        p = self.parameters
        truth = context.truth(train_rows)
        self.rules, self.base = mine_rules(context.bank, truth, direction[train_rows], atom_order=int(p["atom_order"]),
                                           minimum_fire_count=int(p["minimum_fire_count"]), rule_count=int(p["rule_count"]),
                                           pseudo_count=float(p["smoothing_pseudo_count"]))
        y = direction[train_rows]
        known = np.isfinite(y)
        self._body = bodies(context.degree(train_rows)[known], self.rules)
        self._observed = y[known]
        self.up = np.array([rule.conclusion == "up" for rule in self.rules], dtype=bool)
        self.weights = np.ones(len(self.rules) + 2)
        self.weights[-2] = self.base          # the priors start at the base-rate odds
        self.weights[-1] = 1.0 - self.base
        self._train_count = int(self._observed.size)
        context.log(f"probabilistic soft logic: {len(self.rules)} weighted rules, hinge exponent {int(p['hinge_exponent'])}")

    def train_epoch(self, epoch, report_batch):
        p = self.parameters
        exponent = int(p["hinge_exponent"])
        state = map_truth(self._body, self.up, self.weights, exponent)
        at_map = distances(state, self._body, self.up) ** exponent
        at_truth = distances(self._observed, self._body, self.up) ** exponent
        gradient = at_truth.mean(axis=0) - at_map.mean(axis=0)
        self.weights = np.maximum(0.0, self.weights - float(p["learning_rate"]) * gradient
                                  - float(p["learning_rate"]) * float(p["weight_decay"]) * self.weights)
        state = map_truth(self._body, self.up, self.weights, exponent)
        loss = float(np.mean((state - self._observed) ** 2))
        report_batch(1, 1, 0, max(self._train_count - 1, 0), loss)
        return loss

    def snapshot(self):
        return self.weights.copy()

    def restore(self, saved):
        self.weights = saved.copy()

    def truth_of_up(self, context, rows) -> np.ndarray:
        degree = context.degree(rows)
        return map_truth(bodies(degree, self.rules), self.up, self.weights, int(self.parameters["hinge_exponent"]))

    def score(self, context, rows):
        return logit(self.truth_of_up(context, rows))

    def state(self):
        return {"rules": [rule.to_dict() for rule in self.rules], "base": float(self.base),
                "weights": to_list(self.weights)}

    def load(self, state):
        self.rules = [Rule.from_dict(item) for item in state["rules"]]
        self.base = float(state["base"])
        self.weights = np.asarray(state["weights"], dtype=np.float64)
        self.up = np.array([rule.conclusion == "up" for rule in self.rules], dtype=bool)
