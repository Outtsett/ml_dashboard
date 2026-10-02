"""The shared gates every bridge key passes (build plan §3, per-unit gate 1).

A family's test file (``tests/test_cycle_bridge_<family>.py``) declares its
``KEYS`` and a ``FAST`` parameter map, and calls these functions for every
key. Each gate raises ``AssertionError`` with a sentence naming the key and
what failed; each is usable on its own.

    check_registry_entry(key)                     the entry follows the bridge conventions
    check_build_both_tasks(key, parameters)       both tasks build (NoPriceModel when price is null)
    check_predict_before_fit_raises(adapter, market)
    fit_on_market(factory, parameters, market, task)  -> (adapter, reporter)
    check_fit_reports(adapter, reporter)          step unit, >= 1 epoch_finished, checkpoints called
    check_stop_propagates(factory, parameters, market, task)
    check_probabilities(adapter, market)          P(up) in [0, 1] or NaN; one row == the batch (1e-9)
    check_learning_floor(adapter, market, floor)  holdout accuracy on the synthetic market
    check_predict_truncation(adapter, market)     features and view cut at t + 1: the prediction at t is unchanged
    check_reloaded_truncation(adapter, market, directory, loader)   the same on a reload bound ONLY to cut views
    check_fit_poison(factory, parameters, market, task, directory)  prices after validation + h (and the targets
                                                  made of them) poisoned: same saved model
    check_save_load(adapter, market, directory, loader)             reloaded + bound: same predictions (1e-6)
    check_minimum_history_stable(key, parameters) two Optuna draws, one history requirement
    check_ascii_logs(reporter)
    check_latency(adapter, market, milliseconds)  median single-row predict
    run_engine_fold(key, parameters, market, directory)            one engine fold end to end
    run_all_gates(key, parameters, market, directory, ...)         every gate above, in order

``synthetic_market(n, seed)`` is the fixture they run on: a persistent
two-state hidden regime with signed drift, AR(1) bar returns, OHLC bars with
a daily session break, features that noisily encode the regime (column 0,
``book_imbalance_top``) and the return lags, feature names drawn from the
``features.json`` categories, the engine's labels / price target / move scale,
a chronological train / validation / test split purged by the horizon exactly
as the engine purges, and the ``MarketView`` the engine would bind.
"""

from __future__ import annotations

import contextlib
import json
import math
import statistics
import time
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Callable

import numpy as np

from cycle import catalog
from cycle.adapter import NoPriceModel, StopRequested
from cycle.bridges import parameter_names, persistence
from cycle.engine import MarketData
from cycle.features import FeatureSet, history_valid
from cycle.labels import horizon_crosses_gap, make_labels, price_target
from cycle.market import MarketView
from cycle.simulate import load_cost_model

HORIZON = 6
GAP_MULTIPLE = 3.0
VOLATILITY_WINDOW = 50
TICK = 0.25
BAR_SECONDS = 300
SESSION_BARS = 276                    # 23 hours of 5-minute bars, then a one-hour break
FEATURE_NAMES = ("book_imbalance_top", "return_1", "return_5", "volatility_20", "volume_ratio_20", "ma_dist_20",
                 "roc_10", "finbert_sentiment_decayed_short")
WARMUP = 20
BRIDGE_NETWORKS = ("window_backbone", "feature_graph", "neuro_symbolic")
TRUNCATION_TOLERANCE = 1e-9
BATCH_TOLERANCE = 1e-9
RELOAD_TOLERANCE = 1e-6
DEFAULT_FLOOR = 0.55


# ─── the synthetic market ──────────────────────────────────────────────────


@dataclass
class SyntheticMarket:
    features: np.ndarray          # float32 (n, F), causal, unit scale
    raw: np.ndarray               # float32 (n, F), the same columns in their own units
    names: tuple[str, ...]
    labels: np.ndarray            # float32, 1 up / 0 down / NaN
    price_targets: np.ndarray     # float32, h-bar move / move scale
    move_scale: np.ndarray
    timestamps: np.ndarray
    data: MarketData
    feature_set: FeatureSet
    view: MarketView
    cost: object
    horizon: int
    regime: np.ndarray            # the hidden state (0 down-drift, 1 up-drift); never a feature
    train_index: np.ndarray
    validation_index: np.ndarray
    test_index: np.ndarray
    price_train_index: np.ndarray
    price_validation_index: np.ndarray

    def targets(self, task: str) -> np.ndarray:
        return self.labels if task == "classification" else self.price_targets

    def fit_rows(self, task: str) -> tuple[np.ndarray, np.ndarray]:
        if task == "classification":
            return self.train_index, self.validation_index
        return self.price_train_index, self.price_validation_index

    def holdout(self, task: str) -> np.ndarray:
        """Test rows with a known target."""
        rows = self.test_index
        return rows[np.isfinite(self.targets(task)[rows])]


