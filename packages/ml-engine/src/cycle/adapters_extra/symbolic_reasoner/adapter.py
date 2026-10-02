"""``SymbolicReasonerAdapter``: the symbolic-reasoning and decision-framework specs in the Model Cycle.

One adapter, eleven engines (``direction.fixed.variant``):

    first_match       rule-based system: ordered decision list    (decision_list.py)
    forward_chain     expert system: MYCIN forward chaining        (certainty.py)
    pln               probabilistic logic network                  (pln.py)
    psl               probabilistic soft logic, exact MAP          (psl.py)
    mamdani           fuzzy logic model, Mamdani + Wang-Mendel     (mamdani.py)
    resolution        first-order logic, resolution refutation     (resolution.py)
    sld               logic programming, SLD via miniKanren        (logic_program.py)
    soft_csp          constraint satisfaction, python-constraint   (soft_csp.py)
    takagi_sugeno     fuzzy decision model, ANFIS-trained TSK      (takagi_sugeno.py)
    topsis            multi-criteria decision analysis, TOPSIS     (topsis.py)
    robust_selection  robust decision making over scenarios        (robust.py)

Each engine produces a score per bar (larger = more bullish). P(up) is the
logistic curve of that score fitted on the fold's VALIDATION rows only
(``cycle.bridges.calibration.ValidationCurve``, registry probability
``logistic_curve_on_validation``); the engine itself fits on training rows.
``takagi_sugeno`` and ``topsis`` are also price models (task ``regression``):
their output is the predicted scaled move.

The predicate-based engines read the bound market view (indicators of the
closes, named raw features) through ``predicates.PredicateBank``; every value a
prediction at bar t reads comes from rows <= t. The whole fitted state is one
JSON file (``reasoner.json``): no pickle.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from threadpoolctl import threadpool_limits

from cycle.adapters_extra.symbolic_reasoner.certainty import ForwardChainer
from cycle.adapters_extra.symbolic_reasoner.decision_list import DecisionList
from cycle.adapters_extra.symbolic_reasoner.logic_program import LogicProgram
from cycle.adapters_extra.symbolic_reasoner.mamdani import MamdaniSystem
from cycle.adapters_extra.symbolic_reasoner.pln import ProbabilisticLogicNetwork
from cycle.adapters_extra.symbolic_reasoner.predicates import PredicateBank, up_target
from cycle.adapters_extra.symbolic_reasoner.psl import SoftLogic
from cycle.adapters_extra.symbolic_reasoner.reasoning import Context
from cycle.adapters_extra.symbolic_reasoner.resolution import FirstOrderLogic
from cycle.adapters_extra.symbolic_reasoner.robust import RobustSelection
from cycle.adapters_extra.symbolic_reasoner.soft_csp import SoftConstraintProblem
from cycle.adapters_extra.symbolic_reasoner.takagi_sugeno import TakagiSugeno
from cycle.adapters_extra.symbolic_reasoner.topsis import TopsisRanking
from cycle.bridges import calibration, persistence, training
from cycle.bridges.base import BridgeAdapter

ENGINES = {
    "first_match": DecisionList,
    "forward_chain": ForwardChainer,
    "pln": ProbabilisticLogicNetwork,
    "psl": SoftLogic,
    "mamdani": MamdaniSystem,
    "resolution": FirstOrderLogic,
    "sld": LogicProgram,
    "soft_csp": SoftConstraintProblem,
    "takagi_sugeno": TakagiSugeno,
    "topsis": TopsisRanking,
    "robust_selection": RobustSelection,
}
DEFAULT_INDUCED_FEATURE_COUNT = 8


class SymbolicReasonerAdapter(BridgeAdapter):
    model_file = "reasoner.json"

    def __init__(self, key, entry, parameters, device, seed, task="classification") -> None:
        super().__init__(key, entry, parameters, device, seed, task)
        if self.variant not in ENGINES:
            raise ValueError(f"{key}: unknown symbolic engine {self.variant!r}; known: {', '.join(ENGINES)}")
        self.engine = ENGINES[self.variant](self.parameters, self.seed, task)
        if task == "regression" and not self.engine.has_value:
            raise TypeError(f"{key}: the {self.variant} engine has no price model (its registry price is null)")
        self.step_unit = "epoch" if self.engine.iterative else "single_fit"
        self.bank: PredicateBank | None = None
        self.curve: calibration.ValidationCurve | None = None
        self._cache: dict = {}

    # ── the market view ──
    def _on_bind(self, view) -> None:
        self._cache = {}

    def minimum_history(self) -> int:
        return int(self.engine.history)

    def _context(self, features, log=None) -> Context:
        return Context(features=features, view=self.market, bank=self.bank, cache=self._cache,
                       log=log or (lambda message: None))

    # ── fit ──
    def _fit(self, features, labels, train_index, validation_index, timestamps, reporter):
        view = self.require_market()
        targets = np.asarray(labels, dtype=np.float64)
        direction = up_target(targets)
        train_rows = train_index[np.isfinite(targets[train_index])]
        if train_rows.size == 0:
            raise ValueError(f"{self.key}: no training row has a known target")
        self._cache = {}
        log = lambda message: reporter.log(message)  # noqa: E731
        if self.engine.uses_predicates:
            self.bank = PredicateBank.build(view, features, train_rows, direction,
                                            int(self.parameters.get("induced_feature_count", DEFAULT_INDUCED_FEATURE_COUNT)),
                                            log=lambda message, level="info": reporter.log(message, level))
            log(f"{self.key}: {len(self.bank.predicates)} grounded predicates "
                f"({sum(p.source == 'column' for p in self.bank.predicates)} induced from feature columns), "
                f"{len(self.bank.config_rules)} authored rules usable")
        context = self._context(features, log)
        validation_rows = validation_index[np.isfinite(targets[validation_index])]

        def validate():
            if self.task == "regression":
                return training.score("regression", self.engine.value(context, validation_rows), targets[validation_rows])
            scores = self.engine.score(context, validation_rows)
            self.curve = calibration.ValidationCurve.fit(scores, direction[validation_rows])
            return training.score("classification", self.curve.apply(scores), direction[validation_rows])

        with threadpool_limits(1):       # one BLAS thread: a refit is bit-identical, and no oversubscription
            summary = self._run(context, train_rows, targets, direction, validate, reporter)
        self.best_iteration = summary["best_epoch"]
        self.fit_summary = {**self.engine.summary, "best_epoch": summary["best_epoch"],
                            "best_validation_loss": summary["best_validation_loss"]}
        if self.curve is not None:
            log(f"{self.key}: validation curve slope {self.curve.slope:.4f}, intercept {self.curve.intercept:.4f} "
                f"on {self.curve.row_count} rows")

    def _run(self, context, train_rows, targets, direction, validate, reporter) -> dict:
        if self.engine.iterative:
            self.engine.begin(context, train_rows, targets, direction)
            return training.run_epochs(reporter, epoch_count=self.engine.epoch_count(), train_index=train_rows,
                                          train_epoch=self.engine.train_epoch, validate=lambda epoch: validate(),
                                          snapshot=lambda: (self.engine.snapshot(), self.curve),
                                          restore=self._restore, patience=int(self.parameters.get("patience", 5)),
                                          name=self.key)
        return training.single_fit(reporter, train_index=train_rows,
                                   fit=lambda: self.engine.fit(context, train_rows, targets, direction),
                                   validate=validate, name=self.key)

    def _restore(self, saved) -> None:
        engine_state, curve = saved
        self.engine.restore(engine_state)
        self.curve = curve

    # ── predict ──
    def _predict_probability(self, features, index):
        scores = self.engine.score(self._context(features), index)
        if self.curve is None:
            return np.full(index.shape, np.nan)
        return self.curve.apply(scores)

    def _predict_value(self, features, index):
        return self.engine.value(self._context(features), index)

    # ── save / load ──
    def _save_state(self, folder: Path) -> str:
        persistence.save_json(folder / self.model_file, {
            "variant": self.variant,
            "bank": self.bank.to_dict() if self.bank is not None else None,
            "engine": self.engine.state(),
            "curve": self.curve.to_dict() if self.curve is not None else None,
        })
        return self.model_file

    def _load_state(self, folder: Path, metadata: dict) -> None:
        document = persistence.load_json(folder / self.model_file)
        self.engine = ENGINES[self.variant](self.parameters, self.seed, self.task)
        self.engine.load(document["engine"])
        self.step_unit = "epoch" if self.engine.iterative else "single_fit"
        self.bank = PredicateBank.from_dict(document["bank"]) if document["bank"] is not None else None
        self.curve = calibration.ValidationCurve.from_dict(document["curve"]) if document["curve"] is not None else None
        self._cache = {}

    def _library_versions(self) -> dict[str, str]:
        return persistence.library_versions("numpy", "scikit-fuzzy", "kanren", "python-constraint", "scikit-learn")


__all__ = ["ENGINES", "SymbolicReasonerAdapter"]
