"""The Model Cycle engine: plan folds, tune, train, validate, walk test bars one
at a time, trade them, score them, and stream every step.

Design and the wire contract: ``docs/plans/2026-09-25-model-cycle.md`` and
``src/shared/cycle/schema.ts``. The engine never imports a model library — a
model family is an ``adapter_factory(parameters) -> ModelAdapter``.

Invariants this module asserts (and ``tests/test_cycle_engine.py`` checks):

- Bars are emitted in strictly increasing timestamp order, each exactly once,
  with no gaps: before a fold is fitted, every earlier unemitted bar is
  emitted as ``context`` (chunks of <= 2000); test bars are emitted as
  ``processed`` with their prediction columns; nothing after the last fold's
  test span is emitted.
- Inside a fold the training window is split chronologically: validation is
  its last ``validation_fraction``; ``label_horizon_bars`` rows are purged
  between training and validation and between validation and test, so no
  training or validation label resolves inside a later span. Index arrays
  hold only rows with valid feature history and (train/validation) a label.
- A test bar's prediction uses feature rows <= that bar; its trade fills at
  the next bar's open; its label is resolved h bars later, inside the fold.
- Each fold fits TWO models of the chosen family on the same purged spans: the
  direction classifier (``labels``, tuned when tuning is on) and then a price
  model (``adapter_factory(parameters, task="regression")``, the classifier's
  parameters, never tuned) on ``cycle.labels.price_target``: the h-bar move
  divided by its causal trailing volatility. Its index arrays hold rows with
  feature history and a known forward move, including rows whose direction
  label is NaN only because the move sat inside the threshold. At test bar i
  the price model's output y is multiplied back by scale[i] (closes <= i):
  predictedClose = close[i] + y * scale[i]; forecastTimestamp = the time of
  bar i + h. A forecast is resolved when bar i + h of the same fold is walked,
  and only then enters the price-forecast metrics.

Overall progress (``cursor.overallFraction``), monotonic:
    loading 0 -> 0.05; tuning 0.05 -> 0.30 (only when tuning is on);
    the rest to 0.99 split over folds by their test-bar count; inside a fold
    training takes the first 40 % (the direction classifier the first 60 % of
    that, the price model the rest; advanced by epoch / batch), the test walk
    the remaining 60 % (advanced bar by bar); complete = 1.
"""

from __future__ import annotations

import math
import os
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable

import numpy as np

from cycle.adapter import MODEL_LABELS, BatchReport, EpochReport, ModelAdapter, StopRequested
from cycle.control import ControlState
from cycle.features import FeatureSet, history_valid
from cycle.labels import actual_direction, make_labels, price_target
from cycle.metrics import ScoreInputs, bars_per_year, buy_and_hold_usd, scoreboard
from cycle.simulate import CostModel, Simulator, Trade
from shared import protocol
from shared.walk_forward import iter_day_folds

CONTEXT_CHUNK = 2000
CURSOR_INTERVAL_SECONDS = 0.05        # <= 20 Hz
FRAME_INTERVAL_SECONDS = 0.05
SCOREBOARD_INTERVAL_SECONDS = 0.25    # <= 4 Hz
BAR_LOG_INTERVAL_SECONDS = 0.05       # <= 20 per-bar lines a second when pacing fast
PAUSE_HEARTBEAT_SECONDS = 1.0
MINIMUM_TRAIN_ROWS = 50
MINIMUM_VALIDATION_ROWS = 10

LOADING_END = 0.05
TUNING_END = 0.30
FOLDS_END = 0.99
TRAINING_SHARE = 0.4
DIRECTION_TRAINING_SHARE = 0.6   # of TRAINING_SHARE; the price model takes the rest

# adapter_factory(parameters) -> the direction classifier;
# adapter_factory(parameters, task="regression") -> the price model
AdapterFactory = Callable[..., ModelAdapter]


def format_time(timestamp: int | float) -> str:
    return datetime.fromtimestamp(int(timestamp), timezone.utc).strftime("%Y-%m-%d %H:%M")


def format_usd(value: float, signed: bool = True) -> str:
    sign = "+" if value >= 0 else "-"
    return f"{sign if signed else ('-' if value < 0 else '')}${abs(value):,.2f}"


def _format_number(value: float | None, pattern: str = ".4f") -> str:
    return "n/a" if value is None or not math.isfinite(value) else format(value, pattern)


SIDE_WORDS = {1: "LONG", -1: "SHORT", 0: "FLAT"}


# ── settings and data ──────────────────────────────────────────────────────


@dataclass
class CycleSettings:
    symbol: str
    timeframe: str
    model_id: str
    model_family: str
    model_parameters: dict
    artifact_directory: str
    train_days: int = 60
    validation_fraction: float = 0.2
    test_days: int = 10
    step_days: int = 0
    fold_limit: int = 3
    expanding_window: bool = False
    label_horizon_bars: int = 6
    label_threshold_ticks: float = 0.0
    embargo_bars: int = 0
    long_only: bool = False
    holding_bars: int = 0
    stop_loss_ticks: float = 0.0
    take_profit_ticks: float = 0.0
    contracts: int = 1
    tuning_trials: int = 0
    tuning_objective: str = "sharpe_ratio"
    tuning_folds: int = 2
    bars_per_second: float = 40.0
    start_paused: bool = False
    quiet_bars: bool = False
    log_every_batches: int = 10
    device: str = "cpu"
    device_name: str | None = None
    seed: int = 42
    land_in_lake: bool = True

    @property
    def resolved_holding_bars(self) -> int:
        return self.holding_bars if self.holding_bars > 0 else self.label_horizon_bars

    @property
    def resolved_step_days(self) -> int:
        return self.step_days if self.step_days > 0 else self.test_days


@dataclass
class MarketData:
    timestamps: np.ndarray   # int64 epoch seconds, strictly increasing
    open: np.ndarray
    high: np.ndarray
    low: np.ndarray
    close: np.ndarray
    volume: np.ndarray

    def __len__(self) -> int:
        return int(self.timestamps.shape[0])

    def as_dict(self) -> dict:
        return {"open": self.open, "high": self.high, "low": self.low, "close": self.close, "volume": self.volume}


def to_epoch_seconds(values) -> np.ndarray:
    """Timestamps from the lake -> int64 epoch seconds. A naive datetime is UTC
    (the lake stores UTC); ``datetime.timestamp()`` on a naive value would apply
    the machine's local offset, so it is never called on one."""
    out = np.empty(len(values), dtype=np.int64)
    for position, value in enumerate(values):
        if isinstance(value, datetime):
            aware = value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)
            out[position] = int(aware.timestamp())
        elif isinstance(value, np.datetime64):
            out[position] = int(value.astype("datetime64[s]").astype(np.int64))
        else:
            number = float(value)
            out[position] = int(number / 1000) if number > 1e12 else int(number)
    return out


def clean_market_data(raw: dict) -> tuple[MarketData, int]:
    """Sort, drop duplicate / non-increasing timestamps. Returns (data, dropped)."""
    timestamps = to_epoch_seconds(raw["timestamp"])
    order = np.argsort(timestamps, kind="stable")
    timestamps = timestamps[order]
    keep = np.ones(timestamps.shape[0], dtype=bool)
    if timestamps.shape[0] > 1:
        keep[1:] = np.diff(timestamps) > 0
    columns = {key: np.asarray(raw[key], dtype=np.float64)[order][keep] for key in ("open", "high", "low", "close", "volume")}
    data = MarketData(timestamps=timestamps[keep], **columns)
    return data, int((~keep).sum())


# ── folds ──────────────────────────────────────────────────────────────────


@dataclass
class FoldSpec:
    fold_index: int
    window_start: int            # first row of the training window (train + validation)
    window_end: int              # exclusive; already purged h rows before the test window
    train_index: np.ndarray
    validation_index: np.ndarray
    test_index: np.ndarray       # every row of the test span (contiguous), predictable or not
    majority_up: int = 1
    # the price model's rows: feature history and a known forward move (empty = no price model)
    price_train_index: np.ndarray = field(default_factory=lambda: np.empty(0, dtype=np.int64))
    price_validation_index: np.ndarray = field(default_factory=lambda: np.empty(0, dtype=np.int64))

    def plan(self, timestamps: np.ndarray) -> dict:
        def span(index: np.ndarray) -> tuple[int, int]:
            return (int(timestamps[index[0]]), int(timestamps[index[-1]])) if index.size else (0, 0)

        train_start, train_end = span(self.train_index)
        validation_start, validation_end = span(self.validation_index)
        test_start, test_end = span(self.test_index)
        return {
            "foldIndex": self.fold_index,
            "trainStart": train_start,
            "trainEnd": train_end,
            "validationStart": validation_start,
            "validationEnd": validation_end,
            "testStart": test_start,
            "testEnd": test_end,
            "trainBarCount": int(self.train_index.size),
            "validationBarCount": int(self.validation_index.size),
            "testBarCount": int(self.test_index.size),
        }