def _timestamps(count: int, start: int = 1_736_121_600) -> np.ndarray:     # 2025-01-06 00:00 UTC, a Monday
    stamps = np.empty(count, dtype=np.int64)
    current = start
    for row in range(count):
        stamps[row] = current
        current += BAR_SECONDS
        if (row + 1) % SESSION_BARS == 0:
            current += 3600                                                    # the session break
    return stamps


def _rolling(values: np.ndarray, window: int, function) -> np.ndarray:
    out = np.full(values.shape[0], np.nan)
    if values.shape[0] >= window:
        windows = np.lib.stride_tricks.sliding_window_view(values, window)
        out[window - 1:] = function(windows, axis=1)
    return out


def _split(valid: np.ndarray, labels: np.ndarray, horizon: int) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    rows = np.flatnonzero(valid)
    first, last = int(rows[0]), int(rows[-1])
    span = last - first + 1
    train_end = first + int(span * 0.6)                  # exclusive
    validation_start = train_end + horizon + 1
    validation_end = first + int(span * 0.8)
    test_start = validation_end + horizon + 1
    labelled = valid & np.isfinite(labels)
    train = np.flatnonzero(labelled[:train_end])
    train = train[train >= first]
    validation = np.arange(validation_start, validation_end)
    validation = validation[labelled[validation]]
    test = np.arange(test_start, labels.shape[0])
    return train.astype(np.int64), validation.astype(np.int64), test.astype(np.int64)


def synthetic_market(n: int = 3000, seed: int = 7) -> SyntheticMarket:
    """The fixture every gate runs on (see the module docstring)."""
    generator = np.random.default_rng(seed)
    stay = 0.985
    regime = np.empty(n, dtype=np.int64)
    regime[0] = 1
    for row in range(1, n):
        regime[row] = regime[row - 1] if generator.random() < stay else 1 - regime[row - 1]
    drift = np.where(regime == 1, 1.6, -1.6)
    sigma = 4.0
    returns = np.empty(n)
    previous = 0.0
    for row in range(n):
        innovation = 0.3 * previous + sigma * generator.standard_normal()
        returns[row] = drift[row] + innovation
        previous = innovation
    close = np.round((20000.0 + np.cumsum(returns)) / TICK) * TICK
    open_ = np.empty(n)
    open_[0] = close[0]
    open_[1:] = np.round((close[:-1] + 0.5 * generator.standard_normal(n - 1)) / TICK) * TICK
    high = np.round((np.maximum(open_, close) + np.abs(generator.standard_normal(n)) * 2.0) / TICK) * TICK
    low = np.round((np.minimum(open_, close) - np.abs(generator.standard_normal(n)) * 2.0) / TICK) * TICK
    volume = np.round(500 + 100 * np.abs(generator.standard_normal(n)))
    timestamps = _timestamps(n)

    point_returns = np.concatenate([[np.nan], np.diff(close)])
    signal = np.where(regime == 1, 1.0, -1.0) * 0.8 + 0.6 * generator.standard_normal(n)
    news = np.where(generator.random(n) < 0.05, 0.3 * np.where(regime == 1, 1.0, -1.0) + 0.2 * generator.standard_normal(n), 0.0)
    moving_average = _rolling(close, 20, np.mean)
    raw = np.column_stack([
        signal,                                                        # book_imbalance_top: the regime, noisily
        point_returns / close,                                         # return_1 (a log-return-like fraction)
        _rolling(np.nan_to_num(point_returns), 5, np.sum) / close,     # return_5
        _rolling(np.nan_to_num(point_returns), 20, np.std),            # volatility_20 (points)
        volume / _rolling(volume, 20, np.mean),                        # volume_ratio_20
        (close - moving_average) / close,                              # ma_dist_20
        _rolling(np.nan_to_num(point_returns), 10, np.sum) / close * 100.0,   # roc_10 (percent)
        news,                                                          # finbert_sentiment_decayed_short
    ])
    raw[:WARMUP] = np.nan
    scales = np.array([1.0, 1.0 / sigma * 20000.0, 1.0 / (sigma * math.sqrt(5)) * 20000.0, 1.0 / sigma, 1.0,
                       20000.0 / (sigma * 3.0), 1.0 / (sigma * math.sqrt(10)) * 200.0, 1.0])
    offsets = np.array([0.0, 0.0, 0.0, -1.0, -1.0, 0.0, 0.0, 0.0])
    features = np.clip(raw * scales + offsets, -5.0, 5.0).astype(np.float32)
    raw = raw.astype(np.float32)

    crosses = horizon_crosses_gap(timestamps, HORIZON, GAP_MULTIPLE)
    labels = make_labels(close, HORIZON, 0.0, TICK, crosses)
    targets, scale, _ = price_target(close, HORIZON, VOLATILITY_WINDOW, TICK, crosses)
    cost = load_cost_model("MNQ")
    data = MarketData(timestamps=timestamps, open=open_, high=high, low=low, close=close, volume=volume)
    feature_set = FeatureSet(features, list(FEATURE_NAMES), {}, VOLATILITY_WINDOW, (-5.0, 5.0), raw=raw)
    view = MarketView.from_arrays(
        timestamps=timestamps, close=close, open=open_, high=high, low=low, raw_features=raw,
        feature_names=FEATURE_NAMES, horizon=HORIZON, price_targets=targets, move_scale=scale, labels=labels,
        crosses_gap=crosses, gap_multiple=GAP_MULTIPLE, tick_size=cost.tick_size,
        round_trip_cost_points=cost.round_trip / cost.point_value,
    )
    valid = history_valid(features, 1) & np.isfinite(scale)
    train, validation, test = _split(valid, labels, HORIZON)
    price_train = train[np.isfinite(targets[train])]
    price_validation = validation[np.isfinite(targets[validation])]
    return SyntheticMarket(features=features, raw=raw, names=FEATURE_NAMES, labels=labels, price_targets=targets,
                           move_scale=scale, timestamps=timestamps, data=data, feature_set=feature_set, view=view,
                           cost=cost, horizon=HORIZON, regime=regime, train_index=train, validation_index=validation,
                           test_index=test, price_train_index=price_train, price_validation_index=price_validation)


