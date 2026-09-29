"""The shared bridge modules (``src/ml/cycle/bridges/``) and the harness itself.

Each module is checked against its own stated rule (the tape against
``cycle.simulate``'s arithmetic, the filter against a hand recursion, the
indicators and the filter against truncation, the pool against the span, ...).
Then a small reference bridge built only from these modules — a tabular agent
over the reward tape — runs through EVERY gate of ``tests/cycle_bridge_harness.py``
and one engine fold, and deliberately leaky variants show that the
truncation, reloaded-truncation and poison gates catch what they are meant to catch.
"""

from __future__ import annotations

import json
import math
import shutil
from pathlib import Path

import cycle_bridge_harness as harness
import numpy as np
import pytest

from cycle import catalog
from cycle.adapter import StopRequested
from cycle.bridges import (
    base,
    binning,
    calibration,
    groups,
    parameter_names,
    persistence,
    pool,
    regimes,
    rules,
    tape,
    training,
)
from cycle.bridges.training import ValidationScore
from cycle.market import MarketView
from cycle.simulate import CostModel, Simulator

REFERENCE_KEY = "bridge_reference"
REFERENCE_PARAMETERS = {"bin_count": 4, "epochs": 4, "learning_rate": 0.5, "patience": 3}


@pytest.fixture(scope="module")
def market() -> harness.SyntheticMarket:
    return harness.synthetic_market()


# ═══ tape ══════════════════════════════════════════════════════════════════


def _tiny_view(close, open_, horizon=2, gap_multiple=0.0, round_trip_points=0.5, timestamps=None) -> MarketView:
    close = np.asarray(close, dtype=np.float64)
    count = close.size
    stamps = np.arange(count, dtype=np.int64) * 300 if timestamps is None else np.asarray(timestamps, dtype=np.int64)
    return MarketView.from_arrays(timestamps=stamps, close=close, open=open_, high=np.maximum(close, open_) + 1,
                                  low=np.minimum(close, open_) - 1, horizon=horizon,
                                  price_targets=np.zeros(count), move_scale=np.full(count, 2.0),
                                  labels=np.zeros(count), gap_multiple=gap_multiple, tick_size=0.25,
                                  round_trip_cost_points=round_trip_points)


def test_the_whole_trade_matches_the_simulators_trade():
    cost = CostModel("MNQ", 0.25, 0.5, 2.0, 1.5, "test")          # round trip 3.0 USD = 1.5 points
    generator = np.random.default_rng(3)
    close = np.round((100 + np.cumsum(generator.standard_normal(40))) / 0.25) * 0.25
    open_ = np.round((np.concatenate([[close[0]], close[:-1]]) + 0.25 * generator.standard_normal(40)) / 0.25) * 0.25
    holding = 3
    view = _tiny_view(close, open_, horizon=holding, round_trip_points=cost.round_trip / cost.point_value)
    reward_tape = tape.RewardTape.from_view(view)
    for decision_row, side in ((5, 1), (12, -1), (20, 1)):
        simulator = Simulator(cost, holding_bars=holding)
        trades = []
        simulator.on_trade = lambda trade, status: trades.append((trade, status))
        for row in range(decision_row, decision_row + holding + 3):
            signal = side if row == decision_row else 0
            simulator.step(row, row, open_[row], open_[row] + 10, open_[row] - 10, close[row], signal, 0.7)
        closed = [trade for trade, status in trades if status == "closed"]
        assert len(closed) == 1 and closed[0].exit_index == decision_row + 1 + holding
        expected_points = closed[0].net_profit_usd / cost.point_value
        assert reward_tape.position_points(decision_row, side)[0] == pytest.approx(expected_points, abs=1e-12)
        assert reward_tape.position_reward(decision_row, side)[0] == pytest.approx(expected_points / 2.0, abs=1e-12)


def test_the_step_rewards_sum_to_the_simulators_net_with_one_bar_holding():
    cost = CostModel("MNQ", 0.25, 0.5, 2.0, 1.5, "test")
    generator = np.random.default_rng(5)
    count = 60
    close = np.round((100 + np.cumsum(generator.standard_normal(count))) / 0.25) * 0.25
    open_ = np.round((np.concatenate([[close[0]], close[:-1]]) + 0.25 * generator.standard_normal(count)) / 0.25) * 0.25
    signals = generator.choice([-1, 0, 1], size=count)
    view = _tiny_view(close, open_, horizon=1, round_trip_points=cost.round_trip / cost.point_value)
    reward_tape = tape.RewardTape.from_view(view)
    simulator = Simulator(cost, holding_bars=1)
    total_usd = 0.0
    for row in range(count - 1):
        result = simulator.step(row, row, open_[row], close[row] + 50, close[row] - 50, close[row], int(signals[row]), 0.5)
        total_usd += result.net_usd
    result = simulator.step(count - 1, count - 1, open_[-1], close[-1] + 50, close[-1] - 50, close[-1], None, None, decide=False)
    total_usd += result.net_usd
    positions = np.concatenate([[0], signals[:-1]]).astype(float)       # the position held going into each decision
    steps = reward_tape.step_points(np.arange(count - 1), positions[:-1], signals[:-1].astype(float))
    # the simulator marks the open position of the last bar to its close and never exits it
    assert np.nansum(steps) * cost.point_value == pytest.approx(total_usd, abs=1e-9)


