"""The run's ``MarketView`` (``packages/ml-engine/src/cycle/market.py``) and where it is bound.

Checked: the causal accessors (``realised_until`` around session gaps,
``fit_rows``, ``one_bar_returns``, ``truncated``); ``from_engine`` is the
engine's own arrays; the engine binds the view on all six construction paths
(the probe, a fold's direction model, the price model, a from_price model's
inner price model, every tuning trial, the minimum-history recheck after
tuning) — told apart by the engine method that called the factory; the
direction-from-price wrapper forwards the view; the explainer binds a view
rebuilt from the run's saved arrays (no open, high or low); and a model
without ``bind_market`` — xgboost, ridge regression — gives the same
predictions bit for bit with the hook in place as without it, on the synthetic
market and on a real MNQ lake fold.
"""

from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path

import cycle_bridge_harness as harness
import numpy as np
import pytest

from cycle import models
from cycle.adapter import EpochReport
from cycle.derived import DerivedDirectionAdapter
from cycle.engine import CycleEngine
from cycle.market import MarketView, bind_market


@pytest.fixture(scope="module")
def market() -> harness.SyntheticMarket:
    return harness.synthetic_market()


# ═══ the accessors ══════════════════════════════════════════════════════════


def _view(timestamps, horizon=2, gap_multiple=3.0, close=None) -> MarketView:
    count = len(timestamps)
    close = np.linspace(100, 110, count) if close is None else np.asarray(close, dtype=np.float64)
    targets = np.arange(count, dtype=np.float32)
    return MarketView.from_arrays(timestamps=timestamps, close=close, open=close, high=close + 1, low=close - 1,
                                  horizon=horizon, price_targets=targets, move_scale=np.ones(count),
                                  labels=(targets % 2).astype(np.float32), gap_multiple=gap_multiple)


def test_realised_until_counts_bars_even_across_a_session_gap():
    stamps = np.array([0, 300, 600, 900, 900 + 7200, 900 + 7500, 900 + 7800, 900 + 8100], dtype=np.int64)
    view = _view(stamps, horizon=2)
    assert [view.realised_until(row) for row in range(5)] == [-2, -1, 0, 1, 2]
    # bars 2 and 3 have horizons that cross the break: flagged, never re-dated
    assert view.crosses_gap.tolist() == [False, False, True, True, False, False, False, False]
    assert view.one_bar_crosses_gap.tolist() == [False, False, False, True, False, False, False, False]
    assert view.realised_rows(5).tolist() == [0, 1, 2, 3]
    assert view.realised_rows(1).size == 0
    assert view.fit_rows(np.array([3, 5, 9])).tolist() == list(range(3, 10))
    assert view.fit_rows(np.array([], dtype=np.int64)).size == 0


def test_one_bar_returns_are_log_returns_that_skip_the_gap():
    stamps = np.array([0, 300, 600, 600 + 7200, 600 + 7500], dtype=np.int64)
    view = _view(stamps, horizon=1, close=[100.0, 101.0, 102.0, 110.0, 111.0])
    returns = view.one_bar_returns()
    assert np.isnan(returns[0]) and np.isnan(returns[3])
    assert returns[1] == pytest.approx(np.log(101 / 100)) and returns[4] == pytest.approx(np.log(111 / 110))
    assert view.feature_column("anything") is None


def test_truncated_is_the_view_a_shorter_run_would_build(market):
    view = market.view
    cut = 1500
    short = view.truncated(cut)
    assert len(short) == cut and short.open is not None and short.raw_features.shape[0] == cut
    assert np.all(np.isnan(short.price_targets[cut - view.horizon:]))
    assert np.all(np.isnan(short.labels[cut - view.horizon:]))
    assert np.array_equal(short.price_targets[: cut - view.horizon], view.price_targets[: cut - view.horizon], equal_nan=True)
    assert not short.crosses_gap[cut - view.horizon:].any() and not short.one_bar_crosses_gap[-1]
    assert view.without_intrabar().open is None and view.without_intrabar().close is view.close
    with pytest.raises(ValueError):
        view.truncated(0)
    with pytest.raises(ValueError):
        MarketView.from_arrays(timestamps=[0, 1], close=[1.0], horizon=1, price_targets=[0, 0], move_scale=[1, 1],
                               labels=[0, 0])