# ─── a recording reporter ──────────────────────────────────────────────────


class RecordingReporter:
    """``TrainingReporter`` that records everything; ``stop_at_checkpoint``
    raises ``StopRequested`` at that checkpoint call (1-based)."""

    def __init__(self, stop_at_checkpoint: int | None = None) -> None:
        self.step_unit: str | None = None
        self.events: list[tuple] = []
        self.epochs: list = []
        self.batches: list = []
        self.logs: list[tuple[str, str]] = []
        self.checkpoints = 0
        self.stop_at_checkpoint = stop_at_checkpoint

    def epoch_started(self, epoch, epoch_count):
        self.events.append(("epoch_started", epoch, epoch_count))

    def batch(self, report):
        self.batches.append(report)
        self.events.append(("batch", report.epoch, report.batch))

    def validating(self, epoch, epoch_count):
        self.events.append(("validating", epoch, epoch_count))

    def epoch_finished(self, report):
        self.epochs.append(report)
        self.events.append(("epoch_finished", report.epoch, report.epoch_count))

    def checkpoint(self):
        self.checkpoints += 1
        self.events.append(("checkpoint", self.checkpoints))
        if self.stop_at_checkpoint is not None and self.checkpoints >= self.stop_at_checkpoint:
            raise StopRequested()

    def log(self, message, level="info"):
        self.logs.append((str(message), level))


# ─── factories ─────────────────────────────────────────────────────────────

Factory = Callable[..., object]
Loader = Callable[[str], object]


def registry_factory(key: str, seed: int = 42, device: str = "cpu") -> Factory:
    from cycle.models import build_adapter

    return lambda parameters, task="classification": build_adapter(key, parameters, device, seed, task=task)


def registry_loader(directory: str):
    from cycle.models import load_adapter

    return load_adapter(directory, "cpu")


def _factory(key_or_factory) -> Factory:
    return registry_factory(key_or_factory) if isinstance(key_or_factory, str) else key_or_factory


def predict(adapter, features: np.ndarray, rows) -> np.ndarray:
    rows = np.atleast_1d(np.asarray(rows, dtype=np.int64))
    if adapter.task == "classification":
        return np.asarray(adapter.predict_probability(features, rows), dtype=np.float64)
    return np.asarray(adapter.predict_value(features, rows), dtype=np.float64)


def _same(a: np.ndarray, b: np.ndarray, tolerance: float) -> bool:
    a, b = np.asarray(a, dtype=np.float64), np.asarray(b, dtype=np.float64)
    both_missing = np.isnan(a) & np.isnan(b)
    return bool(np.all(both_missing | (np.abs(a - b) <= tolerance)))


def _probe_rows(market: SyntheticMarket, count: int = 20) -> np.ndarray:
    rows = market.test_index
    return rows[np.linspace(0, rows.size - 1, min(count, rows.size)).astype(np.int64)]


