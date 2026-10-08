"""The structural regime hidden Markov model: ``StructuralRegimeHMM``.

Three hidden states, always named and ordered ``flat``, ``uptrend``,
``downtrend``. The model reads eight causal features per bar that combine a
flat-market detector, swing structure and trend confirmation, and its emission
in each state is a diagonal Gaussian over the standardised feature vector. The
full specification, with every formula, is ``docs/regime-hmm.md``.

Observation features (``FEATURE_NAMES``; every one reads only bars at or before
the bar it describes, and is NaN while its window is still filling):

- **Flat-market detector**
  - ``average_directional_index`` — Wilder's ADX over ``ADX_PERIOD_BARS`` (14)
    bars: +DM / −DM / true range smoothed by Wilder's running sum, DX = 100 ×
    |DI+ − DI−| / (DI+ + DI−), ADX = Wilder's average of DX. Low = no direction.
  - ``body_to_range_ratio`` — the mean over the last ``BODY_WINDOW_BARS`` (14)
    bars of |close − open| / (high − low) (0 for a bar with no range). Low =
    indecisive, overlapping candles.
  - ``volatility_compression_ratio`` — mean true range of the last
    ``SHORT_TRUE_RANGE_BARS`` (14) bars over the mean true range of the last
    ``LONG_TRUE_RANGE_BARS`` (100). Below 1 = the range is compressing.
- **Swing structure** — pivots from the dashboard's own definition,
  ``shared.zones.structural_pivots(high, low, swing_confirmation_bars)``: a swing
  high is a bar whose high is strictly above the N highs on each side (the
  mirror for a swing low), so a pivot at bar j is KNOWN only at bar j + N.
  - ``distance_from_swing_high_scaled`` — (close − the last confirmed swing high)
    / move scale.
  - ``distance_from_swing_low_scaled`` — (close − the last confirmed swing low)
    / move scale.
  - ``bars_since_last_pivot`` — bars from the newest confirmed pivot (high or
    low) to this bar.
- **Trend confirmation**
  - ``higher_high_higher_low_score`` — an exponentially decayed counter: at the
    bar a swing high is confirmed, +1 if it is above the previous swing high
    (higher high), −1 if below (lower high); at the bar a swing low is
    confirmed, +1 if above the previous swing low (higher low), −1 if below
    (lower low); every bar the counter is multiplied by 0.5^(1 /
    ``STRUCTURE_HALF_LIFE_BARS``). This is the signed trend feature the states
    are ordered by.
  - ``last_two_pivots_sign`` — (sign(last swing high − the one before) +
    sign(last swing low − the one before)) / 2: +1 = higher high and higher
    low, −1 = lower high and lower low, 0 = mixed.

Training: Baum-Welch (``hmmlearn.hmm.GaussianHMM``, ``covariance_type="diag"``)
on the training rows with every feature known, as their contiguous runs. The
standardisation (mean and deviation per feature) is fitted on those rows only.
Nothing is initialised at random (``init_params=""``): the means and variances
are seeded from a supervised heuristic labelling of the training rows — flat
where ADX < ``adx_threshold``, else uptrend where the higher-high / higher-low
score is above 0, downtrend where it is below 0 (flat at exactly 0) — the
transition matrix starts at 0.95 on the diagonal and 0.025 elsewhere, and a
Dirichlet prior adds ``STICKY_PRIOR_PSEUDO_COUNT`` pseudo-transitions to every
diagonal entry (a sticky prior). Expectation maximisation then refines every
parameter for up to ``iteration_count`` iterations, one iteration per hmmlearn
call so two guards hold after every M-step: every variance stays at or above
``COVARIANCE_FLOOR`` standardised units (without it a state collapses onto one
value of the discrete pivot-sign feature), and each state's mean carries a
Gaussian prior at its seed mean worth ``SEED_ANCHOR_SHARE`` × the training rows
in pseudo-observations (without it Baum-Welch on real MNQ bars re-purposes the
states as volatility regimes: measured 2026-10-07, a state named downtrend had a
mean score of −0.06). Afterwards the states are
ordered by the mean of the signed trend feature: the most negative is
``downtrend``, the most positive ``uptrend``, the one between ``flat``.

Inference: the FORWARD filter only, never the smoother:
``alpha_t = normalise((alpha_(t−1) · A) ⊙ b(x_t))`` with ``A`` the transition
matrix and ``b_k`` the diagonal Gaussian density of state k; a bar whose features
are not all known only advances ``alpha_(t−1) · A``. ``alpha_t`` therefore reads
bars up to t and no later; it equals hmmlearn's ``predict_proba`` of the
sequence that ends at t, at its last row (the smoother's last row is the filter).
"""