def test_the_tape_reads_nothing_after_known_until_and_skips_gap_spans(market):
    train = market.train_index
    reward_tape = tape.RewardTape.from_view(market.view, train)
    assert reward_tape.known_until == int(train[-1]) + market.horizon + 1
    assert reward_tape.known_until < int(market.validation_index[0]) + 1
    beyond = np.arange(int(train[-1]) + 1, int(train[-1]) + 20)
    assert np.all(np.isnan(reward_tape.position_points(beyond, 1.0)))
    usable = reward_tape.usable_rows(market.view.fit_rows(train))
    assert usable.size and usable[-1] <= int(train[-1])
    gaps = np.flatnonzero(market.view.one_bar_crosses_gap)
    crossing = [row for row in usable if np.any((gaps >= row + 1) & (gaps <= row + market.horizon))]
    assert not crossing
    with pytest.raises(ValueError, match="open"):
        tape.RewardTape.from_view(market.view.without_intrabar(), train)


@pytest.mark.parametrize("holding", [1, 20, 200])
def test_a_holding_longer_than_the_horizon_reads_no_validation_price(market, holding):
    train = market.train_index
    reward_tape = tape.RewardTape.from_view(market.view, train, holding_bars=holding)
    assert reward_tape.known_until == int(train[-1]) + market.horizon + 1     # the label horizon, never the holding
    usable = reward_tape.usable_rows(market.view.fit_rows(train))
    assert usable.size and int(usable[-1]) + 1 + holding <= int(train[-1]) + market.horizon + 1


def test_the_view_hands_out_read_only_arrays_and_leaves_the_engines_writable(market):
    close = np.array(market.data.close, copy=True)
    targets = np.array(market.price_targets, copy=True)
    view = MarketView.from_arrays(timestamps=market.timestamps, close=close, horizon=market.horizon,
                                  price_targets=targets, move_scale=market.move_scale, labels=market.labels)
    with pytest.raises(ValueError, match="read-only"):
        view.price_targets[0] = 5.0
    with pytest.raises(ValueError, match="read-only"):
        view.close[0] = 5.0
    assert np.shares_memory(view.close, close)                               # no copy of the engine's arrays
    targets[0] = 7.0                                                         # the owner still writes its own
    assert view.price_targets[0] == 7.0
    assert view.truncated(100).price_targets.flags.writeable is False
    assert view.without_intrabar().close is view.close


def test_the_hindsight_position_beats_the_cost_or_stays_flat():
    view = _tiny_view([100, 100, 101, 105, 105, 99, 99, 99], [100, 100, 100, 101, 105, 105, 99, 99], horizon=1,
                      round_trip_points=2.0)
    reward_tape = tape.RewardTape.from_view(view)
    positions = reward_tape.hindsight_positions(np.arange(7))
    # open[t+2] - open[t+1]: 0, 1, 4, 0, -6, 0, then unknown (the exit would be past the last bar)
    assert positions[:6].tolist() == [0.0, 0.0, 1.0, 0.0, -1.0, 0.0]
    assert math.isnan(positions[6])


def test_the_environment_is_seeded_hides_the_position_and_pays_the_tape(market):
    train = market.train_index
    reward_tape = tape.RewardTape.from_view(market.view, train)
    environment = tape.TapeEnvironment(market.features, reward_tape, train, episode_length=50, seed=3)
    first, info = environment.reset(seed=11)
    again, info_again = environment.reset(seed=11)
    assert np.array_equal(first, again) and info["row"] == info_again["row"]
    assert first.shape == (market.features.shape[1],)
    total = 0.0
    for step in range(50):
        observation, reward, terminated, truncated, info = environment.step(2)
        assert reward == pytest.approx(float(np.nan_to_num(reward_tape.position_reward(info["row"], 1.0)[0])))
        total += reward
        assert truncated is False and terminated == (step == 49)
    continuous = tape.TapeEnvironment(market.features, reward_tape, train, action_kind="continuous", seed=0)
    continuous.reset(seed=0)
    _, reward, *_ = continuous.step(np.array([0.5], dtype=np.float32))
    row = int(continuous.rows[continuous._start])
    assert reward == pytest.approx(float(reward_tape.position_reward(row, 0.5)[0]))
    assert tape.action_to_position(0) == -1.0 and tape.action_to_position(2) == 1.0


def test_the_stable_baselines_callback_reports_every_rollout_and_propagates_a_stop(market):
    pytest.importorskip("stable_baselines3")
    from stable_baselines3 import PPO

    train = market.train_index
    reward_tape = tape.RewardTape.from_view(market.view, train)
    environment = tape.TapeEnvironment(market.features, reward_tape, train, episode_length=64, seed=0)
    reporter = harness.RecordingReporter()
    validation = market.validation_index

    def evaluate() -> ValidationScore:
        observations = np.clip(market.features[validation], -10, 10).astype(np.float32)
        import torch

        with torch.no_grad():
            distribution = model.policy.get_distribution(torch.as_tensor(observations))
            probabilities = distribution.distribution.probs.numpy()
        share = calibration.share(probabilities[:, 2], probabilities[:, 0])
        return training.score("classification", share, market.labels[validation])

    model = PPO("MlpPolicy", environment, n_steps=64, batch_size=32, n_epochs=1, seed=0, device="cpu", verbose=0)
    callback = tape.reporter_callback(reporter, rollout_count=4, train_index=train, evaluate=evaluate)
    model.learn(total_timesteps=256, callback=callback)
    starts = [event for event in reporter.events if event[0] == "epoch_started"]
    assert len(starts) == 4 and len(reporter.epochs) == 4
    assert reporter.checkpoints == 2 * 4 and callback.checkpoints == 8
    assert reporter.step_unit == "epoch"
    assert callback.best_rollout >= 1 and callback.restore_best() == callback.best_rollout
    stopping = harness.RecordingReporter(stop_at_checkpoint=2)
    model = PPO("MlpPolicy", environment, n_steps=64, batch_size=32, n_epochs=1, seed=0, device="cpu", verbose=0)
    with pytest.raises(StopRequested):
        model.learn(total_timesteps=256, callback=tape.reporter_callback(stopping, rollout_count=4, train_index=train))