def _truncation_rows(market: SyntheticMarket, count: int = 20, boundary_count: int = 4) -> np.ndarray:
    """The 20 spread test rows plus the test rows at session boundaries, where a
    read of a gap flag that needs a later timestamp (``one_bar_crosses_gap[t]``,
    ``crosses_gap[t]``) changes the answer: the last bar before a break, the
    first bar whose horizon reaches a break, and the first bar after one."""
    rows = market.test_index
    view = market.view
    before_break = rows[view.one_bar_crosses_gap[rows]]
    horizon_starts = rows[view.crosses_gap[rows] & ~view.crosses_gap[np.maximum(rows - 1, 0)]]
    after_break = rows[(rows > 0) & view.one_bar_crosses_gap[np.maximum(rows - 1, 0)]]
    boundaries = [group[:boundary_count] for group in (before_break, horizon_starts, after_break)]
    return np.unique(np.concatenate([_probe_rows(market, count), *boundaries])).astype(np.int64)


# ─── the gates ─────────────────────────────────────────────────────────────


def bridge_keys(reg: dict | None = None) -> list[str]:
    """Every registry key built by a bridge adapter or a bridge network kind."""
    models = (reg or catalog.registry())["models"]
    return sorted(key for key, entry in models.items()
                  if entry["adapter"] in catalog.BRIDGE_ADAPTERS or entry["network"] in BRIDGE_NETWORKS)


def check_registry_entry(key: str, reg: dict | None = None) -> dict:
    """The entry loads and follows the bridge conventions (plan §1.0)."""
    entry = catalog.entry(key, reg)
    where = f"{key}"
    assert entry["runnable"] in (True, False)
    assert isinstance(entry["implementationNote"], str) and entry["implementationNote"].strip(), \
        f"{where}: every bridge entry carries an implementationNote (Bridge / Differs from the spec / Expect)"
    network_kind = entry["network"] in BRIDGE_NETWORKS
    if network_kind:
        assert entry["adapter"] in ("neural", "meta_symbolic_router"), f"{where}: a bridge network kind runs on the neural adapter"
        assert entry["sequence"] is True, f"{where}: the bridge network kinds read a window of bars"
    else:
        assert entry["adapter"] in catalog.BRIDGE_ADAPTERS, f"{where}: adapter {entry['adapter']!r} is not a bridge"
        assert entry["network"] is None and entry["sequence"] is False, \
            f"{where}: a custom bridge adapter has network null and sequence false (it reads its own history)"
        assert entry["direction"]["mode"] == "classifier" and entry["direction"].get("estimator") is None, \
            f"{where}: direction.mode classifier, estimator null"
        variant = entry["direction"].get("fixed", {}).get("variant")
        assert isinstance(variant, str) and variant, f"{where}: direction.fixed.variant names the mechanism"
        assert entry["explainKind"] == "opaque", f"{where}: a new bridge entry starts with explainKind opaque"
        assert entry["preprocess"] == [], f"{where}: bridges do their own scaling (preprocess [])"
        assert entry["progress"] in ("per_epoch", "single_fit"), f"{where}: progress per_epoch or single_fit"
    assert entry["direction"]["probability"] in ("predict_proba", "logistic_curve_on_validation", "network"), \
        f"{where}: direction.probability {entry['direction']['probability']!r}"
    reserved = parameter_names.reserved_types(catalog.parameter_types(reg))
    for name, spec in entry["parameters"].items():
        problems = parameter_names.check_parameter(name, spec["type"], reserved)
        assert not problems, f"{where}: {problems}"
        search = spec.get("search")
        if search and search["kind"] != "categorical":
            # a draw outside the parameter's own bounds is refused by catalog.resolve_parameters mid-tuning
            assert ("min" not in spec or search["low"] >= spec["min"]) and ("max" not in spec or search["high"] <= spec["max"]),                 f"{where}: {name}'s search [{search['low']}, {search['high']}] leaves its bounds [{spec.get('min')}, {spec.get('max')}]"
    return entry


def check_build_both_tasks(key: str, parameters: dict, seed: int = 42) -> tuple[object, object]:
    factory = registry_factory(key, seed)
    direction = factory(parameters, task="classification")
    price = factory(parameters, task="regression")
    assert direction.task == "classification", f"{key}: the direction model's task is {direction.task!r}"
    if catalog.entry(key)["price"] is None:
        assert isinstance(price, NoPriceModel), f"{key}: price null builds NoPriceModel for task regression"
    else:
        assert price.task == "regression", f"{key}: the price model's task is {price.task!r}"
    return direction, price


def check_predict_before_fit_raises(adapter, market: SyntheticMarket) -> None:
    if isinstance(adapter, NoPriceModel):
        return
    rows = market.test_index[:3]
    try:
        predict(adapter, market.features, rows)
    except (RuntimeError, ValueError, TypeError):
        return
    raise AssertionError(f"{getattr(adapter, 'key', adapter)}: predicting before fit returned instead of raising")


