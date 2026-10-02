"""``BarrierSurvivalAdapter``: survival models of the time to a barrier touch
as Model Cycle adapters (build plan §1.1 family 12).

Every bar of the training span (every ``sampling_stride_bars``-th) starts a
walk: bars until the close touches +/- ``barrier_distance`` move scales, the
side it touched, or censoring at the maximum hold, a session gap or the fold
limit train_index[-1] + h (``durations.py``, closes only). A survival model
fits those walks with the feature row of the starting bar as covariates, and
P(up) at bar t is the race between the up and down clocks within the label
horizon h:

    P(up) = CIF_up(h | x_t) / (CIF_up(h | x_t) + CIF_down(h | x_t))

(0.5 when neither barrier is expected within h). Variants
(``direction.fixed.variant``):

    kaplan_meier         Aalen-Johansen per stratum of a train-fitted depth-``max_depth`` tree (``strata.py``)
    cox                  cause-specific Cox, Breslow baselines (``hazards.py``)
    aft                  Weibull / log-normal / log-logistic AFT per side, by AIC (``accelerated.py``)
    exponential_mixture  covariate-weighted exponential mixture per side, EM (``mixture.py``)

Prediction reads only the feature row of the bar (the covariates), so it is
causal by construction; the fit reads closes up to the fold limit. There is no
price model (registry ``price: null``).
"""

from __future__ import annotations

from pathlib import Path

import numpy as np

from cycle.bridges import persistence
from cycle.bridges.base import BridgeAdapter
from cycle.bridges.training import run_epochs, score, single_fit

from . import durations as barrier_walks
from . import incidence

VARIANTS = ("kaplan_meier", "cox", "aft", "exponential_mixture")
STATE_FILE = "survival.json"