# ═══ calibration ═══════════════════════════════════════════════════════════


def test_the_temperature_recovers_a_known_scale_and_never_flips_the_sign():
    generator = np.random.default_rng(0)
    gap = generator.normal(0, 2.0, 20000)
    label = (generator.random(gap.size) < calibration.sigmoid(0.7 * gap)).astype(float)
    scale = calibration.TemperatureScale.fit(gap, label)
    assert scale.inverse_temperature == pytest.approx(0.7, rel=0.05)
    assert scale.temperature == pytest.approx(1 / scale.inverse_temperature)
    flipped = calibration.TemperatureScale.fit(gap, 1 - label)
    assert flipped.inverse_temperature == 0.0 and np.allclose(flipped.apply(gap), 0.5)
    assert calibration.TemperatureScale.from_dict(scale.to_dict()) == scale
    applied = scale.apply(np.array([np.nan, 1.0]))
    assert math.isnan(applied[0]) and applied[1] == pytest.approx(calibration.sigmoid(scale.inverse_temperature))


def test_boltzmann_share_and_the_validation_curve():
    assert calibration.boltzmann([2.0], [0.0], 1.0)[0] == pytest.approx(calibration.sigmoid(2.0))
    assert calibration.boltzmann([2.0], [0.0], math.inf)[0] == 0.5
    assert math.isnan(calibration.boltzmann([np.nan], [0.0], 1.0)[0])
    shares = calibration.share([3.0, 0.0, 1.0], [1.0, 0.0, np.nan])
    assert shares[0] == 0.75 and math.isnan(shares[1]) and math.isnan(shares[2])
    with pytest.raises(ValueError):
        calibration.share([-1.0], [1.0])
    generator = np.random.default_rng(1)
    score = generator.normal(size=5000)
    label = (generator.random(5000) < calibration.sigmoid(1.5 * score - 0.3)).astype(float)
    curve = calibration.ValidationCurve.fit(score, label)
    assert curve.slope == pytest.approx(1.5, rel=0.1) and curve.intercept == pytest.approx(-0.3, abs=0.1)
    assert calibration.ValidationCurve.from_dict(curve.to_dict()) == curve
    assert calibration.fit_platt(score, label) == (curve.slope, curve.intercept)
    assert np.allclose(calibration.apply_platt((curve.slope, curve.intercept), score), curve.apply(score))
    rows = np.arange(100, 200)
    fitted = calibration.validation_curve(lambda features, index: features[index, 0], score[:, None], label, rows)
    assert fitted == calibration.ValidationCurve.fit(score[rows], label[rows])


# ═══ binning ═══════════════════════════════════════════════════════════════


def test_quantile_bins_states_and_target_means(market):
    bins = binning.QuantileBins.fit(np.arange(100.0), 4)
    assert bins.bin_count == 4 and bins.assign(np.array([0.0, 30.0, 60.0, 99.0, np.nan])).tolist() == [0, 1, 2, 3, -1]
    assert binning.QuantileBins.fit([1.0, 1.0, 1.0], 5).bin_count == 1
    feature_bins = binning.FeatureBins.fit(market.features, market.train_index, 3, columns=[0, 1])
    rows = market.test_index[:50]
    states = feature_bins.states(market.features, rows)
    codes = feature_bins.codes(market.features, rows)
    radices = feature_bins.radices
    assert np.array_equal(states, codes[:, 0] * radices[1] + codes[:, 1])
    assert feature_bins.state_count == radices[0] * radices[1]
    assert binning.FeatureBins.from_dict(json.loads(json.dumps(feature_bins.to_dict()))).states(market.features, rows).tolist() == states.tolist()
    targets = binning.TargetBins.fit(market.price_targets, market.train_index, 5, prior_weight=0.0)
    values = market.price_targets[market.train_index].astype(np.float64)
    values = values[np.isfinite(values)]
    codes = targets.assign(values)
    for code in range(targets.bins.bin_count):
        assert targets.means[code] == pytest.approx(values[codes == code].mean(), rel=1e-9)
    assert binning.TargetBins.from_dict(targets.to_dict()).mean_of(codes[:5]).tolist() == targets.mean_of(codes[:5]).tolist()
    assert binning.conditional_means([0, 0, 1], [1.0, 3.0, 5.0], 3, prior_weight=1.0, prior_mean=0.0).tolist() == [4 / 3, 2.5, 0.0]


def test_cluster_states_are_fitted_on_training_rows_and_assign_row_by_row(market):
    clusters = binning.ClusterStates.fit(market.features, market.train_index, 3, seed=0)
    rows = market.test_index[:40]
    batch = clusters.assign(market.features, rows)
    single = np.array([clusters.assign(market.features, [row])[0] for row in rows])
    assert np.array_equal(batch, single) and set(batch.tolist()) <= {0, 1, 2}
    poisoned = market.features.copy()
    poisoned[market.validation_index[0]:] = 1e6
    again = binning.ClusterStates.fit(poisoned, market.train_index, 3, seed=0)
    assert np.array_equal(again.centers, clusters.centers)
    assert np.array_equal(binning.ClusterStates.from_dict(clusters.to_dict()).assign(market.features, rows), batch)
    missing = market.features.copy()
    missing[rows[0], 0] = np.nan
    assert clusters.assign(missing, rows[:1])[0] == -1


