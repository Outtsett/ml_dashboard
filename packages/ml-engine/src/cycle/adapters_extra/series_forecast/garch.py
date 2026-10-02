"""AR(p) mean + GJR-GARCH(1, 1) variance on the bar-return series, fitted by
(quasi) maximum likelihood with the ``arch`` package; P(up) by filtered
historical simulation.

Fit: the training span's observed returns (a return across a session gap is
dropped, so the series runs session to session), standardised by their own
standard deviation, ``arch_model(mean="AR", lags=p, vol="GARCH", p=1, o=1,
q=1, dist=...)``. ``o = 0`` (``asymmetric_shocks`` off) is the plain GARCH(1, 1).

Filter: with the parameters frozen, the recursion

    m_j = c + sum_i phi_i z_{j-i},   e_j = z_j - m_j,
    s2_{j+1} = omega + (alpha + gamma [e_j < 0]) e_j^2 + beta s2_j

runs once over every observed return of the view (s2 starts at the training
residuals' variance, lags before the first return at the unconditional
mean). A bar's state is the state after the last return observed at or before
it, so the forecast at t reads returns <= t only.

Forecast at bar t: ``path_count`` paths of h steps, each shock the conditional
standard deviation times a standardised TRAINING residual drawn with
replacement (filtered historical simulation, Barone-Adesi et al. 1999), the
variance recursion applied along each path. P(up) = (paths with a positive
h-bar sum + 1/2) / (path_count + 1); the price target is the mean path sum.
The draws come from ``numpy.random.default_rng((seed, row))``: a bar gets the
same paths whether it is scored alone or in a batch.
"""

from __future__ import annotations

import warnings

import numpy as np

DISTRIBUTIONS = {"normal": "normal", "student_t": "t", "skewed_student_t": "skewt"}