def fit_on_market(factory, parameters: dict, market: SyntheticMarket, task: str = "classification", *,
                  view: MarketView | None = None, features: np.ndarray | None = None,
                  timestamps: np.ndarray | None = None, reporter: RecordingReporter | None = None, bind: bool = True):
    """Build, bind the view (the engine's path) and fit on the market's split."""
    adapter = _factory(factory)(dict(parameters), task=task)
    if bind and hasattr(adapter, "bind_market"):
        adapter.bind_market(view if view is not None else market.view)
    reporter = reporter or RecordingReporter()
    train, validation = market.fit_rows(task)
    targets = market.targets(task) if view is None else (view.labels if task == "classification" else view.price_targets)
    adapter.fit(market.features if features is None else features, targets, train, validation,
                market.timestamps if timestamps is None else timestamps, reporter)
    return adapter, reporter


def check_fit_reports(adapter, reporter: RecordingReporter) -> None:
    from cycle.catalog import STEP_UNITS

    key = getattr(adapter, "key", adapter)
    assert reporter.step_unit in STEP_UNITS, f"{key}: step_unit {reporter.step_unit!r} is not one of {STEP_UNITS}"
    assert reporter.epochs, f"{key}: fit reported no epoch_finished"
    assert reporter.checkpoints >= 1, f"{key}: fit never called reporter.checkpoint()"


def check_stop_propagates(factory, parameters: dict, market: SyntheticMarket, task: str = "classification") -> None:
    """A reporter that raises StopRequested at its second checkpoint stops the fit."""
    reporter = RecordingReporter(stop_at_checkpoint=2)
    try:
        fit_on_market(factory, parameters, market, task, reporter=reporter)
    except StopRequested:
        return
    raise AssertionError(f"{factory if isinstance(factory, str) else 'the model'}: StopRequested at the second "
                         f"checkpoint did not propagate out of fit ({reporter.checkpoints} checkpoints were called)")


def check_probabilities(adapter, market: SyntheticMarket, rows: np.ndarray | None = None) -> np.ndarray:
    """P(up) in [0, 1] or NaN, and each row alone equals the batch within 1e-9."""
    rows = _probe_rows(market) if rows is None else np.asarray(rows, dtype=np.int64)
    batch = predict(adapter, market.features, rows)
    key = getattr(adapter, "key", adapter)
    if adapter.task == "classification":
        finite = batch[np.isfinite(batch)]
        assert np.all((finite >= 0.0) & (finite <= 1.0)), f"{key}: P(up) outside [0, 1]"
    for position, row in enumerate(rows):
        single = predict(adapter, market.features, [row])[0]
        assert _same(single, batch[position], BATCH_TOLERANCE), \
            f"{key}: row {int(row)} alone gives {single!r}, in the batch {batch[position]!r}"
    return batch


def check_learning_floor(adapter, market: SyntheticMarket, floor: float = DEFAULT_FLOOR) -> float:
    """Accuracy of the direction (or of the predicted sign) on the synthetic holdout."""
    rows = market.holdout(adapter.task)
    prediction = predict(adapter, market.features, rows)
    target = market.targets(adapter.task)[rows].astype(np.float64)
    known = np.isfinite(prediction)
    if adapter.task == "classification":
        accuracy = float(np.mean((prediction[known] >= 0.5) == (target[known] >= 0.5))) if known.any() else 0.0
    else:
        signed = known & (target != 0) & (prediction != 0)
        accuracy = float(np.mean(np.sign(prediction[signed]) == np.sign(target[signed]))) if signed.any() else 0.0
    assert accuracy >= floor, f"{getattr(adapter, 'key', adapter)}: holdout accuracy {accuracy:.3f} is below the floor {floor}"
    return accuracy


def check_predict_truncation(adapter, market: SyntheticMarket, rows: np.ndarray | None = None) -> None:
    """Cut the features and the view at t + 1: the prediction at t is unchanged
    (20 spread test rows plus the rows at session boundaries)."""
    rows = _truncation_rows(market) if rows is None else np.asarray(rows, dtype=np.int64)
    key = getattr(adapter, "key", adapter)
    full = {int(row): predict(adapter, market.features, [row])[0] for row in rows}
    binds = hasattr(adapter, "bind_market")
    try:
        for row in rows:
            row = int(row)
            if binds:
                adapter.bind_market(market.view.truncated(row + 1))
            cut = predict(adapter, market.features[: row + 1], [row])[0]
            assert _same(cut, full[row], TRUNCATION_TOLERANCE), \
                f"{key}: the prediction at row {row} moved from {full[row]!r} to {cut!r} when bars after it were cut"
    finally:
        if binds:
            adapter.bind_market(market.view)


