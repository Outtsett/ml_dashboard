"""Stochastic differential equations, simulated by Euler-Maruyama.

The state is the log price X and, for the conditional models, a drift factor
z: the training span's ridge projection of the standardised features onto the
next bar's log return (so z is in log-return units per bar). Estimated on the
training span only:

- ``geometric_brownian_motion``: dX = mu dt + sigma dW with mu, sigma the mean and standard
  deviation of the one-bar log returns (unconditional: the same P(up) =
  Phi(mu sqrt(h) / sigma) at every bar).
- ``ornstein_uhlenbeck_drift``: dX = (a + z) dt + sigma dW1, dz = kappa (theta - z) dt +
  sigma_z dW2. kappa, theta and sigma_z come from the exact discretisation
  of the Ornstein-Uhlenbeck process (an AR(1) of consecutive training bars'
  z: phi = exp(-kappa)); sigma is the residual deviation.
- ``heston``: ``ornstein_uhlenbeck_drift`` whose variance v follows the CIR process dv =
  kappa_v (theta_v - v) dt + xi sqrt(v) dW3 with corr(dW1, dW3) = rho,
  fitted on non-overlapping blocks of the trailing squared residuals; v
  starts at bar t from the trailing ``variance_window_bars`` residuals.
- ``merton``: ``ornstein_uhlenbeck_drift`` plus compound Poisson jumps; the jump intensity
  and size are the training residuals beyond ``jump_threshold_deviations``
  robust deviations, the diffusion the rest.

Each bar is split into ``discretization_steps_per_bar`` Euler steps; paths are
drawn from the bar's own random stream. The raw score is the logit of the
share of paths with a positive h-bar log move; the price forecast is the mean
of close_t (exp(X_h) - 1) / move_scale_t.
"""

from __future__ import annotations

import math

import numpy as np

from .common import (
    RidgeIndex,
    Simulated,
    Simulator,
    finite_rows,
    logit_share,
    row_generator,
    rows_of,
    share_up,
    windows,
)

GEOMETRIC = "geometric_brownian_motion"
MODELS = (GEOMETRIC, "ornstein_uhlenbeck_drift", "heston", "merton")