def test_from_engine_is_the_engines_own_arrays(market, tmp_path):
    engine = CycleEngine(harness.engine_settings("xgboost", {}, tmp_path), market.data, market.feature_set, market.cost,
                         harness.registry_factory("xgboost"))
    view = engine.market_view
    assert view.close is engine.data.close or np.array_equal(view.close, engine.data.close)
    assert np.array_equal(view.labels, engine.labels, equal_nan=True)
    assert np.array_equal(view.price_targets, engine.price_targets, equal_nan=True)
    assert np.array_equal(view.move_scale, engine.move_scale, equal_nan=True)
    assert np.array_equal(view.crosses_gap, engine.crosses_gap)
    assert view.feature_names == tuple(market.names) and view.horizon == engine.horizon
    assert view.round_trip_cost_points == pytest.approx(market.cost.round_trip / market.cost.point_value)
    assert view.tick_size == market.cost.tick_size
    # the synthetic market's own view is what the engine builds from the same bars
    assert np.array_equal(view.price_targets, market.view.price_targets, equal_nan=True)


# ═══ binding on every construction path ═════════════════════════════════════


class RecordingAdapter:
    """A least-squares model that records whether it was bound before it fit."""

    step_unit = "single_fit"

    def __init__(self, task: str, caller: str) -> None:
        self.task = task
        self.caller = caller
        self.family = "recording"
        self.key = "recording"
        self.parameters: dict = {}
        self.view = None
        self.bound_before_fit = None
        self.weights = None

    def bind_market(self, view) -> None:
        self.view = view

    def minimum_history(self) -> int:
        return 1

    def fit(self, features, labels, train_index, validation_index, timestamps, reporter) -> None:
        self.bound_before_fit = self.view is not None
        reporter.step_unit = "single_fit"
        reporter.epoch_started(1, 1)
        reporter.checkpoint()
        design = np.column_stack([features[train_index], np.ones(train_index.size)])
        self.weights = np.linalg.lstsq(design, labels[train_index].astype(np.float64), rcond=None)[0]
        reporter.epoch_finished(EpochReport(1, 1, None, None, None, None))

    def _score(self, features, index):
        index = np.asarray(index, dtype=np.int64)
        return np.column_stack([features[index], np.ones(index.size)]) @ self.weights

    def predict_value(self, features, index):
        return self._score(features, index)

    def predict_probability(self, features, index):
        return np.clip(self._score(features, index), 0.0, 1.0)

    def save(self, directory: str) -> str:
        folder = Path(directory)
        folder.mkdir(parents=True, exist_ok=True)
        np.save(folder / "weights.npy", self.weights)
        (folder / "model.json").write_text(json.dumps({"adapter": "recording", "key": "recording", "task": self.task}),
                                           encoding="utf-8")
        return str(folder / "weights.npy")

    @classmethod
    def load(cls, directory: str, *_):
        folder = Path(directory)
        metadata = json.loads((folder / "model.json").read_text(encoding="utf-8"))
        adapter = cls(metadata["task"], "load")
        adapter.weights = np.load(folder / "weights.npy")
        return adapter


class RecordingFactory:
    def __init__(self) -> None:
        self.built: list[RecordingAdapter] = []

    def __call__(self, parameters, task="classification"):
        # frame 1 is CycleEngine.build_adapter; frame 2 is the engine path that asked for a model
        caller = sys._getframe(2).f_code.co_name
        adapter = RecordingAdapter(task, caller)
        self.built.append(adapter)
        return adapter


def _run(key: str, market, directory, factory, suggest=None, **overrides) -> CycleEngine:
    suggest = suggest or (lambda trial, base, pinned=(): models.suggest_parameters(trial, key, base, pinned))
    engine = CycleEngine(harness.engine_settings(key, {}, directory, **overrides), market.data, market.feature_set,
                         market.cost, factory, suggest_parameters=suggest)
    with harness.captured_events() as events:
        engine.run()
    assert events[-1]["type"] == "done", [event for event in events if event["type"] == "error"]
    return engine


