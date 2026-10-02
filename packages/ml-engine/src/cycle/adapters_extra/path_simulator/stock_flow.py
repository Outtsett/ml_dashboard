"""System dynamics: a stock-and-flow model of the price with a delayed feedback loop.

Stocks, measured at every bar from bars <= t only (price in move-scale units):

- pressure P: the exponentially weighted mean of the scaled one-bar steps
  (span ``pressure_span_bars``, truncated at five spans) - the momentum stock;
- stretch S: the close's distance from its ``stretch_window_bars`` moving
  average - the positioning stock, read ``feedback_delay_bars`` late;
- volatility V: the square root of the weighted mean squared step (times
  sqrt(h)), which damps the momentum loop;
- information U: the training span's ridge projection of the features onto
  the per-bar share of the next h-bar move, decaying with time constant tau_u.

Flows, integrated by Euler over the horizon (``discretization_steps_per_bar``):

    price velocity  v = c0 + c_p P / (1 + c_v V) - c_s S(s - delay) + c_u U
    dP/ds = a (v - P)            (a from the pressure span: P is the smoothed flow)
    dS/ds = v - S / (window / 2) (the moving average catching up)
    dU/ds = -U / tau_u
    displacement D(s) = integral of v

The flow parameters (c0, c_p, c_s, c_u, c_v, log tau_u) are fitted on the
training span by scipy's differential evolution (seeded, deterministic, then
polished), minimising the squared distance between the simulated and the
observed cumulative displacement after each of the h bars. The model is
deterministic: the raw score and the price forecast are the projected
displacement D(h) (the validation curve turns the score into P(up)).
"""

from __future__ import annotations

import math

import numpy as np
from scipy.optimize import differential_evolution

from .common import (
    RidgeIndex,
    Simulated,
    Simulator,
    fit_generator,
    forward_steps,
    rows_of,
    scaled_steps,
    usable_training_rows,
    windows,
)

PARAMETER_NAMES = ("c0", "c_pressure", "c_stretch", "c_information", "c_volatility_damping", "log_information_time")


