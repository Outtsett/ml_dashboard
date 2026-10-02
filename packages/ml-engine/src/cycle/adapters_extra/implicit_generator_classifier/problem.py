"""The classification problem every generator learns: feature rows and their class.

- Direction model (task ``classification``): two classes, 0 = the label says
  down, 1 = up; each class's value is 0 / 1, so the expectation over the
  posterior IS P(up).
- Price model (task ``regression``): ``bin_count`` quantile bins of the price
  target on the training rows (``cycle.bridges.binning.TargetBins``); each bin's
  value is its mean training target, so the forecast is the expectation of the
  target under the posterior over bins.

Causality: every row used here is a training row (``train_index``) with a
finite feature row and a finite target, or a row of the training span with a
finite feature row (the unlabelled pool the adversarial autoencoder reads
without its target). Validation rows are kept apart for early stopping and
calibration only.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from cycle.bridges.binning import TargetBins

# a class with fewer training rows than this is left out (its prior is ABSENT_LOG_PRIOR)
MINIMUM_CLASS_ROWS = 2
ABSENT_LOG_PRIOR = -1e9


@dataclass
class ClassProblem:
    x: np.ndarray                  # float32 (n, F): training rows with finite features and target
    classes: np.ndarray            # int64 (n,)
    rows: np.ndarray               # int64 (n,): which bars they are
    class_count: int
    class_values: np.ndarray       # float64 (K,): 0 / 1, or each bin's mean target
    counts: np.ndarray             # int64 (K,): training rows per class
    log_prior: np.ndarray          # float64 (K,): log of the smoothed train class share; ABSENT_LOG_PRIOR when absent
    unlabelled_x: np.ndarray       # float32 (m, F): training-span rows that are not in x (their target is not read)
    validation_x: np.ndarray       # float32 (v, F)
    validation_target: np.ndarray  # float64 (v,): the label (0 / 1) or the price target
    validation_rows: np.ndarray
    target_bins: TargetBins | None

    @property
    def present(self) -> np.ndarray:
        return self.counts >= MINIMUM_CLASS_ROWS

    @property
    def feature_count(self) -> int:
        return int(self.x.shape[1])

    def class_rows(self, class_index: int) -> np.ndarray:
        return np.flatnonzero(self.classes == class_index)


def _finite_rows(features: np.ndarray, rows: np.ndarray) -> np.ndarray:
    rows = np.asarray(rows, dtype=np.int64)
    if rows.size == 0:
        return rows
    return rows[np.all(np.isfinite(features[rows]), axis=1)]


def build_problem(features: np.ndarray, targets: np.ndarray, train_index: np.ndarray, validation_index: np.ndarray,
                  task: str, bin_count: int, key: str) -> ClassProblem:
    targets = np.asarray(targets, dtype=np.float64)
    train = _finite_rows(features, train_index)
    train = train[np.isfinite(targets[train])]
    if train.size == 0:
        raise ValueError(f"{key}: no training row has both a finite feature row and a finite target")
    if task == "classification":
        classes = (targets[train] >= 0.5).astype(np.int64)
        class_count = 2
        class_values = np.array([0.0, 1.0])
        target_bins = None
    else:
        target_bins = TargetBins.fit(targets, train, int(bin_count), prior_weight=1.0)
        classes = target_bins.assign(targets[train])
        class_count = target_bins.bins.bin_count
        class_values = np.asarray(target_bins.means, dtype=np.float64)
    counts = np.bincount(classes, minlength=class_count).astype(np.int64)
    present = counts >= MINIMUM_CLASS_ROWS
    if int(present.sum()) < 2:
        raise ValueError(f"{key}: the training rows fill {int(present.sum())} class(es) with at least "
                         f"{MINIMUM_CLASS_ROWS} rows; a class-conditional generator needs two")
    share = (counts + 1.0) / (counts.sum() + class_count)
    log_prior = np.where(present, np.log(share), ABSENT_LOG_PRIOR)
    # the training span (first to last training row), labelled or not: MarketView.fit_rows without the view
    train_index = np.asarray(train_index, dtype=np.int64)
    span = np.arange(int(train_index.min()), int(train_index.max()) + 1, dtype=np.int64)
    unlabelled = np.setdiff1d(_finite_rows(features, span), train, assume_unique=True)
    validation = _finite_rows(features, validation_index)
    validation = validation[np.isfinite(targets[validation])]
    return ClassProblem(
        x=np.ascontiguousarray(features[train], dtype=np.float32), classes=classes, rows=train,
        class_count=int(class_count), class_values=class_values, counts=counts, log_prior=log_prior.astype(np.float64),
        unlabelled_x=np.ascontiguousarray(features[unlabelled], dtype=np.float32),
        validation_x=np.ascontiguousarray(features[validation], dtype=np.float32),
        validation_target=targets[validation].astype(np.float64), validation_rows=validation, target_bins=target_bins)


__all__ = ["ABSENT_LOG_PRIOR", "ClassProblem", "MINIMUM_CLASS_ROWS", "build_problem"]