class BarrierSurvivalAdapter(BridgeAdapter):
    model_file = "model.npz"

    def __init__(self, key: str, entry: dict, parameters: dict, device: str, seed: int,
                 task: str = "classification") -> None:
        super().__init__(key, entry, parameters, device, seed, task)
        if self.variant not in VARIANTS:
            raise ValueError(f"{key}: barrier_survival variant must be one of {VARIANTS}, got {self.variant!r}")
        if task != "classification":
            raise ValueError(f"{key}: a barrier survival model predicts which barrier is touched first; it has no "
                             "price model (task 'regression')")
        self.step_unit = "epoch" if self.variant == "exponential_mixture" else "single_fit"
        self.model = None
        self.evaluation_horizon = 1

    def _parameter(self, name: str, default):
        value = self.parameters.get(name, default)
        return default if value is None else value

    def minimum_history(self) -> int:
        return 1

    def _build(self):
        hold = int(self._parameter("maximum_hold_bars", 24))
        if self.variant == "kaplan_meier":
            from .strata import StratifiedKaplanMeier

            return StratifiedKaplanMeier(self._parameter("max_depth", 2), self._parameter("min_samples_leaf", 100),
                                         hold, self.seed)
        if self.variant == "cox":
            from .hazards import CauseSpecificCox

            return CauseSpecificCox(self._parameter("penalty_strength", 0.1), hold)
        if self.variant == "aft":
            from .accelerated import AcceleratedFailureTime

            return AcceleratedFailureTime(self._parameter("survival_distribution", "best_by_information_criterion"),
                                          self._parameter("penalty_strength", 0.1), hold)
        from .mixture import ExponentialMixture

        return ExponentialMixture(self._parameter("component_count", 2), self._parameter("penalty_strength", 0.1), hold)

    # ── the survival data ──
    def walks(self, features: np.ndarray, train_index: np.ndarray):
        """(covariates, Durations) of the training span's sampled bars."""
        view = self.market
        hold = int(self._parameter("maximum_hold_bars", 24))
        rows = barrier_walks.sampled_rows(view.fit_rows(train_index), self._parameter("sampling_stride_bars", 2))
        rows = rows[np.all(np.isfinite(np.asarray(features)[rows]), axis=1)]
        limit = int(np.asarray(train_index)[-1]) + int(view.horizon)
        data = barrier_walks.barrier_durations(view, rows, float(self._parameter("barrier_distance", 0.5)), hold, limit)
        return np.asarray(features, dtype=np.float64)[data.rows], data

    # ── fit ──
    def _fit(self, features, labels, train_index, validation_index, timestamps, reporter) -> None:
        view = self.market
        hold = int(self._parameter("maximum_hold_bars", 24))
        self.evaluation_horizon = max(1, min(int(view.horizon), hold))
        covariates, data = self.walks(features, train_index)
        if len(data) < 50:
            raise ValueError(f"{self.key}: only {len(data)} barrier walks in the training span")
        counts = {"walks": len(data), "up_touches": int(np.count_nonzero(data.cause == 1)),
                  "down_touches": int(np.count_nonzero(data.cause == 2)),
                  "censored": int(np.count_nonzero(data.cause == 0))}
        reporter.log(f"{self.key}: {counts['walks']} barrier walks ({counts['up_touches']} up, "
                     f"{counts['down_touches']} down, {counts['censored']} censored)")
        self.model = self._build()
        targets = np.asarray(labels, dtype=np.float64)

        def validate():
            if validation_index.size == 0:
                return score(self.task, np.empty(0), np.empty(0))
            return score(self.task, self._probability(features, validation_index), targets[validation_index])

        if self.variant == "exponential_mixture":
            self.model.initialise(covariates, data)
            summary = run_epochs(
                reporter, epoch_count=int(self._parameter("iteration_count", 60)), train_index=train_index,
                train_epoch=lambda epoch, report_batch: self.model.em_step(covariates, data),
                validate=lambda epoch: validate(), snapshot=self.model.snapshot, restore=self.model.restore,
                patience=int(self._parameter("patience", 10)), name=self.key)
        else:
            summary = single_fit(reporter, train_index=train_index,
                                 fit=lambda: self.model.fit(covariates, data, reporter.log) and None,
                                 validate=validate if validation_index.size else None, name=self.key)
        self.best_iteration = summary["best_epoch"]
        self.fit_summary = {"variant": self.variant, "trained_epochs": summary["trained_epochs"],
                            "best_epoch": summary["best_epoch"], "best_validation_loss": summary["best_validation_loss"],
                            "evaluation_horizon_bars": self.evaluation_horizon, "barrier_walks": counts,
                            "survival_model": self.model.summary}

    # ── predict ──
    def _probability(self, features, index: np.ndarray) -> np.ndarray:
        values = np.asarray(features, dtype=np.float64)[np.asarray(index, dtype=np.int64)]
        finite = np.all(np.isfinite(values), axis=1)
        out = np.full(values.shape[0], np.nan)
        if finite.any():
            cif_up, cif_down = self.model.incidence(values[finite], self.evaluation_horizon)
            out[finite] = incidence.up_share(cif_up, cif_down)
        return out

    def _predict_probability(self, features, index) -> np.ndarray:
        return self._probability(features, index)

    # ── save / load ──
    def _library_versions(self) -> dict[str, str]:
        libraries = {"kaplan_meier": ("numpy", "scikit-learn"), "cox": ("numpy", "lifelines"),
                     "aft": ("numpy", "lifelines"), "exponential_mixture": ("numpy", "scipy")}[self.variant]
        return persistence.library_versions(*libraries)

    def _save_state(self, folder: Path) -> str:
        arrays, info = self.model.to_state()
        persistence.save_arrays(folder / self.model_file, **arrays)
        persistence.save_json(folder / STATE_FILE, {"variant": self.variant, "evaluation_horizon": self.evaluation_horizon,
                                                    "model": info})
        return self.model_file

    def _load_state(self, folder: Path, metadata: dict) -> None:
        arrays = persistence.load_arrays(folder / metadata.get("model_file", self.model_file))
        document = persistence.load_json(folder / STATE_FILE)
        self.evaluation_horizon = int(document["evaluation_horizon"])
        variant = document["variant"]
        self.step_unit = "epoch" if variant == "exponential_mixture" else "single_fit"
        info = document["model"]
        if variant == "kaplan_meier":
            from .strata import StratifiedKaplanMeier as model_class
        elif variant == "cox":
            from .hazards import CauseSpecificCox as model_class
        elif variant == "aft":
            from .accelerated import AcceleratedFailureTime as model_class
        else:
            from .mixture import ExponentialMixture as model_class
        self.model = model_class.from_state(arrays, info)


__all__ = ["BarrierSurvivalAdapter", "VARIANTS"]
