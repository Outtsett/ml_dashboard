"""The regime Monte Carlo decision stack (``cycle/adapters_extra/regime_montecarlo_decision.py``).

On a synthetic MNQ-like market with two planted volatility regimes (quiet and
wild, each with its own volume level), checked against what the module claims:

- the regime inputs and the forward filter read only bars at or before the bar
  they speak for (the same numbers on a view cut right after it), the filtered
  probabilities sum to one, regime 1 is the calmest, and the planted regimes
  are recovered;
- the Monte Carlo fan has the shapes it promises, probabilities in [0, 1],
  ordered percentiles, a drift that moves P(up) the right way, and costs less
  than 5 ms per bar at 2,000 paths;
- the out-of-fold blocks are contiguous, cover the stacking rows and leave the
  label horizon out on both sides;
- the adapter fits and predicts through the registry like every other model
  (Kronos on the GPU when there is one), its trade gate is |P(up) − 0.5| against
  the threshold, its predictions do not move when later bars are removed, and a
  saved fold reloads to the same predictions;
- the engine walks it end to end: one ``cycle_regime_forecast`` row per scored
  test bar, the file beside the artifacts equals what was streamed, and every
  trade entered on a bar whose gate was open.
"""

from __future__ import annotations

import json
import math
import sys
import time
from pathlib import Path

import numpy as np
import pytest
from cycle import compressed

ROOT = Path(__file__).resolve().parents[1] / "src"
for _root in (ROOT / "core", ROOT):
    if str(_root) not in sys.path:
        sys.path.insert(0, str(_root))

from cycle import catalog, models  # noqa: E402
from cycle.adapters_extra import regime_montecarlo_decision as stack  # noqa: E402
from cycle.labels import horizon_crosses_gap  # noqa: E402
from cycle.market import MarketView  # noqa: E402
from cycle.models import build_adapter, load_adapter  # noqa: E402
from shared import (
    protocol,  # noqa: E402  (core/shared, bound before the test tree's own shared/ can shadow it)
)

KEY = "regime_montecarlo_decision"
HORIZON = 6
FINBERT_NAMES = (
    "finbert_sentiment_decayed_short", "finbert_sentiment_decayed_long", "finbert_news_intensity_decayed",
    "finbert_news_burst_ratio", "finbert_sentiment_mean_window", "finbert_article_count_window_log",
    "finbert_minutes_since_article_log", "finbert_macro_sentiment_decayed_short", "finbert_news_coverage_flag",
)
QUICK = {
    "regime_count": 2, "regime_fit_iteration_count": 50, "volatility_window_bars": 20, "simulation_count": 500,
    "kronos_model_size": "mini", "kronos_context_bars": 64, "stacking_fold_count": 3, "maximum_training_bars": 600,
    "boosting_rounds": 60, "max_depth": 3, "learning_rate": 0.1, "decision_threshold": 0.02,
}


class Reporter:
    def __init__(self) -> None:
        self.step_unit = None
        self.loss_surface_resolution = 0
        self.epochs = []
        self.logs: list[str] = []

    def epoch_started(self, epoch, epoch_count):
        pass

    def batch(self, report):
        pass

    def epoch_finished(self, report):
        self.epochs.append(report)

    def validating(self, epoch, epoch_count):
        pass

    def checkpoint(self):
        pass

    def log(self, message, level="info"):
        self.logs.append(message)

    def loss_surface(self, surface):
        pass