def split_window(rows: np.ndarray, validation_fraction: float, purge: int) -> tuple[np.ndarray, np.ndarray]:
    """Chronological split of contiguous ``rows``: the last fraction validates,
    ``purge`` rows between the two are dropped."""
    count = rows.size
    validation_count = int(round(count * validation_fraction))
    split = count - validation_count
    return rows[: max(0, split - purge)], rows[split:]


def check_fold_invariants(spec: FoldSpec, labels: np.ndarray, valid: np.ndarray, horizon: int,
                          price_targets: np.ndarray | None = None) -> None:
    for name, index in (("train", spec.train_index), ("validation", spec.validation_index)):
        assert index.size > 0, f"fold {spec.fold_index}: empty {name} index"
        assert np.all(np.diff(index) > 0), f"fold {spec.fold_index}: {name} index not increasing"
        assert np.all(valid[index]), f"fold {spec.fold_index}: {name} row without feature history"
        assert np.all(np.isfinite(labels[index])), f"fold {spec.fold_index}: {name} row without a label"
    assert spec.test_index.size > 0 and np.all(np.diff(spec.test_index) == 1), "test span must be contiguous"
    # A training label resolves at t + h: strictly before validation starts;
    # a validation label resolves strictly before the test span starts.
    assert spec.train_index[-1] + horizon < spec.validation_index[0], f"fold {spec.fold_index}: train labels leak into validation"
    assert spec.validation_index[-1] + horizon < spec.test_index[0], f"fold {spec.fold_index}: validation labels leak into test"
    if price_targets is None or spec.price_train_index.size == 0:
        return
    for name, index in (("price train", spec.price_train_index), ("price validation", spec.price_validation_index)):
        assert index.size > 0 and np.all(np.diff(index) > 0), f"fold {spec.fold_index}: {name} index empty or not increasing"
        assert np.all(valid[index]), f"fold {spec.fold_index}: {name} row without feature history"
        assert np.all(np.isfinite(price_targets[index])), f"fold {spec.fold_index}: {name} row without a known forward move"
    # a price target also resolves at t + h: the same purges hold
    assert spec.price_train_index[-1] + horizon < spec.price_validation_index[0], f"fold {spec.fold_index}: price targets leak into validation"
    assert spec.price_validation_index[-1] + horizon < spec.test_index[0], f"fold {spec.fold_index}: price targets leak into test"


# ── the engine ─────────────────────────────────────────────────────────────


@dataclass
class FoldAccumulator:
    """Everything recorded for one fold's test walk."""

    fold_index: int
    inputs: ScoreInputs = field(default_factory=ScoreInputs)
    bars_evaluated: int = 0
    first_open: float | None = None
    last_close: float | None = None


