"""Seasonal ARIMA (p, 0, q) x (P, 0, Q)_s on the bar-return series by
conditional sum of squares, the Box-Jenkins estimator (R's
``arima(method = "CSS")``), with the season s = the bars of one session.

Why not the Kalman likelihood ARIMA uses: the multiplicative seasonal state has
s x (P + Q) dimensions, and at s = 276 five-minute bars (a 23-hour session)
one filter step costs about 276^3 flops — hours per fold. The CSS residual
recursion is a sparse linear filter instead:

    a(L) x_t = b(L) e_t,    x_t = z_t - mean,  z_t = r_t / scale
    a(L) = (1 - phi_1 L - ... - phi_p L^p)(1 - Phi L^s)
    b(L) = (1 + theta_1 L + ... + theta_q L^q)(1 + Theta L^s)

``scipy.signal.lfilter(a, b, x)`` gives every residual in one pass; the
parameters minimise the sum of squared residuals over the training span after
its first p + s P bars (the conditioning part). Stationarity and invertibility
are enforced by the Monahan / Jones transform (``constrain_stationary_univariate``)
and tanh for the seasonal coefficients. The seasonal orders are capped at
P, Q <= 1; when the fit fails (a non-finite objective or an optimiser failure)
it falls back to (P, Q) = (1, 0), then to the plain ARMA, and logs each step.

A return across a session gap is set to the mean (x = 0): the recursion needs
a value, and the mean is the model's own unconditional forecast of it.

Forecast at bar t: the recursion continued with future shocks at zero,

    xhat_{t+k} = sum_i alpha_i X(t, k - i) + sum_j beta_j E(t, k - j),
    X(t, m) = xhat_{t+m} (m >= 1) or x_{t+m} (m <= 0),  E(t, m) = e_{t+m} (m <= 0) or 0,

vectorised over every row at once (alpha = -a[1:], beta = b[1:]); the h-bar
mean is sum_k (mean + xhat_{t+k}) and its variance sigma^2 sum_j (psi_0 + ... +
psi_j)^2 over the MA(infinity) weights psi of b(L) / a(L). Every quantity at t
uses x and e at rows <= t only.
"""

from __future__ import annotations

import numpy as np

SEASONAL_FALLBACKS = ((1, 1), (1, 0), (0, 0))


def _polynomial_product(first: np.ndarray, second: np.ndarray) -> np.ndarray:
    return np.convolve(first, second)


def _seasonal(coefficient: float, period: int, sign: float) -> np.ndarray:
    polynomial = np.zeros(period + 1)
    polynomial[0] = 1.0
    polynomial[period] = sign * coefficient
    return polynomial


def polynomials(autoregressive: np.ndarray, moving_average: np.ndarray, seasonal_autoregressive: float | None,
                seasonal_moving_average: float | None, period: int) -> tuple[np.ndarray, np.ndarray]:
    """(a, b): the full AR and MA lag polynomials, a[0] = b[0] = 1."""
    a = np.concatenate([[1.0], -np.asarray(autoregressive, dtype=np.float64)])
    b = np.concatenate([[1.0], np.asarray(moving_average, dtype=np.float64)])
    if seasonal_autoregressive is not None:
        a = _polynomial_product(a, _seasonal(seasonal_autoregressive, period, -1.0))
    if seasonal_moving_average is not None:
        b = _polynomial_product(b, _seasonal(seasonal_moving_average, period, 1.0))
    return a, b


def _shift(values: np.ndarray, back: int) -> np.ndarray:
    """values[t - back] (0 before the first row, the recursion's zero pre-sample)."""
    if back == 0:
        return values
    out = np.zeros_like(values)
    if back < values.shape[0]:
        out[back:] = values[:-back]
    return out


