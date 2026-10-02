"""Prophet (Taylor and Letham 2018): an additive model

    y(ds) = trend(ds) + daily(ds) [+ weekly(ds)] + event_days(ds) + sum_k beta_k x_k + error

fitted by MAP (Stan L-BFGS through cmdstanpy) ONCE per fold, on the h-bar log
return. The row of bar r is

    ds = time of r + h bar intervals (the bar the move ends on),
    y  = log close[r + h] - log close[r]       (training rows only),
    x  = the feature row of bar r              (Prophet extra regressors, optional),

so the forecast at bar t is Prophet's yhat at ds = t + h intervals with the
feature row of t: everything it reads is known at t. Without the regressors
(``lagged_regressors`` off) the forecast is the pure calendar model: a
piecewise-linear drift, the time-of-day (and weekday) profile and the
scheduled-event days, the same number for every bar at a given clock time.

Event days (``scheduled_event_days``): FOMC statements, CPI and employment
report days from ``ta_strategy.seasonality.calendar_frame`` (the lake's release
calendars, read once per process), as Prophet holidays. When the calendar
cannot be read the model is fitted without them and says so in the log.

P(up) = Phi(yhat / sigma), sigma = Prophet's fitted observation noise; the
price target is close * (exp(yhat) - 1) / move scale.
"""

from __future__ import annotations

import functools
import logging

import numpy as np
import pandas as pd

from . import common

EVENT_FAMILIES = ("fomc_statement", "consumer_price_index", "employment_situation")
MINIMUM_ROWS = 100


def _quiet() -> None:
    for name in ("cmdstanpy", "prophet", "prophet.plot"):
        logging.getLogger(name).setLevel(logging.WARNING)


@functools.lru_cache(maxsize=1)
def event_calendar() -> tuple[tuple[tuple[str, str], ...], str | None]:
    """((family, 'YYYY-MM-DD'), ...) of the scheduled event days on the bars'
    clock, and None — or ((), the reason) when the calendar cannot be read."""
    try:
        from ta_strategy.seasonality import calendar_frame

        frame = calendar_frame()
    except Exception as error:  # noqa: BLE001 - any failure to reach the lake means "no event days", logged
        return (), f"{type(error).__name__}: {str(error)[:160]}"
    frame = frame[frame["family"].isin(EVENT_FAMILIES)]
    days = pd.to_datetime(frame["stamp"].to_numpy(np.int64), unit="s").normalize().strftime("%Y-%m-%d")
    pairs = sorted(set(zip(frame["family"].astype(str), days)))
    return tuple(pairs), None


def holidays_frame(pairs) -> pd.DataFrame | None:
    if not pairs:
        return None
    return pd.DataFrame({"holiday": [family for family, _ in pairs],
                         "ds": pd.to_datetime([day for _, day in pairs]),
                         "lower_window": 0, "upper_window": 0})


def regressor_names(count: int) -> list[str]:
    return [f"feature_{index:03d}" for index in range(count)]


