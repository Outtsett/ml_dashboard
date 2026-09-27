"""scikit-learn models behind the Model Cycle's `ModelAdapter` contract.

Every registry entry with ``adapter == "scikit_learn"``
(``src/config/cycle_models/*.json``) is built here, as its direction
classifier (``task="classification"``) or its price model
(``task="regression"``), by ``models.build_adapter`` through the registry
constructor ``SklearnEstimatorAdapter(key, entry, parameters, device, seed,
task=task)``. The estimator class is the entry's ``direction.estimator`` /
``price.estimator`` (an allowlisted ``sklearn.`` dotted path), its keyword
arguments are ``catalog.estimator_arguments(key, parameters, role)`` plus
``random_state=seed`` where the class takes one.

Data handling, the same for every model:

- ``preprocess: ["standard_scaler"]``: a StandardScaler fitted on the rows the
  model is fitted on (training rows only; never validation or test rows).
- The price model's target is clipped at its TRAINING 1st / 99th percentiles
  (``models.clip_training_target``), as the legacy regressors do; validation
  rows are scored against the raw target.
- Reported losses: log loss / accuracy at 0.5 / F1 of the up class for a
  direction model (``models.binary_scores``); mean absolute error / sign
  accuracy for a price model (``models.regression_scores``).

How a fit is paced (the entry's ``progress``), so Pause and Stop respond:

    warm_start_trees   extra trees      trees grown in chunks (max(10, n/15)) with
                                        warm_start; one tree_batch step per chunk;
                                        every tree is kept
    warm_start_rounds  gradient boosting ten rounds per step with warm_start; every
                                        round is scored on the validation rows and
                                        the ensemble is cut back to the best round
                                        (``best_iteration`` = rounds kept); stops
                                        after ``early_stopping_rounds`` flat rounds
    per_epoch          SGD, scikit-learn partial_fit one pass (epoch) at a time; the
                       multilayer perceptron epoch with the lowest validation loss is
                                        kept (``best_iteration`` = that epoch);
                                        stops after ``patience`` flat epochs
    single_fit         everything else  one library call on a daemon thread
                                        (``fitting.run_single_fit``), checkpointed
                                        every 0.2 s

Special constructions:

- Stacked generalization: StackingClassifier / StackingRegressor over logistic
  regression (Ridge for the price model), a random forest (``tree_count``,
  ``max_depth``) and gradient boosting (``tree_count``); the meta-learner is
  LogisticRegression(C = regularization_strength) / Ridge(alpha = 1 /
  regularization_strength), fitted on out-of-fold answers from
  ``KFold(stacking_folds, shuffle=False)`` — contiguous blocks, never shuffled.
  The out-of-fold fits run in parallel (``n_jobs=-1``): gradient boosting's
  exact splitter is the slow part (measured on MNQ 5m, 8,782 training rows:
  11 s for 200 trees), and six sequential fits of it overran the 60-second
  fold budget. Prediction is single-threaded afterwards (a forest asked for
  one row pays more for thread dispatch than for its trees).
- Calibrated classifier: the ``base_model`` is fitted on the training rows,
  then ``CalibratedClassifierCV(FrozenEstimator(base), method=calibration_method)``
  is fitted on the VALIDATION rows only (``.calibration_rows``).
- Support vector machine: fitted on the most recent ``maximum_training_bars``
  training rows (0 = all; ``.training_rows`` holds the rows used; the scaler is
  fitted on exactly those). P(up) is never libsvm's ``probability=True``: a
  two-parameter logistic curve (``cycle.derived.fit_logistic_curve``) is
  fitted on the VALIDATION rows' ``decision_function`` values.

Attributes the explainer relies on (``docs/plans/2026-09-26-cycle-catalog-inside-view.md``):
``.estimator`` (the fitted scikit-learn object), ``.scaler`` (StandardScaler or
None), ``.logistic_curve`` ((slope, intercept) or None), ``.training_rows``
(int64, the rows actually fitted), ``.key``, ``.task``, ``.feature_count``,
``.best_iteration`` (rounds or epochs kept, or None).

Saved as ``model.joblib`` (joblib pickle of the fitted objects: only load a
directory this cycle wrote itself) plus ``model.json``.
"""

from __future__ import annotations

import copy
import importlib
import inspect
import math
import os
import re
import warnings
from pathlib import Path

import numpy as np

from . import catalog
from .adapter import MODEL_TASKS, BatchReport, EpochReport, check_index
from .derived import apply_logistic_curve, fit_logistic_curve
from .fitting import Stopwatch, run_single_fit
from .models import (
    _base_metadata,
    _require_both_classes,
    _require_varying_target,
    _training_summary,
    _wrong_task_error,
    binary_scores,
    clip_training_target,
    regression_scores,
    write_metadata,
)

