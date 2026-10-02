"""``BayesianPredictiveAdapter``: the ``bayesian_predictive`` family's Model Cycle adapter.

Fit:

1. the training rows: ``train_index`` rows with a known scaled move (the price
   target, read from the bound ``MarketView`` at those rows only) and a finite
   feature row, in time order;
2. ``glm_bridge.design.Standardiser`` fitted on them (constant columns dropped);
3. the target: the scaled move, clipped at its training 1st / 99th percentiles
   for the Gaussian engines (the Student-t engine takes it unclipped: its fat
   tail is the point);
4. the variant's engine: ``conjugate_linear``, ``gaussian_process`` and
   ``pymc_student_t`` as one ``single_fit`` step (the first two on a daemon
   thread checkpointed every 0.2 s; nutpie's background sampler is
   checkpointed by the engine), ``hierarchical_gibbs`` one epoch per chain.

P(up) is the engine's posterior-predictive mass above 0 (no fitted curve);
the price model is the predictive mean. The validation rows are only scored
(the epoch's validation loss). Predict reads the bar's feature row and, for
the hierarchical engine, the bar's own timestamp from the bound view.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np

from cycle.adapters_extra.glm_bridge import design as designs
from cycle.bridges import persistence, training
from cycle.bridges.base import BridgeAdapter
from cycle.fitting import run_single_fit

VARIANTS = ("conjugate_linear", "gaussian_process", "pymc_student_t", "hierarchical_gibbs")
UNCLIPPED = ("pymc_student_t",)


class _Context:
    def __init__(self, reporter) -> None:
        self.reporter = reporter

    def log(self, message: str, level: str = "info") -> None:
        self.reporter.log(message, level)

    def checkpoint(self) -> None:
        self.reporter.checkpoint()


def build_engine(variant: str, parameters: dict, seed: int):
    if variant == "conjugate_linear":
        from .conjugate import ConjugateLinear

        return ConjugateLinear(parameters)
    if variant == "gaussian_process":
        from .gaussian_process import GaussianProcess

        return GaussianProcess(parameters, seed)
    if variant == "pymc_student_t":
        from .probabilistic_program import ProbabilisticProgram

        return ProbabilisticProgram(parameters, seed)
    if variant == "hierarchical_gibbs":
        from .hierarchical import HierarchicalGibbs

        return HierarchicalGibbs(parameters, seed)
    raise ValueError(f"unknown bayesian_predictive variant {variant!r}; one of {', '.join(VARIANTS)}")


class BayesianPredictiveAdapter(BridgeAdapter):
    model_file = "model.npz"
    state_file = "state.json"

    def __init__(self, key, entry, parameters, device, seed, task="classification") -> None:
        super().__init__(key, entry, parameters, device, seed, task)
        if self.variant not in VARIANTS:
            raise ValueError(f"{key}: unknown bayesian_predictive variant {self.variant!r}; one of {', '.join(VARIANTS)}")
        self.step_unit = "epoch" if self.variant == "hierarchical_gibbs" else "single_fit"
        self.engine = build_engine(self.variant, self.parameters, self.seed)
        self.standardiser: designs.Standardiser | None = None

    # ── fit ──
    def _fit(self, features, labels, train_index, validation_index, timestamps, reporter) -> None:
        view = self.require_market()
        labels = np.asarray(labels, dtype=np.float64)
        rows = designs.training_rows(view, features, train_index)
        if rows.size < 30:
            raise ValueError(f"{self.key}: {rows.size} usable training rows; the model needs at least 30")
        self.standardiser = designs.Standardiser.fit(features, rows)
        x = self.standardiser.transform(features, rows)
        target = np.asarray(view.price_targets, dtype=np.float64)[rows]
        if self.variant not in UNCLIPPED:
            low, high = designs.percentile_bounds(target)
            target = np.clip(target, low, high)
        context = _Context(reporter)
        validation_rows = designs.finite_rows(features, validation_index)

        def validate() -> training.ValidationScore:
            if validation_rows.size == 0:
                return training.ValidationScore(None, None, None, None)
            if self.task == "classification":
                return training.score("classification", self._predict_probability(features, validation_rows),
                                      labels[validation_rows])
            return training.score("regression", self._predict_value(features, validation_rows), labels[validation_rows])

        if self.variant == "hierarchical_gibbs":
            engine = self.engine
            engine.start(x, target, self._groups(rows))
            summary = training.run_epochs(
                reporter, epoch_count=int(self.parameters["chain_count"]), train_index=rows,
                train_epoch=lambda epoch, report_batch: engine.run_chain(epoch - 1, reporter.checkpoint),
                validate=lambda epoch: validate(), name=self.key)
            engine.finish(context)
        elif self.variant == "pymc_student_t":
            summary = training.single_fit(reporter, train_index=rows, fit=lambda: self.engine.fit(x, target, context),
                                          validate=validate, name=self.key)
        else:
            summary = training.single_fit(
                reporter, train_index=rows,
                fit=lambda: run_single_fit(lambda: self.engine.fit(x, target, context), reporter, name=f"{self.key} fit"),
                validate=validate, name=self.key)
        reporter.log(f"{self.key}: {self.variant} fitted on {rows.size:,} training rows, "
                     f"{self.standardiser.columns.size} of {features.shape[1]} features kept", "info")
        self.fit_summary = {"variant": self.variant, "training_rows": int(rows.size),
                            "kept_feature_count": int(self.standardiser.columns.size), **self.engine.summary,
                            "fit_seconds": summary["fit_seconds"]}

    def _groups(self, rows) -> np.ndarray | None:
        if self.variant != "hierarchical_gibbs":
            return None
        from .hierarchical import session_blocks

        view = self.market
        if view is None:
            raise RuntimeError(f"{self.key}: the session blocks come from the bars' timestamps; bind the market view")
        return session_blocks(np.asarray(view.timestamps)[np.asarray(rows, dtype=np.int64)],
                              int(self.parameters["session_block_count"]))

    # ── predict ──
    def _predictive(self, features, index) -> tuple[np.ndarray, np.ndarray]:
        x = self.standardiser.transform(features, index)
        known = np.all(np.isfinite(x), axis=1)
        mean, probability = (np.full(index.size, np.nan) for _ in range(2))
        if known.any():
            groups = self._groups(index[known])
            mean[known], probability[known] = self.engine.predictive(x[known], groups)
        return mean, probability

    def _predict_probability(self, features, index) -> np.ndarray:
        return self._predictive(features, index)[1]

    def _predict_value(self, features, index) -> np.ndarray:
        return self._predictive(features, index)[0]

    # ── save / load ──
    def _library_versions(self) -> dict[str, str]:
        extra = {"gaussian_process": ("scikit-learn",), "pymc_student_t": ("pymc", "nutpie", "pytensor")}
        return persistence.library_versions("numpy", "scipy", *extra.get(self.variant, ()))

    def _save_state(self, folder: Path) -> str:
        persistence.save_arrays(folder / self.model_file, **self.standardiser.to_arrays(),
                                **{f"engine_{name}": value for name, value in self.engine.arrays().items()})
        persistence.save_json(folder / self.state_file, {"engine": self.engine.document()})
        return self.model_file

    def _load_state(self, folder: Path, metadata: dict) -> None:
        arrays = persistence.load_arrays(folder / self.model_file)
        document = persistence.load_json(folder / self.state_file)
        self.step_unit = "epoch" if self.variant == "hierarchical_gibbs" else "single_fit"
        self.standardiser = designs.Standardiser.from_arrays(arrays)
        self.engine = build_engine(self.variant, self.parameters, self.seed)
        prefix = "engine_"
        self.engine.restore({name[len(prefix):]: value for name, value in arrays.items() if name.startswith(prefix)},
                            document["engine"])


__all__ = ["BayesianPredictiveAdapter", "VARIANTS"]
