"""The base every meta_agent mechanism subclasses (one per registry variant).

A mechanism owns its networks, its fit and its prediction; the family's
``MetaAgentAdapter`` owns the registry contract (task checks, index checks,
save and load plumbing) and forwards to it. ``bind(view)`` hands over the run's
``MarketView`` and drops every cached adaptation (a cache is keyed by anchor
bar, and a different view — a truncated one in the gates, the explainer's —
changes what is realised at that anchor).
"""

from __future__ import annotations

import numpy as np


class Mechanism:
    #: the price model (task "regression") is built by this mechanism
    has_regression = False
    step_unit = "epoch"

    def __init__(self, key: str, parameters: dict, seed: int, task: str, feature_count: int) -> None:
        self.key = key
        self.parameters = dict(parameters)
        self.seed = int(seed)
        self.task = task
        self.feature_count = int(feature_count)
        self.view = None
        self.cache: dict = {}

    @classmethod
    def minimum_history(cls, parameters: dict) -> int:
        return 1

    def bind(self, view) -> None:
        self.view = view
        self.cache = {}

    def require_view(self):
        if self.view is None:
            raise RuntimeError(f"{self.key}: prediction reads the realised context of the run's market view; "
                               "bind it with bind_market(view) first")
        return self.view

    # what a mechanism writes
    def fit(self, features: np.ndarray, labels: np.ndarray, train_index: np.ndarray,
            validation_index: np.ndarray, reporter) -> dict:
        raise NotImplementedError

    def predict(self, features: np.ndarray, rows: np.ndarray) -> np.ndarray:
        raise NotImplementedError

    def state(self) -> dict:
        raise NotImplementedError

    def load_state(self, state: dict) -> None:
        raise NotImplementedError


__all__ = ["Mechanism"]