SCIKIT_LEARN_PREFIX = "sklearn."
_DOTTED_PATH = re.compile(r"^sklearn(\.[A-Za-z_][A-Za-z0-9_]*)+$")
MODEL_FILE = "model.joblib"
ROUNDS_PER_STEP = 10
TREE_CHUNKS = 15
MINIMUM_TREE_CHUNK = 10
WARNINGS_LOGGED = 3


def import_estimator(path: str):
    """The scikit-learn class at dotted ``path`` (``sklearn.<module>.<Class>``).
    Only ``sklearn.`` paths are imported: the registry is data, not code."""
    if not isinstance(path, str) or not _DOTTED_PATH.match(path):
        raise ValueError(f"estimator {path!r} is not a scikit-learn dotted path (sklearn.<module>.<Class>)")
    module_name, _, class_name = path.rpartition(".")
    module = importlib.import_module(module_name)
    cls = getattr(module, class_name, None)
    if not inspect.isclass(cls):
        raise ValueError(f"estimator {path!r}: {module_name} has no class {class_name}")
    return cls


def _accepts(cls, name: str) -> bool:
    return name in inspect.signature(cls).parameters


def _as_index(index) -> np.ndarray:
    return np.asarray(index, dtype=np.int64).reshape(-1)


def _finite_or_none(value):
    if value is None:
        return None
    value = float(value)
    return value if math.isfinite(value) else None


def _set_prediction_threads(estimator, count: int) -> None:
    """Set ``n_jobs`` on an estimator and every fitted estimator inside it
    (stacking base models, a calibrated classifier's frozen base model). A
    forest asked for one row pays more for joblib's dispatch than for its
    trees."""
    seen: set[int] = set()
    stack = [estimator]
    while stack:
        item = stack.pop()
        if item is None or id(item) in seen:
            continue
        seen.add(id(item))
        if hasattr(item, "n_jobs") and hasattr(item, "get_params"):
            try:
                item.n_jobs = count
            except AttributeError:
                pass
        for name in ("estimators_", "estimator", "final_estimator_"):
            child = getattr(item, name, None)
            if isinstance(child, list):
                stack.extend(member for member in child
                             if hasattr(member, "get_params") and hasattr(member, "estimators_"))
            elif child is not None and hasattr(child, "get_params"):
                stack.append(child)
        for calibrated in getattr(item, "calibrated_classifiers_", []) or []:
            stack.append(getattr(calibrated, "estimator", None))


class _Stages:
    """Gradient boosting's raw output on a fixed matrix after each round,
    advanced as the ensemble grows. The first call reads scikit-learn's own
    staged output; later rounds add ``learning_rate * tree.predict`` exactly
    as ``predict_stages`` does, so scoring every round costs one tree
    prediction per round instead of re-running the ensemble."""

    def __init__(self, matrix: np.ndarray, classification: bool) -> None:
        self.matrix = np.ascontiguousarray(matrix, dtype=np.float32)
        self.classification = classification
        self.raw: np.ndarray | None = None
        self.rounds = 0

    def advance(self, estimator, rounds: int) -> list[np.ndarray]:
        """The raw output after each round from the last call's round + 1 to ``rounds``."""
        out: list[np.ndarray] = []
        if self.raw is None:
            staged = (estimator.staged_decision_function(self.matrix) if self.classification
                      else estimator.staged_predict(self.matrix))
            for number, raw in enumerate(staged, start=1):
                if number > rounds:
                    break
                out.append(np.asarray(raw, dtype=np.float64).reshape(-1))
            self.raw = out[-1].copy()
        else:
            for position in range(self.rounds, rounds):
                tree = estimator.estimators_[position, 0]
                self.raw = self.raw + estimator.learning_rate * tree.predict(self.matrix)
                out.append(self.raw.copy())
        self.rounds = rounds
        return out


def _keep_first_rounds(estimator, rounds: int) -> None:
    """Cut a fitted gradient boosting ensemble back to its first ``rounds``
    trees, so every prediction (and the explainer) uses exactly those."""
    estimator.estimators_ = estimator.estimators_[:rounds]
    estimator.train_score_ = estimator.train_score_[:rounds]
    for name in ("oob_improvement_", "oob_scores_"):
        if hasattr(estimator, name):
            setattr(estimator, name, getattr(estimator, name)[:rounds])
    if hasattr(estimator, "oob_scores_") and len(estimator.oob_scores_):
        estimator.oob_score_ = float(estimator.oob_scores_[-1])
    estimator.n_estimators = rounds
    estimator.n_estimators_ = rounds


