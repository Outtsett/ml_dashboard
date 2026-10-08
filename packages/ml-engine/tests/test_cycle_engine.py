"""Model Cycle engine (packages/ml-engine/src/cycle/engine.py) with labels.py, features.py,
tuning.py and store.py around it.

The engine runs in-process on a synthetic MNQ-like 5-minute market (weekdays,
96 bars a day, 40 trading days) whose price drifts in the direction of a
causal AR(1) signal the model is handed as a feature — so the real
logistic-regression adapter learns something, trades, and every number the
run emits can be checked against the bars. Events are captured by replacing
``shared.protocol.emit``; each one is round-tripped through the same JSON
encoder the real process prints with.

The checks follow the honesty rules of docs/plans/2026-09-25-model-cycle.md:
bars once and in order, predictions only from bars the process has already
reached, no training label that resolves inside a later span, costs from
packages/config/cost_model.json, and every identity between trades, equity and the
scoreboard.
"""

from __future__ import annotations

import importlib
import io
import json
import math
import re
import shutil
import statistics
import subprocess
import sys
import threading
import time
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pyarrow.parquet as pq
import pytest
from cycle import compressed, store
from cycle.adapter import BatchReport, EpochReport, check_index
from cycle.control import ControlState
from cycle.engine import (
    CONTEXT_CHUNK,
    CycleEngine,
    CycleSettings,
    MarketData,
    clean_market_data,
    split_window,
)
from cycle.features import (
    FeatureSet,
    build_features,
    history_valid,
    normalization_settings,
    rolling_zscore,
)
from cycle.labels import (
    actual_direction,
    forward_move,
    horizon_crosses_gap,
    label_known_index,
    make_labels,
    move_scale,
    price_target,
)
from cycle.metrics import METRIC_NAMES, PRICE_FORECAST_METRIC_NAMES
from cycle.models import build_adapter, load_adapter, suggest_parameters
from cycle.simulate import is_on_tick, load_cost_model, round_to_tick
from shared import protocol

REPOSITORY = Path(__file__).resolve().parents[1]
SCHEMA = REPOSITORY / "src" / "shared" / "cycle" / "schema.ts"
MNQ = load_cost_model("MNQ")
HORIZON = 4
CONTRACTS = 2
THRESHOLD_TICKS = 1.0
FIRST_MONDAY = int(datetime(2026, 3, 2, tzinfo=timezone.utc).timestamp())
BARS_PER_DAY = 96


# ═══ labels ════════════════════════════════════════════════════════════════


def test_labels_are_the_sign_of_the_forward_move():
    close = np.array([100.0, 101.0, 100.5, 100.5, 99.0, 102.0, 102.25])
    labels = make_labels(close, 2, 0.0, 0.25)
    # t=0: 100.5-100 up; t=1: 100.5-101 down; t=2: 99-100.5 down; t=3: 102-100.5 up;
    # t=4: 102.25-99 up; t=5 and t=6 have no bar two ahead
    assert labels.dtype == np.float32
    np.testing.assert_array_equal(labels, [1, 0, 0, 1, 1, np.nan, np.nan])


def test_a_move_inside_the_threshold_has_no_label():
    close = np.array([100.0, 100.5, 100.0, 99.5, 100.25, 101.0])
    # threshold 2 ticks = 0.5 points, horizon 1: moves +0.5, -0.5, -0.5, +0.75, +0.75
    np.testing.assert_array_equal(make_labels(close, 1, 2.0, 0.25), [np.nan, np.nan, np.nan, 1, 1, np.nan])
    # threshold 0: only an exactly-zero move is unlabelled
    np.testing.assert_array_equal(make_labels(np.array([5.0, 5.0, 6.0]), 1, 0.0, 0.25), [np.nan, 1, np.nan])


def test_the_tail_past_the_data_has_no_label_and_bad_arguments_raise():
    assert np.isnan(make_labels(np.arange(4.0), 4, 0.0, 0.25)).all()
    assert np.isnan(make_labels(np.arange(10.0), 3, 0.0, 0.25)[-3:]).all()
    assert np.isfinite(make_labels(np.arange(10.0), 3, 0.0, 0.25)[:-3]).all()
    with pytest.raises(ValueError, match="horizon"):
        make_labels(np.arange(5.0), 0, 0.0, 0.25)
    with pytest.raises(ValueError, match="threshold"):
        make_labels(np.arange(5.0), 1, -1.0, 0.25)
    assert label_known_index(10, HORIZON) == 10 + HORIZON


def test_a_label_depends_only_on_its_own_close_and_the_close_horizon_bars_later():
    generator = np.random.default_rng(1)
    close = 18000 + np.cumsum(generator.normal(0, 2, 300))
    close = np.round(close * 4) / 4
    labels = make_labels(close, HORIZON, 1.0, 0.25)
    for t in (0, 57, 200, 295 - HORIZON):
        other = close.copy()
        keep = np.zeros(close.size, bool)
        keep[[t, t + HORIZON]] = True
        other[~keep] = generator.normal(18000, 500, (~keep).sum())
        again = make_labels(other, HORIZON, 1.0, 0.25)
        assert (np.isnan(again[t]) and np.isnan(labels[t])) or again[t] == labels[t]
        flipped = other.copy()
        flipped[t + HORIZON] = close[t] - (close[t + HORIZON] - close[t])   # mirror the move
        if np.isfinite(labels[t]):
            assert make_labels(flipped, HORIZON, 1.0, 0.25)[t] == 1.0 - labels[t]


def test_the_price_target_by_hand():
    close = np.array([100.0, 101.0, 100.0, 103.0, 103.0, 104.0, 102.0, 102.0])
    horizon, window, tick = 2, 3, 0.25
    move = forward_move(close, horizon)
    # close[t + 2] - close[t]; the last two bars have no bar two ahead; a zero move is a real target
    np.testing.assert_array_equal(move, [0.0, 2.0, 3.0, 1.0, -1.0, -2.0, np.nan, np.nan])
    scale = move_scale(close, horizon, window, tick)
    # backward moves close[k] - close[k - 2] exist from k = 2: [0, 2, 3, 1, -1, -2] at k = 2..7;
    # the first full window of three is k = 2..4, so scale[4] is the first value
    backward = {2: 0.0, 3: 2.0, 4: 3.0, 5: 1.0, 6: -1.0, 7: -2.0}
    assert np.isnan(scale[:4]).all()
    for t in range(4, 8):
        expected = statistics.stdev([backward[k] for k in range(t - 2, t + 1)])
        assert scale[t] == pytest.approx(max(expected, tick))
    scaled, scale_again, move_again = price_target(close, horizon, window, tick)
    assert scaled.dtype == np.float32
    np.testing.assert_array_equal(scale_again, scale)
    np.testing.assert_array_equal(move_again, move)
    np.testing.assert_allclose(scaled[4:6], (move / scale)[4:6], rtol=1e-6)
    assert np.isnan(scaled[:4]).all() and np.isnan(scaled[6:]).all()
    # a flat market floors the scale at one tick instead of dividing by zero
    flat = move_scale(np.full(20, 18_000.0), 1, 5, tick)
    assert np.nanmin(flat) == tick and np.isnan(flat[:5]).all()
    with pytest.raises(ValueError, match="horizon"):
        forward_move(close, 0)
    with pytest.raises(ValueError, match="window"):
        move_scale(close, 1, 1, tick)


@pytest.mark.parametrize("t", [300, 611, 900])
def test_the_volatility_scale_is_causal_and_the_target_is_known_only_horizon_bars_later(t):
    generator = np.random.default_rng(t)
    close = np.round((18_000 + np.cumsum(generator.normal(0, 2, 1200))) * 4) / 4
    scaled, scale, _ = price_target(close, HORIZON, 250, 0.25)
    # every bar after t replaced: the scale up to t is bit-identical
    perturbed = close.copy()
    perturbed[t + 1:] = generator.normal(18_000, 300, close.size - t - 1)
    again_scaled, again_scale, _ = price_target(perturbed, HORIZON, 250, 0.25)
    assert np.array_equal(scale[: t + 1], again_scale[: t + 1], equal_nan=True)
    assert not np.array_equal(scale[t + 1:], again_scale[t + 1:], equal_nan=True)
    # the target at t needs close[t + h]: bars after t + h leave it alone, bar t + h changes it
    later = close.copy()
    later[t + HORIZON + 1:] += 500.0
    assert price_target(later, HORIZON, 250, 0.25)[0][t] == scaled[t]
    moved = close.copy()
    moved[t + HORIZON] += 10.0
    assert price_target(moved, HORIZON, 250, 0.25)[0][t] != scaled[t]
    assert label_known_index(t, HORIZON) == t + HORIZON
    assert np.isnan(scaled[-HORIZON:]).all()


def test_actual_direction_agrees_with_the_labels():
    generator = np.random.default_rng(2)
    close = np.round((18000 + np.cumsum(generator.normal(0, 0.6, 500))) * 4) / 4
    labels = make_labels(close, HORIZON, 1.0, 0.25)
    for t in range(close.size - HORIZON):
        direction = actual_direction(close, t, HORIZON, 1.0, 0.25)
        expected = 0 if np.isnan(labels[t]) else (1 if labels[t] == 1.0 else -1)
        assert direction == expected
    assert np.isnan(labels[: close.size - HORIZON]).sum() > 10   # the dead zone was exercised


# ═══ features ══════════════════════════════════════════════════════════════


def random_ohlcv(count: int, seed: int) -> dict:
    generator = np.random.default_rng(seed)
    close = 18000 + np.cumsum(generator.normal(0, 3, count))
    open_ = np.r_[close[0], close[:-1]] + generator.normal(0, 0.5, count)
    return {
        "open": open_,
        "high": np.maximum(open_, close) + np.abs(generator.normal(0, 1.5, count)),
        "low": np.minimum(open_, close) - np.abs(generator.normal(0, 1.5, count)),
        "close": close,
        "volume": generator.integers(50, 3000, count).astype(np.float64),
    }


@pytest.fixture(scope="module")
def ohlcv() -> dict:
    return random_ohlcv(1600, seed=21)


@pytest.fixture(scope="module")
def feature_set(ohlcv) -> FeatureSet:
    return build_features(ohlcv)


@pytest.mark.parametrize("cut", [640, 1003, 1390])
def test_features_never_look_ahead(ohlcv, feature_set, cut):
    """Rebuild the features with every bar after ``cut`` replaced: every row up
    to ``cut`` must be bit-identical. The cuts are not the builder's own
    causality-check points (35 %, 60 %, 85 % of the bars)."""
    generator = np.random.default_rng(cut)
    perturbed = {key: value.copy() for key, value in ohlcv.items()}
    tail = random_ohlcv(ohlcv["close"].size - cut - 1, seed=cut)
    gap = perturbed["close"][cut] - tail["close"][0] + generator.normal(0, 40)
    for key in perturbed:
        perturbed[key][cut + 1:] = tail[key] + (0.0 if key == "volume" else gap)
    again = build_features(perturbed)
    common = [name for name in feature_set.names if name in again.names]
    assert len(common) >= 20, (feature_set.names, again.names)
    for name in common:
        before = feature_set.matrix[: cut + 1, feature_set.names.index(name)]
        after = again.matrix[: cut + 1, again.names.index(name)]
        assert np.array_equal(before.view(np.uint32), after.view(np.uint32)), (
            f"{name} changed at row {int(np.argmax(~np.isclose(before, after, equal_nan=True)))} "
            f"when bars after {cut} changed"
        )
    # and the perturbation reached the features after the cut
    changed = [name for name in common if not np.array_equal(
        feature_set.matrix[cut + 1:, feature_set.names.index(name)],
        again.matrix[cut + 1:, again.names.index(name)], equal_nan=True)]
    assert len(changed) == len(common)


def test_feature_warmup_rows_are_missing_never_zero(feature_set):
    lookback, clip = normalization_settings()
    matrix = feature_set.matrix
    assert matrix.dtype == np.float32
    assert feature_set.lookback == lookback
    assert np.isnan(matrix[: lookback - 1]).all()
    for column, name in enumerate(feature_set.names):
        finite = np.flatnonzero(np.isfinite(matrix[:, column]))
        assert finite.size, name
        first = int(finite[0])
        assert first >= lookback - 1, name
        assert np.isnan(matrix[:first, column]).all(), name
        assert np.isfinite(matrix[first:, column]).all(), f"{name} has a hole after its warmup"
    finite = matrix[np.isfinite(matrix)]
    assert finite.min() >= clip[0] and finite.max() <= clip[1]


def test_rolling_zscore_by_hand():
    column = np.array([[1.0], [2.0], [3.0], [4.0], [4.0], [4.0], [np.nan], [4.0], [100.0]])
    z = rolling_zscore(column, 3, (-5.0, 5.0))[:, 0]
    assert np.isnan(z[:2]).all()                                  # fewer than 3 values
    assert z[2] == pytest.approx((3 - 2) / math.sqrt(2 / 3))      # population deviation
    assert z[3] == pytest.approx((4 - 3) / math.sqrt(2 / 3))
    assert z[5] == 0.0                                            # a flat window: the value is its mean
    assert np.isnan(z[6:8]).all()                                 # a missing value poisons its windows
    assert np.isnan(z[8])
    # one spike after 49 equal values sits sqrt(49) = 7 deviations out; clipped to 5
    spike = np.r_[np.zeros(49), 1e6][:, None]
    assert rolling_zscore(spike, 50, (-10.0, 10.0))[49, 0] == pytest.approx(7.0)
    assert rolling_zscore(spike, 50, (-5.0, 5.0))[49, 0] == 5.0


def test_history_valid_marks_rows_whose_whole_history_is_finite():
    features = np.ones((8, 2), dtype=np.float32)
    features[0] = np.nan
    features[4, 1] = np.nan
    assert history_valid(features, 1).tolist() == [False, True, True, True, False, True, True, True]
    assert history_valid(features, 3).tolist() == [False, False, False, True, False, False, False, True]
    assert history_valid(features, 0).tolist() == history_valid(features, 1).tolist()
    assert not history_valid(features, 9).any()
    assert not history_valid(np.empty((5, 0), dtype=np.float32), 1).any()


def test_market_data_cleaning_treats_naive_timestamps_as_utc():
    naive = [datetime(2026, 3, 2, 14, 0), datetime(2026, 3, 2, 13, 55), datetime(2026, 3, 2, 14, 0),
             datetime(2026, 3, 2, 14, 5)]
    raw = {"timestamp": naive, "open": [2.0, 1.0, 9.0, 3.0], "high": [2.0, 1.0, 9.0, 3.0],
           "low": [2.0, 1.0, 9.0, 3.0], "close": [2.0, 1.0, 9.0, 3.0], "volume": [1.0, 1.0, 1.0, 1.0]}
    data, dropped = clean_market_data(raw)
    at_1355 = int(datetime(2026, 3, 2, 13, 55, tzinfo=timezone.utc).timestamp())
    assert data.timestamps.tolist() == [at_1355, at_1355 + 300, at_1355 + 600]
    assert data.close.tolist() == [1.0, 2.0, 3.0]        # the later duplicate 14:00 bar is dropped
    assert dropped == 1
    milliseconds = {**raw, "timestamp": [t * 1000 for t in data.timestamps.tolist()] + [(at_1355 + 900) * 1000]}
    assert clean_market_data(milliseconds)[0].timestamps.tolist() == [*data.timestamps.tolist(), at_1355 + 900]


def test_split_window_purges_between_training_and_validation():
    train, validation = split_window(np.arange(100, 200), 0.2, 4)
    assert train.tolist() == list(range(100, 176)) and validation.tolist() == list(range(180, 200))


# ═══ the synthetic market and the run harness ══════════════════════════════


@dataclass
class Market:
    data: MarketData
    features: FeatureSet


