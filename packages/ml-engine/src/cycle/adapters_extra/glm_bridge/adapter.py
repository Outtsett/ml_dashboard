"""``GlmBridgeAdapter``: the ``glm_bridge`` family's Model Cycle adapter.

Fit (one ``single_fit`` step, the statsmodels call on a daemon thread that is
checkpointed every 0.2 s, ``cycle.fitting.run_single_fit``):

1. the training rows: ``train_index`` rows with a known scaled move (the
   price target, read from the bound ``MarketView`` at those rows only) and a
   finite feature row; ``glm_link``'s direction model uses the rows with a
   known up / down label instead;
2. ``design.Standardiser`` fitted on those rows, an intercept column in front;
3. the variant's mechanism (``variants.MECHANISMS``) fitted on them;
4. when the mechanism's P(up) is a score and not a probability (gamma,
   poisson, zero_inflated_poisson) a logistic curve fitted on the VALIDATION
   rows (``bridges.calibration.ValidationCurve``): against the label for the
   direction model, against the sign of the scaled move for a price model that
   needs P(up) (gamma).

Predict reads the bar's own feature row only. Saved as ``model.npz`` (the
standardiser, the mechanism's coefficient arrays) plus ``state.json`` (the
link and the curve) and ``model.json``.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np

from cycle.bridges import calibration, persistence, training
from cycle.bridges.base import BridgeAdapter
from cycle.fitting import run_single_fit

from . import design as designs
from .variants import MECHANISMS, FitContext


class GlmBridgeAdapter(BridgeAdapter):
    step_unit = "single_fit"
    model_file = "model.npz"
    state_file = "state.json"

    def __init__(self, key, entry, parameters, device, seed, task="classification") -> None:
        super().__init__(key, entry, parameters, device, seed, task)
        if self.variant not in MECHANISMS:
            raise ValueError(f"{key}: unknown glm_bridge variant {self.variant!r}; one of {', '.join(MECHANISMS)}")
        self.mechanism = MECHANISMS[self.variant](self.parameters, task)
        self.standardiser: designs.Standardiser | None = None
        self.curve: calibration.ValidationCurve | None = None

    # ── fit ──
    def _fit(self, features, labels, train_index, validation_index, timestamps, reporter) -> None:
        view = self.require_market()
        labels = np.asarray(labels, dtype=np.float64)
        rows = designs.training_rows(view, features, train_index)
        if self.variant == "glm_link" and self.task == "classification":
            rows = designs.finite_rows(features, train_index[np.isfinite(labels[train_index])])
        if rows.size < 30:
            raise ValueError(f"{self.key}: {rows.size} usable training rows; a GLM needs at least 30")
        self.standardiser = designs.Standardiser.fit(features, rows)
        context = FitContext(design=self._design(features, rows), rows=rows,
                             target=np.asarray(view.price_targets, dtype=np.float64)[rows],
                             labels=labels[rows] if self.task == "classification" else np.full(rows.size, np.nan),
                             view=view, parameters=self.parameters, task=self.task,
                             log=lambda message, level="info": reporter.log(message, level))
        validation_rows = designs.finite_rows(features, validation_index)

        def fit() -> float | None:
            run_single_fit(lambda: self.mechanism.fit(context), reporter, name=f"{self.key} fit")
            self._calibrate(features, labels, validation_rows, view)
            return None

        def validate() -> training.ValidationScore:
            if validation_rows.size == 0:
                return training.ValidationScore(None, None, None, None)
            if self.task == "classification":
                return training.score("classification", self._predict_probability(features, validation_rows),
                                      labels[validation_rows])
            return training.score("regression", self._predict_value(features, validation_rows), labels[validation_rows])

        summary = training.single_fit(reporter, train_index=rows, fit=fit, validate=validate, name=self.key)
        reporter.log(f"{self.key}: {self.variant} fitted on {rows.size:,} training rows, "
                     f"{self.standardiser.columns.size} of {features.shape[1]} features kept", "info")
        self.fit_summary = {"variant": self.variant, "training_rows": int(rows.size),
                            "kept_feature_count": int(self.standardiser.columns.size), **self.mechanism.summary,
                            "fit_seconds": summary["fit_seconds"]}

    def _calibrate(self, features, labels, validation_rows, view) -> None:
        """The validation curve (validation rows only) where P(up) is a score."""
        mechanism = self.mechanism
        needs_curve = not mechanism.native_probability and (self.task == "classification" or mechanism.value_needs_curve)
        if not needs_curve:
            return
        if self.task == "classification":
            outcome = labels[validation_rows]
        else:
            move = np.asarray(view.price_targets, dtype=np.float64)[validation_rows]
            outcome = np.where(np.isfinite(move) & (move != 0.0), (move > 0.0).astype(np.float64), np.nan)
        score = mechanism.direction(self._design(features, validation_rows)) if validation_rows.size else np.empty(0)
        self.curve = calibration.ValidationCurve.fit(score, outcome)
        mechanism.curve = self.curve

    # ── predict ──
    def _design(self, features, rows) -> np.ndarray:
        block = self.standardiser.transform(features, rows)
        return np.column_stack([np.ones(block.shape[0]), block])

    def _predict_probability(self, features, index) -> np.ndarray:
        design = self._design(features, index)
        out = np.asarray(self.mechanism.direction(design), dtype=np.float64)
        if not self.mechanism.native_probability:
            out = self.curve.apply(out)
        out[~np.all(np.isfinite(design), axis=1)] = np.nan
        return out

    def _predict_value(self, features, index) -> np.ndarray:
        design = self._design(features, index)
        out = np.asarray(self.mechanism.value(design), dtype=np.float64)
        out[~np.all(np.isfinite(design), axis=1)] = np.nan
        return out

    # ── save / load ──
    def _library_versions(self) -> dict[str, str]:
        return persistence.library_versions("numpy", "scipy", "statsmodels")

    def _save_state(self, folder: Path) -> str:
        arrays = {**self.standardiser.to_arrays(), **{f"mechanism_{name}": value
                                                        for name, value in self.mechanism.arrays().items()}}
        persistence.save_arrays(folder / self.model_file, **arrays)
        persistence.save_json(folder / self.state_file, {"mechanism": self.mechanism.document(),
                                                         "curve": None if self.curve is None else self.curve.to_dict()})
        return self.model_file

    def _load_state(self, folder: Path, metadata: dict) -> None:
        arrays = persistence.load_arrays(folder / self.model_file)
        document = persistence.load_json(folder / self.state_file)
        self.standardiser = designs.Standardiser.from_arrays(arrays)
        self.mechanism = MECHANISMS[self.variant](self.parameters, self.task)
        prefix = "mechanism_"
        self.mechanism.restore({name[len(prefix):]: value for name, value in arrays.items() if name.startswith(prefix)},
                               document["mechanism"])
        self.curve = None if document["curve"] is None else calibration.ValidationCurve.from_dict(document["curve"])
        self.mechanism.curve = self.curve


__all__ = ["GlmBridgeAdapter"]