# ═══ pool ══════════════════════════════════════════════════════════════════


def test_the_pool_is_the_training_span_only(market):
    rows = pool.unlabelled_pool(market.features, market.train_index)
    assert rows[0] >= market.train_index[0] and rows[-1] == market.train_index[-1]
    assert np.all(np.isfinite(market.features[rows]))
    assert set(market.train_index.tolist()) <= set(rows.tolist())
    assert not set(rows.tolist()) & set(market.validation_index.tolist())


def test_block_masking_keeps_labels_off_the_hidden_blocks(market):
    horizon = market.horizon
    mask = pool.block_mask(market.train_index, block_bars=100, labeled_fraction=0.3, embargo_bars=horizon, seed=4,
                           features=market.features)
    assert set(mask.labelled.tolist()) <= set(market.train_index.tolist())
    assert not set(mask.labelled.tolist()) & set(mask.unlabelled.tolist())
    assert mask.unlabelled.size and mask.unlabelled.max() <= market.train_index[-1]
    for first, last in mask.hidden_blocks:
        near = mask.labelled[(mask.labelled >= first - horizon) & (mask.labelled <= last + horizon)]
        assert near.size == 0, (first, last, near[:5])
    again = pool.block_mask(market.train_index, block_bars=100, labeled_fraction=0.3, embargo_bars=horizon, seed=4)
    assert again.hidden_blocks == mask.hidden_blocks
    with pytest.raises(ValueError):
        pool.block_mask(market.train_index, block_bars=0, labeled_fraction=0.5, embargo_bars=1, seed=0)


# ═══ regimes ═══════════════════════════════════════════════════════════════


def test_the_forward_filter_is_the_hand_recursion_and_not_the_smoother():
    transition = np.array([[0.9, 0.1], [0.2, 0.8]])
    initial = np.array([0.5, 0.5])
    likelihood = np.array([[0.8, 0.1], [0.7, 0.2], [0.1, 0.9], [0.2, 0.6], [0.6, 0.3]])
    filtered, log_likelihood = regimes.forward_filter(np.log(likelihood), transition, initial)
    alpha = initial * likelihood[0]
    evidence = [alpha.sum()]
    hand = [alpha / alpha.sum()]
    for row in range(1, len(likelihood)):
        alpha = (hand[-1] @ transition) * likelihood[row]
        evidence.append(alpha.sum())
        hand.append(alpha / alpha.sum())
    assert np.allclose(filtered, np.array(hand), atol=1e-12)
    assert log_likelihood == pytest.approx(float(np.sum(np.log(evidence))))
    smoothed = regimes.forward_backward(np.log(likelihood), transition, initial)
    assert np.allclose(smoothed[-1], filtered[-1]) and not np.allclose(smoothed[:-1], filtered[:-1])
    # truncation: the filtered state at t ignores rows after t
    for cut in range(1, len(likelihood)):
        prefix, _ = regimes.forward_filter(np.log(likelihood[:cut]), transition, initial)
        assert np.allclose(prefix, filtered[:cut])
    missing = np.log(likelihood).copy()
    missing[2] = np.nan
    skipped, _ = regimes.forward_filter(missing, transition, initial)
    assert np.allclose(skipped[2], skipped[1] @ transition)


def test_blocks_regimes_and_the_gaussian_model(market):
    rows = np.arange(10, 110)
    blocks = regimes.chronological_blocks(rows, block_count=4)
    assert len(blocks) == 4 and np.array_equal(np.concatenate(blocks), rows)
    assert all(a[-1] < b[0] for a, b in zip(blocks, blocks[1:]))
    by_bars = regimes.chronological_blocks(rows, block_bars=30)
    assert [block.size for block in by_bars] == [30, 30, 30, 10]
    with pytest.raises(ValueError):
        regimes.chronological_blocks(rows)
    kmeans = regimes.KMeansRegimes.fit(market.features, market.labels, market.train_index, 2, seed=0, columns=[0])
    assert np.all((kmeans.up_rates > 0) & (kmeans.up_rates < 1)) and abs(kmeans.up_rates[0] - kmeans.up_rates[1]) > 0.1
    assert regimes.KMeansRegimes.from_dict(kmeans.to_dict()).assign(market.features, rows).tolist() == kmeans.assign(market.features, rows).tolist()
    model = regimes.fit_gaussian_hmm(market.features[market.train_index, :1], 2, seed=0, iteration_count=30)
    assert model["means"][0, 0] < model["means"][1, 0] and np.allclose(model["transition"].sum(axis=1), 1.0)
    emissions = regimes.gaussian_log_emissions(market.features[:, :1], model["means"], model["variances"])
    filtered, _ = regimes.forward_filter(emissions[market.test_index], model["transition"], model["initial"])
    up_state = filtered[:, 1] > 0.5
    agreement = np.mean(up_state == (market.regime[market.test_index] == 1))
    assert agreement > 0.7


# ═══ groups ════════════════════════════════════════════════════════════════