def synthetic_market(calendar_days: int = 56, seed: int = 5) -> Market:
    generator = np.random.default_rng(seed)
    stamps: list[int] = []
    for day in range(calendar_days):
        if day % 7 >= 5:        # no weekend bars
            continue
        opening = FIRST_MONDAY + day * 86_400 + 13 * 3_600 + 30 * 60
        stamps.extend(opening + 300 * np.arange(BARS_PER_DAY))
    timestamps = np.array(stamps, dtype=np.int64)
    count = timestamps.size
    signal = np.zeros(count)
    innovation = generator.standard_normal(count) * math.sqrt(1 - 0.9 ** 2)
    for t in range(1, count):
        signal[t] = 0.9 * signal[t - 1] + innovation[t]
    step = np.zeros(count)
    step[1:] = 1.5 * signal[:-1] + generator.normal(0, 1.5, count - 1)   # bar t+1 drifts with bar t's signal
    tick = MNQ.tick_size
    close = np.round((18_000 + np.cumsum(step)) / tick) * tick
    open_ = np.empty(count)
    open_[0] = 18_000.0
    open_[1:] = close[:-1] + tick * generator.integers(-1, 2, count - 1)
    high = np.maximum(open_, close) + tick * generator.integers(0, 5, count)
    low = np.minimum(open_, close) - tick * generator.integers(0, 5, count)
    volume = generator.integers(50, 2_000, count).astype(np.float64)
    matrix = np.column_stack([
        signal, np.r_[np.nan, signal[:-1]], generator.standard_normal(count), generator.standard_normal(count),
    ]).astype(np.float32)
    matrix[:30] = np.nan        # feature warmup
    names = ["planted_signal", "planted_signal_previous_bar", "noise_first", "noise_second"]
    return Market(MarketData(timestamps, open_, high, low, close, volume), FeatureSet(matrix, names))


@pytest.fixture(scope="module")
def market() -> Market:
    return synthetic_market()


def settings_for(directory, **overrides) -> CycleSettings:
    values = dict(
        symbol="MNQ", timeframe="5m", model_id="cycle_engine_test", model_family="logistic_regression",
        model_parameters={"regularization_strength": 1.0, "max_iterations": 300}, artifact_directory=str(directory),
        train_days=21, validation_fraction=0.2, test_days=7, step_days=0, fold_limit=3, expanding_window=False,
        label_horizon_bars=HORIZON, label_threshold_ticks=THRESHOLD_TICKS, embargo_bars=2,
        long_only=False, holding_bars=0, stop_loss_ticks=0.0, take_profit_ticks=0.0, contracts=CONTRACTS,
        tuning_trials=0, tuning_mode="reviewed_defaults", bars_per_second=0.0, start_paused=False, quiet_bars=False, log_every_batches=1,
        device="cpu", seed=42, land_in_lake=False,
    )
    values.update(overrides)
    return CycleSettings(**values)


class Capture:
    """Stands in for ``protocol.emit``: keeps every event as the wire would carry it."""

    def __init__(self) -> None:
        self.events: list[dict] = []
        self.hooks: list = []
        self.last_bar: int | None = None
        self.phase: str | None = None

    def __call__(self, event: dict) -> None:
        wire = json.loads(protocol.dumps_safe(event))
        self.events.append(wire)
        if wire["type"] == "cycle_bars" and wire["timestamps"]:
            self.last_bar = wire["timestamps"][-1]
        if wire["type"] == "cycle_cursor":
            self.phase = wire["phase"]
        for hook in list(self.hooks):
            hook(wire)

    def of(self, kind: str) -> list[dict]:
        return [event for event in self.events if event["type"] == kind]

    def logs(self) -> list[str]:
        return [event["message"] for event in self.events if event["type"] == "log"]


@contextmanager
def capturing():
    capture = Capture()
    with pytest.MonkeyPatch.context() as patch:
        patch.setattr(protocol, "emit", capture)
        yield capture


class RecordingAdapter:
    """The real adapter, with every fit / predict call recorded next to what
    the process had emitted at that moment."""

    def __init__(self, inner, recorder: Recorder) -> None:
        self.inner = inner
        self.recorder = recorder
        self.family = inner.family
        self.step_unit = inner.step_unit

    def minimum_history(self) -> int:
        return self.inner.minimum_history()

    def fit(self, features, labels, train_index, validation_index, timestamps, reporter):
        self.recorder.fits.append({
            "train": np.array(train_index), "validation": np.array(validation_index),
            "phase": self.recorder.capture.phase, "last_bar": self.recorder.capture.last_bar,
            "parameters": dict(self.inner.parameters),
        })
        return self.inner.fit(features, labels, train_index, validation_index, timestamps, reporter)

    def predict_probability(self, features, index):
        self.recorder.predictions.append((np.array(index), self.recorder.capture.last_bar, self.recorder.capture.phase))
        return self.inner.predict_probability(features, index)

    def save(self, directory: str) -> str:
        return self.inner.save(directory)


class FakeRegressor:
    """An in-test price model implementing the regression side of the adapter
    contract (``cycle/adapter.py``): ridge least squares on the training rows'
    standardised features, one solver pass, epoch reports carrying mean absolute
    error (target units) and the accuracy of the predicted sign. Every fit and
    prediction is recorded next to what the process had emitted at that moment."""

    family = "logistic_regression"
    step_unit = "solver_pass"
    task = "regression"

    def __init__(self, recorder: Recorder | None = None, ridge: float = 1.0) -> None:
        self.recorder = recorder
        self.ridge = ridge
        self.mean = self.scale = self.weights = None
        self.intercept = 0.0
        self.outputs: dict[int, float] = {}

    def minimum_history(self) -> int:
        return 1

    def _matrix(self, features, index) -> np.ndarray:
        return (features[np.asarray(index, dtype=np.int64)].astype(np.float64) - self.mean) / self.scale

    def fit(self, features, labels, train_index, validation_index, timestamps, reporter):
        check_index(features, labels, train_index, "train_index")
        check_index(features, labels, validation_index, "validation_index")
        if self.recorder is not None:
            self.recorder.price_fits.append({
                "train": np.array(train_index), "validation": np.array(validation_index), "labels": labels,
                "phase": self.recorder.capture.phase, "last_bar": self.recorder.capture.last_bar,
            })
        reporter.step_unit = self.step_unit
        reporter.checkpoint()
        reporter.epoch_started(1, 1)
        rows = features[train_index].astype(np.float64)
        self.mean = rows.mean(axis=0)
        deviation = rows.std(axis=0)
        self.scale = np.where(deviation > 1e-12, deviation, 1.0)
        matrix = (rows - self.mean) / self.scale
        target = labels[train_index].astype(np.float64)
        self.intercept = float(target.mean())
        gram = matrix.T @ matrix + self.ridge * np.eye(matrix.shape[1])
        self.weights = np.linalg.solve(gram, matrix.T @ (target - self.intercept))
        train_error = float(np.mean(np.abs(matrix @ self.weights + self.intercept - target)))
        reporter.batch(BatchReport(epoch=1, epoch_count=1, batch=1, batch_count=1, span_start_index=int(train_index[0]),
                                   span_end_index=int(train_index[-1]), train_loss=train_error))
        reporter.validating(1, 1)
        predicted = self._matrix(features, validation_index) @ self.weights + self.intercept
        actual = labels[validation_index].astype(np.float64)
        signed = (predicted != 0) & (actual != 0)
        reporter.epoch_finished(EpochReport(
            epoch=1, epoch_count=1, train_loss=train_error, validation_loss=float(np.mean(np.abs(predicted - actual))),
            validation_accuracy=float(np.mean(np.sign(predicted[signed]) == np.sign(actual[signed]))),
            validation_f1_score=None, is_best=True,
        ))
        reporter.log("kept the ridge solution")

    def predict_value(self, features, index):
        if self.recorder is not None:
            self.recorder.price_predictions.append((np.array(index), self.recorder.capture.last_bar,
                                                    self.recorder.capture.phase))
        values = self._matrix(features, index) @ self.weights + self.intercept
        for row, value in zip(np.asarray(index).tolist(), values.tolist()):
            self.outputs[int(row)] = value
        return values

    def predict_probability(self, features, index):
        raise AssertionError("the engine asked the price model for a probability")

    def save(self, directory: str) -> str:
        path = Path(directory) / "price_model.npz"
        np.savez(path, mean=self.mean, scale=self.scale, weights=self.weights, intercept=np.array([self.intercept]))
        return str(path)


class Recorder:
    def __init__(self, capture: Capture) -> None:
        self.capture = capture
        self.factory_parameters: list[dict] = []
        self.fits: list[dict] = []
        self.predictions: list[tuple[np.ndarray, int | None, str | None]] = []
        self.price_fits: list[dict] = []
        self.price_predictions: list[tuple[np.ndarray, int | None, str | None]] = []
        self.price_models: list[FakeRegressor] = []
        self.price_parameters: list[dict] = []

    def factory(self, parameters: dict, task: str = "classification"):
        if task == "regression":
            self.price_parameters.append(dict(parameters))
            model = FakeRegressor(self)
            self.price_models.append(model)
            return model
        assert task == "classification", task
        self.factory_parameters.append(dict(parameters))
        return RecordingAdapter(build_adapter("logistic_regression", parameters, "cpu", 42), self)

    def price_output(self, row: int) -> float:
        """What the price model fitted for ``row``'s fold returned at ``row``."""
        (value,) = {model.outputs[row] for model in self.price_models if row in model.outputs}
        return value


@dataclass
class Run:
    engine: CycleEngine
    diagnostics: dict
    capture: Capture
    recorder: Recorder
    directory: Path
    seconds: float
    stopped_at: int | None = None


def build_engine(market: Market, directory, capture: Capture, *, control=None, tuned=False, **overrides):
    recorder = Recorder(capture)
    settings = settings_for(directory, **overrides)
    suggest = (lambda trial, base: suggest_parameters(trial, "logistic_regression", base)) if tuned else None
    engine = CycleEngine(settings, market.data, market.features, MNQ, recorder.factory,
                         control=control, suggest_parameters=suggest)
    return engine, recorder


def run_engine(market: Market, directory, *, before=None, control=None, tuned=False, **overrides) -> Run:
    with capturing() as capture:
        engine, recorder = build_engine(market, directory, capture, control=control, tuned=tuned, **overrides)
        if before is not None:
            before(engine, capture)
        started = time.monotonic()
        diagnostics = engine.run()
        return Run(engine, diagnostics, capture, recorder, Path(directory), time.monotonic() - started)


# ═══ a Python mirror of packages/shared/src/cycle/schema.ts ══════════════════════════


def schema_enum(anchor: str) -> tuple[str, ...]:
    text = SCHEMA.read_text(encoding="utf-8")
    block = re.search(re.escape(anchor) + r"\s*z\s*\.enum\(\[(.*?)\]\)", text, re.S)
    assert block, anchor
    return tuple(re.findall(r'"([A-Za-z0-9_]+)"', block.group(1)))


PHASES = schema_enum("cyclePhaseSchema =")
# The schema accepts any registry key; the registry says which keys exist.
FAMILIES = __import__("cycle.catalog", fromlist=["model_keys"]).model_keys()
STEP_UNITS = schema_enum("cycleStepUnitSchema =")
EXIT_REASONS = schema_enum("exitReason:")
OBJECTIVES = ("sharpe_ratio", "log_loss", "f1_score")


class Nullable:
    def __init__(self, inner) -> None:
        self.inner = inner


class ListOf:
    def __init__(self, inner, minimum: int = 0) -> None:
        self.inner, self.minimum = inner, minimum