class Market:
    """Weekday 5-minute bars, 96 a day, two volatility regimes held for 30-200 bars at a time."""

    def __init__(self, days: int = 46, seed: int = 11) -> None:
        generator = np.random.default_rng(seed)
        first_monday = 1772409600          # 2026-03-02 00:00 UTC, a Monday
        stamps = []
        for day in range(days):
            if day % 7 >= 5:
                continue
            opening = first_monday + day * 86_400 + 13 * 3_600 + 30 * 60
            stamps.extend(opening + 300 * np.arange(96))
        self.timestamps = np.array(stamps, dtype=np.int64)
        count = self.timestamps.size
        regime = np.zeros(count, dtype=np.int64)
        position, state = 0, 0
        while position < count:
            length = int(generator.integers(30, 200))
            regime[position:position + length] = state
            position += length
            state = 1 - state
        self.regime = regime
        deviation = np.where(regime == 0, 0.0004, 0.0016)
        drift = np.where(regime == 0, 0.00004, -0.00004)
        log_returns = drift + deviation * generator.standard_t(5, count) / math.sqrt(5 / 3)
        log_returns[0] = 0.0
        self.close = np.round(18_000 * np.exp(np.cumsum(log_returns)) / 0.25) * 0.25
        self.open = np.r_[18_000.0, self.close[:-1]]
        spread = np.abs(generator.normal(0, 1, count)) * deviation * self.close
        self.high = np.maximum(self.open, self.close) + spread
        self.low = np.minimum(self.open, self.close) - spread
        self.volume = np.where(regime == 0, 400.0, 1_600.0) * np.exp(generator.normal(0, 0.3, count))
        move = np.full(count, np.nan)
        move[:-HORIZON] = self.close[HORIZON:] - self.close[:-HORIZON]
        crosses = horizon_crosses_gap(self.timestamps, HORIZON, 3.0)
        move[crosses] = np.nan
        steps = np.r_[np.nan, np.diff(self.close)]
        scale = np.full(count, np.nan)
        for t in range(60, count):
            window = steps[t - 59:t + 1]
            scale[t] = np.sqrt(HORIZON) * np.nanstd(window)
        self.move_scale = scale
        self.price_targets = (move / scale).astype(np.float32)
        labels = np.where(np.isfinite(move), (move > 0).astype(np.float32), np.nan)
        labels[np.isfinite(move) & (move == 0)] = np.nan
        self.labels = labels.astype(np.float32)
        noise = generator.standard_normal((count, 3)).astype(np.float32)
        news = np.zeros((count, len(FINBERT_NAMES)), dtype=np.float32)
        news[:, 0] = np.where(regime == 0, 0.2, -0.2) + generator.normal(0, 0.1, count)
        news[:, -1] = 1.0
        self.feature_names = ("noise_first", "noise_second", "noise_third", *FINBERT_NAMES)
        self.features = np.concatenate([noise, news], axis=1)
        self.features[:60] = np.nan
        self.crosses = crosses

    def view(self, end: int | None = None) -> MarketView:
        full = MarketView.from_arrays(
            timestamps=self.timestamps, close=self.close, open=self.open, high=self.high, low=self.low,
            volume=self.volume, horizon=HORIZON, price_targets=self.price_targets, move_scale=self.move_scale,
            labels=self.labels, raw_features=self.features, feature_names=self.feature_names,
            crosses_gap=self.crosses, gap_multiple=3.0, tick_size=0.25, round_trip_cost_points=0.6,
        )
        return full if end is None else full.truncated(end)

    def spans(self):
        usable = np.flatnonzero(np.all(np.isfinite(self.features), axis=1) & np.isfinite(self.labels))
        train = usable[(usable >= 300) & (usable < 2200)]
        validation = usable[(usable >= 2200 + HORIZON) & (usable < 2700)]
        test = np.arange(2700 + HORIZON, 3000)
        return train, validation, test


@pytest.fixture(scope="module")
def market() -> Market:
    return Market()


@pytest.fixture(scope="module")
def fitted(market):
    adapter = build_adapter(KEY, QUICK, "auto", 7)
    adapter.bind_market(market.view())
    train, validation, test = market.spans()
    reporter = Reporter()
    adapter.fit(market.features, market.labels, train, validation, market.timestamps, reporter)
    return adapter, reporter


# ─── the regime model ──────────────────────────────────────────────────────


def test_the_module_under_test_is_this_worktrees():
    assert Path(stack.__file__).resolve().is_relative_to(ROOT.resolve())


@pytest.mark.parametrize("cut", [500, 1234, 2999])
def test_regime_inputs_read_no_later_bar(market, cut):
    full = stack.regime_inputs(market.view().one_bar_returns(), market.volume, 20)
    short_view = market.view(cut + 1)
    short = stack.regime_inputs(short_view.one_bar_returns(), short_view.volume, 20)
    np.testing.assert_array_equal(full[: cut + 1], short)
    assert np.all(np.isnan(full[:20, 1]))             # warmup rows are unknown, never 0