def check_reloaded_truncation(adapter, market: SyntheticMarket, directory: str | Path, loader: Loader = registry_loader,
                              rows: np.ndarray | None = None) -> None:
    """The truncation test on a model that never saw the full view: save the
    fitted model, reload it, and bind ONLY truncated views (rows in increasing
    order), each prediction compared with the fitted model's under the full view.

    ``check_predict_truncation`` re-binds the fitted model, so state the model
    derived from the engine's full view during fit (a series computed once over
    every bar, test bars included) survives the re-bind and hides a read of the
    future. A reloaded model has only its saved state (which the poison test
    keeps free of rows after validation) and the view it is given."""
    rows = _truncation_rows(market) if rows is None else np.asarray(rows, dtype=np.int64)
    rows = np.sort(rows)
    key = getattr(adapter, "key", adapter)
    full = predict(adapter, market.features, rows)
    folder = Path(directory)
    adapter.save(str(folder))
    reloaded = loader(str(folder))
    binds = hasattr(reloaded, "bind_market")
    for position, row in enumerate(rows):
        row = int(row)
        if binds:
            reloaded.bind_market(market.view.truncated(row + 1))
        cut = predict(reloaded, market.features[: row + 1], [row])[0]
        assert _same(cut, full[position], RELOAD_TOLERANCE), \
            f"{key}: reloaded and bound only to bars up to row {row}, the model predicts {cut!r} there instead of " \
            f"{full[position]!r}: its prediction read state derived from bars after the row"


def poisoned(market: SyntheticMarket, after_row: int) -> tuple[np.ndarray, MarketView]:
    """The features and view with every price after ``after_row`` poisoned:
    features, raw features, OHLC and the move scale 1e6 from ``after_row + 1``;
    the price targets 1e6 and the labels flipped (the unlabelled ones set to up)
    from ``after_row + 1 - horizon``: every row r whose target or label reads
    close[r + horizon] after ``after_row``. Every value made only of bars up to
    ``after_row`` is untouched."""
    start = int(after_row) + 1
    target_start = max(0, start - int(market.view.horizon))
    features = market.features.copy()
    features[start:] = 1e6
    view = market.view

    def spoil(values, first=start):
        if values is None:
            return None
        values = np.array(values, copy=True)
        values[first:] = 1e6
        return values

    labels = np.array(view.labels, copy=True)
    tail = labels[target_start:]
    labels[target_start:] = np.where(np.isfinite(tail), 1.0 - tail, 1.0)
    return features, replace(view, open=spoil(view.open), high=spoil(view.high), low=spoil(view.low),
                             close=spoil(view.close), raw_features=spoil(view.raw_features),
                             price_targets=spoil(view.price_targets, target_start).astype(np.float32),
                             move_scale=spoil(view.move_scale), labels=labels)


def _compare_saved(first: Path, second: Path, key, what: str = "poisoning rows past validation + h") -> None:
    files = sorted(path.relative_to(first) for path in first.rglob("*") if path.is_file())
    other = sorted(path.relative_to(second) for path in second.rglob("*") if path.is_file())
    assert files == other, f"{key}: the fit saved different files after {what} ({files} vs {other})"
    for relative in files:
        a, b = first / relative, second / relative
        if relative.name == persistence.MODEL_JSON:
            left = persistence.comparable_metadata(json.loads(a.read_text(encoding="utf-8")))
            right = persistence.comparable_metadata(json.loads(b.read_text(encoding="utf-8")))
            assert left == right, f"{key}: model.json differs after {what}"
        elif relative.suffix == ".npz":
            left, right = persistence.load_arrays(a), persistence.load_arrays(b)
            assert left.keys() == right.keys() and all(np.array_equal(left[k], right[k], equal_nan=True) for k in left), \
                f"{key}: {relative} differs after {what}"
        elif relative.suffix in (".pt", ".pth"):
            left, right = persistence.load_torch(a), persistence.load_torch(b)
            assert _same_tree(left, right), f"{key}: {relative} differs after {what}"
        elif relative.suffix == ".json":
            assert json.loads(a.read_text(encoding="utf-8")) == json.loads(b.read_text(encoding="utf-8")), \
                f"{key}: {relative} differs after {what}"
        else:
            assert a.read_bytes() == b.read_bytes(), f"{key}: {relative} differs after {what}"


