"""Regime Monte Carlo decision stack behind the Model Cycle's ``ModelAdapter`` contract.

Built by ``models.build_adapter`` for the registry entry with
``adapter == "regime_montecarlo_decision"``
(``packages/config/cycle_models/regime_montecarlo_decision.json``) through the
registry constructor ``RegimeMonteCarloDecisionAdapter(key, entry, parameters,
device, seed, task=task)``, and bound to the run's ``cycle.market.MarketView``
by the engine (``bind_market``).

Four models feed one decision model. Every one of them reads only bars at or
before the bar it speaks for.

1. **Regime model** — the structural regime hidden Markov model
   (``cycle.regime_hmm.StructuralRegimeHMM``, specification ``docs/regime-hmm.md``):
   exactly three states, named and ordered ``flat``, ``uptrend``, ``downtrend``,
   over eight causal features per bar — a flat-market detector (Wilder's ADX 14,
   the candle body-to-range ratio over 14 bars, the 14-bar over 100-bar true
   range), swing structure (N-bar confirmed pivots from the dashboard's own
   ``shared.zones.structural_pivots``, N = ``swing_confirmation_bars``: the
   close's distance from the last confirmed swing high and low over the move
   scale, bars since the last pivot) and trend confirmation (a decayed
   higher-high / higher-low counter and the sign of the last two pivots). The
   emission of each state is a diagonal Gaussian over the features standardised
   on the training span; Baum-Welch (hmmlearn) is seeded from a heuristic
   labelling (flat where ADX < ``adx_threshold``, else up / down by the sign of
   the counter) with a sticky transition prior, refined for up to
   ``regime_fit_iteration_count`` iterations on the training span only, and the
   states are ordered afterwards by the mean of the counter. During the walk the
   adapter runs the FORWARD filter, never the smoother:
   ``alpha_t = normalise((alpha_(t-1) · A) * b(x_t))``, with ``A`` the fitted
   transition matrix and ``b`` the Gaussian density of each state; a bar whose
   features are not all known (the warmup, a session gap in the move scale) only
   advances ``alpha_(t-1) · A``. The filter starts ``REGIME_FILTER_BURN_IN_BARS``
   bars before the training span, so its start never depends on a later bar.

2. **Monte Carlo simulator** — per regime, a Student-t distribution of the
   one-bar log return fitted by maximum likelihood (``scipy.stats.t.fit``; degrees
   of freedom held inside 2.05..200 with location and scale refitted, see
   ``student_t_fit``) on the training bars the forward filter puts in that regime (a regime
   with fewer than ``MINIMUM_REGIME_RETURNS`` bars uses the pooled training
   returns, and says so). At bar t, ``simulation_count`` paths of ``horizon``
   bars start from the filtered regime probabilities: the first bar's regime is
   drawn from ``alpha_t · A`` and every later bar's from the row of ``A`` of
   the bar before, and each bar's log return from its regime's Student-t. The
   random numbers (uniforms for the regime draws, standard Student-t draws per
   regime) are drawn once per fit from ``seed`` and reused at every bar — common
   random numbers, so two bars' forecasts differ only because the market moved.
   Out: P(close[t+h] > close[t]) (the share of paths ending higher), the expected
   move in points (``close_t · mean(exp(sum of log returns) − 1)``) and the
   10th, 50th and 90th percentile paths in points, bar by bar to the horizon.

3. **Kronos** — the pretrained K-line foundation model (``Kronos/`` at the
   repository root, weights ``NeoQuasar/Kronos-<size>`` from the Hugging Face
   cache at a pinned revision, loaded on the GPU once per process). For bar t
   it reads the ``kronos_context_bars`` candles ending at t (open, high, low,
   close, volume, and amount = volume × mean price, normalised per window as
   ``KronosPredictor`` does) and decodes the next ``horizon`` candles greedily
   (top-k 1, one sample, so the forecast is deterministic). Out: the predicted
   candles and the predicted move ``predicted close[t+h] − close[t]``. Kronos
   is not fitted here; forecasts are cached per bar for the whole process, so
   tuning trials and the walk reuse them.

4. **FinBERT** — the nine ``finbert_*`` news columns of the run's feature
   matrix, read by name (``docs/finbert.md``), as they are.

**Decision model** — gradient-boosted trees (``xgboost.train``,
``binary:logistic``) over the stacked signals: the regime probabilities, the
simulation's P(up), its expected move and its 10–90 percentile spread (both
divided by the run's causal move scale), Kronos' predicted move (divided by the
same scale) and direction, the trailing move (close now minus the close
``horizon`` bars ago, divided by the same scale) and the FinBERT columns. The
trailing move is what a reversal label turns against: without it the model
cannot say "the simulation points up and the last bars fell, so a turn", only
"up" or "down" (added 2026-10-08; a model saved before then has no such column
and is scored without it). Its probability is the adapter's direction
probability. The regime and Monte Carlo signals of the training rows
are made OUT OF FOLD: the most recent ``maximum_training_bars`` training rows
are cut into ``stacking_fold_count`` contiguous blocks, and each block's signals
come from a regime model and return distributions fitted on the training span
without that block and without ``horizon`` bars either side of it (the purge:
a block row's label is the close ``horizon`` bars later, so the bars it reads
are kept out of the fit that scores it). Kronos and FinBERT fit nothing on
these bars, so their signals are used as they are. The validation rows' signals
come from the regime model fitted on the whole training span, and stop the
boosting early. Feature weights are the decision model's total gain per signal,
as shares of the total (``feature_weights``).

**Trade gate** — a cost floor behind an evidence certificate, all in points and
all measured (no gate setting, nothing for the search to open). The engine fills
a call at the next bar's open and holds it ``horizon`` bars, so a call pays for
itself only when its expected gain exceeds one round trip
(``view.round_trip_cost_points``). At fit:

1. ``move_ratio`` = mean |open[t + h + 1] − open[t + 1]| ÷ mean ``move_scale[t]``
   over the training span's rows whose trade is filled by ``train_index[-1] + h``
   and crosses no session gap: the traded move as a multiple of the engine's
   causal move scale (``trade_moves``).
2. The decision model is refitted ``stacking_fold_count`` times, each time
   without one stacking block and without ``horizon + 1`` bars either side of
   it, and scores that block (purged out-of-fold probabilities, the kept
   model's rounds). For each such row the model's CLAIMED gain is
   ``2 × |P − 0.5| × move_ratio × move_scale[t]`` points — what a calibrated
   call would earn, (2q − 1) × the expected absolute move with q = 0.5 + |P − 0.5|
   — and its REALISED gain is the traded move in the direction the call takes:
   ``s × d × (open[t + h + 1] − open[t + 1])``, s = +1 when P >= 0.5 else −1, and
   d the price direction label 1 stands for at that row (+1 or −1, read off the
   row's label and its realised close move, so the same code serves direction
   and reversal labels; a row whose close did not move is left out).
3. The REALISATION SLOPE is Σ(claimed × realised) ÷ Σ(claimed²): the points that
   arrived per point claimed (a regression through the origin). Its standard
   error is Newey–West over ``horizon`` lags, because the h-bar outcomes of
   neighbouring rows overlap, and never smaller than the uncorrelated one
   (``realisation_slope``).
4. The fold is CERTIFIED when slope − 1.645 × standard error > 0 (a one-sided
   95% bound) on at least ``MINIMUM_EVIDENCE_ROWS`` rows.

``trade_gate(features, index)`` is open on a bar when the fold is certified AND
``slope × 2 × |P − 0.5| × move_ratio × move_scale[bar] > round_trip_cost_points``
(the slope is the calibration: a model that under-states its gain is scaled up,
one that over-states it down). A fold that is not certified stands aside on
every bar. The engine still scores every bar's direction; it enters only where
the gate is open, and a closed gate stands aside (signal 0: no new entry, the
held position runs to its holding period). |P(turn) − 0.5| = |P(up) − 0.5|, so
the gate is the same under reversal labels.

The booster's base score is pinned at 0.5. Left free, xgboost sets it to the
share of label 1 among the stacking rows, and with one kept round the trees move
the probability by less than that share sits from 0.5: every bar of a fold then
gets the same call (measured 2026-10-08 on the first run: fold 1 called WITH the
trailing move on 100% of its test bars, fold 2 AGAINST it on 100%, from stacking
turn rates of 49.4% and 52.7%). Pinned, the distance from 0.5 comes from the
trees, which is the per-bar evidence the gate reads.

What this replaced (2026-10-08): a share gate, ``gate_open_fraction``, searched
between 0.05 and 1. The first run's search chose 0.22, 0.98 and 0.72; the model
flipped its position on 570 of 607 trades, earned 2.48 US dollars gross per
trade against the 2.78 it paid, and its gross was not distinguishable from zero
(t = 0.9). A cost floor on the raw probability was measured too and was worse
(410 trades, −1,692 US dollars), because the raw distance from 0.5 was the base
score, not skill. Because this gate opens only on out-of-fold evidence, the
model's search is scored on log loss (``required_tuning_objective``): a Sharpe
search scores a trial that stands aside 0.0 and so picks whichever trial traded
by luck.

**Price model** (``task="regression"``) — the regime model and the Monte Carlo
simulator alone: the expected move of the simulation divided by the move scale,
in the engine's target units.

**Live diagnostics** — ``regime_forecast(row)`` returns, for a bar the adapter
has scored, the regime probabilities, the fan, Kronos' candles, the decision
probability and the gate; the engine streams them as ``cycle_regime_forecast``.

The explainer cannot reload this model: Kronos reads open, high, low and volume
and the regime model reads open, high and low at predict time, and the
explainer's saved arrays carry none of them (``cycle.market``). Predicting from
a view without them is refused with a sentence that says so.

Saved as ``decision_model.ubj`` (xgboost), ``regime_model.npz`` (the structural
regime model, its feature scaler and the per-regime Student-t parameters) and
``model.json``.
"""

