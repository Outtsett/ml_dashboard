"""ARIMA(p, d, q) on the bar-return series: exact Gaussian maximum likelihood
(statsmodels ``SARIMAX``, Kalman filter), frozen parameters, one filter pass.

The series is the one-bar log return r_t, standardised by the training span's
own standard deviation, so ``difference_order`` d = 1 is an ARMA(p, q) on the
returns (d = 1 on the log price) and d = 2 differences the returns once more
(``SARIMAX(order=(p, 1, q))`` on r_t, the level of r_t in the state). A return
across a session gap is missing (NaN); the Kalman filter skips its measurement
update, so a gap is neither a jump nor a zero.

Forecast at bar t: with the one-step prediction a = E[state_{t+1} | r_<=t] and
its covariance P (``predicted_state`` / ``predicted_state_cov``), the h-bar
cumulative return S = sum_k y_{t+k} has

    mean  = sum_{k=1..h} (d + Z a_k),       a_1 = a, a_{k+1} = c + T a_k
    var   = (Z A_h) P (Z A_h)'  +  sum_{j=1..h-1} (Z A_{h-j} R) Q (Z A_{h-j} R)'  +  h H,
            A_m = I + T + ... + T^(m-1)

(the state enters every term of the sum through A_h; the shock of step t+j
through the steps after it). The filter is causal: the prediction at t uses
returns <= t only, so running it once over every row of the view gives, at t,
exactly what a filter stopped at t gives.
"""

from __future__ import annotations

import warnings

import numpy as np


def _matrix(values: np.ndarray) -> np.ndarray:
    values = np.asarray(values, dtype=np.float64)
    return values[..., 0] if values.ndim == 3 else values


def _vector(values: np.ndarray) -> np.ndarray:
    values = np.asarray(values, dtype=np.float64)
    return values[:, 0] if values.ndim == 2 else values


class ArimaForecaster:
    name = "arima"

    def __init__(self, autoregressive_order: int, moving_average_order: int, difference_order: int, horizon: int,
                 max_iterations: int) -> None:
        self.autoregressive_order = int(autoregressive_order)
        self.moving_average_order = int(moving_average_order)
        self.difference_order = int(difference_order)
        if self.difference_order not in (1, 2):
            raise ValueError(f"difference_order must be 1 or 2 (on the log price), got {difference_order}")
        self.horizon = int(horizon)
        self.max_iterations = int(max_iterations)
        self.scale = float("nan")
        self.params = np.empty(0)
        self.param_names: list[str] = []
        self.summary: dict = {}

    # ── the state space ──
    def _model(self, standardised: np.ndarray):
        from statsmodels.tsa.statespace.sarimax import SARIMAX

        order = (self.autoregressive_order, self.difference_order - 1, self.moving_average_order)
        trend = "c" if self.difference_order == 1 else "n"
        return SARIMAX(standardised, order=order, trend=trend, enforce_stationarity=True, enforce_invertibility=True)

    def fit(self, returns: np.ndarray, log) -> dict:
        """Maximum likelihood on the training span's returns (NaN = missing)."""
        returns = np.asarray(returns, dtype=np.float64)
        finite = returns[np.isfinite(returns)]
        minimum = 10 + 3 * (self.autoregressive_order + self.moving_average_order)
        if finite.size < minimum:
            raise ValueError(f"ARIMA needs at least {minimum} returns in the training span, got {finite.size}")
        self.scale = float(np.std(finite))
        if not np.isfinite(self.scale) or self.scale <= 0:
            raise ValueError("the training span's returns have no spread")
        model = self._model(returns / self.scale)
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            result = model.fit(disp=False, maxiter=self.max_iterations)
        self.params = np.asarray(result.params, dtype=np.float64)
        self.param_names = [str(name) for name in model.param_names]
        converged = bool((result.mle_retvals or {}).get("converged", True))
        self.summary = {"log_likelihood": float(result.llf), "akaike_information_criterion": float(result.aic),
                        "converged": converged, "return_scale": self.scale,
                        "parameters": dict(zip(self.param_names, [float(v) for v in self.params]))}
        if not converged:
            log(f"ARIMA({self.autoregressive_order},{self.difference_order},{self.moving_average_order}): the optimiser "
                f"stopped at {self.max_iterations} iterations before converging; the last parameters are used", "warn")
        return self.summary

    def forecast(self, returns: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """(mean, spread) of the h-bar cumulative log return at every row."""
        standardised = np.asarray(returns, dtype=np.float64) / self.scale
        model = self._model(standardised)
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            filtered = model.filter(self.params)
        ssm = filtered.model.ssm
        design = _matrix(ssm["design"])               # (1, k)
        transition = _matrix(ssm["transition"])       # (k, k)
        selection = _matrix(ssm["selection"])         # (k, r)
        state_cov = _matrix(ssm["state_cov"])         # (r, r)
        obs_cov = float(_matrix(ssm["obs_cov"])[0, 0])
        obs_intercept = float(_vector(ssm["obs_intercept"])[0])
        state_intercept = _vector(ssm["state_intercept"])
        predicted = np.asarray(filtered.predicted_state, dtype=np.float64)[:, 1:]              # (k, n): a_{t+1|t}
        predicted_cov = np.asarray(filtered.predicted_state_cov, dtype=np.float64)[:, :, 1:]  # (k, k, n)
        k = transition.shape[0]
        horizon = self.horizon

        mean = np.zeros(predicted.shape[1])
        state = predicted
        for _ in range(horizon):
            mean += obs_intercept + (design @ state)[0]
            state = state_intercept[:, None] + transition @ state

        powers = [np.eye(k)]
        for _ in range(horizon):
            powers.append(transition @ powers[-1])
        cumulative = [np.zeros((k, k))]
        for m in range(1, horizon + 1):
            cumulative.append(cumulative[-1] + powers[m - 1])        # A_m
        loading = (design @ cumulative[horizon])[0]                  # Z A_h
        constant = horizon * obs_cov
        for j in range(1, horizon):
            shock = design @ cumulative[horizon - j] @ selection     # (1, r)
            constant += float((shock @ state_cov @ shock.T)[0, 0])
        variance = np.einsum("i,ijn,j->n", loading, predicted_cov, loading) + constant
        with np.errstate(invalid="ignore"):
            spread = np.sqrt(np.where(variance > 0, variance, np.nan))
        return mean * self.scale, spread * self.scale

    # ── persistence ──
    def to_state(self) -> tuple[dict, dict]:
        arrays = {"parameters": self.params}
        info = {"autoregressive_order": self.autoregressive_order, "moving_average_order": self.moving_average_order,
                "difference_order": self.difference_order, "horizon": self.horizon,
                "max_iterations": self.max_iterations, "scale": self.scale, "parameter_names": self.param_names,
                "summary": self.summary}
        return arrays, info

    @classmethod
    def from_state(cls, arrays: dict, info: dict) -> ArimaForecaster:
        model = cls(info["autoregressive_order"], info["moving_average_order"], info["difference_order"],
                    info["horizon"], info["max_iterations"])
        model.params = np.asarray(arrays["parameters"], dtype=np.float64)
        model.scale = float(info["scale"])
        model.param_names = list(info["parameter_names"])
        model.summary = dict(info.get("summary") or {})
        return model