def test_groups_read_the_feature_registry(market):
    assert groups.feature_category("return_1") == "returns" and groups.feature_modality("return_1") == "price_geometry"
    assert groups.feature_category("book_imbalance_top") == "microstructure"
    assert groups.feature_modality("finbert_anything_new") == groups.FINBERT
    assert groups.feature_category("planted_signal") == groups.OTHER
    modalities = groups.modality_groups(market.names)
    assert sorted(column for columns in modalities.values() for column in columns) == list(range(len(market.names)))
    assert modalities[groups.FINBERT] == [len(market.names) - 1]
    assert groups.finbert_columns(market.names) == [len(market.names) - 1]
    categories = groups.category_groups(market.names)
    assert categories["returns"] == [1, 2]
    channels = groups.calendar_channels(np.array([1_736_121_600, 1_736_121_600 + 6 * 3600]))   # Monday 00:00 and 06:00
    assert channels.shape == (2, 4) and channels[0, 0] == pytest.approx(0.0, abs=1e-6)
    assert channels[0, 2] == pytest.approx(0.0, abs=1e-6) and channels[1, 0] == pytest.approx(1.0, abs=1e-6)
    views = groups.split_views(market.names, 2, seed=0)
    assert len(views) == 2 and sorted(views[0] + views[1]) == list(range(len(market.names)))
    assert groups.split_views(["a", "b", "c", "d"], 2, seed=1) == groups.split_views(["a", "b", "c", "d"], 2, seed=1)


# ═══ rules ═════════════════════════════════════════════════════════════════


def test_the_rule_library_loads_resolves_and_logs_what_it_disables(market):
    library = rules.RuleLibrary.load()
    logged: list[str] = []
    resolved = library.resolve(market.names, log=lambda message, level: logged.append(message))
    assert "momentum_positive" in resolved.atom_names and "above_fifty_bar_average" not in resolved.atom_names
    assert any("above_fifty_bar_average disabled" in line for line in logged)
    assert "momentum_with_trend_long" in resolved.disabled
    names = {rule.name for rule in resolved.rules}
    assert "trend_following_long" in names and "momentum_with_trend_long" not in names
    no_raw = library.resolve(market.names, raw_available=False)
    assert all(atom.source == "indicator" for atom in no_raw.atoms)


def test_indicators_are_causal_and_atoms_keep_unknowns_unknown(market):
    view = market.view
    for name, settings in rules.RuleLibrary.load().indicators.items():
        full = rules.indicator_values(name, view, settings)
        for cut in (300, 1200, 2500):
            prefix = rules.indicator_values(name, view.truncated(cut), settings)
            assert np.allclose(prefix, full[:cut], equal_nan=True, rtol=1e-9, atol=1e-12), name
    close = np.array([10.0, 11.0, 12.0, 11.0, 12.0, 13.0, 14.0, 13.0, 14.0, 15.0])
    index = rules.relative_strength_index(close, 3)
    assert np.all(np.isnan(index[:3])) and np.all((index[3:] >= 0) & (index[3:] <= 100))
    assert rules.relative_strength_index(np.arange(10.0), 3)[-1] == 100.0
    atom = rules.Atom("a", "feature", "x", ">", 0.0, suggests="up")
    assert np.array_equal(atom.truth(np.array([1.0, -1.0, np.nan])), np.array([1.0, 0.0, np.nan]), equal_nan=True)
    assert atom.degree(np.array([0.0]), 1.0)[0] == 0.5
    with pytest.raises(ValueError):
        rules.Atom("b", "feature", "x", ">", None)


def test_training_quantile_thresholds_come_from_training_rows_only(market):
    library = rules.RuleLibrary.load().resolve(market.names)
    fitted = library.fit(market.view, market.train_index)
    atom = next(atom for atom in fitted.atoms if atom.name == "high_realised_volatility")
    values = market.view.feature_column("volatility_20")[market.train_index]
    assert atom.threshold == pytest.approx(np.quantile(values[np.isfinite(values)], 0.8))
    _, spoiled = harness.poisoned(market, int(market.train_index[-1]))
    again = rules.RuleLibrary.load().resolve(market.names).fit(spoiled, market.train_index)
    assert [a.threshold for a in again.atoms] == [a.threshold for a in fitted.atoms]
    rows = market.test_index[:30]
    table = fitted.truth_table(market.view, rows)
    firing = fitted.rule_firing(market.view, rows)
    assert table.shape == (30, len(fitted.atoms)) and firing.shape == (30, len(fitted.rules))
    assert set(np.unique(table[np.isfinite(table)])) <= {0.0, 1.0}
    round_trip = rules.ResolvedLibrary.from_dict(json.loads(json.dumps(fitted.to_dict())))
    assert np.array_equal(round_trip.truth_table(market.view, rows), table, equal_nan=True)
    degrees = fitted.degree_table(market.view, rows)
    assert np.all((degrees[np.isfinite(degrees)] > 0) & (degrees[np.isfinite(degrees)] < 1))


# ═══ persistence, training, parameter names ════════════════════════════════


def test_persistence_round_trips(tmp_path):
    persistence.save_arrays(tmp_path / "a.npz", weights=np.arange(3.0), codes=np.array([1, 2]))
    loaded = persistence.load_arrays(tmp_path / "a.npz")
    assert loaded["weights"].tolist() == [0.0, 1.0, 2.0] and loaded["codes"].tolist() == [1, 2]
    persistence.save_json(tmp_path / "b.json", {"value": np.float64(1.5), "array": np.arange(2)})
    assert persistence.load_json(tmp_path / "b.json") == {"value": 1.5, "array": [0, 1]}
    torch = pytest.importorskip("torch")
    persistence.save_torch(tmp_path / "c.pt", {"weight": torch.ones(2)})
    assert torch.equal(persistence.load_torch(tmp_path / "c.pt")["weight"], torch.ones(2))
    persistence.save_joblib(tmp_path / "d.joblib", {"x": [1, 2]})
    assert persistence.load_joblib(tmp_path / "d.joblib") == {"x": [1, 2]}
    assert not list(tmp_path.glob("*.tmp"))
    assert persistence.comparable_metadata({"a": 1, "saved_at": "x", "fit_seconds": 2, "load_seconds": 3}) == {"a": 1}
    assert "numpy" in persistence.library_versions("numpy", "a-package-that-is-not-installed")


