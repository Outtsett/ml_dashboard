"""Discrete event simulation: a bivariate self-exciting (Hawkes) process of up
and down tick events, simulated event by event with Ogata's thinning.

Events. Each bar's close-to-close move is cut into events of
``event_size_ticks`` ticks (set on the training span so a bar carries about
``events_per_bar`` events): a bar that closes k events higher holds k up
events, spaced evenly through the bar; a step across a session gap holds none.
Intrabar highs and lows are not used: they are not available at prediction.

Model (time in bars). Intensity of type i (up, down):

    lambda_i(s) = mu_i + sum_j alpha_ij sum_{events e of type j before s} exp(-beta (s - t_e))
    mu_i        = exp(c_i + g_i . x)        x = the bar's first principal components

with alpha_ij = beta * b_ij, every branching ratio b_ij >= 0, and the
branching matrix's spectral radius (the expected events one event triggers,
all generations) held below ``hawkes_branching_limit`` by a smooth penalty, so
the process stays stationary.
The baseline of a bar reads the features of the bar before it. c, g, b and
beta are fitted by maximum likelihood (L-BFGS-B) on the training span's event
times; the exponential kernel makes the excitation a linear recursion over
bars (``scipy.signal.lfilter``), so the exact continuous-time likelihood is
vectorised.

Simulate bar t: the baseline from row t's features, the excitation from the
events of the last ``memory_bars`` bars, then ``path_count`` paths of Ogata
thinning over the horizon [0, h] (the intensity only decays between events,
so the current intensity bounds it). Each thinning step draws three uniforms
per path from the bar's own stream: the waiting time, the acceptance and the
event type. The net displacement (up minus down events) times the event size
is the simulated move; the raw score is the logit of the share of paths that
end higher, the price forecast their mean move in move-scale units.
"""

from __future__ import annotations

import math

import numpy as np
from scipy.optimize import minimize
from scipy.signal import lfilter

from .common import (
    Embedding,
    Simulated,
    Simulator,
    finite_rows,
    logit_share,
    point_steps,
    row_generator,
    rows_of,
    share_up,
    windows,
)

TYPES = ("up", "down")
PENALTY = 100.0


def spectral_radius(branching: np.ndarray) -> float:
    """The largest eigenvalue of a non-negative 2 x 2 branching matrix."""
    trace = branching[0, 0] + branching[1, 1]
    spread = (branching[0, 0] - branching[1, 1]) ** 2 + 4.0 * branching[0, 1] * branching[1, 0]
    return float((trace + math.sqrt(max(spread, 0.0))) / 2.0)


def _excitation_contribution(counts: np.ndarray, decay: float) -> np.ndarray:
    """Each bar's events' combined kernel value at the end of the bar:
    sum over m < n of exp(-decay (1 - (m + 0.5) / n))."""
    counts = np.asarray(counts, dtype=np.float64)
    out = np.zeros(counts.shape)
    positive = counts > 0
    n = counts[positive]
    per_event = decay / n
    out[positive] = np.exp(-per_event / 2.0) * (-np.expm1(-decay)) / (-np.expm1(-per_event))
    return out