from __future__ import annotations

import importlib
import math
import os
import sys
import threading
import time
from pathlib import Path

import numpy as np

from .. import catalog
from ..adapter import MODEL_TASKS, BatchReport, EpochReport
from ..fitting import Stopwatch, run_single_fit
from ..models import (
    _base_metadata,
    _require_both_classes,
    _RoundReporter,
    _training_summary,
    _wrong_task_error,
    binary_scores,
    regression_scores,
    write_metadata,
)
from ..paths import PACKAGES_ROOT
from ..regime_hmm import REGIME_NAMES, StructuralRegimeHMM, contiguous_lengths, structural_features

ADAPTER = "regime_montecarlo_decision"
DECISION_MODEL_FILE = "decision_model.ubj"
REGIME_MODEL_FILE = "regime_model.npz"

FINBERT_PREFIX = "finbert_"
# close[t] - close[t - horizon], divided by the move scale: the move a reversal label turns against
TRAILING_MOVE_SIGNAL = "trailing_move_scaled"
REGIME_FILTER_BURN_IN_BARS = 1000
MINIMUM_REGIME_RETURNS = 50
STUDENT_DEGREES_OF_FREEDOM_BOUNDS = (2.05, 200.0)
EARLY_STOPPING_ROUNDS = 30
# the trade gate's certificate: purged out-of-fold rows it needs, and the one-sided 95% normal quantile
MINIMUM_EVIDENCE_ROWS = 300
CERTIFICATE_QUANTILE = 1.645
KRONOS_BATCH_ROWS = 128
KRONOS_CLIP = 5.0
# simulated values held in memory at once (rows x paths x horizon) before the walk is chunked
SIMULATION_CHUNK_VALUES = 4_000_000

# Kronos models: (model repository, revision, tokenizer repository, revision, maximum context)
KRONOS_MODELS = {
    "mini": ("NeoQuasar/Kronos-mini", "f4e68697d9d5aed55cef5c96aabc3376bcad9f81",
             "NeoQuasar/Kronos-Tokenizer-2k", "26966d0035065a0cae0ebad7af8ece35bc1fb51c", 2048),
    "small": ("NeoQuasar/Kronos-small", "901c26c1332695a2a8f243eb2f37243a37bea320",
              "NeoQuasar/Kronos-Tokenizer-base", "0e0117387f39004a9016484a186a908917e22426", 512),
    "base": ("NeoQuasar/Kronos-base", "2b554741eca47781b64468546e77fef3e85130e6",
             "NeoQuasar/Kronos-Tokenizer-base", "0e0117387f39004a9016484a186a908917e22426", 512),
}

# One loaded Kronos per (size, device) and one forecast per bar for the whole process.
_KRONOS_LOADED: dict[tuple[str, str], tuple[object, object, int, object]] = {}
_KRONOS_FORECASTS: dict[tuple, np.ndarray] = {}
_KRONOS_LOCK = threading.Lock()


# ─── the regime model ──────────────────────────────────────────────────────


def regime_features(view, swing_confirmation_bars: int) -> np.ndarray:
    """(n, 8) the structural regime features of every bar of ``view`` (``cycle.regime_hmm``):
    each row from bars at or before it, NaN while a window fills."""
    if view.open is None or view.high is None or view.low is None:
        raise RuntimeError(
            "the structural regime model reads each bar's open, high and low, and this market view does not carry "
            "them (the explainer's saved arrays hold only closes)"
        )
    return structural_features(view.open, view.high, view.low, view.close, view.move_scale, int(swing_confirmation_bars))


class RegimeModel:
    """The fitted structural regime hidden Markov model (``flat``, ``uptrend``, ``downtrend``)
    and the Student-t of the one-bar log return in each of its regimes."""

    def __init__(self, hmm: StructuralRegimeHMM, student: np.ndarray, regime_bar_counts: np.ndarray,
                 pooled: np.ndarray, sample_deviation: np.ndarray | None = None) -> None:
        self.hmm = hmm
        self.student = np.asarray(student, dtype=np.float64)          # (3, 3): degrees of freedom, location, scale
        self.regime_bar_counts = np.asarray(regime_bar_counts, dtype=np.int64)
        self.pooled = np.asarray(pooled, dtype=bool)
        # the standard deviation of the one-bar log returns of each regime's training bars, as
        # measured; NaN for a model saved before 2026-10-08, which did not keep it
        self.sample_deviation = (np.full(len(REGIME_NAMES), np.nan) if sample_deviation is None
                                 else np.asarray(sample_deviation, dtype=np.float64))
        self.regime_count = len(REGIME_NAMES)
        self.regime_names = REGIME_NAMES

    @property
    def transition(self) -> np.ndarray:
        return self.hmm.transition

    @property
    def log_likelihood(self) -> float | None:
        return self.hmm.log_likelihood

    def forward_filter(self, features: np.ndarray, start_row: int, end_row: int, state=None):
        """``StructuralRegimeHMM.forward_filter``: filtered probabilities of rows ``start_row..end_row``."""
        return self.hmm.forward_filter(features, start_row, end_row, state)

    def arrays(self) -> dict:
        return {**self.hmm.arrays(), "student": self.student, "regime_bar_counts": self.regime_bar_counts,
                "pooled": self.pooled, "sample_deviation": self.sample_deviation}

    @classmethod
    def from_arrays(cls, arrays) -> RegimeModel:
        try:
            sample_deviation = arrays["sample_deviation"]
        except KeyError:
            sample_deviation = None
        return cls(StructuralRegimeHMM.from_arrays(arrays), arrays["student"], arrays["regime_bar_counts"],
                   arrays["pooled"], sample_deviation)

    def summaries(self) -> list[dict]:
        """One plain record per regime in ``REGIME_NAMES`` order: the hidden Markov model's own
        summary (name, feature means in words, stay probability, expected bars per visit) and the
        regime's Student-t of the one-bar log return."""
        out = []
        for k, summary in enumerate(self.hmm.summaries()):
            degrees, location, scale = (float(v) for v in self.student[k])
            # The deviation reported is the one MEASURED on the regime's training returns. The fitted
            # Student-t's own standard deviation, scale * sqrt(df / (df - 2)), grows without bound as
            # the degrees of freedom approach 2 (real 5-minute returns fit near 2.0-2.8): measured
            # 2026-10-08 on MNQ it read 1.26x, 2.85x and 1.47x the sample deviation of the same bars.
            measured = float(self.sample_deviation[k])
            deviation = measured if math.isfinite(measured) else None
            out.append({
                **summary,
                "meanLogReturn": location,
                "volatilityLogReturn": deviation,
                "degreesOfFreedom": degrees,
                "scale": scale,
                "trainingBarCount": int(self.regime_bar_counts[k]),
                "pooled": bool(self.pooled[k]),
            })
        return out


def student_t_fit(values: np.ndarray) -> tuple[float, float, float]:
    """(degrees of freedom, location, scale) of a Student-t by maximum likelihood
    (``scipy.stats.t.fit``).

    The values are fitted STANDARDISED (minus their mean, over their standard deviation)
    and the location and scale are mapped back. One-bar log returns are about 1e-4 in
    size, and on raw values that small scipy's optimiser stops before it converges: it
    returns degrees of freedom just under 2 whatever the data (measured 2026-10-07 on
    7,000 draws from a Student-t with 6 degrees of freedom and scale 8e-4: the raw fit
    gave 2.05 with a scale 19% too small, the standardised fit 5.96 and 7.95e-4). The
    degrees of freedom do not depend on the units, so the standardised fit is the same
    maximum-likelihood problem on a scale the optimiser handles.

    When the fitted degrees of freedom still fall outside
    ``STUDENT_DEGREES_OF_FREEDOM_BOUNDS`` (below 2 the variance is infinite), they are
    held at the nearer bound and location and scale are refitted with them fixed, so the
    three numbers always belong to one fitted distribution."""
    from scipy import stats

    values = np.asarray(values, dtype=np.float64)
    center = float(np.mean(values))
    spread = float(np.std(values))
    if not math.isfinite(spread) or spread <= 0.0:
        # no variation to fit: the caller pools such a regime before it gets here
        return float(STUDENT_DEGREES_OF_FREEDOM_BOUNDS[1]), center, 0.0
    standardised = (values - center) / spread
    degrees, location, scale = stats.t.fit(standardised)
    low, high = STUDENT_DEGREES_OF_FREEDOM_BOUNDS
    if not (low <= degrees <= high) or not math.isfinite(degrees):
        held = low if not math.isfinite(degrees) or degrees < low else high
        degrees, location, scale = stats.t.fit(standardised, fdf=held)
    return float(degrees), float(location) * spread + center, float(scale) * spread