class SklearnEstimatorAdapter:
    """One scikit-learn registry model as a direction classifier or a price
    model. See the module docstring for the pacing, the special constructions
    and the attributes the explainer reads."""

    available = True

    def __init__(self, key: str, entry: dict, parameters: dict, device: str, seed: int,
                 task: str = "classification") -> None:
        if task not in MODEL_TASKS:
            raise ValueError(f"unknown task {task!r}; valid tasks: {', '.join(MODEL_TASKS)}")
        if entry["adapter"] != "scikit_learn":
            raise ValueError(f"{key}: its registry adapter is {entry['adapter']!r}, not 'scikit_learn'")
        role = "direction" if task == "classification" else "price"
        if task == "classification" and entry["direction"]["mode"] != "classifier":
            raise ValueError(f"{entry['displayName']} ({key}) has no classifier: its P(up) is read from its "
                             "price model through a logistic curve (cycle.derived.DerivedDirectionAdapter)")
        block = entry["direction"] if role == "direction" else entry["price"]
        if block is None or not block.get("estimator"):
            raise ValueError(f"{entry['displayName']} ({key}) has no {role} model in the registry")
        self.key = key
        self.family = key
        self.entry = entry
        self.task = task
        self.role = role
        self.parameters = dict(parameters)
        self.device = "cpu"
        self.seed = int(seed)
        self.step_unit = entry["stepUnit"]
        self.progress = entry["progress"]
        self.estimator_path = block["estimator"]
        self.estimator_class = import_estimator(self.estimator_path)
        self.uses_scaler = "standard_scaler" in entry["preprocess"]
        self.uses_curve = task == "classification" and entry["direction"]["probability"] == "logistic_curve_on_validation"
        self.label = entry["displayName"]
        # fitted state
        self.estimator = None
        self.scaler = None
        self.logistic_curve: tuple[float, float] | None = None
        self.training_rows = np.empty(0, dtype=np.int64)
        self.calibration_rows: np.ndarray | None = None
        self.feature_count: int | None = None
        self.best_iteration: int | None = None
        self.target_clip: tuple[float, float] | None = None
        self.fit_summary: dict = {}
        self._clip_summary: dict = {}
        self._up_column = 1

    # ── contract ─────────────────────────────────────────────────────────
    def minimum_history(self) -> int:
        return 1

    def fit(self, features, labels, train_index, validation_index, timestamps, reporter) -> None:
        train_index = _as_index(train_index)
        validation_index = _as_index(validation_index)
        if train_index.size == 0:
            raise ValueError(f"{self.key}: the training index is empty")
        check_index(features, labels, train_index, "train_index")
        check_index(features, labels, validation_index, "validation_index")
        if self.task == "regression":
            _require_varying_target(self.key, labels[train_index])
        else:
            _require_both_classes(self.key, labels[train_index])
        self.feature_count = int(features.shape[1])
        reporter.step_unit = self.step_unit
        watch = Stopwatch()

        self.training_rows = self._rows_to_fit(train_index, reporter)
        rows = np.asarray(features[self.training_rows], dtype=np.float64)
        if self.uses_scaler:
            from sklearn.preprocessing import StandardScaler

            self.scaler = StandardScaler().fit(rows)
        train_matrix = self._transform(rows)
        target = self._target(labels, self.training_rows)
        validation_matrix = self._transform(np.asarray(features[validation_index], dtype=np.float64))
        validation_labels = np.asarray(labels[validation_index], dtype=np.float64)
        span = (int(train_index[0]), int(train_index[-1]))

        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            if self.progress == "warm_start_trees":
                best_loss = self._fit_tree_chunks(train_matrix, target, validation_matrix, validation_labels, span, reporter)
            elif self.progress == "warm_start_rounds":
                best_loss = self._fit_rounds(train_matrix, target, validation_matrix, validation_labels, span, reporter)
            elif self.progress == "per_epoch":
                best_loss = self._fit_epochs(train_matrix, target, validation_matrix, validation_labels, span, reporter)
            elif self.progress == "single_fit":
                best_loss = self._fit_once(train_matrix, target, validation_matrix, validation_labels,
                                           validation_index, span, reporter)
            else:
                raise ValueError(f"{self.key}: progress {self.progress!r} is not a scikit-learn pacing")
        self._log_warnings(caught, reporter)
        if self.task == "classification" and hasattr(self.estimator, "classes_"):
            self._up_column = int(np.flatnonzero(np.asarray(self.estimator.classes_) == 1)[0])
        self.fit_summary = {
            **_training_summary(train_index, validation_index, timestamps),
            **(dict(self._clip_summary) if self.task == "regression" else {}),
            "training_row_count": int(self.training_rows.size),
            "best_step": self.best_iteration,
            "best_validation_loss": best_loss,
            "fit_seconds": watch.seconds(),
        }
        if self.task == "regression":
            low, high = self.target_clip
            reporter.log(
                f"{self.label} price model: training target clipped to [{low:.3f}, {high:.3f}] "
                f"({self._clip_summary['clipped_train_row_count']} rows moved)"
            )

    def predict_probability(self, features, index) -> np.ndarray:
        if self.task != "classification":
            raise _wrong_task_error(self.key, self.task, "predict_probability")
        matrix = self._inputs(features, index, "predict_probability")
        return np.clip(self._output(matrix), 0.0, 1.0)

    def predict_value(self, features, index) -> np.ndarray:
        if self.task != "regression":
            raise _wrong_task_error(self.key, self.task, "predict_value")
        return self._output(self._inputs(features, index, "predict_value"))

    def save(self, directory: str) -> str:
        import joblib
        import sklearn

        if self.estimator is None:
            raise RuntimeError(f"{self.key}: save called before fit")
        folder = Path(directory)
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / MODEL_FILE
        temporary = folder / (MODEL_FILE + ".tmp")
        joblib.dump({
            "estimator": self.estimator,
            "scaler": self.scaler,
            "logistic_curve": self.logistic_curve,
            "training_rows": self.training_rows,
            "calibration_rows": self.calibration_rows,
            "best_iteration": self.best_iteration,
        }, temporary)
        os.replace(temporary, path)
        metadata = _base_metadata(self, path.name, {"scikit_learn": sklearn.__version__})
        metadata.update({
            "estimator": self.estimator_path,
            "preprocess": list(self.entry["preprocess"]),
            "best_iteration": self.best_iteration,
            "logistic_curve": (None if self.logistic_curve is None
                               else {"slope": self.logistic_curve[0], "intercept": self.logistic_curve[1]}),
            "training_row_count": int(self.training_rows.size),
        })
        write_metadata(folder, metadata)
        return str(path)

    @classmethod
    def load(cls, directory: str, metadata: dict) -> SklearnEstimatorAdapter:
        """Rebuild a saved model. joblib unpickles: only load a directory this
        cycle wrote itself (``data/models/<model_id>/``)."""
        import joblib

        key = metadata["key"]
        adapter = cls(key, catalog.entry(key), metadata["parameters"], "cpu", metadata["seed"],
                      task=metadata.get("task", "classification"))
        payload = joblib.load(Path(directory) / metadata["model_file"])
        adapter.estimator = payload["estimator"]
        adapter.scaler = payload["scaler"]
        curve = payload["logistic_curve"]
        adapter.logistic_curve = None if curve is None else (float(curve[0]), float(curve[1]))
        adapter.training_rows = np.asarray(payload["training_rows"], dtype=np.int64)
        adapter.calibration_rows = payload.get("calibration_rows")
        adapter.best_iteration = payload["best_iteration"]
        adapter.feature_count = int(metadata["feature_count"])
        if "target_clip_low" in metadata and "target_clip_high" in metadata:
            adapter.target_clip = (float(metadata["target_clip_low"]), float(metadata["target_clip_high"]))
        if adapter.task == "classification" and hasattr(adapter.estimator, "classes_"):
            adapter._up_column = int(np.flatnonzero(np.asarray(adapter.estimator.classes_) == 1)[0])
        adapter.fit_summary = {name: metadata[name] for name in ("fit_seconds", "best_validation_loss")
                               if name in metadata}
        return adapter

    # ── data ─────────────────────────────────────────────────────────────
    def _rows_to_fit(self, train_index: np.ndarray, reporter) -> np.ndarray:
        """The training rows the estimator is fitted on: all of them, or the
        most recent ``maximum_training_bars`` when the model declares that cap
        (a support vector machine's fit grows with the square of the rows)."""
        cap = int(self.parameters.get("maximum_training_bars", 0) or 0)
        if cap <= 0 or train_index.size <= cap:
            return train_index.copy()
        reporter.log(
            f"{self.label}: fitting on the most recent {cap:,} of {train_index.size:,} training bars "
            "(maximum training bars; the fit grows with the square of the bars)"
        )
        return train_index[-cap:].copy()

    def _transform(self, rows: np.ndarray) -> np.ndarray:
        return self.scaler.transform(rows) if self.scaler is not None else rows

    def _target(self, labels: np.ndarray, rows: np.ndarray) -> np.ndarray:
        if self.task == "classification":
            return np.asarray(labels[rows] >= 0.5, dtype=np.int64)
        raw = np.asarray(labels[rows], dtype=np.float64)
        clipped, low, high = clip_training_target(raw)
        self.target_clip = (low, high)
        self._clip_summary = {
            "target_clip_low": low,
            "target_clip_high": high,
            "clipped_train_row_count": int(np.sum(clipped != raw)),
        }
        return clipped

    def _inputs(self, features, index, method: str) -> np.ndarray:
        if self.estimator is None or self.feature_count is None:
            raise RuntimeError(f"{self.key}: {method} called before fit")
        rows = np.asarray(features[_as_index(index)], dtype=np.float64)
        return self._transform(rows)

    # ── output ───────────────────────────────────────────────────────────
    def _output(self, matrix: np.ndarray, estimator=None) -> np.ndarray:
        """P(up) (direction model) or the predicted target (price model) for
        model-input rows (already scaled)."""
        estimator = self.estimator if estimator is None else estimator
        if self.progress == "warm_start_trees":
            return self._forest_direct(estimator, matrix)
        if self.task == "regression":
            return np.asarray(estimator.predict(matrix), dtype=np.float64).reshape(-1)
        if self.uses_curve:
            scores = np.asarray(estimator.decision_function(matrix), dtype=np.float64).reshape(-1)
            return apply_logistic_curve(self.logistic_curve, scores)
        column = int(np.flatnonzero(np.asarray(estimator.classes_) == 1)[0])
        return np.asarray(estimator.predict_proba(matrix)[:, column], dtype=np.float64)

    def _forest_direct(self, estimator, matrix: np.ndarray) -> np.ndarray:
        """A forest's prediction: the mean of its trees' leaf values (class
        fractions for a classifier), what predict_proba / predict compute, but
        summed in tree order on one thread. scikit-learn's threaded predict
        adds the trees in whatever order its threads finish, so two calls on
        the same rows can differ in the last bits; this is identical call to
        call and row by row, and for one row (the test walk) it skips joblib's
        dispatch, which costs more than the trees."""
        rows = np.ascontiguousarray(matrix, dtype=np.float32)
        total = np.zeros(rows.shape[0], dtype=np.float64)
        if self.task == "regression":
            for tree in estimator.estimators_:
                total += tree.tree_.predict(rows).reshape(rows.shape[0], -1)[:, 0]
        else:
            column = int(np.flatnonzero(np.asarray(estimator.classes_) == 1)[0])
            for tree in estimator.estimators_:
                total += tree.tree_.predict(rows).reshape(rows.shape[0], -1)[:, column]
        return total / len(estimator.estimators_)

    def _scores(self, output: np.ndarray, target: np.ndarray) -> dict:
        """{"loss", "accuracy", "f1_score"} for this task."""
        if self.task == "regression":
            scores = regression_scores(output, target)
            return {"loss": _finite_or_none(scores["mean_absolute_error"]), "accuracy": scores["accuracy"],
                    "f1_score": None}
        scores = binary_scores(output, target)
        return {"loss": _finite_or_none(scores["log_loss"]), "accuracy": scores["accuracy"],
                "f1_score": scores["f1_score"]}

    # ── estimators ───────────────────────────────────────────────────────
    def _new_estimator(self):
        cls = self.estimator_class
        name = cls.__name__
        if name in ("StackingClassifier", "StackingRegressor"):
            return self._new_stacking(cls)
        arguments = catalog.estimator_arguments(self.key, self.parameters, self.role)
        if name in ("MLPClassifier", "MLPRegressor"):
            arguments["hidden_layer_sizes"] = (int(self.parameters["hidden_size"]),) * int(self.parameters["layer_count"])
        if _accepts(cls, "random_state"):
            arguments.setdefault("random_state", self.seed)
        if self.progress == "warm_start_trees":
            arguments["n_jobs"] = -1
        if self.progress in ("warm_start_trees", "warm_start_rounds"):
            arguments["warm_start"] = True
        return cls(**arguments)

    def _new_stacking(self, cls):
        from sklearn.ensemble import (
            GradientBoostingClassifier,
            GradientBoostingRegressor,
            RandomForestClassifier,
            RandomForestRegressor,
        )
        from sklearn.linear_model import LogisticRegression, Ridge
        from sklearn.model_selection import KFold

        p = self.parameters
        tree_count, depth = int(p["tree_count"]), int(p["max_depth"])
        folds = KFold(n_splits=int(p["stacking_folds"]), shuffle=False)
        forest = dict(n_estimators=tree_count, max_depth=depth, min_samples_leaf=20, max_features=0.5,
                      n_jobs=-1, random_state=self.seed)
        boosting = dict(n_estimators=tree_count, max_depth=3, learning_rate=0.05, subsample=0.8,
                        random_state=self.seed)
        if self.task == "classification":
            base = [
                ("logistic_regression", LogisticRegression(max_iter=1000, random_state=self.seed)),
                ("random_forest", RandomForestClassifier(class_weight="balanced_subsample", **forest)),
                ("gradient_boosting", GradientBoostingClassifier(**boosting)),
            ]
            final = LogisticRegression(C=float(p["regularization_strength"]), max_iter=1000)
            return cls(estimators=base, final_estimator=final, cv=folds, stack_method="predict_proba", n_jobs=-1)
        base = [
            ("ridge_regression", Ridge(alpha=1.0)),
            ("random_forest", RandomForestRegressor(**forest)),
            ("gradient_boosting", GradientBoostingRegressor(**boosting)),
        ]
        final = Ridge(alpha=1.0 / float(p["regularization_strength"]))
        return cls(estimators=base, final_estimator=final, cv=folds, n_jobs=-1)

    def _new_calibration_base(self):
        """The calibrated classifier's base model (``base_model``), at settings
        that fit a 60-day fold in seconds."""
        choice = self.parameters["base_model"]
        if choice == "gradient_boosting_machine":
            from sklearn.ensemble import GradientBoostingClassifier

            return GradientBoostingClassifier(n_estimators=150, max_depth=3, learning_rate=0.05, subsample=0.8,
                                              random_state=self.seed)
        if choice == "random_forest":
            from sklearn.ensemble import RandomForestClassifier

            return RandomForestClassifier(n_estimators=300, max_depth=8, min_samples_leaf=20, max_features=0.5,
                                          n_jobs=-1, random_state=self.seed)
        if choice == "naive_bayes":
            from sklearn.naive_bayes import GaussianNB

            return GaussianNB()
        if choice == "logistic_regression":
            from sklearn.linear_model import LogisticRegression

            return LogisticRegression(max_iter=1000, random_state=self.seed)
        raise ValueError(f"{self.key}: unknown base model {choice!r}")

    # ── pacing ───────────────────────────────────────────────────────────
    def _fit_once(self, train_matrix, target, validation_matrix, validation_labels, validation_index, span,
                  reporter) -> float | None:
        """One library call on a daemon thread (Pause / Stop checked every
        0.2 s). The fit, the logistic curve or the calibration map, and the
        training and validation outputs are all computed on that thread."""
        calibrated = self.estimator_class.__name__ == "CalibratedClassifierCV"
        if (calibrated or self.uses_curve) and validation_labels.size == 0:
            raise ValueError(f"{self.key}: the validation rows are empty; the "
                             f"{'calibration map' if calibrated else 'logistic curve'} is fitted on them")
        score_training = self.entry["explainKind"] != "neighbors"   # a neighbour is its own nearest neighbour
        adapter = self

        def job():
            if calibrated:
                from sklearn.frozen import FrozenEstimator

                base = adapter._new_calibration_base()
                base.fit(train_matrix, target)
                estimator = adapter.estimator_class(FrozenEstimator(base),
                                                    method=adapter.parameters["calibration_method"])
                estimator.fit(validation_matrix, validation_labels.astype(np.int64))
            else:
                estimator = adapter._new_estimator()
                estimator.fit(train_matrix, target)
            curve = None
            if adapter.uses_curve:
                scores = np.asarray(estimator.decision_function(validation_matrix), dtype=np.float64).reshape(-1)
                curve = fit_logistic_curve(scores, validation_labels)
            adapter.logistic_curve = curve
            train_output = adapter._output(train_matrix, estimator) if score_training else None
            validation_output = adapter._output(validation_matrix, estimator) if validation_labels.size else None
            return estimator, train_output, validation_output

        reporter.epoch_started(1, 1)
        watch = Stopwatch()
        estimator, train_output, validation_output = run_single_fit(job, reporter, name=self.key)
        seconds = watch.seconds()
        if calibrated:
            _set_prediction_threads(estimator, 1)
            self.calibration_rows = np.asarray(validation_index, dtype=np.int64).copy()
        elif self.estimator_class.__name__.startswith("Stacking"):
            _set_prediction_threads(estimator, 1)
        self.estimator = estimator
        train_loss = self._scores(train_output, target)["loss"] if train_output is not None else None
        reporter.batch(BatchReport(
            epoch=1, epoch_count=1, batch=1, batch_count=1, span_start_index=span[0], span_end_index=span[1],
            train_loss=train_loss, samples_per_second=self.training_rows.size / seconds,
        ))
        scores = {"loss": None, "accuracy": None, "f1_score": None}
        if validation_output is not None:
            reporter.validating(1, 1)
            scores = self._scores(validation_output, validation_labels)
        reporter.epoch_finished(EpochReport(
            epoch=1, epoch_count=1, train_loss=train_loss, validation_loss=scores["loss"],
            validation_accuracy=scores["accuracy"], validation_f1_score=scores["f1_score"], is_best=True,
        ))
        if self.logistic_curve is not None:
            slope, intercept = self.logistic_curve
            reporter.log(
                f"{self.label}: P(up) = 1 / (1 + exp(-({slope:.4f} x decision value {intercept:+.4f}))) "
                f"fitted on {validation_labels.size:,} validation bars"
            )
        if calibrated:
            reporter.log(
                f"{self.label}: {self.parameters['base_model'].replace('_', ' ')} fitted on "
                f"{self.training_rows.size:,} training bars, {self.parameters['calibration_method']} calibration "
                f"fitted on {validation_labels.size:,} validation bars only"
            )
        return scores["loss"]

    def _fit_tree_chunks(self, train_matrix, target, validation_matrix, validation_labels, span,
                         reporter) -> float | None:
        """Trees grown in chunks with warm_start; every chunk sees the whole
        training window, and every tree is kept."""
        tree_count = int(self.parameters["tree_count"])
        chunk = max(MINIMUM_TREE_CHUNK, tree_count // TREE_CHUNKS)
        chunk_count = math.ceil(tree_count / chunk)
        estimator = self._new_estimator()
        matrix = np.ascontiguousarray(train_matrix, dtype=np.float32)
        best_loss = math.inf
        grown = 0
        for number in range(1, chunk_count + 1):
            reporter.checkpoint()
            reporter.epoch_started(number, chunk_count)
            watch = Stopwatch()
            estimator.n_estimators = min(tree_count, number * chunk)
            estimator.fit(matrix, target)
            added, grown = estimator.n_estimators - grown, estimator.n_estimators
            reporter.batch(BatchReport(
                epoch=number, epoch_count=chunk_count, batch=1, batch_count=1,
                span_start_index=span[0], span_end_index=span[1], train_loss=None,
                samples_per_second=self.training_rows.size * added / watch.seconds(),
            ))
            scores = {"loss": None, "accuracy": None, "f1_score": None}
            if validation_labels.size:
                reporter.validating(number, chunk_count)
                self.estimator = estimator
                scores = self._scores(self._output(validation_matrix, estimator), validation_labels)
            improved = scores["loss"] is not None and scores["loss"] < best_loss
            if improved:
                best_loss = scores["loss"]
            reporter.epoch_finished(EpochReport(
                epoch=number, epoch_count=chunk_count, train_loss=None, validation_loss=scores["loss"],
                validation_accuracy=scores["accuracy"], validation_f1_score=scores["f1_score"], is_best=improved,
            ))
        self.estimator = estimator
        self.best_iteration = None
        return None if math.isinf(best_loss) else best_loss

    def _fit_rounds(self, train_matrix, target, validation_matrix, validation_labels, span,
                    reporter) -> float | None:
        """Gradient boosting grown ten rounds per step with warm_start. Every
        round is scored on the validation rows; after ``early_stopping_rounds``
        rounds without a better validation loss the fit stops, and the
        ensemble is cut back to its best round."""
        total = int(self.parameters["boosting_rounds"])
        patience = int(self.parameters["early_stopping_rounds"])
        classification = self.task == "classification"
        estimator = self._new_estimator()
        matrix = np.ascontiguousarray(train_matrix, dtype=np.float32)
        training_stages = _Stages(matrix, classification)
        validation_stages = _Stages(validation_matrix, classification) if validation_labels.size else None
        best_loss, best_round, trained = math.inf, 0, 0
        stopped_early = False
        for first in range(1, total + 1, ROUNDS_PER_STEP):
            last = min(total, first + ROUNDS_PER_STEP - 1)
            reporter.checkpoint()
            reporter.epoch_started(first, total)
            watch = Stopwatch()
            estimator.n_estimators = last
            estimator.fit(matrix, target)
            trained = last
            train_loss = self._scores(self._stage_output(training_stages.advance(estimator, last)[-1]), target)["loss"]
            reporter.batch(BatchReport(
                epoch=last, epoch_count=total, batch=1, batch_count=1, span_start_index=span[0],
                span_end_index=span[1], train_loss=train_loss,
                samples_per_second=self.training_rows.size * (last - first + 1) / watch.seconds(),
            ))
            scores = {"loss": None, "accuracy": None, "f1_score": None}
            improved = False
            if validation_stages is not None:
                reporter.validating(last, total)
                for number, raw in enumerate(validation_stages.advance(estimator, last), start=first):
                    loss = self._scores(self._stage_output(raw), validation_labels)["loss"]
                    if loss is not None and loss < best_loss:
                        best_loss, best_round, improved = loss, number, True
                scores = self._scores(self._stage_output(validation_stages.raw), validation_labels)
                stopped_early = last - best_round >= patience and last < total
            reporter.epoch_finished(EpochReport(
                epoch=last, epoch_count=total, train_loss=train_loss, validation_loss=scores["loss"],
                validation_accuracy=scores["accuracy"], validation_f1_score=scores["f1_score"],
                is_best=improved, stopped_early=stopped_early,
            ))
            if stopped_early:
                break
        if validation_stages is None or best_round == 0:
            best_round = trained
        if best_round < trained:
            _keep_first_rounds(estimator, best_round)
        self.estimator = estimator
        self.best_iteration = int(best_round)
        loss_name = "mean absolute error" if self.task == "regression" else "log loss"
        reporter.log(
            f"{self.label}: grew {trained} of {total} rounds"
            + (f", stopped after {patience} rounds without a better validation {loss_name}" if stopped_early else "")
            + f"; kept the first {best_round} rounds (lowest validation {loss_name})"
        )
        return None if math.isinf(best_loss) else best_loss

    def _stage_output(self, raw: np.ndarray) -> np.ndarray:
        if self.task == "regression":
            return raw
        return 1.0 / (1.0 + np.exp(-np.clip(raw, -500.0, 500.0)))

    def _fit_epochs(self, train_matrix, target, validation_matrix, validation_labels, span,
                    reporter) -> float | None:
        """partial_fit one pass over the training rows per epoch; the epoch
        with the lowest validation loss is kept; stops after ``patience``
        epochs without a better one."""
        epochs = int(self.parameters["epochs"])
        patience = int(self.parameters["patience"])
        estimator = self._new_estimator()
        classes = np.array([0, 1], dtype=np.int64) if self.task == "classification" else None
        best_loss, best_epoch, best_estimator, waited = math.inf, 0, None, 0
        epoch = 0
        for epoch in range(1, epochs + 1):
            reporter.checkpoint()
            reporter.epoch_started(epoch, epochs)
            watch = Stopwatch()
            if classes is not None:
                estimator.partial_fit(train_matrix, target, classes=classes)
            else:
                estimator.partial_fit(train_matrix, target)
            seconds = watch.seconds()
            train_loss = self._scores(self._output(train_matrix, estimator), target)["loss"]
            reporter.batch(BatchReport(
                epoch=epoch, epoch_count=epochs, batch=1, batch_count=1, span_start_index=span[0],
                span_end_index=span[1], train_loss=train_loss, samples_per_second=self.training_rows.size / seconds,
            ))
            scores = {"loss": None, "accuracy": None, "f1_score": None}
            improved = False
            if validation_labels.size:
                reporter.validating(epoch, epochs)
                scores = self._scores(self._output(validation_matrix, estimator), validation_labels)
                if scores["loss"] is not None and scores["loss"] < best_loss:
                    best_loss, best_epoch, best_estimator, waited = scores["loss"], epoch, copy.deepcopy(estimator), 0
                    improved = True
                else:
                    waited += 1
            stopped_early = bool(validation_labels.size) and waited >= patience and epoch < epochs
            reporter.epoch_finished(EpochReport(
                epoch=epoch, epoch_count=epochs, train_loss=train_loss, validation_loss=scores["loss"],
                validation_accuracy=scores["accuracy"], validation_f1_score=scores["f1_score"],
                is_best=improved, stopped_early=stopped_early,
            ))
            if stopped_early:
                break
        if best_estimator is None:
            best_estimator, best_epoch = estimator, epoch
            if validation_labels.size:
                reporter.log(f"{self.label}: no epoch had a finite validation loss; kept the last epoch", "warn")
        self.estimator = best_estimator
        self.best_iteration = int(best_epoch)
        reporter.log(f"{self.label}: kept epoch {best_epoch} of {epoch} (lowest validation loss)")
        return None if math.isinf(best_loss) else best_loss

    def _log_warnings(self, caught, reporter) -> None:
        """Library warnings raised during the fit, once each (a few at most).
        The warm-start notice about balanced class weights is expected: every
        chunk refits the same rows."""
        seen: list[str] = []
        for warning in caught:
            text = f"{warning.category.__name__}: {warning.message}"
            if "warm_start" in text or text in seen:
                continue
            seen.append(text)
        for text in seen[:WARNINGS_LOGGED]:
            reporter.log(f"{self.label}: {text}", "warn")


__all__ = ["SklearnEstimatorAdapter", "import_estimator"]
