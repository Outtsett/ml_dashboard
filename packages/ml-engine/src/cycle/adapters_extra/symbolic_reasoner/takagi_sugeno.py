"""Fuzzy decision model: a first-order Takagi-Sugeno system trained ANFIS-style.

Inputs are the ``input_feature_count`` columns with the most training mutual
information with the direction. Each input has ``membership_function_count``
Gaussian terms, centres at evenly spaced training quantiles, widths from the
spacing. Rules (Wang-Mendel antecedents): the ``rule_count`` term combinations
that are the strongest match for the most training bars. A rule's firing is
the product of its memberships (computed in logs), normalised over the rules;
its consequent is linear in the inputs, f_r = a_r . x + b_r, and the output is
the firing-weighted sum y = sum_r w_r f_r.

Hybrid learning per epoch (Jang's ANFIS): the consequents are the ridge
least-squares solution on the training span (``regularization_strength``)
given the current memberships, then one gradient step of
``learning_rate`` on the membership centres and widths down the mean squared
error. The training target is +1 / -1 for the direction (task
``classification``) or the scaled move, clipped at its training 1st / 99th
percentiles (task ``regression``). Early stopping reads the validation rows.
The score (and the price model's prediction) is y.
"""

from __future__ import annotations

import numpy as np

from cycle.adapters_extra.symbolic_reasoner.mamdani import mutual_information_columns
from cycle.adapters_extra.symbolic_reasoner.reasoning import Engine

MINIMUM_WIDTH = 1e-3