def _same_tree(left, right) -> bool:
    import torch

    if isinstance(left, dict):
        return isinstance(right, dict) and left.keys() == right.keys() and all(_same_tree(left[k], right[k]) for k in left)
    if isinstance(left, (list, tuple)):
        return isinstance(right, (list, tuple)) and len(left) == len(right) and all(_same_tree(a, b) for a, b in zip(left, right))
    if isinstance(left, torch.Tensor):
        return isinstance(right, torch.Tensor) and torch.equal(left, right)
    if isinstance(left, float) and isinstance(right, float) and math.isnan(left) and math.isnan(right):
        return True
    return left == right


def check_fit_poison(factory, parameters: dict, market: SyntheticMarket, task: str, directory: str | Path) -> None:
    """Every target, label, feature and OHLC value after validation_index[-1] + h
    poisoned: the saved model is identical to the clean fit's. Then the same
    run with the bars after that point CUT instead (features, timestamps and a
    ``truncated`` view): identical again. Poisoning catches a fit that reads a
    later value; cutting also catches one that reads how many bars follow (the
    length of the series, the last timestamp), which poisoning leaves intact."""
    directory = Path(directory)
    train, validation = market.fit_rows(task)
    cut = int(validation[-1]) + market.horizon
    clean, _ = fit_on_market(factory, parameters, market, task)
    features, view = poisoned(market, cut)
    dirty, _ = fit_on_market(factory, parameters, market, task, view=view, features=features)
    key = getattr(clean, "key", factory)
    clean.save(str(directory / "clean"))
    dirty.save(str(directory / "poisoned"))
    _compare_saved(directory / "clean", directory / "poisoned", key)
    end = cut + 1
    short, _ = fit_on_market(factory, parameters, market, task, view=market.view.truncated(end),
                             features=market.features[:end], timestamps=market.timestamps[:end])
    short.save(str(directory / "cut"))
    _compare_saved(directory / "clean", directory / "cut", key, "cutting the bars past validation + h")


def check_save_load(adapter, market: SyntheticMarket, directory: str | Path, loader: Loader = registry_loader) -> object:
    """Save, reload, bind the view: the same predictions within 1e-6."""
    rows = _probe_rows(market)
    before = predict(adapter, market.features, rows)
    folder = Path(directory)
    adapter.save(str(folder))
    reloaded = loader(str(folder))
    if hasattr(reloaded, "bind_market"):
        reloaded.bind_market(market.view)
    after = predict(reloaded, market.features, rows)
    assert _same(before, after, RELOAD_TOLERANCE), \
        f"{getattr(adapter, 'key', adapter)}: the reloaded model predicts differently ({before[:3]} vs {after[:3]})"
    assert int(reloaded.minimum_history()) == int(adapter.minimum_history())
    return reloaded


def check_minimum_history_stable(key: str, parameters: dict, factory=None, reg: dict | None = None) -> int:
    """Two Optuna draws of the registry's search space give the same history requirement."""
    import optuna

    factory = factory or registry_factory(key)
    optuna.logging.set_verbosity(optuna.logging.WARNING)
    requirements = []
    for sampler_seed in (0, 1):
        study = optuna.create_study(sampler=optuna.samplers.RandomSampler(seed=sampler_seed))
        trial = study.ask()
        values = catalog.suggest_parameters(trial, key, dict(parameters), reg)
        requirements.append(int(factory({**parameters, **values}, task="classification").minimum_history()))
    assert requirements[0] == requirements[1], \
        f"{key}: minimum_history moved between two Optuna draws ({requirements}); a searched parameter changes it"
    return requirements[0]


def check_ascii_logs(reporter: RecordingReporter) -> None:
    for message, _level in reporter.logs:
        assert message.isascii(), f"a log line is not ASCII (Windows cp1252 consoles): {message!r}"


def check_latency(adapter, market: SyntheticMarket, milliseconds: float) -> float:
    """Median single-row predict time over 15 test rows (after one warm-up call)."""
    rows = _probe_rows(market, 16)
    predict(adapter, market.features, [rows[0]])
    times = []
    for row in rows[1:]:
        started = time.perf_counter()
        predict(adapter, market.features, [row])
        times.append((time.perf_counter() - started) * 1000.0)
    median = statistics.median(times)
    assert median <= milliseconds, f"{getattr(adapter, 'key', adapter)}: single-row predict takes {median:.1f} ms (limit {milliseconds})"
    return median


def latency_limit(key: str, reg: dict | None = None) -> float:
    return 250.0 if catalog.entry(key, reg)["speed"] == "slow" else 50.0


# ─── one engine fold ───────────────────────────────────────────────────────


@contextlib.contextmanager
def captured_events():
    from shared import protocol

    events: list[dict] = []
    original = protocol.emit
    protocol.emit = lambda event: events.append(json.loads(protocol.dumps_safe(event)))
    try:
        yield events
    finally:
        protocol.emit = original