class SeasonalArimaForecaster:
    name = "sarima"

    def __init__(self, autoregressive_order: int, moving_average_order: int, seasonal_autoregressive_order: int,
                 seasonal_moving_average_order: int, horizon: int, max_iterations: int) -> None:
        self.autoregressive_order = int(autoregressive_order)
        self.moving_average_order = int(moving_average_order)
        self.seasonal_autoregressive_order = int(seasonal_autoregressive_order)
        self.seasonal_moving_average_order = int(seasonal_moving_average_order)
        if self.seasonal_autoregressive_order not in (0, 1) or self.seasonal_moving_average_order not in (0, 1):
            raise ValueError("the seasonal orders are capped at P, Q <= 1")
        self.horizon = int(horizon)
        self.max_iterations = int(max_iterations)
        self.period = 0
        self.scale = float("nan")
        self.mean = 0.0
        self.autoregressive = np.zeros(self.autoregressive_order)
        self.moving_average = np.zeros(self.moving_average_order)
        self.seasonal_autoregressive: float | None = None
        self.seasonal_moving_average: float | None = None
        self.innovation_variance = float("nan")
        self.fitted_seasonal_orders = (0, 0)
        self.summary: dict = {}

    # ── parameters ──
    def _unpack(self, vector: np.ndarray, seasonal: tuple[int, int]):
        from statsmodels.tsa.statespace.tools import constrain_stationary_univariate

        p, q = self.autoregressive_order, self.moving_average_order
        position = 0
        mean = float(vector[position])
        position += 1
        autoregressive = constrain_stationary_univariate(vector[position:position + p]) if p else np.zeros(0)
        position += p
        # invertibility of 1 + theta(L) is stationarity of 1 - (-theta)(L)
        moving_average = -constrain_stationary_univariate(vector[position:position + q]) if q else np.zeros(0)
        position += q
        seasonal_autoregressive = float(np.tanh(vector[position])) if seasonal[0] else None
        position += seasonal[0]
        seasonal_moving_average = float(np.tanh(vector[position])) if seasonal[1] else None
        return mean, np.asarray(autoregressive), np.asarray(moving_average), seasonal_autoregressive, seasonal_moving_average

    def _residuals(self, standardised: np.ndarray, mean: float, a: np.ndarray, b: np.ndarray) -> np.ndarray:
        from scipy.signal import lfilter

        deviation = np.where(np.isfinite(standardised), standardised - mean, 0.0)
        return lfilter(a, b, deviation)

    def _fit_orders(self, standardised: np.ndarray, seasonal: tuple[int, int]):
        from scipy.optimize import minimize

        burn = self.autoregressive_order + self.period * seasonal[0]
        usable = np.isfinite(standardised)
        weights = usable.astype(np.float64)
        weights[:burn] = 0.0
        if weights.sum() < 20:
            raise ValueError(f"only {int(weights.sum())} returns after the {burn}-bar conditioning span")

        def objective(vector: np.ndarray) -> float:
            mean, autoregressive, moving_average, seasonal_ar, seasonal_ma = self._unpack(vector, seasonal)
            a, b = polynomials(autoregressive, moving_average, seasonal_ar, seasonal_ma, self.period)
            residuals = self._residuals(standardised, mean, a, b)
            value = float(np.sum(weights * residuals * residuals) / weights.sum())
            return value if np.isfinite(value) else 1e12

        best = None
        for start in self._starts(float(np.mean(standardised[usable])), seasonal):
            result = minimize(objective, start, method="L-BFGS-B", options={"maxiter": self.max_iterations})
            if np.isfinite(result.fun) and (best is None or float(result.fun) < float(best.fun)):
                best = result
        value = float(best.fun) if best is not None else float("nan")
        if not np.isfinite(value) or value >= 1e12:
            raise ValueError("the conditional sum of squares is not finite")
        return best, value

    def _starts(self, mean: float, seasonal: tuple[int, int]) -> list[np.ndarray]:
        """Two starting points (the CSS surface of a near-cancelling ARMA has a
        ridge): white noise, and a persistent level (phi_1 = 0.9, theta_1 = -0.8)."""
        from statsmodels.tsa.statespace.tools import unconstrain_stationary_univariate

        p, q = self.autoregressive_order, self.moving_average_order
        tail = np.zeros(seasonal[0] + seasonal[1])
        starts = [np.concatenate([[mean], np.zeros(p + q), tail])]
        if p or q:
            autoregressive = np.zeros(p)
            moving_average = np.zeros(q)
            if p:
                autoregressive[0] = 0.9
            if q:
                moving_average[0] = -0.8
            unconstrained_ar = unconstrain_stationary_univariate(autoregressive) if p else np.zeros(0)
            unconstrained_ma = unconstrain_stationary_univariate(-moving_average) if q else np.zeros(0)
            starts.append(np.concatenate([[mean], unconstrained_ar, unconstrained_ma, tail]))
        return starts

    def fit(self, returns: np.ndarray, period: int, log) -> dict:
        returns = np.asarray(returns, dtype=np.float64)
        finite = returns[np.isfinite(returns)]
        self.period = int(period)
        if self.period < 2:
            raise ValueError(f"the seasonal period must be at least 2 bars, got {period}")
        self.scale = float(np.std(finite)) if finite.size else float("nan")
        if not np.isfinite(self.scale) or self.scale <= 0:
            raise ValueError("the training span's returns have no spread")
        standardised = returns / self.scale
        requested = (self.seasonal_autoregressive_order, self.seasonal_moving_average_order)
        chain = [requested] + [orders for orders in SEASONAL_FALLBACKS
                               if orders[0] <= requested[0] and orders[1] <= requested[1] and orders != requested]
        last_error = None
        for orders in chain:
            try:
                result, value = self._fit_orders(standardised, orders)
            except ValueError as error:
                last_error = error
                log(f"SARIMA: seasonal orders (P, Q) = {orders} failed ({error}); falling back", "warn")
                continue
            if not result.success:
                log(f"SARIMA: seasonal orders (P, Q) = {orders}: the optimiser stopped without converging "
                    f"({str(result.message)[:80]})", "warn")
            (self.mean, self.autoregressive, self.moving_average, self.seasonal_autoregressive,
             self.seasonal_moving_average) = self._unpack(np.asarray(result.x), orders)
            self.innovation_variance = value
            self.fitted_seasonal_orders = orders
            if orders != requested:
                log(f"SARIMA: fitted with seasonal orders (P, Q) = {orders} instead of {requested}", "warn")
            break
        else:
            raise ValueError(f"SARIMA: no seasonal order could be fitted ({last_error})")
        self.summary = {"seasonal_period_bars": self.period, "seasonal_orders": list(self.fitted_seasonal_orders),
                        "conditional_mean_squared_residual": self.innovation_variance, "return_scale": self.scale,
                        "mean": self.mean, "autoregressive": [float(v) for v in self.autoregressive],
                        "moving_average": [float(v) for v in self.moving_average],
                        "seasonal_autoregressive": self.seasonal_autoregressive,
                        "seasonal_moving_average": self.seasonal_moving_average}
        return self.summary

    def lag_polynomials(self) -> tuple[np.ndarray, np.ndarray]:
        return polynomials(self.autoregressive, self.moving_average, self.seasonal_autoregressive,
                           self.seasonal_moving_average, self.period)

    def forecast(self, returns: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        from scipy.signal import lfilter

        standardised = np.asarray(returns, dtype=np.float64) / self.scale
        a, b = self.lag_polynomials()
        deviation = np.where(np.isfinite(standardised), standardised - self.mean, 0.0)
        residuals = lfilter(a, b, deviation)
        autoregressive_lags = [(lag, -float(a[lag])) for lag in range(1, a.size) if a[lag] != 0.0]
        moving_average_lags = [(lag, float(b[lag])) for lag in range(1, b.size) if b[lag] != 0.0]
        forecasts: dict[int, np.ndarray] = {}
        total = np.zeros(deviation.shape[0])
        for step in range(1, self.horizon + 1):
            value = np.zeros(deviation.shape[0])
            for lag, coefficient in autoregressive_lags:
                offset = step - lag
                value += coefficient * (forecasts[offset] if offset >= 1 else _shift(deviation, -offset))
            for lag, coefficient in moving_average_lags:
                offset = step - lag
                if offset <= 0:
                    value += coefficient * _shift(residuals, -offset)
            forecasts[step] = value
            total += self.mean + value
        impulse = np.zeros(self.horizon)
        impulse[0] = 1.0
        weights = lfilter(b, a, impulse)
        variance = self.innovation_variance * float(np.sum(np.cumsum(weights) ** 2))
        spread = np.full(deviation.shape[0], np.sqrt(variance) * self.scale)
        mean = total * self.scale
        mean[: 1] = np.nan
        return mean, spread

    # ── persistence ──
    def to_state(self) -> tuple[dict, dict]:
        arrays = {"autoregressive": np.asarray(self.autoregressive, dtype=np.float64),
                  "moving_average": np.asarray(self.moving_average, dtype=np.float64)}
        info = {"autoregressive_order": self.autoregressive_order, "moving_average_order": self.moving_average_order,
                "seasonal_autoregressive_order": self.seasonal_autoregressive_order,
                "seasonal_moving_average_order": self.seasonal_moving_average_order, "horizon": self.horizon,
                "max_iterations": self.max_iterations, "period": self.period, "scale": self.scale, "mean": self.mean,
                "seasonal_autoregressive": self.seasonal_autoregressive,
                "seasonal_moving_average": self.seasonal_moving_average,
                "innovation_variance": self.innovation_variance,
                "fitted_seasonal_orders": list(self.fitted_seasonal_orders), "summary": self.summary}
        return arrays, info

    @classmethod
    def from_state(cls, arrays: dict, info: dict) -> SeasonalArimaForecaster:
        model = cls(info["autoregressive_order"], info["moving_average_order"], info["seasonal_autoregressive_order"],
                    info["seasonal_moving_average_order"], info["horizon"], info["max_iterations"])
        model.autoregressive = np.asarray(arrays["autoregressive"], dtype=np.float64)
        model.moving_average = np.asarray(arrays["moving_average"], dtype=np.float64)
        model.period = int(info["period"])
        model.scale = float(info["scale"])
        model.mean = float(info["mean"])
        model.seasonal_autoregressive = info["seasonal_autoregressive"]
        model.seasonal_moving_average = info["seasonal_moving_average"]
        model.innovation_variance = float(info["innovation_variance"])
        model.fitted_seasonal_orders = tuple(info["fitted_seasonal_orders"])
        model.summary = dict(info.get("summary") or {})
        return model