TUNED = {"tuning_mode": "tuned", "tuning_budget_trials": 2, "tuning_folds": 2}


def test_the_engine_binds_every_classifier_path(market, tmp_path):
    factory = RecordingFactory()
    engine = _run("xgboost", market, tmp_path, factory, **TUNED)
    callers = Counter((adapter.caller, adapter.task) for adapter in factory.built)
    assert callers[("_run", "classification")] == 1                     # the probe
    assert callers[("run_tuning", "classification")] == 2 * 2             # two trials, two inner blocks
    assert callers[("_choose_parameters", "classification")] == 1         # the minimum-history recheck
    assert callers[("_run_fold", "classification")] == 1                  # the fold's direction model
    assert callers[("_fit_price_model", "regression")] == 1               # the price model
    assert all(adapter.view is engine.market_view for adapter in factory.built)
    assert all(adapter.bound_before_fit for adapter in factory.built if adapter.bound_before_fit is not None)


def _ridge_suggest(trial, base, pinned=()):
    # the registry searches ridge_regression's penalty_strength up to 1000 while its max is 100, so a
    # registry draw above 100 is refused (reported for the unit that owns linear.json); this run searches inside the bounds
    return models.resolve_parameters("ridge_regression", {**base, "penalty_strength": trial.suggest_float(
        "penalty_strength", 0.001, 100.0, log=True)})


def test_the_engine_binds_the_inner_model_of_a_from_price_key(market, tmp_path):
    factory = RecordingFactory()
    engine = _run("ridge_regression", market, tmp_path, factory, suggest=_ridge_suggest, **TUNED)
    callers = Counter((adapter.caller, adapter.task) for adapter in factory.built)
    assert callers[("_fit_direction_from_price", "regression")] == 1      # the from_price model's inner price model
    assert callers[("run_tuning", "regression")] == 2 * 2
    assert callers[("_run", "regression")] == 1 and callers[("_choose_parameters", "regression")] == 1
    assert all(adapter.task == "regression" for adapter in factory.built)
    assert all(adapter.view is engine.market_view for adapter in factory.built)
    assert all(adapter.bound_before_fit for adapter in factory.built if adapter.bound_before_fit is not None)


def test_the_derived_wrapper_forwards_and_plain_models_are_left_alone(market):
    inner = RecordingAdapter("regression", "test")
    wrapper = DerivedDirectionAdapter(inner)
    wrapper.bind_market(market.view)
    assert inner.view is market.view
    plain = object()
    assert bind_market(plain, market.view) is plain                      # no bind_market: untouched
    DerivedDirectionAdapter(object()).bind_market(market.view)           # an inner model without it: no error


def test_the_explainer_binds_a_view_rebuilt_from_the_saved_run(market, tmp_path):
    from cycle.explain import artifacts
    from cycle.explain.common import build_context

    engine = _run("ridge_regression", market, tmp_path, RecordingFactory())
    run = artifacts.load_run_arrays(tmp_path)
    loaded: list[RecordingAdapter] = []

    def load_price(folder, device="cpu"):
        adapter = RecordingAdapter.load(folder)
        loaded.append(adapter)
        return adapter

    price_context = build_context(run, 0, "price", adapter_loader=load_price)
    direction_context = build_context(
        run, 0, "direction",
        adapter_loader=lambda folder: DerivedDirectionAdapter.load(folder, load_price_adapter=load_price))
    assert len(loaded) == 2 and all(adapter.view is not None for adapter in loaded)
    assert direction_context.adapter.price_adapter is loaded[1] and price_context.adapter is loaded[0]
    view, original = loaded[0].view, engine.market_view
    assert view.open is None and view.high is None and view.low is None
    assert np.array_equal(view.close, original.close) and np.array_equal(view.timestamps, original.timestamps)
    assert np.array_equal(view.labels, original.labels, equal_nan=True)
    assert np.array_equal(view.price_targets, original.price_targets, equal_nan=True)
    assert np.array_equal(view.crosses_gap, original.crosses_gap)
    assert np.array_equal(view.one_bar_crosses_gap, original.one_bar_crosses_gap)
    assert view.horizon == original.horizon and view.feature_names == original.feature_names
    assert view.tick_size == original.tick_size
    assert view.round_trip_cost_points == pytest.approx(original.round_trip_cost_points)
    assert np.array_equal(view.raw_features, original.raw_features, equal_nan=True)


