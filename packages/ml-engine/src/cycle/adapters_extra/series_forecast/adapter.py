"""``SeriesForecastAdapter``: the five classical series models as Model Cycle
adapters (build plan §1.1 family 11).

Variants (``direction.fixed.variant``):

    arima    ARIMA(p, d, q), Kalman maximum likelihood (``arima.py``)
    sarima   seasonal ARIMA, conditional sum of squares, season = one session (``sarima.py``)
    garch    AR mean + GJR-GARCH(1, 1), filtered historical simulation (``garch.py``)
    stl      STL seasonal profile + trailing slope (``decomposition.py``)
    prophet  Prophet on the h-bar return, fitted once per fold (``additive.py``)

Each is fitted ONCE on the training span (``view.fit_rows``) with its
parameters then frozen; the forecast at bar t reads the view's bars <= t
(the filter state after the return at t). The first four run their filter once
over every row of the bound view and cache the result for that view (a new
``bind_market`` drops it), so a bar scored alone or in a batch reads the same
number and the test walk costs O(1) per bar.

The same fitted model serves both roles: P(up) (task ``classification``) and
the price target, close * (exp(mean) - 1) / move scale (task ``regression``).
Validation rows score the fit (the epoch report); the one thing read from them
is STL's forecast spread (``decomposition.calibrate``).
"""

from __future__ import annotations

from pathlib import Path

import numpy as np

from cycle.bridges import persistence
from cycle.bridges.base import BridgeAdapter
from cycle.bridges.training import score, single_fit

from . import common

VARIANTS = ("arima", "sarima", "garch", "stl", "prophet")
STATE_FILE = "forecaster.json"
PROPHET_CHUNK_BARS = 2048