class TakagiSugeno(Engine):
    uses_predicates = False
    iterative = True
    has_value = True

    def begin(self, context, train_rows, target, direction):
        p = self.parameters
        features = context.features
        self.columns = mutual_information_columns(features, train_rows, direction, int(p["input_feature_count"]))
        x = np.asarray(features[np.ix_(train_rows, self.columns)], dtype=np.float64)
        if self.task == "regression":
            raw = np.asarray(target[train_rows], dtype=np.float64)
            finite = raw[np.isfinite(raw)]
            low, high = (np.quantile(finite, (0.01, 0.99)) if finite.size else (-1.0, 1.0))
            t = np.clip(raw, low, high)
        else:
            t = 2.0 * np.asarray(direction[train_rows], dtype=np.float64) - 1.0
        keep = np.all(np.isfinite(x), axis=1) & np.isfinite(t)
        self._x, self._t = x[keep], t[keep]
        terms = int(p["membership_function_count"])
        self.centres = np.zeros((len(self.columns), terms))
        self.widths = np.zeros((len(self.columns), terms))
        for position in range(len(self.columns)):
            centres = np.quantile(self._x[:, position], np.linspace(0.1, 0.9, terms))
            spacing = max(float(np.median(np.diff(centres))) if terms > 1 else float(np.std(self._x[:, position])), 1e-2)
            self.centres[position] = centres
            self.widths[position] = spacing
        strongest = np.stack([np.argmin(np.abs(self._x[:, [i]] - self.centres[i][None, :]), axis=1)
                              for i in range(len(self.columns))], axis=1)
        keys, counts = np.unique(strongest, axis=0, return_counts=True)
        order = np.lexsort((np.arange(keys.shape[0]), -counts))[: int(p["rule_count"])]
        self.antecedents = keys[order].astype(np.int64)                       # (rules, inputs) term indices
        self.consequents = np.zeros((self.antecedents.shape[0], len(self.columns) + 1))
        self._solve_consequents()
        context.log(f"fuzzy decision model: {len(self.columns)} inputs x {terms} Gaussian terms, "
                    f"{self.antecedents.shape[0]} Takagi-Sugeno rules on {self._x.shape[0]} training bars")

    def _firing(self, x: np.ndarray) -> np.ndarray:
        """(rows, rules) normalised firing strengths (softmax of the summed log memberships)."""
        log_firing = np.zeros((x.shape[0], self.antecedents.shape[0]))
        for i in range(len(self.columns)):
            centre = self.centres[i][self.antecedents[:, i]]
            width = self.widths[i][self.antecedents[:, i]]
            log_firing -= (x[:, [i]] - centre[None, :]) ** 2 / (2.0 * width[None, :] ** 2)
        log_firing -= log_firing.max(axis=1, keepdims=True)
        weights = np.exp(log_firing)
        return weights / weights.sum(axis=1, keepdims=True)

    def _design(self, x, firing) -> np.ndarray:
        augmented = np.column_stack([x, np.ones(x.shape[0])])
        return (firing[:, :, None] * augmented[:, None, :]).reshape(x.shape[0], -1)

    def _solve_consequents(self) -> None:
        if self._x.shape[0] == 0:
            return
        design = self._design(self._x, self._firing(self._x))
        ridge = float(self.parameters["regularization_strength"])
        gram = design.T @ design + ridge * self._x.shape[0] * np.eye(design.shape[1])
        solution = np.linalg.solve(gram, design.T @ self._t)
        self.consequents = solution.reshape(self.antecedents.shape[0], len(self.columns) + 1)

    def _output(self, x: np.ndarray) -> np.ndarray:
        firing = self._firing(x)
        rule_outputs = x @ self.consequents[:, :-1].T + self.consequents[:, -1][None, :]
        return (firing * rule_outputs).sum(axis=1)

    def train_epoch(self, epoch, report_batch):
        self._solve_consequents()
        x, t = self._x, self._t
        firing = self._firing(x)
        rule_outputs = x @ self.consequents[:, :-1].T + self.consequents[:, -1][None, :]
        y = (firing * rule_outputs).sum(axis=1)
        error = y - t
        # d y / d log w_q = w_q (f_q - y); d log w_q / d c = (x - c) / s^2 ; d log w_q / d s = (x - c)^2 / s^3
        sensitivity = firing * (rule_outputs - y[:, None]) * (2.0 * error)[:, None]      # dE/dlogw per row, rule
        rate = float(self.parameters["learning_rate"])
        for i in range(len(self.columns)):
            terms = self.antecedents[:, i]
            centre = self.centres[i][terms]
            width = self.widths[i][terms]
            delta = x[:, [i]] - centre[None, :]
            gradient_centre_rule = (sensitivity * delta / width[None, :] ** 2).mean(axis=0)
            gradient_width_rule = (sensitivity * delta ** 2 / width[None, :] ** 3).mean(axis=0)
            self.centres[i] -= rate * np.bincount(terms, weights=gradient_centre_rule, minlength=self.centres.shape[1])
            self.widths[i] = np.maximum(MINIMUM_WIDTH, self.widths[i] - rate * np.bincount(
                terms, weights=gradient_width_rule, minlength=self.widths.shape[1]))
        self._solve_consequents()
        loss = float(np.mean((self._output(x) - t) ** 2)) if x.shape[0] else None
        report_batch(1, 1, 0, max(x.shape[0] - 1, 0), loss)
        return loss

    def snapshot(self):
        return self.centres.copy(), self.widths.copy(), self.consequents.copy()

    def restore(self, saved):
        self.centres, self.widths, self.consequents = (value.copy() for value in saved)

    def _predict(self, features, rows) -> np.ndarray:
        x = np.asarray(features[np.ix_(np.asarray(rows, dtype=np.int64), self.columns)], dtype=np.float64)
        out = np.full(x.shape[0], np.nan)
        finite = np.all(np.isfinite(x), axis=1)
        if finite.any():
            out[finite] = self._output(x[finite])
        return out

    def score(self, context, rows):
        return self._predict(context.features, rows)

    def value(self, context, rows):
        return self._predict(context.features, rows)

    def state(self):
        return {"columns": [int(c) for c in self.columns], "centres": self.centres.tolist(), "widths": self.widths.tolist(),
                "antecedents": self.antecedents.tolist(), "consequents": self.consequents.tolist()}

    def load(self, state):
        self.columns = [int(c) for c in state["columns"]]
        self.centres = np.asarray(state["centres"], dtype=np.float64)
        self.widths = np.asarray(state["widths"], dtype=np.float64)
        self.antecedents = np.asarray(state["antecedents"], dtype=np.int64)
        self.consequents = np.asarray(state["consequents"], dtype=np.float64)