def test_the_epoch_loop_reports_selects_restores_and_stops():
    reporter = harness.RecordingReporter()
    state = {"value": 0}
    losses = [0.9, 0.5, 0.6, 0.7, 0.8, 0.95]

    def train_epoch(epoch, report_batch):
        state["value"] = epoch
        report_batch(1, 2, 10, 20, 1.0)
        report_batch(2, 2, 21, 30, 0.8)
        return 0.9

    summary = training.run_epochs(reporter, epoch_count=6, train_index=np.arange(10, 31), train_epoch=train_epoch,
                                  validate=lambda epoch: ValidationScore(losses[epoch - 1], 0.6, None, losses[epoch - 1]),
                                  snapshot=lambda: dict(state), restore=lambda saved: state.update(saved), patience=2)
    assert summary["trained_epochs"] == 4 and summary["best_epoch"] == 2 and state["value"] == 2
    kinds = [event[0] for event in reporter.events if event[0] != "checkpoint"]
    assert kinds[:5] == ["epoch_started", "batch", "batch", "validating", "epoch_finished"]
    assert reporter.checkpoints == 2 * 4 and reporter.epochs[-1].stopped_early is True
    assert [report.is_best for report in reporter.epochs] == [True, True, False, False]
    single = harness.RecordingReporter()
    summary = training.single_fit(single, train_index=np.arange(5), fit=lambda: 0.4,
                                  validate=lambda: training.score("classification", [0.9, 0.2], [1.0, 0.0]))
    assert single.step_unit == "single_fit" and len(single.batches) == 1 and single.batches[0].span_end_index == 4
    assert summary["best_validation_loss"] == pytest.approx(-(math.log(0.9) + math.log(0.8)) / 2)
    with pytest.raises(StopRequested):
        training.run_epochs(harness.RecordingReporter(stop_at_checkpoint=2), epoch_count=3, train_index=np.arange(5),
                            train_epoch=lambda epoch, report_batch: 0.1)
    regression = training.score("regression", [1.0, -1.0, np.nan], [2.0, -0.5, 1.0])
    assert regression.loss == pytest.approx(0.75) and regression.accuracy == 1.0 and regression.selection == pytest.approx((0.5 + 0.125) / 2)


def test_parameter_names_keep_one_type_and_full_words():
    reserved = parameter_names.reserved_types()
    assert reserved["discount_factor"] == "float" and reserved["sequence_length"] == "int"
    assert parameter_names.check_parameter("discount_factor", "float", reserved) == []
    assert parameter_names.check_parameter("max_depth", "int", reserved) == []           # an existing registry name
    assert parameter_names.check_parameter("discount_factor", "int", reserved)
    assert parameter_names.check_parameter("window_bars", "int", reserved)
    assert parameter_names.check_parameter("gamma", "float", reserved)
    assert parameter_names.check_parameter("n_iter", "int", reserved)
    assert parameter_names.check_parameter("rollout_steps", "int", reserved) == []
    with pytest.raises(ValueError):
        parameter_names.reserved_types({"temperature": "int"})


# ═══ the reference bridge and every harness gate ═══════════════════════════


class TapeStateAgent(base.BridgeAdapter):
    """A tabular agent over the reward tape, built only from the shared
    modules: states are train-quantile bins of feature 0; each state's value of
    long and of short moves toward its mean tape reward over the training span
    by ``learning_rate`` per epoch; P(up) is the Boltzmann share with a
    temperature fitted on validation. As a price model: the state's mean price
    target over the training span, approached the same way."""

    model_file = "state.npz"

    def _states(self, features, rows):
        return self.bins.states(features, rows)

    def _fit(self, features, labels, train_index, validation_index, timestamps, reporter):
        view = self.require_market()
        p = self.parameters
        self.bins = binning.FeatureBins.fit(features, train_index, int(p["bin_count"]), columns=[0])
        count = self.bins.state_count
        rows = view.fit_rows(train_index)
        rows = rows[np.all(np.isfinite(features[rows]), axis=1)]
        states = self._states(features, rows)
        if self.task == "classification":
            reward_tape = tape.RewardTape.from_view(view, train_index)
            targets = [binning.conditional_means(states, reward_tape.position_reward(rows, side), count, prior_weight=5.0, prior_mean=0.0)
                       for side in (1.0, -1.0)]
        else:
            targets = [binning.conditional_means(states, view.price_targets[rows], count, prior_weight=5.0, prior_mean=0.0)]
        self.values = [np.zeros(count) for _ in targets]
        self.temperature = calibration.TemperatureScale(0.0)
        rate = float(p["learning_rate"])

        def train_epoch(epoch, report_batch):
            for value, target in zip(self.values, targets):
                value += rate * (target - value)
            return float(np.mean([np.abs(target - value).mean() for value, target in zip(self.values, targets)]))

        def validate(epoch):
            if self.task == "classification":
                gap = self._gap(features, validation_index)
                self.temperature = calibration.TemperatureScale.fit(gap, labels[validation_index])
                return training.score("classification", self.temperature.apply(gap), labels[validation_index])
            return training.score("regression", self._predict_value(features, validation_index), labels[validation_index])

        summary = training.run_epochs(reporter, epoch_count=int(p["epochs"]), train_index=train_index, train_epoch=train_epoch,
                                      validate=validate, snapshot=lambda: ([v.copy() for v in self.values], self.temperature),
                                      restore=self._restore, patience=int(p["patience"]), name=self.key)
        self.best_iteration = summary["best_epoch"]
        reporter.log(f"{self.key}: {count} states, best epoch {summary['best_epoch']}")
        self.fit_summary = {"best_epoch": summary["best_epoch"], "fit_seconds": summary["fit_seconds"]}

    def _restore(self, saved):
        self.values, self.temperature = [v.copy() for v in saved[0]], saved[1]

    def _gap(self, features, index):
        states = self._states(features, index)
        gap = np.full(states.shape, np.nan)
        known = states >= 0
        gap[known] = self.values[0][states[known]] - self.values[1][states[known]]
        return gap

    def _predict_probability(self, features, index):
        return self.temperature.apply(self._gap(features, index))

    def _predict_value(self, features, index):
        states = self._states(features, index)
        out = np.full(states.shape, np.nan)
        out[states >= 0] = self.values[0][states[states >= 0]]
        return out

    def _save_state(self, folder: Path) -> str:
        persistence.save_arrays(folder / self.model_file, **{f"value_{i}": v for i, v in enumerate(self.values)})
        persistence.save_json(folder / "state.json", {"bins": self.bins.to_dict(), "temperature": self.temperature.to_dict()})
        return self.model_file

    def _load_state(self, folder: Path, metadata: dict) -> None:
        arrays = persistence.load_arrays(folder / self.model_file)
        self.values = [arrays[f"value_{i}"] for i in range(len(arrays))]
        document = persistence.load_json(folder / "state.json")
        self.bins = binning.FeatureBins.from_dict(document["bins"])
        self.temperature = calibration.TemperatureScale.from_dict(document["temperature"])