class SeriesForecastAdapter(BridgeAdapter):
    step_unit = "single_fit"
    model_file = "model.npz"

    def __init__(self, key: str, entry: dict, parameters: dict, device: str, seed: int,
                 task: str = "classification") -> None:
        super().__init__(key, entry, parameters, device, seed, task)
        if self.variant not in VARIANTS:
            raise ValueError(f"{key}: series_forecast variant must be one of {VARIANTS}, got {self.variant!r}")
        self.forecaster = None
        self._cache: dict | None = None

    # ── the parameters ──
    def _parameter(self, name: str, default):
        value = self.parameters.get(name, default)
        return default if value is None else value

    def minimum_history(self) -> int:
        return max(1, int(self._parameter("history_bars", 100)))

    def _build(self, horizon: int):
        parameter = self._parameter
        if self.variant == "arima":
            from .arima import ArimaForecaster

            return ArimaForecaster(parameter("autoregressive_order", 1), parameter("moving_average_order", 1),
                                   parameter("difference_order", 1), horizon, parameter("max_iterations", 200))
        if self.variant == "sarima":
            from .sarima import SeasonalArimaForecaster

            return SeasonalArimaForecaster(parameter("autoregressive_order", 2), parameter("moving_average_order", 1),
                                           parameter("seasonal_autoregressive_order", 1),
                                           parameter("seasonal_moving_average_order", 1), horizon,
                                           parameter("max_iterations", 200))
        if self.variant == "garch":
            from .garch import GarchForecaster

            return GarchForecaster(parameter("autoregressive_order", 5), parameter("asymmetric_shocks", True),
                                   parameter("error_distribution", "student_t"), parameter("path_count", 500), horizon,
                                   self.seed)
        if self.variant == "stl":
            from .decomposition import SeasonalDecompositionForecaster

            return SeasonalDecompositionForecaster(parameter("trend_window_bars", 30),
                                                   parameter("seasonal_smoother_cycles", 7),
                                                   parameter("robust_fit", True), horizon)
        from .additive import ProphetForecaster

        return ProphetForecaster(parameter("changepoint_count", 25), parameter("changepoint_prior_scale", 0.05),
                                 parameter("seasonality_prior_scale", 10.0), parameter("daily_fourier_order", 8),
                                 parameter("weekly_seasonality", True), parameter("lagged_regressors", True),
                                 parameter("scheduled_event_days", True), horizon, self.seed)

    def _on_bind(self, view) -> None:
        self._cache = None

    # ── fit ──
    def _fit(self, features, labels, train_index, validation_index, timestamps, reporter) -> None:
        view = self.market
        rows = common.fit_span(view, train_index)
        self.forecaster = self._build(int(view.horizon))
        self._cache = None
        self.fitted = False
        log = reporter.log
        model_summary: dict = {}

        def fit() -> None:
            returns = common.returns_of(view)[rows]
            if self.variant == "arima" or self.variant == "garch":
                model_summary.update(self.forecaster.fit(returns, log))
            elif self.variant == "sarima":
                interval = common.bar_interval_seconds(view.timestamps, rows)
                period = int(self._parameter("seasonal_period_bars", 0)) or common.session_period_bars(view, rows, interval)
                model_summary.update(self.forecaster.fit(returns, period, log))
            elif self.variant == "stl":
                self.forecaster.fit(view, rows, log)
                self.forecaster.calibrate(view, validation_index, log)
                model_summary.update(self.forecaster.summary)
            else:
                model_summary.update(self.forecaster.fit(view, features, rows, log))
            log(f"{self.key}: fitted the {self.variant} forecaster on {rows.size} training bars")
            return None

        def validate():
            prediction = self._output(features, validation_index)
            return score(self.task, prediction, np.asarray(labels, dtype=np.float64)[validation_index])

        summary = single_fit(reporter, train_index=train_index, fit=fit,
                             validate=validate if validation_index.size else None, name=self.key)
        self.fit_summary = {"variant": self.variant, "trained_epochs": summary["trained_epochs"],
                            "best_validation_loss": summary["best_validation_loss"],
                            "series_model": model_summary}

    # ── predict ──
    def _forecast_all(self) -> dict:
        view = self.market
        if self._cache is not None and self._cache["view"] is view:
            return self._cache
        returns = common.returns_of(view)
        if self.variant == "garch":
            cache = {"view": view, "state": self.forecaster.filter(returns), "rows": {}}
        else:
            if self.variant == "stl":
                mean, spread = self.forecaster.forecast(view)
            else:
                mean, spread = self.forecaster.forecast(returns)
            cache = {"view": view, "mean": mean, "spread": spread}
        self._cache = cache
        return cache

    def _mean_and_probability(self, features, index: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        view = self.require_market()
        index = np.asarray(index, dtype=np.int64)
        if index.size and (int(index.max()) >= len(view) or int(index.min()) < 0):
            raise IndexError(f"{self.key}: row {int(index.max())} is outside the bound market view ({len(view)} bars)")
        if self.variant == "prophet":
            # yhat of a bar reads only its own clock time and feature row, so rows are predicted in
            # chunks (the requested rows and the PROPHET_CHUNK_BARS after them) and kept for this
            # (view, features) pair: the one-bar-at-a-time test walk costs one Prophet call per chunk
            cache = self._cache
            count = min(len(view), int(np.asarray(features).shape[0]))
            if cache is None or cache["view"] is not view or cache["features"] is not features:
                cache = {"view": view, "features": features, "mean": np.full(count, np.nan),
                         "spread": np.full(count, np.nan), "done": np.zeros(count, dtype=bool)}
                self._cache = cache
            missing = index[~cache["done"][index]]
            if missing.size:
                span = np.arange(int(missing.min()), min(count, int(missing.max()) + 1 + PROPHET_CHUNK_BARS))
                span = span[~cache["done"][span]]
                chunk_mean, chunk_spread = self.forecaster.forecast_rows(view, features, span)
                cache["mean"][span], cache["spread"][span] = chunk_mean, chunk_spread
                cache["done"][span] = True
            mean = cache["mean"][index]
            return mean, common.up_probability(mean, cache["spread"][index])
        cache = self._forecast_all()
        if self.variant == "garch":
            memo = cache["rows"]
            probability = np.empty(index.size)
            mean = np.empty(index.size)
            for position, row in enumerate(index):
                row = int(row)
                if row not in memo:
                    memo[row] = self.forecaster.simulate(cache["state"], row)
                probability[position], mean[position] = memo[row]
            return mean, probability
        mean = cache["mean"][index]
        return mean, common.up_probability(mean, cache["spread"][index])

    def _output(self, features, index: np.ndarray) -> np.ndarray:
        mean, probability = self._mean_and_probability(features, index)
        if self.task == "classification":
            return probability
        return common.scaled_move(self.market, index, mean)

    def _predict_probability(self, features, index) -> np.ndarray:
        return self._output(features, index)

    def _predict_value(self, features, index) -> np.ndarray:
        return self._output(features, index)

    # ── save / load ──
    def _library_versions(self) -> dict[str, str]:
        libraries = {"arima": ("numpy", "statsmodels"), "sarima": ("numpy", "scipy", "statsmodels"),
                     "garch": ("numpy", "arch"), "stl": ("numpy", "statsmodels"),
                     "prophet": ("numpy", "prophet", "cmdstanpy")}[self.variant]
        return persistence.library_versions(*libraries)

    def _save_state(self, folder: Path) -> str:
        arrays, info = self.forecaster.to_state()
        persistence.save_arrays(folder / self.model_file, **(arrays or {"empty": np.zeros(0)}))
        persistence.save_json(folder / STATE_FILE, {"variant": self.variant, "forecaster": info})
        for name, text in getattr(self.forecaster, "extra_files", lambda: {})().items():
            temporary = folder / (name + ".tmp")
            temporary.write_text(text, encoding="utf-8")
            temporary.replace(folder / name)
        return self.model_file

    def _load_state(self, folder: Path, metadata: dict) -> None:
        arrays = persistence.load_arrays(folder / metadata.get("model_file", self.model_file))
        document = persistence.load_json(folder / STATE_FILE)
        info = document["forecaster"]
        variant = document["variant"]
        self._cache = None
        if variant == "arima":
            from .arima import ArimaForecaster

            self.forecaster = ArimaForecaster.from_state(arrays, info)
        elif variant == "sarima":
            from .sarima import SeasonalArimaForecaster

            self.forecaster = SeasonalArimaForecaster.from_state(arrays, info)
        elif variant == "garch":
            from .garch import GarchForecaster

            self.forecaster = GarchForecaster.from_state(arrays, info)
        elif variant == "stl":
            from .decomposition import SeasonalDecompositionForecaster

            self.forecaster = SeasonalDecompositionForecaster.from_state(arrays, info)
        else:
            from .additive import ProphetForecaster

            files = {"prophet_model.json": (folder / "prophet_model.json").read_text(encoding="utf-8")}
            self.forecaster = ProphetForecaster.from_state(arrays, info, files)


__all__ = ["SeriesForecastAdapter", "VARIANTS"]