class CycleEngine:
    def __init__(
        self,
        settings: CycleSettings,
        data: MarketData,
        features: FeatureSet,
        cost: CostModel,
        adapter_factory: AdapterFactory,
        *,
        control: ControlState | None = None,
        suggest_parameters: Callable[[Any, dict], dict] | None = None,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.settings = settings
        self.data = data
        self.feature_set = features
        self.features = features.matrix
        self.cost = cost
        self.adapter_factory = adapter_factory
        self.suggest_parameters = suggest_parameters
        self.control = control or ControlState(settings.bars_per_second, settings.start_paused)
        self.clock = clock
        self.started = clock()
        self.labels = make_labels(data.close, settings.label_horizon_bars, settings.label_threshold_ticks, cost.tick_size)
        self.horizon = settings.label_horizon_bars
        # the price model's target, and the causal scale that turns its output back into points
        self.volatility_window = int(features.lookback)
        self.price_targets, self.move_scale, self.forward_moves = price_target(
            data.close, settings.label_horizon_bars, self.volatility_window, cost.tick_size)
        self.periods_per_year = bars_per_year(data.timestamps)
        self.parameters = dict(settings.model_parameters)

        # emission bookkeeping
        self.next_unemitted = 0
        self.emitted_timestamps: list[int] = []   # only kept for tests / sanity checks
        self._last_emitted_timestamp: int | None = None
        # cursor bookkeeping
        self._cursor: dict = {"phase": "loading", "fold_index": None, "fold_count": 0}
        self._last_cursor_time = -math.inf
        self._last_phase: str | None = None
        self._overall = 0.0
        self.fold_count = 0
        # progress geometry
        self._fold_regions: list[tuple[float, float]] = []
        self._tuning_region: tuple[float, float] | None = None
        # records
        self.folds: list[FoldSpec] = []
        self.fold_records: list[dict] = []
        self.accumulators: list[FoldAccumulator] = []
        self.epoch_records: list[dict] = []
        self.trial_records: list[dict] = []
        self.prediction_rows: dict[int, dict] = {}     # row -> record (insertion ordered)
        self.trades: dict[int, Trade] = {}
        self.stopped = False
        self.price_adjustment: dict | None = None
        self.final_scoreboard: dict | None = None
        self.global_step = 0
        self.price_global_step = 0
        self.equity = 0.0
        self.simulator: Simulator | None = None
        self.last_processed_row: int | None = None
        self.test_seconds = 0.0
        self.test_bars = 0
        self.plan: dict | None = None
        self.tuning_summary: dict | None = None
        self._frame: dict | None = None
        self._post_frame: list[Callable[[], None]] = []
        self._last_flush = -math.inf     # when the last processed frame went out (<= 20 Hz above 20 bars/s)
        self._next_due: float | None = None

    # ── logging / cursor ───────────────────────────────────────────────────
    def log(self, message: str, level: str = "info") -> None:
        protocol.emit_log(message, level)

    def fold_prefix(self, fold_index: int | None) -> str:
        if fold_index is None:
            return ""
        return f"[fold {fold_index + 1}/{self.fold_count}]"

    def elapsed(self) -> float:
        return max(0.0, self.clock() - self.started)

    def set_overall(self, fraction: float) -> None:
        self._overall = max(self._overall, min(1.0, max(0.0, fraction)))

    def emit_cursor(self, *, force: bool = False, **fields) -> None:
        self._cursor.update(fields)
        phase = self._cursor["phase"]
        now = self.clock()
        if not force and phase == self._last_phase and now - self._last_cursor_time < CURSOR_INTERVAL_SECONDS:
            return
        self._last_cursor_time = now
        self._last_phase = phase
        cursor = dict(self._cursor)
        protocol.emit_cycle_cursor(
            cursor.pop("phase"),
            fold_count=self.fold_count,
            overall_fraction=self._overall,
            bars_per_second=self.control.bars_per_second,
            paused=self.control.paused,
            elapsed_seconds=self.elapsed(),
            **{key: value for key, value in cursor.items() if key != "fold_count"},
        )

    def set_phase(self, phase: str, **fields) -> None:
        defaults = {
            "span_start": None, "span_end": None, "bar_timestamp": None, "bar_index": None, "bar_count": None,
            "epoch": None, "epoch_count": None, "batch": None, "batch_count": None, "step_unit": None,
            "trial": None, "trial_count": None, "phase_fraction": 0.0, "model_role": None,
        }
        defaults.update(fields)
        self._cursor = {"phase": phase, **defaults}
        self.emit_cursor(force=True)

    def checkpoint(self) -> None:
        """Drain control notices, block while paused, raise on stop."""
        notices = self.control.drain_notices()
        for level, message in notices:
            self.log(f"[control] {message}", level)
        if notices:
            self.emit_cursor(force=True)
        if self.control.paused:
            self._flush_frame()     # show every bar walked so far before blocking
            self.emit_cursor(force=True)

            def heartbeat() -> None:
                for level, message in self.control.drain_notices():
                    self.log(f"[control] {message}", level)
                self.emit_cursor(force=True)

            self.control.wait_while_paused(heartbeat, PAUSE_HEARTBEAT_SECONDS)
            self.emit_cursor(force=True)
        self.control.raise_if_stopped()

    # ── bars ───────────────────────────────────────────────────────────────
    def _record_emitted(self, timestamps: list[int]) -> None:
        for timestamp in timestamps:
            if self._last_emitted_timestamp is not None and timestamp <= self._last_emitted_timestamp:
                raise AssertionError("bars must be emitted in strictly increasing time, each once")
            self._last_emitted_timestamp = timestamp
        self.emitted_timestamps.extend(timestamps)

    def emit_context_until(self, row_exclusive: int, fold_index: int | None) -> None:
        d = self.data
        while self.next_unemitted < row_exclusive:
            end = min(row_exclusive, self.next_unemitted + CONTEXT_CHUNK)
            rows = slice(self.next_unemitted, end)
            timestamps = [int(t) for t in d.timestamps[rows]]
            self._record_emitted(timestamps)
            protocol.emit_cycle_bars(
                "context", fold_index, timestamps, d.open[rows], d.high[rows], d.low[rows], d.close[rows], d.volume[rows],
            )
            self.next_unemitted = end

    # ── plan ───────────────────────────────────────────────────────────────
    def plan_folds(self, minimum_history: int) -> list[FoldSpec]:
        s = self.settings
        if not 0.0 < s.validation_fraction < 1.0:
            raise ValueError(f"validation_fraction must be between 0 and 1, got {s.validation_fraction}")
        step = s.resolved_step_days
        if step < s.test_days:
            raise ValueError(f"step_days ({s.step_days}) must be 0 or >= test_days ({s.test_days}); a test bar is never tested twice")
        valid = history_valid(self.features, minimum_history)
        specs: list[FoldSpec] = []
        for fold in iter_day_folds(
            self.data.timestamps, s.train_days, s.test_days, step,
            purge_bars=self.horizon, embargo_bars=s.embargo_bars, expanding=s.expanding_window,
        ):
            window = fold.train_idx
            train_rows, validation_rows = split_window(window, s.validation_fraction, self.horizon)
            train = train_rows[valid[train_rows] & np.isfinite(self.labels[train_rows])]
            validation = validation_rows[valid[validation_rows] & np.isfinite(self.labels[validation_rows])]
            price_train = train_rows[valid[train_rows] & np.isfinite(self.price_targets[train_rows])]
            price_validation = validation_rows[valid[validation_rows] & np.isfinite(self.price_targets[validation_rows])]
            if price_train.size < MINIMUM_TRAIN_ROWS or price_validation.size < MINIMUM_VALIDATION_ROWS:
                price_train = price_validation = np.empty(0, dtype=np.int64)
            when = f"{format_time(self.data.timestamps[fold.test_idx[0]])}..{format_time(self.data.timestamps[fold.test_idx[-1]])}"
            if train.size < MINIMUM_TRAIN_ROWS or validation.size < MINIMUM_VALIDATION_ROWS:
                self.log(
                    f"[plan] skipped the fold testing {when}: {train.size} training and {validation.size} validation rows "
                    f"with feature history and a label (need {MINIMUM_TRAIN_ROWS} and {MINIMUM_VALIDATION_ROWS})",
                    "warn",
                )
                continue
            specs.append(FoldSpec(
                fold_index=len(specs), window_start=int(window[0]), window_end=int(window[-1]) + 1,
                train_index=train, validation_index=validation, test_index=fold.test_idx,
                price_train_index=price_train, price_validation_index=price_validation,
            ))
        if not specs:
            raise ValueError(
                f"no walk-forward fold fits the loaded data ({len(self.data)} bars, "
                f"{format_time(self.data.timestamps[0])}..{format_time(self.data.timestamps[-1])}) with "
                f"train_days={s.train_days}, test_days={s.test_days}; load a longer window or shorten the folds"
            )
        if s.fold_limit > 0 and len(specs) > s.fold_limit:
            self.log(f"[plan] fold limit {s.fold_limit}: keeping the most recent {s.fold_limit} of {len(specs)} folds")
            specs = specs[-s.fold_limit:]
        for position, spec in enumerate(specs):
            spec.fold_index = position
            labels = self.labels[spec.train_index]
            spec.majority_up = 1 if np.mean(labels) >= 0.5 else 0
            check_fold_invariants(spec, self.labels, valid, self.horizon, self.price_targets)
        return specs

    def _progress_geometry(self) -> None:
        start = LOADING_END
        if self.settings.tuning_trials > 0:
            self._tuning_region = (LOADING_END, TUNING_END)
            start = TUNING_END
        total = sum(spec.test_index.size for spec in self.folds) or 1
        regions = []
        cursor = start
        for spec in self.folds:
            width = (FOLDS_END - start) * spec.test_index.size / total
            regions.append((cursor, cursor + width))
            cursor += width
        self._fold_regions = regions

    def fold_progress(self, fold_index: int, training_fraction: float | None = None, test_fraction: float | None = None,
                      model_role: str = "direction") -> None:
        low, high = self._fold_regions[fold_index]
        within = 0.0
        if training_fraction is not None:
            fraction = min(1.0, max(0.0, training_fraction))
            if model_role == "price":
                fraction = DIRECTION_TRAINING_SHARE + (1 - DIRECTION_TRAINING_SHARE) * fraction
            else:
                fraction = DIRECTION_TRAINING_SHARE * fraction
            within = TRAINING_SHARE * fraction
        if test_fraction is not None:
            within = TRAINING_SHARE + (1 - TRAINING_SHARE) * min(1.0, max(0.0, test_fraction))
        self.set_overall(low + (high - low) * within)

    def tuning_progress(self, fraction: float) -> None:
        if self._tuning_region:
            low, high = self._tuning_region
            self.set_overall(low + (high - low) * min(1.0, max(0.0, fraction)))

    def build_plan(self) -> dict:
        s = self.settings
        tuning = None
        if s.tuning_trials > 0:
            first = self.folds[0]
            tuning = {
                "trialCount": int(s.tuning_trials),
                "objective": s.tuning_objective,
                "innerFoldCount": int(s.tuning_folds),
                "start": int(self.data.timestamps[first.window_start]),
                "end": int(self.data.timestamps[first.window_end - 1]),
            }
        parameters = {
            key: (value if isinstance(value, (bool, str)) or value is None else float(value) if isinstance(value, float) else int(value))
            for key, value in self.parameters.items()
        }
        return {
            "symbol": s.symbol,
            "timeframe": s.timeframe,
            "modelFamily": s.model_family,
            "modelLabel": MODEL_LABELS.get(s.model_family, s.model_family),
            "parameters": parameters,
            "device": "cuda" if s.device == "cuda" else "cpu",
            "deviceName": s.device_name,
            "dataStart": int(self.data.timestamps[0]),
            "dataEnd": int(self.data.timestamps[-1]),
            "barCount": len(self.data),
            "barsPerYear": float(self.periods_per_year),
            "featureNames": list(self.feature_set.names),
            "labelHorizonBars": int(self.horizon),
            "labelThresholdTicks": float(s.label_threshold_ticks),
            "purgeBars": int(self.horizon),
            "embargoBars": int(s.embargo_bars),
            "costModel": {
                "tickSize": self.cost.tick_size,
                "tickValueUsd": self.cost.tick_value,
                "pointValueUsd": self.cost.point_value,
                "costPerSideUsd": self.cost.cost_per_side * s.contracts,
                "roundTripCostUsd": self.cost.round_trip * s.contracts,
                "source": self.cost.source,
            },
            "trading": {
                "longOnly": bool(s.long_only),
                "holdingBars": int(s.resolved_holding_bars),
                "stopLossTicks": float(s.stop_loss_ticks),
                "takeProfitTicks": float(s.take_profit_ticks),
                "contracts": int(s.contracts),
            },
            "tuning": tuning,
            "folds": [spec.plan(self.data.timestamps) for spec in self.folds],
            "barsPerSecond": float(s.bars_per_second),
            "startPaused": bool(s.start_paused),
            "artifactDirectory": s.artifact_directory,
            # set by main.py when the series is a stitched futures root (cycle.rolls)
            "priceAdjustment": self.price_adjustment or {"method": "none", "rolls": []},
        }

    # ── run ────────────────────────────────────────────────────────────────
    def run(self) -> dict:
        """Run the whole cycle; returns the done-diagnostics. Writes artifacts
        and emits ``done`` on completion and on a user stop."""
        from cycle import store

        try:
            self._run()
            self.set_overall(1.0)
            self.set_phase("complete", phase_fraction=1.0)
        except StopRequested:
            self.stopped = True
            self._handle_stop()
            self.set_phase("stopped", phase_fraction=1.0)
        protocol.set_active_fold(None)
        protocol.set_active_trial(None)
        diagnostics = store.write_run(self)
        protocol.emit_done(model_path=self.settings.artifact_directory, diagnostics=diagnostics)
        return diagnostics

    def _run(self) -> None:
        s = self.settings
        self.set_phase("loading")
        probe = self.adapter_factory(dict(self.parameters))
        minimum = int(probe.minimum_history())
        self.folds = self.plan_folds(minimum)
        self.fold_count = len(self.folds)
        self._progress_geometry()
        self.plan = self.build_plan()
        protocol.emit_cycle_plan(self.plan)
        for fold in self.plan["folds"]:
            self.log(
                f"[plan] fold {fold['foldIndex'] + 1}/{self.fold_count}: train {format_time(fold['trainStart'])}..{format_time(fold['trainEnd'])} "
                f"({fold['trainBarCount']} bars) validate {format_time(fold['validationStart'])}..{format_time(fold['validationEnd'])} "
                f"({fold['validationBarCount']}) test {format_time(fold['testStart'])}..{format_time(fold['testEnd'])} ({fold['testBarCount']})"
            )
        self.log(
            f"[plan] {len(self.data):,} bars, {self.periods_per_year:,.0f} bars per year measured, label horizon {self.horizon} bars, "
            f"purge {self.horizon}, embargo {s.embargo_bars}, holding {s.resolved_holding_bars} bars, trades every prediction: "
            f"long at P(up) >= 0.5, {'flat' if s.long_only else 'short'} below, cost {format_usd(self.cost.round_trip * s.contracts, False)} per round trip"
        )
        self.set_overall(LOADING_END)
        self.emit_cursor(force=True)
        if s.start_paused:
            self.log("[control] starting paused — press resume to begin")
        self.checkpoint()

        if s.tuning_trials > 0:
            from cycle.tuning import run_tuning

            self.emit_context_until(int(self.folds[0].test_index[0]), 0)
            best = run_tuning(self, self.folds[0])
            self.parameters = best
            minimum_after = int(self.adapter_factory(dict(self.parameters)).minimum_history())
            if minimum_after != minimum:
                self.log(f"[tune] the tuned model needs {minimum_after} bars of history (was {minimum}); re-planning the folds' index sets")
                replanned = self.plan_folds(minimum_after)
                if [spec.plan(self.data.timestamps)["testStart"] for spec in replanned] != [f["testStart"] for f in self.plan["folds"]]:
                    raise RuntimeError("tuning changed the fold layout; the plan already sent no longer holds")
                self.folds = replanned

        self.simulator = Simulator(
            self.cost,
            contracts=s.contracts,
            holding_bars=s.resolved_holding_bars,
            stop_loss_ticks=s.stop_loss_ticks,
            take_profit_ticks=s.take_profit_ticks,
            long_only=s.long_only,
            on_trade=self._on_trade,
        )
        for spec in self.folds:
            self._run_fold(spec)
        self._emit_final_scoreboard()

    # ── one fold ───────────────────────────────────────────────────────────
    def _run_fold(self, spec: FoldSpec) -> None:
        s = self.settings
        k = spec.fold_index
        prefix = self.fold_prefix(k)
        protocol.set_active_fold(k)
        protocol.set_active_trial(None)
        self.emit_context_until(int(spec.test_index[0]), k)
        ts = self.data.timestamps
        self.log(
            f"{prefix}[train] fitting {MODEL_LABELS.get(s.model_family, s.model_family)} on {spec.train_index.size:,} bars "
            f"{format_time(ts[spec.train_index[0]])}..{format_time(ts[spec.train_index[-1]])}, validating on "
            f"{spec.validation_index.size:,} bars {format_time(ts[spec.validation_index[0]])}..{format_time(ts[spec.validation_index[-1]])}"
        )
        self.set_phase(
            "training", fold_index=k, span_start=int(ts[spec.train_index[0]]), span_end=int(ts[spec.train_index[-1]]),
            model_role="direction",
        )
        self.fold_progress(k, training_fraction=0.0)
        adapter = self.adapter_factory(dict(self.parameters))
        reporter = EngineReporter(self, fold_index=k, train_index=spec.train_index, validation_index=spec.validation_index)
        training_started = self.clock()
        adapter.fit(self.features, self.labels, spec.train_index, spec.validation_index, ts, reporter)
        training_seconds = self.clock() - training_started
        self.fold_progress(k, training_fraction=1.0)
        self.log(f"{prefix}[train] fitted in {training_seconds:.1f} s")
        price_adapter, price_seconds = self._fit_price_model(spec)

        accumulator = FoldAccumulator(fold_index=k)
        self.accumulators.append(accumulator)
        record = {**spec.plan(ts), "trainingSeconds": training_seconds, "majorityClassUp": spec.majority_up,
                  "priceTrainBarCount": int(spec.price_train_index.size),
                  "priceValidationBarCount": int(spec.price_validation_index.size),
                  "priceTrainingSeconds": price_seconds}
        self.fold_records.append(record)
        testing_started = self.clock()
        self._walk_test(spec, adapter, accumulator, price_adapter)
        testing_seconds = self.clock() - testing_started
        self.test_seconds += testing_seconds
        record["testingSeconds"] = testing_seconds

        metrics, trade_distribution, notes = scoreboard(accumulator.inputs, self.periods_per_year)
        protocol.emit_cycle_scoreboard(
            scope="fold", fold_index=k, bars_evaluated=accumulator.bars_evaluated,
            bars_scored=len(accumulator.inputs.scored_actual_up), metrics=metrics,
            trade_distribution=trade_distribution, notes=notes,
        )
        record["metrics"] = metrics
        record["tradeDistribution"] = trade_distribution
        record["notes"] = notes
        spans = {
            "train_start": format_time(record["trainStart"]), "train_end": format_time(record["trainEnd"]),
            "validation_start": format_time(record["validationStart"]), "validation_end": format_time(record["validationEnd"]),
            "test_start": format_time(record["testStart"]), "test_end": format_time(record["testEnd"]),
        }
        protocol.emit_fold_complete(k, {**{key: value for key, value in metrics.items() if value is not None}, **spans})
        for name in ("net_profit_usd", "sharpe_ratio", "sortino_ratio", "maximum_drawdown_usd", "profit_factor",
                     "win_rate", "trade_count", "accuracy", "f1_score", "roc_auc", "log_loss", "brier_score",
                     "price_forecast_mean_absolute_error_points", "persistence_mean_absolute_error_points",
                     "price_forecast_skill"):
            if metrics.get(name) is not None:
                protocol.emit_metric(name, metrics[name], iteration=k, total=self.fold_count)

        test_rows = spec.test_index
        records = [self.prediction_rows[int(row)] for row in test_rows]
        protocol.emit_prediction_markers(
            [int(ts[row]) for row in test_rows],
            [rec["predicted_direction"] for rec in records],
            [None if rec["probability_up"] is None else abs(rec["probability_up"] - 0.5) * 2 for rec in records],
        )
        directory = os.path.join(s.artifact_directory, f"fold_{k}")
        os.makedirs(directory, exist_ok=True)
        try:
            record["modelPath"] = adapter.save(directory)
            self.log(f"[save] fold {k + 1}/{self.fold_count} model -> {record['modelPath']}")
        except Exception as error:  # noqa: BLE001 - a failed save must not lose the fold's results
            record["modelPath"] = None
            self.log(f"[save] fold {k + 1}/{self.fold_count} model could not be saved: {error}", "warn")
        record["priceModelPath"] = None
        if price_adapter is not None:
            price_directory = os.path.join(directory, "price_model")
            os.makedirs(price_directory, exist_ok=True)
            try:
                record["priceModelPath"] = price_adapter.save(price_directory)
                self.log(f"[save] fold {k + 1}/{self.fold_count} price model -> {record['priceModelPath']}")
            except Exception as error:  # noqa: BLE001 - a failed save must not lose the fold's results
                self.log(f"[save] fold {k + 1}/{self.fold_count} price model could not be saved: {error}", "warn")
        self.log(
            f"{prefix}[test] fold done: net {format_usd(metrics['net_profit_usd'])}, Sharpe {_format_number(metrics['sharpe_ratio'], '.2f')}, "
            f"{int(metrics['trade_count'])} trades, accuracy {_format_number(metrics['accuracy'], '.3f')} on "
            f"{len(accumulator.inputs.scored_actual_up)} scored bars ({accumulator.bars_evaluated} walked in {testing_seconds:.1f} s)"
        )
        if price_adapter is not None:
            self.log(
                f"{prefix}[test] price forecast: mean absolute error "
                f"{_format_number(metrics['price_forecast_mean_absolute_error_points'], '.2f')} points against "
                f"{_format_number(metrics['persistence_mean_absolute_error_points'], '.2f')} for the no-change forecast "
                f"(skill {_format_number(metrics['price_forecast_skill'], '.3f')}), direction accuracy "
                f"{_format_number(metrics['price_forecast_direction_accuracy'], '.3f')} on "
                f"{len(accumulator.inputs.forecast_predicted_move_points)} resolved forecasts"
            )

    # ── the price model ────────────────────────────────────────────────────
    def _fit_price_model(self, spec: FoldSpec) -> tuple[ModelAdapter | None, float | None]:
        """Fit the fold's price model (same family, same parameters, task
        "regression") on the purged spans. Returns (adapter, seconds), or
        (None, None) when the fold has too few rows or the fit fails — the
        direction cycle then runs without forecasts, and says so."""
        s = self.settings
        k = spec.fold_index
        prefix = self.fold_prefix(k)
        ts = self.data.timestamps
        train, validation = spec.price_train_index, spec.price_validation_index
        if train.size == 0:
            self.log(
                f"{prefix}[train] price model skipped: fewer than {MINIMUM_TRAIN_ROWS} training or "
                f"{MINIMUM_VALIDATION_ROWS} validation rows with feature history and a known {self.horizon}-bar move; "
                "this fold draws no price forecast", "warn",
            )
            self.fold_progress(k, training_fraction=1.0, model_role="price")
            return None, None
        label = MODEL_LABELS.get(s.model_family, s.model_family)
        self.log(
            f"{prefix}[train] price model: fitting {label} to the {self.horizon}-bar move divided by its trailing "
            f"{self.volatility_window}-bar volatility on {train.size:,} bars "
            f"{format_time(ts[train[0]])}..{format_time(ts[train[-1]])}, validating on {validation.size:,} bars "
            f"{format_time(ts[validation[0]])}..{format_time(ts[validation[-1]])}"
        )
        self.set_phase("training", fold_index=k, span_start=int(ts[train[0]]), span_end=int(ts[train[-1]]),
                       model_role="price")
        self.fold_progress(k, training_fraction=0.0, model_role="price")
        started = self.clock()
        try:
            adapter = self.adapter_factory(dict(self.parameters), task="regression")
            reporter = EngineReporter(self, fold_index=k, train_index=train, validation_index=validation, model_role="price")
            adapter.fit(self.features, self.price_targets, train, validation, ts, reporter)
        except StopRequested:
            raise
        except Exception as error:  # noqa: BLE001 - the direction cycle must still run
            self.log(f"{prefix}[train] price model could not be fitted ({type(error).__name__}: {error}); "
                     "this fold draws no price forecast", "warn")
            self.fold_progress(k, training_fraction=1.0, model_role="price")
            return None, None
        seconds = self.clock() - started
        self.fold_progress(k, training_fraction=1.0, model_role="price")
        self.log(f"{prefix}[train] price model fitted in {seconds:.1f} s")
        return adapter, seconds

    def _resolve_forecast(self, accumulator: FoldAccumulator, source_row: int, target_row: int,
                          predicted_move: float | None) -> None:
        """The forecast made at ``source_row`` meets its target bar, which the
        walk has just processed."""
        assert target_row == source_row + self.horizon, "a forecast resolves exactly horizon bars later"
        if predicted_move is None:
            return
        actual = float(self.data.close[target_row]) - float(self.data.close[source_row])
        accumulator.inputs.forecast_predicted_move_points.append(predicted_move)
        accumulator.inputs.forecast_actual_move_points.append(actual)
        self.prediction_rows[source_row]["forecast_error_points"] = predicted_move - actual

    # ── the test walk ──────────────────────────────────────────────────────
    def _walk_test(self, spec: FoldSpec, adapter: ModelAdapter, accumulator: FoldAccumulator,
                   price_adapter: ModelAdapter | None = None) -> None:
        s = self.settings
        d = self.data
        k = spec.fold_index
        prefix = self.fold_prefix(k)
        simulator = self.simulator
        assert simulator is not None
        simulator.begin_fold(k)
        rows = spec.test_index
        count = rows.size
        valid = history_valid(self.features, int(adapter.minimum_history()))
        span_start, span_end = int(d.timestamps[rows[0]]), int(d.timestamps[rows[-1]])
        self.set_phase("testing", fold_index=k, span_start=span_start, span_end=span_end, bar_count=count, bar_index=0)
        self.log(f"{prefix}[test] walking {count:,} bars one at a time {format_time(span_start)}..{format_time(span_end)}")
        self._frame = None
        self._next_due = None
        last_board = last_bar_log = -math.inf
        warned_non_finite = warned_price = False
        predicted_class_for_row: dict[int, int] = {}
        probability_for_row: dict[int, float | None] = {}
        predicted_move_for_row: dict[int, float | None] = {}
        price_valid = history_valid(self.features, int(price_adapter.minimum_history())) if price_adapter is not None else None
        bar_count = len(d)
        walk_started = self.clock()

        for j in range(count):
            self.checkpoint()
            self._pace()
            i = int(rows[j])
            probability: float | None = None
            if valid[i]:
                value = float(adapter.predict_probability(self.features, np.array([i], dtype=np.int64))[0])
                if math.isfinite(value):
                    probability = min(1.0, max(0.0, value))
                elif not warned_non_finite:
                    warned_non_finite = True
                    self.log(f"{prefix}[test] the model returned a non-finite probability at {format_time(d.timestamps[i])}; such bars are not traded", "warn")
            # every prediction is traded: long at P(up) >= 0.5, short below (flat
            # below when long only — the simulator maps it)
            if probability is None:
                direction, signal = 0, None
            else:
                direction = signal = 1 if probability >= 0.5 else -1
            # the price model: its output times the causal scale at this bar, in points
            predicted_move: float | None = None
            scale = float(self.move_scale[i])
            if price_valid is not None and price_valid[i] and math.isfinite(scale):
                output = float(price_adapter.predict_value(self.features, np.array([i], dtype=np.int64))[0])
                if math.isfinite(output):
                    predicted_move = output * scale
                elif not warned_price:
                    warned_price = True
                    self.log(f"{prefix}[test] the price model returned a non-finite value at {format_time(d.timestamps[i])}; "
                             "such bars draw no forecast", "warn")
            predicted_close = None if predicted_move is None else float(d.close[i]) + predicted_move
            forecast_timestamp = int(d.timestamps[i + self.horizon]) if i + self.horizon < bar_count else None
            predicted_move_for_row[i] = predicted_move
            last = j == count - 1
            result = simulator.step(i, int(d.timestamps[i]), d.open[i], d.high[i], d.low[i], d.close[i], signal, probability, decide=not last)
            net = result.net_usd
            position = result.position
            if last:
                net += simulator.flatten(i, int(d.timestamps[i]), float(d.close[i]), "fold_end")
                position = 0
            self.equity += net
            self.last_processed_row = i
            accumulator.bars_evaluated += 1
            accumulator.inputs.bar_net_usd.append(net)
            accumulator.inputs.bar_exposed.append(result.exposed)
            if accumulator.first_open is None:
                accumulator.first_open = float(d.open[i])
            accumulator.last_close = float(d.close[i])
            predicted_class_for_row[i] = direction
            probability_for_row[i] = probability
            self.prediction_rows[i] = {
                "timestamp": int(d.timestamps[i]), "fold_index": k,
                "open": float(d.open[i]), "high": float(d.high[i]), "low": float(d.low[i]),
                "close": float(d.close[i]), "volume": float(d.volume[i]),
                "probability_up": probability, "predicted_direction": direction, "position": int(position),
                "equity_usd": self.equity, "actual_direction": None, "correct": None,
                "predicted_move_points": predicted_move, "predicted_close": predicted_close,
                "forecast_timestamp": forecast_timestamp, "forecast_error_points": None,
            }
            frame = self._frame_for(k)
            for key, value in (("timestamps", int(d.timestamps[i])), ("open", d.open[i]), ("high", d.high[i]), ("low", d.low[i]),
                               ("close", d.close[i]), ("volume", d.volume[i]), ("probabilityUp", probability),
                               ("predictedDirection", direction), ("position", position), ("equityUsd", self.equity),
                               ("predictedClose", predicted_close), ("forecastTimestamp", forecast_timestamp)):
                frame[key].append(value)

            # the label of the bar h back (same fold) is known now
            if j >= self.horizon:
                resolved_row = int(rows[j - self.horizon])
                actual = actual_direction(d.close, resolved_row, self.horizon, s.label_threshold_ticks, self.cost.tick_size)
                predicted = predicted_class_for_row[resolved_row]
                correct = None if actual == 0 or predicted == 0 else predicted == actual
                frame["resolvedTimestamps"].append(int(d.timestamps[resolved_row]))
                frame["resolvedActual"].append(actual)
                frame["resolvedCorrect"].append(correct)
                record = self.prediction_rows[resolved_row]
                record["actual_direction"] = actual
                record["correct"] = correct
                if correct is not None:
                    accumulator.inputs.scored_actual_up.append(1 if actual > 0 else 0)
                    accumulator.inputs.scored_predicted_up.append(1 if predicted > 0 else 0)
                    accumulator.inputs.scored_probability_up.append(float(probability_for_row[resolved_row]))
                    accumulator.inputs.scored_majority_up.append(spec.majority_up)
                # and so is the move the price model forecast there
                self._resolve_forecast(accumulator, resolved_row, i, predicted_move_for_row.pop(resolved_row, None))

            now = self.clock()
            pace = self.control.bars_per_second
            if not s.quiet_bars and ((0 < pace <= 50) or now - last_bar_log >= BAR_LOG_INTERVAL_SECONDS):
                last_bar_log = now
                line = (
                    f"{prefix}[test] {format_time(d.timestamps[i])} bar {j + 1}/{count} close={d.close[i]:.2f} "
                    f"p_up={_format_number(probability, '.3f')} signal={SIDE_WORDS[signal] if signal is not None else 'NONE'} "
                    f"position={SIDE_WORDS[position]} equity={format_usd(self.equity)} "
                    f"forecast={self._forecast_words(predicted_close, forecast_timestamp)}"
                )
                self._post_frame.append(lambda line=line: self.log(line))
            self._cursor.update(bar_timestamp=int(d.timestamps[i]), bar_index=j, bar_count=count, phase_fraction=(j + 1) / count)
            self.fold_progress(k, test_fraction=(j + 1) / count)
            if last or (0 < pace <= 20) or now - self._last_flush >= FRAME_INTERVAL_SECONDS:
                self._flush_frame()
            if not last and now - last_board >= SCOREBOARD_INTERVAL_SECONDS:
                last_board = now
                self._emit_running_scoreboard(k)
        accumulator.inputs.trade_nets = [t.net_profit_usd for t in simulator.closed_trades if t.fold_index == k and t.net_profit_usd is not None]
        accumulator.inputs.total_cost_usd = sum(t.cost_usd or 0.0 for t in simulator.closed_trades if t.fold_index == k)
        accumulator.inputs.buy_and_hold_usd = self._fold_buy_and_hold(accumulator)
        walked = self.clock() - walk_started
        self.test_bars += count
        self._emit_running_scoreboard(k)
        if walked > 0:
            self.log(f"{prefix}[test] {count / walked:,.1f} bars/s over {count:,} bars", "debug")

    @staticmethod
    def _forecast_words(predicted_close: float | None, forecast_timestamp: int | None) -> str:
        if predicted_close is None:
            return "n/a"
        when = datetime.fromtimestamp(forecast_timestamp, timezone.utc).strftime("%H:%M") if forecast_timestamp is not None else "beyond the data"
        return f"{predicted_close:.2f}@{when}"

    def _fold_buy_and_hold(self, accumulator: FoldAccumulator) -> float | None:
        if accumulator.first_open is None or accumulator.last_close is None:
            return None
        return buy_and_hold_usd(accumulator.first_open, accumulator.last_close, self.cost.point_value,
                                self.settings.contracts, self.cost.round_trip)

    def _frame_for(self, fold_index: int) -> dict:
        if self._frame is None:
            self._frame = {
                "foldIndex": fold_index,
                **{key: [] for key in ("timestamps", "open", "high", "low", "close", "volume", "probabilityUp",
                                       "predictedDirection", "position", "equityUsd", "predictedClose",
                                       "forecastTimestamp", "resolvedTimestamps", "resolvedActual", "resolvedCorrect")},
            }
        return self._frame

    def _flush_frame(self) -> None:
        frame, self._frame = self._frame, None
        if frame and frame["timestamps"]:
            self._last_flush = self.clock()
            self._record_emitted(frame["timestamps"])
            self.next_unemitted = max(self.next_unemitted, self._row_after(frame["timestamps"][-1]))
            resolved = None
            if frame["resolvedTimestamps"]:
                resolved = {"timestamps": frame["resolvedTimestamps"], "actualDirection": frame["resolvedActual"],
                            "correct": frame["resolvedCorrect"]}
            protocol.emit_cycle_bars(
                "processed", frame["foldIndex"], frame["timestamps"], frame["open"], frame["high"], frame["low"],
                frame["close"], frame["volume"], probability_up=frame["probabilityUp"],
                predicted_direction=frame["predictedDirection"], position=frame["position"],
                equity_usd=frame["equityUsd"], resolved=resolved, predicted_close=frame["predictedClose"],
                forecast_timestamp=frame["forecastTimestamp"],
            )
            self.emit_cursor(force=True)
        actions, self._post_frame = self._post_frame, []
        for action in actions:
            action()

    def _row_after(self, timestamp: int) -> int:
        return int(np.searchsorted(self.data.timestamps, timestamp, side="right"))

    def _pace(self) -> None:
        while True:
            pace = self.control.bars_per_second
            if pace <= 0:
                self._next_due = None
                return
            now = self.clock()
            if self._next_due is None:
                self._next_due = now
            wait = self._next_due - now
            if wait <= 0:
                self._next_due = max(self._next_due, now - 1.0 / pace) + 1.0 / pace
                return
            changes = self.control.changes
            # Show what exists before a sleep long enough to see, and never hold a
            # frame past its interval — but not a frame per bar: above 20 bars/s
            # every sleep is shorter than a frame and frames stay <= 20 Hz.
            if self._frame is not None and (wait >= FRAME_INTERVAL_SECONDS or now - self._last_flush >= FRAME_INTERVAL_SECONDS):
                self._flush_frame()
            self.control.sleep(wait)
            if self.control.changes != changes:
                self._next_due = None
                self.checkpoint()

    def _on_trade(self, trade: Trade, status: str) -> None:
        self.trades[trade.number] = trade
        event = trade.to_event()
        side = "LONG" if trade.side > 0 else "SHORT"
        if status == "open":
            line = (f"[trade #{trade.number}] ENTER {side} {trade.contracts} @ {trade.entry_price:.2f} "
                    f"{format_time(trade.entry_timestamp)} p_up={trade.probability_up_at_entry:.3f}")
        else:
            line = (f"[trade #{trade.number}] EXIT {side} @ {trade.exit_price:.2f} {format_time(trade.exit_timestamp or 0)} "
                    f"bars={trade.bars_held} reason={trade.exit_reason} gross={format_usd(trade.gross_profit_usd or 0.0)} "
                    f"cost={format_usd(trade.cost_usd or 0.0, False)} net={format_usd(trade.net_profit_usd or 0.0)}")

        def action(event=event, line=line) -> None:
            protocol.emit_cycle_trade(event)
            self.log(line)

        self._post_frame.append(action)

    # ── scoreboards ────────────────────────────────────────────────────────
    def _combined_inputs(self, include_open_fold: bool) -> ScoreInputs:
        combined = ScoreInputs()
        buy_and_hold = 0.0
        any_buy_and_hold = False
        simulator = self.simulator
        for accumulator in self.accumulators:
            inputs = accumulator.inputs
            combined.bar_net_usd.extend(inputs.bar_net_usd)
            combined.bar_exposed.extend(inputs.bar_exposed)
            combined.scored_actual_up.extend(inputs.scored_actual_up)
            combined.scored_predicted_up.extend(inputs.scored_predicted_up)
            combined.scored_probability_up.extend(inputs.scored_probability_up)
            combined.scored_majority_up.extend(inputs.scored_majority_up)
            combined.forecast_predicted_move_points.extend(inputs.forecast_predicted_move_points)
            combined.forecast_actual_move_points.extend(inputs.forecast_actual_move_points)
            value = inputs.buy_and_hold_usd if inputs.buy_and_hold_usd is not None else (
                self._fold_buy_and_hold(accumulator) if include_open_fold else None)
            if value is not None:
                buy_and_hold += value
                any_buy_and_hold = True
        if simulator is not None:
            combined.trade_nets = [t.net_profit_usd for t in simulator.closed_trades if t.net_profit_usd is not None]
            combined.total_cost_usd = simulator.total_cost_usd
        combined.buy_and_hold_usd = buy_and_hold if any_buy_and_hold else None
        return combined

    def _emit_running_scoreboard(self, fold_index: int) -> None:
        inputs = self._combined_inputs(include_open_fold=True)
        metrics, distribution, notes = scoreboard(inputs, self.periods_per_year)
        protocol.emit_cycle_scoreboard(
            scope="running", fold_index=fold_index, bars_evaluated=len(inputs.bar_net_usd),
            bars_scored=len(inputs.scored_actual_up), metrics=metrics, trade_distribution=distribution, notes=notes,
        )

    def _emit_final_scoreboard(self) -> None:
        inputs = self._combined_inputs(include_open_fold=True)
        metrics, distribution, notes = scoreboard(inputs, self.periods_per_year)
        if self.stopped:
            notes = ["stopped by the user: these metrics cover only the bars walked before the stop", *notes]
        protocol.emit_cycle_scoreboard(
            scope="final", fold_index=None, bars_evaluated=len(inputs.bar_net_usd),
            bars_scored=len(inputs.scored_actual_up), metrics=metrics, trade_distribution=distribution, notes=notes,
        )
        self.final_scoreboard = {
            "metrics": metrics, "tradeDistribution": distribution, "notes": notes,
            "barsEvaluated": len(inputs.bar_net_usd), "barsScored": len(inputs.scored_actual_up),
        }

    # ── stop ───────────────────────────────────────────────────────────────
    def _exit_at_next_open(self) -> bool:
        """Close an open trade on a stop the way every other exit fills: at the
        NEXT bar's open, walking that bar as a processed bar with no prediction.

        Closing at the last walked bar's close instead left the chart wrong: the
        pacer (and a pause) had already sent that bar, so its equity and
        position on the wire omitted the exit fill that the trade, the
        scoreboard and predictions.parquet all include. Emitting one more bar
        keeps "each bar exactly once" and makes all four agree.

        Returns False when there is no next bar in the fold's test span to fill
        on (the caller then falls back to the last close).
        """
        simulator = self.simulator
        row = self.last_processed_row
        if simulator is None or row is None or simulator.position == 0 or not self.accumulators:
            return False
        accumulator = self.accumulators[-1]
        k = accumulator.fold_index
        spec = self.folds[k] if k < len(self.folds) else None
        following = row + 1
        # test_index is the fold's contiguous test span
        if spec is None or spec.test_index.size == 0 or not (int(spec.test_index[0]) <= following <= int(spec.test_index[-1])):
            return False
        d = self.data
        simulator.pending_target = 0
        simulator.pending_reason = "stopped"
        result = simulator.step(following, int(d.timestamps[following]), d.open[following], d.high[following],
                                d.low[following], d.close[following], None, None, decide=False)
        self.equity += result.net_usd
        self.last_processed_row = following
        accumulator.bars_evaluated += 1
        accumulator.inputs.bar_net_usd.append(result.net_usd)
        accumulator.inputs.bar_exposed.append(result.exposed)
        accumulator.last_close = float(d.close[following])
        self.prediction_rows[following] = {
            "timestamp": int(d.timestamps[following]), "fold_index": k,
            "open": float(d.open[following]), "high": float(d.high[following]), "low": float(d.low[following]),
            "close": float(d.close[following]), "volume": float(d.volume[following]),
            "probability_up": None, "predicted_direction": 0, "position": 0,
            "equity_usd": self.equity, "actual_direction": None, "correct": None,
            "predicted_move_points": None, "predicted_close": None, "forecast_timestamp": None,
            "forecast_error_points": None,
        }
        frame = self._frame_for(k)
        for key, value in (("timestamps", int(d.timestamps[following])), ("open", d.open[following]),
                           ("high", d.high[following]), ("low", d.low[following]), ("close", d.close[following]),
                           ("volume", d.volume[following]), ("probabilityUp", None), ("predictedDirection", 0),
                           ("position", 0), ("equityUsd", self.equity), ("predictedClose", None),
                           ("forecastTimestamp", None)):
            frame[key].append(value)
        self.log(f"[control] stopping: closed the open trade at the next bar's open, {format_time(d.timestamps[following])} "
                 f"(the fill rule every exit uses); equity {format_usd(self.equity)}")
        return True

    def _handle_stop(self) -> None:
        simulator = self.simulator
        if self._exit_at_next_open():
            pass
        elif simulator is not None and self.last_processed_row is not None:
            self.log("[control] stopping: closing any open trade at the last processed bar's close")
            row = self.last_processed_row
            adjustment = simulator.flatten(row, int(self.data.timestamps[row]), float(self.data.close[row]), "stopped")
            if adjustment and self.accumulators:
                self.accumulators[-1].inputs.bar_net_usd[-1] += adjustment
                self.equity += adjustment
                record = self.prediction_rows.get(row)
                if record is not None:
                    record["equity_usd"] = self.equity
                    record["position"] = 0
                if self._frame is not None and self._frame["timestamps"] and self._frame["timestamps"][-1] == int(self.data.timestamps[row]):
                    self._frame["equityUsd"][-1] = self.equity
                    self._frame["position"][-1] = 0
        if self.accumulators and simulator is not None:
            accumulator = self.accumulators[-1]
            k = accumulator.fold_index
            accumulator.inputs.trade_nets = [t.net_profit_usd for t in simulator.closed_trades if t.fold_index == k and t.net_profit_usd is not None]
            accumulator.inputs.total_cost_usd = sum(t.cost_usd or 0.0 for t in simulator.closed_trades if t.fold_index == k)
            if accumulator.inputs.buy_and_hold_usd is None:
                accumulator.inputs.buy_and_hold_usd = self._fold_buy_and_hold(accumulator)
            if len(self.fold_records) > k and "metrics" not in self.fold_records[k]:
                metrics, trade_distribution, notes = scoreboard(accumulator.inputs, self.periods_per_year)
                self.fold_records[k].update(metrics=metrics, tradeDistribution=trade_distribution,
                                            notes=["stopped mid-fold", *notes], stopped=True)
        self._flush_frame()
        self._emit_final_scoreboard()


# ── the reporter adapters talk to ──────────────────────────────────────────


class EngineReporter:
    """``TrainingReporter`` implementation: turns an adapter's batch / epoch
    reports into cursors, ``cycle_epoch`` events, log lines and metrics."""

    def __init__(
        self,
        engine: CycleEngine,
        *,
        fold_index: int | None,
        train_index: np.ndarray,
        validation_index: np.ndarray,
        trial: int | None = None,
        trial_count: int | None = None,
        log_prefix: str | None = None,
        progress: Callable[[float], None] | None = None,
        quiet: bool = False,
        model_role: str = "direction",
    ) -> None:
        if model_role not in ("direction", "price"):
            raise ValueError(f"model role must be direction or price, got {model_role!r}")
        self.model_role = model_role
        self.price = model_role == "price"
        # every line the price model's fit writes names it: "[fold 1/3][train] price model ..."
        self.role_words = "price model " if self.price else ""
        self.engine = engine
        self.fold_index = fold_index
        self.train_index = train_index
        self.validation_index = validation_index
        self.trial = trial
        self.trial_count = trial_count
        self.tuning = trial is not None
        self.prefix = log_prefix if log_prefix is not None else engine.fold_prefix(fold_index)
        self.progress = progress
        self.quiet = quiet
        self.step_unit = "epoch"
        self.epoch = 0
        self.epoch_count = 0
        self.batches_seen = 0
        self.started = engine.clock()
        self.best_loss: float | None = None
        self.best_epoch: int | None = None
        ts = engine.data.timestamps
        self.window = (int(ts[train_index[0]]), int(ts[train_index[-1]]))
        self.validation_span = (int(ts[validation_index[0]]), int(ts[validation_index[-1]])) if validation_index.size else self.window
        patience = engine.parameters.get("patience")
        self.patience = int(patience) if isinstance(patience, (int, float)) and not isinstance(patience, bool) else None

    def _unit(self) -> str | None:
        unit = getattr(self, "step_unit", None)
        return unit if unit in protocol.CYCLE_STEP_UNITS else "epoch"

    def _fraction(self, batch: int | None = None, batch_count: int | None = None) -> float:
        if not self.epoch_count:
            return 0.0
        inside = (batch / batch_count) if batch and batch_count else 0.0
        return min(1.0, (max(0, self.epoch - 1) + inside) / self.epoch_count)

    def _report_progress(self, fraction: float) -> None:
        if self.progress is not None:
            self.progress(fraction)
        elif self.fold_index is not None:
            self.engine.fold_progress(self.fold_index, training_fraction=fraction, model_role=self.model_role)

    def _phase(self) -> str:
        return "tuning" if self.tuning else "training"

    def _cursor(self, *, force: bool, phase: str | None = None, span: tuple[int, int] | None = None,
                batch: int | None = None, batch_count: int | None = None, fraction: float = 0.0) -> None:
        engine = self.engine
        phase = phase or self._phase()
        fields = dict(
            fold_index=self.fold_index, span_start=(span or self.window)[0], span_end=(span or self.window)[1],
            epoch=self.epoch or None, epoch_count=self.epoch_count or None, batch=batch, batch_count=batch_count,
            step_unit=self._unit(), trial=self.trial, trial_count=self.trial_count, model_role=self.model_role,
        )
        if phase != engine._cursor.get("phase"):
            engine.set_phase(phase, phase_fraction=fraction, **fields)
        else:
            engine.emit_cursor(force=force, phase_fraction=fraction, **fields)

    # TrainingReporter protocol
    def epoch_started(self, epoch: int, epoch_count: int) -> None:
        self.epoch, self.epoch_count = int(epoch), int(epoch_count)
        fraction = self._fraction()
        self._report_progress(fraction)
        self._cursor(force=True, fraction=fraction)

    def batch(self, report: BatchReport) -> None:
        self.epoch, self.epoch_count = int(report.epoch), int(report.epoch_count)
        self.batches_seen += 1
        ts = self.engine.data.timestamps
        n = ts.shape[0]
        start_index = min(max(0, int(report.span_start_index)), n - 1)
        end_index = min(max(0, int(report.span_end_index)), n - 1)
        span = (int(ts[start_index]), int(ts[end_index]))
        fraction = self._fraction(report.batch, report.batch_count)
        self._report_progress(fraction)
        self._cursor(force=False, span=span if not self.tuning else None, batch=report.batch,
                     batch_count=report.batch_count, fraction=fraction)
        every = max(1, int(self.engine.settings.log_every_batches))
        if self.quiet or (report.batch % every != 0 and report.batch != report.batch_count):
            return
        whole = start_index <= int(self.train_index[0]) and end_index >= int(self.train_index[-1])
        parts = [f"loss={_format_number(report.train_loss)}"]
        if report.learning_rate is not None:
            parts.append(f"lr={report.learning_rate:.1e}")
        if report.gradient_norm is not None:
            parts.append(f"grad_norm={report.gradient_norm:.2f}")
        if report.samples_per_second is not None:
            parts.append(f"samples/s={report.samples_per_second:,.0f}")
        unit = self._unit()
        if unit == "epoch":
            head = f"epoch {report.epoch}/{report.epoch_count} batch {report.batch}/{report.batch_count}"
        else:
            words = {"boosting_round": "boosting round", "tree_batch": "trees", "solver_pass": "solver pass"}[unit]
            head = f"{words} {report.epoch}/{report.epoch_count} step {report.batch}/{report.batch_count}"
        block = f"block={format_time(span[0])}..{format_time(span[1])}"
        tail = " (every round sees the whole training window)" if whole and unit != "epoch" else ""
        self.engine.log(f"{self.prefix}[train] {self.role_words}{head} {' '.join(parts)} {block}{tail}",
                        "debug" if self.tuning else "info")

    def validating(self, epoch: int, epoch_count: int) -> None:
        self.epoch, self.epoch_count = int(epoch), int(epoch_count)
        phase = "tuning" if self.tuning else "validating"
        self._cursor(force=True, phase=phase, span=self.validation_span, fraction=self._fraction())

    def epoch_finished(self, report: EpochReport) -> None:
        engine = self.engine
        self.epoch, self.epoch_count = int(report.epoch), int(report.epoch_count)
        seconds = engine.clock() - self.started
        unit = self._unit()
        protocol.emit_cycle_epoch(
            fold_index=self.fold_index, trial=self.trial, epoch=report.epoch, epoch_count=report.epoch_count,
            step_unit=unit, train_loss=report.train_loss, validation_loss=report.validation_loss,
            validation_accuracy=report.validation_accuracy, validation_f1_score=report.validation_f1_score,
            learning_rate=report.learning_rate, gradient_norm=report.gradient_norm, is_best=report.is_best,
            seconds_elapsed=seconds, model_role=self.model_role,
        )
        engine.epoch_records.append({
            "fold_index": self.fold_index, "trial": self.trial, "model_role": self.model_role, "epoch": int(report.epoch),
            "epoch_count": int(report.epoch_count), "step_unit": unit, "train_loss": report.train_loss,
            "validation_loss": report.validation_loss, "validation_accuracy": report.validation_accuracy,
            "validation_f1_score": report.validation_f1_score, "learning_rate": report.learning_rate,
            "gradient_norm": report.gradient_norm, "is_best": bool(report.is_best), "seconds_elapsed": seconds,
        })
        loss = report.validation_loss
        # "best" is the epoch the adapter keeps. A neural price model keeps its
        # weights by validation Huber loss but reports mean absolute error, so
        # the lowest reported loss is not always the kept epoch: follow the
        # adapter's is_best flag, and fall back to the lowest reported loss only
        # for adapters that never set it.
        if report.is_best:
            self.saw_is_best = True
            self.best_loss, self.best_epoch = loss, report.epoch
        elif not getattr(self, "saw_is_best", False) and loss is not None and math.isfinite(loss) and (
            self.best_loss is None or loss < self.best_loss
        ):
            self.best_loss, self.best_epoch = loss, report.epoch
        level = "debug" if self.tuning else "info"
        # the price model reports mean absolute error of the volatility-scaled move, and the accuracy of its sign
        loss_name = "mae" if self.price else "logloss"
        if unit == "boosting_round":
            engine.log(
                f"{self.prefix}[train] {self.role_words}boosting round {report.epoch}/{report.epoch_count} "
                f"train_{loss_name}={_format_number(report.train_loss)} val_{loss_name}={_format_number(report.validation_loss)} "
                "(every round sees the whole training window)", level,
            )
        best = f"best={_format_number(self.best_loss)}@{self.best_epoch}" if self.best_epoch is not None else "best=n/a"
        since = (report.epoch - self.best_epoch) if self.best_epoch is not None else 0
        patience = f" patience={since}/{self.patience}" if self.patience else ""
        word = {"epoch": "epoch", "boosting_round": "round", "tree_batch": "trees", "solver_pass": "pass"}[unit]
        if self.price:
            scores = (f"val_mae={_format_number(report.validation_loss)} (in trailing-volatility units) "
                      f"val_sign_accuracy={_format_number(report.validation_accuracy, '.3f')}")
        else:
            scores = (f"val_loss={_format_number(report.validation_loss)} "
                      f"val_accuracy={_format_number(report.validation_accuracy, '.3f')} "
                      f"val_f1={_format_number(report.validation_f1_score, '.3f')}")
        engine.log(
            f"{self.prefix}[validate] {self.role_words}{word} {report.epoch}/{report.epoch_count} {scores} "
            f"{best}{patience}{' (stopped early)' if report.stopped_early else ''}", level,
        )
        if not self.tuning and self.price:
            engine.price_global_step += 1
            for name, value in (("price_model_train_mean_absolute_error", report.train_loss),
                                ("price_model_validation_mean_absolute_error", report.validation_loss)):
                if value is not None and math.isfinite(value):
                    protocol.emit_metric(name, value, iteration=engine.price_global_step)
        elif not self.tuning:
            engine.global_step += 1
            if report.train_loss is not None and math.isfinite(report.train_loss):
                protocol.emit_metric("train_loss", report.train_loss, iteration=engine.global_step)
            if report.validation_loss is not None and math.isfinite(report.validation_loss):
                protocol.emit_metric("validation_loss", report.validation_loss, iteration=engine.global_step)
        fraction = self._fraction() if report.epoch < report.epoch_count else 1.0
        if report.epoch >= report.epoch_count or report.stopped_early:
            fraction = 1.0
        self._report_progress(fraction)
        self._cursor(force=True, fraction=fraction)

    def checkpoint(self) -> None:
        self.engine.checkpoint()

    def log(self, message: str, level: str = "info") -> None:
        if not message.startswith("["):
            role = "" if "price model" in message else self.role_words     # the adapter may name itself
            message = f"{self.prefix}{'' if self.tuning else '[train]'} {role}{message}"
        self.engine.log(message, level if level in ("debug", "info", "warn", "error") else "info")
