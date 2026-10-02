"""Bayesian network and Bayesian decision network.

Both learn a discrete Bayesian network on the training span: the
``input_feature_count`` most informative feature columns, each cut into
``bin_count`` training-quantile bins, plus an outcome node; the structure by
pgmpy (``structure_search``: hill climbing on BIC with ``maximum_parents``, the
tree-augmented naive Bayes tree, or naive Bayes), the conditional tables with
the BDeu prior (``equivalent_sample_size``). Inference is exact variable
elimination (``factors.variable_elimination``) on the bar's evidence (its own
bin codes; a missing feature is an unobserved node and is summed out), cached
per distinct evidence tuple.

- ``bayesian_network``: the outcome node is the direction (up / down); the
  score is the log-odds of P(up | evidence).
- ``bayesian_decision_network``: the outcome node is ``outcome_bin_count`` bins
  of the scaled move, and a decision node {short, flat, long} with a utility
  node (``graphs.OutcomeUtility``) completes the network; the score is
  EU(long) - EU(short), the price model the posterior expected move.
"""

from __future__ import annotations

import numpy as np

from cycle.adapters_extra.decision_graph.factors import Factor, variable_elimination
from cycle.adapters_extra.decision_graph.graphs import (
    Engine,
    OutcomeUtility,
    decision_shares,
    scaled_cost,
)
from cycle.adapters_extra.decision_graph.structure import (
    Discretizer,
    bdeu_tables,
    learn_structure,
    parents_of,
    select_columns,
)

OUTCOME = "outcome"


class DiscreteNetwork(Engine):
    decision = False

    def fit(self, context, train_rows, target, direction):
        p = self.parameters
        self._posterior_cache = {}
        features, view = context.features, context.view
        bin_count = int(p["bin_count"])
        columns = select_columns(features, train_rows, direction, int(p["input_feature_count"]), bin_count)
        self.discretizer = Discretizer.fit(features, train_rows, columns, bin_count)
        evidence = self.discretizer.codes(features, train_rows)
        if self.decision:
            moves = np.asarray(view.price_targets, dtype=np.float64)[train_rows]
            self.utility = OutcomeUtility.fit(moves, int(p["outcome_bin_count"]), scaled_cost(view, train_rows),
                                              float(p["risk_aversion"]))
            outcome = self.utility.codes(moves)
            outcome_states = self.utility.count
        else:
            self.utility = None
            outcome = np.where(np.isfinite(direction[train_rows]), direction[train_rows], -1).astype(np.int64)
            outcome_states = 2
        complete = np.all(evidence >= 0, axis=1) & (outcome >= 0)
        codes = np.column_stack([evidence[complete], outcome[complete]])
        self.names = [f"feature_{position}" for position in range(len(columns))] + [OUTCOME]
        self.cardinalities = self.discretizer.cardinalities + [outcome_states]
        edges = learn_structure(codes, self.names, self.cardinalities, p["structure_search"], int(p["maximum_parents"]),
                                OUTCOME)
        self.parents = parents_of(edges, self.names)
        self.tables = bdeu_tables(codes, self.names, self.cardinalities, self.parents, float(p["equivalent_sample_size"]))
        blanket = sorted({name for name, parents in self.parents.items() if OUTCOME in parents}
                         | set(self.parents[OUTCOME]))
        feature_names = list(view.feature_names)
        self.summary = {"nodes": {name: (feature_names[c] if c < len(feature_names) else str(c))
                                  for name, c in zip(self.names, columns)},
                        "edges": [list(edge) for edge in edges], "outcome_markov_blanket": blanket,
                        "complete_training_rows": int(complete.sum())}
        if self.decision:
            self.summary["training_decisions"] = decision_shares(
                self.utility.expected_utility(self.posterior(features, train_rows)))
        context.log(f"{'decision network' if self.decision else 'Bayesian network'}: {len(self.names)} nodes, "
                    f"{len(edges)} edges ({p['structure_search']}), the outcome's Markov blanket has {len(blanket)} nodes")
        return None

    def factors(self) -> list[Factor]:
        return [Factor(tuple(self.parents[name]) + (name,), self.tables[name]) for name in self.names]

    def posterior(self, features, rows) -> np.ndarray:
        evidence = self.discretizer.codes(features, rows)
        factors = self.factors()
        feature_nodes = self.names[:-1]

        def answer(row):
            observed = {name: int(code) for name, code in zip(feature_nodes, row) if code >= 0}
            return variable_elimination(factors, OUTCOME, observed)

        return self.cached_posteriors(evidence, answer)

    def score(self, context, rows):
        posterior = self.posterior(context.features, rows)
        if not self.decision:
            probability = np.clip(posterior[:, 1], 1e-9, 1 - 1e-9)
            return np.log(probability / (1 - probability))
        utility = self.utility.expected_utility(posterior)
        return utility[:, 2] - utility[:, 0]

    def value(self, context, rows):
        return self.utility.expected_move(self.posterior(context.features, rows))

    def state(self):
        return {"discretizer": self.discretizer.to_dict(), "names": self.names, "cardinalities": self.cardinalities,
                "parents": self.parents, "tables": {name: table.tolist() for name, table in self.tables.items()},
                "utility": self.utility.to_dict() if self.utility is not None else None}

    def load(self, state):
        self.discretizer = Discretizer.from_dict(state["discretizer"])
        self.names = list(state["names"])
        self.cardinalities = [int(c) for c in state["cardinalities"]]
        self.parents = {name: list(parents) for name, parents in state["parents"].items()}
        self.tables = {name: np.asarray(table, dtype=np.float64) for name, table in state["tables"].items()}
        self.utility = OutcomeUtility.from_dict(state["utility"]) if state["utility"] is not None else None
        self._posterior_cache = {}


class BayesianNetwork(DiscreteNetwork):
    decision = False


class BayesianDecisionNetwork(DiscreteNetwork):
    decision = True
    has_value = True


__all__ = ["BayesianDecisionNetwork", "BayesianNetwork", "DiscreteNetwork"]
