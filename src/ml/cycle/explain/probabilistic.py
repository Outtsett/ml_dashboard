"""Inside the model, Gaussian naive Bayes (``explainKind == "naive_bayes"``).

scikit-learn's ``GaussianNB`` fits, per class (down, up), a prior (how often
the class happened in training) and per feature a normal curve (mean
``theta_``, variance ``var_``, which already carries the variance smoothing).
For a bar it scores each class by

    log prior(class) + Σ_features ln N(x_feature | mean, variance of that class)

(``predict_joint_log_proba``), and P(up) is the softmax of the two scores —
for two classes, the logistic of their difference, the log posterior odds.

The explanation splits that difference, feature by feature, exactly as the
model is built (``src/shared/cycle/explain.ts``):

- ``contributions.base`` = log prior(up) − log prior(down), from
  ``class_prior_`` (in ``classes_`` order: the up class is the one equal to 1);
- ``contributions.values[j]`` = ln N(x_j | up) − ln N(x_j | down) at this
  bar's model input ``inputs.values[j]``, from ``theta_`` and ``var_``;
- ``output.raw`` = the library's own log posterior odds,
  ``predict_joint_log_proba(x)[up] − [down]``.

The structure lists the log priors and every feature's fitted mean and
variance as ``[down, up]`` pairs.

``check`` (gate G2): base + Σ values equals the library's log posterior odds,
and the logistic of it equals the model's P(up), within 1e-6.
"""

from __future__ import annotations

import math

import numpy as np

from . import NotExplained

G2_TOLERANCE = 1e-6


def _estimator(context):
    if context.role != "direction":
        raise NotExplained("a naive Bayes model has no price model")
    estimator = getattr(context.explained_adapter, "estimator", None)
    for name in ("theta_", "var_", "class_prior_", "classes_"):
        if estimator is None or not hasattr(estimator, name):
            raise NotExplained(f"the model is not a fitted Gaussian naive Bayes (no {name})")
    classes = np.asarray(estimator.classes_)
    if classes.size != 2 or not np.any(classes == 1) or not np.any(classes == 0):
        raise NotExplained(f"the naive Bayes model's classes are {classes.tolist()}, not down (0) and up (1)")
    return estimator


def _class_columns(estimator) -> tuple[int, int]:
    """(down, up) positions in ``classes_``."""
    classes = np.asarray(estimator.classes_)
    return int(np.flatnonzero(classes == 0)[0]), int(np.flatnonzero(classes == 1)[0])


def _log_normal(x: np.ndarray, mean: np.ndarray, variance: np.ndarray) -> np.ndarray:
    """ln N(x | mean, variance), per feature — one term of GaussianNB's joint log likelihood."""
    return -0.5 * np.log(2.0 * np.pi * variance) - 0.5 * (x - mean) ** 2 / variance


def structure_block(context) -> dict:
    estimator = _estimator(context)
    down, up = _class_columns(estimator)
    log_priors = np.log(np.asarray(estimator.class_prior_, dtype=np.float64))
    means = np.asarray(estimator.theta_, dtype=np.float64)
    variances = np.asarray(estimator.var_, dtype=np.float64)
    return {
        "baseValue": float(log_priors[up] - log_priors[down]),
        "naiveBayes": {
            "logPriors": [float(log_priors[down]), float(log_priors[up])],
            "means": [[float(means[down, j]), float(means[up, j])] for j in range(means.shape[1])],
            "variances": [[float(variances[down, j]), float(variances[up, j])] for j in range(variances.shape[1])],
        },
    }


def bar_block(context, row: int) -> dict:
    estimator = _estimator(context)
    down, up = _class_columns(estimator)
    matrix, _ = context.model_inputs([row])
    x = matrix[0]
    means = np.asarray(estimator.theta_, dtype=np.float64)
    variances = np.asarray(estimator.var_, dtype=np.float64)
    log_priors = np.log(np.asarray(estimator.class_prior_, dtype=np.float64))
    values = _log_normal(x, means[up], variances[up]) - _log_normal(x, means[down], variances[down])
    joint = np.asarray(estimator.predict_joint_log_proba(matrix), dtype=np.float64)[0]
    return {
        "output": {"raw": float(joint[up] - joint[down])},
        "contributions": {"values": values, "base": float(log_priors[up] - log_priors[down])},
    }


def check(context, row: int, bar: dict) -> list[dict]:
    """G2: prior plus the per-feature evidence is the log posterior odds, whose logistic is P(up)."""
    contributions = bar.get("contributions")
    if not contributions:
        return [{"gate": "G2", "passed": False, "error": None, "tolerance": G2_TOLERANCE,
                 "detail": "the bar carries no contributions"}]
    total = float(contributions["base"]) + math.fsum(float(v) for v in contributions["values"])
    raw = float(bar["output"]["raw"])
    probability = 1.0 / (1.0 + math.exp(-total)) if total > -700 else 0.0
    reported = float(bar["output"]["probabilityUp"])
    error = max(abs(total - raw), abs(probability - reported), abs(probability - float(bar["engineReload"])))
    return [{"gate": "G2", "passed": error <= G2_TOLERANCE, "error": error, "tolerance": G2_TOLERANCE,
             "detail": f"base + evidence {total!r} against the library's log posterior odds {raw!r}; "
                       f"logistic {probability!r} against P(up) {reported!r}"}]


__all__ = ["bar_block", "check", "structure_block"]