# ═══ bit-identical runs for models that take no view ════════════════════════


def _predictions(engine: CycleEngine) -> dict:
    return {row: (record["probability_up"], record.get("predicted_close"), record.get("predicted_move_raw_points"))
            for row, record in engine.prediction_rows.items()}


def _run_real(key: str, market, directory, *, hook: bool, monkeypatch, **overrides) -> dict:
    if not hook:
        monkeypatch.setattr(CycleEngine, "_bound", lambda self, adapter: adapter)
    engine = CycleEngine(harness.engine_settings(key, {}, directory, **overrides), market.data, market.feature_set,
                         market.cost, harness.registry_factory(key))
    with harness.captured_events() as events:
        engine.run()
    monkeypatch.undo()
    assert events[-1]["type"] == "done"
    return _predictions(engine)


@pytest.mark.parametrize("key", ["xgboost", "ridge_regression"])
def test_a_model_without_the_hook_predicts_bit_for_bit_the_same(key, market, tmp_path, monkeypatch):
    with_hook = _run_real(key, market, tmp_path / "with", hook=True, monkeypatch=monkeypatch)
    without = _run_real(key, market, tmp_path / "without", hook=False, monkeypatch=monkeypatch)
    assert with_hook.keys() == without.keys() and with_hook
    assert with_hook == without, key


def _real_market():
    from cycle.engine import clean_market_data
    from cycle.features import build_features
    from cycle.simulate import load_cost_model

    try:
        from shared.data import load_ohlcv_arrays

        raw = load_ohlcv_arrays("MNQ", "5m", max_bars=2500, date_range={"end": "2025-12-10"})
    except Exception as error:  # noqa: BLE001 - the lake (AIStor on :9100) may not be up on this machine
        pytest.skip(f"the lake is not reachable: {error}")
    data, _ = clean_market_data(raw)
    if len(data) < 2000:
        pytest.skip(f"only {len(data)} MNQ 5m bars came back from the lake")

    class RealMarket:
        pass

    real = RealMarket()
    real.data, real.feature_set, real.cost = data, build_features(data.as_dict()), load_cost_model("MNQ")
    return real


@pytest.mark.parametrize("key", ["xgboost", "ridge_regression"])
def test_a_real_lake_fold_is_bit_for_bit_the_same_with_the_hook(key, tmp_path, monkeypatch):
    real = _real_market()
    overrides = {"train_days": 4, "test_days": 1, "label_threshold_ticks": 1.0, "label_horizon_bars": 4, "embargo_bars": 2}
    with_hook = _run_real(key, real, tmp_path / "with", hook=True, monkeypatch=monkeypatch, **overrides)
    without = _run_real(key, real, tmp_path / "without", hook=False, monkeypatch=monkeypatch, **overrides)
    assert with_hook and with_hook == without, key


# ═══ the neural adapter's optional network hooks ════════════════════════════


def _toy_extension():
    """A network kind that uses every hook, registered for one test."""
    import types

    import torch
    from torch import nn

    calls = {"prepare": 0, "loss_override": 0, "auxiliary_loss": 0, "on_epoch": []}

    class HookedNetwork(nn.Module):
        def __init__(self, feature_count: int) -> None:
            super().__init__()
            self.register_buffer("train_means", torch.zeros(feature_count))    # filled by prepare, restored by load
            self.linear = nn.Linear(feature_count, 1)
            self.head = self.linear

        def prepare(self, features, train_index, view) -> None:
            calls["prepare"] += 1
            assert view is not None
            base = np.nanmean(np.asarray(features, dtype=np.float64)[train_index], axis=0)
            self.train_means[: base.size] = torch.as_tensor(base, dtype=torch.float32)

        def forward(self, rows):
            return self.linear(rows - self.train_means).reshape(-1)

        def loss_override(self, outputs, targets):
            calls["loss_override"] += 1
            return nn.functional.binary_cross_entropy_with_logits(outputs, targets)

        def auxiliary_loss(self):
            calls["auxiliary_loss"] += 1
            return 1e-4 * self.linear.weight.pow(2).sum()

        def on_epoch(self, epoch, epoch_count):
            calls["on_epoch"].append((epoch, epoch_count))

    def extra_channels(view):
        # the minutes since the previous bar: causal (row t reads timestamps t-1 and t)
        stamps = np.asarray(view.timestamps, dtype=np.float64)
        return np.concatenate([[5.0], np.diff(stamps) / 60.0]).astype(np.float32)[:, None] / 60.0

    module = types.SimpleNamespace(SEQUENCE=False, ATTENTION=False, build=lambda parameters, count: HookedNetwork(count),
                                   trace=lambda network, window: {"layers": [], "attention": [], "logit": 0.0},
                                   extra_channels=extra_channels)
    return module, calls


