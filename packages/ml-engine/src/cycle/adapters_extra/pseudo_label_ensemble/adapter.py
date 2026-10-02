"""``PseudoLabelEnsembleAdapter``: classical semi-supervised bootstrapping.

Five catalog specs grow their own labelled set from an unlabelled pool, one
reported solver pass per round:

    variant           spec                                   module
    self_training     Self-Training Classifier               bootstrapping.SelfTraining
    tri_training      Tri-Training (Zhou and Li 2005)        bootstrapping.TriTraining
    co_training       Co-Training, dual view (Blum-Mitchell) multiview.CoTraining
    co_em             Multi-View Learning (co-EM consensus)  multiview.CoEM
    transductive_svm  S3VM (Joachims' transductive SVM)      transductive.TransductiveSupportVectorMachine

The pool: labels are masked in contiguous blocks with an embargo of the label
horizon (``graph_label_inference.nodes.semi_supervised_split``, shared with the
graph family); every other finite row of the training span is unlabelled.
Only span rows are ever pseudo-labelled — never a validation or test row. The
validation rows are scored after each pass (and fit the transductive SVM's
P(up) curve), nothing else. Prediction at bar t reads feature row t only; the
views of the multi-view variants are fixed at fit from the run's feature names
(``bridges.groups.split_views``) and saved with the model.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np

from cycle.bridges import persistence
from cycle.bridges.base import BridgeAdapter
from cycle.bridges.calibration import ValidationCurve
from cycle.bridges.groups import split_views

from ..graph_label_inference.nodes import finite_rows, semi_supervised_split
from .base import FitContext
from .bootstrapping import SelfTraining, TriTraining
from .multiview import CoEM, CoTraining
from .transductive import TransductiveSupportVectorMachine

LOOPS = {"self_training": SelfTraining, "tri_training": TriTraining, "co_training": CoTraining, "co_em": CoEM,
         "transductive_svm": TransductiveSupportVectorMachine}
VARIANTS = tuple(LOOPS)
VIEW_VARIANTS = ("co_training", "co_em")
LAYOUT_FILE = "pseudo_label_ensemble.json"


class PseudoLabelEnsembleAdapter(BridgeAdapter):
    needs_market = True
    step_unit = "solver_pass"
    model_file = LAYOUT_FILE

    def __init__(self, key: str, entry: dict, parameters: dict, device: str, seed: int,
                 task: str = "classification") -> None:
        super().__init__(key, entry, parameters, device, seed, task)
        if self.variant not in LOOPS:
            raise ValueError(f"{key}: unknown pseudo-label variant {self.variant!r}; known: {', '.join(VARIANTS)}")
        if task == "regression" and self.variant == "transductive_svm":
            raise ValueError(f"{key}: the transductive SVM has no price model (its registry price is null)")
        self.loop = None
        self.curve: ValidationCurve | None = None

    def _library_versions(self) -> dict[str, str]:
        return persistence.library_versions("numpy", "scikit-learn")

    def _views(self, names, feature_count: int) -> list[list[int]]:
        count = 2 if self.variant == "co_training" else int(self.parameters["view_count"])
        names = list(names or ())
        if len(names) != feature_count:
            names = [f"column_{position}" for position in range(feature_count)]
        views = [columns for columns in split_views(names, count, self.seed) if columns]
        if len(views) < 2:
            raise ValueError(f"{self.key}: the {feature_count} feature columns cannot make two views")
        return views

    # ── fitting ──
    def _fit(self, features, labels, train_index, validation_index, timestamps, reporter) -> None:
        view = self.require_market()
        targets = np.asarray(labels, dtype=np.float64).copy()
        split = semi_supervised_split(features, targets, train_index,
                                      labeled_fraction=float(self.parameters["labeled_fraction"]),
                                      block_bars=int(self.parameters["masking_block_bars"]),
                                      horizon=int(view.horizon), seed=self.seed)
        if split.labelled.size < 20:
            raise ValueError(f"{self.key}: only {split.labelled.size} labelled rows after masking; raise labeled_fraction")
        if self.task == "regression":
            from cycle.models import clip_training_target

            targets[split.labelled], _, _ = clip_training_target(targets[split.labelled])
        validation_rows = finite_rows(features, validation_index)
        validation_rows = validation_rows[np.isfinite(targets[validation_rows])]
        self.loop = LOOPS[self.variant](self.parameters, self.seed, self.task)
        if self.variant in VIEW_VARIANTS:
            self.loop.views = self._views(view.feature_names, int(features.shape[1]))
        context = FitContext(features=features, targets=targets, labelled=split.labelled, unlabelled=split.unlabelled,
                             validation=validation_rows, task=self.task, reporter=reporter, name=self.key)
        summary = {"variant": self.variant, "labelled_row_count": int(split.labelled.size),
                   "unlabelled_row_count": int(split.unlabelled.size),
                   "hidden_block_count": int(split.hidden_block_count), "block_count": int(split.block_count)}
        summary.update(self.loop.fit(context))
        summary["pseudo_labelled_row_count"] = int(self.loop.pseudo_labelled_rows.size)
        if self.task == "classification" and self.loop.decision_score:
            # P(up) of a decision value: a logistic curve fitted on the validation rows only
            raw = self.loop.score(context.matrix(validation_rows)) if validation_rows.size else np.empty(0)
            self.curve = ValidationCurve.fit(raw, targets[validation_rows])
            summary["validation_curve"] = self.curve.to_dict()
        reporter.log(f"{self.key}: {self.variant} from {split.labelled.size} labelled and {split.unlabelled.size} "
                     f"unlabelled span rows ({split.hidden_block_count} of {split.block_count} blocks hidden, embargo "
                     f"{int(view.horizon)} bars); {self.loop.pseudo_labelled_rows.size} rows pseudo-labelled in "
                     f"{summary.get('solver_passes')} passes")
        self.fit_summary = summary

    # ── prediction ──
    def _predict_rows(self, features, index) -> np.ndarray:
        index = np.asarray(index, dtype=np.int64)
        matrix = np.asarray(features[index], dtype=np.float64)
        out = np.full(index.size, np.nan, dtype=np.float64)
        usable = np.all(np.isfinite(matrix), axis=1)
        if usable.any():
            raw = self.loop.score(matrix[usable])
            if self.task == "classification" and self.loop.decision_score:
                raw = self.curve.apply(raw) if self.curve is not None else np.full(raw.shape, np.nan)
            out[usable] = raw
        return out

    def _predict_probability(self, features, index) -> np.ndarray:
        return self._predict_rows(features, index)

    def _predict_value(self, features, index) -> np.ndarray:
        return self._predict_rows(features, index)

    # ── persistence ──
    def _save_state(self, folder: Path) -> str:
        layout = {"variant": self.variant, "task": self.task, "loop": self.loop.save(folder),
                  "curve": None if self.curve is None else self.curve.to_dict()}
        persistence.save_json(folder / LAYOUT_FILE, layout)
        return LAYOUT_FILE

    def _load_state(self, folder: Path, metadata: dict) -> None:
        layout = persistence.load_json(folder / LAYOUT_FILE)
        self.loop = LOOPS[self.variant](self.parameters, self.seed, self.task)
        self.loop.restore(folder, layout["loop"])
        self.curve = None if layout.get("curve") is None else ValidationCurve.from_dict(layout["curve"])


__all__ = ["PseudoLabelEnsembleAdapter", "VARIANTS"]