def engine_settings(key: str, parameters: dict, directory: str | Path, **overrides):
    from cycle.engine import CycleSettings

    values = dict(
        symbol="MNQ", timeframe="5m", model_id=f"bridge_{key}", model_family=key, model_parameters=dict(parameters),
        artifact_directory=str(directory), train_days=6, validation_fraction=0.2, test_days=1, step_days=0,
        fold_limit=1, expanding_window=False, label_horizon_bars=HORIZON, label_threshold_ticks=0.0, embargo_bars=0,
        long_only=False, holding_bars=0, stop_loss_ticks=0.0, take_profit_ticks=0.0, contracts=1, tuning_trials=0,
        tuning_mode="reviewed_defaults", label_gap_multiple=GAP_MULTIPLE, bars_per_second=0.0, start_paused=False,
        quiet_bars=True, log_every_batches=100, device="cpu", seed=42, land_in_lake=False,
    )
    values.update(overrides)
    return CycleSettings(**values)


def run_engine_fold(key: str, parameters: dict, market: SyntheticMarket, directory: str | Path, *,
                    factory=None, **overrides) -> tuple[object, list[dict]]:
    """One engine fold on the synthetic market; asserts a ``done`` event, no
    ``error`` event, and every streamed P(up) in [0, 1] or None."""
    from cycle.engine import CycleEngine

    factory = factory or registry_factory(key)
    engine = CycleEngine(engine_settings(key, parameters, directory, **overrides), market.data, market.feature_set,
                         market.cost, factory)
    with captured_events() as events:
        engine.run()
    errors = [event for event in events if event["type"] == "error"]
    assert not errors, f"{key}: the engine fold emitted errors {errors[:2]}"
    assert events and events[-1]["type"] == "done", f"{key}: the engine fold did not end with done"
    walked = [event for event in events if event["type"] == "cycle_bars" and event.get("role") == "processed"]
    assert walked, f"{key}: the engine walked no test bar"
    for event in walked:
        for probability in event["probabilityUp"]:
            assert probability is None or 0.0 <= probability <= 1.0, f"{key}: streamed P(up) {probability}"
    return engine, events


# ─── every gate ────────────────────────────────────────────────────────────


def run_all_gates(key: str, parameters: dict, market: SyntheticMarket, directory: str | Path, *,
                  floor: float = DEFAULT_FLOOR, factory=None, loader: Loader = registry_loader,
                  reg: dict | None = None, tasks: tuple[str, ...] | None = None,
                  latency_milliseconds: float | None = None, registry_checks: bool = True) -> dict:
    """Every per-key gate of plan §3 in order; returns what was measured."""
    directory = Path(directory)
    factory = factory or registry_factory(key)
    report: dict = {"key": key}
    entry = catalog.entry(key, reg) if registry_checks else None
    if registry_checks:
        check_registry_entry(key, reg)
    has_price = entry["price"] is not None if entry is not None else True
    tasks = tasks or (("classification", "regression") if has_price else ("classification",))
    for task in tasks:
        fresh = factory(dict(parameters), task=task)
        check_predict_before_fit_raises(fresh, market)
        adapter, reporter = fit_on_market(factory, parameters, market, task)
        check_fit_reports(adapter, reporter)
        check_ascii_logs(reporter)
        check_probabilities(adapter, market)
        if task == "classification":
            report["accuracy"] = check_learning_floor(adapter, market, floor)
        check_predict_truncation(adapter, market)
        check_save_load(adapter, market, directory / f"{task}_saved", loader)
        check_reloaded_truncation(adapter, market, directory / f"{task}_truncation", loader)
        check_fit_poison(factory, parameters, market, task, directory / f"{task}_poison")
        limit = latency_milliseconds if latency_milliseconds is not None else (
            latency_limit(key, reg) if entry is not None else 50.0)
        report[f"{task}_latency_milliseconds"] = check_latency(adapter, market, limit)
    check_stop_propagates(factory, parameters, market)
    if registry_checks or reg is not None:
        report["minimum_history"] = check_minimum_history_stable(key, parameters, factory, reg)
    return report


__all__ = [
    "RecordingReporter", "SyntheticMarket", "bridge_keys", "captured_events", "check_ascii_logs",
    "check_build_both_tasks", "check_fit_poison", "check_fit_reports", "check_latency", "check_learning_floor",
    "check_minimum_history_stable", "check_predict_before_fit_raises", "check_predict_truncation",
    "check_reloaded_truncation",
    "check_probabilities", "check_registry_entry", "check_save_load", "check_stop_propagates", "engine_settings",
    "fit_on_market", "latency_limit", "poisoned", "predict", "registry_factory", "registry_loader", "run_all_gates",
    "run_engine_fold", "synthetic_market",
]
