"""Gradient-boosted trees, one classifier per head (side x reward multiple): the baseline to beat.

Trained on the fold's training rows, early-stopped on its validation rows,
then Platt-calibrated on the same validation rows (a logistic fit of the
outcome on the raw score), so a probability of 0.40 means a 40% net-win rate
in the most recent held-back months.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import lightgbm as lgb
import numpy as np
from sklearn.linear_model import LogisticRegression


@dataclass
class GbdtParameters:
    learning_rate: float = 0.03
    num_leaves: int = 31
    min_child_samples: int = 200
    feature_fraction: float = 0.7
    bagging_fraction: float = 0.8
    lambda_l2: float = 5.0
    max_rounds: int = 2000
    early_stopping_rounds: int = 100
    seed: int = 7
    extra: dict = field(default_factory=dict)


def _logit(p: np.ndarray) -> np.ndarray:
    p = np.clip(p, 1e-6, 1 - 1e-6)
    return np.log(p / (1 - p))


class HeadModel:
    def __init__(self, parameters: GbdtParameters):
        self.parameters = parameters
        self.booster: lgb.Booster | None = None
        self.calibrator: LogisticRegression | None = None
        self.best_iteration = 0

    def fit(self, x_train, y_train, x_valid, y_valid, feature_names: list[str]) -> "HeadModel":
        p = self.parameters
        params = {
            "objective": "binary", "learning_rate": p.learning_rate, "num_leaves": p.num_leaves,
            "min_child_samples": p.min_child_samples, "feature_fraction": p.feature_fraction,
            "bagging_fraction": p.bagging_fraction, "bagging_freq": 1, "lambda_l2": p.lambda_l2,
            "seed": p.seed, "verbose": -1, "num_threads": 8, **p.extra,
        }
        train = lgb.Dataset(x_train, y_train, feature_name=feature_names, free_raw_data=False)
        valid = lgb.Dataset(x_valid, y_valid, reference=train, free_raw_data=False)
        self.booster = lgb.train(params, train, num_boost_round=p.max_rounds, valid_sets=[valid],
                                 callbacks=[lgb.early_stopping(p.early_stopping_rounds, verbose=False)])
        self.best_iteration = int(self.booster.best_iteration or p.max_rounds)
        raw = self.booster.predict(x_valid, num_iteration=self.best_iteration)
        if len(np.unique(y_valid)) == 2:
            self.calibrator = LogisticRegression(C=1.0).fit(_logit(raw).reshape(-1, 1), y_valid)
        return self

    def predict(self, x) -> np.ndarray:
        assert self.booster is not None
        raw = self.booster.predict(x, num_iteration=self.best_iteration)
        if self.calibrator is None:
            return raw
        return self.calibrator.predict_proba(_logit(raw).reshape(-1, 1))[:, 1]

    def importance(self, feature_names: list[str]) -> dict[str, float]:
        assert self.booster is not None
        gains = self.booster.feature_importance(importance_type="gain", iteration=self.best_iteration)
        total = gains.sum() or 1.0
        return {name: float(g / total) for name, g in zip(feature_names, gains)}
