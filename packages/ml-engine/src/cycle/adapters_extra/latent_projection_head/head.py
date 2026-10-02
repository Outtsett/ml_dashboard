"""The supervised head every latent projection reads through.

The encoder (PCA, ICA, NMF, a manifold, an autoencoder, ...) is fitted
without labels; this head is the only place the fold's labels (or the price
target) enter. It reads the latent code standardised with the TRAINING codes'
mean and deviation and is one of:

- ``linear``: L2 logistic regression for P(up) (``C = regularization_strength``),
  ridge regression for the price target (``alpha = 1 / regularization_strength``).
  Stored as plain arrays and applied in float64 here, so a row alone and the
  same row in a batch give the same number to the last bit that matters.
- ``gradient_boosting``: scikit-learn's histogram gradient boosting (fixed,
  small: 200 rounds, 15 leaves, 40 bars per leaf, no early stopping so the
  fit is deterministic), stored with joblib.

A price head fits a target clipped at the training rows' own 1st / 99th
percentiles (``cycle.models.clip_training_target``). A direction head whose
training rows hold one class only predicts that training up-rate.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np

from cycle.bridges import persistence

HEAD_MODELS = ("linear", "gradient_boosting")
BOOSTING_SETTINGS = {"max_iter": 200, "learning_rate": 0.05, "max_leaf_nodes": 15, "min_samples_leaf": 40,
                     "l2_regularization": 1.0, "early_stopping": False}
ARRAYS_FILE = "head.npz"
BOOSTING_FILE = "head_boosting.joblib"


def _sigmoid(values: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-np.clip(values, -500.0, 500.0)))


class SupervisedHead:
    """Maps a latent code to P(up) (``classification``) or the scaled move (``regression``)."""

    def __init__(self, task: str, head_model: str, regularization_strength: float, seed: int) -> None:
        if head_model not in HEAD_MODELS:
            raise ValueError(f"head_model must be one of {HEAD_MODELS}, got {head_model!r}")
        self.task = task
        self.head_model = head_model
        self.regularization_strength = float(regularization_strength)
        self.seed = int(seed)
        self.code_mean: np.ndarray | None = None
        self.code_scale: np.ndarray | None = None
        self.weights: np.ndarray | None = None
        self.intercept = 0.0
        self.constant: float | None = None
        self.target_clip: tuple[float, float] | None = None
        self.boosting = None

    # ── fitting ──
    def fit(self, codes: np.ndarray, target: np.ndarray) -> dict:
        codes = np.asarray(codes, dtype=np.float64)
        target = np.asarray(target, dtype=np.float64)
        keep = np.isfinite(target) & np.all(np.isfinite(codes), axis=1)
        codes, target = codes[keep], target[keep]
        if codes.shape[0] == 0:
            raise ValueError("the head has no training row with a finite code and target")
        self.code_mean = codes.mean(axis=0)
        scale = codes.std(axis=0)
        self.code_scale = np.where(scale > 1e-12, scale, 1.0)
        standard = self._standardise(codes)
        summary = {"head_model": self.head_model, "head_row_count": int(codes.shape[0])}
        if self.task == "classification":
            label = (target >= 0.5).astype(np.int64)
            if np.unique(label).size < 2:
                self.constant = float(label.mean())
                summary["head_constant"] = self.constant
                return summary
            if self.head_model == "linear":
                from sklearn.linear_model import LogisticRegression

                model = LogisticRegression(C=self.regularization_strength, max_iter=2000)
                model.fit(standard, label)
                self.weights = model.coef_.reshape(-1).astype(np.float64)
                self.intercept = float(model.intercept_[0])
            else:
                from sklearn.ensemble import HistGradientBoostingClassifier

                self.boosting = HistGradientBoostingClassifier(random_state=self.seed, **BOOSTING_SETTINGS)
                self.boosting.fit(standard, label)
            summary["head_training_up_rate"] = float(label.mean())
            return summary
        from cycle.models import clip_training_target

        clipped, low, high = clip_training_target(target)
        self.target_clip = (low, high)
        if self.head_model == "linear":
            from sklearn.linear_model import Ridge

            model = Ridge(alpha=1.0 / max(self.regularization_strength, 1e-12))
            model.fit(standard, clipped)
            self.weights = np.asarray(model.coef_, dtype=np.float64).reshape(-1)
            self.intercept = float(model.intercept_)
        else:
            from sklearn.ensemble import HistGradientBoostingRegressor

            self.boosting = HistGradientBoostingRegressor(random_state=self.seed, **BOOSTING_SETTINGS)
            self.boosting.fit(standard, clipped)
        summary["head_target_clip"] = [low, high]
        return summary

    # ── prediction ──
    def _standardise(self, codes: np.ndarray) -> np.ndarray:
        return (np.asarray(codes, dtype=np.float64) - self.code_mean) / self.code_scale

    def predict(self, codes: np.ndarray) -> np.ndarray:
        """P(up) or the scaled move per row; NaN where the code is not finite."""
        codes = np.asarray(codes, dtype=np.float64)
        out = np.full(codes.shape[0], np.nan, dtype=np.float64)
        finite = np.all(np.isfinite(codes), axis=1)
        if not finite.any():
            return out
        if self.constant is not None:
            out[finite] = self.constant
            return out
        standard = self._standardise(codes[finite])
        if self.boosting is not None:
            from threadpoolctl import threadpool_limits

            # a few bars per call: OpenMP threads only add synchronisation (and stall on a busy machine)
            with threadpool_limits(limits=1, user_api="openmp"):
                if self.task == "classification":
                    out[finite] = self.boosting.predict_proba(standard)[:, 1]
                else:
                    out[finite] = self.boosting.predict(standard)
            return out
        linear = standard @ self.weights + self.intercept
        out[finite] = _sigmoid(linear) if self.task == "classification" else linear
        return out

    # ── persistence ──
    def save(self, folder: Path) -> None:
        arrays = {
            "code_mean": self.code_mean, "code_scale": self.code_scale,
            "weights": self.weights if self.weights is not None else np.empty(0),
            "intercept": np.array([self.intercept]),
            "constant": np.array([np.nan if self.constant is None else self.constant]),
            "target_clip": np.array(self.target_clip if self.target_clip is not None else (np.nan, np.nan)),
        }
        persistence.save_arrays(folder / ARRAYS_FILE, **arrays)
        if self.boosting is not None:
            persistence.save_joblib(folder / BOOSTING_FILE, self.boosting)

    @classmethod
    def load(cls, folder: Path, task: str, head_model: str, regularization_strength: float, seed: int) -> SupervisedHead:
        head = cls(task, head_model, regularization_strength, seed)
        arrays = persistence.load_arrays(folder / ARRAYS_FILE)
        head.code_mean = arrays["code_mean"]
        head.code_scale = arrays["code_scale"]
        head.weights = arrays["weights"] if arrays["weights"].size else None
        head.intercept = float(arrays["intercept"][0])
        constant = float(arrays["constant"][0])
        head.constant = None if np.isnan(constant) else constant
        clip = arrays["target_clip"]
        head.target_clip = None if np.isnan(clip[0]) else (float(clip[0]), float(clip[1]))
        if (folder / BOOSTING_FILE).is_file():
            head.boosting = persistence.load_joblib(folder / BOOSTING_FILE)
        return head


__all__ = ["HEAD_MODELS", "SupervisedHead"]