from __future__ import annotations

import logging
import math
import warnings

import numpy as np
from numba import njit

REGIME_NAMES = ("flat", "uptrend", "downtrend")
FEATURE_NAMES = (
    "average_directional_index",
    "body_to_range_ratio",
    "volatility_compression_ratio",
    "distance_from_swing_high_scaled",
    "distance_from_swing_low_scaled",
    "bars_since_last_pivot",
    "higher_high_higher_low_score",
    "last_two_pivots_sign",
)
FEATURE_WORDS = {
    "average_directional_index": "average directional index (ADX 14)",
    "body_to_range_ratio": "candle body as a share of its range (mean of 14 bars)",
    "volatility_compression_ratio": "true range of the last 14 bars over the last 100",
    "distance_from_swing_high_scaled": "close minus the last swing high, in move scales",
    "distance_from_swing_low_scaled": "close minus the last swing low, in move scales",
    "bars_since_last_pivot": "bars since the last confirmed swing pivot",
    "higher_high_higher_low_score": "higher-high / higher-low score (decayed count)",
    "last_two_pivots_sign": "sign of the last two swing highs and lows",
}
SIGNED_TREND_FEATURE = "higher_high_higher_low_score"
ADX_FEATURE = "average_directional_index"

ADX_PERIOD_BARS = 14
BODY_WINDOW_BARS = 14
SHORT_TRUE_RANGE_BARS = 14
LONG_TRUE_RANGE_BARS = 100
STRUCTURE_HALF_LIFE_BARS = 48
STICKY_DIAGONAL = 0.95
STICKY_PRIOR_PSEUDO_COUNT = 10.0
SEED_ANCHOR_SHARE = 1.0
COVARIANCE_FLOOR = 0.1
MINIMUM_SEED_ROWS = 20
MINIMUM_FIT_ROWS = 100
CONVERGENCE_TOLERANCE = 1e-2


# ─── causal features ───────────────────────────────────────────────────────


@njit(cache=True)
def _average_directional_index(high, low, close, period):
    """Wilder's ADX (module docstring); NaN until 2 × period − 1 bars have passed."""
    n = high.shape[0]
    out = np.full(n, np.nan)
    if n < 2 * period:
        return out
    smoothed_range = 0.0
    smoothed_plus = 0.0
    smoothed_minus = 0.0
    adx = 0.0
    dx_sum = 0.0
    for t in range(1, n):
        up = high[t] - high[t - 1]
        down = low[t - 1] - low[t]
        plus = up if (up > down and up > 0.0) else 0.0
        minus = down if (down > up and down > 0.0) else 0.0
        true_range = max(high[t] - low[t], abs(high[t] - close[t - 1]), abs(low[t] - close[t - 1]))
        if t <= period:
            smoothed_range += true_range
            smoothed_plus += plus
            smoothed_minus += minus
            if t < period:
                continue
        else:
            smoothed_range = smoothed_range - smoothed_range / period + true_range
            smoothed_plus = smoothed_plus - smoothed_plus / period + plus
            smoothed_minus = smoothed_minus - smoothed_minus / period + minus
        if smoothed_range > 0.0:
            plus_indicator = 100.0 * smoothed_plus / smoothed_range
            minus_indicator = 100.0 * smoothed_minus / smoothed_range
        else:
            plus_indicator = 0.0
            minus_indicator = 0.0
        total = plus_indicator + minus_indicator
        dx = 100.0 * abs(plus_indicator - minus_indicator) / total if total > 0.0 else 0.0
        if t < 2 * period - 1:
            dx_sum += dx
        elif t == 2 * period - 1:
            dx_sum += dx
            adx = dx_sum / period
            out[t] = adx
        else:
            adx = (adx * (period - 1) + dx) / period
            out[t] = adx
    return out


