"""``DecisionGraphAdapter``: graphical and decision-graph specs in the Model Cycle.

One adapter, five engines (``direction.fixed.variant``):

    bayesian_network           learned discrete Bayesian network, exact inference   (bayesian.py)
    bayesian_decision_network  the same plus decision and utility nodes             (bayesian.py)
    influence_diagram          specified structure, solved by node removal          (influence.py)
    dynamic_decision_network   hidden-regime HMM filter + backward induction        (dynamic.py)
    markov_random_field        pairwise MRF with hidden nodes, loopy BP             (markov_field.py)

Each engine scores a bar (the log-odds of its posterior, or EU(long) - EU(short)
for the decision variants); P(up) is the logistic curve of the score fitted on
the fold's VALIDATION rows only (registry probability
``logistic_curve_on_validation``). The three decision variants are also price
models: the posterior expected scaled move.

Structure learning uses pgmpy, which imports torch, and the Markov random
field trains with torch: the family's registry implementation is ``torch``.
Everything the engines fit reads training rows (``train_index``, or
``MarketView.fit_rows`` for the scaled move); a prediction at bar t reads the
feature rows <= t. The fitted state is one JSON file (``graph.json``).
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import numpy as np
from threadpoolctl import threadpool_limits

from cycle.adapters_extra.decision_graph.bayesian import BayesianDecisionNetwork, BayesianNetwork
from cycle.adapters_extra.decision_graph.dynamic import DynamicDecisionNetwork
from cycle.adapters_extra.decision_graph.influence import InfluenceDiagram
from cycle.adapters_extra.decision_graph.markov_field import MarkovRandomField
from cycle.bridges import calibration, persistence, training
from cycle.bridges.base import BridgeAdapter

ENGINES = {
    "bayesian_network": BayesianNetwork,
    "bayesian_decision_network": BayesianDecisionNetwork,
    "influence_diagram": InfluenceDiagram,
    "dynamic_decision_network": DynamicDecisionNetwork,
    "markov_random_field": MarkovRandomField,
}


@dataclass
class Context:
    features: np.ndarray
    view: object | None
    log: Callable[[str], None] = lambda message: None


def direction_of(targets: np.ndarray) -> np.ndarray:
    """1.0 up / 0.0 down / NaN from a label (0/1) or a signed price target."""
    targets = np.asarray(targets, dtype=np.float64)
    out = np.full(targets.shape, np.nan)
    finite = np.isfinite(targets)
    if finite.any() and np.all(np.isin(targets[finite], (0.0, 1.0))):
        out[finite] = targets[finite]
    else:
        out[finite & (targets > 0)] = 1.0
        out[finite & (targets < 0)] = 0.0
    return out


class DecisionGraphAdapter(BridgeAdapter):
    model_file = "graph.json"

    def __init__(self, key, entry, parameters, device, seed, task="classification") -> None:
        super().__init__(key, entry, parameters, device, seed, task)
        if self.variant not in ENGINES:
            raise ValueError(f"{key}: unknown decision-graph engine {self.variant!r}; known: {', '.join(ENGINES)}")
        self.engine = ENGINES[self.variant](self.parameters, self.seed, task)
        if task == "regression" and not self.engine.has_value:
            raise TypeError(f"{key}: the {self.variant} engine has no price model (its registry price is null)")
        self.step_unit = "epoch" if self.engine.iterative else "single_fit"
        self.curve: calibration.ValidationCurve | None = None

    def minimum_history(self) -> int:
        return int(self.engine.history)

    def _fit(self, features, labels, train_index, validation_index, timestamps, reporter):
        view = self.require_market()
        targets = np.asarray(labels, dtype=np.float64)
        direction = direction_of(targets)
        train_rows = train_index[np.isfinite(targets[train_index])]
        if train_rows.size == 0:
            raise ValueError(f"{self.key}: no training row has a known target")
        context = Context(features=features, view=view, log=lambda message: reporter.log(message))
        validation_rows = validation_index[np.isfinite(targets[validation_index])]

        def validate():
            if self.task == "regression":
                return training.score("regression", self.engine.value(context, validation_rows), targets[validation_rows])
            scores = self.engine.score(context, validation_rows)
            self.curve = calibration.ValidationCurve.fit(scores, direction[validation_rows])
            return training.score("classification", self.curve.apply(scores), direction[validation_rows])

        with threadpool_limits(1):       # one BLAS thread: a refit is bit-identical (k-means inside Baum-Welch)
            if self.engine.iterative:
                self.engine.begin(context, train_rows, targets, direction)
                summary = training.run_epochs(reporter, epoch_count=self.engine.epoch_count(), train_index=train_rows,
                                              train_epoch=self.engine.train_epoch, validate=lambda epoch: validate(),
                                              snapshot=lambda: (self.engine.snapshot(), self.curve), restore=self._restore,
                                              patience=int(self.parameters.get("patience", 5)), name=self.key)
            else:
                summary = training.single_fit(reporter, train_index=train_rows,
                                              fit=lambda: self.engine.fit(context, train_rows, targets, direction),
                                              validate=validate, name=self.key)
        self.best_iteration = summary["best_epoch"]
        self.fit_summary = {**self.engine.summary, "best_epoch": summary["best_epoch"],
                            "best_validation_loss": summary["best_validation_loss"]}
        if self.curve is not None:
            reporter.log(f"{self.key}: validation curve slope {self.curve.slope:.4f}, intercept "
                         f"{self.curve.intercept:.4f} on {self.curve.row_count} rows")

    def _restore(self, saved) -> None:
        engine_state, curve = saved
        self.engine.restore(engine_state)
        self.curve = curve

    def _context(self, features) -> Context:
        return Context(features=features, view=self.market)

    def _predict_probability(self, features, index):
        scores = self.engine.score(self._context(features), index)
        if self.curve is None:
            return np.full(index.shape, np.nan)
        return self.curve.apply(scores)

    def _predict_value(self, features, index):
        return self.engine.value(self._context(features), index)

    def _save_state(self, folder: Path) -> str:
        persistence.save_json(folder / self.model_file, {
            "variant": self.variant, "engine": self.engine.state(),
            "curve": self.curve.to_dict() if self.curve is not None else None,
        })
        return self.model_file

    def _load_state(self, folder: Path, metadata: dict) -> None:
        document = persistence.load_json(folder / self.model_file)
        self.engine = ENGINES[self.variant](self.parameters, self.seed, self.task)
        self.engine.load(document["engine"])
        self.step_unit = "epoch" if self.engine.iterative else "single_fit"
        self.curve = calibration.ValidationCurve.from_dict(document["curve"]) if document["curve"] is not None else None

    def _library_versions(self) -> dict[str, str]:
        return persistence.library_versions("numpy", "pgmpy", "hmmlearn", "torch", "scikit-learn")


__all__ = ["ENGINES", "DecisionGraphAdapter", "direction_of"]
