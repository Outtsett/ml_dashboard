"""``GraphLabelInferenceAdapter``: graph and cluster semi-supervised label inference.

Five catalog specs infer labels over the geometry of the training span's bars:

    variant             spec                                         module
    label_propagation   Label Propagation (sklearn, hard clamping)   methods.PropagatedLabels
    label_spreading     Label Spreading (sklearn, soft clamping)     methods.PropagatedLabels
    harmonic            Graph-based SSL (Gaussian random field)      methods.HarmonicField
    laplacian_rls       Manifold regularisation (Laplacian RLS)      methods.LaplacianRegularisedLeastSquares
    constrained_kmeans  Semi-supervised clustering (seeded COP)      methods.ConstrainedKMeans

The semi-supervised premise needs an unlabelled pool, so the fit masks labels
in contiguous blocks with an embargo of the label horizon (``nodes.py``): a
``labeled_fraction`` of the blocks keep their labels, every other finite row
of the span is an unlabelled node. Nodes are the span's rows only (capped at
``maximum_graph_nodes``, evenly spaced), standardised with the nodes' own
column mean and deviation. A later bar is scored by the inductive extension
against the fitted nodes (never added to the graph), reading its own feature
row only. ``laplacian_rls`` maps its decision value to P(up) with a logistic
curve fitted on the validation rows; the other variants' scores are already
probabilities. Nothing reads the market view at prediction time.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np

from cycle.bridges import persistence
from cycle.bridges.base import BridgeAdapter
from cycle.bridges.calibration import ValidationCurve
from cycle.bridges.training import score, single_fit

from .graph import Standardiser
from .methods import VARIANTS, build_method
from .nodes import capped_nodes, finite_rows, semi_supervised_split

MODEL_FILE = "graph_label_inference.npz"
LAYOUT_FILE = "graph_label_inference.json"
CURVE_VARIANTS = ("laplacian_rls",)


class GraphLabelInferenceAdapter(BridgeAdapter):
    needs_market = True
    step_unit = "single_fit"
    model_file = MODEL_FILE

    def __init__(self, key: str, entry: dict, parameters: dict, device: str, seed: int,
                 task: str = "classification") -> None:
        super().__init__(key, entry, parameters, device, seed, task)
        if self.variant not in VARIANTS:
            raise ValueError(f"{key}: unknown graph label inference variant {self.variant!r}; known: {', '.join(VARIANTS)}")
        if task == "regression" and self.variant == "label_propagation":
            raise ValueError(f"{key}: label propagation has no price model (its registry price is null)")
        self.method = None
        self.standardiser: Standardiser | None = None
        self.curve: ValidationCurve | None = None
        self.node_rows: np.ndarray | None = None
        self.labelled_rows: np.ndarray | None = None

    def _library_versions(self) -> dict[str, str]:
        return persistence.library_versions("numpy", "scipy", "scikit-learn")

    # ── fitting ──
    def _fit(self, features, labels, train_index, validation_index, timestamps, reporter) -> None:
        view = self.require_market()
        targets = np.asarray(labels, dtype=np.float64)
        split = semi_supervised_split(features, targets, train_index,
                                      labeled_fraction=float(self.parameters["labeled_fraction"]),
                                      block_bars=int(self.parameters["masking_block_bars"]),
                                      horizon=int(view.horizon), seed=self.seed)
        if split.labelled.size < 10:
            raise ValueError(f"{self.key}: only {split.labelled.size} labelled rows after masking; raise labeled_fraction")
        labelled_nodes, unlabelled_nodes = capped_nodes(split, int(self.parameters["maximum_graph_nodes"]))
        node_rows = np.sort(np.concatenate([labelled_nodes, unlabelled_nodes]))
        is_labelled = np.isin(node_rows, labelled_nodes)
        node_targets = np.full(node_rows.size, np.nan, dtype=np.float64)
        node_targets[is_labelled] = targets[node_rows[is_labelled]]
        if self.task == "regression":
            from cycle.models import clip_training_target

            node_targets[is_labelled], _, _ = clip_training_target(node_targets[is_labelled])
        matrix = np.asarray(features[node_rows], dtype=np.float64)
        self.standardiser = Standardiser.fit(matrix)
        self.method = build_method(self.variant, self.parameters, self.seed, self.task)
        self.node_rows, self.labelled_rows = node_rows, node_rows[is_labelled]
        validation_rows = finite_rows(features, validation_index)
        validation_rows = validation_rows[np.isfinite(targets[validation_rows])]
        summary = {"variant": self.variant, "node_count": int(node_rows.size),
                   "labelled_node_count": int(is_labelled.sum()),
                   "unlabelled_node_count": int(node_rows.size - is_labelled.sum()),
                   "labelled_row_count": int(split.labelled.size), "unlabelled_row_count": int(split.unlabelled.size),
                   "hidden_block_count": int(split.hidden_block_count), "block_count": int(split.block_count)}

        def fit_all():
            summary.update(self.method.fit(self.standardiser.apply(matrix), is_labelled, node_targets))
            if self.task == "classification" and self.variant in CURVE_VARIANTS:
                # the decision value's P(up) curve: fitted on the validation rows only
                raw = self.method.score(self.standardiser.apply(features[validation_rows]))
                self.curve = ValidationCurve.fit(raw, targets[validation_rows])
                summary["validation_curve"] = self.curve.to_dict()
            return None

        def validate():
            return score(self.task, self._predict_rows(features, validation_rows), targets[validation_rows])

        epochs = single_fit(reporter, train_index=node_rows, fit=fit_all, validate=validate, name=self.key)
        summary["validation_loss"] = epochs["best_validation_loss"]
        reporter.log(f"{self.key}: {self.variant} over {node_rows.size} span nodes ({int(is_labelled.sum())} "
                     f"labelled, {int(node_rows.size - is_labelled.sum())} unlabelled; {split.hidden_block_count} "
                     f"of {split.block_count} blocks hidden, embargo {int(view.horizon)} bars)")
        self.fit_summary = summary

    # ── prediction ──
    def _predict_rows(self, features, index) -> np.ndarray:
        index = np.asarray(index, dtype=np.int64)
        if index.size == 0:
            return np.empty(0, dtype=np.float64)
        raw = self.method.score(self.standardiser.apply(np.asarray(features[index], dtype=np.float64)))
        if self.task == "classification" and self.variant in CURVE_VARIANTS:
            if self.curve is None:
                return np.full(index.size, np.nan)
            return self.curve.apply(raw)
        return raw

    def _predict_probability(self, features, index) -> np.ndarray:
        return self._predict_rows(features, index)

    def _predict_value(self, features, index) -> np.ndarray:
        return self._predict_rows(features, index)

    # ── persistence ──
    def _save_state(self, folder: Path) -> str:
        arrays = {f"method_{name}": value for name, value in self.method.arrays().items()}
        persistence.save_arrays(folder / MODEL_FILE, standard_mean=self.standardiser.mean,
                                standard_scale=self.standardiser.scale, node_rows=self.node_rows,
                                labelled_rows=self.labelled_rows, **arrays)
        persistence.save_json(folder / LAYOUT_FILE, {"variant": self.variant, "task": self.task,
                                                     "curve": None if self.curve is None else self.curve.to_dict()})
        return MODEL_FILE

    def _load_state(self, folder: Path, metadata: dict) -> None:
        arrays = persistence.load_arrays(folder / MODEL_FILE)
        layout = persistence.load_json(folder / LAYOUT_FILE)
        self.standardiser = Standardiser(arrays["standard_mean"], arrays["standard_scale"])
        self.node_rows, self.labelled_rows = arrays["node_rows"], arrays["labelled_rows"]
        self.method = build_method(self.variant, self.parameters, self.seed, self.task)
        self.method.restore({name[len("method_"):]: value for name, value in arrays.items() if name.startswith("method_")})
        self.curve = None if layout.get("curve") is None else ValidationCurve.from_dict(layout["curve"])


__all__ = ["GraphLabelInferenceAdapter"]
