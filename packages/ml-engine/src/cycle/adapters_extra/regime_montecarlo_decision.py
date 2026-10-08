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
same scale) and direction, and the FinBERT columns. Its P(up) is the adapter's
direction probability. The regime and Monte Carlo signals of the training rows
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

**Trade gate** — ``trade_gate(features, index)`` is open when
``|P(up) − 0.5| >= decision_threshold``. The engine still scores every bar's
direction; it enters only where the gate is open, and a closed gate stands
aside (signal 0: no new entry, the held position runs to its holding period).

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
REGIME_FILTER_BURN_IN_BARS = 1000
MINIMUM_REGIME_RETURNS = 50
STUDENT_DEGREES_OF_FREEDOM_BOUNDS = (2.05, 200.0)
EARLY_STOPPING_ROUNDS = 30
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
                 pooled: np.ndarray) -> None:
        self.hmm = hmm
        self.student = np.asarray(student, dtype=np.float64)          # (3, 3): degrees of freedom, location, scale
        self.regime_bar_counts = np.asarray(regime_bar_counts, dtype=np.int64)
        self.pooled = np.asarray(pooled, dtype=bool)
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
                "pooled": self.pooled}

    @classmethod
    def from_arrays(cls, arrays) -> RegimeModel:
        return cls(StructuralRegimeHMM.from_arrays(arrays), arrays["student"], arrays["regime_bar_counts"],
                   arrays["pooled"])

    def summaries(self) -> list[dict]:
        """One plain record per regime in ``REGIME_NAMES`` order: the hidden Markov model's own
        summary (name, feature means in words, stay probability, expected bars per visit) and the
        regime's Student-t of the one-bar log return."""
        out = []
        for k, summary in enumerate(self.hmm.summaries()):
            degrees, location, scale = (float(v) for v in self.student[k])
            # a Student-t's standard deviation exists for degrees of freedom above 2
            deviation = scale * math.sqrt(degrees / (degrees - 2.0)) if degrees > 2.0 else None
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
    (``scipy.stats.t.fit``). When the free fit's degrees of freedom fall outside
    ``STUDENT_DEGREES_OF_FREEDOM_BOUNDS`` (5-minute returns with many zero ticks push
    it below 2, where the variance is infinite), the degrees of freedom are held at
    the nearer bound and location and scale are refitted by maximum likelihood with
    them fixed, so the three numbers always belong to one fitted distribution."""
    from scipy import stats

    values = np.asarray(values, dtype=np.float64)
    degrees, location, scale = stats.t.fit(values)
    low, high = STUDENT_DEGREES_OF_FREEDOM_BOUNDS
    if not (low <= degrees <= high) or not math.isfinite(degrees):
        held = low if not math.isfinite(degrees) or degrees < low else high
        degrees, location, scale = stats.t.fit(values, fdf=held)
    return float(degrees), float(location), float(scale)


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
    for k in range(len(REGIME_NAMES)):
        mine = fit_returns[assigned == k]
        counts[k] = mine.size
        if mine.size >= MINIMUM_REGIME_RETURNS and float(np.ptp(mine)) > 0:
            degrees, location, scale = student_t_fit(mine)
        else:
            degrees, location, scale = pooled_fit
            pooled[k] = True
        student[k] = (degrees, location, max(scale, 1e-12))
    return RegimeModel(hmm, student, counts, pooled)


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

    def simulate(self, probabilities: np.ndarray, close: np.ndarray) -> dict:
        """For each row: P(up), the expected move in points and the 10/50/90 percentile
        move paths in points (rows x horizon). Rows whose probabilities are unknown get NaN."""
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
            result["expected_move_points"][positions] = np.mean(moves[:, :, -1], axis=1)
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
        if self.finbert_names:
            names = list(view.feature_names)
            columns.append(np.asarray(features[rows][:, [names.index(n) for n in self.finbert_names]], dtype=np.float64))
        matrix = np.concatenate(columns, axis=1)
        return matrix, {"probabilities": probabilities, "simulated": simulated, "kronos_move": kronos_move,
                        "kronos_candles": kronos_candles, "close": close}

    def _signal_names(self, regime_count: int) -> list[str]:
        return ([f"{name}_regime_probability" for name in REGIME_NAMES[:regime_count]]
                + ["monte_carlo_probability_up", "monte_carlo_expected_move_scaled",
                   "monte_carlo_percentile_spread_scaled", "kronos_predicted_move_scaled", "kronos_predicted_direction"]
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
        validation_probability = (self._booster_probability(validation_signals) if validation_index.size
                                  else np.empty(0))
        gate = np.abs(validation_probability - 0.5) >= float(self.parameters["decision_threshold"])
        reporter.log(
            f"{self.label}: on the validation rows the trade gate (|P(up) - 0.5| >= {float(self.parameters['decision_threshold']):g}) "
            f"opens on {int(gate.sum()):,} of {gate.size:,} bars"
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
            "validation_gate_open_share": float(gate.mean()) if gate.size else None,
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
        threshold = float(self.parameters["decision_threshold"])
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
                "gate_open": bool(abs(probability[position] - 0.5) >= threshold),
            }
        return probability

    def trade_gate(self, features, index) -> np.ndarray:
        """True where the decision model is sure enough to trade: |P(up) − 0.5| >= decision_threshold."""
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
            "decision_threshold": float(self.parameters["decision_threshold"]),
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
    "RegimeMonteCarloDecisionAdapter", "contiguous_lengths", "fit_regime_model", "purged_blocks", "regime_features",
    "student_t_fit", "time_features",
]