class ProphetForecaster:
    name = "prophet"

    def __init__(self, changepoint_count: int, changepoint_prior_scale: float, seasonality_prior_scale: float,
                 daily_fourier_order: int, weekly_seasonality: bool, lagged_regressors: bool,
                 scheduled_event_days: bool, horizon: int, seed: int) -> None:
        self.changepoint_count = int(changepoint_count)
        self.changepoint_prior_scale = float(changepoint_prior_scale)
        self.seasonality_prior_scale = float(seasonality_prior_scale)
        self.daily_fourier_order = int(daily_fourier_order)
        self.weekly_seasonality = bool(weekly_seasonality)
        self.lagged_regressors = bool(lagged_regressors)
        self.scheduled_event_days = bool(scheduled_event_days)
        self.horizon = int(horizon)
        self.seed = int(seed)
        self.interval_seconds = float("nan")
        self.regressors: list[str] = []
        self.sigma = float("nan")
        self.model = None
        self.serialized = ""
        self.fit_count = 0
        self.summary: dict = {}

    def _frame(self, view, features: np.ndarray, rows: np.ndarray) -> tuple[pd.DataFrame, np.ndarray]:
        """(the Prophet frame of ``rows`` that have every regressor, those rows)."""
        rows = np.asarray(rows, dtype=np.int64)
        if self.regressors:
            values = np.asarray(features, dtype=np.float64)[rows][:, : len(self.regressors)]
            keep = np.all(np.isfinite(values), axis=1)
        else:
            values = np.empty((rows.size, 0))
            keep = np.ones(rows.size, dtype=bool)
        rows = rows[keep]
        stamps = np.asarray(view.timestamps, dtype=np.int64)[rows] + int(round(self.horizon * self.interval_seconds))
        frame = pd.DataFrame({"ds": pd.to_datetime(stamps, unit="s")})
        for position, name in enumerate(self.regressors):
            frame[name] = values[keep, position]
        return frame, rows

    def fit(self, view, features: np.ndarray, rows: np.ndarray, log) -> dict:
        from prophet import Prophet
        from prophet.serialize import model_to_json

        _quiet()
        self.interval_seconds = common.bar_interval_seconds(view.timestamps, rows)
        self.regressors = regressor_names(int(features.shape[1])) if self.lagged_regressors else []
        frame, used = self._frame(view, features, rows)
        target = common.realised_log_move(view, used)
        keep = np.isfinite(target)
        frame = frame.loc[keep].reset_index(drop=True)
        frame["y"] = target[keep]
        if len(frame) < MINIMUM_ROWS:
            raise ValueError(f"Prophet needs {MINIMUM_ROWS} training bars with a realised h-bar move, got {len(frame)}")
        holidays = None
        if self.scheduled_event_days:
            pairs, problem = event_calendar()
            if problem:
                log(f"Prophet: the event calendar could not be read ({problem}); fitting without event days", "warn")
            holidays = holidays_frame(pairs)
        model = Prophet(growth="linear", n_changepoints=min(self.changepoint_count, max(0, len(frame) // 10)),
                        changepoint_prior_scale=self.changepoint_prior_scale,
                        seasonality_prior_scale=self.seasonality_prior_scale, daily_seasonality=False,
                        weekly_seasonality=False, yearly_seasonality=False, holidays=holidays, uncertainty_samples=0)
        model.add_seasonality("daily", period=1, fourier_order=self.daily_fourier_order)
        if self.weekly_seasonality:
            model.add_seasonality("weekly", period=7, fourier_order=3)
        for name in self.regressors:
            model.add_regressor(name, standardize=False)
        model.fit(frame, seed=self.seed)
        self.fit_count += 1
        self.model = model
        self.serialized = model_to_json(model)
        self.sigma = float(np.asarray(model.params["sigma_obs"]).reshape(-1)[0]) * float(model.y_scale)
        self.summary = {"training_rows": int(len(frame)), "observation_noise": self.sigma,
                        "event_day_count": 0 if holidays is None else int(len(holidays)),
                        "regressor_count": len(self.regressors), "bar_interval_seconds": self.interval_seconds}
        return self.summary

    def forecast_rows(self, view, features: np.ndarray, rows: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        rows = np.asarray(rows, dtype=np.int64)
        mean = np.full(rows.size, np.nan)
        frame, used = self._frame(view, features, rows)
        if len(frame):
            _quiet()
            predicted = self.model.predict(frame)["yhat"].to_numpy(np.float64)
            position = {int(row): index for index, row in enumerate(used)}
            for index, row in enumerate(rows):
                if int(row) in position:
                    mean[index] = predicted[position[int(row)]]
        return mean, np.full(rows.size, self.sigma)

    # ── persistence ──
    def to_state(self) -> tuple[dict, dict]:
        info = {"changepoint_count": self.changepoint_count, "changepoint_prior_scale": self.changepoint_prior_scale,
                "seasonality_prior_scale": self.seasonality_prior_scale, "daily_fourier_order": self.daily_fourier_order,
                "weekly_seasonality": self.weekly_seasonality, "lagged_regressors": self.lagged_regressors,
                "scheduled_event_days": self.scheduled_event_days, "horizon": self.horizon, "seed": self.seed,
                "interval_seconds": self.interval_seconds, "regressors": self.regressors, "sigma": self.sigma,
                "summary": self.summary}
        return {}, info

    def extra_files(self) -> dict[str, str]:
        return {"prophet_model.json": self.serialized}

    @classmethod
    def from_state(cls, arrays: dict, info: dict, files: dict[str, str]) -> ProphetForecaster:
        from prophet.serialize import model_from_json

        model = cls(info["changepoint_count"], info["changepoint_prior_scale"], info["seasonality_prior_scale"],
                    info["daily_fourier_order"], info["weekly_seasonality"], info["lagged_regressors"],
                    info["scheduled_event_days"], info["horizon"], info["seed"])
        model.interval_seconds = float(info["interval_seconds"])
        model.regressors = list(info["regressors"])
        model.sigma = float(info["sigma"])
        model.serialized = files["prophet_model.json"]
        model.model = model_from_json(model.serialized)
        model.summary = dict(info.get("summary") or {})
        return model