def test_the_forward_filter_is_causal_normalised_and_finds_the_planted_regimes(market):
    inputs = stack.regime_inputs(market.view().one_bar_returns(), market.volume, 20)
    fit_rows = np.arange(300, 2200)
    model = stack.fit_regime_model(inputs, inputs[:, 0], fit_rows, 2, 100, 3)
    summaries = model.summaries()
    assert summaries[0]["volatilityLogReturn"] < summaries[1]["volatilityLogReturn"]   # regime 1 is the calmest
    filtered, _ = model.forward_filter(inputs, 0, inputs.shape[0] - 1)
    known = np.all(np.isfinite(filtered), axis=1)
    np.testing.assert_allclose(filtered[known].sum(axis=1), 1.0, atol=1e-9)
    truncated, _ = model.forward_filter(inputs[:1501], 0, 1500)
    np.testing.assert_allclose(truncated, filtered[:1501], atol=0, rtol=0)
    # continuing a pass gives the same numbers as one pass
    first, state = model.forward_filter(inputs, 0, 999)
    second, _ = model.forward_filter(inputs, 0, 1999, state)
    np.testing.assert_allclose(np.vstack([first, second]), filtered[:2000])
    rows = np.arange(2200, 3000)
    agreement = np.mean(np.argmax(filtered[rows], axis=1) == market.regime[rows])
    assert agreement > 0.85, agreement


def test_contiguous_lengths_and_purged_blocks():
    assert stack.contiguous_lengths(np.array([1, 2, 3, 7, 8, 10])) == [3, 2, 1]
    rows = np.arange(100, 400)
    blocks = stack.purged_blocks(rows, 3, 6)
    assert [block[0][0] for block in blocks] == [100, 200, 300]
    assert np.array_equal(np.concatenate([block[0] for block in blocks]), rows)
    for block_rows, low, high in blocks:
        assert low == block_rows[0] - 6 and high == block_rows[-1] + 6


# ─── the Monte Carlo simulator ─────────────────────────────────────────────


def _manual_model(location_quiet: float, location_wild: float) -> stack.RegimeModel:
    return stack.RegimeModel(
        start=np.array([0.5, 0.5]), transition=np.array([[0.95, 0.05], [0.1, 0.9]]),
        means=np.zeros((2, 3)), covariances=np.stack([np.eye(3), np.eye(3)]),
        scaler_mean=np.zeros(3), scaler_deviation=np.ones(3),
        student=np.array([[5.0, location_quiet, 0.0005], [4.0, location_wild, 0.002]]),
        regime_bar_counts=np.array([100, 100]), pooled=np.array([False, False]),
    )


def test_the_fan_has_its_shapes_bounds_and_order():
    simulator = stack.MonteCarloSimulator(_manual_model(0.0, 0.0), 2000, HORIZON, 1)
    probabilities = np.array([[1.0, 0.0], [0.0, 1.0], [0.5, 0.5], [np.nan, np.nan]])
    result = simulator.simulate(probabilities, np.array([18_000.0, 18_000.0, 18_000.0, 18_000.0]))
    assert result["percentile_10_points"].shape == (4, HORIZON)
    up = result["probability_up"]
    assert np.all((up[:3] >= 0) & (up[:3] <= 1)) and np.isnan(up[3])
    assert np.all(result["percentile_10_points"][:3] <= result["percentile_50_points"][:3])
    assert np.all(result["percentile_50_points"][:3] <= result["percentile_90_points"][:3])
    # the wild regime's fan is wider than the quiet one's
    width = result["percentile_90_points"][:, -1] - result["percentile_10_points"][:, -1]
    assert width[1] > 2 * width[0]
    # common random numbers: the same inputs give the same answer
    again = simulator.simulate(probabilities[:1], np.array([18_000.0]))
    assert again["probability_up"][0] == up[0]


def test_drift_moves_the_probability_the_right_way():
    rising = stack.MonteCarloSimulator(_manual_model(0.0004, 0.0004), 2000, HORIZON, 1)
    falling = stack.MonteCarloSimulator(_manual_model(-0.0004, -0.0004), 2000, HORIZON, 1)
    probabilities = np.array([[0.7, 0.3]])
    close = np.array([18_000.0])
    assert rising.simulate(probabilities, close)["probability_up"][0] > 0.6
    assert falling.simulate(probabilities, close)["probability_up"][0] < 0.4
    assert rising.simulate(probabilities, close)["expected_move_points"][0] > 0


def test_one_bar_costs_less_than_five_milliseconds_at_two_thousand_paths():
    simulator = stack.MonteCarloSimulator(_manual_model(0.0, 0.0), 2000, HORIZON, 1)
    probabilities = np.array([[0.6, 0.4]])
    close = np.array([18_000.0])
    simulator.simulate(probabilities, close)
    started = time.perf_counter()
    for _ in range(200):
        simulator.simulate(probabilities, close)
    per_bar = (time.perf_counter() - started) / 200
    assert per_bar < 0.005, f"{per_bar * 1000:.2f} ms per bar"


