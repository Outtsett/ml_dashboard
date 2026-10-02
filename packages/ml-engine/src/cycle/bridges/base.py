"""``BridgeAdapter``: what every bridge family's adapter has in common.

A family subclasses it and writes four methods::

    _fit(features, labels, train_index, validation_index, timestamps, reporter)
    _predict_probability(features, index) -> float64      (task "classification")
    _predict_value(features, index) -> float64            (task "regression")
    _save_state(folder) -> model file name  /  _load_state(folder, metadata)

and gets, per the conventions of the build plan (§1.0):

- the registry constructor ``(key, entry, parameters, device, seed, task)``,
  cheap (no fitting, no heavy import); the variant from
  ``entry["direction"]["fixed"]["variant"]``;
- ``bind_market(view)`` storing the run's ``cycle.market.MarketView`` on
  ``.market`` (``_on_bind`` lets a family drop caches keyed by the view), and
  ``require_market()`` raising a clear error when a fit needs it and it is absent;
- task checks, "predict before fit" errors, index checks, P(up) clipped to
  [0, 1] with NaN kept (the engine takes no decision on a NaN);
- ``save`` writing ``model.json`` through ``bridges.persistence`` after the
  family's own files, and ``load`` rebuilding from ``model.json`` alone (the
  registry is not consulted: a saved model means what it meant when saved).

Causality is the family's to keep (``cycle.market`` states the read rules);
the shared gates in ``tests/cycle_bridge_harness.py`` check it for every key.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np

from cycle import catalog
from cycle.adapter import MODEL_TASKS, check_index
from cycle.bridges import persistence


class BridgeAdapter:
    step_unit = "epoch"
    #: the fit reads the bound market view (every bridge but a few pure-feature ones)
    needs_market = True
    #: the model file the family writes into its folder
    model_file = "model.npz"

    def __init__(self, key: str, entry: dict, parameters: dict, device: str, seed: int,
                 task: str = "classification") -> None:
        if task not in MODEL_TASKS:
            raise ValueError(f"unknown task {task!r}; valid tasks: {', '.join(MODEL_TASKS)}")
        self.key = key
        self.family = key
        self.entry = entry
        self.adapter_name = (entry or {}).get("adapter")
        models = catalog.registry()["models"]
        self.parameters = catalog.resolve_parameters(key, parameters) if key in models else dict(parameters or {})
        self.variant = ((entry or {}).get("direction") or {}).get("fixed", {}).get("variant")
        self.device = str(device or "cpu")
        self.seed = int(seed)
        self.task = task
        self.market = None
        self.feature_count: int | None = None
        self.fit_summary: dict = {}
        self.best_iteration: int | None = None
        self.fitted = False

    # ── the market view ──
    def bind_market(self, view) -> None:
        self.market = view
        self._on_bind(view)

    def _on_bind(self, view) -> None:
        """Drop anything cached from a previous view (a family override)."""

    def require_market(self):
        if self.market is None:
            raise RuntimeError(
                f"{self.key}: fitting needs the run's market view (closes, targets, costs); the engine binds it "
                "through bind_market(view) when it builds the model — a direct caller must bind it too"
            )
        return self.market

    # ── the contract ──
    def minimum_history(self) -> int:
        return 1

    def _require_fitted(self, method: str) -> None:
        if not self.fitted:
            raise RuntimeError(f"{self.key}: {method} called before fit")

    def fit(self, features, labels, train_index, validation_index, timestamps, reporter) -> None:
        reporter.step_unit = self.step_unit
        train_index = np.asarray(train_index, dtype=np.int64).reshape(-1)
        validation_index = np.asarray(validation_index, dtype=np.int64).reshape(-1)
        if train_index.size == 0:
            raise ValueError(f"{self.key}: the training index is empty")
        check_index(features, labels, train_index, "train_index")
        check_index(features, labels, validation_index, "validation_index")
        if self.needs_market:
            self.require_market()
        self.feature_count = int(features.shape[1])
        self._fit(features, labels, train_index, validation_index, timestamps, reporter)
        self.fitted = True

    def predict_probability(self, features, index) -> np.ndarray:
        if self.task != "classification":
            raise TypeError(f"{self.key}: predict_probability is not available on a price model (task='regression'); "
                            "call predict_value")
        self._require_fitted("predict_probability")
        index = np.asarray(index, dtype=np.int64).reshape(-1)
        if index.size == 0:
            return np.empty(0, dtype=np.float64)
        probability = np.asarray(self._predict_probability(features, index), dtype=np.float64).reshape(-1)
        if probability.shape != index.shape:
            raise ValueError(f"{self.key}: {probability.size} probabilities for {index.size} rows")
        finite = np.isfinite(probability)
        probability[finite] = np.clip(probability[finite], 0.0, 1.0)
        return probability

    def predict_value(self, features, index) -> np.ndarray:
        if self.task != "regression":
            raise TypeError(f"{self.key}: predict_value is not available on a direction model "
                            "(task='classification'); call predict_probability")
        self._require_fitted("predict_value")
        index = np.asarray(index, dtype=np.int64).reshape(-1)
        if index.size == 0:
            return np.empty(0, dtype=np.float64)
        value = np.asarray(self._predict_value(features, index), dtype=np.float64).reshape(-1)
        if value.shape != index.shape:
            raise ValueError(f"{self.key}: {value.size} values for {index.size} rows")
        return value

    # ── what a family writes ──
    def _fit(self, features, labels, train_index, validation_index, timestamps, reporter) -> None:
        raise NotImplementedError

    def _predict_probability(self, features, index) -> np.ndarray:
        raise NotImplementedError

    def _predict_value(self, features, index) -> np.ndarray:
        raise NotImplementedError

    def _save_state(self, folder: Path) -> str:
        raise NotImplementedError

    def _load_state(self, folder: Path, metadata: dict) -> None:
        raise NotImplementedError

    def _library_versions(self) -> dict[str, str]:
        return persistence.library_versions("numpy")

    # ── save / load ──
    def save(self, directory: str) -> str:
        self._require_fitted("save")
        folder = Path(directory)
        folder.mkdir(parents=True, exist_ok=True)
        model_file = self._save_state(folder)
        persistence.write_model_json(self, folder, model_file, self._library_versions())
        return str(folder / model_file)

    @classmethod
    def load(cls, directory: str, metadata: dict | None = None, device: str = "cpu"):
        folder = Path(directory)
        metadata = metadata if metadata is not None else persistence.read_model_json(folder)
        adapter = cls.__new__(cls)
        entry_blocks = metadata.get("entry") or {}
        adapter.key = metadata["key"]
        adapter.family = metadata.get("family", adapter.key)
        adapter.entry = {"direction": entry_blocks.get("direction"), "price": entry_blocks.get("price"),
                         "adapter": entry_blocks.get("adapter"), "implementation": entry_blocks.get("implementation")}
        adapter.adapter_name = metadata.get("adapter")
        adapter.parameters = dict(metadata.get("parameters") or {})
        adapter.variant = metadata.get("variant")
        adapter.device = str(device or "cpu")
        adapter.seed = int(metadata.get("seed", 0))
        adapter.task = metadata.get("task", "classification")
        adapter.market = None
        adapter.feature_count = metadata.get("feature_count")
        adapter.fit_summary = {}
        adapter.best_iteration = metadata.get("best_iteration")
        adapter.fitted = True
        adapter._load_state(folder, metadata)
        return adapter


__all__ = ["BridgeAdapter"]