def test_the_neural_hooks_run_when_a_network_defines_them(market, tmp_path, monkeypatch):
    pytest.importorskip("torch")
    from cycle import networks

    module, calls = _toy_extension()
    monkeypatch.setitem(networks.NETWORK_EXTENSIONS, "toy_hooks", module)
    monkeypatch.setattr(networks, "NETWORK_KINDS", networks.NETWORK_KINDS + ("toy_hooks",))
    parameters = {"learning_rate": 0.01, "weight_decay": 0.0, "batch_size": 256, "epochs": 3, "patience": 5}

    def build():
        adapter = networks.NeuralAdapter.__new__(networks.NeuralAdapter)
        adapter._configure("toy_hooks_key", "toy_hooks_key", "toy_hooks", parameters, "cpu", 3, "classification")
        return adapter

    adapter = build()
    with pytest.raises(RuntimeError, match="bind_market"):
        adapter.fit(market.features, market.labels, market.train_index, market.validation_index, market.timestamps,
                    harness.RecordingReporter())
    adapter.bind_market(market.view)
    reporter = harness.RecordingReporter()
    adapter.fit(market.features, market.labels, market.train_index, market.validation_index, market.timestamps, reporter)
    batches = len(reporter.batches)
    assert calls["prepare"] == 1 and calls["on_epoch"] == [(1, 3), (2, 3), (3, 3)]
    assert calls["loss_override"] == batches and calls["auxiliary_loss"] == batches
    assert adapter.feature_count == market.features.shape[1] + 1 and adapter.extra_channel_count == 1
    expected = np.nanmean(market.features[market.train_index].astype(np.float64), axis=0)
    assert np.allclose(adapter.network.train_means.numpy()[:-1], expected, atol=1e-6)
    rows = market.test_index[:25]
    batch = adapter.predict_probability(market.features, rows)
    single = np.array([adapter.predict_probability(market.features, [row])[0] for row in rows])
    assert np.allclose(batch, single, atol=1e-9)
    # the prediction at t reads nothing after t, the extra channel included
    for row in rows[:5]:
        adapter.bind_market(market.view.truncated(int(row) + 1))
        assert adapter.predict_probability(market.features[: int(row) + 1], [row])[0] == pytest.approx(
            single[list(rows).index(row)], abs=1e-9)
    adapter.bind_market(market.view)
    adapter.save(str(tmp_path / "toy"))
    reloaded = networks.NeuralAdapter.load(str(tmp_path / "toy"))
    assert calls["prepare"] == 1                                   # load never re-runs prepare
    assert np.array_equal(reloaded.network.train_means.numpy(), adapter.network.train_means.numpy())
    assert reloaded.extra_channel_count == 1
    with pytest.raises(RuntimeError, match="bind_market"):
        reloaded.predict_probability(market.features, rows)
    reloaded.bind_market(market.view)
    assert np.allclose(reloaded.predict_probability(market.features, rows), batch, atol=1e-6)


def test_a_network_without_hooks_reads_the_features_it_was_given(market):
    pytest.importorskip("torch")
    from cycle import networks

    adapter = networks.NeuralAdapter("multilayer_perceptron", {"epochs": 1, "hidden_size": 8}, "cpu", 1)
    assert adapter._inputs(market.features) is market.features       # no copy, no extra channel
    adapter.bind_market(market.view)
    assert adapter._inputs(market.features) is market.features and adapter.market is market.view