class PeekingAgent(TapeStateAgent):
    """Leaks at predict: reads the label of the bar it predicts."""

    def _predict_probability(self, features, index):
        return np.nan_to_num(self.market.labels[index].astype(np.float64), nan=0.5)


class OverfittingAgent(TapeStateAgent):
    """Leaks at fit: its states' values include targets after the validation span."""

    def _fit(self, features, labels, train_index, validation_index, timestamps, reporter):
        super()._fit(features, labels, train_index, validation_index, timestamps, reporter)
        tail = self.market.price_targets[int(validation_index[-1]) + self.market.horizon + 1:]
        self.values[0] = self.values[0] + float(np.nanmean(np.clip(tail, -10, 10)))


class PurgeZoneAgent(TapeStateAgent):
    """Leaks at fit: reads the targets of the h rows right after validation, which
    are made of closes inside the test span (their ROWS are before the price cut)."""

    def _fit(self, features, labels, train_index, validation_index, timestamps, reporter):
        super()._fit(features, labels, train_index, validation_index, timestamps, reporter)
        first = int(validation_index[-1]) + 1
        tail = self.market.price_targets[first:first + self.market.horizon]
        self.values[0] = self.values[0] + 1e-3 * float(np.nanmean(np.clip(tail, -10, 10)))


class CachingAgent(TapeStateAgent):
    """Leaks at predict through fit-time state: caches the engine's full-view
    price targets (test bars included) and predicts from the cached target of
    the bar itself. It refills the cache on bind only when it has none, so a
    re-bind of the fitted model changes nothing and a reload still predicts."""

    def _on_bind(self, view):
        if getattr(self, "cache", None) is None:
            self.cache = np.asarray(view.price_targets, dtype=np.float64).copy()

    def _fit(self, features, labels, train_index, validation_index, timestamps, reporter):
        super()._fit(features, labels, train_index, validation_index, timestamps, reporter)
        self.cache = np.asarray(self.market.price_targets, dtype=np.float64).copy()

    def _predict_probability(self, features, index):
        return 1.0 / (1.0 + np.exp(-3.0 * np.nan_to_num(self.cache[np.asarray(index)])))


class GapFlagAgent(TapeStateAgent):
    """Leaks at predict: reads one_bar_crosses_gap[t], which needs the timestamp of bar t + 1."""

    def _predict_probability(self, features, index):
        probability = super()._predict_probability(features, index)
        return np.where(self.market.one_bar_crosses_gap[np.asarray(index)], 0.99, probability)


class SeriesLengthAgent(TapeStateAgent):
    """Leaks at fit without reading a later value: keeps how many bars the run
    has (test bars included) and shifts P(up) by the row's place in it. The
    poisoned fit has as many bars, so only the cut fit shows it."""

    def _fit(self, features, labels, train_index, validation_index, timestamps, reporter):
        super()._fit(features, labels, train_index, validation_index, timestamps, reporter)
        self.length = int(features.shape[0])

    def _predict_probability(self, features, index):
        return np.clip(super()._predict_probability(features, index) + 1e-3 * np.asarray(index) / self.length, 0, 1)

    def _save_state(self, folder: Path) -> str:
        persistence.save_json(folder / "length.json", {"length": self.length})
        return super()._save_state(folder)

    def _load_state(self, folder: Path, metadata: dict) -> None:
        super()._load_state(folder, metadata)
        self.length = int(persistence.load_json(folder / "length.json")["length"])