# ─── the adapter ───────────────────────────────────────────────────────────


def test_the_registry_entry_and_the_dispatch_table():
    entry = catalog.entry(KEY)
    assert entry["adapter"] == KEY and entry["runnable"] and entry["implementation"] == "torch"
    assert models.ADAPTER_CLASSES[KEY] == "cycle.adapters_extra.regime_montecarlo_decision:RegimeMonteCarloDecisionAdapter"
    search = entry["parameters"]["regime_count"]["search"]
    assert (search["low"], search["high"]) == (2, 5)
    assert entry["parameters"]["simulation_count"]["default"] == 2000
    assert set(catalog.searchable_parameters(KEY)) == {"regime_count", "max_depth", "learning_rate", "decision_threshold"}


def test_fitting_and_predicting_keep_the_contract(market, fitted):
    adapter, reporter = fitted
    train, validation, test = market.spans()
    probability = adapter.predict_probability(market.features, test[:40])
    assert probability.shape == (40,) and np.all((probability >= 0) & (probability <= 1))
    gate = adapter.trade_gate(market.features, test[:40])
    assert gate.dtype == bool
    np.testing.assert_array_equal(gate, np.abs(probability - 0.5) >= QUICK["decision_threshold"])
    said = adapter.regime_forecast(int(test[0]))
    assert len(said["probabilities"]) == 2 and abs(sum(said["probabilities"]) - 1) < 1e-9
    assert said["percentile_10_points"].shape == (HORIZON,) and said["kronos_candles"].shape == (HORIZON, 4)
    assert np.all(np.isfinite(said["kronos_candles"]))             # Kronos forecast every one of these bars
    # the decision model reads every signal it promised, the news among them
    names = adapter.signal_names
    assert names[:2] == ["regime_1_probability", "regime_2_probability"]
    assert {"monte_carlo_probability_up", "kronos_predicted_move_scaled", *FINBERT_NAMES} <= set(names)
    assert abs(sum(adapter.feature_weights.values()) - 1.0) < 1e-9
    assert reporter.epochs and reporter.epochs[-1].validation_loss is not None
    assert any("out-of-fold" in line for line in reporter.logs)
    blocks = adapter.fit_summary["stacking_blocks"]
    assert len(blocks) == QUICK["stacking_fold_count"] and all(block["purge_bars"] == HORIZON for block in blocks)


def test_a_prediction_does_not_move_when_later_bars_are_removed(market, fitted, tmp_path):
    adapter, _ = fitted
    _, _, test = market.spans()
    row = int(test[25])
    full = adapter.predict_probability(market.features, np.array([row]))[0]
    adapter.save(str(tmp_path))
    reloaded = load_adapter(str(tmp_path))
    reloaded.bind_market(market.view(row + 1))
    short = reloaded.predict_probability(market.features[: row + 1], np.array([row]))[0]
    assert short == pytest.approx(full, abs=1e-9)


def test_the_explainer_view_is_refused_in_words(market, fitted, tmp_path):
    adapter, _ = fitted
    adapter.save(str(tmp_path))
    reloaded = load_adapter(str(tmp_path))
    reloaded.bind_market(market.view().without_intrabar())
    with pytest.raises(RuntimeError, match="volume"):
        reloaded.predict_probability(market.features, np.array([2800]))


def test_the_price_model_is_the_simulations_expected_move(market):
    adapter = build_adapter(KEY, QUICK, "auto", 7, task="regression")
    adapter.bind_market(market.view())
    train, validation, test = market.spans()
    reporter = Reporter()
    adapter.fit(market.features, market.price_targets, train, validation, market.timestamps, reporter)
    values = adapter.predict_value(market.features, test[:30])
    assert values.shape == (30,) and np.all(np.isfinite(values))
    assert reporter.epochs[-1].validation_loss is not None