def _trailing_mean(values: np.ndarray, window: int) -> np.ndarray:
    """Mean of the last ``window`` values up to and including each row (``min_periods == window``)."""
    values = np.asarray(values, dtype=np.float64)
    out = np.full(values.shape[0], np.nan)
    if values.shape[0] < window:
        return out
    cumulative = np.concatenate([[0.0], np.cumsum(values)])
    out[window - 1:] = (cumulative[window:] - cumulative[:-window]) / window
    return out


def true_ranges(high: np.ndarray, low: np.ndarray, close: np.ndarray) -> np.ndarray:
    """True range of every bar; NaN at row 0 (it has no previous close)."""
    out = np.full(high.shape[0], np.nan)
    if high.shape[0] > 1:
        previous = close[:-1]
        out[1:] = np.maximum.reduce([high[1:] - low[1:], np.abs(high[1:] - previous), np.abs(low[1:] - previous)])
    return out


@njit(cache=True)
def _structure_walk(close, move_scale, high_bars, high_prices, low_bars, low_prices, confirmation, decay, out):
    """Walk the bars in time order, entering each pivot at its confirmation bar (pivot bar +
    ``confirmation``), and write columns 3..7 of ``out`` (module docstring)."""
    n = close.shape[0]
    next_high = 0
    next_low = 0
    high_count = 0
    low_count = 0
    last_high = np.nan
    last_low = np.nan
    high_sign = 0.0
    low_sign = 0.0
    last_pivot_bar = -1
    score = 0.0
    for t in range(n):
        score *= decay
        while next_high < high_bars.shape[0] and high_bars[next_high] + confirmation <= t:
            price = high_prices[next_high]
            if high_count >= 1:
                high_sign = 1.0 if price > last_high else (-1.0 if price < last_high else 0.0)
                score += high_sign
            last_high = price
            high_count += 1
            if high_bars[next_high] > last_pivot_bar:
                last_pivot_bar = high_bars[next_high]
            next_high += 1
        while next_low < low_bars.shape[0] and low_bars[next_low] + confirmation <= t:
            price = low_prices[next_low]
            if low_count >= 1:
                low_sign = 1.0 if price > last_low else (-1.0 if price < last_low else 0.0)
                score += low_sign
            last_low = price
            low_count += 1
            if low_bars[next_low] > last_pivot_bar:
                last_pivot_bar = low_bars[next_low]
            next_low += 1
        if high_count >= 1 and low_count >= 1:
            scale = move_scale[t]
            if scale > 0.0 and np.isfinite(scale):
                out[t, 3] = (close[t] - last_high) / scale
                out[t, 4] = (close[t] - last_low) / scale
            out[t, 5] = t - last_pivot_bar
            out[t, 6] = score
        if high_count >= 2 and low_count >= 2:
            out[t, 7] = (high_sign + low_sign) / 2.0


