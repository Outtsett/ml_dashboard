"""Influence diagram: a knowledge-structured decision problem solved by node removal.

The structure is specified, not learned (the influence-diagram way):

- **chance nodes** (market conditions): one per feature modality
  (``cycle.bridges.groups``: price geometry, volume and order flow,
  volatility, news sentiment, other), each the first principal component of
  that modality's columns on the training span, cut into ``bin_count``
  training-quantile bins; the ``condition_group_count`` conditions with the most
  mutual information with the training direction are kept. They are roots
  with their own priors;
- an **outcome** chance node (``outcome_bin_count`` bins of the scaled move)
  whose parents are all the conditions (BDeu tables, ``equivalent_sample_size``);
- a **decision** node {short, flat, long} with informational arcs from every
  condition, and a **utility** node U(position, outcome) (``graphs.OutcomeUtility``).

Solution by node removal at fit: the outcome node is removed by expectation
(sum over outcomes of P(o | conditions) U(d, o)), then the decision node by
maximisation, giving the optimal policy table over every condition
configuration (logged). A bar with every condition observed reads its row of
the expected-utility table; a missing condition is removed by summing it out
against its prior (variable elimination). Score = EU(long) - EU(short); the
price model is the expected move.
"""

from __future__ import annotations

import itertools

import numpy as np

from cycle.adapters_extra.decision_graph.factors import Factor, variable_elimination
from cycle.adapters_extra.decision_graph.graphs import (
    Engine,
    OutcomeUtility,
    decision_shares,
    scaled_cost,
)
from cycle.adapters_extra.decision_graph.structure import bdeu_tables, mutual_information
from cycle.bridges import groups
from cycle.bridges.binning import QuantileBins

OUTCOME = "outcome"


class InfluenceDiagram(Engine):
    has_value = True

    def fit(self, context, train_rows, target, direction):
        p = self.parameters
        self._posterior_cache = {}
        features, view = context.features, context.view
        bin_count = int(p["bin_count"])
        y = np.asarray(direction, dtype=np.float64)[train_rows]
        candidates = []
        for modality, columns in groups.modality_groups(list(view.feature_names)[: features.shape[1]]).items():
            matrix = np.asarray(features[np.ix_(train_rows, columns)], dtype=np.float64)
            finite = np.all(np.isfinite(matrix), axis=1)
            if finite.sum() < 30:
                continue
            mean = matrix[finite].mean(axis=0)
            spread = matrix[finite].std(axis=0)
            spread[spread <= 1e-12] = 1.0
            standard = (matrix[finite] - mean) / spread
            _, _, components = np.linalg.svd(standard, full_matrices=False)
            vector = components[0]
            projection = standard @ vector
            known = np.isfinite(y[finite])
            if known.sum() > 2 and np.std(projection[known]) > 0 and np.corrcoef(projection[known], y[finite][known])[0, 1] < 0:
                vector = -vector
                projection = -projection
            bins = QuantileBins.fit(projection, bin_count)
            if bins.bin_count < 2:
                continue
            codes = np.full(train_rows.size, -1, dtype=np.int64)
            codes[finite] = bins.assign(projection)
            candidates.append((-mutual_information(codes, y, bins.bin_count), modality,
                               {"modality": modality, "columns": [int(c) for c in columns], "mean": mean.tolist(),
                                "spread": spread.tolist(), "vector": vector.tolist(), "bins": bins.to_dict()}))
        candidates.sort(key=lambda item: (item[0], item[1]))
        self.conditions = [item[2] for item in candidates[: int(p["condition_group_count"])]]
        moves = np.asarray(view.price_targets, dtype=np.float64)[train_rows]
        self.utility = OutcomeUtility.fit(moves, int(p["outcome_bin_count"]), scaled_cost(view, train_rows),
                                          float(p["risk_aversion"]))
        evidence = self.condition_codes(features, train_rows)
        outcome = self.utility.codes(moves)
        complete = np.all(evidence >= 0, axis=1) & (outcome >= 0)
        self.names = [f"condition_{k}" for k in range(len(self.conditions))] + [OUTCOME]
        self.cardinalities = [QuantileBins.from_dict(c["bins"]).bin_count for c in self.conditions] + [self.utility.count]
        self.parents = {name: [] for name in self.names[:-1]}
        self.parents[OUTCOME] = self.names[:-1]
        self.tables = bdeu_tables(np.column_stack([evidence[complete], outcome[complete]]), self.names, self.cardinalities,
                                  self.parents, float(p["equivalent_sample_size"]))
        # node removal: remove the outcome by expectation, then the decision by maximisation
        expected = self.utility.expected_utility(self.tables[OUTCOME].reshape(-1, self.utility.count))
        self.policy = np.argmax(expected, axis=1).reshape(self.cardinalities[:-1] or [1])
        labels = ("short", "flat", "long")
        policy_lines = []
        for configuration in itertools.product(*[range(c) for c in self.cardinalities[:-1]]):
            policy_lines.append("".join(str(v) for v in configuration) + "=" + labels[int(self.policy[configuration])])
        self.summary = {"conditions": [c["modality"] for c in self.conditions], "policy": policy_lines,
                        "training_decisions": decision_shares(self.utility.expected_utility(self.posterior(features, train_rows)))}
        context.log(f"influence diagram: conditions {', '.join(self.summary['conditions'])}; optimal policy "
                    f"{' '.join(policy_lines[:27])}{' ...' if len(policy_lines) > 27 else ''}")
        return None

    def condition_codes(self, features, rows) -> np.ndarray:
        rows = np.asarray(rows, dtype=np.int64)
        out = np.full((rows.size, len(self.conditions)), -1, dtype=np.int64)
        for k, condition in enumerate(self.conditions):
            matrix = np.asarray(features[np.ix_(rows, condition["columns"])], dtype=np.float64)
            finite = np.all(np.isfinite(matrix), axis=1)
            projection = ((matrix[finite] - np.asarray(condition["mean"])) / np.asarray(condition["spread"])) \
                @ np.asarray(condition["vector"])
            out[finite, k] = QuantileBins.from_dict(condition["bins"]).assign(projection)
        return out

    def posterior(self, features, rows) -> np.ndarray:
        evidence = self.condition_codes(features, rows)
        factors = [Factor(tuple(self.parents[name]) + (name,), self.tables[name]) for name in self.names]

        def answer(row):
            observed = {name: int(code) for name, code in zip(self.names[:-1], row) if code >= 0}
            return variable_elimination(factors, OUTCOME, observed)

        return self.cached_posteriors(evidence, answer)

    def score(self, context, rows):
        utility = self.utility.expected_utility(self.posterior(context.features, rows))
        return utility[:, 2] - utility[:, 0]

    def value(self, context, rows):
        return self.utility.expected_move(self.posterior(context.features, rows))

    def state(self):
        return {"conditions": self.conditions, "names": self.names, "cardinalities": self.cardinalities,
                "parents": self.parents, "tables": {name: table.tolist() for name, table in self.tables.items()},
                "utility": self.utility.to_dict(), "policy": np.asarray(self.policy).tolist()}

    def load(self, state):
        self.conditions = list(state["conditions"])
        self.names = list(state["names"])
        self.cardinalities = [int(c) for c in state["cardinalities"]]
        self.parents = {name: list(parents) for name, parents in state["parents"].items()}
        self.tables = {name: np.asarray(table, dtype=np.float64) for name, table in state["tables"].items()}
        self.utility = OutcomeUtility.from_dict(state["utility"])
        self.policy = np.asarray(state["policy"], dtype=np.int64)
        self._posterior_cache = {}


__all__ = ["InfluenceDiagram"]