class GarchForecaster:
    name = "garch"

    def __init__(self, autoregressive_order: int, asymmetric_shocks: bool, error_distribution: str, path_count: int,
                 horizon: int, seed: int) -> None:
        if error_distribution not in DISTRIBUTIONS:
            raise ValueError(f"error_distribution must be one of {sorted(DISTRIBUTIONS)}, got {error_distribution!r}")
        self.autoregressive_order = int(autoregressive_order)
        self.asymmetric_shocks = bool(asymmetric_shocks)
        self.error_distribution = error_distribution
        self.path_count = int(path_count)
        self.horizon = int(horizon)
        self.seed = int(seed)
        self.scale = float("nan")
        self.constant = 0.0
        self.autoregressive = np.zeros(self.autoregressive_order)
        self.omega = self.alpha = self.gamma = self.beta = 0.0
        self.initial_variance = float("nan")
        self.innovations = np.empty(0)
        self.summary: dict = {}

    def fit(self, returns: np.ndarray, log) -> dict:
        from arch import arch_model

        returns = np.asarray(returns, dtype=np.float64)
        observed = returns[np.isfinite(returns)]
        if observed.size < 50 + self.autoregressive_order:
            raise ValueError(f"GARCH needs at least {50 + self.autoregressive_order} returns in the training span, "
                             f"got {observed.size}")
        self.scale = float(np.std(observed))
        if not np.isfinite(self.scale) or self.scale <= 0:
            raise ValueError("the training span's returns have no spread")
        standardised = observed / self.scale
        mean = "AR" if self.autoregressive_order > 0 else "Constant"
        model = arch_model(standardised, mean=mean, lags=self.autoregressive_order or None, vol="GARCH", p=1,
                           o=1 if self.asymmetric_shocks else 0, q=1, dist=DISTRIBUTIONS[self.error_distribution],
                           rescale=False)
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            result = model.fit(disp="off", show_warning=False)
        params = result.params
        names = list(params.index)
        self.constant = float(params.iloc[0])
        self.autoregressive = np.array([float(params[f"y[{i}]"]) for i in range(1, self.autoregressive_order + 1)])
        self.omega = float(params["omega"])
        self.alpha = float(params["alpha[1]"])
        self.gamma = float(params["gamma[1]"]) if "gamma[1]" in names else 0.0
        self.beta = float(params["beta[1]"])
        residuals = np.asarray(result.resid, dtype=np.float64)
        residuals = residuals[np.isfinite(residuals)]
        self.initial_variance = float(np.mean(residuals ** 2))
        innovations = np.asarray(result.std_resid, dtype=np.float64)
        self.innovations = innovations[np.isfinite(innovations)]
        persistence = self.alpha + self.gamma / 2.0 + self.beta
        converged = int(getattr(result, "convergence_flag", 0)) == 0
        if not converged:
            log("GARCH: the optimiser reported non-convergence; the last parameters are used", "warn")
        self.summary = {"log_likelihood": float(result.loglikelihood), "akaike_information_criterion": float(result.aic),
                        "variance_persistence": persistence, "converged": converged, "return_scale": self.scale,
                        "parameters": {str(name): float(value) for name, value in params.items()}}
        return self.summary

    def filter(self, returns: np.ndarray) -> dict:
        """The state after every observed return, mapped back to rows."""
        returns = np.asarray(returns, dtype=np.float64)
        observed_rows = np.flatnonzero(np.isfinite(returns))
        standardised = returns[observed_rows] / self.scale
        count = standardised.size
        order = self.autoregressive_order
        long_run_mean = self.constant / (1.0 - float(np.sum(self.autoregressive))) if order else self.constant
        padded = np.concatenate([np.full(order, long_run_mean), standardised])
        next_variance = np.empty(count)
        variance = self.initial_variance
        coefficients = self.autoregressive[::-1]
        for j in range(count):
            mean = self.constant + (float(np.dot(coefficients, padded[j:j + order])) if order else 0.0)
            shock = padded[j + order] - mean
            asymmetry = self.gamma if shock < 0 else 0.0
            variance = self.omega + (self.alpha + asymmetry) * shock * shock + self.beta * variance
            next_variance[j] = variance
        position = np.searchsorted(observed_rows, np.arange(returns.shape[0]), side="right") - 1
        return {"padded": padded, "next_variance": next_variance, "position": position,
                "long_run_mean": long_run_mean}

    def simulate(self, state: dict, row: int) -> tuple[float, float]:
        """(P(up), mean h-bar log return) at ``row`` by filtered historical simulation."""
        j = int(state["position"][row])
        if j < 0 or self.innovations.size == 0:
            return float("nan"), float("nan")
        order = self.autoregressive_order
        generator = np.random.default_rng((self.seed, int(row)))
        draws = self.innovations[generator.integers(0, self.innovations.size, size=(self.horizon, self.path_count))]
        lags = np.repeat(state["padded"][j + 1:j + 1 + order][None, :], self.path_count, axis=0) if order else None
        variance = np.full(self.path_count, float(state["next_variance"][j]))
        total = np.zeros(self.path_count)
        coefficients = self.autoregressive[::-1]
        for step in range(self.horizon):
            mean = self.constant + (lags @ coefficients if order else 0.0)
            shock = np.sqrt(np.maximum(variance, 0.0)) * draws[step]
            value = mean + shock
            total += value
            variance = self.omega + (self.alpha + np.where(shock < 0, self.gamma, 0.0)) * shock * shock + self.beta * variance
            if order:
                lags = np.concatenate([lags[:, 1:], value[:, None]], axis=1)
        positive = float(np.count_nonzero(total > 0))
        probability = (positive + 0.5) / (self.path_count + 1.0)
        return probability, float(np.mean(total)) * self.scale

    # ── persistence ──
    def to_state(self) -> tuple[dict, dict]:
        arrays = {"autoregressive": np.asarray(self.autoregressive, dtype=np.float64),
                  "innovations": np.asarray(self.innovations, dtype=np.float64)}
        info = {"autoregressive_order": self.autoregressive_order, "asymmetric_shocks": self.asymmetric_shocks,
                "error_distribution": self.error_distribution, "path_count": self.path_count, "horizon": self.horizon,
                "seed": self.seed, "scale": self.scale, "constant": self.constant, "omega": self.omega,
                "alpha": self.alpha, "gamma": self.gamma, "beta": self.beta, "initial_variance": self.initial_variance,
                "summary": self.summary}
        return arrays, info

    @classmethod
    def from_state(cls, arrays: dict, info: dict) -> GarchForecaster:
        model = cls(info["autoregressive_order"], info["asymmetric_shocks"], info["error_distribution"],
                    info["path_count"], info["horizon"], info["seed"])
        model.autoregressive = np.asarray(arrays["autoregressive"], dtype=np.float64)
        model.innovations = np.asarray(arrays["innovations"], dtype=np.float64)
        for name in ("scale", "constant", "omega", "alpha", "gamma", "beta", "initial_variance"):
            setattr(model, name, float(info[name]))
        model.summary = dict(info.get("summary") or {})
        return model
