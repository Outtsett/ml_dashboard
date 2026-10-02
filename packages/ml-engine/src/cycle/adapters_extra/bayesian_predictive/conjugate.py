"""Bayesian linear regression in closed form (the ``conjugate_linear`` engine).

Model on standardised features x (the target centred on its training mean):

    y = x'w + e,   e ~ N(0, 1/beta),   w ~ N(0, I/alpha)

Posterior (Bishop, Pattern Recognition and Machine Learning, 3.53-3.54):

    S = (alpha I + beta X'X)^-1,   m = beta S X'y

Predictive for a new row: N(ybar + x'm, 1/beta + x'Sx + 1/(beta n)), the last
term the uncertainty of the training mean. ``evidence_iterations`` rounds of
MacKay's fixed-point updates set alpha and beta by maximising the marginal
likelihood (3.92, 3.95): gamma = sum_i lambda_i / (alpha + lambda_i) with
lambda_i the eigenvalues of beta X'X, alpha = gamma / m'm,
beta = (n - gamma) / |y - Xm|^2. With 0 iterations alpha = 1 / prior_variance
and beta = 1 / noise_variance as set.

P(up) = Phi(mean / predictive standard deviation): the posterior-predictive
mass above 0, no fitted curve.
"""

from __future__ import annotations

import math

import numpy as np
from scipy import special

TOLERANCE = 1e-8


class ConjugateLinear:
    name = "conjugate_linear"

    def __init__(self, parameters: dict) -> None:
        self.parameters = dict(parameters)
        self.summary: dict = {}

    @staticmethod
    def posterior(x: np.ndarray, y_centred: np.ndarray, alpha: float, beta: float) -> tuple[np.ndarray, np.ndarray]:
        precision = alpha * np.eye(x.shape[1]) + beta * (x.T @ x)
        covariance = np.linalg.inv(precision)
        covariance = 0.5 * (covariance + covariance.T)
        return beta * covariance @ (x.T @ y_centred), covariance

    def fit(self, x: np.ndarray, y: np.ndarray, context) -> None:
        p = self.parameters
        count = x.shape[0]
        self.target_mean = float(np.mean(y))
        centred = y - self.target_mean
        alpha, beta = 1.0 / float(p["prior_variance"]), 1.0 / float(p["noise_variance"])
        eigenvalues = np.clip(np.linalg.eigvalsh(x.T @ x), 0.0, None)
        iterations = int(p["evidence_iterations"])
        used = 0
        for used in range(1, iterations + 1):
            mean, _ = self.posterior(x, centred, alpha, beta)
            scaled = beta * eigenvalues
            effective = float(np.sum(scaled / (alpha + scaled)))
            new_alpha = effective / max(float(mean @ mean), 1e-12)
            new_beta = max(count - effective, 1e-6) / max(float(np.sum((centred - x @ mean) ** 2)), 1e-12)
            moved = abs(new_alpha - alpha) / alpha + abs(new_beta - beta) / beta
            alpha, beta = new_alpha, new_beta
            if moved < TOLERANCE:
                break
        self.alpha, self.beta, self.count = float(alpha), float(beta), int(count)
        self.mean, self.covariance = self.posterior(x, centred, alpha, beta)
        self.summary = {"priorPrecision": self.alpha, "noisePrecision": self.beta, "evidenceIterationsRun": int(used),
                        "noiseStandardDeviation": float(1.0 / math.sqrt(self.beta))}
        context.log(f"conjugate_linear: prior variance {1 / self.alpha:.4g}, noise sd {1 / math.sqrt(self.beta):.4g} "
                    f"after {used} evidence iterations", "info")

    def predictive(self, x: np.ndarray, groups=None) -> tuple[np.ndarray, np.ndarray]:
        """(mean, P(up)) of the posterior predictive for each row."""
        mean = self.target_mean + x @ self.mean
        variance = 1.0 / self.beta + np.einsum("ij,jk,ik->i", x, self.covariance, x) + 1.0 / (self.beta * self.count)
        return mean, special.ndtr(mean / np.sqrt(variance))

    def arrays(self) -> dict:
        return {"posterior_mean": self.mean, "posterior_covariance": self.covariance,
                "scalars": np.array([self.alpha, self.beta, self.count, self.target_mean], dtype=np.float64)}

    def document(self) -> dict:
        return {}

    def restore(self, arrays: dict, document: dict) -> None:
        self.mean, self.covariance = arrays["posterior_mean"], arrays["posterior_covariance"]
        alpha, beta, count, target_mean = arrays["scalars"]
        self.alpha, self.beta, self.count, self.target_mean = float(alpha), float(beta), int(count), float(target_mean)


__all__ = ["ConjugateLinear"]