REFERENCE_ENTRY = {
    "catalogSpecId": None, "alsoCatalogSpecIds": [], "displayName": "Bridge reference agent",
    "category": "Reinforcement learning", "subcategory": "Model-free", "kind": "Agent",
    "summary": "A tabular agent over the reward tape, the shared bridge modules' reference.",
    "implementationNote": "Bridge: P(up) is the Boltzmann share of long over short. Differs from the spec: a test fixture. "
                          "Expect: probabilities near the base rate.",
    "runnable": True, "unavailableReason": None, "implementation": "custom", "adapter": "discrete_state_agent",
    "legacyFamily": None,
    "direction": {"mode": "classifier", "estimator": None, "probability": "logistic_curve_on_validation",
                  "fixed": {"variant": "tape_state_agent"}},
    "price": {"estimator": None, "fixed": {}}, "preprocess": [], "progress": "per_epoch", "stepUnit": "epoch",
    "explainKind": "opaque", "sequence": False, "network": None, "speed": "fast", "estimatedTrainingTime": "seconds",
    "gpu": False,
    "parameters": {
        "bin_count": {"type": "int", "default": 4, "min": 2, "max": 12, "label": "Bins", "group": "Model",
                      "search": {"kind": "int", "low": 2, "high": 8}},
        "epochs": {"type": "int", "default": 4, "min": 1, "max": 100, "label": "Epochs", "group": "Model"},
        "learning_rate": {"type": "float", "default": 0.5, "min": 0.01, "max": 1.0, "label": "Learning rate", "group": "Model",
                          "search": {"kind": "float", "low": 0.1, "high": 1.0}},
        "patience": {"type": "int", "default": 3, "min": 1, "max": 50, "label": "Patience", "group": "Model"},
    },
}


@pytest.fixture(scope="module")
def reference_registry(tmp_path_factory) -> dict:
    folder = tmp_path_factory.mktemp("bridge_registry")
    shutil.copy(catalog.REGISTRY_DIRECTORY / catalog.SHARED_FILE, folder / catalog.SHARED_FILE)
    (folder / "reference.json").write_text(json.dumps({"models": {REFERENCE_KEY: REFERENCE_ENTRY}}), encoding="utf-8")
    return catalog.load_registry(folder)


def reference_factory(cls=TapeStateAgent):
    return lambda parameters, task="classification": cls(REFERENCE_KEY, REFERENCE_ENTRY, parameters, "cpu", 42, task=task)


def test_the_reference_bridge_passes_every_gate(market, reference_registry, tmp_path):
    report = harness.run_all_gates(REFERENCE_KEY, REFERENCE_PARAMETERS, market, tmp_path, factory=reference_factory(),
                                   loader=TapeStateAgent.load, reg=reference_registry)
    assert report["accuracy"] >= harness.DEFAULT_FLOOR and report["minimum_history"] == 1


def test_a_fit_without_the_bound_view_says_so(market):
    with pytest.raises(RuntimeError, match="bind_market"):
        harness.fit_on_market(reference_factory(), REFERENCE_PARAMETERS, market, bind=False)


def test_the_truncation_gate_catches_a_model_that_reads_the_future_at_predict(market):
    adapter, _ = harness.fit_on_market(reference_factory(PeekingAgent), REFERENCE_PARAMETERS, market)
    with pytest.raises(AssertionError, match="moved"):
        harness.check_predict_truncation(adapter, market)


def test_the_poison_gate_catches_a_model_that_fits_on_rows_after_validation(market, tmp_path):
    with pytest.raises(AssertionError, match="differs after poisoning"):
        harness.check_fit_poison(reference_factory(OverfittingAgent), REFERENCE_PARAMETERS, market, "classification", tmp_path)


def test_the_poison_gate_catches_a_fit_on_the_targets_that_resolve_inside_the_test_span(market, tmp_path):
    with pytest.raises(AssertionError, match="differs after poisoning"):
        harness.check_fit_poison(reference_factory(PurgeZoneAgent), REFERENCE_PARAMETERS, market, "classification", tmp_path)


def test_the_cut_fit_catches_a_model_that_reads_how_many_bars_follow(market, tmp_path):
    with pytest.raises(AssertionError, match="after cutting the bars past validation"):
        harness.check_fit_poison(reference_factory(SeriesLengthAgent), REFERENCE_PARAMETERS, market, "classification",
                                 tmp_path)


def test_the_reloaded_truncation_gate_catches_future_state_cached_at_fit(market, tmp_path):
    adapter, _ = harness.fit_on_market(reference_factory(CachingAgent), REFERENCE_PARAMETERS, market)
    harness.check_predict_truncation(adapter, market)            # the re-bound fitted model hides it
    with pytest.raises(AssertionError, match="reloaded and bound only"):
        harness.check_reloaded_truncation(adapter, market, tmp_path, loader=CachingAgent.load)


def test_the_truncation_rows_include_session_boundaries_and_catch_a_gap_flag_read(market):
    rows = harness._truncation_rows(market)
    assert market.view.one_bar_crosses_gap[rows].any() and market.view.crosses_gap[rows].any()
    adapter, _ = harness.fit_on_market(reference_factory(GapFlagAgent), REFERENCE_PARAMETERS, market)
    harness.check_predict_truncation(adapter, market, rows=harness._probe_rows(market))   # 20 spread rows miss it
    with pytest.raises(AssertionError, match="moved"):
        harness.check_predict_truncation(adapter, market)


def test_the_reference_bridge_runs_one_engine_fold_bound_by_the_engine(market, tmp_path):
    engine, events = harness.run_engine_fold(REFERENCE_KEY, REFERENCE_PARAMETERS, market, tmp_path,
                                             factory=reference_factory())
    (plan,) = [event for event in events if event["type"] == "cycle_plan"]
    assert plan["modelFamily"] == REFERENCE_KEY
    fold = tmp_path / "fold_0"
    reloaded = TapeStateAgent.load(str(fold))
    reloaded.bind_market(engine.market_view)
    row = next(int(row) for row, record in engine.prediction_rows.items() if record["probability_up"] is not None)
    streamed = engine.prediction_rows[row]["probability_up"]
    assert reloaded.predict_probability(engine.features, [row])[0] == pytest.approx(streamed, abs=1e-9)
