"""The structural regime hidden Markov model (``cycle/regime_hmm.py``, ``docs/regime-hmm.md``).

Checked against what the module claims:

- every feature at bar t is the same number when every bar after t is cut
  (causal), and is NaN while its window fills (never 0);
- ADX is Wilder's, the same numbers the Market chart's own ADX indicator computes
  (``calcDirectionalMovement``, run through ``npx tsx``);
- a swing pivot enters the features exactly ``swing_confirmation_bars`` bars
  after it forms, never sooner, and the higher-high / higher-low counter moves
  by +1 / −1 at those bars and decays between them;
- on a synthetic market with planted flat, uptrend and downtrend segments the
  forward filter names more than 85% of the bars correctly, and the three states
  come out named and ordered flat, uptrend, downtrend;
- inference is the forward filter only: the probability at bar t equals
  hmmlearn's ``predict_proba`` of the sequence that ends at t (its last row),
  differs from the smoother's, and does not move when later bars are cut;
- the summaries carry the name, every feature's mean in words, the stay
  probability and the expected bars per visit, and a saved model reloads to the
  same probabilities.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[1] / "src"
REPOSITORY = Path(__file__).resolve().parents[3]
for _root in (ROOT / "core", ROOT):
    if str(_root) not in sys.path:
        sys.path.insert(0, str(_root))

from cycle import regime_hmm  # noqa: E402
from cycle.regime_hmm import (  # noqa: E402
    ADX_PERIOD_BARS,
    FEATURE_NAMES,
    LONG_TRUE_RANGE_BARS,
    REGIME_NAMES,
    StructuralRegimeHMM,
    heuristic_labels,
    structural_features,
)

COLUMN = {name: position for position, name in enumerate(FEATURE_NAMES)}
FLAT, UPTREND, DOWNTREND = 0, 1, 2
ORDER = [FLAT, UPTREND, FLAT, DOWNTREND, UPTREND, DOWNTREND, FLAT, UPTREND, DOWNTREND, FLAT, DOWNTREND, UPTREND]


def planted_market(seed: int, drift_points: float = 1.5, noise_points: float = 3.0):
    """5-minute-like bars in twelve segments of 500-900 bars: flat = a mean-reverting walk around
    the level the segment opened at, uptrend / downtrend = a drift of ``drift_points`` a bar, all
    with Gaussian noise of ``noise_points``. Returns (state per bar, open, high, low, close, move scale)."""
    generator = np.random.default_rng(seed)
    states = np.concatenate([np.full(int(generator.integers(500, 900)), state) for state in ORDER])
    count = states.size
    close = np.empty(count)
    close[0] = 18_000.0
    level = close[0]
    for t in range(1, count):
        if states[t] == FLAT:
            if states[t - 1] != FLAT:
                level = close[t - 1]
            close[t] = close[t - 1] + 0.08 * (level - close[t - 1]) + generator.normal(0, noise_points)
        else:
            step = drift_points if states[t] == UPTREND else -drift_points
            close[t] = close[t - 1] + step + generator.normal(0, noise_points)
    close = np.round(close / 0.25) * 0.25
    open_ = np.r_[close[0], close[:-1]]
    high = np.maximum(open_, close) + np.abs(generator.normal(0, 1.5, count))
    low = np.minimum(open_, close) - np.abs(generator.normal(0, 1.5, count))
    steps = np.r_[np.nan, np.diff(close)]
    move_scale = np.full(count, np.nan)
    for t in range(60, count):
        move_scale[t] = np.sqrt(6) * np.nanstd(steps[t - 59:t + 1])
    return states, open_, high, low, close, move_scale


@pytest.fixture(scope="module")
def market():
    return planted_market(3)


@pytest.fixture(scope="module")
def fitted(market):
    states, *bars = market
    features = structural_features(*bars, 5)
    training = np.arange(0, int(states.size * 0.6))
    return StructuralRegimeHMM(adx_threshold=20.0, iteration_count=100, seed=0).fit(features, training), features


def test_the_module_under_test_is_this_worktrees():
    assert Path(regime_hmm.__file__).resolve().is_relative_to(ROOT.resolve())


# ─── features ──────────────────────────────────────────────────────────────


@pytest.mark.parametrize("cut", [150, 1234, 4321, 7000])
def test_every_feature_at_a_bar_ignores_every_later_bar(market, cut):
    _, open_, high, low, close, scale = market
    full = structural_features(open_, high, low, close, scale, 5)
    short = structural_features(open_[:cut + 1], high[:cut + 1], low[:cut + 1], close[:cut + 1], scale[:cut + 1], 5)
    np.testing.assert_array_equal(full[:cut + 1], short)


def test_warmup_rows_are_unknown_never_zero(market):
    _, *bars = market
    features = structural_features(*bars, 5)
    assert np.all(np.isnan(features[:2 * ADX_PERIOD_BARS - 1, COLUMN["average_directional_index"]]))
    assert np.isfinite(features[2 * ADX_PERIOD_BARS - 1, COLUMN["average_directional_index"]])
    assert np.all(np.isnan(features[:LONG_TRUE_RANGE_BARS, COLUMN["volatility_compression_ratio"]]))
    assert np.all(np.isnan(features[:5, COLUMN["higher_high_higher_low_score"]]))       # no pivot can be confirmed yet
    assert np.all(np.isnan(features[:60, COLUMN["distance_from_swing_high_scaled"]]))   # no move scale yet
    assert np.all(np.isfinite(features[400:]))


@pytest.mark.skipif(shutil.which("npx") is None, reason="npx is not on PATH")
def test_the_average_directional_index_is_the_market_charts(market):
    _, open_, high, low, close, scale = market
    count = 1500
    ours = structural_features(open_, high, low, close, scale, 5)[:count, COLUMN["average_directional_index"]]
    payload = {"high": high[:count].tolist(), "low": low[:count].tolist(), "close": close[:count].tolist(),
               "period": ADX_PERIOD_BARS}
    result = subprocess.run(["npx", "tsx", str(REPOSITORY / "tests" / "fixtures" / "directional_movement_parity.ts")],
                            input=json.dumps(payload), capture_output=True, text=True, cwd=REPOSITORY,
                            shell=sys.platform == "win32", timeout=180)
    assert result.returncode == 0, result.stderr[-800:]
    chart = np.array([np.nan if value is None else value for value in json.loads(result.stdout)], dtype=np.float64)
    np.testing.assert_array_equal(np.isnan(ours), np.isnan(chart))
    assert int(np.isfinite(ours).sum()) == count - (2 * ADX_PERIOD_BARS - 1)
    np.testing.assert_allclose(ours[np.isfinite(ours)], chart[np.isfinite(chart)], rtol=1e-12, atol=1e-9)


def _staircase(confirmation: int):
    """Bars that climb in three clean swings (rise 10, fall 6) after a flat run, so every swing high
    and low is a strict pivot at a known bar."""
    leg = 3 * confirmation
    pieces = [np.full(30, 100.0)]
    level = 100.0
    for _ in range(4):
        pieces.append(level + np.linspace(10 / leg, 10, leg))
        level += 10
        pieces.append(level - np.linspace(6 / leg, 6, leg))
        level -= 6
    close = np.concatenate(pieces)
    # wicks of the same length on every bar, so the bar with the highest close has the highest high
    return close.copy(), close + 0.1, close - 0.1, close, np.ones(close.size)


@pytest.mark.parametrize("confirmation", [3, 5, 8])
def test_a_pivot_enters_exactly_confirmation_bars_after_it_forms(confirmation):
    from shared.zones import structural_pivots  # noqa: PLC0415

    open_, high, low, close, scale = _staircase(confirmation)
    highs, lows = structural_pivots(high, low, confirmation)
    assert highs.size >= 3 and lows.size >= 3
    features = structural_features(open_, high, low, close, scale, confirmation)
    distance_high = features[:, COLUMN["distance_from_swing_high_scaled"]]
    since = features[:, COLUMN["bars_since_last_pivot"]]
    score = features[:, COLUMN["higher_high_higher_low_score"]]
    decay = 0.5 ** (1.0 / regime_hmm.STRUCTURE_HALF_LIFE_BARS)
    for previous_high, pivot in zip(highs[:-1], highs[1:]):
        known = pivot + confirmation
        # one bar before confirmation the feature still measures from the previous swing high
        assert distance_high[known - 1] == pytest.approx(close[known - 1] - high[previous_high])
        assert distance_high[known] == pytest.approx(close[known] - high[pivot])
        assert since[known] == confirmation
        # a higher high: the counter steps up by one at the confirmation bar, after one bar of decay
        assert score[known] == pytest.approx(score[known - 1] * decay + 1.0)
    for previous_low, pivot in zip(lows[:-1], lows[1:]):
        if previous_low < highs[0]:
            continue
        known = pivot + confirmation
        assert score[known] == pytest.approx(score[known - 1] * decay + 1.0)       # a higher low
    assert np.nanmax(features[:, COLUMN["last_two_pivots_sign"]]) == 1.0


def test_a_falling_staircase_counts_lower_highs_and_lower_lows():
    open_, high, low, close, scale = _staircase(5)
    mirrored = [400.0 - values for values in (open_, low, high, close)]   # high and low swap under the mirror
    features = structural_features(*mirrored, scale, 5)
    assert np.nanmin(features[:, COLUMN["higher_high_higher_low_score"]]) < -2.0
    assert np.nanmin(features[:, COLUMN["last_two_pivots_sign"]]) == -1.0


def test_the_heuristic_seed_reads_adx_then_the_counters_sign():
    features = np.zeros((4, len(FEATURE_NAMES)))
    features[:, COLUMN["average_directional_index"]] = [10, 30, 30, 30]
    features[:, COLUMN["higher_high_higher_low_score"]] = [5, 2, -2, 0]
    assert heuristic_labels(features, 20.0).tolist() == [FLAT, UPTREND, DOWNTREND, FLAT]


# ─── the model ─────────────────────────────────────────────────────────────


@pytest.mark.parametrize("seed", [3, 4, 5])
def test_planted_regimes_are_recovered_with_the_right_names(seed):
    states, *bars = planted_market(seed)
    features = structural_features(*bars, 5)
    training = np.arange(0, int(states.size * 0.6))
    model = StructuralRegimeHMM(20.0, 100, 0).fit(features, training)
    labels = model.most_likely(features)
    known = np.array([label is not None for label in labels])
    named = np.array([REGIME_NAMES.index(label) if label is not None else -1 for label in labels])
    agreement = float(np.mean(named[known] == states[known]))
    held_out = np.arange(training.size, states.size)
    held_out_agreement = float(np.mean(named[held_out] == states[held_out]))
    print(f"seed {seed}: {agreement:.3f} of bars named right, {held_out_agreement:.3f} after the training span")
    assert agreement > 0.85, agreement
    assert held_out_agreement > 0.80, held_out_agreement
    # ordered by the signed trend feature: downtrend < flat < uptrend
    trend = model.raw_means()[:, COLUMN["higher_high_higher_low_score"]]
    assert trend[DOWNTREND] < trend[FLAT] < trend[UPTREND]
    # and the flat state is the one with the lowest ADX
    adx = model.raw_means()[:, COLUMN["average_directional_index"]]
    assert adx[FLAT] < adx[UPTREND] and adx[FLAT] < adx[DOWNTREND]


def test_inference_is_the_forward_filter_never_the_smoother(fitted):
    from hmmlearn.hmm import GaussianHMM  # noqa: PLC0415

    model, features = fitted
    filtered = model.filtered_probabilities(features)
    first = int(np.flatnonzero(np.all(np.isfinite(features), axis=1))[0])
    reference = GaussianHMM(n_components=3, covariance_type="diag", init_params="", params="")
    reference.startprob_ = model.start
    reference.transmat_ = model.transition
    reference.means_ = model.means
    reference.covars_ = model.variances
    scaled = model.scale(features[first:])
    smoothed = reference.predict_proba(scaled)
    differs = 0
    for t in (first + 10, first + 500, first + 2500, features.shape[0] - 1):
        prefix = reference.predict_proba(scaled[: t - first + 1])
        np.testing.assert_allclose(filtered[t], prefix[-1], atol=1e-9)
        differs += int(not np.allclose(filtered[t], smoothed[t - first], atol=1e-6))
    assert differs >= 1, "the filter equals the smoother everywhere: the check is empty"
    # the filtered probability at t does not move when every later bar is cut
    cut = 3000
    np.testing.assert_allclose(model.filtered_probabilities(features[:cut + 1]), filtered[:cut + 1], atol=0, rtol=0)
    np.testing.assert_allclose(filtered[first:].sum(axis=1), 1.0, atol=1e-9)
    assert np.all(np.isnan(filtered[:first]))


def test_a_bar_without_features_only_advances_the_transition(fitted):
    model, features = fitted
    holed = features.copy()
    holed[2000] = np.nan
    filtered = model.filtered_probabilities(holed)
    np.testing.assert_allclose(filtered[2000], filtered[1999] @ model.transition, atol=1e-12)


def test_the_summaries_say_each_regime_in_words(fitted):
    model, _ = fitted
    summaries = model.summaries()
    assert [summary["name"] for summary in summaries] == ["flat", "uptrend", "downtrend"]
    for k, summary in enumerate(summaries):
        assert summary["stayProbability"] == pytest.approx(model.transition[k, k])
        assert summary["expectedBarsPerVisit"] == pytest.approx(1.0 / (1.0 - model.transition[k, k]))
        assert [item["name"] for item in summary["featureMeans"]] == list(FEATURE_NAMES)
        assert all(item["words"] for item in summary["featureMeans"])
        assert summary["description"].startswith(summary["name"] + ": on average")
    assert sum(summary["trainingBarCount"] for summary in summaries) > 0
    np.testing.assert_allclose(model.transition.sum(axis=1), 1.0, atol=1e-12)
    assert np.all(np.diag(model.transition) > 0.9)          # the sticky prior and long planted segments


def test_a_saved_model_reloads_to_the_same_probabilities(fitted):
    model, features = fitted
    reloaded = StructuralRegimeHMM.from_arrays(model.arrays())
    np.testing.assert_array_equal(reloaded.filtered_probabilities(features), model.filtered_probabilities(features))
    assert reloaded.adx_threshold == model.adx_threshold


def test_too_few_known_rows_is_refused_in_words(market):
    _, *bars = market
    features = structural_features(*bars, 5)
    with pytest.raises(ValueError, match="at least 100 training bars"):
        StructuralRegimeHMM().fit(features, np.arange(0, 120))