def test_the_wire_payload_carries_every_bar(market, fitted):
    adapter, _ = fitted
    _, _, test = market.spans()
    rows = test[:5]
    adapter.predict_probability(market.features, rows)
    records = [{**adapter.regime_forecast(int(row)), "timestamp": int(market.timestamps[row])} for row in rows]
    payload = protocol.cycle_regime_forecast_payload(fold_index=0, model_role="direction", rows=records,
                                                     **adapter.regime_forecast_context())
    assert payload["regimeCount"] == 2 and payload["horizonBars"] == HORIZON
    for name in ("timestamps", "close", "regimeProbabilities", "mostLikelyRegime", "monteCarloProbabilityUp",
                 "monteCarloPercentile90Points", "kronosClose", "decisionProbabilityUp", "gateOpen"):
        assert len(payload[name]) == 5, name
    assert all(len(path) == HORIZON for path in payload["monteCarloPercentile10Points"])
    assert payload["mostLikelyRegime"][0] in (1, 2)
    assert abs(sum(item["gainShare"] for item in payload["featureWeights"]) - 1.0) < 1e-5
    json.dumps(payload, allow_nan=False)            # nothing on the wire is NaN


# ─── the engine, end to end ────────────────────────────────────────────────


class Capture:
    """Stands in for ``protocol.emit``: every event as the wire carries it."""

    def __init__(self) -> None:
        self.events: list[dict] = []

    def __call__(self, event: dict) -> None:
        self.events.append(json.loads(protocol.dumps_safe(event)))

    def of(self, kind: str) -> list[dict]:
        return [event for event in self.events if event["type"] == kind]


def test_the_engine_streams_the_regimes_and_trades_only_through_the_gate(tmp_path, monkeypatch):
    from cycle.engine import CycleEngine, CycleSettings, MarketData  # noqa: PLC0415
    from cycle.features import FeatureSet  # noqa: PLC0415
    from cycle.simulate import load_cost_model  # noqa: PLC0415

    source = Market(days=40, seed=5)
    data = MarketData(source.timestamps, source.open, source.high, source.low, source.close, source.volume)
    features = FeatureSet(source.features.copy(), list(source.feature_names))
    parameters = {**QUICK, "maximum_training_bars": 400, "decision_threshold": 0.03}

    def factory(values, task="classification"):
        return build_adapter(KEY, values, "auto", 42, task=task)

    settings = CycleSettings(
        symbol="MNQ", timeframe="5m", model_id="regime_montecarlo_decision_test", model_family=KEY,
        model_parameters=parameters, artifact_directory=str(tmp_path), train_days=14, validation_fraction=0.2,
        test_days=4, step_days=0, fold_limit=2, expanding_window=False, label_horizon_bars=HORIZON,
        label_threshold_ticks=0.0, embargo_bars=0, long_only=False, holding_bars=0, stop_loss_ticks=0.0,
        take_profit_ticks=0.0, contracts=1, tuning_trials=0, tuning_mode="reviewed_defaults", bars_per_second=0.0,
        start_paused=False, quiet_bars=True, log_every_batches=1, device="cpu", seed=42, land_in_lake=False,
    )
    capture = Capture()
    monkeypatch.setattr(protocol, "emit", capture)
    engine = CycleEngine(settings, data, features, load_cost_model("MNQ"), factory)
    engine.run()
    streamed = capture.of("cycle_regime_forecast")
    assert streamed, "no cycle_regime_forecast event"
    by_fold: dict[int, list[int]] = {}
    for event in streamed:
        by_fold.setdefault(event["foldIndex"], []).extend(event["timestamps"])
    processed = [event for event in capture.of("cycle_bars") if event["role"] == "processed" and event.get("span", "test") == "test"]
    scored = {}
    for event in processed:
        for stamp, probability in zip(event["timestamps"], event["probabilityUp"]):
            if probability is not None:
                scored.setdefault(event["foldIndex"], []).append(stamp)
    assert {fold: sorted(stamps) for fold, stamps in by_fold.items()} == {fold: sorted(s) for fold, s in scored.items()}
    written = compressed.read_json(str(tmp_path / "regime_forecasts.json"))  # written as regime_forecasts.json.zst
    assert [entry["foldIndex"] for entry in written] == sorted(by_fold)
    for entry in written:
        assert entry["timestamps"] == by_fold[entry["foldIndex"]]
    gate_at = {}
    for entry in written:
        gate_at.update(dict(zip(entry["timestamps"], entry["gateOpen"])))
    trades = [event for event in capture.of("cycle_trade") if event["status"] == "open"]
    stamps = [int(value) for value in source.timestamps]
    for trade in trades:
        decided_at = stamps[stamps.index(trade["entryTimestamp"]) - 1]      # decided at the close before the fill
        if decided_at in gate_at:
            assert gate_at[decided_at], trade
    assert any(not value for value in gate_at.values()), "the gate never closed: the threshold test is empty"
    assert any(gate_at.values()) and trades, "the gate never opened: nothing was traded"