class HawkesEventSimulation(Simulator):
    variant = "hawkes"
    step_unit = "single_fit"

    @classmethod
    def minimum_history(cls, parameters: dict) -> int:
        return int(parameters["memory_bars"]) + 1

    def prepare(self, context) -> None:
        self.limit = float(self.parameters["hawkes_branching_limit"])

    # ── events ──
    def event_counts(self, view, rows: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """(up_counts, down_counts) of the bars ``rows`` (bars <= each row only)."""
        steps = point_steps(view)[rows_of(rows)]
        ticks = np.nan_to_num(steps / float(view.tick_size), nan=0.0)
        counts = np.floor(np.abs(ticks) / self.event_size_ticks + 0.5)
        return np.where(ticks > 0, counts, 0.0), np.where(ticks < 0, counts, 0.0)

    # ── fit ──
    def _unpack(self, theta: np.ndarray):
        d = self.embedding.dimension
        c = theta[0:2]
        g = theta[2:2 + 2 * d].reshape(2, d)
        branching = theta[2 + 2 * d:6 + 2 * d].reshape(2, 2)
        decay = math.exp(theta[6 + 2 * d])
        return c, g, branching, decay

    def _negative_log_likelihood(self, theta: np.ndarray) -> float:
        c, g, branching, decay = self._unpack(theta)
        up, down = self.train_up, self.train_down
        baseline = np.exp(np.clip(c[None, :] + self.train_components @ g.T, -30.0, 30.0))   # (bars, 2)
        contribution = np.column_stack([_excitation_contribution(up, decay), _excitation_contribution(down, decay)])
        state = lfilter([1.0], [1.0, -math.exp(-decay)], contribution, axis=0)
        before = np.vstack([np.zeros((1, 2)), state[:-1]])                                  # S_j at each bar's start
        decayed_share = -math.expm1(-decay)
        # compensator of both types over every scored bar
        own_mass = np.column_stack([up, down]) - contribution                              # sum_m (1 - exp(-decay (1 - u_m)))
        compensator = (baseline + (before * decayed_share) @ branching.T + own_mass @ branching.T)[self.train_scored].sum()
        # log intensity of each event at its own time
        bar, k, n, kind = self.event_bar, self.event_rank, self.event_count, self.event_kind
        offset = (k + 0.5) / n
        step = np.exp(-decay / n)
        earlier = step * (-np.expm1(-decay * k / n)) / (-np.expm1(-decay / n))                 # same-bar events before k
        from_past = before[bar] * np.exp(-decay * offset)[:, None]                          # (events, 2)
        # alpha_ij = decay * b_ij: excitation from earlier bars plus the same bar's earlier events
        intensity = baseline[bar, kind] + decay * ((from_past * branching[kind]).sum(axis=1)
                                                   + branching[kind, kind] * earlier)
        if np.any(intensity <= 0):
            return 1e12
        excess = max(0.0, spectral_radius(branching) - self.limit)
        return float(compensator - np.sum(np.log(intensity)) + PENALTY * self.event_bar.size * excess ** 2)

    def train_epoch(self, epoch, report_batch, context) -> float | None:
        p = self.parameters
        view, features = context.view, context.features
        span = view.fit_rows(context.train_index)
        span = span[span >= 1]
        if span.size > int(p["maximum_training_bars"]):
            span = span[-int(p["maximum_training_bars"]):]
        steps = point_steps(view)[span]
        mean_ticks = float(np.nanmean(np.abs(steps))) / float(view.tick_size)
        if not math.isfinite(mean_ticks) or mean_ticks <= 0:
            raise ValueError("hawkes: the training span has no price moves")
        self.event_size_ticks = max(1.0, float(round(mean_ticks / float(p["events_per_bar"]))))
        scored = np.all(np.isfinite(features[span - 1]), axis=1)
        if scored.sum() < 50:
            raise ValueError(f"hawkes: only {int(scored.sum())} training bars with features before them; need 50")
        self.embedding = Embedding.fit(features, finite_rows(features, span - 1), int(p["principal_component_count"]))
        components = np.zeros((span.size, self.embedding.dimension))
        components[scored] = self.embedding.apply(features, (span - 1)[scored])
        self.train_components = components
        self.train_scored = scored
        self.train_up, self.train_down = self.event_counts(view, span)
        counts = np.column_stack([self.train_up, self.train_down]).astype(np.int64)
        bars, kinds = [], []
        for kind in range(2):
            with_events = np.flatnonzero(counts[:, kind] > 0)
            bars.append(np.repeat(with_events, counts[with_events, kind]))
            kinds.append(np.full(int(counts[:, kind].sum()), kind))
        order = np.argsort(np.concatenate(bars), kind="stable")
        bar = np.concatenate(bars)[order]
        kind = np.concatenate(kinds)[order]
        keep = scored[bar]
        self.event_bar, self.event_kind = bar[keep], kind[keep]
        # rank of each event within its bar (a bar's events are all one type and sit together once sorted)
        first = np.searchsorted(self.event_bar, self.event_bar, side="left")
        self.event_rank = (np.arange(self.event_bar.size) - first).astype(np.float64)
        self.event_count = counts[self.event_bar, self.event_kind].astype(np.float64)
        d = self.embedding.dimension
        mean_counts = np.maximum(counts[scored].mean(axis=0), 0.05)
        start = np.concatenate([np.log(mean_counts * 0.7), np.zeros(2 * d), np.full(4, 0.1), [0.0]])
        bounds = [(-20.0, 10.0)] * 2 + [(-5.0, 5.0)] * (2 * d) + [(0.0, self.limit)] * 4 + [(math.log(0.05), math.log(50.0))]
        result = minimize(self._negative_log_likelihood, start, method="L-BFGS-B", bounds=bounds,
                          options={"maxiter": int(p["iteration_count"])})
        self.theta = np.asarray(result.x, dtype=np.float64)
        radius = spectral_radius(self._unpack(self.theta)[2])
        if radius > self.limit:
            # the penalty leaves at most a sliver above the limit; project onto it so the process is stationary
            d = self.embedding.dimension
            self.theta[2 + 2 * d:6 + 2 * d] *= self.limit / radius
        self.fit_loss = float(result.fun) / max(1, int(scored.sum()))
        c, g, branching, decay = self._unpack(self.theta)
        for name in ("train_components", "train_scored", "train_up", "train_down", "event_bar", "event_kind",
                     "event_rank", "event_count"):
            delattr(self, name)
        report_batch(1, 1, int(span[0]), int(span[-1]), self.fit_loss)
        context.reporter.log(f"hawkes: event size {self.event_size_ticks:.0f} ticks, decay {decay:.3f}/bar, "
                             f"branching up<-up {branching[0, 0]:.3f} up<-down {branching[0, 1]:.3f} "
                             f"down<-up {branching[1, 0]:.3f} down<-down {branching[1, 1]:.3f}")
        return self.fit_loss

    # ── simulate ──
    def simulate(self, features, view, rows) -> Simulated:
        rows = rows_of(rows)
        count = rows.size
        score, mean_move, share = np.full(count, np.nan), np.full(count, np.nan), np.full(count, np.nan)
        if not count:
            return Simulated(score, mean_move, share)
        scale = np.asarray(view.move_scale, dtype=np.float64)[rows]
        finite = np.all(np.isfinite(features[rows]), axis=1) & np.isfinite(scale)
        if not finite.any():
            return Simulated(score, mean_move, share)
        c, g, branching, decay = self._unpack(self.theta)
        alpha = decay * branching
        memory = int(self.parameters["memory_bars"])
        baseline = np.exp(np.clip(c[None, :] + self.embedding.apply(features, rows[finite]) @ g.T, -30.0, 30.0))
        weights = np.exp(-decay * np.arange(memory)[::-1])                        # the row itself has weight 1
        history_rows = windows(np.arange(len(view), dtype=np.float64), rows[finite], memory)
        known = np.isfinite(history_rows) & (history_rows >= 1)
        flat = np.where(known, history_rows, 1).astype(np.int64).reshape(-1)
        up, down = self.event_counts(view, flat)
        up = np.where(known.reshape(-1), up, 0.0).reshape(history_rows.shape)
        down = np.where(known.reshape(-1), down, 0.0).reshape(history_rows.shape)
        start_state = np.column_stack([_excitation_contribution(up, decay) @ weights,
                                       _excitation_contribution(down, decay) @ weights])
        paths = self.path_count
        cap = int(self.parameters["horizon_event_limit"])
        size = self.event_size_ticks * float(view.tick_size)
        column_alpha = alpha.sum(axis=0)                                           # total intensity per unit of H_j
        for position, where in enumerate(np.flatnonzero(finite)):
            generator = row_generator(self.seed, int(rows[where]))
            mu = baseline[position]
            excitation = np.repeat(start_state[position][None, :], paths, axis=0)
            time = np.zeros(paths)
            net = np.zeros(paths)
            active = np.ones(paths, dtype=bool)
            for _ in range(cap):
                uniforms = generator.random((3, paths))
                bound = mu.sum() + excitation @ column_alpha
                wait = -np.log1p(-uniforms[0]) / bound
                time = time + wait
                active &= time <= self.horizon
                if not active.any():
                    break
                excitation = excitation * np.exp(-decay * wait)[:, None]
                up_intensity = mu[0] + excitation @ alpha[0]
                total = up_intensity + mu[1] + excitation @ alpha[1]
                accepted = active & (uniforms[1] * bound <= total)
                is_up = uniforms[2] * total < up_intensity
                net = net + np.where(accepted, np.where(is_up, 1.0, -1.0), 0.0)
                excitation[:, 0] += accepted & is_up
                excitation[:, 1] += accepted & ~is_up
            moves = net * size / scale[where]
            up_share = share_up(moves)
            share[where] = up_share
            score[where] = logit_share(np.array([up_share]), paths)[0]
            mean_move[where] = float(moves.mean())
        return Simulated(score, mean_move, share)

    def state(self) -> tuple[dict, dict]:
        return {"theta": self.theta, **self.embedding.arrays("embedding")}, {
            "event_size_ticks": self.event_size_ticks, "fit_loss": self.fit_loss}

    def restore(self, arrays, document) -> None:
        self.prepare(None)
        self.theta = arrays["theta"]
        self.embedding = Embedding.from_arrays(arrays, "embedding")
        self.event_size_ticks = float(document["event_size_ticks"])
        self.fit_loss = float(document["fit_loss"])

    def summary(self) -> dict:
        c, g, branching, decay = self._unpack(self.theta)
        return {"event_size_ticks": self.event_size_ticks, "decay_per_bar": decay, "fit_loss": self.fit_loss,
                "branching": branching.tolist(), "baseline_constants": c.tolist()}