class StochasticDifferentialEquation(Simulator):
    variant = "sde"
    step_unit = "single_fit"

    @classmethod
    def minimum_history(cls, parameters: dict) -> int:
        return int(parameters["variance_window_bars"]) + 2

    def prepare(self, context) -> None:
        self.model = str(self.parameters["diffusion_model"])
        if self.model not in MODELS:
            raise ValueError(f"sde: unknown diffusion_model {self.model!r}; valid: {', '.join(MODELS)}")

    # ── fit ──
    def train_epoch(self, epoch, report_batch, context) -> float | None:
        view, features = context.view, context.features
        returns = view.one_bar_returns()
        rows = finite_rows(features, view.fit_rows(context.train_index))
        # next-bar log returns of training rows: r + 1 <= train_index[-1] + 1, inside the purge
        rows = rows[rows + 1 < returns.shape[0]]
        following = returns[rows + 1]
        rows, following = rows[np.isfinite(following)], following[np.isfinite(following)]
        if rows.size < 30:
            raise ValueError(f"sde: only {rows.size} training bars with a known next return; need at least 30")
        self.drift = float(np.mean(following))
        self.diffusion = float(np.std(following))
        target = np.full(returns.shape[0], np.nan)
        target[rows] = following
        self.index = RidgeIndex.fit(features, rows, target, float(self.parameters["factor_ridge_penalty"]))
        self.factor_mean = 0.0
        self.factor_persistence = 0.0
        self.factor_speed = 0.0
        self.factor_diffusion = 0.0
        self.variance_speed = 0.0
        self.variance_mean = self.diffusion ** 2
        self.variance_volatility = 0.0
        self.variance_correlation = 0.0
        self.jump_intensity = 0.0
        self.jump_mean = 0.0
        self.jump_deviation = 0.0
        loss = float(np.mean(np.abs(following - self.drift)))
        if self.model != GEOMETRIC:
            factor = self.index.apply(features, rows) - self.index.intercept
            residual = following - self.index.intercept - factor
            self.drift = float(self.index.intercept)
            self.diffusion = float(np.std(residual))
            self._fit_factor(rows, factor, view)
            loss = float(np.mean(np.abs(residual)))
            if self.model == "heston":
                self._fit_variance(rows, residual, context)
            elif self.model == "merton":
                self._fit_jumps(residual, context)
        report_batch(1, 1, int(rows[0]), int(rows[-1]), loss)
        context.reporter.log(f"sde {self.model}: drift {self.drift:.3e}/bar, diffusion {self.diffusion:.3e}, "
                             f"factor persistence {self.factor_persistence:.3f}")
        return loss

    def _fit_factor(self, rows, factor, view) -> None:
        """The exact discretisation of the OU factor: an AR(1) over consecutive training bars."""
        position = {int(row): i for i, row in enumerate(rows)}
        gap_after = np.asarray(view.one_bar_crosses_gap, dtype=bool)
        pairs = [(position[int(r)], position[int(r) + 1]) for r in rows
                 if int(r) + 1 in position and not gap_after[int(r)]]
        if len(pairs) < 10:
            self.factor_persistence, self.factor_mean = 0.0, float(np.mean(factor))
            self.factor_diffusion_discrete = float(np.std(factor))
        else:
            before = factor[[a for a, _ in pairs]]
            after = factor[[b for _, b in pairs]]
            design = np.column_stack([np.ones(before.size), before])
            (constant, slope), *_ = np.linalg.lstsq(design, after, rcond=None)
            slope = float(np.clip(slope, 1e-3, 0.9999))
            self.factor_persistence = slope
            self.factor_mean = float(constant / (1.0 - slope))
            self.factor_diffusion_discrete = float(np.std(after - constant - slope * before))
        persistence = max(self.factor_persistence, 1e-3)
        self.factor_speed = -math.log(persistence)
        # the continuous sigma_z whose exact one-bar discretisation has this innovation deviation
        self.factor_diffusion = self.factor_diffusion_discrete * math.sqrt(
            2.0 * self.factor_speed / max(1.0 - persistence ** 2, 1e-9))

    def _fit_variance(self, rows, residual, context) -> None:
        window = int(self.parameters["variance_window_bars"])
        squared = residual ** 2
        block_count = squared.size // window
        if block_count < 8:
            context.reporter.log(f"sde heston: only {block_count} variance blocks; the variance is held constant")
            return
        blocks = squared[: block_count * window].reshape(block_count, window).mean(axis=1)
        sums = residual[: block_count * window].reshape(block_count, window).sum(axis=1)
        before, after = blocks[:-1], blocks[1:]
        design = np.column_stack([np.ones(before.size), before])
        (constant, slope), *_ = np.linalg.lstsq(design, after, rcond=None)
        slope = float(np.clip(slope, 1e-3, 0.999))
        self.variance_speed = -math.log(slope) / window
        self.variance_mean = float(max(constant / (1.0 - slope), 1e-12))
        noise = after - constant - slope * before
        mean_level = max(float(np.mean(before)), 1e-12)
        spread = (1.0 - math.exp(-2.0 * self.variance_speed * window)) / (2.0 * self.variance_speed)
        self.variance_volatility = float(math.sqrt(max(np.var(noise), 0.0) / (mean_level * spread)))
        changes = np.diff(blocks)
        correlation = np.corrcoef(sums[1:], changes)[0, 1] if changes.size > 2 else 0.0
        self.variance_correlation = float(np.clip(np.nan_to_num(correlation), -0.95, 0.95))

    def _fit_jumps(self, residual, context) -> None:
        median = float(np.median(residual))
        robust = 1.4826 * float(np.median(np.abs(residual - median)))
        if robust <= 0:
            return
        jumps = np.abs(residual - median) > float(self.parameters["jump_threshold_deviations"]) * robust
        if jumps.sum() >= 3:
            self.jump_intensity = float(jumps.mean())
            self.jump_mean = float(np.mean(residual[jumps]))
            self.jump_deviation = float(np.std(residual[jumps]))
            self.diffusion = float(np.std(residual[~jumps]))
        context.reporter.log(f"sde merton: {int(jumps.sum())} jumps, intensity {self.jump_intensity:.4f}/bar")

    # ── simulate ──
    def _start_variance(self, features, view, rows) -> np.ndarray:
        """Trailing mean of squared residuals over the window ending at each row (bars <= t)."""
        window = int(self.parameters["variance_window_bars"])
        returns = view.one_bar_returns()
        out = np.empty(rows.size)
        for position, row in enumerate(rows):
            span = np.arange(row - window + 1, row + 1)
            span = span[span >= 1]
            earlier = span - 1
            known = np.all(np.isfinite(features[earlier]), axis=1) & np.isfinite(returns[span])
            if known.sum() < 2:
                out[position] = self.variance_mean
                continue
            factor = self.index.apply(features, earlier[known]) - self.index.intercept
            residual = returns[span[known]] - self.drift - factor
            out[position] = float(np.mean(residual ** 2))
        return out

    def simulate(self, features, view, rows) -> Simulated:
        rows = rows_of(rows)
        count = rows.size
        score, mean_move, share = np.full(count, np.nan), np.full(count, np.nan), np.full(count, np.nan)
        finite = np.all(np.isfinite(features[rows]), axis=1) if count else np.zeros(0, dtype=bool)
        close = windows(view.close, rows, 1)[:, 0]
        scale = np.asarray(view.move_scale, dtype=np.float64)[rows]
        finite &= np.isfinite(close) & np.isfinite(scale)
        if not finite.any():
            return Simulated(score, mean_move, share)
        factor = np.zeros(count)
        if self.model != GEOMETRIC:
            factor[finite] = self.index.apply(features, rows[finite]) - self.index.intercept
        variance = np.full(count, self.diffusion ** 2)
        if self.model == "heston":
            variance[finite] = self._start_variance(features, view, rows[finite])
        substeps = max(1, int(self.parameters["discretization_steps_per_bar"]))
        steps = self.horizon * substeps
        dt = 1.0 / substeps
        paths = self.path_count
        for position in np.flatnonzero(finite):
            generator = row_generator(self.seed, int(rows[position]))
            price_noise = generator.standard_normal((paths, steps))
            x = np.zeros(paths)
            if self.model == GEOMETRIC:
                x = self.drift * self.horizon + self.diffusion * math.sqrt(dt) * price_noise.sum(axis=1)
            else:
                factor_noise = generator.standard_normal((paths, steps))
                z = np.full(paths, factor[position])
                v = np.full(paths, variance[position])
                variance_noise = generator.standard_normal((paths, steps)) if self.model == "heston" else None
                jump_counts = generator.poisson(self.jump_intensity * dt, (paths, steps)) if self.model == "merton" else None
                jump_noise = generator.standard_normal((paths, steps)) if self.model == "merton" else None
                root_dt = math.sqrt(dt)
                for step in range(steps):
                    if self.model == "heston":
                        positive = np.maximum(v, 0.0)
                        shock = price_noise[:, step]
                        x = x + (self.drift + z) * dt + np.sqrt(positive) * root_dt * shock
                        mixed = self.variance_correlation * shock + math.sqrt(1.0 - self.variance_correlation ** 2) * variance_noise[:, step]
                        v = v + self.variance_speed * (self.variance_mean - positive) * dt \
                            + self.variance_volatility * np.sqrt(positive) * root_dt * mixed
                    else:
                        x = x + (self.drift + z) * dt + self.diffusion * root_dt * price_noise[:, step]
                        if self.model == "merton":
                            jumps = jump_counts[:, step]
                            x = x + jumps * self.jump_mean + np.sqrt(jumps) * self.jump_deviation * jump_noise[:, step]
                    z = z + self.factor_speed * (self.factor_mean - z) * dt + self.factor_diffusion * root_dt * factor_noise[:, step]
            up = share_up(x)
            share[position] = up
            score[position] = logit_share(np.array([up]), paths)[0]
            mean_move[position] = float(np.mean(close[position] * np.expm1(x)) / scale[position])
        return Simulated(score, mean_move, share)

    # ── state ──
    NUMBERS = ("drift", "diffusion", "factor_mean", "factor_persistence", "factor_speed", "factor_diffusion",
               "variance_speed", "variance_mean", "variance_volatility", "variance_correlation", "jump_intensity",
               "jump_mean", "jump_deviation")

    def state(self) -> tuple[dict, dict]:
        document = {"model": self.model, **{name: float(getattr(self, name)) for name in self.NUMBERS}}
        return self.index.arrays("index"), document

    def restore(self, arrays, document) -> None:
        self.model = document["model"]
        for name in self.NUMBERS:
            setattr(self, name, float(document[name]))
        self.index = RidgeIndex.from_arrays(arrays, "index")

    def summary(self) -> dict:
        return {"model": self.model, **{name: float(getattr(self, name)) for name in self.NUMBERS}}
