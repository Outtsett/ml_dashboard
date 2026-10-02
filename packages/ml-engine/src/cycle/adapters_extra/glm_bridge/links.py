"""Inverse link functions and cumulative-link probabilities, in numpy.

The fitted GLMs are saved as plain coefficient arrays and predicted here, so a
reloaded model needs no pickled statsmodels object and one row costs one dot
product. Each function matches the statsmodels link of the same name
(``tests/test_cycle_bridge_glm_bridge.py`` checks it against
``statsmodels`` predictions):

    logit     P = 1 / (1 + exp(-eta))
    probit    P = Phi(eta)
    cloglog   P = 1 - exp(-exp(eta))        complementary log-log (asymmetric)
    cauchit   P = 1/2 + arctan(eta) / pi    heavy-tailed (Cauchy distribution)
    log       mu = exp(eta)                 (Gamma, Poisson, Tweedie means)
    identity  mu = eta                      (the Gaussian price model)
"""

from __future__ import annotations

import numpy as np
from scipy import special

BINARY_LINKS = ("logit", "probit", "cloglog", "cauchit")
CUMULATIVE_LINKS = ("logit", "probit")
MAXIMUM_LOG_MEAN = 50.0


def inverse_link(name: str, eta) -> np.ndarray:
    eta = np.asarray(eta, dtype=np.float64)
    if name == "logit":
        return special.expit(eta)
    if name == "probit":
        return special.ndtr(eta)
    if name == "cloglog":
        return -np.expm1(-np.exp(np.clip(eta, -700.0, MAXIMUM_LOG_MEAN)))
    if name == "cauchit":
        return 0.5 + np.arctan(eta) / np.pi
    if name == "log":
        return np.exp(np.clip(eta, -700.0, MAXIMUM_LOG_MEAN))
    if name == "identity":
        return eta
    raise ValueError(f"unknown link {name!r}")


def cumulative_distribution(name: str, values) -> np.ndarray:
    """F of the latent error of a cumulative-link model (logistic or normal)."""
    values = np.asarray(values, dtype=np.float64)
    if name == "logit":
        return special.expit(values)
    if name == "probit":
        return special.ndtr(values)
    raise ValueError(f"unknown cumulative link {name!r}; one of {CUMULATIVE_LINKS}")


def grade_probabilities(name: str, thresholds: np.ndarray, linear_predictor) -> np.ndarray:
    """(n, K) P(Y = k | x) of a cumulative-link model: F(t_k - x'b) - F(t_{k-1} - x'b),
    ``thresholds`` the K - 1 finite cut points in increasing order."""
    eta = np.asarray(linear_predictor, dtype=np.float64).reshape(-1, 1)
    cuts = np.asarray(thresholds, dtype=np.float64).reshape(1, -1)
    cumulative = cumulative_distribution(name, cuts - eta)
    padded = np.concatenate([np.zeros((eta.shape[0], 1)), cumulative, np.ones((eta.shape[0], 1))], axis=1)
    return np.clip(np.diff(padded, axis=1), 0.0, 1.0)


__all__ = ["BINARY_LINKS", "CUMULATIVE_LINKS", "cumulative_distribution", "grade_probabilities", "inverse_link"]