def structural_features(open_: np.ndarray, high: np.ndarray, low: np.ndarray, close: np.ndarray,
                        move_scale: np.ndarray, swing_confirmation_bars: int) -> np.ndarray:
    """(n, 8) float64 in ``FEATURE_NAMES`` order; row t reads bars <= t only, NaN while a window fills."""
    from shared.zones import (
        structural_pivots,  # noqa: PLC0415 - core/shared, the dashboard's one pivot definition
    )

    open_, high, low, close, move_scale = (np.ascontiguousarray(np.asarray(values, dtype=np.float64))
                                           for values in (open_, high, low, close, move_scale))
    if not (np.all(np.isfinite(open_)) and np.all(np.isfinite(high)) and np.all(np.isfinite(low))
            and np.all(np.isfinite(close))):
        raise ValueError("structural_features: every bar needs a finite open, high, low and close")
    confirmation = int(swing_confirmation_bars)
    if confirmation < 1:
        raise ValueError(f"swing_confirmation_bars must be >= 1, got {confirmation}")
    n = close.shape[0]
    out = np.full((n, len(FEATURE_NAMES)), np.nan)
    out[:, 0] = _average_directional_index(high, low, close, ADX_PERIOD_BARS)
    span = high - low
    with np.errstate(divide="ignore", invalid="ignore"):
        body_share = np.where(span > 0, np.abs(close - open_) / np.where(span > 0, span, 1.0), 0.0)
    out[:, 1] = _trailing_mean(body_share, BODY_WINDOW_BARS)
    ranges = true_ranges(high, low, close)
    short = _trailing_mean(np.nan_to_num(ranges), SHORT_TRUE_RANGE_BARS)
    long = _trailing_mean(np.nan_to_num(ranges), LONG_TRUE_RANGE_BARS)
    # row 0 has no true range: a window that includes it is not yet full
    short[:SHORT_TRUE_RANGE_BARS] = np.nan
    long[:LONG_TRUE_RANGE_BARS] = np.nan
    with np.errstate(divide="ignore", invalid="ignore"):
        out[:, 2] = np.where(long > 0, short / long, np.nan)
    high_bars, low_bars = structural_pivots(high, low, confirmation)
    _structure_walk(close, move_scale, high_bars.astype(np.int64), high[high_bars], low_bars.astype(np.int64),
                    low[low_bars], confirmation, 0.5 ** (1.0 / STRUCTURE_HALF_LIFE_BARS), out)
    return out


def contiguous_lengths(rows: np.ndarray) -> list[int]:
    """Lengths of the runs of consecutive row numbers in sorted ``rows``."""
    rows = np.asarray(rows, dtype=np.int64)
    if rows.size == 0:
        return []
    breaks = np.flatnonzero(np.diff(rows) != 1) + 1
    edges = np.concatenate([[0], breaks, [rows.size]])
    return [int(b - a) for a, b in zip(edges[:-1], edges[1:])]


def heuristic_labels(features: np.ndarray, adx_threshold: float) -> np.ndarray:
    """The supervised seed: 0 flat where ADX < threshold, else 1 uptrend where the
    higher-high / higher-low score > 0, 2 downtrend where it is < 0, flat at exactly 0."""
    adx = features[:, FEATURE_NAMES.index(ADX_FEATURE)]
    score = features[:, FEATURE_NAMES.index(SIGNED_TREND_FEATURE)]
    labels = np.zeros(features.shape[0], dtype=np.int64)
    trending = adx >= float(adx_threshold)
    labels[trending & (score > 0)] = 1
    labels[trending & (score < 0)] = 2
    return labels


# ─── the model ─────────────────────────────────────────────────────────────