def fit_regime_model(features: np.ndarray, returns: np.ndarray, fit_rows: np.ndarray, adx_threshold: float,
                     iteration_count: int, seed: int) -> RegimeModel:
    """Fit the structural hidden Markov model on ``fit_rows`` (those with every feature known,
    as their contiguous runs), then fit each regime's Student-t on the one-bar log returns of
    the training bars the FORWARD filter puts in it."""
    rows = np.asarray(fit_rows, dtype=np.int64)
    hmm = StructuralRegimeHMM(adx_threshold, iteration_count, seed).fit(features, rows)
    known_rows = rows[np.all(np.isfinite(features[rows]), axis=1)]
    filtered, _ = hmm.forward_filter(features, int(known_rows[0]), int(known_rows[-1]))
    probabilities = filtered[known_rows - int(known_rows[0])]
    returns = np.asarray(returns, dtype=np.float64)
    usable = np.all(np.isfinite(probabilities), axis=1) & np.isfinite(returns[known_rows])
    assigned = np.argmax(probabilities[usable], axis=1)
    fit_returns = returns[known_rows][usable]
    if fit_returns.size < MINIMUM_REGIME_RETURNS:
        raise ValueError(f"the regime Monte Carlo needs at least {MINIMUM_REGIME_RETURNS} training bars with a one-bar "
                         f"return and regime probabilities; it has {fit_returns.size}")
    pooled_fit = student_t_fit(fit_returns)
    student = np.empty((len(REGIME_NAMES), 3), dtype=np.float64)
    counts = np.zeros(len(REGIME_NAMES), dtype=np.int64)
    pooled = np.zeros(len(REGIME_NAMES), dtype=bool)
    sample_deviation = np.empty(len(REGIME_NAMES), dtype=np.float64)
    for k in range(len(REGIME_NAMES)):
        mine = fit_returns[assigned == k]
        counts[k] = mine.size
        if mine.size >= MINIMUM_REGIME_RETURNS and float(np.ptp(mine)) > 0:
            degrees, location, scale = student_t_fit(mine)
            sample_deviation[k] = float(np.std(mine))
        else:
            degrees, location, scale = pooled_fit
            pooled[k] = True
            sample_deviation[k] = float(np.std(fit_returns))
        student[k] = (degrees, location, max(scale, 1e-12))
    return RegimeModel(hmm, student, counts, pooled, sample_deviation)


# ─── the Monte Carlo simulator ─────────────────────────────────────────────


