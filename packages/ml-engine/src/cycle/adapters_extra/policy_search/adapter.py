"""``PolicySearchAdapter``: an optimiser trains a trading policy on the fold's training span.

The variant (``direction.fixed.variant``) names the optimiser; its form names
the policy:

    linear policy, score s = w . x + b, position tanh(s)
        basin_hopping, differential_evolution, cma_es, genetic, ant_colony,
        bayesian, particle_swarm, annealing   (the ``searchers`` package)
        gradient_descent                     (log loss on the labels, no tape)
    rule ensemble (``rules``)                genetic_rules
    formula (``formula``)                    symbolic_regression

What is optimised (``objective.Problem``):

- a direction model (task ``classification``) maximises the net utility of its
  positions on the reward tape of the TRAINING span (next-open fills, one round
  trip of cost per decision, in move-scale units), minus a ridge penalty
  (``weight_decay``). Gradient descent instead minimises the log loss of
  sigmoid(s) against the up / down labels, and symbolic regression fits the
  scaled h-bar move (the price target of the training rows, read through
  ``MarketView.fit_rows``) with gplearn's mean absolute error;
- a price model (task ``regression``) minimises the Huber loss of s against
  the price target (rules: of beta x score).

Every epoch is one generation (one temperature level, one restart, one chunk
of gradient steps, one round of Bayesian evaluations). The validation rows
only CHOOSE which epoch's policy is kept (``run_epochs`` snapshots the best,
``patience`` epochs without improvement stop the search): validation utility
on the validation span's own tape (prices up to the last validation row + h,
never later), the validation log loss for gradient descent, the validation
Huber loss for price models and for symbolic regression.

P(up) is a logistic curve of the kept policy's score fitted on the validation
rows (``bridges.calibration.ValidationCurve``), except gradient descent, whose
sigmoid(s) is its own probability. A prediction reads only the bar's feature
row, so it never depends on another bar.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np

from cycle.bridges import calibration, persistence, training
from cycle.bridges.base import BridgeAdapter
from cycle.bridges.tape import RewardTape

from .objective import LinearPolicy, Problem, finite_rows

LINEAR_VARIANTS = ("basin_hopping", "differential_evolution", "cma_es", "genetic", "gradient_descent", "ant_colony",
                   "bayesian", "particle_swarm", "annealing")
VARIANTS = (*LINEAR_VARIANTS, "genetic_rules", "symbolic_regression")
LIBRARIES = {
    "basin_hopping": ("numpy", "scipy"), "differential_evolution": ("numpy", "scipy"), "cma_es": ("numpy", "cma"),
    "genetic": ("numpy", "deap"), "gradient_descent": ("numpy",), "ant_colony": ("numpy",),
    "bayesian": ("numpy", "scikit-optimize", "scikit-learn"), "particle_swarm": ("numpy", "pyswarms"),
    "annealing": ("numpy",), "genetic_rules": ("numpy", "deap"), "symbolic_regression": ("numpy", "gplearn", "scikit-learn"),
}
FORMULA_TARGET_CLIP = 5.0           # scale units: the formula is fitted to moves clipped here


def policy_from_dict(document: dict):
    form = document.get("form")
    if form == "linear":
        return LinearPolicy.from_dict(document)
    if form == "rules":
        from .rules import RuleEnsemblePolicy

        return RuleEnsemblePolicy.from_dict(document)
    if form == "formula":
        from .formula import FormulaPolicy

        return FormulaPolicy.from_dict(document)
    raise ValueError(f"unknown policy form {form!r}")


class PolicySearchAdapter(BridgeAdapter):
    step_unit = "epoch"
    model_file = "policy.json"

    def __init__(self, key: str, entry: dict, parameters: dict, device: str, seed: int,
                 task: str = "classification") -> None:
        super().__init__(key, entry, parameters, device, seed, task)
        if self.variant not in VARIANTS:
            raise ValueError(f"{key}: unknown policy-search variant {self.variant!r}; known: {', '.join(VARIANTS)}")
        # the tape (and symbolic regression's price target) come from the market view; gradient descent
        # and every price model read only the features and the targets fit() is handed
        self.needs_market = task == "classification" and self.variant != "gradient_descent"
        self.policy = None
        self.curve: calibration.ValidationCurve | None = None

    # ── the problems ──
    def _uses_curve(self) -> bool:
        return self.task == "classification" and self.variant != "gradient_descent"

    def _problems(self, features, labels, train_index, validation_index) -> tuple[Problem, Problem]:
        decay = float(self.parameters.get("weight_decay", 0.0))
        if self.task == "regression":
            return (Problem.from_targets("huber", features, labels, train_index, decay),
                    Problem.from_targets("huber", features, labels, validation_index, 0.0))
        if self.variant == "gradient_descent":
            return (Problem.from_targets("log_loss", features, labels, train_index, decay),
                    Problem.from_targets("log_loss", features, labels, validation_index, 0.0))
        view = self.require_market()
        if self.variant == "symbolic_regression":
            targets = np.clip(np.asarray(view.price_targets, dtype=np.float64), -FORMULA_TARGET_CLIP, FORMULA_TARGET_CLIP)
            return (Problem.from_targets("huber", features, targets, view.fit_rows(train_index), 0.0),
                    Problem.from_targets("huber", features, targets, validation_index, 0.0))
        train_tape = RewardTape.from_view(view, train_index)
        train = Problem.from_tape(features, train_tape, view.fit_rows(train_index), decay)
        if validation_index.size:
            # the validation span's own tape: prices up to the last validation row + h, never later
            validation_tape = RewardTape.from_view(view, known_until=int(validation_index[-1]) + int(view.horizon))
            validation = Problem.from_tape(features, validation_tape, validation_index, 0.0)
        else:
            validation = Problem.from_tape(features, train_tape, np.empty(0, dtype=np.int64), 0.0)
        return train, validation

    # ── fitting ──
    def _fit(self, features, labels, train_index, validation_index, timestamps, reporter) -> None:
        train, validation = self._problems(features, labels, train_index, validation_index)
        if train.row_count < 2:
            raise ValueError(f"{self.key}: {train.row_count} usable training rows; the search needs at least 2")
        p = self.parameters
        evolver = self._build_evolver(train, features)
        name = getattr(evolver, "name", self.variant)
        objective = {"utility": "minus the net tape utility per bar (move-scale units) plus the ridge penalty",
                     "huber": "the Huber loss against the scaled move", "log_loss": "the log loss against the labels"}
        reporter.log(f"{self.key}: {name} over {train.row_count} training bars; training loss = {objective[train.kind]}; "
                     f"validation on {validation.row_count} bars chooses the epoch kept")
        history: list[float | None] = []

        def train_epoch(epoch, report_batch):
            loss = evolver.step()
            return loss

        def validate(epoch):
            result = self._validation_score(evolver.current, validation, features, labels, validation_index)
            history.append(None if result.selection is None else float(result.selection))
            return result

        summary = training.run_epochs(
            reporter, epoch_count=int(p["epochs"]), train_index=train_index, train_epoch=train_epoch, validate=validate,
            snapshot=lambda: self._copy(evolver.current), restore=lambda saved: setattr(self, "_restored", saved),
            patience=int(p["patience"]), name=self.key,
        )
        restored = getattr(self, "_restored", None)
        self.policy = self._as_policy(restored if restored is not None else evolver.current)
        if hasattr(self, "_restored"):
            del self._restored
        self.best_iteration = int(summary["best_epoch"])
        self.curve = None
        if self._uses_curve():
            score = self.policy.score(features, validation_index)
            self.curve = calibration.ValidationCurve.fit(score, np.asarray(labels, dtype=np.float64)[validation_index])
        train_rows = np.arange(train.row_count)
        kept_train_loss = self._problem_value(train, self.policy, train.inputs, train_rows)
        self.fit_summary = {
            "variant": self.variant,
            "best_epoch": int(summary["best_epoch"]),
            "trained_epochs": int(summary["trained_epochs"]),
            "train_row_count": int(train.row_count),
            "validation_row_count": int(validation.row_count),
            "training_objective": train.kind,
            "kept_training_loss": kept_train_loss,
            "best_validation_selection": summary["best_selection"],
            "validation_selection_by_epoch": history,
            "evaluations": int(getattr(evolver, "evaluations", 0)),
            "search_statistics": {key: value for key, value in (getattr(evolver, "statistics", {}) or {}).items()},
            **self._describe(),
        }
        if self.curve is not None:
            self.fit_summary["validation_curve"] = self.curve.to_dict()
        reporter.log(f"{self.key}: kept epoch {summary['best_epoch']} of {summary['trained_epochs']} "
                     f"(best validation selection {summary['best_selection']}); {self._describe_line()}")

    def _build_evolver(self, train: Problem, features):
        p = self.parameters
        if self.variant in LINEAR_VARIANTS:
            from .searchers import searcher_class

            bound = float(p.get("weight_bound", 10.0))
            return searcher_class(self.variant)(train, p, self.seed, bound)
        if self.variant == "genetic_rules":
            from .rules import RuleEvolver

            return RuleEvolver(train, p, self.seed)
        from .formula import FormulaEvolver

        return FormulaEvolver(train.inputs, train.target, p, self.seed)

    def _as_policy(self, current):
        if isinstance(current, np.ndarray):
            return LinearPolicy.from_theta(current)
        return current.copy()

    def _copy(self, current):
        return current.copy() if current is not None else None

    def _problem_value(self, problem: Problem, policy, inputs, rows) -> float | None:
        """The problem's data loss of the kept policy on its own rows (no penalty)."""
        if problem.row_count == 0:
            return None
        score = policy.score(inputs, rows)
        if problem.kind == "utility":
            positions = np.tanh(score) if isinstance(policy, LinearPolicy) else score
            value = -float(problem.utility_from_positions(positions)[0])
        else:
            value = float(problem.data_loss_from_scores(self._value_from_score(policy, score))[0])
        return value if np.isfinite(value) else None

    def _value_from_score(self, policy, score):
        return score * float(getattr(policy, "scale", 1.0)) if not isinstance(policy, LinearPolicy) else score

    def _validation_score(self, current, validation: Problem, features, labels, validation_index):
        policy = self._as_policy(current)
        if validation.row_count == 0:
            return training.ValidationScore(None, None, None, None)
        score = policy.score(validation.inputs, np.arange(validation.row_count))
        if validation.kind == "utility":
            positions = np.tanh(score) if isinstance(policy, LinearPolicy) else score
            utility = float(validation.utility_from_positions(positions)[0])
            label_rows = finite_rows(features, validation_index)
            accuracy = None
            if label_rows.size:
                known = np.isfinite(np.asarray(labels, dtype=np.float64)[label_rows])
                sign = policy.score(features, label_rows[known])
                accuracy = float(np.mean((sign > 0) == (np.asarray(labels)[label_rows[known]] >= 0.5))) if known.any() else None
            loss = -utility if np.isfinite(utility) else None
            return training.ValidationScore(loss, accuracy, None, loss)
        if validation.kind == "log_loss":
            return training.score("classification", calibration.sigmoid(score), validation.target)
        return training.score("regression", self._value_from_score(policy, score), validation.target)

    def _describe(self) -> dict:
        names = list(self.market.feature_names) if self.market is not None else []
        if isinstance(self.policy, LinearPolicy):
            return {"policy_form": "linear", "included_feature_count": int(np.sum(np.abs(self.policy.weights) > 0))}
        if self.variant == "genetic_rules":
            from .rules import readable

            return {"policy_form": "rules", "rules": [readable(text, names) for text in self.policy.rules],
                    "rule_scale": float(self.policy.scale)}
        from .formula import readable

        return {"policy_form": "formula", "formula": readable(self.policy.tokens, names),
                "formula_nodes": int(self.policy.node_count)}

    def _describe_line(self) -> str:
        description = self._describe()
        if description["policy_form"] == "linear":
            return f"{description['included_feature_count']} features weighted"
        if description["policy_form"] == "rules":
            return f"{len(description['rules'])} rules, best: {description['rules'][0] if description['rules'] else '-'}"
        return f"formula ({description['formula_nodes']} nodes): {description['formula'][:160]}"

    # ── prediction ──
    def _score(self, features, index) -> np.ndarray:
        return self.policy.score(features, index)

    def _predict_probability(self, features, index) -> np.ndarray:
        score = self._score(features, index)
        if self.curve is None:
            return calibration.sigmoid(score) if self.variant == "gradient_descent" else np.full(score.shape, np.nan)
        return self.curve.apply(score)

    def _predict_value(self, features, index) -> np.ndarray:
        return self._value_from_score(self.policy, self._score(features, index))

    # ── persistence ──
    def _save_state(self, folder: Path) -> str:
        persistence.save_json(folder / self.model_file, {
            "variant": self.variant,
            "policy": self.policy.to_dict(),
            "curve": None if self.curve is None else self.curve.to_dict(),
        })
        return self.model_file

    def _load_state(self, folder: Path, metadata: dict) -> None:
        document = persistence.load_json(folder / (metadata.get("model_file") or self.model_file))
        self.policy = policy_from_dict(document["policy"])
        self.curve = None if document.get("curve") is None else calibration.ValidationCurve.from_dict(document["curve"])
        self.needs_market = self.task == "classification" and self.variant != "gradient_descent"

    def _library_versions(self) -> dict[str, str]:
        return persistence.library_versions(*LIBRARIES.get(self.variant, ("numpy",)))


__all__ = ["LINEAR_VARIANTS", "PolicySearchAdapter", "VARIANTS", "policy_from_dict"]