class StructuralRegimeHMM:
    """Three-state Gaussian hidden Markov model over the structural features (module docstring)."""

    regime_names = REGIME_NAMES
    feature_names = FEATURE_NAMES

    def __init__(self, adx_threshold: float = 20.0, iteration_count: int = 100, seed: int = 0) -> None:
        self.adx_threshold = float(adx_threshold)
        self.iteration_count = int(iteration_count)
        self.seed = int(seed)
        self.start: np.ndarray | None = None
        self._transition: np.ndarray | None = None
        self.means: np.ndarray | None = None          # (3, F) standardised
        self.variances: np.ndarray | None = None      # (3, F) standardised
        self.scaler_mean: np.ndarray | None = None
        self.scaler_deviation: np.ndarray | None = None
        self.training_bar_counts = np.zeros(3, dtype=np.int64)
        self.seed_label_counts = np.zeros(3, dtype=np.int64)
        self.log_likelihood: float | None = None
        self.iterations_run: int | None = None
        self.converged: bool | None = None

    # ── parameters ──
    @property
    def transition(self) -> np.ndarray:
        """3 × 3, ``transition[from][to]`` in ``REGIME_NAMES`` order, rows summing to 1."""
        if self._transition is None:
            raise RuntimeError("StructuralRegimeHMM: not fitted")
        return self._transition

    @property
    def regime_count(self) -> int:
        return len(REGIME_NAMES)

    @classmethod
    def from_parameters(cls, *, start, transition, means, variances, scaler_mean, scaler_deviation,
                        training_bar_counts=None, adx_threshold: float = 20.0, iteration_count: int = 100,
                        seed: int = 0, log_likelihood: float | None = None) -> StructuralRegimeHMM:
        """A model from its arrays (a reload, or a hand-made model in a test)."""
        model = cls(adx_threshold, iteration_count, seed)
        model.start = np.asarray(start, dtype=np.float64)
        model._transition = np.asarray(transition, dtype=np.float64)
        model.means = np.asarray(means, dtype=np.float64)
        model.variances = np.asarray(variances, dtype=np.float64)
        model.scaler_mean = np.asarray(scaler_mean, dtype=np.float64)
        model.scaler_deviation = np.asarray(scaler_deviation, dtype=np.float64)
        if training_bar_counts is not None:
            model.training_bar_counts = np.asarray(training_bar_counts, dtype=np.int64)
        model.log_likelihood = log_likelihood
        return model

    def arrays(self) -> dict:
        return {"hmm_start": self.start, "hmm_transition": self.transition, "hmm_means": self.means,
                "hmm_variances": self.variances, "hmm_scaler_mean": self.scaler_mean,
                "hmm_scaler_deviation": self.scaler_deviation, "hmm_training_bar_counts": self.training_bar_counts,
                "hmm_settings": np.array([self.adx_threshold, self.iteration_count, self.seed], dtype=np.float64)}

    @classmethod
    def from_arrays(cls, arrays) -> StructuralRegimeHMM:
        threshold, iterations, seed = (float(v) for v in arrays["hmm_settings"])
        return cls.from_parameters(
            start=arrays["hmm_start"], transition=arrays["hmm_transition"], means=arrays["hmm_means"],
            variances=arrays["hmm_variances"], scaler_mean=arrays["hmm_scaler_mean"],
            scaler_deviation=arrays["hmm_scaler_deviation"], training_bar_counts=arrays["hmm_training_bar_counts"],
            adx_threshold=threshold, iteration_count=int(iterations), seed=int(seed))

    # ── training ──
    def fit(self, features: np.ndarray, rows: np.ndarray) -> StructuralRegimeHMM:
        """Seeded Baum-Welch on ``rows`` of ``features`` whose eight features are all known."""
        from hmmlearn.hmm import GaussianHMM  # noqa: PLC0415

        features = np.asarray(features, dtype=np.float64)
        rows = np.asarray(rows, dtype=np.int64)
        rows = rows[np.all(np.isfinite(features[rows]), axis=1)]
        if rows.size < MINIMUM_FIT_ROWS:
            raise ValueError(
                f"the structural regime model needs at least {MINIMUM_FIT_ROWS} training bars with every feature known "
                f"(ADX, body-to-range, compression, a confirmed swing high and low); it has {rows.size}"
            )
        raw = features[rows]
        self.scaler_mean = raw.mean(axis=0)
        deviation = raw.std(axis=0)
        deviation[deviation <= 0] = 1.0
        self.scaler_deviation = deviation
        scaled = (raw - self.scaler_mean) / self.scaler_deviation
        lengths = contiguous_lengths(rows)

        labels = heuristic_labels(raw, self.adx_threshold)
        self.seed_label_counts = np.bincount(labels, minlength=3).astype(np.int64)
        signed = FEATURE_NAMES.index(SIGNED_TREND_FEATURE)
        means = np.zeros((3, scaled.shape[1]))
        variances = np.ones((3, scaled.shape[1]))
        for k in range(3):
            mine = scaled[labels == k]
            if mine.shape[0] >= MINIMUM_SEED_ROWS:
                means[k] = mine.mean(axis=0)
                variances[k] = np.maximum(mine.var(axis=0), COVARIANCE_FLOOR)
            else:
                # too few seed rows: the training mean, pushed one deviation along the signed trend feature
                means[k, signed] = (0.0, 1.0, -1.0)[k]
        start = np.maximum(self.seed_label_counts / max(1, self.seed_label_counts.sum()), 0.05)
        start = start / start.sum()
        transition = np.full((3, 3), (1.0 - STICKY_DIAGONAL) / 2.0)
        np.fill_diagonal(transition, STICKY_DIAGONAL)
        prior = np.ones((3, 3))
        np.fill_diagonal(prior, 1.0 + STICKY_PRIOR_PSEUDO_COUNT)

        # One Baum-Welch iteration per hmmlearn call, so the variance floor holds after every
        # M-step (hmmlearn's own min_covar only seeds the variances; its diagonal M-step can
        # shrink a state onto one value of the discrete pivot-sign feature).
        model = GaussianHMM(n_components=3, covariance_type="diag", n_iter=1, tol=0.0, min_covar=COVARIANCE_FLOOR,
                            random_state=self.seed, init_params="", params="stmc", transmat_prior=prior,
                            means_prior=means.copy(), means_weight=SEED_ANCHOR_SHARE * rows.size)
        model.startprob_ = start
        model.transmat_ = transition
        model.means_ = means
        model.covars_ = variances
        previous = -math.inf
        self.converged = False
        self.iterations_run = 0
        logger = logging.getLogger("hmmlearn.base")
        level = logger.level
        logger.setLevel(logging.ERROR)
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                for _ in range(self.iteration_count):
                    model.fit(scaled, lengths)
                    floored = np.maximum(np.diagonal(np.asarray(model.covars_), axis1=1, axis2=2), COVARIANCE_FLOOR)
                    model.covars_ = floored
                    self.iterations_run += 1
                    current = float(model.score(scaled, lengths))
                    if current - previous < CONVERGENCE_TOLERANCE:
                        self.converged = True
                        previous = current
                        break
                    previous = current
        finally:
            logger.setLevel(level)
        self.log_likelihood = previous
        fitted_variances = np.diagonal(np.asarray(model.covars_), axis1=1, axis2=2)
        # order: most negative signed trend mean = downtrend, most positive = uptrend, between = flat
        ascending = np.argsort(model.means_[:, signed], kind="stable")
        order = np.array([ascending[1], ascending[2], ascending[0]])
        start = model.startprob_[order]
        transition = model.transmat_[np.ix_(order, order)]
        for k in range(3):
            total = transition[k].sum()
            transition[k] = transition[k] / total if total > 0 else np.eye(3)[k]
        self.start = start / start.sum() if start.sum() > 0 else np.full(3, 1.0 / 3.0)
        self._transition = transition
        self.means = np.asarray(model.means_[order], dtype=np.float64)
        self.variances = np.asarray(fitted_variances[order], dtype=np.float64)
        filtered, _ = self.forward_filter(features, int(rows[0]), int(rows[-1]))
        assigned = np.argmax(np.nan_to_num(filtered[rows - int(rows[0])], nan=-1.0), axis=1)
        known = np.all(np.isfinite(filtered[rows - int(rows[0])]), axis=1)
        self.training_bar_counts = np.bincount(assigned[known], minlength=3).astype(np.int64)
        return self

    # ── inference ──
    def _require_fitted(self) -> None:
        if self.means is None:
            raise RuntimeError("StructuralRegimeHMM: not fitted")

    def scale(self, features: np.ndarray) -> np.ndarray:
        self._require_fitted()
        return (np.asarray(features, dtype=np.float64) - self.scaler_mean) / self.scaler_deviation

    def log_emission(self, scaled: np.ndarray) -> np.ndarray:
        """(n, 3) diagonal Gaussian log density of each scaled row in each state; NaN rows stay NaN."""
        scaled = np.asarray(scaled, dtype=np.float64)
        centred = scaled[:, None, :] - self.means[None, :, :]
        out = -0.5 * np.sum(np.log(2.0 * math.pi * self.variances)[None, :, :] + centred * centred / self.variances[None, :, :],
                            axis=2)
        out[~np.all(np.isfinite(scaled), axis=1)] = np.nan
        return out

    def forward_filter(self, features: np.ndarray, start_row: int, end_row: int,
                       state: tuple[int, np.ndarray | None] | None = None) -> tuple[np.ndarray, tuple[int, np.ndarray | None]]:
        """Filtered state probabilities for rows ``start_row..end_row`` of ``features`` (inclusive),
        (rows, 3); NaN before the first row whose features are all known. ``state`` = (last filtered
        row, its probabilities) continues an earlier pass. Returns the rows filtered here and the new state."""
        self._require_fitted()
        first = start_row if state is None else state[0] + 1
        alpha = None if state is None else state[1]
        rows = max(0, end_row - first + 1)
        out = np.full((rows, 3), np.nan)
        if rows == 0:
            return out, state if state is not None else (start_row - 1, None)
        emission = self.log_emission(self.scale(features[first:end_row + 1]))
        transition = self._transition
        for position in range(rows):
            log_density = emission[position]
            known = bool(np.all(np.isfinite(log_density)))
            if alpha is None:
                if not known:
                    continue
                prior = self.start
            else:
                prior = alpha @ transition
            if known:
                weights = prior * np.exp(log_density - np.max(log_density))
                total = weights.sum()
                alpha = weights / total if (total > 0 and math.isfinite(total)) else prior
            else:
                alpha = prior
            out[position] = alpha
        return out, (end_row, alpha)

    def filtered_probabilities(self, observations: np.ndarray) -> np.ndarray:
        """(n, 3) forward-filtered probabilities of ``observations`` (time-ordered feature rows) in
        ``REGIME_NAMES`` order: row t reads rows 0..t only."""
        observations = np.asarray(observations, dtype=np.float64)
        filtered, _ = self.forward_filter(observations, 0, observations.shape[0] - 1)
        return filtered

    def most_likely(self, observations: np.ndarray) -> list[str | None]:
        """The name of the most probable state at every row (None before the filter has a row)."""
        return [None if not np.all(np.isfinite(row)) else REGIME_NAMES[int(np.argmax(row))]
                for row in self.filtered_probabilities(observations)]

    # ── description ──
    def raw_means(self) -> np.ndarray:
        """(3, F) the state means in the features' own units."""
        self._require_fitted()
        return self.means * self.scaler_deviation + self.scaler_mean

    def summaries(self) -> list[dict]:
        """One record per state, in ``REGIME_NAMES`` order: its name, the mean of every feature in
        words, the probability of staying, the expected bars per visit and the training bars it holds."""
        self._require_fitted()
        raw = self.raw_means()
        out = []
        for k, name in enumerate(REGIME_NAMES):
            stay = float(self._transition[k, k])
            expected = 1.0 / (1.0 - stay) if stay < 1.0 else None
            feature_means = [{"name": feature, "words": FEATURE_WORDS[feature], "value": float(raw[k, j])}
                             for j, feature in enumerate(FEATURE_NAMES)]
            described = "; ".join(f"{FEATURE_WORDS[feature]} {raw[k, j]:.2f}" for j, feature in enumerate(FEATURE_NAMES))
            out.append({
                "regime": k + 1,
                "name": name,
                "stayProbability": stay,
                "expectedBarsPerVisit": expected,
                "trainingBarCount": int(self.training_bar_counts[k]),
                "featureMeans": feature_means,
                "description": f"{name}: on average {described}",
            })
        return out


__all__ = [
    "ADX_PERIOD_BARS", "BODY_WINDOW_BARS", "FEATURE_NAMES", "FEATURE_WORDS", "LONG_TRUE_RANGE_BARS", "REGIME_NAMES",
    "SHORT_TRUE_RANGE_BARS", "SIGNED_TREND_FEATURE", "STRUCTURE_HALF_LIFE_BARS", "StructuralRegimeHMM",
    "contiguous_lengths", "heuristic_labels", "structural_features", "true_ranges",
]
