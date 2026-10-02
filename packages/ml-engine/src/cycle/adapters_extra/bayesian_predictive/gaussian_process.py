"""Gaussian-process regression on the last N training bars (the ``gaussian_process`` engine).

scikit-learn's ``GaussianProcessRegressor`` fits the kernel

    signal^2 x k(x, x'; length scale) + noise^2 x [x == x']

(k an RBF or a Matern kernel) by maximising the log marginal likelihood, with
``optimizer_restart_count`` extra starts (seeded), on the most recent
``training_window_bars`` training rows (an exact GP costs N^3, so it is a
local model: the window is stated, not a random draw). The target is
normalised by its window mean and standard deviation.

Prediction is written out here from the fitted state, so a saved model is
arrays and not a pickle: with K* the kernel between the new rows and the
window (the white-noise term is 0 off the diagonal),

    mean = K* alpha              (alpha = K^-1 y, from the fit)
    var  = k(x, x) - |L^-1 K*'|^2, L the Cholesky factor of K

both scaled back to target units; ``k(x, x)`` includes the noise, so the
spread is that of a new observation. P(up) = Phi(mean / sd).
"""

from __future__ import annotations

import numpy as np
from scipy import linalg, special

KERNELS = {"rbf": None, "matern_one_half": 0.5, "matern_three_halves": 1.5, "matern_five_halves": 2.5}


def build_kernel(name: str, feature_count: int):
    from sklearn.gaussian_process.kernels import RBF, ConstantKernel, Matern, WhiteKernel

    if name not in KERNELS:
        raise ValueError(f"unknown kernel {name!r}; one of {', '.join(KERNELS)}")
    length = float(np.sqrt(max(1, feature_count)))
    shape = RBF(length_scale=length, length_scale_bounds=(1e-2, 1e3)) if KERNELS[name] is None else \
        Matern(length_scale=length, length_scale_bounds=(1e-2, 1e3), nu=KERNELS[name])
    return ConstantKernel(1.0, (1e-3, 1e3)) * shape + WhiteKernel(1.0, (1e-4, 1e1))


class GaussianProcess:
    name = "gaussian_process"

    def __init__(self, parameters: dict, seed: int) -> None:
        self.parameters = dict(parameters)
        self.seed = int(seed)
        self.summary: dict = {}

    def fit(self, x: np.ndarray, y: np.ndarray, context) -> None:
        from sklearn.gaussian_process import GaussianProcessRegressor

        p = self.parameters
        window = int(p["training_window_bars"])
        x, y = x[-window:], y[-window:]
        self.kernel_name = str(p["kernel"])
        regressor = GaussianProcessRegressor(kernel=build_kernel(self.kernel_name, x.shape[1]), normalize_y=True,
                                             n_restarts_optimizer=int(p["optimizer_restart_count"]),
                                             random_state=self.seed, copy_X_train=True)
        regressor.fit(x, y)
        self._take(regressor)
        self.summary = {"windowRows": int(x.shape[0]), "kernel": str(regressor.kernel_),
                        "logMarginalLikelihood": float(regressor.log_marginal_likelihood_value_)}
        context.log(f"gaussian_process: {x.shape[0]} window rows, fitted kernel {regressor.kernel_}", "info")

    def _take(self, regressor) -> None:
        self.window = np.asarray(regressor.X_train_, dtype=np.float64)
        self.dual_coefficients = np.asarray(regressor.alpha_, dtype=np.float64).reshape(-1)
        self.cholesky = np.asarray(regressor.L_, dtype=np.float64)
        self.theta = np.asarray(regressor.kernel_.theta, dtype=np.float64)
        self.target_mean = float(np.ravel(regressor._y_train_mean)[0])
        self.target_scale = float(np.ravel(regressor._y_train_std)[0])
        self.kernel = regressor.kernel_

    def predictive(self, x: np.ndarray, groups=None) -> tuple[np.ndarray, np.ndarray]:
        cross = self.kernel(x, self.window)
        mean = cross @ self.dual_coefficients * self.target_scale + self.target_mean
        solved = linalg.solve_triangular(self.cholesky, cross.T, lower=True, check_finite=False)
        variance = np.clip(self.kernel.diag(x) - np.sum(solved * solved, axis=0), 1e-12, None) * self.target_scale ** 2
        return mean, special.ndtr(mean / np.sqrt(variance))

    def arrays(self) -> dict:
        return {"window": self.window, "dual_coefficients": self.dual_coefficients, "cholesky": self.cholesky,
                "theta": self.theta, "target": np.array([self.target_mean, self.target_scale])}

    def document(self) -> dict:
        return {"kernel": self.kernel_name}

    def restore(self, arrays: dict, document: dict) -> None:
        self.kernel_name = document["kernel"]
        self.window, self.dual_coefficients = arrays["window"], arrays["dual_coefficients"]
        self.cholesky, self.theta = arrays["cholesky"], arrays["theta"]
        self.target_mean, self.target_scale = (float(value) for value in arrays["target"])
        self.kernel = build_kernel(self.kernel_name, self.window.shape[1]).clone_with_theta(self.theta)


__all__ = ["GaussianProcess", "KERNELS", "build_kernel"]