def is_int(value) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def is_number(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def non_negative_int(value) -> bool:
    return is_int(value) and value >= 0


def positive_int(value) -> bool:
    return is_int(value) and value > 0


def non_negative(value) -> bool:
    return is_number(value) and value >= 0


def fraction(value) -> bool:
    return is_number(value) and 0 <= value <= 1


def text(value) -> bool:
    return isinstance(value, str)


def boolean(value) -> bool:
    return isinstance(value, bool)


def one_of(*options):
    def check(value) -> bool:
        return value in options and not isinstance(value, bool)
    check.__name__ = f"one of {options}"
    return check


def record_of(check):
    def inner(value) -> bool:
        return isinstance(value, dict) and all(isinstance(k, str) and check(v) for k, v in value.items())
    inner.__name__ = f"record of {check.__name__}"
    return inner


DIRECTION = one_of(1, 0, -1)
FOLD_PLAN = {
    "foldIndex": non_negative_int, "trainStart": is_int, "trainEnd": is_int, "validationStart": is_int,
    "validationEnd": is_int, "testStart": is_int, "testEnd": is_int, "trainBarCount": non_negative_int,
    "validationBarCount": non_negative_int, "testBarCount": non_negative_int,
}
DISTRIBUTION = {"count": non_negative_int, **{key: Nullable(is_number) for key in (
    "mean", "median", "standardDeviation", "skewness", "kurtosis", "percentile25", "percentile75", "minimum", "maximum")}}
EVENT_SCHEMAS = {
    "cycle_plan": {
        "symbol": text, "timeframe": text, "modelFamily": one_of(*FAMILIES), "modelLabel": text,
        "parameters": record_of(lambda v: v is None or isinstance(v, (int, float, str, bool))),
        "device": one_of("cuda", "cpu"), "deviceName": Nullable(text), "dataStart": is_int, "dataEnd": is_int,
        "barCount": non_negative_int, "barsPerYear": lambda v: is_number(v) and v > 0, "featureNames": ListOf(text),
        "labelHorizonBars": positive_int, "labelThresholdTicks": non_negative, "labelGapMultiple": non_negative,
        "gapCrossingBarCount": non_negative_int, "purgeBars": non_negative_int,
        "embargoBars": non_negative_int,
        "costModel": {"tickSize": lambda v: is_number(v) and v > 0, "tickValueUsd": lambda v: is_number(v) and v > 0,
                      "pointValueUsd": lambda v: is_number(v) and v > 0, "costPerSideUsd": non_negative,
                      "roundTripCostUsd": non_negative, "source": text},
        "trading": {"longOnly": boolean, "holdingBars": positive_int,
                    "stopLossTicks": non_negative, "takeProfitTicks": non_negative, "contracts": positive_int},
        "tuning": Nullable({"mode": one_of("tuned", "reviewed_defaults"), "trialCount": non_negative_int,
                            "budgetSeconds": non_negative_int, "objective": one_of(*OBJECTIVES),
                            "innerFoldCount": positive_int, "perFold": boolean, "pinned": ListOf(text)}),
        "folds": ListOf(FOLD_PLAN, minimum=1), "barsPerSecond": non_negative, "startPaused": boolean,
        "artifactDirectory": text,
    },
    "cycle_bars": {
        "role": one_of("context", "processed"), "foldIndex": Nullable(non_negative_int), "timestamps": ListOf(is_int),
        "open": ListOf(is_number), "high": ListOf(is_number), "low": ListOf(is_number), "close": ListOf(is_number),
        "volume": ListOf(is_number),
    },
    "cycle_cursor": {
        "phase": one_of(*PHASES), "foldIndex": Nullable(non_negative_int), "foldCount": non_negative_int,
        "spanStart": Nullable(is_int), "spanEnd": Nullable(is_int), "barTimestamp": Nullable(is_int),
        "barIndex": Nullable(non_negative_int), "barCount": Nullable(non_negative_int),
        "epoch": Nullable(non_negative_int), "epochCount": Nullable(non_negative_int),
        "batch": Nullable(non_negative_int), "batchCount": Nullable(non_negative_int),
        "stepUnit": Nullable(one_of(*STEP_UNITS)), "trial": Nullable(non_negative_int),
        "trialCount": Nullable(non_negative_int), "phaseFraction": fraction, "overallFraction": fraction,
        "barsPerSecond": non_negative, "paused": boolean, "elapsedSeconds": non_negative,
        "modelRole": Nullable(one_of("direction", "price")),
    },
    "cycle_epoch": {
        "foldIndex": Nullable(non_negative_int), "trial": Nullable(non_negative_int), "epoch": non_negative_int,
        "epochCount": non_negative_int, "stepUnit": one_of(*STEP_UNITS), "modelRole": one_of("direction", "price"),
        **{key: Nullable(is_number) for key in ("trainLoss", "validationLoss", "validationAccuracy",
                                                 "validationF1Score", "learningRate", "gradientNorm")},
        "isBest": boolean, "secondsElapsed": non_negative,
    },
    "cycle_trial": {
        "trial": non_negative_int, "trialCount": positive_int, "state": one_of("running", "complete", "pruned", "failed"),
        "parameters": record_of(lambda v: isinstance(v, (int, float, str, bool))), "objectiveName": one_of(*OBJECTIVES),
        "objectiveValue": Nullable(is_number), "bestValue": Nullable(is_number), "bestTrial": Nullable(non_negative_int),
        "foldIndex": Nullable(non_negative_int),
    },
    "cycle_parameters": {
        "foldIndex": Nullable(non_negative_int),
        "parameters": record_of(lambda v: v is None or isinstance(v, (int, float, str, bool))),
        "source": one_of("tuned", "manual", "reviewed_defaults"), "objectiveName": Nullable(one_of(*OBJECTIVES)),
        "bestTrial": Nullable(non_negative_int), "bestValue": Nullable(is_number), "trialCount": Nullable(non_negative_int),
        "pinned": ListOf(text),
    },
    "cycle_trade": {
        "tradeNumber": positive_int, "foldIndex": non_negative_int, "side": one_of("long", "short"),
        "status": one_of("open", "closed"), "contracts": positive_int, "entryTimestamp": is_int,
        "entryPrice": is_number, "exitTimestamp": Nullable(is_int), "exitPrice": Nullable(is_number),
        "barsHeld": non_negative_int, "probabilityUpAtEntry": fraction, "grossProfitUsd": Nullable(is_number),
        "costUsd": Nullable(is_number), "netProfitUsd": Nullable(is_number), "exitReason": Nullable(one_of(*EXIT_REASONS)),
    },
    "cycle_scoreboard": {
        "scope": one_of("running", "fold", "final"), "foldIndex": Nullable(non_negative_int),
        "barsEvaluated": non_negative_int, "barsScored": non_negative_int, "metrics": record_of(lambda v: v is None or is_number(v)),
        "tradeDistribution": DISTRIBUTION, "notes": ListOf(text),
    },
}


def check_value(value, spec, path: str) -> None:
    if isinstance(spec, Nullable):
        if value is not None:
            check_value(value, spec.inner, path)
    elif isinstance(spec, ListOf):
        assert isinstance(value, list), f"{path}: expected a list, got {value!r}"
        assert len(value) >= spec.minimum, f"{path}: fewer than {spec.minimum} items"
        for position, item in enumerate(value):
            check_value(item, spec.inner, f"{path}[{position}]")
    elif isinstance(spec, dict):
        assert isinstance(value, dict), f"{path}: expected an object, got {value!r}"
        for key, inner in spec.items():
            assert key in value, f"{path}.{key} is missing"
            check_value(value[key], inner, f"{path}.{key}")
    else:
        assert spec(value), f"{path}: {value!r} fails {getattr(spec, '__name__', spec)}"


def check_cycle_event(event: dict) -> None:
    kind = event["type"]
    check_value(event, EVENT_SCHEMAS[kind], kind)
    assert non_negative_int(event["seq"]), f"{kind}: seq {event.get('seq')!r}"
    assert "data" not in event, f"{kind}: cycle events carry no nested data copy"
    if kind == "cycle_bars":
        count = len(event["timestamps"])
        for key in ("open", "high", "low", "close", "volume"):
            assert len(event[key]) == count, f"cycle_bars.{key}: {len(event[key])} values for {count} bars"
        prediction_columns = ("probabilityUp", "predictedDirection", "position", "positionHeld", "equityUsd",
                              "predictedClose", "forecastTimestamp")
        if event["role"] == "processed":
            for key in prediction_columns:
                assert key in event and len(event[key]) == count, f"processed cycle_bars.{key}"
            check_value(event["probabilityUp"], ListOf(Nullable(fraction)), "cycle_bars.probabilityUp")
            check_value(event["predictedDirection"], ListOf(DIRECTION), "cycle_bars.predictedDirection")
            check_value(event["position"], ListOf(DIRECTION), "cycle_bars.position")
            check_value(event["positionHeld"], ListOf(DIRECTION), "cycle_bars.positionHeld")
            check_value(event["equityUsd"], ListOf(is_number), "cycle_bars.equityUsd")
            check_value(event["predictedClose"], ListOf(Nullable(is_number)), "cycle_bars.predictedClose")
            check_value(event["forecastTimestamp"], ListOf(Nullable(is_int)), "cycle_bars.forecastTimestamp")
        else:
            assert not any(key in event for key in prediction_columns), "context bars carry prediction columns"
        if "resolved" in event:
            resolved = event["resolved"]
            check_value(resolved, {"timestamps": ListOf(is_int), "actualDirection": ListOf(DIRECTION),
                                   "correct": ListOf(Nullable(boolean))}, "cycle_bars.resolved")
            assert len(resolved["actualDirection"]) == len(resolved["correct"]) == len(resolved["timestamps"])
    if kind == "cycle_scoreboard":
        assert list(event["metrics"]) == list(METRIC_NAMES)


# ═══ the full run ══════════════════════════════════════════════════════════


def record_resolutions(engine: CycleEngine, capture: Capture) -> None:
    """Record, for every forecast resolution, which bar the walk had processed
    and which bar the chart had been shown at that moment."""
    engine.resolutions = []
    original = engine._resolve_forecast

    def wrapped(accumulator, source_row, target_row, predicted_move):
        engine.resolutions.append({"source": source_row, "target": target_row, "processed": engine.last_processed_row,
                                   "shown": capture.last_bar, "predicted_move": predicted_move})
        return original(accumulator, source_row, target_row, predicted_move)

    engine._resolve_forecast = wrapped


@pytest.fixture(scope="module")
def full_run(market, tmp_path_factory) -> Run:
    return run_engine(market, tmp_path_factory.mktemp("full_run"), before=record_resolutions)


def rows_of(market: Market) -> dict[int, int]:
    return {int(t): row for row, t in enumerate(market.data.timestamps)}


def plan_of(run: Run) -> dict:
    (plan,) = run.capture.of("cycle_plan")
    return plan


def test_run_takes_the_plan_it_announced(full_run, market):
    plan = plan_of(full_run)
    assert plan["modelFamily"] == "logistic_regression" and plan["device"] == "cpu"
    assert plan["barCount"] == len(market.data) == 40 * BARS_PER_DAY
    assert plan["labelHorizonBars"] == plan["purgeBars"] == HORIZON and plan["embargoBars"] == 2
    assert plan["costModel"]["costPerSideUsd"] == pytest.approx(MNQ.cost_per_side * CONTRACTS)
    assert plan["costModel"]["roundTripCostUsd"] == pytest.approx(2 * MNQ.cost_per_side * CONTRACTS)
    assert plan["trading"]["holdingBars"] == HORIZON           # 0 means the label horizon
    assert plan["featureNames"] == market.features.names
    assert plan["tuning"] is None
    # 4 weekly test windows fit (days 21, 28, 35, 42); the fold limit keeps the 3 most recent
    assert len(plan["folds"]) == 3 and [f["foldIndex"] for f in plan["folds"]] == [0, 1, 2]
    for fold, monday in zip(plan["folds"], (28, 35, 42)):
        first_test_bar = FIRST_MONDAY + monday * 86_400 + 13 * 3_600 + 30 * 60 + 2 * 300   # after a 2-bar embargo
        assert fold["testStart"] == first_test_bar
        assert fold["testBarCount"] == 5 * BARS_PER_DAY - 2
    assert any("fold limit 3: keeping the most recent 3 of 4 folds" in line for line in full_run.capture.logs())


def test_every_cycle_event_matches_the_wire_schema(full_run):
    cycle_events = [event for event in full_run.capture.events if event["type"].startswith("cycle_")]
    kinds = {event["type"] for event in cycle_events}
    assert kinds == {"cycle_plan", "cycle_bars", "cycle_cursor", "cycle_epoch", "cycle_parameters", "cycle_trade", "cycle_scoreboard"}
    for event in cycle_events:
        check_cycle_event(event)
    sequence = [event["seq"] for event in full_run.capture.events]
    assert all(b > a for a, b in zip(sequence, sequence[1:])), "envelope seq must strictly increase"


def test_bars_are_emitted_once_in_order_with_no_gap_and_nothing_after_the_last_test_bar(full_run, market):
    bars = full_run.capture.of("cycle_bars")
    emitted = [t for event in bars for t in event["timestamps"]]
    plan = plan_of(full_run)
    last_row = rows_of(market)[plan["folds"][-1]["testEnd"]]
    assert emitted == market.data.timestamps[: last_row + 1].tolist()
    assert last_row < len(market.data) - 1       # the untested last week is never shown
    assert full_run.diagnostics["barsEmitted"] == len(emitted)
    assert all(len(event["timestamps"]) <= CONTEXT_CHUNK for event in bars if event["role"] == "context")
    first_bars = full_run.capture.events.index(bars[0])
    assert full_run.capture.events.index(plan) < first_bars, "the plan precedes every bar"
    # bars carry the lake's prices unchanged
    rows = rows_of(market)
    for event in bars[:3] + bars[-3:]:
        for position, t in enumerate(event["timestamps"]):
            row = rows[t]
            assert (event["open"][position], event["high"][position], event["low"][position], event["close"][position]) == (
                market.data.open[row], market.data.high[row], market.data.low[row], market.data.close[row])


def test_processed_bars_are_exactly_the_test_spans(full_run, market):
    plan = plan_of(full_run)
    rows = rows_of(market)
    spans = {fold["foldIndex"]: (fold["testStart"], fold["testEnd"]) for fold in plan["folds"]}
    processed: dict[int, list[int]] = {k: [] for k in spans}
    for event in full_run.capture.of("cycle_bars"):
        for t in event["timestamps"]:
            inside = [k for k, (start, end) in spans.items() if start <= t <= end]
            if event["role"] == "processed":
                assert inside == [event["foldIndex"]], f"processed bar {t} outside its fold's test span"
                processed[event["foldIndex"]].append(t)
            else:
                assert not inside, f"test bar {t} emitted as context"
    for k, (start, end) in spans.items():
        expected = market.data.timestamps[rows[start]: rows[end] + 1].tolist()
        assert processed[k] == expected
        assert len(expected) == plan["folds"][k]["testBarCount"]
    assert full_run.diagnostics["barsProcessed"] == sum(len(v) for v in processed.values())


def test_predictions_come_one_bar_at_a_time_from_bars_already_reached(full_run, market):
    walk = [(index, last_bar) for index, last_bar, phase in full_run.recorder.predictions if phase == "testing"]
    assert len(walk) == len(full_run.recorder.predictions)          # no tuning in this run
    rows = [int(index[0]) for index, _ in walk]
    assert all(index.size == 1 for index, _ in walk)
    assert rows == sorted(set(rows)), "each test bar is predicted once, in order"
    for row, last_bar in walk:
        # the chart has not been shown this bar (or anything after it) when it is predicted
        assert last_bar is not None and last_bar < market.data.timestamps[row]
    # the probability on the wire is what the fold's saved model gives for that row
    processed = [(t, p, event["foldIndex"]) for event in full_run.capture.of("cycle_bars")
                 if event["role"] == "processed" for t, p in zip(event["timestamps"], event["probabilityUp"])]
    assert len(processed) == len(rows)
    assert all(p is not None for _, p, _ in processed)     # every test row has feature history here
    saved = [load_adapter(str(full_run.directory / f"fold_{fold}")) for fold in range(3)]
    by_row = rows_of(market)
    for t, probability, fold in processed[::7]:
        expected = saved[fold].predict_probability(market.features.matrix, np.array([by_row[t]]))[0]
        assert probability == pytest.approx(expected, abs=1e-12)


def test_no_training_or_validation_label_resolves_inside_a_later_span(full_run, market):
    plan = plan_of(full_run)
    rows = rows_of(market)
    ts = market.data.timestamps
    labels = full_run.engine.labels
    valid = history_valid(market.features.matrix, 1)
    outer = [fit for fit in full_run.recorder.fits if fit["phase"] == "training"]
    assert len(outer) == 3
    for fold, fit in zip(plan["folds"], outer):
        train, validation = fit["train"], fit["validation"]
        test_start = rows[fold["testStart"]]
        # the label of row r is known at bar r + h
        assert ts[train.max() + HORIZON] < fold["validationStart"]
        assert ts[validation.max() + HORIZON] < fold["testStart"]
        assert train.max() + HORIZON < validation.min() and validation.max() + HORIZON < test_start
        assert np.isfinite(labels[train]).all() and np.isfinite(labels[validation]).all()
        assert valid[train].all() and valid[validation].all()
        assert (np.diff(train) > 0).all() and (np.diff(validation) > 0).all()
        assert (train.size, validation.size) == (fold["trainBarCount"], fold["validationBarCount"])
        assert (ts[train[0]], ts[train[-1]]) == (fold["trainStart"], fold["trainEnd"])
        assert (ts[validation[0]], ts[validation[-1]]) == (fold["validationStart"], fold["validationEnd"])
        # every bar before the test span was on the chart before the fold was fitted, none after it
        assert fit["last_bar"] == ts[test_start - 1]
        # the training window is the 21 calendar days before the test window
        assert fold["testStart"] - fold["trainStart"] < 22 * 86_400


def test_resolved_labels_match_the_labels_module_and_resolve_horizon_bars_later(full_run, market):
    rows = rows_of(market)
    # the engine's labels: the session-gap rule (default 3x the typical bar interval) leaves a bar whose
    # horizon crosses the weekend unlabelled, so its resolution is 0 (unscored)
    crosses_gap = horizon_crosses_gap(market.data.timestamps, HORIZON, 3.0)
    labels = make_labels(market.data.close, HORIZON, THRESHOLD_TICKS, MNQ.tick_size, crosses_gap)
    predicted: dict[int, int] = {}
    per_fold: dict[int, int] = {}
    fold_of: dict[int, int] = {}
    seen = 0
    for event in full_run.capture.of("cycle_bars"):
        if event["role"] != "processed":
            continue
        for t, direction, probability in zip(event["timestamps"], event["predictedDirection"], event["probabilityUp"]):
            predicted[t] = direction
            fold_of[t] = event["foldIndex"]
            assert direction == (0 if probability is None else (1 if probability >= 0.5 else -1))
        resolved = event.get("resolved")
        if not resolved:
            continue
        for t, actual, correct in zip(resolved["timestamps"], resolved["actualDirection"], resolved["correct"]):
            row = rows[t]
            seen += 1
            known_at = int(market.data.timestamps[row + HORIZON])
            assert known_at in event["timestamps"], "a label is sent with the bar that makes it known"
            assert fold_of[known_at] == fold_of[t], "labels resolve inside their own fold"
            expected = 0 if np.isnan(labels[row]) else (1 if labels[row] == 1.0 else -1)
            assert actual == expected
            if actual == 0 or predicted[t] == 0:
                assert correct is None
            else:
                assert correct == (predicted[t] == actual)
            per_fold[fold_of[t]] = per_fold.get(fold_of[t], 0) + 1
    plan = plan_of(full_run)
    for fold in plan["folds"]:
        assert per_fold[fold["foldIndex"]] == fold["testBarCount"] - HORIZON
    assert seen == sum(fold["testBarCount"] - HORIZON for fold in plan["folds"])


def test_trades_fill_at_the_next_open_and_their_money_adds_up(full_run, market):
    rows = rows_of(market)
    data = market.data
    trades = full_run.capture.of("cycle_trade")
    opened = {t["tradeNumber"]: t for t in trades if t["status"] == "open"}
    closed = {t["tradeNumber"]: t for t in trades if t["status"] == "closed"}
    assert len(closed) >= 20, "the planted signal should make the model trade"
    assert set(opened) == set(closed), "every trade opened is closed by the end of the run"
    for number in closed:
        assert trades.index(opened[number]) < trades.index(closed[number])
    assert sorted(closed) == list(range(1, len(closed) + 1))
    probabilities = {t: p for event in full_run.capture.of("cycle_bars") if event["role"] == "processed"
                     for t, p in zip(event["timestamps"], event["probabilityUp"])}
    folds = {fold["foldIndex"]: fold for fold in plan_of(full_run)["folds"]}
    per_side = MNQ.cost_per_side * CONTRACTS
    for trade in closed.values():
        entry_row, exit_row = rows[trade["entryTimestamp"]], rows[trade["exitTimestamp"]]
        fold = folds[trade["foldIndex"]]
        assert fold["testStart"] <= trade["entryTimestamp"] <= trade["exitTimestamp"] <= fold["testEnd"]
        assert trade["entryPrice"] == data.open[entry_row]                  # filled at the bar's open
        decision = probabilities[int(data.timestamps[entry_row - 1])]       # decided at the previous close
        assert trade["entryTimestamp"] > fold["testStart"]
        if trade["side"] == "long":                                         # every prediction is traded
            assert decision >= 0.5
        else:
            assert decision < 0.5
        assert trade["probabilityUpAtEntry"] == pytest.approx(decision)
        assert trade["costUsd"] == pytest.approx(2 * per_side)
        side = 1 if trade["side"] == "long" else -1
        gross = side * (trade["exitPrice"] - trade["entryPrice"]) * MNQ.point_value * CONTRACTS
        assert trade["grossProfitUsd"] == pytest.approx(gross)
        assert trade["netProfitUsd"] == pytest.approx(gross - 2 * per_side)
        assert trade["contracts"] == CONTRACTS
        assert trade["exitReason"] in ("holding_period", "opposite_signal", "fold_end")
        if trade["exitReason"] == "fold_end":
            assert trade["exitTimestamp"] == fold["testEnd"] and trade["exitPrice"] == data.close[exit_row]
        else:
            assert trade["exitPrice"] == data.open[exit_row]
        assert trade["barsHeld"] == exit_row - entry_row + (1 if trade["exitReason"] == "fold_end" else 0)
    reasons = {trade["exitReason"] for trade in closed.values()}
    # with shorts allowed the position follows every prediction, so a trade
    # ends only when the prediction flips (or the fold ends) — never on time
    assert reasons == {"opposite_signal", "fold_end"}


def test_equity_the_scoreboard_and_the_trades_agree(full_run):
    closed = [t for t in full_run.capture.of("cycle_trade") if t["status"] == "closed"]
    processed = [event for event in full_run.capture.of("cycle_bars") if event["role"] == "processed"]
    final_equity = processed[-1]["equityUsd"][-1]
    realised = sum(t["netProfitUsd"] for t in closed)
    boards = full_run.capture.of("cycle_scoreboard")
    (final,) = [b for b in boards if b["scope"] == "final"]
    assert final_equity == pytest.approx(realised, abs=1e-6)
    assert final["metrics"]["net_profit_usd"] == pytest.approx(realised, abs=1e-6)
    assert final["metrics"]["trade_count"] == len(closed)
    assert final["metrics"]["total_cost_usd"] == pytest.approx(sum(t["costUsd"] for t in closed))
    assert final["tradeDistribution"]["count"] == len(closed)
    assert final["tradeDistribution"]["mean"] == pytest.approx(np.mean([t["netProfitUsd"] for t in closed]))
    assert final["barsEvaluated"] == sum(len(event["timestamps"]) for event in processed)
    assert full_run.diagnostics["finalMetrics"]["net_profit_usd"] == pytest.approx(realised, abs=1e-6)
    assert full_run.diagnostics["tradeCount"] == len(closed)
    # per fold: the fold scoreboard's net is that fold's trades, and the equity column steps by it
    fold_boards = [b for b in boards if b["scope"] == "fold"]
    assert [b["foldIndex"] for b in fold_boards] == [0, 1, 2]
    equity_at_fold_end = {}
    for event in processed:
        equity_at_fold_end[event["foldIndex"]] = event["equityUsd"][-1]
    previous = 0.0
    for board in fold_boards:
        k = board["foldIndex"]
        fold_trades = [t["netProfitUsd"] for t in closed if t["foldIndex"] == k]
        assert board["metrics"]["net_profit_usd"] == pytest.approx(sum(fold_trades), abs=1e-6)
        assert equity_at_fold_end[k] - previous == pytest.approx(sum(fold_trades), abs=1e-6)
        previous = equity_at_fold_end[k]
        assert board["barsEvaluated"] == plan_of(full_run)["folds"][k]["testBarCount"]
    # every position is flat at the end of each fold
    last_positions = {}
    for event in processed:
        last_positions[event["foldIndex"]] = event["position"][-1]
    assert set(last_positions.values()) == {0}


def test_scored_bars_reproduce_the_final_classification_metrics(full_run):
    correct = [c for event in full_run.capture.of("cycle_bars") if event.get("resolved")
               for c in event["resolved"]["correct"] if c is not None]
    (final,) = [b for b in full_run.capture.of("cycle_scoreboard") if b["scope"] == "final"]
    assert final["barsScored"] == len(correct)
    assert final["metrics"]["accuracy"] == pytest.approx(sum(correct) / len(correct))
    # the planted signal is learnable: well above a coin and above the majority-class baseline
    assert final["metrics"]["accuracy"] > 0.65
    assert final["metrics"]["accuracy"] > final["metrics"]["majority_class_accuracy"]
    assert final["metrics"]["roc_auc"] > 0.7


def test_final_trading_metrics_rebuild_from_the_equity_on_the_wire(full_run, market):
    plan = plan_of(full_run)
    ts = market.data.timestamps
    assert plan["barsPerYear"] == pytest.approx(len(ts) / ((ts[-1] - ts[0]) / 86_400 / 365.25))
    equity = np.array([e for event in full_run.capture.of("cycle_bars") if event["role"] == "processed"
                       for e in event["equityUsd"]])
    per_bar = np.diff(np.r_[0.0, equity])
    (final,) = [b for b in full_run.capture.of("cycle_scoreboard") if b["scope"] == "final"]
    metrics = final["metrics"]
    years = math.sqrt(plan["barsPerYear"])
    assert metrics["sharpe_ratio"] == pytest.approx(per_bar.mean() / per_bar.std(ddof=1) * years, rel=1e-9)
    downside = math.sqrt(np.mean(np.minimum(per_bar, 0.0) ** 2))
    assert metrics["sortino_ratio"] == pytest.approx(per_bar.mean() / downside * years, rel=1e-9)
    drawdown = float(np.max(np.maximum.accumulate(np.r_[0.0, equity]) - np.r_[0.0, equity]))
    assert metrics["maximum_drawdown_usd"] == pytest.approx(drawdown)
    assert metrics["calmar_ratio"] == pytest.approx(per_bar.mean() * plan["barsPerYear"] / drawdown, rel=1e-9)
    # buy and hold: per fold, first test open to last test close, one round trip, summed
    rows = rows_of(market)
    expected = sum(
        (market.data.close[rows[f["testEnd"]]] - market.data.open[rows[f["testStart"]]]) * MNQ.point_value * CONTRACTS
        - MNQ.round_trip * CONTRACTS for f in plan["folds"])
    assert metrics["buy_and_hold_net_profit_usd"] == pytest.approx(expected)
    running = [b for b in full_run.capture.of("cycle_scoreboard") if b["scope"] == "running"]
    evaluated = [b["barsEvaluated"] for b in running]
    assert evaluated == sorted(evaluated) and all(b["foldIndex"] is not None for b in running)


def test_final_classification_metrics_match_scikit_learn_on_the_scored_bars(full_run, market):
    from sklearn import metrics as sk

    probabilities, fold_of = {}, {}
    for event in full_run.capture.of("cycle_bars"):
        if event["role"] == "processed":
            for t, p in zip(event["timestamps"], event["probabilityUp"]):
                probabilities[t], fold_of[t] = p, event["foldIndex"]
    scored = [(t, a) for event in full_run.capture.of("cycle_bars") if event.get("resolved")
              for t, a, c in zip(event["resolved"]["timestamps"], event["resolved"]["actualDirection"],
                                 event["resolved"]["correct"]) if c is not None]
    actual = np.array([1 if a > 0 else 0 for _, a in scored])
    probability = np.array([probabilities[t] for t, _ in scored])
    predicted = (probability >= 0.5).astype(int)
    (final,) = [b for b in full_run.capture.of("cycle_scoreboard") if b["scope"] == "final"]
    metrics = final["metrics"]
    assert metrics["precision"] == pytest.approx(sk.precision_score(actual, predicted))
    assert metrics["recall"] == pytest.approx(sk.recall_score(actual, predicted))
    assert metrics["f1_score"] == pytest.approx(sk.f1_score(actual, predicted))
    assert metrics["macro_f1_score"] == pytest.approx(sk.f1_score(actual, predicted, average="macro"))
    assert metrics["balanced_accuracy"] == pytest.approx(sk.balanced_accuracy_score(actual, predicted))
    assert metrics["roc_auc"] == pytest.approx(sk.roc_auc_score(actual, probability))
    assert metrics["log_loss"] == pytest.approx(sk.log_loss(actual, probability, labels=[0, 1]))
    assert metrics["brier_score"] == pytest.approx(sk.brier_score_loss(actual, probability))
    # the baseline: each scored bar called as its fold's training majority class
    labels = full_run.engine.labels
    outer = [fit for fit in full_run.recorder.fits if fit["phase"] == "training"]
    majority = [1 if labels[fit["train"]].mean() >= 0.5 else 0 for fit in outer]
    baseline = np.mean([majority[fold_of[t]] == up for (t, _), up in zip(scored, actual)])
    assert metrics["majority_class_accuracy"] == pytest.approx(baseline)


# ═══ the price model and its forecasts ═════════════════════════════════════


def processed_forecasts(run: Run) -> list[tuple[int, int, float | None, int | None]]:
    """(timestamp, fold, predictedClose, forecastTimestamp) for every processed bar on the wire."""
    return [(t, event["foldIndex"], close, when) for event in run.capture.of("cycle_bars") if event["role"] == "processed"
            for t, close, when in zip(event["timestamps"], event["predictedClose"], event["forecastTimestamp"])]


def test_every_processed_bar_carries_a_forecast_of_the_close_horizon_bars_later(full_run, market):
    rows = rows_of(market)
    data = market.data
    engine = full_run.engine
    for event in full_run.capture.of("cycle_bars"):
        if event["role"] == "processed":
            count = len(event["timestamps"])
            assert len(event["predictedClose"]) == len(event["forecastTimestamp"]) == count
        else:
            assert "predictedClose" not in event and "forecastTimestamp" not in event
    bars = processed_forecasts(full_run)
    assert len(bars) == sum(fold["testBarCount"] for fold in plan_of(full_run)["folds"])
    crosses = horizon_crosses_gap(data.timestamps, HORIZON, 3.0)
    forecast_bars = 0
    for t, _, predicted_close, forecast_timestamp in bars:
        row = rows[t]
        if crosses[row]:
            # the horizon crosses a session gap (the weekend): no forecast is asked for, none is drawn
            assert predicted_close is None and forecast_timestamp is None
            continue
        forecast_bars += 1
        # the forecast is for bar t + h: its timestamp, or nothing past the loaded data
        assert forecast_timestamp == (int(data.timestamps[row + HORIZON]) if row + HORIZON < len(data) else None)
        # every other test row has feature history and a trailing volatility, so it has a forecast
        assert predicted_close is not None
        # close + scale * the price model's output, the scale read from closes <= this bar, then the nearest tick
        scale = engine.move_scale[row]
        backward_moves = data.close[row - 249: row + 1] - data.close[row - 249 - HORIZON: row + 1 - HORIZON]
        assert scale == pytest.approx(max(np.std(backward_moves, ddof=1), MNQ.tick_size), rel=1e-12)
        raw = data.close[row] + scale * full_run.recorder.price_output(row)
        assert predicted_close == pytest.approx(round_to_tick(raw, MNQ.tick_size), abs=1e-9)
        assert abs(predicted_close - raw) <= MNQ.tick_size / 2 + 1e-9 and is_on_tick(predicted_close, MNQ.tick_size)
    assert 0 < forecast_bars < len(bars)
    # the price model predicts one bar at a time, from bars the chart already holds, never during training
    walk = full_run.recorder.price_predictions
    assert len(walk) == forecast_bars and all(index.size == 1 and phase == "testing" for index, _, phase in walk)
    for index, last_bar, _ in walk:
        assert last_bar is not None and last_bar < data.timestamps[int(index[0])]


def test_no_forecast_is_resolved_before_its_target_bar_is_walked(full_run, market):
    plan = plan_of(full_run)
    rows = rows_of(market)
    resolutions = full_run.engine.resolutions
    assert len(resolutions) == sum(fold["testBarCount"] - HORIZON for fold in plan["folds"])
    for resolution in resolutions:
        assert resolution["target"] == resolution["source"] + HORIZON
        assert resolution["processed"] == resolution["target"], "resolved while a different bar was being walked"
        # the chart had not yet been shown the target bar when its forecast was scored
        assert resolution["shown"] < market.data.timestamps[resolution["target"]]
    # and a forecast resolves inside its own fold's test span
    spans = [(rows[fold["testStart"]], rows[fold["testEnd"]]) for fold in plan["folds"]]
    for resolution in resolutions:
        assert any(start <= resolution["source"] and resolution["target"] <= end for start, end in spans)


def test_the_price_model_never_trains_on_a_target_that_resolves_in_a_later_span(full_run, market):
    plan = plan_of(full_run)
    rows = rows_of(market)
    ts = market.data.timestamps
    engine = full_run.engine
    fits = full_run.recorder.price_fits
    assert len(fits) == 3 and all(fit["phase"] in ("training", "validating") for fit in fits)
    direction_fits = [fit for fit in full_run.recorder.fits if fit["phase"] == "training"]
    for fold, fit, direction in zip(plan["folds"], fits, direction_fits):
        train, validation = fit["train"], fit["validation"]
        test_start = rows[fold["testStart"]]
        # the target of row r is known at bar r + h
        assert train.max() + HORIZON < validation.min()
        assert validation.max() + HORIZON < test_start
        assert fit["labels"] is engine.price_targets
        assert np.isfinite(engine.price_targets[train]).all() and np.isfinite(engine.price_targets[validation]).all()
        # the same spans as the direction classifier, plus the rows whose direction label is unscored
        # only because the move sat inside the threshold
        assert set(direction["train"]) <= set(train) and set(direction["validation"]) <= set(validation)
        assert np.isnan(engine.labels[train]).any()
        # fitted after the classifier, before any bar of the test span was shown
        assert fit["last_bar"] == ts[test_start - 1]
    # the price model gets the classifier's parameters (the factory's first call is the planning probe)
    assert full_run.recorder.price_parameters == full_run.recorder.factory_parameters[1:]


def test_the_forecast_scoreboard_rebuilds_from_the_bars_on_the_wire(full_run, market):
    rows = rows_of(market)
    close = market.data.close
    plan = plan_of(full_run)
    predicted, actual = [], []
    per_fold: dict[int, tuple[list, list]] = {fold["foldIndex"]: ([], []) for fold in plan["folds"]}
    last_row_of_fold = {fold["foldIndex"]: rows[fold["testEnd"]] for fold in plan["folds"]}
    for t, fold, predicted_close, _ in processed_forecasts(full_run):
        row = rows[t]
        if predicted_close is None:
            continue                    # no forecast was asked for: the horizon crosses a session gap
        if row + HORIZON > last_row_of_fold[fold]:
            continue                    # its target bar is outside the fold: never resolved
        move = predicted_close - close[row]
        predicted.append(move)
        actual.append(close[row + HORIZON] - close[row])
        per_fold[fold][0].append(move)
        per_fold[fold][1].append(close[row + HORIZON] - close[row])
    predicted, actual = np.array(predicted), np.array(actual)
    error = predicted - actual
    signed = (predicted != 0) & (actual != 0)
    expected = {
        "price_forecast_mean_absolute_error_points": np.mean(np.abs(error)),
        "persistence_mean_absolute_error_points": np.mean(np.abs(actual)),
        "price_forecast_skill": 1 - np.mean(np.abs(error)) / np.mean(np.abs(actual)),
        "price_forecast_root_mean_square_error_points": math.sqrt(np.mean(error ** 2)),
        "price_forecast_direction_accuracy": np.mean(np.sign(predicted[signed]) == np.sign(actual[signed])),
    }
    boards = full_run.capture.of("cycle_scoreboard")
    (final,) = [b for b in boards if b["scope"] == "final"]
    for name, value in expected.items():
        assert final["metrics"][name] == pytest.approx(value, rel=1e-9), name
        assert full_run.diagnostics["finalMetrics"][name] == pytest.approx(value, rel=1e-9)
        assert full_run.diagnostics["priceForecast"][name] == pytest.approx(value, rel=1e-9)
    # the planted drift is learnable: the price model beats the no-change forecast
    assert final["metrics"]["price_forecast_skill"] > 0
    assert final["metrics"]["price_forecast_direction_accuracy"] > 0.6
    for board in [b for b in boards if b["scope"] == "fold"]:
        moves, actual_moves = (np.array(v) for v in per_fold[board["foldIndex"]])
        assert board["metrics"]["price_forecast_mean_absolute_error_points"] == pytest.approx(
            np.mean(np.abs(moves - actual_moves)), rel=1e-9)
    # a running scoreboard before the first forecast resolved has no forecast metrics, never zeros
    first = next(b for b in boards if b["scope"] == "running")
    if first["barsEvaluated"] <= HORIZON:
        assert all(first["metrics"][name] is None for name in PRICE_FORECAST_METRIC_NAMES)
    # the same numbers, row by row, in predictions.parquet
    frame = pq.read_table(full_run.directory / "predictions.parquet").to_pydict()
    errors = [e for e in frame["forecast_error_points"] if e is not None]
    assert errors == pytest.approx(error.tolist(), abs=1e-9)
    assert frame["predicted_close"] == pytest.approx([c for _, _, c, _ in processed_forecasts(full_run)])
    assert frame["forecast_timestamp"] == [w for _, _, _, w in processed_forecasts(full_run)]
    config = json.loads((full_run.directory / "config.json").read_text(encoding="utf-8"))
    assert config["priceModel"]["volatilityWindowBars"] == 250 and config["priceModel"]["horizonBars"] == HORIZON
    assert config["priceModel"]["finalMetrics"]["price_forecast_skill"] == pytest.approx(expected["price_forecast_skill"])


def test_the_price_model_reports_its_training_under_its_own_role(full_run):
    epochs = full_run.capture.of("cycle_epoch")
    assert {e["modelRole"] for e in epochs} == {"direction", "price"}
    assert [e["foldIndex"] for e in epochs if e["modelRole"] == "price"] == [0, 1, 2]
    training = [c for c in full_run.capture.of("cycle_cursor") if c["phase"] in ("training", "validating")]
    assert {c["modelRole"] for c in training} == {"direction", "price"}
    assert all(c["modelRole"] is None for c in full_run.capture.of("cycle_cursor") if c["phase"] == "testing")
    logs = full_run.capture.logs()
    for k in (1, 2, 3):
        prefix = f"[fold {k}/3]"
        assert any(line.startswith(f"{prefix}[train] price model: fitting") for line in logs)
        assert any(line.startswith(f"{prefix}[train] price model solver pass 1/1") for line in logs)
        assert any(line.startswith(f"{prefix}[validate] price model pass 1/1 val_mae=") for line in logs)
        assert f"{prefix}[train] price model kept the ridge solution" in logs
        assert any(line.startswith(f"{prefix}[test] price forecast: mean absolute error") for line in logs)
    # the order inside a fold: classifier, then price model, then the walk
    first = [next(i for i, line in enumerate(logs) if line.startswith(text)) for text in (
        "[fold 1/3][train] fitting", "[fold 1/3][train] price model: fitting", "[fold 1/3][test] walking")]
    assert first == sorted(first)
    bar_lines = [line for line in logs if re.match(r"\[fold \d/3\]\[test\] \d{4}-\d\d-\d\d \d\d:\d\d bar ", line)]
    assert bar_lines and all(re.search(r" forecast=\d+\.\d\d@\d\d:\d\d$", line) for line in bar_lines)
    epochs_table = pq.read_table(full_run.directory / "epochs.parquet").to_pydict()
    assert set(epochs_table["model_role"]) == {"direction", "price"}
    folds = pq.read_table(full_run.directory / "folds_table.parquet").to_pydict()
    assert all(path and path.endswith("price_model.npz") for path in folds["price_model_path"])
    assert all(count > 0 for count in folds["price_train_bar_count"])


def test_a_price_model_that_fails_leaves_the_direction_cycle_running(market, tmp_path):
    def factory(parameters, task="classification"):
        if task == "regression":
            raise NotImplementedError("no regression for this family")
        return build_adapter("logistic_regression", parameters, "cpu", 42)

    with capturing() as capture:
        engine = CycleEngine(settings_for(tmp_path, fold_limit=1, quiet_bars=True), market.data, market.features, MNQ,
                             factory)
        engine.run()
    warned = [line for line in capture.logs() if "price model could not be fitted (NotImplementedError" in line]
    assert len(warned) == 1
    processed = [e for e in capture.of("cycle_bars") if e["role"] == "processed"]
    assert processed and all(c is None for e in processed for c in e["predictedClose"])
    crosses = horizon_crosses_gap(market.data.timestamps, HORIZON, 3.0)
    rows = rows_of(market)
    for e in processed:
        for t, w in zip(e["timestamps"], e["forecastTimestamp"]):
            assert (w is None) == bool(crosses[rows[t]]), "the forecast bar is known unless the horizon crosses a gap"
    assert any(w is not None for e in processed for w in e["forecastTimestamp"])
    (final,) = [b for b in capture.of("cycle_scoreboard") if b["scope"] == "final"]
    assert all(final["metrics"][name] is None for name in PRICE_FORECAST_METRIC_NAMES)
    assert final["metrics"]["accuracy"] is not None
    assert any(note.startswith("no resolved price forecasts") for note in final["notes"])
    assert capture.events[-1]["type"] == "done"


def test_the_run_ends_with_fold_records_a_final_scoreboard_and_done(full_run):
    events = full_run.capture.events
    fold_complete = [event for event in events if event["type"] == "fold_complete"]
    assert [event["fold_idx"] for event in fold_complete] == [0, 1, 2]
    for event in fold_complete:
        assert {"net_profit_usd", "trade_count", "test_start", "test_end", "train_start"} <= set(event["metrics"])
    overlays = [event for event in events if event["type"] == "overlay"]
    assert len(overlays) == 3 and all(event["overlayType"] == "prediction_markers" for event in overlays)
    assert [len(event["timestamps"]) for event in overlays] == [fold["testBarCount"] for fold in plan_of(full_run)["folds"]]
    boards = full_run.capture.of("cycle_scoreboard")
    scopes = [b["scope"] for b in boards]
    assert scopes.count("final") == 1 and scopes[-1] == "final"
    assert "running" in scopes
    assert events[-1]["type"] == "done"
    assert events[-1]["diagnostics"]["stopped"] is False
    assert events.index(boards[-1]) < len(events) - 1
    cursors = full_run.capture.of("cycle_cursor")
    assert cursors[0]["phase"] == "loading"
    assert cursors[-1]["phase"] == "complete" and cursors[-1]["overallFraction"] == 1.0
    fractions = [c["overallFraction"] for c in cursors]
    assert all(b >= a for a, b in zip(fractions, fractions[1:])), "overall progress never goes back"
    assert {"loading", "training", "validating", "testing", "complete"} <= {c["phase"] for c in cursors}
    assert {c["stepUnit"] for c in cursors if c["phase"] == "training"} - {None} == {"solver_pass"}
    epochs = full_run.capture.of("cycle_epoch")
    assert {e["foldIndex"] for e in epochs} == {0, 1, 2}
    assert all(e["trial"] is None and e["stepUnit"] == "solver_pass" for e in epochs)
    assert not any(event["type"] == "error" for event in events)


def test_artifacts_are_written_with_full_word_columns(full_run, market):
    directory = full_run.directory
    predictions = pq.read_table(directory / "predictions.parquet")
    trades = pq.read_table(directory / "trades.parquet")
    assert predictions.column_names == [
        "timestamp", "fold_index", "open", "high", "low", "close", "volume", "probability_up", "predicted_direction",
        "target_position", "position_held", "bar_net_profit_usd", "exposed", "crosses_gap", "equity_usd",
        "actual_direction", "correct", "predicted_move_points", "predicted_move_raw_points", "predicted_close",
        "forecast_timestamp", "forecast_error_points",
    ]
    # every forecast is a price the market can print, and the move follows it
    frame_forecast = predictions.to_pydict()
    for close, predicted_close, move in zip(frame_forecast["close"], frame_forecast["predicted_close"], frame_forecast["predicted_move_points"]):
        if predicted_close is None:
            assert move is None
            continue
        assert is_on_tick(predicted_close, MNQ.tick_size), predicted_close
        assert move == pytest.approx(predicted_close - close, abs=1e-9)
    # the position carried through a bar is the target set on the previous bar
    held, target = frame_forecast["position_held"], frame_forecast["target_position"]
    for position in range(1, len(held)):
        if frame_forecast["fold_index"][position] == frame_forecast["fold_index"][position - 1]:
            assert held[position] == target[position - 1]
    # the bar's own net USD sums to the equity curve
    equity = 0.0
    for net, total in zip(frame_forecast["bar_net_profit_usd"], frame_forecast["equity_usd"]):
        equity += net
        assert total == pytest.approx(equity, abs=1e-6)
    runs_table = pq.read_table(directory / "runs_table.parquet").to_pydict()
    assert runs_table["status"] == ["complete"] and runs_table["folds_completed"] == [3] and runs_table["tuning_enabled"] == [False]
    # when the run began and ended on the wall clock, in that order, in epoch seconds
    (started,), (finished,) = runs_table["started_at_timestamp"], runs_table["finished_at_timestamp"]
    assert started is not None and 1_700_000_000 < started <= finished
    bars_table = pq.read_table(directory / "bars.parquet")
    assert bars_table.num_rows == len(full_run.engine.emitted_timestamps)
    assert bars_table.to_pydict()["timestamp"] == full_run.engine.emitted_timestamps
    metrics_table = pq.read_table(directory / "metrics.parquet").to_pydict()
    assert set(metrics_table["metric_name"]) >= {"net_profit_usd", "sharpe_ratio", "accuracy"}
    assert set(metrics_table["fold_index"]) == {0, 1, 2}
    assert trades.column_names == [
        "trade_number", "fold_index", "side", "contracts", "entry_timestamp", "entry_price", "exit_timestamp",
        "exit_price", "bars_held", "probability_up_at_entry", "gross_profit_usd", "cost_usd", "net_profit_usd",
        "exit_reason",
    ]
    abbreviations = {"ts", "tf", "idx", "prob", "pnl", "qty", "px", "vol", "pct", "num", "cnt", "val", "ret", "ms",
                     "avg", "std", "acc", "lr", "tp", "sl", "dir", "pos", "eq"}
    for name in ("epochs", "trials", "folds_table", "bars", "metrics", "runs_table"):
        table = pq.read_table(directory / f"{name}.parquet")
        for column in table.column_names:
            assert not set(column.split("_")) & abbreviations, f"{name}.{column}"
    processed = [(t, e, p) for event in full_run.capture.of("cycle_bars") if event["role"] == "processed"
                 for t, e, p in zip(event["timestamps"], event["equityUsd"], event["probabilityUp"])]
    frame = predictions.to_pydict()
    assert frame["timestamp"] == [t for t, _, _ in processed]
    assert frame["equity_usd"] == pytest.approx([e for _, e, _ in processed])
    closed = [t for t in full_run.capture.of("cycle_trade") if t["status"] == "closed"]
    assert trades.num_rows == len(closed)
    assert trades.to_pydict()["net_profit_usd"] == pytest.approx([t["netProfitUsd"] for t in closed])
    for name in ("config.json", "folds.json", "scoreboard.json", "diagnostics.json"):
        json.loads((directory / name).read_text(encoding="utf-8"))     # strictly valid JSON (no NaN)
    diagnostics = json.loads((directory / "diagnostics.json").read_text(encoding="utf-8"))
    assert diagnostics["stopped"] is False and diagnostics["lake"] is None
    for fold in range(3):
        assert (directory / f"fold_{fold}" / "model.json").exists()


# ═══ the same events against the real zod schemas ══════════════════════════


ZOD_SCRIPT = r"""
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
const { CYCLE_EVENT_SCHEMAS } = await import(pathToFileURL(process.argv[2]).href);
const counts = {};
const failures = [];
for (const line of readFileSync(process.argv[3], "utf8").split("\n")) {
  if (!line) continue;
  const event = JSON.parse(line);
  const schema = CYCLE_EVENT_SCHEMAS[event.type];
  if (!schema) continue;
  counts[event.type] = (counts[event.type] ?? 0) + 1;
  const result = schema.safeParse(event);
  if (!result.success && failures.length < 10) {
    failures.push({ type: event.type, seq: event.seq, issues: result.error.issues.slice(0, 3) });
  }
}
console.log(JSON.stringify({ counts, failures }));
"""


def run_zod(events: list[dict], directory: Path) -> dict:
    node = shutil.which("node")
    if node is None or not (REPOSITORY / "node_modules" / "tsx").exists():
        pytest.skip("node and the repository's tsx are needed to load the zod schemas")
    script = directory / "validate_cycle_events.mjs"
    script.write_text(ZOD_SCRIPT, encoding="utf-8")
    lines = directory / "events.jsonl"
    lines.write_text("\n".join(json.dumps(event) for event in events) + "\n", encoding="utf-8")
    completed = subprocess.run([node, "--import", "tsx", str(script), str(SCHEMA), str(lines)], cwd=REPOSITORY,
                               capture_output=True, text=True, timeout=120)
    assert completed.returncode == 0, completed.stderr
    return json.loads(completed.stdout.strip().splitlines()[-1])


@pytest.mark.parametrize("which", ["full", "tuned", "stopped"])
def test_the_report_reproduces_every_scoreboard(which, full_run, tuned_run, stopped_run):
    """The in-depth tables (cycle/report.py), rebuilt from the landed record, carry the thirty
    scoreboard metrics exactly as the engine scored them: the final scoreboard and every fold's."""
    from cycle import report

    run = {"full": full_run, "tuned": tuned_run, "stopped": stopped_run}[which]
    tables = {name: pq.read_table(run.directory / f"{name}.parquet") for name in report.REPORT_TABLES}
    engine = run.engine

    def check(scope, fold_index, expected):
        ours = report.scoreboard_values(tables, scope, fold_index)
        assert set(ours) == set(METRIC_NAMES)
        for name in METRIC_NAMES:
            if expected.get(name) is None:
                assert ours[name] is None, (scope, fold_index, name)
            else:
                assert ours[name] == pytest.approx(expected[name], rel=1e-9, abs=1e-9), (scope, fold_index, name)

    check("run", None, engine.final_scoreboard["metrics"])
    for record in engine.fold_records:
        if record.get("metrics"):
            check("fold", record["foldIndex"], record["metrics"])
    folds = pq.read_table(run.directory / "folds_table.parquet").to_pydict()
    assert folds["majority_class_up"] == [record["majorityClassUp"] for record in engine.fold_records]


def test_every_cycle_event_passes_the_zod_schemas(full_run, tuned_run, stopped_run, tmp_path):
    events = full_run.capture.events + tuned_run.capture.events + stopped_run.capture.events
    result = run_zod(events, tmp_path)
    assert result["failures"] == []
    assert set(result["counts"]) == {"cycle_plan", "cycle_bars", "cycle_cursor", "cycle_epoch", "cycle_trial",
                                     "cycle_parameters", "cycle_trade", "cycle_scoreboard"}


# ═══ tuning ════════════════════════════════════════════════════════════════


@pytest.fixture(scope="module")
def tuned_run(market, tmp_path_factory) -> Run:
    return run_engine(market, tmp_path_factory.mktemp("tuned_run"), tuned=True, tuning_trials=3,
                      tuning_objective="sharpe_ratio", tuning_folds=2, fold_limit=2, quiet_bars=True)


def fold_of_last_bar(plan: dict, last_bar: int) -> int:
    """The fold whose test span begins right after ``last_bar`` (the bar on the
    chart when a fit or a prediction ran): tuning for fold k runs after the
    context up to k's test span was emitted."""
    return next(fold["foldIndex"] for fold in plan["folds"] if fold["testStart"] > last_bar)


def test_tuning_runs_every_trial_and_reports_each_inside_every_fold(tuned_run):
    """Tuning runs inside EVERY fold: three trials per fold, each reported running then finished,
    with the fold's own best trial on every event."""
    trials = tuned_run.capture.of("cycle_trial")
    assert {t["foldIndex"] for t in trials} == {0, 1}
    for fold in (0, 1):
        for number in range(3):
            states = [t["state"] for t in trials if t["trial"] == number and t["foldIndex"] == fold]
            assert states[0] == "running" and len(states) == 2
            assert states[1] in ("complete", "pruned"), states
    assert all(t["trialCount"] == 3 and t["objectiveName"] == "sharpe_ratio" for t in trials)
    finished = [t for t in trials if t["state"] == "complete"]
    assert finished and all(t["objectiveValue"] is not None for t in finished)
    assert all(set(t["parameters"]) == {"regularization_strength"} for t in trials)
    for fold in (0, 1):
        fold_trials = [t for t in trials if t["foldIndex"] == fold]
        best = max((t for t in fold_trials if t["state"] == "complete"), key=lambda t: t["objectiveValue"])
        assert fold_trials[-1]["bestTrial"] == best["trial"]
        assert fold_trials[-1]["bestValue"] == pytest.approx(best["objectiveValue"])
    cursors = [c for c in tuned_run.capture.of("cycle_cursor") if c["phase"] == "tuning"]
    assert cursors and all(c["trialCount"] == 3 for c in cursors) and {c["foldIndex"] for c in cursors} == {0, 1}
    assert len(tuned_run.engine.trial_records) == 6
    assert sorted({record["fold_index"] for record in tuned_run.engine.trial_records}) == [0, 1]


def test_each_fold_is_fitted_with_its_own_best_trial(tuned_run):
    """Each fold's models are fitted with the best trial of ITS OWN search (announced by
    `cycle_parameters`); the run's base parameters never change."""
    trials = tuned_run.capture.of("cycle_trial")
    announced = tuned_run.capture.of("cycle_parameters")
    assert [e["foldIndex"] for e in announced] == [0, 1]
    assert tuned_run.engine.parameters["regularization_strength"] == 1.0            # the base is untouched
    plan = plan_of(tuned_run)
    outer = [fit for fit in tuned_run.recorder.fits if fit["phase"] == "training"]
    assert len(outer) == 2
    for fold, event, fit in zip((0, 1), announced, outer):
        fold_trials = [t for t in trials if t["foldIndex"] == fold]
        best_trial = fold_trials[-1]["bestTrial"]
        (best_running,) = [t for t in fold_trials if t["trial"] == best_trial and t["state"] == "running"]
        best_strength = best_running["parameters"]["regularization_strength"]
        assert event["source"] == "tuned" and event["bestTrial"] == best_trial and event["trialCount"] == 3
        assert event["objectiveName"] == "sharpe_ratio" and event["pinned"] == []
        assert event["parameters"]["regularization_strength"] == pytest.approx(best_strength)
        assert tuned_run.engine.fold_parameters[fold]["regularization_strength"] == pytest.approx(best_strength)
        assert tuned_run.engine.tuning_summaries[fold]["bestTrial"] == best_trial
        assert fit["parameters"]["regularization_strength"] == pytest.approx(best_strength)
        assert fold_of_last_bar(plan, fit["last_bar"]) == fold
    tuning_fits = [fit for fit in tuned_run.recorder.fits if fit["phase"] == "tuning"]
    assert len(tuning_fits) == 2 * 3 * 2                              # two folds, three trials, two inner blocks each
    assert {round(fit["parameters"]["regularization_strength"], 12) for fit in tuning_fits} == {
        round(t["parameters"]["regularization_strength"], 12) for t in trials if t["state"] == "running"}
    config = json.loads((tuned_run.directory / "config.json").read_text(encoding="utf-8"))
    assert config["baseParameters"]["regularization_strength"] == 1.0
    for fold, event in zip((0, 1), announced):
        assert config["parametersByFold"][str(fold)]["regularization_strength"] == pytest.approx(
            event["parameters"]["regularization_strength"])
        assert config["tuning"]["perFold"][str(fold)]["bestTrial"] == event["bestTrial"]
    assert tuned_run.diagnostics["tuning"]["perFold"]["0"]["bestTrial"] == announced[0]["bestTrial"]
    trials_table = pq.read_table(tuned_run.directory / "trials.parquet").to_pydict()
    assert len(trials_table["trial"]) == 6 and sorted(set(trials_table["fold_index"])) == [0, 1]
    folds_table = pq.read_table(tuned_run.directory / "folds_table.parquet").to_pydict()
    assert folds_table["tuning_best_trial"] == [announced[0]["bestTrial"], announced[1]["bestTrial"]]
    assert folds_table["status"] == ["complete", "complete"]


def test_tuning_sees_only_bars_before_its_own_fold_test_span(tuned_run, market):
    """A fold's search fits and scores only bars before that fold's test span, and finishes
    (parameters announced) before the fold's first test bar is processed."""
    plan = plan_of(tuned_run)
    rows = rows_of(market)
    assert plan["tuning"]["perFold"] is True and plan["tuning"]["mode"] == "tuned"
    assert plan["tuning"]["trialCount"] == 3 and plan["tuning"]["innerFoldCount"] == 2
    test_row = {fold["foldIndex"]: rows[fold["testStart"]] for fold in plan["folds"]}
    # the fold's outer validation rows choose the fitted model's best epoch, so no trial fits or scores on them
    validation_row = {fold["foldIndex"]: rows[fold["validationStart"]] for fold in plan["folds"]}
    tuning_fits = [fit for fit in tuned_run.recorder.fits if fit["phase"] == "tuning"]
    assert {fold_of_last_bar(plan, fit["last_bar"]) for fit in tuning_fits} == {0, 1}
    for fit in tuning_fits:
        fold = fold_of_last_bar(plan, fit["last_bar"])
        assert fit["train"].max() + HORIZON < fit["validation"].min()
        assert fit["validation"].max() + HORIZON < test_row[fold]
        assert fit["validation"].max() + HORIZON < validation_row[fold]
        assert fit["last_bar"] == market.data.timestamps[test_row[fold] - 1]
    tuning_predictions = [(index, last_bar) for index, last_bar, phase in tuned_run.recorder.predictions if phase == "tuning"]
    assert tuning_predictions
    for index, last_bar in tuning_predictions:
        fold = fold_of_last_bar(plan, last_bar)
        assert int(index.max()) < test_row[fold]
        assert int(index.max()) + HORIZON < validation_row[fold]
    events = tuned_run.capture.events
    for fold in (0, 1):
        first_processed = next(i for i, e in enumerate(events)
                               if e["type"] == "cycle_bars" and e["role"] == "processed" and e["foldIndex"] == fold)
        last_trial = max(i for i, e in enumerate(events) if e["type"] == "cycle_trial" and e["foldIndex"] == fold)
        announced = next(i for i, e in enumerate(events) if e["type"] == "cycle_parameters" and e["foldIndex"] == fold)
        assert last_trial < announced < first_processed


# ═══ stop and pause ════════════════════════════════════════════════════════


@pytest.fixture(scope="module")
def stopped_run(market, tmp_path_factory) -> Run:
    """Long only with a holding period longer than any fold, so the first long
    stays open until the fold ends — or until the stop. The stop is applied
    while the engine is sending bars of the second fold, the moment a control
    command usually lands: a paced walk shows each bar before it sleeps, and
    the command wakes it (2000 bars/s keeps the run short)."""

    control = ControlState(2000.0)
    state = {"stopped_at": None}

    def before(engine, capture):
        def hook(event):
            if state["stopped_at"] is not None or event["type"] != "cycle_bars" or event["role"] != "processed":
                return
            trade = engine.simulator.trade if engine.simulator else None
            fold_end = engine.folds[1].test_index[-1] if len(engine.folds) > 1 else None
            last_row = int(np.searchsorted(engine.data.timestamps, event["timestamps"][-1]))
            if event["foldIndex"] == 1 and trade is not None and trade.bars_held >= 5 and last_row < fold_end:
                state["stopped_at"] = event["timestamps"][-1]
                control.apply({"command": "stop"})

        capture.hooks.append(hook)

    run = run_engine(market, tmp_path_factory.mktemp("stopped_run"), before=before, control=control,
                     long_only=True, holding_bars=10_000, bars_per_second=2000.0, quiet_bars=True)
    run.stopped_at = state["stopped_at"]
    return run


def test_stop_closes_the_open_trade_at_the_next_bars_open(stopped_run, market):
    """A stop fills like every other exit: decided at the last walked bar,
    filled at the next bar's open, and that bar is walked (emitted once, as a
    processed bar with no prediction and a flat position)."""
    assert stopped_run.stopped_at is not None, "the run never reached the stop point"
    rows = rows_of(market)
    processed = [event for event in stopped_run.capture.of("cycle_bars") if event["role"] == "processed"]
    walked = [t for event in processed for t in event["timestamps"]]
    assert walked == sorted(set(walked)), "every processed bar is emitted once, in order"
    exit_bar = walked[-1]
    assert rows[exit_bar] == rows[stopped_run.stopped_at] + 1, "exactly one bar is walked after the stop: the exit bar"
    last_event = processed[-1]
    assert last_event["probabilityUp"][-1] is None and last_event["predictedDirection"][-1] == 0
    assert last_event["position"][-1] == 0
    # the exit bar is a fill, not a prediction: no forecast either
    assert last_event["predictedClose"][-1] is None and last_event["forecastTimestamp"][-1] is None
    assert all(c is not None for c in last_event["predictedClose"][:-1])
    trades = stopped_run.capture.of("cycle_trade")
    stopped = [t for t in trades if t["status"] == "closed" and t["exitReason"] == "stopped"]
    assert len(stopped) == 1
    (trade,) = stopped
    assert trade["foldIndex"] == 1 and trade["side"] == "long"
    assert trade["exitTimestamp"] == exit_bar
    assert trade["exitPrice"] == market.data.open[rows[exit_bar]]
    assert trade["costUsd"] == pytest.approx(2 * MNQ.cost_per_side * CONTRACTS)
    opened = {t["tradeNumber"] for t in trades if t["status"] == "open"}
    closed = {t["tradeNumber"] for t in trades if t["status"] == "closed"}
    assert opened == closed


def test_stop_ends_with_a_final_scoreboard_a_stopped_cursor_and_done(stopped_run):
    events = stopped_run.capture.events
    boards = stopped_run.capture.of("cycle_scoreboard")
    (final,) = [b for b in boards if b["scope"] == "final"]
    assert final["notes"][0].startswith("stopped by the user")
    assert [b["foldIndex"] for b in boards if b["scope"] == "fold"] == [0]    # fold 2 never finished
    assert [e["fold_idx"] for e in events if e["type"] == "fold_complete"] == [0]
    cursors = stopped_run.capture.of("cycle_cursor")
    assert cursors[-1]["phase"] == "stopped"
    assert events[-1]["type"] == "done"
    assert events[-1]["diagnostics"]["stopped"] is True
    assert any(line == "[control] stop requested" for line in stopped_run.capture.logs())
    folds = json.loads((stopped_run.directory / "folds.json").read_text(encoding="utf-8"))
    assert len(folds) == 2 and folds[1]["stopped"] is True and "metrics" in folds[1]
    assert not any(event["type"] == "error" for event in events)


def test_after_a_stop_equity_the_trades_and_the_scoreboard_still_agree(stopped_run):
    closed = [t for t in stopped_run.capture.of("cycle_trade") if t["status"] == "closed"]
    realised = sum(t["netProfitUsd"] for t in closed)
    (final,) = [b for b in stopped_run.capture.of("cycle_scoreboard") if b["scope"] == "final"]
    assert final["metrics"]["net_profit_usd"] == pytest.approx(realised, abs=1e-6)
    processed = [event for event in stopped_run.capture.of("cycle_bars") if event["role"] == "processed"]
    assert processed[-1]["equityUsd"][-1] == pytest.approx(realised, abs=1e-6), (
        "the chart's last equity must include the stop's exit fill"
    )
    assert processed[-1]["position"][-1] == 0
    frame = pq.read_table(stopped_run.directory / "predictions.parquet").to_pydict()
    assert frame["equity_usd"][-1] == pytest.approx(realised, abs=1e-6)
    assert frame["timestamp"][-1] == processed[-1]["timestamps"][-1]


def test_expanding_windows_and_a_step_longer_than_the_test_window(market, tmp_path):
    run = run_engine(market, tmp_path, expanding_window=True, step_days=14, test_days=7, fold_limit=0,
                     embargo_bars=0, quiet_bars=True)
    plan = plan_of(run)
    folds = plan["folds"]
    # test windows start on days 21 and 35 (range(21, 48, 14)); every training window starts at the data start
    assert [f["testStart"] for f in folds] == [FIRST_MONDAY + day * 86_400 + 13 * 3_600 + 30 * 60 for day in (21, 35)]
    first_valid = int(market.data.timestamps[30])                    # the first row with feature history
    assert [f["trainStart"] for f in folds] == [first_valid, first_valid]
    assert folds[1]["trainBarCount"] > folds[0]["trainBarCount"]
    # the untested week between the two test windows is shown as context, once, in order
    emitted = [(t, e["role"]) for e in run.capture.of("cycle_bars") for t in e["timestamps"]]
    assert [t for t, _ in emitted] == market.data.timestamps[: rows_of(market)[folds[-1]["testEnd"]] + 1].tolist()
    gap = [role for t, role in emitted if folds[0]["testEnd"] < t < folds[1]["testStart"]]
    assert len(gap) == 5 * BARS_PER_DAY and set(gap) == {"context"}


def test_a_fold_without_enough_labelled_history_is_skipped_with_a_warning(market, tmp_path):
    matrix = market.features.matrix.copy()
    # no feature history until row 1400 (the third Friday afternoon): the fold testing week 4 has
    # no labelled training row with history left and is skipped; the fold testing week 5 keeps rows
    # 1400..1624 of its training split, less the few whose move is inside the label threshold
    matrix[:1400] = np.nan
    thin = Market(market.data, FeatureSet(matrix, market.features.names))
    run = run_engine(thin, tmp_path, fold_limit=0, quiet_bars=True)
    folds = plan_of(run)["folds"]
    assert len(folds) == 3 and [f["foldIndex"] for f in folds] == [0, 1, 2]
    assert 200 < folds[0]["trainBarCount"] <= 1624 - 1400 + 1
    skipped = [line for line in run.capture.logs() if line.startswith("[plan] skipped the fold testing")]
    assert len(skipped) == 1 and "2026-03-23" in skipped[0]
    warnings = [e for e in run.capture.events if e["type"] == "log" and e["message"] in skipped]
    assert warnings[0]["level"] == "warn"
    assert run.capture.events[-1]["type"] == "done"


def test_a_non_finite_prediction_is_not_traded_and_is_warned_once(market, tmp_path):
    class Gappy(RecordingAdapter):
        def predict_probability(self, features, index):
            values = super().predict_probability(features, index).copy()
            values[np.asarray(index) % 5 == 0] = np.nan
            return values

    with capturing() as capture:
        recorder = Recorder(capture)
        engine = CycleEngine(settings_for(tmp_path, fold_limit=1, quiet_bars=True), market.data, market.features, MNQ,
                             lambda parameters, task="classification": FakeRegressor() if task == "regression" else
                             Gappy(build_adapter("logistic_regression", parameters, "cpu", 42), recorder))
        engine.run()
    rows = rows_of(market)
    bars = [(t, p, d) for e in capture.of("cycle_bars") if e["role"] == "processed"
            for t, p, d in zip(e["timestamps"], e["probabilityUp"], e["predictedDirection"])]
    missing = [(t, p, d) for t, p, d in bars if rows[t] % 5 == 0]
    assert missing and all(p is None and d == 0 for _, p, d in missing)
    assert all(p is not None for t, p, _ in bars if rows[t] % 5)
    entries = [t["entryTimestamp"] for t in capture.of("cycle_trade") if t["status"] == "open"]
    assert entries and all((rows[t] - 1) % 5 != 0 for t in entries), "a trade was decided on a bar with no prediction"
    warned = [line for line in capture.logs() if "non-finite probability" in line]
    assert len(warned) == 1
    assert capture.events[-1]["type"] == "done"


def test_a_stop_during_training_ends_the_run_after_the_folds_already_walked(market, tmp_path):
    control = ControlState(0.0)

    def before(engine, capture):
        def hook(event):
            if event["type"] == "cycle_epoch" and event["foldIndex"] == 1 and not control.stop_requested:
                control.apply({"command": "stop"})
        capture.hooks.append(hook)

    run = run_engine(market, tmp_path, before=before, control=control, quiet_bars=True)
    events = run.capture.events
    processed = [e for e in run.capture.of("cycle_bars") if e["role"] == "processed"]
    assert {e["foldIndex"] for e in processed} == {0}
    assert [e["fold_idx"] for e in events if e["type"] == "fold_complete"] == [0]
    (final,) = [b for b in run.capture.of("cycle_scoreboard") if b["scope"] == "final"]
    assert final["barsEvaluated"] == plan_of(run)["folds"][0]["testBarCount"]
    assert final["notes"][0].startswith("stopped by the user")
    closed = [t for t in run.capture.of("cycle_trade") if t["status"] == "closed"]
    assert not any(t["exitReason"] == "stopped" for t in closed)       # fold 1 ended flat before the stop
    assert final["metrics"]["net_profit_usd"] == pytest.approx(sum(t["netProfitUsd"] for t in closed), abs=1e-6)
    assert run.capture.of("cycle_cursor")[-1]["phase"] == "stopped"
    assert events[-1]["type"] == "done" and events[-1]["diagnostics"]["stopped"] is True


def test_a_stop_during_tuning_fails_the_trial_and_ends_before_any_test_bar(market, tmp_path):
    control = ControlState(0.0)

    def before(engine, capture):
        def hook(event):
            if event["type"] == "cycle_trial" and event["state"] == "running" and not control.stop_requested:
                control.apply({"command": "stop"})
        capture.hooks.append(hook)

    run = run_engine(market, tmp_path, before=before, control=control, tuned=True, tuning_trials=3,
                     quiet_bars=True)
    trials = run.capture.of("cycle_trial")
    assert [(t["trial"], t["state"]) for t in trials] == [(0, "running"), (0, "failed")]
    assert not [e for e in run.capture.of("cycle_bars") if e["role"] == "processed"]
    emitted = [t for e in run.capture.of("cycle_bars") for t in e["timestamps"]]
    assert emitted[-1] < plan_of(run)["folds"][0]["testStart"]
    (final,) = [b for b in run.capture.of("cycle_scoreboard") if b["scope"] == "final"]
    assert final["barsEvaluated"] == 0 and final["metrics"]["sharpe_ratio"] is None
    assert final["metrics"]["net_profit_usd"] == 0.0
    events = run.capture.events
    assert events[-1]["type"] == "done" and events[-1]["diagnostics"]["stopped"] is True
    assert pq.read_table(run.directory / "predictions.parquet").num_rows == 0


def wait_for(condition, timeout: float = 30.0) -> None:
    deadline = time.monotonic() + timeout
    while not condition():
        assert time.monotonic() < deadline, "timed out"
        time.sleep(0.01)


def test_pause_blocks_progress_and_resume_continues(market, tmp_path):
    # paced so that bars are shown one at a time and the pause lands mid-walk
    control = ControlState(2000.0, start_paused=True)
    paused_once = threading.Event()
    outcome: dict = {}
    walked = {"bars": 0}

    with capturing() as capture:
        engine, _ = build_engine(market, tmp_path, capture, control=control, start_paused=True, fold_limit=1,
                                 bars_per_second=2000.0, quiet_bars=True)

        def processed_count() -> int:
            return walked["bars"]

        def hook(event):
            if event["type"] != "cycle_bars" or event["role"] != "processed":
                return
            walked["bars"] += len(event["timestamps"])
            if not paused_once.is_set() and walked["bars"] >= 100:
                paused_once.set()
                control.apply({"command": "pause"})

        capture.hooks.append(hook)

        def run():
            try:
                outcome["diagnostics"] = engine.run()
            except BaseException as error:  # surfaced below
                outcome["error"] = error

        worker = threading.Thread(target=run, daemon=True)
        worker.start()
        # 1. started paused: planned, then blocked before any fitting
        wait_for(lambda: any("starting paused" in line for line in capture.logs()))
        time.sleep(0.4)
        assert worker.is_alive()
        assert not capture.of("cycle_epoch") and not capture.of("cycle_bars")
        assert not any(c["phase"] == "training" for c in capture.of("cycle_cursor"))
        assert any(c["paused"] for c in capture.of("cycle_cursor"))
        control.apply({"command": "resume"})
        # 2. paused mid-walk from the event hook
        wait_for(lambda: sum(line == "[control] paused" for line in capture.logs()) >= 1 and paused_once.is_set())
        time.sleep(0.2)
        frozen = processed_count()
        time.sleep(0.6)
        assert processed_count() == frozen, "bars were walked while paused"
        assert worker.is_alive()
        assert 100 <= frozen < 478
        control.apply({"command": "resume"})
        worker.join(timeout=60)
        assert not worker.is_alive()
    assert "error" not in outcome, outcome.get("error")
    assert outcome["diagnostics"]["stopped"] is False
    assert processed_count() == 5 * BARS_PER_DAY - 2
    assert capture.events[-1]["type"] == "done"
    lines = capture.logs()
    assert "[control] resumed" in lines


# ═══ pacing ════════════════════════════════════════════════════════════════


def paced_run(market, directory, bars_per_second: float) -> Run:
    # one fold testing Monday..Thursday: 4 days x 96 bars - 2 embargoed = 382 bars
    return run_engine(market, directory, fold_limit=1, test_days=4, step_days=7, bars_per_second=bars_per_second,
                      quiet_bars=True)


def test_pacing_throttles_the_test_walk_and_zero_does_not(market, tmp_path):
    paced = paced_run(market, tmp_path / "paced", 200.0)
    free = paced_run(market, tmp_path / "free", 0.0)
    (fold,) = plan_of(paced)["folds"]
    assert fold["testBarCount"] == 382
    paced_seconds = paced.engine.fold_records[0]["testingSeconds"]
    free_seconds = free.engine.fold_records[0]["testingSeconds"]
    # 381 intervals of 1/200 s = 1.9 s
    assert paced_seconds >= 1.5
    assert paced_seconds < 4.0, "the pacer runs far slower than asked"
    assert 120 <= paced.diagnostics["testBarsPerSecond"] <= 210
    assert free_seconds < 1.0
    assert free.diagnostics["testBarsPerSecond"] > 400
    cursors = [c for c in paced.capture.of("cycle_cursor") if c["phase"] == "testing"]
    assert cursors and all(c["barsPerSecond"] == 200.0 for c in cursors)
    # frames and cursors stay at or below 20 a second (cycle_cursor's contract), however fast the pace:
    # consecutive frames are >= 50 ms apart except the fold's last, and each carries several bars
    frames = [event for event in paced.capture.of("cycle_bars") if event["role"] == "processed"]
    gaps = [(b["mono_ns"] - a["mono_ns"]) / 1e9 for a, b in zip(frames, frames[1:-1])]
    assert gaps and min(gaps) >= 0.045, min(gaps)
    assert len(frames) <= 20 * paced_seconds + 2
    assert len(cursors) <= 20 * paced_seconds + 5
    assert sum(len(event["timestamps"]) for event in frames) == 382


def test_a_pace_command_mid_walk_takes_effect(market, tmp_path):
    control = ControlState(20.0)

    def before(engine, capture):
        def hook(event):
            if event["type"] == "cycle_bars" and event["role"] == "processed" and control.bars_per_second == 20.0:
                control.apply({"command": "pace", "barsPerSecond": 0})
        capture.hooks.append(hook)

    run = run_engine(market, tmp_path, before=before, control=control, fold_limit=1, test_days=4, step_days=7,
                     bars_per_second=20.0, quiet_bars=True)
    # at 20 bars/s the walk would take 19 s; switched to unlimited after the first frame
    assert run.engine.fold_records[0]["testingSeconds"] < 3.0
    assert any("pace unlimited" in line for line in run.capture.logs())
    testing = [c for c in run.capture.of("cycle_cursor") if c["phase"] == "testing"]
    assert testing[-1]["barsPerSecond"] == 0.0


# ═══ run ids with "+" through main.py, landing mocked ═══════════════════════


def load_main(monkeypatch):
    monkeypatch.setattr(sys, "argv", ["main.py", "--device", "cpu"])   # keeps the import from loading torch
    return importlib.import_module("cycle.main")


def main_arguments(model_id: str) -> list[str]:
    return ["--symbol", "MNQ", "--timeframe", "5m", "--model-id", model_id, "--json",
            "--model-family", "logistic_regression", "--train-days", "21", "--test-days", "7", "--fold-limit", "1",
            "--label-horizon-bars", str(HORIZON), "--bars-per-second", "0", "--device", "cpu", "--quiet-bars",
            "--tuning-mode", "reviewed_defaults"]


class LandingCalls(list):
    """The landing subprocess commands main.py ran, plus every task it asked models.build_adapter for."""

    tasks: list[str]


def patch_main_inputs(monkeypatch, market: Market, directory: Path) -> LandingCalls:
    import shared.data

    data = market.data
    naive = [datetime.fromtimestamp(int(t), timezone.utc).replace(tzinfo=None) for t in data.timestamps]

    def load(symbol, timeframe, max_bars=0, date_range=None):
        return {"timestamp": naive, "open": data.open.copy(), "high": data.high.copy(), "low": data.low.copy(),
                "close": data.close.copy(), "volume": data.volume.copy()}

    monkeypatch.setattr(shared.data, "load_ohlcv_arrays", load)
    monkeypatch.chdir(directory)
    monkeypatch.setattr(sys, "stdin", io.StringIO(""))
    calls = LandingCalls()

    def fake_run(command, **kwargs):
        calls.append(command)
        job = json.loads(command[-1])
        result = {name: {"uri": f"s3://derived/{job['dataset']}/recipe={job['recipe']}/table={name}/part-0.parquet",
                         "rows": pq.read_table(path).num_rows, "bytes": 1, "manifest": "written"}
                  for name, path in job["tables"].items()}
        return subprocess.CompletedProcess(command, 0, stdout=json.dumps(result) + "\n", stderr="")

    monkeypatch.setattr(store.subprocess, "run", fake_run)

    def fake_land(job):
        # the in-process landing (lake.layout importable): captured the way the subprocess one is
        calls.append(["in-process", json.dumps(job)])
        return {name: {"uri": f"s3://derived/{job['dataset']}/recipe={job['recipe']}/table={name}/part-0.parquet",
                       "rows": pq.read_table(path).num_rows, "bytes": 1,
                       "manifest": "written" if name in job["manifest_for"] else "already written"}
                for name, path in job["tables"].items()}

    monkeypatch.setattr(store, "_land_job", fake_land)
    # main.py's factory passes task= through to models.build_adapter; the price model is the in-test regressor
    from cycle import models

    real = models.build_adapter
    tasks: list[str] = []

    def build(family, parameters, device, seed, task="classification"):
        tasks.append(task)
        return FakeRegressor() if task == "regression" else real(family, parameters, device, seed)

    monkeypatch.setattr(models, "build_adapter", build)
    calls.tasks = tasks
    return calls


def test_a_run_id_with_a_plus_runs_and_lands_under_an_underscore_recipe(market, tmp_path, monkeypatch):
    main = load_main(monkeypatch)
    calls = patch_main_inputs(monkeypatch, market, tmp_path)
    model_id = "MNQ_5m_logistic_regression+walk_forward_cycle_20260925T103846"
    with capturing() as capture:
        assert main.main(main_arguments(model_id)) == 0
    events = capture.events
    assert events[-1]["type"] == "done", [e for e in events if e["type"] == "error"]
    directory = tmp_path / "data" / "models" / model_id                # the directory keeps the "+"
    assert Path(events[-1]["modelPath"]) == directory.resolve()
    assert (directory / "predictions.parquet").exists() and (directory / "diagnostics.json").exists()
    # the record is landed at the end of the fold and again at the end of the run
    assert len(calls) == 2
    command = calls[-1]
    # one planning probe and one fold: classifier, then the price model
    assert calls.tasks == ["classification", "classification", "regression"]
    processed = [e for e in events if e["type"] == "cycle_bars" and e["role"] == "processed"]
    assert processed and any(c is not None for e in processed for c in e["predictedClose"])
    job = json.loads(command[-1])
    assert job["recipe"] == "MNQ_5m_logistic_regression_walk_forward_cycle_20260925T103846"
    assert "+" not in job["recipe"] and job["dataset"] == "model_cycle_runs"
    assert set(job["tables"]) == set(store.LAKE_TABLES)
    assert job["manifest_for"] == []                                     # the fold-end landing wrote every manifest line
    assert set(json.loads(calls[0][-1])["manifest_for"]) == set(store.LAKE_TABLES)
    assert model_id in job["source"]
    lake = events[-1]["diagnostics"]["lake"]
    assert set(lake) == set(store.LAKE_TABLES)
    assert all("recipe=MNQ_5m_logistic_regression_walk_forward_cycle_20260925T103846/" in v["uri"] for v in lake.values())
    assert lake["predictions"]["rows"] == events[-1]["diagnostics"]["barsProcessed"]
    for line in capture.logs():
        assert "could not land" not in line


@pytest.mark.parametrize("model_id", ["../escape", "a..b", "space id", "semi;colon"])
def test_an_unsafe_run_id_is_refused_before_anything_is_written(market, tmp_path, monkeypatch, model_id):
    main = load_main(monkeypatch)
    calls = patch_main_inputs(monkeypatch, market, tmp_path)
    with capturing() as capture:
        assert main.main(main_arguments(model_id)) == 1
    (error,) = capture.of("error")
    assert "not a safe directory name" in error["message"]
    assert not (tmp_path / "data").exists() and calls == []


# ═══ Inside-the-model artifacts, direction from price, no price model ══════════


def fitted_price_models(recorder: Recorder) -> list[FakeRegressor]:
    """The price models that were fitted, in fit order (the planning probe never is)."""
    return [model for model in recorder.price_models if model.weights is not None]


def test_the_raw_features_are_the_columns_the_z_score_was_taken_of(feature_set):
    assert feature_set.raw is not None and feature_set.raw.shape == feature_set.matrix.shape
    assert feature_set.raw.dtype == np.float32
    again = rolling_zscore(feature_set.raw.astype(np.float64), feature_set.lookback, feature_set.clip)
    np.testing.assert_allclose(again, feature_set.matrix, rtol=0, atol=2e-5, equal_nan=True)
    # the raw columns are in their own units, not z-scores
    assert np.nanmax(np.abs(feature_set.raw)) != pytest.approx(np.nanmax(np.abs(feature_set.matrix)))


def test_every_feature_has_a_full_word_display_name():
    from cycle.features import display_names, load_feature_config

    config = load_feature_config()
    names = [definition["name"] for definition in config["features"]]
    shown = display_names(names, config)
    assert all(definition.get("displayName") for definition in config["features"])
    assert shown == [definition["displayName"] for definition in config["features"]]
    assert len(set(shown)) == len(shown)
    assert all("_" not in name and name[0].isupper() for name in shown)
    assert display_names(["planted_signal"], config) == ["planted signal"]


def test_the_explain_inputs_are_what_the_engine_read(full_run, market):
    engine = full_run.engine
    directory = full_run.directory / "explain"
    # written as <name>.npy.zst (zstandard); read back through the same helper the explainer uses
    loaded = {name: compressed.read_array(str(directory / f"{name}.npy")) for name in (
        "features", "raw_features", "timestamps", "close", "move_scale", "labels", "price_target")}
    np.testing.assert_array_equal(loaded["features"], engine.features)
    assert loaded["features"].dtype == np.float32
    # the planted test features carry no raw columns: written as missing, and the manifest says so
    assert loaded["raw_features"].shape == engine.features.shape and np.isnan(loaded["raw_features"]).all()
    np.testing.assert_array_equal(loaded["timestamps"], market.data.timestamps)
    assert loaded["timestamps"].dtype == np.int64
    np.testing.assert_array_equal(loaded["close"], market.data.close)
    np.testing.assert_array_equal(loaded["move_scale"], engine.move_scale)
    np.testing.assert_array_equal(loaded["labels"], engine.labels)
    np.testing.assert_array_equal(loaded["price_target"], engine.price_targets)
    assert loaded["labels"].dtype == np.float32 and loaded["price_target"].dtype == np.float32
    manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
    plan = plan_of(full_run)
    assert manifest["version"] == 1 and manifest["modelId"] == "cycle_engine_test"
    assert manifest["modelKey"] == "logistic_regression" and manifest["displayName"] == "Logistic regression"
    assert manifest["explainKind"] == "linear" and manifest["directionMode"] == "classifier"
    assert manifest["hasPriceModel"] is True and manifest["rawFeaturesAvailable"] is False
    assert manifest["featureNames"] == market.features.names
    assert manifest["featureDisplayNames"] == [name.replace("_", " ") for name in market.features.names]
    assert manifest["sequenceLength"] == 1 and manifest["labelHorizonBars"] == HORIZON
    assert manifest["symbol"] == "MNQ" and manifest["timeframe"] == "5m"
    assert manifest["folds"] == [{"foldIndex": f["foldIndex"], "testStart": f["testStart"], "testEnd": f["testEnd"]}
                                 for f in plan["folds"]]


def test_each_fold_writes_its_rows_and_saves_each_model_before_the_walk(full_run):
    engine = full_run.engine
    logs = full_run.capture.logs()
    records = json.loads((full_run.directory / "folds.json").read_text(encoding="utf-8"))
    for spec, record in zip(engine.folds, records):
        k = spec.fold_index
        with np.load(full_run.directory / f"fold_{k}" / "index.npz") as index:
            assert set(index.files) == {"train", "validation", "test", "price_train", "price_validation"}
            for name, rows in (("train", spec.train_index), ("validation", spec.validation_index), ("test", spec.test_index),
                               ("price_train", spec.price_train_index), ("price_validation", spec.price_validation_index)):
                assert index[name].dtype == np.int64
                np.testing.assert_array_equal(index[name], rows)
        assert (full_run.directory / f"fold_{k}" / "model.json").exists()
        assert (full_run.directory / f"fold_{k}" / "price_model" / "price_model.npz").exists()
        assert record["modelPath"] and Path(record["modelPath"]).exists()
        assert record["priceModelPath"] and Path(record["priceModelPath"]).exists()
        # direction fit, its save, the price fit, its save, then the walk
        order = [next(i for i, line in enumerate(logs) if line.startswith(text)) for text in (
            f"[fold {k + 1}/3][train] fitted in", f"[save] fold {k + 1}/3 model -> ",
            f"[fold {k + 1}/3][train] price model fitted in", f"[save] fold {k + 1}/3 price model -> ",
            f"[fold {k + 1}/3][test] walking")]
        assert order == sorted(order)


def test_the_plan_carries_the_registry_fields(full_run):
    from cycle import catalog

    entry = catalog.entry("logistic_regression")
    plan = plan_of(full_run)
    assert plan["catalogSpecId"] == entry["catalogSpecId"]
    assert plan["implementation"] == "sklearn" and plan["explainKind"] == "linear"
    assert plan["directionMode"] == "classifier" and plan["hasPriceModel"] is True


def test_every_fitted_model_is_on_disk_after_a_stop_during_the_walk(stopped_run):
    assert stopped_run.stopped_at is not None
    records = json.loads((stopped_run.directory / "folds.json").read_text(encoding="utf-8"))
    assert [record["foldIndex"] for record in records] == [0, 1]
    assert records[1].get("stopped") is True
    for record in records:
        k = record["foldIndex"]
        assert Path(record["modelPath"]).exists() and Path(record["priceModelPath"]).exists()
        assert (stopped_run.directory / f"fold_{k}" / "index.npz").exists()
    assert not (stopped_run.directory / "fold_2").exists(), "the fold after the stop was never started"
    assert (stopped_run.directory / "explain" / "manifest.json").exists()


class DerivedRecorder(Recorder):
    """For a from_price key the engine asks the caller's factory only for price models."""

    def factory(self, parameters: dict, task: str = "classification"):
        assert task == "regression", "a from_price model never builds a classifier"
        return super().factory(parameters, task)


def run_from_price(market: Market, directory, *, tuned: bool = False, **overrides) -> Run:
    with capturing() as capture:
        recorder = DerivedRecorder(capture)
        suggest = None
        if tuned:
            def suggest(trial, base):
                return {**base, "alpha": trial.suggest_float("alpha", 0.1, 10.0, log=True)}
        settings = settings_for(directory, model_family="ridge_regression", model_parameters={"alpha": 1.0}, **overrides)
        engine = CycleEngine(settings, market.data, market.features, MNQ, recorder.factory, suggest_parameters=suggest)
        started = time.monotonic()
        diagnostics = engine.run()
        return Run(engine, diagnostics, capture, recorder, Path(directory), time.monotonic() - started)


@pytest.fixture(scope="module")
def from_price_run(market, tmp_path_factory) -> Run:
    return run_from_price(market, tmp_path_factory.mktemp("from_price_run"), quiet_bars=True)


def test_a_from_price_model_fits_once_per_fold_and_trades(from_price_run, market):
    run = from_price_run
    engine = run.engine
    assert engine.direction_mode == "from_price"
    plan = plan_of(run)
    assert plan["directionMode"] == "from_price" and plan["hasPriceModel"] is True and plan["explainKind"] == "linear"
    assert run.capture.events[-1]["type"] == "done" and not run.capture.of("error")
    # one fit per fold, on the fold's price rows and the price target: the price model and the direction model are one
    assert len(run.recorder.price_fits) == engine.fold_count == 3
    for fit, spec in zip(run.recorder.price_fits, engine.folds):
        np.testing.assert_array_equal(fit["train"], spec.price_train_index)
        np.testing.assert_array_equal(fit["validation"], spec.price_validation_index)
        assert fit["labels"] is engine.price_targets
    trades = [t for t in run.capture.of("cycle_trade") if t["status"] == "closed"]
    assert len(trades) > 10
    (final,) = [b for b in run.capture.of("cycle_scoreboard") if b["scope"] == "final"]
    assert final["metrics"]["accuracy"] is not None and final["metrics"]["accuracy"] > 0.55   # the planted signal
    assert final["metrics"]["price_forecast_mean_absolute_error_points"] is not None
    epochs = run.capture.of("cycle_epoch")
    assert {e["modelRole"] for e in epochs} == {"price"} and [e["foldIndex"] for e in epochs] == [0, 1, 2]
    logs = run.capture.logs()
    assert sum("has no classifier form" in line for line in logs) == 1
    assert sum(line.startswith("[fold 1/3][train] direction from price: fitting") for line in logs) == 1
    assert any(line.startswith("[fold 1/3][train] direction from the price model: P(up) = 1 / (1 + exp(-(")
               for line in logs)


def test_the_curve_is_fitted_on_the_validation_rows_only_and_is_what_the_walk_used(from_price_run, market):
    from cycle.derived import apply_logistic_curve, fit_logistic_curve

    run = from_price_run
    engine = run.engine
    models = fitted_price_models(run.recorder)
    assert len(models) == 3
    predictions = pq.read_table(run.directory / "predictions.parquet").to_pydict()
    rows = rows_of(market)
    # outside the walk each fold's price model is asked about exactly that fold's labelled validation rows, once
    asked = [index for index, _, phase in run.recorder.price_predictions if phase != "testing"]
    assert len(asked) == 3
    for spec, model, rows_asked in zip(engine.folds, models, asked):
        k = spec.fold_index
        np.testing.assert_array_equal(rows_asked, spec.validation_index)
        assert not np.intersect1d(rows_asked, spec.train_index).size
        metadata = json.loads((run.directory / f"fold_{k}" / "model.json").read_text(encoding="utf-8"))
        assert metadata["adapter"] == "derived" and metadata["key"] == "ridge_regression"
        assert metadata["curveValidationBarCount"] == spec.validation_index.size
        curve = (metadata["logisticCurve"]["slope"], metadata["logisticCurve"]["intercept"])
        scores = np.array([model.outputs[int(row)] for row in spec.validation_index])
        assert fit_logistic_curve(scores, engine.labels[spec.validation_index]) == pytest.approx(curve, rel=1e-9, abs=1e-12)
        assert curve[0] > 0, "a forecast of a rise should mean a higher P(up)"
        # the price model is saved inside the direction model's folder, and it is the fold's price model
        assert (run.directory / f"fold_{k}" / "price_model" / "price_model.npz").exists()
        # every test bar's P(up) is the curve applied to the price model's forecast at that bar
        walked = [position for position, fold in enumerate(predictions["fold_index"]) if fold == k]
        assert walked
        for position in walked:
            row = rows[predictions["timestamp"][position]]
            expected = apply_logistic_curve(curve, np.array([model.outputs[row]]))[0]
            assert predictions["probability_up"][position] == pytest.approx(expected, rel=1e-12)
            if predictions["crosses_gap"][position]:
                assert predictions["predicted_close"][position] is None
            else:
                assert predictions["predicted_close"][position] == pytest.approx(round_to_tick(
                    market.data.close[row] + model.outputs[row] * engine.move_scale[row], MNQ.tick_size), rel=1e-12)
    records = json.loads((run.directory / "folds.json").read_text(encoding="utf-8"))
    for record in records:
        assert record["modelPath"].endswith("model.json")
        assert record["priceModelPath"].endswith("price_model.npz")
        assert record["priceTrainingSeconds"] is None       # one fit, timed in trainingSeconds
        assert record["priceTrainBarCount"] > 0 and record["priceValidationBarCount"] > 0


def test_a_saved_from_price_model_reloads_and_predicts_the_same(from_price_run, market):
    from cycle.derived import DerivedDirectionAdapter

    def load_fake(directory, device):
        saved = np.load(Path(directory) / "price_model.npz")
        model = FakeRegressor()
        model.mean, model.scale, model.weights = saved["mean"], saved["scale"], saved["weights"]
        model.intercept = float(saved["intercept"][0])
        return model

    run = from_price_run
    spec = run.engine.folds[0]
    reloaded = DerivedDirectionAdapter.load(str(run.directory / "fold_0"), load_price_adapter=load_fake)
    predictions = pq.read_table(run.directory / "predictions.parquet").to_pydict()
    rows = rows_of(market)
    walked = [(rows[t], p) for t, f, p in zip(predictions["timestamp"], predictions["fold_index"],
                                              predictions["probability_up"]) if f == 0 and p is not None]
    index = np.array([row for row, _ in walked], dtype=np.int64)
    np.testing.assert_allclose(reloaded.predict_probability(market.features.matrix, index), [p for _, p in walked],
                               rtol=1e-12)
    assert reloaded.minimum_history() == 1 and spec.test_index[0] <= index.min()


def test_tuning_a_from_price_model_goes_through_the_same_factory(market, tmp_path):
    run = run_from_price(market, tmp_path, tuned=True, tuning_trials=3, tuning_objective="log_loss", tuning_folds=2,
                         fold_limit=2, quiet_bars=True)
    assert run.capture.events[-1]["type"] == "done" and not run.capture.of("error")
    tuning_fits = [fit for fit in run.recorder.price_fits if fit["phase"] == "tuning"]
    outer = [fit for fit in run.recorder.price_fits if fit["phase"] != "tuning"]
    assert len(tuning_fits) == 2 * 3 * 2 and len(outer) == 2      # two folds, each searched: 3 trials x 2 blocks
    first_test_row = int(run.engine.folds[0].test_index[0])
    for fit in tuning_fits:
        # the direction rows of the inner block whose price target is known
        assert np.isfinite(run.engine.labels[fit["train"]]).all()
        assert np.isfinite(run.engine.price_targets[fit["train"]]).all()
        assert fit["validation"].max() + HORIZON < first_test_row
    finished = [t for t in run.capture.of("cycle_trial") if t["state"] == "complete"]
    assert finished and all(t["objectiveValue"] is not None and math.isfinite(t["objectiveValue"]) for t in finished)
    assert "alpha" in run.engine.parameters


@pytest.fixture(scope="module")
def no_price_run(market, tmp_path_factory) -> Run:
    return run_engine(market, tmp_path_factory.mktemp("no_price_run"), model_family="probit_regression", quiet_bars=True)


def test_a_model_without_a_price_model_fits_none_and_draws_no_forecast(no_price_run):
    run = no_price_run
    assert run.capture.events[-1]["type"] == "done" and not run.capture.of("error")
    assert run.recorder.price_fits == [] and run.recorder.price_models == []
    plan = plan_of(run)
    assert plan["hasPriceModel"] is False and plan["directionMode"] == "classifier"
    processed = [e for e in run.capture.of("cycle_bars") if e["role"] == "processed"]
    assert processed and all(c is None for e in processed for c in e["predictedClose"])
    logs = run.capture.logs()
    assert sum("has no regression form" in line for line in logs) == 1
    assert not any("price model" in line for line in logs if "has no regression form" not in line)
    warnings = [e for e in run.capture.events if e["type"] == "log" and e.get("level") == "warn"]
    assert warnings == []
    assert {e["modelRole"] for e in run.capture.of("cycle_epoch")} == {"direction"}
    predictions = pq.read_table(run.directory / "predictions.parquet").to_pydict()
    assert all(v is None for v in predictions["predicted_close"])
    assert all(v is None for v in predictions["predicted_move_points"])
    records = json.loads((run.directory / "folds.json").read_text(encoding="utf-8"))
    assert all(record["priceModelPath"] is None and Path(record["modelPath"]).exists() for record in records)
    assert not any((run.directory / f"fold_{k}" / "price_model").exists() for k in range(3))
    with np.load(run.directory / "fold_0" / "index.npz") as index:
        assert index["price_train"].size == 0 and index["price_validation"].size == 0 and index["train"].size > 0
    config = json.loads((run.directory / "config.json").read_text(encoding="utf-8"))
    assert config["priceModel"] is None
    manifest = json.loads((run.directory / "explain" / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["hasPriceModel"] is False and manifest["modelKey"] == "probit_regression"
    (final,) = [b for b in run.capture.of("cycle_scoreboard") if b["scope"] == "final"]
    assert all(final["metrics"][name] is None for name in PRICE_FORECAST_METRIC_NAMES)


def test_a_key_the_registry_does_not_carry_runs_as_a_classifier_with_a_price_model(market, tmp_path):
    run = run_engine(market, tmp_path, model_family="planted_family", fold_limit=1, quiet_bars=True)
    assert run.capture.events[-1]["type"] == "done" and not run.capture.of("error")
    plan = plan_of(run)
    assert plan["catalogSpecId"] is None
    assert not {"implementation", "explainKind", "directionMode", "hasPriceModel"} & set(plan)
    assert len(run.recorder.price_fits) == 1
    manifest = json.loads((tmp_path / "explain" / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["explainKind"] is None and manifest["directionMode"] == "classifier" and manifest["hasPriceModel"]