class MonteCarloSimulator:
    """Regime-switching Student-t paths with common random numbers (see the module docstring)."""

    def __init__(self, regime_model: RegimeModel, simulation_count: int, horizon: int, seed: int) -> None:
        self.model = regime_model
        self.simulation_count = int(simulation_count)
        self.horizon = int(horizon)
        generator = np.random.default_rng(int(seed))
        self.uniforms = generator.random((self.simulation_count, self.horizon))
        self.standard_draws = np.stack([
            generator.standard_t(float(regime_model.student[k, 0]), size=(self.simulation_count, self.horizon))
            for k in range(regime_model.regime_count)
        ])
        self.cumulative_transition = np.cumsum(regime_model.transition, axis=1)
        self.cumulative_transition[:, -1] = 1.0
        self.location = regime_model.student[:, 1]
        self.scale = regime_model.student[:, 2]

    def expected_log_move(self, probabilities: np.ndarray) -> np.ndarray:
        """The exact expected total log return over the horizon from each row's filtered regime
        probabilities: the regime distribution s bars ahead is alpha_t A^s, and a bar in regime k
        has expected log return location_k (a Student-t's mean, which exists above 1 degree of
        freedom), so the total is the sum over s = 1..horizon of (alpha_t A^s) . location."""
        probabilities = np.asarray(probabilities, dtype=np.float64)
        ahead = probabilities @ self.model.transition
        total = ahead @ self.location
        for _ in range(1, self.horizon):
            ahead = ahead @ self.model.transition
            total = total + ahead @ self.location
        return total

    def simulate(self, probabilities: np.ndarray, close: np.ndarray) -> dict:
        """For each row: P(up), the expected move in points and the 10/50/90 percentile
        move paths in points (rows x horizon). Rows whose probabilities are unknown get NaN.

        P(up) and the percentiles are read off the simulated paths: a share and three order
        statistics, which a few extreme draws cannot move. The expected move is NOT the mean of
        the simulated moves. Each regime's returns are Student-t with about 2 to 3 degrees of
        freedom, so the mean of 2,000 such paths is set by its largest few draws, and
        E[exp(return)] does not exist for a Student-t at all. It is computed exactly instead: the
        expected total log return over the horizon, sum over steps s of (alpha_t A^s) . location,
        times the close (``expected_log_move``)."""
        probabilities = np.asarray(probabilities, dtype=np.float64)
        close = np.asarray(close, dtype=np.float64)
        rows = probabilities.shape[0]
        horizon = self.horizon
        result = {
            "probability_up": np.full(rows, np.nan),
            "expected_move_points": np.full(rows, np.nan),
            "percentile_10_points": np.full((rows, horizon), np.nan),
            "percentile_50_points": np.full((rows, horizon), np.nan),
            "percentile_90_points": np.full((rows, horizon), np.nan),
        }
        known = np.flatnonzero(np.all(np.isfinite(probabilities), axis=1) & np.isfinite(close))
        if known.size == 0:
            return result
        result["expected_move_points"][known] = close[known] * self.expected_log_move(probabilities[known])
        chunk = max(1, SIMULATION_CHUNK_VALUES // (self.simulation_count * horizon))
        paths = np.arange(self.simulation_count)
        regime_count = self.model.regime_count
        for begin in range(0, known.size, chunk):
            positions = known[begin:begin + chunk]
            first = probabilities[positions] @ self.model.transition            # (R, K) the next bar's regime
            cumulative = np.cumsum(first, axis=1)
            cumulative[:, -1] = 1.0
            regime = (self.uniforms[None, :, 0, None] > cumulative[:, None, :]).sum(axis=2)
            regime = np.minimum(regime, regime_count - 1)
            log_returns = np.empty((positions.size, self.simulation_count, horizon), dtype=np.float64)
            log_returns[:, :, 0] = self.location[regime] + self.scale[regime] * self.standard_draws[regime, paths[None, :], 0]
            for step in range(1, horizon):
                regime = (self.uniforms[None, :, step, None] > self.cumulative_transition[regime]).sum(axis=2)
                regime = np.minimum(regime, regime_count - 1)
                log_returns[:, :, step] = (self.location[regime]
                                           + self.scale[regime] * self.standard_draws[regime, paths[None, :], step])
            cumulative_returns = np.cumsum(log_returns, axis=2)
            moves = close[positions, None, None] * np.expm1(cumulative_returns)
            result["probability_up"][positions] = np.mean(cumulative_returns[:, :, -1] > 0.0, axis=1)
            quantiles = np.quantile(moves, (0.1, 0.5, 0.9), axis=1)          # (3, R, horizon)
            result["percentile_10_points"][positions] = quantiles[0]
            result["percentile_50_points"][positions] = quantiles[1]
            result["percentile_90_points"][positions] = quantiles[2]
        return result


# ─── Kronos ────────────────────────────────────────────────────────────────


def kronos_root() -> Path:
    """Where the Kronos source lives: ``KRONOS_ROOT`` when set, else ``Kronos/`` at the
    repository root; a git worktree of the repository reads its main checkout's ``Kronos/``."""
    configured = os.environ.get("KRONOS_ROOT")
    candidates = [Path(configured)] if configured else []
    repository = PACKAGES_ROOT.parent
    candidates.append(repository / "Kronos")
    git_file = repository / ".git"
    if git_file.is_file():
        text = git_file.read_text(encoding="utf-8").strip()
        if text.startswith("gitdir:"):
            # <main>/.git/worktrees/<name> -> <main>
            candidates.append(Path(text.split(":", 1)[1].strip()).resolve().parents[2] / "Kronos")
    for candidate in candidates:
        if (candidate / "model" / "kronos.py").is_file():
            return candidate
    raise RuntimeError(
        "Kronos is not on disk: expected Kronos/model/kronos.py at the repository root (or set KRONOS_ROOT); "
        f"looked in {', '.join(str(c) for c in candidates)}"
    )


def _import_kronos():
    """The Kronos package (its top-level name is ``model``), imported once from ``kronos_root()``."""
    root = kronos_root()
    existing = sys.modules.get("model")
    if existing is not None:
        where = Path(getattr(existing, "__file__", "") or "").resolve().parent
        if where != (root / "model").resolve():
            raise RuntimeError(f"a different package named 'model' is already imported ({where}); Kronos needs that name")
        return existing
    sys.path.insert(0, str(root))
    try:
        return importlib.import_module("model")
    finally:
        try:
            sys.path.remove(str(root))
        except ValueError:
            pass


def load_kronos(size: str, device: str):
    """(tokenizer, model, maximum context, inference function), loaded once per (size, device)."""
    if size not in KRONOS_MODELS:
        raise ValueError(f"kronos_model_size must be one of {sorted(KRONOS_MODELS)}, got {size!r}")
    with _KRONOS_LOCK:
        cached = _KRONOS_LOADED.get((size, device))
        if cached is not None:
            return cached
        package = _import_kronos()
        from model.kronos import (
            auto_regressive_inference,  # noqa: PLC0415 - Kronos' own module, imported above
        )

        repository, revision, tokenizer_repository, tokenizer_revision, maximum_context = KRONOS_MODELS[size]
        tokenizer = package.KronosTokenizer.from_pretrained(tokenizer_repository, revision=tokenizer_revision)
        model = package.Kronos.from_pretrained(repository, revision=revision)
        tokenizer = tokenizer.to(device).eval()
        model = model.to(device).eval()
        loaded = (tokenizer, model, int(maximum_context), auto_regressive_inference)
        _KRONOS_LOADED[(size, device)] = loaded
        return loaded


def time_features(timestamps: np.ndarray) -> np.ndarray:
    """(…, 5) float32: minute, hour, weekday (Monday 0), day of month, month — Kronos'
    ``calc_time_stamps`` on the bars' own stamps (epoch seconds)."""
    stamps = np.asarray(timestamps, dtype=np.int64)
    seconds = stamps.astype("datetime64[s]")
    days = seconds.astype("datetime64[D]")
    months = seconds.astype("datetime64[M]")
    minute = (stamps // 60) % 60
    hour = (stamps // 3600) % 24
    weekday = (days.astype(np.int64) + 3) % 7            # 1970-01-01 was a Thursday
    day = (days - months.astype("datetime64[D]")).astype(np.int64) + 1
    month = months.astype(np.int64) % 12 + 1
    return np.stack([minute, hour, weekday, day, month], axis=-1).astype(np.float32)


class KronosForecaster:
    """The next ``horizon`` candles from Kronos for chosen bars of a market view (see the module docstring)."""

    def __init__(self, size: str, context_bars: int, horizon: int, device: str) -> None:
        self.size = size
        self.horizon = int(horizon)
        self.device = device
        self.maximum_context = KRONOS_MODELS[size][4]
        self.context_bars = min(int(context_bars), self.maximum_context)

    def forecast(self, view, rows: np.ndarray) -> np.ndarray:
        """(rows, horizon, 4) predicted open, high, low, close; NaN for a bar with fewer than
        ``context_bars`` bars of history or a missing price in its window."""
        if view.open is None or view.high is None or view.low is None or view.volume is None:
            raise RuntimeError(
                "Kronos reads each bar's open, high, low and volume, and this market view does not carry them "
                "(the explainer's saved arrays hold only closes) — this model is explained by its run, not reloaded"
            )
        rows = np.asarray(rows, dtype=np.int64).reshape(-1)
        out = np.full((rows.size, self.horizon, 4), np.nan, dtype=np.float64)
        length = self.context_bars
        timestamps = np.asarray(view.timestamps, dtype=np.int64)
        pending: list[tuple[int, int, tuple]] = []
        for position, row in enumerate(rows):
            first = int(row) - length + 1
            if first < 0:
                continue
            key = (self.size, length, self.horizon, int(timestamps[row]), int(timestamps[first]), float(view.close[row]))
            cached = _KRONOS_FORECASTS.get(key)
            if cached is not None:
                out[position] = cached
            else:
                pending.append((position, int(row), key))
        if not pending:
            return out
        tokenizer, model, maximum_context, inference = load_kronos(self.size, self.device)
        import torch

        prices = np.column_stack([view.open, view.high, view.low, view.close]).astype(np.float64)
        volume = np.asarray(view.volume, dtype=np.float64)
        offsets = np.arange(length)
        steps = np.arange(1, self.horizon + 1)
        for begin in range(0, len(pending), KRONOS_BATCH_ROWS):
            batch = pending[begin:begin + KRONOS_BATCH_ROWS]
            ends = np.array([row for _, row, _ in batch], dtype=np.int64)
            window = ends[:, None] - length + 1 + offsets[None, :]                # (B, L)
            window_prices = prices[window]                                        # (B, L, 4)
            window_volume = volume[window]
            usable = np.all(np.isfinite(window_prices), axis=(1, 2)) & np.all(np.isfinite(window_volume), axis=1)
            if not usable.any():
                continue
            window_prices, window_volume, window = window_prices[usable], window_volume[usable], window[usable]
            amount = window_volume * window_prices.mean(axis=2)
            inputs = np.concatenate([window_prices, window_volume[..., None], amount[..., None]], axis=2)
            mean = inputs.mean(axis=1, keepdims=True)
            deviation = inputs.std(axis=1, keepdims=True)
            normalised = np.clip((inputs - mean) / (deviation + 1e-5), -KRONOS_CLIP, KRONOS_CLIP).astype(np.float32)
            window_stamps = timestamps[window]
            intervals = np.median(np.diff(window_stamps, axis=1), axis=1).astype(np.int64)
            intervals[intervals <= 0] = 1
            future = window_stamps[:, -1:] + intervals[:, None] * steps[None, :]
            with torch.no_grad():
                predicted = inference(
                    tokenizer, model,
                    torch.from_numpy(normalised).to(self.device),
                    torch.from_numpy(time_features(window_stamps)).to(self.device),
                    torch.from_numpy(time_features(future)).to(self.device),
                    maximum_context, self.horizon, KRONOS_CLIP, 1.0, 1, 1.0, 1,
                )
            predicted = np.asarray(predicted, dtype=np.float64)[:, -self.horizon:, :]
            predicted = predicted * (deviation + 1e-5) + mean
            candles = predicted[:, :, :4]
            kept = [entry for entry, keep in zip(batch, usable) if keep]
            for (position, _, key), candle in zip(kept, candles):
                _KRONOS_FORECASTS[key] = candle
                out[position] = candle
        return out


# ─── the adapter ───────────────────────────────────────────────────────────


def _as_index(index) -> np.ndarray:
    return np.asarray(index, dtype=np.int64).reshape(-1)


def _finite_or_none(value) -> float | None:
    if value is None:
        return None
    value = float(value)
    return value if math.isfinite(value) else None


def trade_moves(view, rows: np.ndarray, horizon: int) -> np.ndarray:
    """The move the engine trades for a call made at the close of each row, in points:
    open[row + horizon + 1] − open[row + 1] (filled at the next open, closed at the open after
    ``horizon`` held bars). NaN where those bars are not in the view or a session gap lies
    between the row and its exit bar."""
    rows = _as_index(rows)
    moves = np.full(rows.size, np.nan)
    if rows.size == 0 or view.open is None:
        return moves
    opens = np.asarray(view.open, dtype=np.float64)
    usable = (rows >= 0) & (rows + horizon + 1 < opens.size)
    inside = rows[usable]
    crosses = (np.asarray(view.crosses_gap, dtype=bool)[inside]
               | np.asarray(view.one_bar_crosses_gap, dtype=bool)[inside + horizon])
    usable[np.nonzero(usable)[0][crosses]] = False
    inside = rows[usable]
    moves[usable] = opens[inside + horizon + 1] - opens[inside + 1]
    return moves


def realisation_slope(claimed: np.ndarray, realised: np.ndarray, rows: np.ndarray, lags: int) -> tuple[float, float, int]:
    """How much of the gain a model claimed showed up: (slope, standard error, row count).

    slope = Σ(claimed × realised) ÷ Σ(claimed²), a regression of the realised gain on the
    claimed gain through the origin: 1 for a calibrated model, 0 for one whose calls earn
    nothing, negative for one that loses. The standard error is Newey–West with Bartlett
    weights over ``lags`` lags of the score claimed × residual, summed only over pairs of rows
    exactly that many bars apart (the outcomes of rows within ``lags`` bars of each other
    overlap), and never smaller than the one that ignores the overlap. Non-finite pairs are
    left out; (NaN, NaN, n) when nothing was claimed."""
    x = np.asarray(claimed, dtype=np.float64)
    y = np.asarray(realised, dtype=np.float64)
    index = _as_index(rows)
    keep = np.isfinite(x) & np.isfinite(y)
    x, y, index = x[keep], y[keep], index[keep]
    order = np.argsort(index, kind="stable")
    x, y, index = x[order], y[order], index[order]
    total = float(np.dot(x, x))
    if x.size == 0 or total <= 0.0:
        return float("nan"), float("nan"), int(x.size)
    slope = float(np.dot(x, y)) / total
    scores = x * (y - slope * x)
    uncorrelated = float(np.dot(scores, scores))
    variance = uncorrelated
    for lag in range(1, int(lags) + 1):
        if lag >= scores.size:
            break
        adjacent = (index[lag:] - index[:-lag]) == lag
        weight = 1.0 - lag / (int(lags) + 1.0)
        variance += 2.0 * weight * float(np.dot(scores[lag:][adjacent], scores[:-lag][adjacent]))
    return slope, math.sqrt(max(variance, uncorrelated)) / total, int(x.size)


def purged_blocks(rows: np.ndarray, block_count: int, purge: int) -> list[tuple[np.ndarray, int, int]]:
    """Cut sorted ``rows`` into ``block_count`` contiguous blocks; for each, (the block's rows,
    the first and last row number the regime fit must leave out: the block widened by
    ``purge`` bars on both sides)."""
    rows = _as_index(rows)
    blocks = []
    for part in np.array_split(rows, max(1, int(block_count))):
        if part.size == 0:
            continue
        blocks.append((part, int(part[0]) - int(purge), int(part[-1]) + int(purge)))
    return blocks


class RegimeMonteCarloDecisionAdapter:
    """See the module docstring."""

    available = True
    # The gate opens only on out-of-fold evidence, so most search trials take no trade. A Sharpe
    # search scores those 0.0 and picks whichever trial traded by luck; log loss ranks every trial
    # on the same footing. The engine reads this and scores the model's search on it.
    required_tuning_objective = "log_loss"

    def __init__(self, key: str, entry: dict, parameters: dict, device: str, seed: int,
                 task: str = "classification") -> None:
        if task not in MODEL_TASKS:
            raise ValueError(f"unknown task {task!r}; valid tasks: {', '.join(MODEL_TASKS)}")
        if entry["adapter"] != ADAPTER:
            raise ValueError(f"{key}: its registry adapter is {entry['adapter']!r}, not {ADAPTER!r}")
        self.key = key
        self.family = key
        self.entry = entry
        self.task = task
        self.parameters = dict(parameters)
        self.seed = int(seed)
        self.requested_device = device
        self.device = "cpu"
        self.step_unit = entry["stepUnit"]
        self.label = entry["displayName"]
        self.market = None
        # fitted state
        self.regime_model: RegimeModel | None = None
        self.simulator: MonteCarloSimulator | None = None
        self.booster = None
        self.best_iteration: int | None = None
        self.signal_names: list[str] = []
        self.finbert_names: list[str] = []
        self.feature_count: int | None = None
        self.filter_start: int | None = None
        self.feature_weights: dict[str, float] = {}
        # the trade gate's evidence, measured at fit on purged out-of-fold rows (see the module docstring)
        self.gate_certified: bool = False
        self.gate_realisation_slope: float | None = None
        self.gate_realisation_standard_error: float | None = None
        self.gate_evidence_row_count: int = 0
        self.gate_move_ratio: float | None = None
        self.fit_summary: dict = {}
        self._inputs: np.ndarray | None = None
        self._filter_state = None
        self._filtered: dict[int, np.ndarray] = {}
        self._row_details: dict[int, dict] = {}

    # ── the market view ──────────────────────────────────────────────────
    def bind_market(self, view) -> None:
        self.market = view
        self._inputs = None
        self._filter_state = None
        self._filtered = {}
        self._row_details = {}

    def _require_market(self):
        if self.market is None:
            raise RuntimeError(
                f"{self.key}: needs the run's market view (candles and volume); the engine binds it "
                "through bind_market(view) when it builds the model — a direct caller must bind it too"
            )
        if self.market.volume is None:
            raise RuntimeError(
                f"{self.label}: its regime model reads each bar's open, high and low and Kronos reads whole candles "
                "and volume, and this market view carries none of them (the explainer's saved arrays hold only "
                "closes); this model is "
                "explained by its run's own regime forecasts, not by a reload"
            )
        return self.market

    @property
    def horizon(self) -> int:
        return int(self._require_market().horizon)

    def _kronos_device(self) -> str:
        import torch

        return "cuda" if self.requested_device != "cpu" and torch.cuda.is_available() else "cpu"

    def _regime_inputs(self) -> np.ndarray:
        if self._inputs is None:
            view = self._require_market()
            self._inputs = regime_features(view, int(self.parameters["swing_confirmation_bars"]))
        return self._inputs

    # ── contract ─────────────────────────────────────────────────────────
    def minimum_history(self) -> int:
        return 1

    def fit(self, features, labels, train_index, validation_index, timestamps, reporter) -> None:
        train_index = _as_index(train_index)
        validation_index = _as_index(validation_index)
        if train_index.size == 0:
            raise ValueError(f"{self.key}: the training index is empty")
        view = self._require_market()
        reporter.step_unit = self.step_unit
        self.feature_count = int(features.shape[1])
        self._filtered = {}
        self._filter_state = None
        self._row_details = {}
        watch = Stopwatch()
        inputs = self._regime_inputs()
        returns = view.one_bar_returns()
        fit_rows = view.fit_rows(train_index)
        self.filter_start = max(0, int(train_index[0]) - REGIME_FILTER_BURN_IN_BARS)
        threshold = float(self.parameters["adx_threshold"])
        iterations = int(self.parameters["regime_fit_iteration_count"])
        reporter.log(
            f"{self.label} ({'direction' if self.task == 'classification' else 'price'} model): regime model = structural "
            f"hidden Markov model, three regimes ({', '.join(REGIME_NAMES)}), diagonal Gaussian over ADX 14, body-to-range, "
            f"range compression, {int(self.parameters['swing_confirmation_bars'])}-bar confirmed swing distances, bars since "
            f"the last pivot, the higher-high / higher-low score and the last two pivots' sign; Baum-Welch seeded at "
            f"ADX < {threshold:g} = flat, up to {iterations} iterations, on the {fit_rows.size:,} bars of the training span"
        )
        self.regime_model = run_single_fit(
            lambda: fit_regime_model(inputs, returns, fit_rows, threshold, iterations, self.seed), reporter,
            name=f"{self.key} regime model")
        self.simulator = MonteCarloSimulator(self.regime_model, int(self.parameters["simulation_count"]), self.horizon, self.seed)
        hmm = self.regime_model.hmm
        reporter.log(
            f"{self.label}: Baum-Welch ran {hmm.iterations_run} iterations ({'converged' if hmm.converged else 'stopped at the limit'}); "
            f"heuristic seed labels flat {int(hmm.seed_label_counts[0]):,}, uptrend {int(hmm.seed_label_counts[1]):,}, "
            f"downtrend {int(hmm.seed_label_counts[2]):,} bars"
        )
        for summary in self.regime_model.summaries():
            volatility = summary["volatilityLogReturn"]
            means = {item["name"]: item["value"] for item in summary["featureMeans"]}
            expected = summary["expectedBarsPerVisit"]
            reporter.log(
                f"{self.label}: {summary['name']}: {summary['trainingBarCount']:,} training bars, mean ADX "
                f"{means['average_directional_index']:.1f}, higher-high / higher-low score {means['higher_high_higher_low_score']:+.2f}, "
                f"stays with probability {summary['stayProbability']:.3f} (about "
                f"{('n/a' if expected is None else f'{expected:.0f}')} bars a visit); one-bar log return mean "
                f"{summary['meanLogReturn']:+.2e}, deviation {('n/a' if volatility is None else f'{volatility:.2e}')}, "
                f"Student-t degrees of freedom {summary['degreesOfFreedom']:.1f}"
                + (" (too few bars: pooled training returns)" if summary["pooled"] else "")
            )
        if self.task == "regression":
            self._fit_price_model(labels, train_index, validation_index, timestamps, reporter, watch)
            return
        _require_both_classes(self.key, labels[train_index])
        self._fit_decision_model(features, labels, train_index, validation_index, timestamps, reporter, watch)

    def _filtered_probabilities(self, rows: np.ndarray, model: RegimeModel | None = None) -> np.ndarray:
        """Filtered regime probabilities at ``rows`` (sorted or not). The fold's own model keeps
        one running pass (extended forward only as far as the largest row asked for); an
        out-of-fold model gets its own pass from the filter start."""
        rows = _as_index(rows)
        inputs = self._regime_inputs()
        if model is not None and model is not self.regime_model:
            if rows.size == 0:
                return np.empty((0, model.regime_count))
            filtered, _ = model.forward_filter(inputs, self.filter_start, int(rows.max()))
            return filtered[rows - self.filter_start]
        model = self.regime_model
        out = np.full((rows.size, model.regime_count), np.nan)
        if rows.size == 0:
            return out
        target = int(rows.max())
        last = self._filter_state[0] if self._filter_state is not None else self.filter_start - 1
        if target > last:
            filtered, self._filter_state = model.forward_filter(inputs, self.filter_start, target, self._filter_state)
            for offset, values in enumerate(filtered):
                self._filtered[last + 1 + offset] = values
        for position, row in enumerate(rows):
            if int(row) < self.filter_start:
                continue
            values = self._filtered.get(int(row))
            if values is not None:
                out[position] = values
        return out

    def _signals(self, features, rows: np.ndarray, model: RegimeModel, simulator: MonteCarloSimulator,
                 kronos_candles: np.ndarray) -> tuple[np.ndarray, dict]:
        """The decision model's input rows for ``rows`` and the pieces they came from."""
        view = self._require_market()
        close = np.asarray(view.close, dtype=np.float64)[rows]
        scale = np.asarray(view.move_scale, dtype=np.float64)[rows]
        with np.errstate(divide="ignore", invalid="ignore"):
            scale = np.where(scale > 0, scale, np.nan)
        probabilities = self._filtered_probabilities(rows, model)
        simulated = simulator.simulate(probabilities, close)
        kronos_move = kronos_candles[:, -1, 3] - close
        spread = simulated["percentile_90_points"][:, -1] - simulated["percentile_10_points"][:, -1]
        columns = [probabilities,
                   simulated["probability_up"][:, None],
                   (simulated["expected_move_points"] / scale)[:, None],
                   (spread / scale)[:, None],
                   (kronos_move / scale)[:, None],
                   np.sign(kronos_move)[:, None]]
        if TRAILING_MOVE_SIGNAL in self.signal_names:
            closes = np.asarray(view.close, dtype=np.float64)
            earlier = np.asarray(rows, dtype=np.int64) - self.horizon
            trailing = np.where(earlier >= 0, close - closes[np.maximum(earlier, 0)], np.nan)
            columns.append((trailing / scale)[:, None])
        if self.finbert_names:
            names = list(view.feature_names)
            columns.append(np.asarray(features[rows][:, [names.index(n) for n in self.finbert_names]], dtype=np.float64))
        matrix = np.concatenate(columns, axis=1)
        return matrix, {"probabilities": probabilities, "simulated": simulated, "kronos_move": kronos_move,
                        "kronos_candles": kronos_candles, "close": close}

    def _signal_names(self, regime_count: int) -> list[str]:
        return ([f"{name}_regime_probability" for name in REGIME_NAMES[:regime_count]]
                + ["monte_carlo_probability_up", "monte_carlo_expected_move_scaled",
                   "monte_carlo_percentile_spread_scaled", "kronos_predicted_move_scaled", "kronos_predicted_direction",
                   TRAILING_MOVE_SIGNAL]
                + list(self.finbert_names))

    def _kronos(self) -> KronosForecaster:
        return KronosForecaster(str(self.parameters["kronos_model_size"]), int(self.parameters["kronos_context_bars"]),
                                self.horizon, self._kronos_device())

    def _fit_decision_model(self, features, labels, train_index, validation_index, timestamps, reporter, watch) -> None:
        import xgboost as xgb

        view = self._require_market()
        horizon = self.horizon
        regime_count = len(REGIME_NAMES)
        self.finbert_names = [name for name in view.feature_names if name.startswith(FINBERT_PREFIX)]
        if not self.finbert_names:
            reporter.log(f"{self.label}: this run's features carry no finbert_* columns; the decision model reads no news", "warn")
        self.signal_names = self._signal_names(regime_count)
        stacking_rows = train_index[-int(self.parameters["maximum_training_bars"]):]
        kronos = self._kronos()
        reporter.log(
            f"{self.label}: Kronos-{kronos.size} on {kronos.device} reads the last {kronos.context_bars} candles of each bar "
            f"and decodes the next {horizon}; forecasting {stacking_rows.size:,} stacking rows and {validation_index.size:,} "
            "validation rows"
        )
        kronos_started = time.perf_counter()
        kronos_stacking, kronos_validation = run_single_fit(
            lambda: (kronos.forecast(view, stacking_rows), kronos.forecast(view, validation_index)), reporter,
            name=f"{self.key} Kronos")
        reporter.log(f"{self.label}: Kronos forecasts in {time.perf_counter() - kronos_started:.1f} s "
                     f"({len(_KRONOS_FORECASTS):,} bars cached in this process)")

        # out-of-fold regime and Monte Carlo signals for the stacking rows
        inputs = self._regime_inputs()
        returns = view.one_bar_returns()
        fit_rows = view.fit_rows(train_index)
        blocks = purged_blocks(stacking_rows, int(self.parameters["stacking_fold_count"]), horizon)
        stacking_signals = np.full((stacking_rows.size, len(self.signal_names)), np.nan)
        position = 0

        def out_of_fold():
            matrices = []
            for block_rows, low, high in blocks:
                kept = fit_rows[(fit_rows < low) | (fit_rows > high)]
                model = fit_regime_model(inputs, returns, kept, float(self.parameters["adx_threshold"]),
                                         int(self.parameters["regime_fit_iteration_count"]), self.seed)
                simulator = MonteCarloSimulator(model, int(self.parameters["simulation_count"]), horizon, self.seed)
                offset = int(np.searchsorted(stacking_rows, block_rows[0]))
                matrix, _ = self._signals(features, block_rows, model, simulator,
                                          kronos_stacking[offset:offset + block_rows.size])
                matrices.append(matrix)
            return matrices

        reporter.log(
            f"{self.label}: out-of-fold regime and Monte Carlo signals for the {stacking_rows.size:,} most recent training rows "
            f"in {len(blocks)} blocks, each scored by a regime model fitted without it and {horizon} bars either side "
            f"({int(self.parameters['simulation_count']):,} paths of {horizon} bars per bar)"
        )
        for matrix in run_single_fit(out_of_fold, reporter, name=f"{self.key} stacking"):
            stacking_signals[position:position + matrix.shape[0]] = matrix
            position += matrix.shape[0]
        validation_signals, _ = self._signals(features, validation_index, self.regime_model, self.simulator, kronos_validation)
        stacking_labels = np.asarray(labels[stacking_rows] >= 0.5, dtype=np.float32)
        validation_labels = np.asarray(labels[validation_index] >= 0.5, dtype=np.float32)

        # the decision model
        rounds_total = int(self.parameters["boosting_rounds"])
        training_parameters = {
            "objective": "binary:logistic", "eval_metric": "logloss", "tree_method": "hist", "device": "cpu",
            "max_depth": int(self.parameters["max_depth"]), "eta": float(self.parameters["learning_rate"]),
            "subsample": 0.8, "colsample_bytree": 0.8, "min_child_weight": 5.0, "lambda": 1.0,
            # pinned: left free it is the stacking rows' share of label 1, and with few kept rounds
            # that share, not the trees, decides every bar's call (see the module docstring)
            "base_score": 0.5,
            "seed": self.seed,
        }
        train_matrix = xgb.DMatrix(stacking_signals, label=stacking_labels, feature_names=self.signal_names, missing=np.nan)
        evaluations = [(train_matrix, "train")]
        validation_matrix = None
        if validation_index.size:
            validation_matrix = xgb.DMatrix(validation_signals, label=validation_labels, feature_names=self.signal_names,
                                            missing=np.nan)
            evaluations.append((validation_matrix, "validation"))
        adapter = self
        span = (int(stacking_rows[0]), int(stacking_rows[-1]))

        def score_validation(round_number: int) -> np.ndarray:
            return adapter._callback_booster.predict(validation_matrix, iteration_range=(0, round_number))

        rounds = _RoundReporter(reporter, rounds_total, span, stacking_rows.size, validation_labels, score_validation,
                                binary_scores)

        class ReportingCallback(xgb.callback.TrainingCallback):
            def before_iteration(self, model, epoch, evals_log):
                adapter._callback_booster = model
                rounds.before_round(epoch + 1)
                return False

            def after_iteration(self, model, epoch, evals_log):
                train_loss = _last(evals_log.get("train", {}).get("logloss"))
                validation_loss = _last(evals_log.get("validation", {}).get("logloss"))
                rounds.after_round(epoch + 1, train_loss, validation_loss)
                return False

        early = EARLY_STOPPING_ROUNDS if validation_index.size else None
        reporter.log(
            f"{self.label}: decision model = gradient-boosted trees over {len(self.signal_names)} signals "
            f"({', '.join(self.signal_names)}), up to {rounds_total} rounds, early stopping after {EARLY_STOPPING_ROUNDS} "
            "flat validation rounds"
        )
        self._callback_booster = None
        booster = xgb.train(training_parameters, train_matrix, num_boost_round=rounds_total, evals=evaluations,
                            early_stopping_rounds=early, callbacks=[ReportingCallback()], verbose_eval=False)
        self._callback_booster = booster
        trained = booster.num_boosted_rounds()
        rounds.report_epoch(trained, stopped_early=trained < rounds_total)
        self._callback_booster = None
        self.best_iteration = trained - 1
        if early:
            try:
                self.best_iteration = int(booster.best_iteration)
            except AttributeError:
                pass
        booster.set_param({"nthread": 1})
        self.booster = booster
        gains = booster.get_score(importance_type="total_gain")
        total = sum(gains.values()) or 1.0
        self.feature_weights = {name: float(gains.get(name, 0.0)) / total for name in self.signal_names}
        ranked = sorted(self.feature_weights.items(), key=lambda item: -item[1])
        reporter.log(f"{self.label}: decision model weights (share of total gain): "
                     + ", ".join(f"{name} {share:.3f}" for name, share in ranked[:8]))
        # the trade gate: certify the fold on purged out-of-fold rows, then a cost floor (module docstring)
        kept_rounds = self.best_iteration + 1
        gate_purge = horizon + 1          # the traded move ends one bar after the label's horizon

        def out_of_fold_probabilities() -> np.ndarray:
            scored = np.full(stacking_rows.size, np.nan)
            for block_rows, _, _ in blocks:
                inside = (stacking_rows >= block_rows[0]) & (stacking_rows <= block_rows[-1])
                outside = (stacking_rows < int(block_rows[0]) - gate_purge) | (stacking_rows > int(block_rows[-1]) + gate_purge)
                if not inside.any() or np.unique(stacking_labels[outside]).size < 2:
                    continue
                part = xgb.DMatrix(stacking_signals[outside], label=stacking_labels[outside],
                                   feature_names=self.signal_names, missing=np.nan)
                block_model = xgb.train(training_parameters, part, num_boost_round=kept_rounds, verbose_eval=False)
                scored[inside] = block_model.predict(xgb.DMatrix(stacking_signals[inside], feature_names=self.signal_names,
                                                                 missing=np.nan))
            return scored

        out_of_fold = run_single_fit(out_of_fold_probabilities, reporter, name=f"{self.key} gate")
        scale = np.asarray(view.move_scale, dtype=np.float64)
        close = np.asarray(view.close, dtype=np.float64)
        last_filled = int(train_index[-1]) - 1          # a trade from this row is closed by train_index[-1] + horizon
        span_rows = fit_rows[fit_rows <= last_filled]
        span_moves = np.abs(trade_moves(view, span_rows, horizon))
        span_scale = scale[span_rows]
        measured = np.isfinite(span_moves) & np.isfinite(span_scale) & (span_scale > 0)
        self.gate_move_ratio = (float(span_moves[measured].mean() / span_scale[measured].mean())
                                if measured.any() and span_scale[measured].mean() > 0 else None)

        evidence = np.isfinite(out_of_fold) & (stacking_rows <= last_filled)
        evidence_rows = stacking_rows[evidence]
        probability = out_of_fold[evidence]
        close_move = close[np.minimum(evidence_rows + horizon, close.size - 1)] - close[evidence_rows]
        # the price direction label 1 stands for at each row: +1 where a 1 was an up move, -1 where it was a down move
        label_direction = (2.0 * stacking_labels[evidence] - 1.0) * np.sign(close_move)
        called = np.where(probability >= 0.5, 1.0, -1.0)
        realised = called * label_direction * trade_moves(view, evidence_rows, horizon)
        realised[label_direction == 0] = np.nan
        claimed = (2.0 * np.abs(probability - 0.5) * self.gate_move_ratio * scale[evidence_rows]
                   if self.gate_move_ratio is not None else np.full(evidence_rows.size, np.nan))
        slope, standard_error, evidence_count = realisation_slope(claimed, realised, evidence_rows, horizon)
        self.gate_realisation_slope = slope if math.isfinite(slope) else None
        self.gate_realisation_standard_error = standard_error if math.isfinite(standard_error) else None
        self.gate_evidence_row_count = evidence_count
        lower_bound = (slope - CERTIFICATE_QUANTILE * standard_error
                       if self.gate_realisation_slope is not None and self.gate_realisation_standard_error is not None else None)
        self.gate_certified = bool(lower_bound is not None and lower_bound > 0.0 and evidence_count >= MINIMUM_EVIDENCE_ROWS)
        cost_points = float(view.round_trip_cost_points)
        used = np.isfinite(claimed) & np.isfinite(realised)
        mean_claimed = float(claimed[used].mean()) if used.any() else None
        mean_realised = float(realised[used].mean()) if used.any() else None
        validation_open_share = None
        if validation_index.size:
            validation_probability = self._booster_probability(validation_signals)
            validation_open_share = float(np.mean(self._gate_open(validation_probability, validation_index)))
        if self.gate_realisation_slope is None:
            verdict = ("not certified: the out-of-fold rows carry no claimed gain to measure"
                       if evidence_count else "not certified: no purged out-of-fold row could be measured")
        else:
            verdict = (
                f"the model claimed {mean_claimed:.1f} points a call and {mean_realised:.1f} arrived; {slope * 100:.0f}% of the "
                f"claimed gain arrived (standard error {standard_error * 100:.0f}%, Newey-West over {horizon} lags), one-sided 95% "
                f"lower bound {lower_bound * 100:.0f}%, which has to be above 0%: "
                + ("CERTIFIED, the gate opens where slope x claimed gain exceeds the cost" if self.gate_certified
                   else ("not certified, too few rows" if lower_bound > 0.0 else "not certified, the bound is not above zero")
                   + ": the model stands aside on every bar of this fold")
            )
        reporter.log(
            f"{self.label}: trade gate = certified cost floor. Round trip {cost_points:.2f} points; the traded {horizon}-bar move "
            f"is {('n/a' if self.gate_move_ratio is None else f'{self.gate_move_ratio * 100:.0f}%')} of the move scale; "
            f"{evidence_count:,} purged out-of-fold training rows ({len(blocks)} blocks, {gate_purge} bars purged either side, "
            f"{kept_rounds} rounds each): {verdict}"
            + ("" if validation_open_share is None else f"; open on {validation_open_share * 100:.1f}% of the validation bars")
        )
        self.fit_summary = {
            **_training_summary(train_index, validation_index, timestamps),
            "stacking_row_count": int(stacking_rows.size),
            "stacking_blocks": [{"first_row": int(b[0][0]), "last_row": int(b[0][-1]), "purge_bars": horizon} for b in blocks],
            "trained_rounds": trained,
            "best_round": self.best_iteration + 1,
            "best_validation_loss": None if math.isinf(rounds.best_loss) else rounds.best_loss,
            "feature_weights": self.feature_weights,
            "regimes": self.regime_model.summaries(),
            "regime_log_likelihood": self.regime_model.log_likelihood,
            "gate_certified": self.gate_certified,
            "gate_realisation_slope": self.gate_realisation_slope,
            "gate_realisation_standard_error": self.gate_realisation_standard_error,
            "gate_realisation_lower_bound": lower_bound,
            "gate_evidence_row_count": evidence_count,
            "gate_purge_bars": gate_purge,
            "gate_move_ratio": self.gate_move_ratio,
            "gate_mean_claimed_gain_points": mean_claimed,
            "gate_mean_realised_gain_points": mean_realised,
            "round_trip_cost_points": cost_points,
            "validation_gate_open_share": validation_open_share,
            "kronos_model": KRONOS_MODELS[kronos.size][0],
            "kronos_revision": KRONOS_MODELS[kronos.size][1],
            "fit_seconds": watch.seconds(),
        }

    def _fit_price_model(self, labels, train_index, validation_index, timestamps, reporter, watch) -> None:
        """The price model: the regime simulation's expected move over the move scale."""
        reporter.epoch_started(1, 1)
        train_prediction = self.predict_value(None, train_index[-int(self.parameters["maximum_training_bars"]):])
        train_rows = train_index[-int(self.parameters["maximum_training_bars"]):]
        train_scores = regression_scores(train_prediction, np.asarray(labels[train_rows], dtype=np.float64))
        reporter.batch(BatchReport(epoch=1, epoch_count=1, batch=1, batch_count=1,
                                   span_start_index=int(train_rows[0]), span_end_index=int(train_rows[-1]),
                                   train_loss=_finite_or_none(train_scores["mean_absolute_error"])))
        reporter.validating(1, 1)
        validation_scores = {"mean_absolute_error": None, "accuracy": None}
        if validation_index.size:
            validation_scores = regression_scores(self.predict_value(None, validation_index),
                                                  np.asarray(labels[validation_index], dtype=np.float64))
        reporter.epoch_finished(EpochReport(
            epoch=1, epoch_count=1, train_loss=_finite_or_none(train_scores["mean_absolute_error"]),
            validation_loss=_finite_or_none(validation_scores["mean_absolute_error"]),
            validation_accuracy=validation_scores["accuracy"], validation_f1_score=None, is_best=True,
        ))
        self.best_iteration = 0
        self.fit_summary = {
            **_training_summary(train_index, validation_index, timestamps),
            "regimes": self.regime_model.summaries(),
            "validation_mean_absolute_error": validation_scores["mean_absolute_error"],
            "fit_seconds": watch.seconds(),
        }

    def _booster_probability(self, signals: np.ndarray) -> np.ndarray:
        import xgboost as xgb

        matrix = xgb.DMatrix(signals, feature_names=self.signal_names, missing=np.nan)
        return np.clip(np.asarray(self.booster.predict(matrix, iteration_range=(0, self.best_iteration + 1)),
                                  dtype=np.float64), 0.0, 1.0)

    def _claimed_gain_points(self, probability: np.ndarray, rows: np.ndarray) -> np.ndarray:
        """What each call claims to earn, in points: 2 x |P - 0.5| x move ratio x the bar's move scale
        (NaN where the move ratio or the bar's scale is unknown)."""
        probability = np.asarray(probability, dtype=np.float64)
        if self.gate_move_ratio is None:
            return np.full(probability.size, np.nan)
        scale = np.asarray(self._require_market().move_scale, dtype=np.float64)[_as_index(rows)]
        scale = np.where(scale > 0, scale, np.nan)
        return 2.0 * np.abs(probability - 0.5) * float(self.gate_move_ratio) * scale

    def _expected_gain_points(self, probability: np.ndarray, rows: np.ndarray) -> np.ndarray:
        """The claimed gain times the fold's realisation slope (NaN where either is unknown)."""
        claimed = self._claimed_gain_points(probability, rows)
        if self.gate_realisation_slope is None:
            return np.full(claimed.size, np.nan)
        return float(self.gate_realisation_slope) * claimed

    def _gate_open(self, probability: np.ndarray, rows: np.ndarray) -> np.ndarray:
        """Open where the fold is certified and the expected gain exceeds one round trip."""
        expected = self._expected_gain_points(probability, rows)
        if not self.gate_certified:
            return np.zeros(expected.size, dtype=bool)
        with np.errstate(invalid="ignore"):
            return np.isfinite(expected) & (expected > float(self._require_market().round_trip_cost_points))

    def predict_probability(self, features, index) -> np.ndarray:
        if self.task != "classification":
            raise _wrong_task_error(self.key, self.task, "predict_probability")
        if self.booster is None or self.regime_model is None:
            raise RuntimeError(f"{self.key}: predict_probability called before fit")
        rows = _as_index(index)
        if rows.size == 0:
            return np.empty(0)
        if self.simulator is None:
            self.simulator = MonteCarloSimulator(self.regime_model, int(self.parameters["simulation_count"]), self.horizon, self.seed)
        candles = self._kronos().forecast(self._require_market(), rows)
        signals, pieces = self._signals(features, rows, self.regime_model, self.simulator, candles)
        probability = self._booster_probability(signals)
        claimed = self._claimed_gain_points(probability, rows)
        expected = self._expected_gain_points(probability, rows)
        opened = self._gate_open(probability, rows)
        for position, row in enumerate(rows):
            self._row_details[int(row)] = {
                "probabilities": pieces["probabilities"][position],
                "close": float(pieces["close"][position]),
                "probability_up": float(pieces["simulated"]["probability_up"][position]),
                "expected_move_points": float(pieces["simulated"]["expected_move_points"][position]),
                "percentile_10_points": pieces["simulated"]["percentile_10_points"][position],
                "percentile_50_points": pieces["simulated"]["percentile_50_points"][position],
                "percentile_90_points": pieces["simulated"]["percentile_90_points"][position],
                "kronos_candles": pieces["kronos_candles"][position],
                "kronos_move": float(pieces["kronos_move"][position]),
                "decision_probability_up": float(probability[position]),
                "claimed_gain_points": float(claimed[position]),
                "expected_gain_points": float(expected[position]),
                "gate_open": bool(opened[position]),
            }
        return probability

    def trade_gate(self, features, index) -> np.ndarray:
        """True where the fold is certified and the call's expected gain (realisation slope x claimed
        gain, in points) exceeds one round trip; False on every bar of a fold that is not certified."""
        rows = _as_index(index)
        missing = [int(row) for row in rows if int(row) not in self._row_details]
        if missing:
            self.predict_probability(features, np.asarray(missing, dtype=np.int64))
        return np.array([self._row_details[int(row)]["gate_open"] for row in rows], dtype=bool)

    def regime_forecast(self, row: int) -> dict | None:
        """What the four models said at a bar this adapter has scored (None for one it has not)."""
        return self._row_details.get(int(row))

    def regime_forecast_context(self) -> dict:
        """The fold's constants that travel with every ``cycle_regime_forecast`` stretch."""
        if self.regime_model is None:
            raise RuntimeError(f"{self.key}: regime_forecast_context called before fit")
        return {
            "horizon_bars": self.horizon,
            "simulation_count": int(self.parameters["simulation_count"]),
            "gate_certified": bool(self.gate_certified),
            "gate_realisation_slope": self.gate_realisation_slope,
            "gate_realisation_standard_error": self.gate_realisation_standard_error,
            "gate_evidence_row_count": int(self.gate_evidence_row_count),
            "gate_move_ratio": self.gate_move_ratio,
            "round_trip_cost_points": float(self._require_market().round_trip_cost_points),
            "kronos_model": KRONOS_MODELS[str(self.parameters["kronos_model_size"])][0],
            "regime_names": list(REGIME_NAMES),
            "regimes": self.regime_model.summaries(),
            "transition_matrix": self.regime_model.transition.tolist(),
            "feature_weights": self.feature_weight_list(),
        }

    def predict_value(self, features, index) -> np.ndarray:
        if self.task != "regression":
            raise _wrong_task_error(self.key, self.task, "predict_value")
        if self.regime_model is None:
            raise RuntimeError(f"{self.key}: predict_value called before fit")
        view = self._require_market()
        rows = _as_index(index)
        if self.simulator is None:
            self.simulator = MonteCarloSimulator(self.regime_model, int(self.parameters["simulation_count"]), self.horizon, self.seed)
        simulated = self.simulator.simulate(self._filtered_probabilities(rows), np.asarray(view.close, dtype=np.float64)[rows])
        scale = np.asarray(view.move_scale, dtype=np.float64)[rows]
        with np.errstate(divide="ignore", invalid="ignore"):
            return np.where(scale > 0, simulated["expected_move_points"] / scale, np.nan)

    def feature_weight_list(self) -> list[dict]:
        return [{"name": name, "gainShare": share} for name, share in
                sorted(self.feature_weights.items(), key=lambda item: -item[1])]

    # ── persistence ──────────────────────────────────────────────────────
    def save(self, directory: str) -> str:
        import xgboost as xgb

        if self.regime_model is None:
            raise RuntimeError(f"{self.key}: save called before fit")
        folder = Path(directory)
        folder.mkdir(parents=True, exist_ok=True)
        regime_path = folder / REGIME_MODEL_FILE
        temporary = folder / (REGIME_MODEL_FILE + ".tmp.npz")
        np.savez(temporary, **self.regime_model.arrays())
        os.replace(temporary, regime_path)
        model_file = regime_path.name
        if self.booster is not None:
            path = folder / DECISION_MODEL_FILE
            booster_temporary = folder / "decision_model.tmp.ubj"
            self.booster.save_model(str(booster_temporary))
            os.replace(booster_temporary, path)
            model_file = path.name
        metadata = _base_metadata(self, model_file, {"xgboost": xgb.__version__})
        metadata.update({
            "regime_model_file": REGIME_MODEL_FILE,
            "best_iteration": self.best_iteration,
            "gate_certified": self.gate_certified,
            "gate_realisation_slope": self.gate_realisation_slope,
            "gate_realisation_standard_error": self.gate_realisation_standard_error,
            "gate_evidence_row_count": self.gate_evidence_row_count,
            "gate_move_ratio": self.gate_move_ratio,
            "signal_names": list(self.signal_names),
            "finbert_names": list(self.finbert_names),
            "filter_start": self.filter_start,
            "feature_weights": self.feature_weights,
            "regimes": self.regime_model.summaries(),
            "kronos_model": KRONOS_MODELS[str(self.parameters["kronos_model_size"])][0],
            "kronos_revision": KRONOS_MODELS[str(self.parameters["kronos_model_size"])][1],
        })
        write_metadata(folder, metadata)
        return str(folder / model_file)

    @classmethod
    def load(cls, directory: str, metadata: dict) -> RegimeMonteCarloDecisionAdapter:
        import xgboost as xgb

        key = metadata["key"]
        adapter = cls(key, catalog.entry(key), metadata["parameters"], "cpu", metadata["seed"],
                      task=metadata.get("task", "classification"))
        with np.load(Path(directory) / metadata.get("regime_model_file", REGIME_MODEL_FILE)) as arrays:
            adapter.regime_model = RegimeModel.from_arrays({name: arrays[name] for name in arrays.files})
        if (Path(directory) / DECISION_MODEL_FILE).is_file():
            adapter.booster = xgb.Booster(model_file=str(Path(directory) / DECISION_MODEL_FILE))
            adapter.booster.set_param({"nthread": 1})
        adapter.best_iteration = metadata.get("best_iteration")
        # a model saved before 2026-10-08 carries a share gate's threshold and none of these: it reloads
        # with the gate shut, because its evidence was never measured
        adapter.gate_certified = bool(metadata.get("gate_certified", False))
        adapter.gate_realisation_slope = metadata.get("gate_realisation_slope")
        adapter.gate_realisation_standard_error = metadata.get("gate_realisation_standard_error")
        adapter.gate_evidence_row_count = int(metadata.get("gate_evidence_row_count") or 0)
        adapter.gate_move_ratio = metadata.get("gate_move_ratio")
        adapter.signal_names = list(metadata.get("signal_names") or [])
        adapter.finbert_names = list(metadata.get("finbert_names") or [])
        adapter.filter_start = metadata.get("filter_start")
        adapter.feature_count = metadata.get("feature_count")
        adapter.feature_weights = dict(metadata.get("feature_weights") or {})
        return adapter


def _last(values):
    if not values:
        return None
    value = float(values[-1])
    return value if math.isfinite(value) else None


__all__ = [
    "KRONOS_MODELS", "REGIME_NAMES", "KronosForecaster", "MonteCarloSimulator", "RegimeModel",
    "RegimeMonteCarloDecisionAdapter", "contiguous_lengths", "fit_regime_model", "purged_blocks", "realisation_slope", "regime_features", "trade_moves",
    "student_t_fit", "time_features",
]