class StockFlowModel(Simulator):
    variant = "stock_flow"
    step_unit = "single_fit"

    @classmethod
    def _memory(cls, parameters: dict) -> int:
        return 5 * int(parameters["pressure_span_bars"])

    @classmethod
    def minimum_history(cls, parameters: dict) -> int:
        return max(cls._memory(parameters), int(parameters["stretch_window_bars"]) + int(parameters["feedback_delay_bars"])) + 2

    def prepare(self, context) -> None:
        p = self.parameters
        self.span = int(p["pressure_span_bars"])
        self.window = int(p["stretch_window_bars"])
        self.delay = int(p["feedback_delay_bars"])
        self.substeps = max(1, int(p["discretization_steps_per_bar"]))
        smoothing = 2.0 / (self.span + 1.0)
        self.pressure_weights = smoothing * (1.0 - smoothing) ** np.arange(self._memory(p))[::-1]
        self.pressure_rate = -math.log(1.0 - smoothing)

    # ── the stocks ──
    def stocks(self, features, view, rows) -> dict:
        """The observed stocks at each row, from bars <= row (see the module docstring)."""
        rows = rows_of(rows)
        steps = np.nan_to_num(scaled_steps(view), nan=0.0)
        memory = self.pressure_weights.size
        recent = windows(steps, rows, memory)
        recent = np.nan_to_num(recent, nan=0.0)
        pressure = recent @ self.pressure_weights
        volatility = np.sqrt((recent ** 2) @ self.pressure_weights) * math.sqrt(self.horizon)
        # stretch at rows r - delay .. r (the last column is the row itself)
        close = np.asarray(view.close, dtype=np.float64)
        scale = np.asarray(view.move_scale, dtype=np.float64)[rows]
        history = windows(close, rows, self.window + self.delay)
        stretch = np.empty((rows.size, self.delay + 1))
        for lag in range(self.delay + 1):
            end = history.shape[1] - lag
            block = history[:, end - self.window:end]
            stretch[:, self.delay - lag] = (block[:, -1] - block.mean(axis=1)) / scale
        information = self.index.apply(features, rows)
        return {"pressure": pressure, "volatility": volatility, "stretch": stretch, "information": information}

    # ── the flows ──
    def integrate(self, parameters: np.ndarray, stocks: dict, horizon: int) -> np.ndarray:
        """Cumulative displacement after each bar, (rows, horizon, candidates),
        for ``parameters`` of shape (6, candidates)."""
        c0, c_pressure, c_stretch, c_information, c_damping, log_time = (parameters[i][None, :] for i in range(6))
        rows = stocks["pressure"].shape[0]
        candidates = parameters.shape[1]
        pressure = np.repeat(stocks["pressure"][:, None], candidates, axis=1)
        volatility = stocks["volatility"][:, None]
        information = np.repeat(stocks["information"][:, None], candidates, axis=1)
        observed_stretch = stocks["stretch"]                     # (rows, delay + 1): bars t - delay .. t
        stretch = np.repeat(observed_stretch[:, -1][:, None], candidates, axis=1)
        dt = 1.0 / self.substeps
        steps = horizon * self.substeps
        information_rate = np.exp(-log_time)
        stretch_rate = 2.0 / self.window
        simulated_stretch = []
        displacement = np.zeros((rows, candidates))
        out = np.empty((rows, horizon, candidates))
        for step in range(steps):
            time = step * dt
            delayed_time = time - self.delay
            simulated_stretch.append(stretch)                    # the stretch at this step's time
            if delayed_time < 0:
                bar = int(math.floor(delayed_time + 1e-9))       # -delay .. -1: an observed bar before t
                delayed = np.repeat(observed_stretch[:, self.delay + bar][:, None], candidates, axis=1)
            else:
                delayed = simulated_stretch[int(round(delayed_time / dt))]
            velocity = (c0 + c_pressure * pressure / (1.0 + c_damping * volatility)
                        - c_stretch * delayed + c_information * information)
            displacement = displacement + velocity * dt
            pressure = pressure + self.pressure_rate * (velocity - pressure) * dt
            stretch = stretch + (velocity - stretch_rate * stretch) * dt
            information = information - information_rate * information * dt
            if (step + 1) % self.substeps == 0:
                out[:, (step + 1) // self.substeps - 1, :] = displacement
        return out

    # ── fit ──
    def train_epoch(self, epoch, report_batch, context) -> float | None:
        p = self.parameters
        view, features = context.view, context.features
        rows = usable_training_rows(view, features, context.train_index, int(p["maximum_training_bars"]))
        if rows.size < 30:
            raise ValueError(f"stock_flow: only {rows.size} usable training bars; need at least 30")
        observed = np.cumsum(forward_steps(view, rows, self.horizon), axis=1)
        keep = np.all(np.isfinite(observed), axis=1)
        rows, observed = rows[keep], observed[keep]
        target = np.full(len(view), np.nan)
        target[rows] = np.asarray(view.price_targets, dtype=np.float64)[rows] / self.horizon
        self.index = RidgeIndex.fit(features, rows, target, float(p["factor_ridge_penalty"]))
        stocks = self.stocks(features, view, rows)
        self.volatility_mean = float(np.mean(stocks["volatility"]))
        bound = float(p["flow_sensitivity_bound"])
        bounds = [(-1.0, 1.0), (-bound, bound), (-bound, bound), (-bound, bound), (0.0, bound),
                  (0.0, math.log(100.0))]

        def objective(candidates: np.ndarray) -> np.ndarray:
            candidates = np.atleast_2d(candidates)
            if candidates.shape[0] != 6:
                candidates = candidates.T
            simulated = self.integrate(candidates, stocks, self.horizon)
            return np.mean((simulated - observed[:, :, None]) ** 2, axis=(0, 1))

        dimension = len(bounds)
        result = differential_evolution(
            objective, bounds, maxiter=int(p["iteration_count"]),
            popsize=max(1, int(math.ceil(int(p["population_size"]) / dimension))), tol=1e-7,
            rng=fit_generator(self.seed, 3), polish=True, vectorized=True, updating="deferred", init="latinhypercube",
        )
        self.flow_parameters = np.asarray(result.x, dtype=np.float64)
        self.fit_loss = float(result.fun)
        baseline = float(np.mean(observed ** 2))
        report_batch(1, 1, int(rows[0]), int(rows[-1]), self.fit_loss)
        context.reporter.log("stock_flow: " + ", ".join(f"{name} {value:.4f}" for name, value in
                                                        zip(PARAMETER_NAMES, self.flow_parameters))
                             + f"; squared error {self.fit_loss:.4f} vs {baseline:.4f} for no move")
        return self.fit_loss

    def simulate(self, features, view, rows) -> Simulated:
        rows = rows_of(rows)
        count = rows.size
        score = np.full(count, np.nan)
        if count:
            finite = np.all(np.isfinite(features[rows]), axis=1) & np.isfinite(np.asarray(view.move_scale)[rows])
            if finite.any():
                stocks = self.stocks(features, view, rows[finite])
                projected = self.integrate(self.flow_parameters[:, None], stocks, self.horizon)[:, -1, 0]
                score[finite] = projected
        score[~np.isfinite(score)] = np.nan
        return Simulated(score, score.copy(), np.full(count, np.nan))

    def state(self) -> tuple[dict, dict]:
        arrays = {"flow_parameters": self.flow_parameters, "pressure_weights": self.pressure_weights,
                  **self.index.arrays("index")}
        return arrays, {"fit_loss": self.fit_loss, "volatility_mean": self.volatility_mean}

    def restore(self, arrays, document) -> None:
        self.prepare(None)
        self.flow_parameters = arrays["flow_parameters"]
        self.pressure_weights = arrays["pressure_weights"]
        self.index = RidgeIndex.from_arrays(arrays, "index")
        self.fit_loss = float(document["fit_loss"])
        self.volatility_mean = float(document["volatility_mean"])

    def summary(self) -> dict:
        return {"fit_loss": self.fit_loss, **{name: float(value) for name, value in zip(PARAMETER_NAMES, self.flow_parameters)}}
