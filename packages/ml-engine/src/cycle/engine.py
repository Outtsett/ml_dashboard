"""The Model Cycle engine: plan folds, tune, train, validate, walk test bars one
at a time, trade them, score them, and stream every step.

Design and the wire contract: ``docs/plans/2026-09-25-model-cycle.md`` and
``packages/shared/src/cycle/schema.ts``. The engine never imports a model library — a
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
- The model's registry entry (``cycle.catalog``) decides two variants. A key
  with ``price: null`` has no regression form: no price model is fitted, the
  run says so once, and no forecast columns are filled. A key with
  ``direction.mode == "from_price"`` has no classifier: the engine's direction
  factory returns a ``cycle.derived.DerivedDirectionAdapter``, which fits the
  price model on the price rows and then a logistic curve from its forecast to
  P(up) on the VALIDATION rows; that inner price model is also the fold's
  price model, fitted once. Tuning builds models through the same factory.

Artifacts for "Inside the model" (``cycle.store``): ``explain/`` at plan time
(the inputs every fold model reads and the manifest), ``fold_<k>/index.npz``
before a fold fits, and each model saved right after its own fit — so a run
stopped mid-walk still leaves every fitted model on disk.

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
from shared import protocol
from shared.walk_forward import iter_day_folds

from cycle import catalog, compressed
from cycle.adapter import MODEL_LABELS, BatchReport, EpochReport, ModelAdapter, StopRequested
from cycle.control import ControlState
from cycle.features import FeatureSet, history_valid
from cycle.labels import (
    actual_direction,
    horizon_crosses_gap,
    make_labels,
    make_reversal_labels,
    price_target,
    trailing_direction,
)
from cycle.market import MarketView, bind_market
from cycle.metrics import ScoreInputs, bars_per_year, buy_and_hold_usd, scoreboard
from cycle.simulate import CostModel, Simulator, Trade, round_to_tick

CONTEXT_CHUNK = 2000
CURSOR_INTERVAL_SECONDS = 0.05        # <= 20 Hz
FRAME_INTERVAL_SECONDS = 0.05
SCOREBOARD_INTERVAL_SECONDS = 0.25    # <= 4 Hz
BAR_LOG_INTERVAL_SECONDS = 0.05       # <= 20 per-bar lines a second when pacing fast
PAUSE_HEARTBEAT_SECONDS = 1.0
MINIMUM_TRAIN_ROWS = 50
MINIMUM_VALIDATION_ROWS = 10

LOADING_END = 0.05
FOLDS_END = 0.99
TRAINING_SHARE = 0.4
REPLAY_SHARE = 0.25          # of a fold's post-training span, when the validation replay is on
TUNING_SHARE_OF_FOLD = 0.35     # of a fold's progress span, when the fold tunes first
DIRECTION_TRAINING_SHARE = 0.6   # of TRAINING_SHARE; the price model takes the rest

# adapter_factory(parameters) -> the direction classifier;
# adapter_factory(parameters, task="regression") -> the price model
AdapterFactory = Callable[..., ModelAdapter]


def registry_entry(key: str) -> dict | None:
    """The model's registry entry, or None when the registry does not carry the
    key (a ``CYCLE_ADAPTER_FACTORY`` test factory may run any name)."""
    try:
        return catalog.entry(key)
    except (ValueError, OSError):   # an unknown key, or a registry that cannot be read (RegistryError is a ValueError)
        return None


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
    validation_fraction: float = 0.1
    test_fraction: float = 0.1
    test_days: int = 10
    step_days: int = 0
    fold_limit: int = 3
    expanding_window: bool = False
    label_horizon_bars: int = 6
    label_threshold_ticks: float = 0.0
    # what the direction model predicts: "direction" (up or down over the horizon) or
    # "reversal" (whether the next horizon bars turn against the previous horizon bars)
    label_kind: str = "direction"
    embargo_bars: int = 0
    long_only: bool = False
    holding_bars: int = 0
    stop_loss_ticks: float = 0.0
    take_profit_ticks: float = 0.0
    contracts: int = 1
    tuning_trials: int = 0                 # legacy explicit trial count; > 0 overrides the budget
    tuning_objective: str = "sharpe_ratio"
    tuning_folds: int = 2
    tuning_mode: str = "tuned"             # tuned | reviewed_defaults
    tuning_budget_trials: int = 20
    tuning_budget_seconds: int = 0
    tuning_pinned_parameters: str = ""     # comma-separated names held out of the search
    label_gap_multiple: float = 3.0        # 0 = no session-gap rule
    given_parameters: tuple = ()           # model parameter names the run was started with (not defaults)
    bars_per_second: float = 40.0
    start_paused: bool = False
    quiet_bars: bool = False
    log_every_batches: int = 10
    loss_surface_resolution: int = 21       # grid size of the loss surface after each fold's final neural fit (0 = none)
    device: str = "cpu"
    device_name: str | None = None
    seed: int = 42
    land_in_lake: bool = True
    replay_validation: bool = True          # replay the validation span bar by bar after the fit

    @property
    def resolved_holding_bars(self) -> int:
        return self.holding_bars if self.holding_bars > 0 else self.label_horizon_bars

    @property
    def train_fraction(self) -> float:
        """The share of a fold's bars that train. Derived, never configured: a run
        cannot ask for 80/10/20 because only the validation and test shares are
        dials and the three always sum to one."""
        return 1.0 - self.validation_fraction - self.test_fraction

    @property
    def pinned_parameters(self) -> tuple[str, ...]:
        return tuple(name.strip() for name in str(self.tuning_pinned_parameters or "").split(",") if name.strip())

    @property
    def resolved_tuning_trials(self) -> int:
        """Trials per fold: the legacy explicit `tuning_trials` wins; otherwise the budget when tuned."""
        if self.tuning_trials > 0:
            return int(self.tuning_trials)
        if self.tuning_mode == "tuned":
            return max(0, int(self.tuning_budget_trials))
        return 0

    @property
    def tuning_enabled(self) -> bool:
        if self.tuning_trials > 0:
            return True
        return self.tuning_mode == "tuned" and (self.tuning_budget_trials > 0 or self.tuning_budget_seconds > 0)

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
    # rows the two boundaries cost: the horizon purge and any embargo between the blocks
    discarded_bar_count: int = 0

    def plan(self, timestamps: np.ndarray) -> dict:
        def span(index: np.ndarray) -> tuple[int, int]:
            return (int(timestamps[index[0]]), int(timestamps[index[-1]])) if index.size else (0, 0)

        train_start, train_end = span(self.train_index)
        validation_start, validation_end = span(self.validation_index)
        test_start, test_end = span(self.test_index)
        # the shares actually realised, over the fold's whole extent — the honest
        # answer to "what trained, what validated, what was tested", after the
        # session-gap rule and the feature warmup took the rows they took
        extent = (self.train_index.size + self.validation_index.size + self.test_index.size
                  + self.discarded_bar_count) or 1
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
            "discardedBarCount": int(self.discarded_bar_count),
            "trainFraction": self.train_index.size / extent,
            "validationFraction": self.validation_index.size / extent,
            "testFraction": self.test_index.size / extent,
        }


def split_window(rows: np.ndarray, validation_fraction: float, test_fraction: float,
                 purge: int, embargo: int = 0) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Chronological three-way split of contiguous ``rows``.

    ``rows`` is one fold's whole extent in time order — the walk-forward window and
    the forward test window together — and it is cut once, in time, into

      * the first ``1 - validation_fraction - test_fraction`` that TRAIN,
      * the next ``validation_fraction`` that VALIDATE,
      * the last ``test_fraction`` that TEST.

    Each block's own rows are never trimmed at either end, so the three share really
    are the fractions asked for. What a boundary costs is charged to the block AFTER
    it: ``purge`` rows are dropped from the head of validation and of test, because a
    label or target made in the earlier block resolves ``horizon`` bars later and
    would otherwise be read across the boundary; ``embargo`` drops that many more
    bars from the head of test. Returns ``(train, validation, test, discarded)`` and
    ``discarded`` is the purged and embargoed rows, so a plan can state how many
    bars the boundaries cost.
    """
    count = int(rows.size)
    if count == 0:
        empty = np.empty(0, dtype=np.int64)
        return empty, empty.copy(), empty.copy(), empty.copy()
    validation_count = int(round(count * validation_fraction))
    test_count = int(round(count * test_fraction))
    # the three counts must leave the train block something; the engine validates
    # the fractions against a floor before calling, so this is a backstop only
    train_count = max(1, count - validation_count - test_count)
    validation_end = train_count + validation_count
    train = rows[:train_count]
    validation = rows[train_count + purge: validation_end]
    test = rows[validation_end + purge + embargo:]
    discarded = np.concatenate((
        rows[train_count: train_count + purge],
        rows[validation_end: validation_end + purge + embargo],
    )) if purge + embargo > 0 else np.empty(0, dtype=np.int64)
    return train, validation, test, discarded


def check_fold_invariants(spec: FoldSpec, labels: np.ndarray, valid: np.ndarray, horizon: int,
                          price_targets: np.ndarray | None = None) -> None:
    for name, index in (("train", spec.train_index), ("validation", spec.validation_index)):
        assert index.size > 0, f"fold {spec.fold_index}: empty {name} index"
        assert np.all(np.diff(index) > 0), f"fold {spec.fold_index}: {name} index not increasing"
        assert np.all(valid[index]), f"fold {spec.fold_index}: {name} row without feature history"
        assert np.all(np.isfinite(labels[index])), f"fold {spec.fold_index}: {name} row without a label"
    assert spec.test_index.size > 0 and np.all(np.diff(spec.test_index) == 1), "test span must be contiguous"
    # the three blocks are one chronological cut of the fold's extent, so they are
    # ordered and disjoint: nothing is trained on, validated on and tested at once
    assert (spec.train_index[-1] < spec.validation_index[0] <= spec.validation_index[-1]
            < spec.test_index[0]), f"fold {spec.fold_index}: train / validation / test are not one ordered cut"
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


@dataclass
class WalkSpan:
    """One bar-by-bar walk of a fold.

    The out-of-sample test walk and the validation market replay are the SAME walk
    pointed at different rows, so there is one definition of how a bar is predicted,
    filled, scored and drawn. They differ in what they own:

      * ``test`` carries ``writes_run_state=True``: its bars become the run's
        prediction rows, its trades and its equity are the run's, and its metrics are
        the fold's score.
      * ``replay`` carries ``writes_run_state=False``: it has its own simulator, its
        own equity and its own accumulator, it animates on the chart, and it writes
        nothing that a later gate could read.

    ``wire_name`` is what a ``cycle_bars`` frame is tagged with, so the two walks are
    told apart on the wire rather than by which fold or phase they belong to.
    """
    label: str
    phase: str
    wire_name: str
    rows: np.ndarray
    fold_index: int
    simulator: Simulator
    accumulator: FoldAccumulator
    writes_run_state: bool


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
        # what the registry says about this model; a key it does not carry runs as a plain classifier
        # with a price model, the way every model ran before the registry
        entry = registry_entry(settings.model_family)
        self.registry_entry = entry
        self.direction_mode = entry["direction"]["mode"] if entry else "classifier"
        self.has_price_model = (entry["price"] is not None) if entry else True
        self.explain_kind = entry["explainKind"] if entry else None
        self.display_name = entry["displayName"] if entry else MODEL_LABELS.get(settings.model_family, settings.model_family)
        # the factory the caller passed builds the family's adapters; every model the engine and
        # tuning build goes through build_adapter, which wraps it for a from_price key
        self.model_factory = adapter_factory
        self.adapter_factory: AdapterFactory = self.build_adapter
        self.suggest_parameters = suggest_parameters
        self.control = control or ControlState(settings.bars_per_second, settings.start_paused)
        self.clock = clock
        self.started = clock()
        # when the run began on the wall clock (epoch seconds): the record's started_at_timestamp.
        # `clock` is injectable and monotonic, so it cannot say when.
        self.started_wall_clock = time.time()
        self.horizon = settings.label_horizon_bars
        # a bar whose horizon spans a session gap (break, weekend, outage) gets no label, target or forecast
        self.crosses_gap = horizon_crosses_gap(data.timestamps, self.horizon, float(settings.label_gap_multiple))
        if settings.label_kind not in ("direction", "reversal"):
            raise ValueError(f"label_kind must be 'direction' or 'reversal', got {settings.label_kind!r}")
        self.reversal = settings.label_kind == "reversal"
        # the up/down label over the horizon is always kept: it is what a bar is scored against
        # and what the "always the common direction" baseline is taken from, whichever label the
        # model is fitted on
        self.direction_labels = make_labels(data.close, self.horizon, settings.label_threshold_ticks, cost.tick_size, self.crosses_gap)
        if self.reversal:
            self.labels = make_reversal_labels(data.close, self.horizon, settings.label_threshold_ticks, cost.tick_size, self.crosses_gap)
        else:
            self.labels = self.direction_labels
        # the price model's target, and the causal scale that turns its output back into points
        self.volatility_window = int(features.lookback)
        self.price_targets, self.move_scale, self.forward_moves = price_target(
            data.close, self.horizon, self.volatility_window, cost.tick_size, self.crosses_gap)
        # the run's market as a bridge model may read it (cycle.market): bars, raw features, targets,
        # scale, gap flags and costs. Handed to every adapter build_adapter makes that defines bind_market.
        self.market_view = MarketView.from_engine(self)
        self.periods_per_year = bars_per_year(data.timestamps)
        self.parameters = dict(settings.model_parameters)      # the run's base values (the plan's `parameters`)
        self.active_parameters = dict(self.parameters)          # what the fold being run fits with
        self.minimum_history = 0

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
        self._tuning_share = 0.0
        # records
        self.folds: list[FoldSpec] = []
        self.fold_records: list[dict] = []
        self.accumulators: list[FoldAccumulator] = []
        self.epoch_records: list[dict] = []
        self.loss_surfaces: list[dict] = []              # one per final neural fit, as emitted (`cycle_loss_surface`)
        self.gate_routings: list[dict] = []              # one per fold of a mixture of experts (`cycle_gate_routing`)
        # one per fold of a regime Monte Carlo decision model (`cycle_regime_forecast`, merged from its stretches)
        self.regime_forecasts: list[dict] = []
        self._regime_rows: list[dict] = []               # the walk's bars not yet sent, with their timestamps
        self._regime_adapter = None                      # the adapter whose bars they are (None: a kind with no regimes)
        self._regime_fold: int | None = None
        self.trial_records: list[dict] = []
        self.prediction_rows: dict[int, dict] = {}     # row -> record (insertion ordered)
        self.trades: dict[int, Trade] = {}
        self.fold_parameters: dict[int, dict] = {}       # fold -> the parameters its models were fitted with
        self.tuning_summaries: dict[int, dict] = {}      # fold -> its tuning summary (tuned folds only)
        self.metric_records: list[dict] = []             # every `metric` event, with its fold and trial
        self.bar_chunks: list[dict] = []                 # every bar emitted, context and processed, in order
        self.landed_tables: set[str] = set()             # lake tables whose manifest line this run wrote
        self.run_status = "running"                      # running | complete | stopped | failed
        self.failed = False
        self.failure: str | None = None
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
        self._span = "test"                # which walk the frames being built belong to
        self._post_frame: list[Callable[[], None]] = []
        self._last_flush = -math.inf     # when the last processed frame went out (<= 20 Hz above 20 bars/s)
        self._next_due: float | None = None

    # ── models ─────────────────────────────────────────────────────────────
    def build_adapter(self, parameters: dict, task: str = "classification") -> ModelAdapter:
        """The direction model (``task="classification"``) or the price model
        (``task="regression"``). For a from_price key the direction model is a
        ``DerivedDirectionAdapter`` around a fresh price model, reading this
        run's price target."""
        if task == "regression":
            return self._bound(self.model_factory(parameters, task="regression"))
        if self.direction_mode == "from_price":
            from cycle.derived import DerivedDirectionAdapter

            return DerivedDirectionAdapter(self._bound(self.model_factory(parameters, task="regression")),
                                           price_target=self.price_targets, key=self.settings.model_family)
        return self._bound(self.model_factory(parameters))

    def _bound(self, adapter: ModelAdapter) -> ModelAdapter:
        """The adapter, handed this run's ``MarketView`` when it defines
        ``bind_market`` (the bridge families). Every construction path goes
        through here: the probe, each fold's models, the price model, a
        from_price model's inner price model, tuning trials and the
        minimum-history recheck. Adapters without the method are untouched."""
        return bind_market(adapter, self.market_view)

    # ── logging / cursor ───────────────────────────────────────────────────
    def log(self, message: str, level: str = "info") -> None:
        protocol.emit_log(message, level)

    def emit_metric(self, name: str, value, iteration: int, total: int = 0) -> None:
        """A `metric` event, recorded for the run's `metrics` table with its fold and trial."""
        coordinates = protocol.get_active_coordinates()
        self.metric_records.append({
            "metric_name": str(name), "metric_value": float(value), "iteration": int(iteration), "total": int(total),
            "fold_index": coordinates["fold_idx"], "trial": coordinates["trial_idx"], "seconds_elapsed": self.elapsed(),
        })
        protocol.emit_metric(name, value, iteration=iteration, total=total)

    def _record_bars(self, role: str, fold_index: int | None, timestamps, open_prices, high_prices, low_prices,
                     close_prices, volumes, span: str = "test") -> None:
        """One chunk of the `bars` table: the bars just emitted, as the model saw them.

        ``span`` travels with the chunk so a run rebuilt from the record can still tell
        the scored out-of-sample bars from the validation replay's.
        """
        self.bar_chunks.append({
            "role": role, "span": span, "fold_index": fold_index,
            "timestamp": np.asarray(timestamps, dtype=np.int64), "open": np.asarray(open_prices, dtype=np.float64),
            "high": np.asarray(high_prices, dtype=np.float64), "low": np.asarray(low_prices, dtype=np.float64),
            "close": np.asarray(close_prices, dtype=np.float64), "volume": np.asarray(volumes, dtype=np.float64),
        })

    def probability_up(self, value: float | None, row: int) -> float | None:
        """The direction model's output at ``row`` as P(up), the one probability the walk, the
        search, the scores and the chart use.

        A direction model answers P(up) already. A reversal model answers P(turn): the chance
        the next ``horizon`` bars move against the previous ``horizon`` bars. A turn after an
        up-move is a down-move, so P(up) = 1 - P(turn) after an up-move and P(up) = P(turn)
        after a down-move. With no trailing move outside the label threshold there is nothing
        to turn against, and the bar has no call (None)."""
        if value is None or not self.reversal:
            return value
        trailing = trailing_direction(self.data.close, int(row), self.horizon,
                                      self.settings.label_threshold_ticks, self.cost.tick_size)
        if trailing == 0:
            return None
        return 1.0 - value if trailing > 0 else value

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
            self._record_bars("context", fold_index, timestamps, d.open[rows], d.high[rows], d.low[rows], d.close[rows], d.volume[rows])
            self.next_unemitted = end

    # ── plan ───────────────────────────────────────────────────────────────
    def _check_split_fractions(self) -> None:
        """The three shares must leave every block rows to work with, so a fold is
        never planned over a block too small to fit or to score."""
        s = self.settings
        for name, value in (("validation_fraction", s.validation_fraction), ("test_fraction", s.test_fraction)):
            if not 0.0 < value < 1.0:
                raise ValueError(f"{name} must be between 0 and 1, got {value}")
        if s.train_fraction <= 0.0:
            raise ValueError(
                f"validation_fraction ({s.validation_fraction}) + test_fraction ({s.test_fraction}) "
                f"must leave a training share, got {s.train_fraction:.4f}"
            )
        # a fold's extent is train_days + test_days calendar days; a validation or test
        # block of under a whole day's bars is never usable, so say so before loading one
        window_days = s.train_days + s.test_days
        if min(s.validation_fraction, s.test_fraction) * window_days < 1.0:
            raise ValueError(
                f"train_days={s.train_days} and test_days={s.test_days} give a window of {window_days} calendar "
                f"days; at validation_fraction={s.validation_fraction} and test_fraction={s.test_fraction} the "
                "smaller block is under a day of bars. Widen the window or raise the fractions."
            )

    def plan_folds(self, minimum_history: int) -> list[FoldSpec]:
        s = self.settings
        self._check_split_fractions()
        step = s.resolved_step_days
        if step < s.test_days:
            raise ValueError(f"step_days ({s.step_days}) must be 0 or >= test_days ({s.test_days}); a test bar is never tested twice")
        valid = history_valid(self.features, minimum_history)
        specs: list[FoldSpec] = []
        for fold in iter_day_folds(
            self.data.timestamps, s.train_days, s.test_days, step,
            # the boundaries are cut by split_window below, once, over the fold's
            # WHOLE extent: so the iterator hands over the window and the forward
            # test window untrimmed, and the purge is charged there and not twice
            purge_bars=0, embargo_bars=0, expanding=s.expanding_window,
        ):
            # one fold's extent: the walk-forward window and the forward test window
            # together, contiguous and in time order
            extent = np.concatenate((fold.train_idx, fold.test_idx))
            train_rows, validation_rows, test_rows, discarded = split_window(
                extent, s.validation_fraction, s.test_fraction, self.horizon, s.embargo_bars)
            train = train_rows[valid[train_rows] & np.isfinite(self.labels[train_rows])]
            validation = validation_rows[valid[validation_rows] & np.isfinite(self.labels[validation_rows])]
            price_train = train_rows[valid[train_rows] & np.isfinite(self.price_targets[train_rows])]
            price_validation = validation_rows[valid[validation_rows] & np.isfinite(self.price_targets[validation_rows])]
            if price_train.size < MINIMUM_TRAIN_ROWS or price_validation.size < MINIMUM_VALIDATION_ROWS:
                price_train = price_validation = np.empty(0, dtype=np.int64)
            when = f"{format_time(self.data.timestamps[test_rows[0]])}..{format_time(self.data.timestamps[test_rows[-1]])}"
            if train.size < MINIMUM_TRAIN_ROWS or validation.size < MINIMUM_VALIDATION_ROWS:
                self.log(
                    f"[plan] skipped the fold testing {when}: {train.size} training and {validation.size} validation rows "
                    f"with feature history and a label (need {MINIMUM_TRAIN_ROWS} and {MINIMUM_VALIDATION_ROWS})",
                    "warn",
                )
                continue
            specs.append(FoldSpec(
                fold_index=len(specs), window_start=int(extent[0]), window_end=int(extent[-1]) + 1,
                train_index=train, validation_index=validation, test_index=test_rows,
                price_train_index=price_train, price_validation_index=price_validation,
                discarded_bar_count=int(discarded.size),
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
            # the baseline is a direction (always up, or always down), so it is taken from the
            # up/down labels of the training bars even when the model is fitted on reversal labels
            directions = self.direction_labels[spec.train_index]
            directions = directions[np.isfinite(directions)]
            spec.majority_up = 1 if directions.size == 0 or np.mean(directions) >= 0.5 else 0
            check_fold_invariants(spec, self.labels, valid, self.horizon, self.price_targets)
        first = specs[0].plan(self.data.timestamps)
        self.log(
            f"[plan] {len(specs)} fold(s) cut {s.train_fraction:.0%} train / {s.validation_fraction:.0%} validation / "
            f"{s.test_fraction:.0%} test of each window's bars, chronologically; the first fold realised "
            f"{first['trainFraction']:.1%} / {first['validationFraction']:.1%} / {first['testFraction']:.1%} "
            f"({first['trainBarCount']:,} / {first['validationBarCount']:,} / {first['testBarCount']:,} bars) after "
            f"{self.horizon} bars purged at each boundary"
        )
        return specs

    def _progress_geometry(self) -> None:
        start = LOADING_END
        self._tuning_share = TUNING_SHARE_OF_FOLD if self.settings.tuning_enabled else 0.0
        total = sum(spec.test_index.size for spec in self.folds) or 1
        regions = []
        cursor = start
        for spec in self.folds:
            width = (FOLDS_END - start) * spec.test_index.size / total
            regions.append((cursor, cursor + width))
            cursor += width
        self._fold_regions = regions

    def fold_progress(self, fold_index: int, training_fraction: float | None = None, test_fraction: float | None = None,
                      model_role: str = "direction", replay: bool = False) -> None:
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
            # after training the fold has two walks: the validation replay takes the
            # first quarter of what is left, the out-of-sample test walk the rest
            replayed = replay and self.settings.replay_validation
            start = TRAINING_SHARE if replayed else TRAINING_SHARE + (REPLAY_SHARE if self.settings.replay_validation else 0.0)
            within = start + (1.0 - start) * min(1.0, max(0.0, test_fraction))
        within = self._tuning_share + (1 - self._tuning_share) * within
        self.set_overall(low + (high - low) * within)

    def tuning_progress(self, fold_index: int, fraction: float) -> None:
        """Progress through a fold's tuning: the first `_tuning_share` of the fold's span."""
        if self._tuning_share > 0 and fold_index < len(self._fold_regions):
            low, high = self._fold_regions[fold_index]
            self.set_overall(low + (high - low) * self._tuning_share * min(1.0, max(0.0, fraction)))

    def build_plan(self) -> dict:
        s = self.settings
        tuning = None
        if s.tuning_enabled:
            # per fold: each fold searches on its own training window (the fold plan carries the span)
            tuning = {
                "mode": "tuned",          # on: an explicit legacy trial count counts as tuned
                "trialCount": int(s.resolved_tuning_trials),
                "budgetSeconds": int(s.tuning_budget_seconds),
                "objective": s.tuning_objective,
                "innerFoldCount": int(s.tuning_folds),
                "perFold": True,
                "pinned": list(s.pinned_parameters),
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
            **self._registry_plan_fields(),
            "parameters": parameters,
            "device": "cuda" if s.device == "cuda" else "cpu",
            "deviceName": s.device_name,
            "dataStart": int(self.data.timestamps[0]),
            "dataEnd": int(self.data.timestamps[-1]),
            "barCount": len(self.data),
            "barsPerYear": float(self.periods_per_year),
            "featureNames": list(self.feature_set.names),
            "labelHorizonBars": int(self.horizon),
            "labelKind": s.label_kind,
            "labelThresholdTicks": float(s.label_threshold_ticks),
            "labelGapMultiple": float(s.label_gap_multiple),
            "gapCrossingBarCount": int(self.crosses_gap.sum()),
            "purgeBars": int(self.horizon),
            "embargoBars": int(s.embargo_bars),
            "splitFractions": {
                "train": float(s.train_fraction),
                "validation": float(s.validation_fraction),
                "test": float(s.test_fraction),
            },
            # the validation span is replayed bar by bar after the fit; nothing it shows gates anything
            "replayValidation": bool(s.replay_validation),
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

    def _registry_plan_fields(self) -> dict:
        """The plan's registry fields; a key the registry does not carry sends
        only ``catalogSpecId: null`` (the others are optional on the wire)."""
        entry = self.registry_entry
        if entry is None:
            return {"catalogSpecId": None}
        return {
            "catalogSpecId": entry["catalogSpecId"],
            "implementation": entry["implementation"],
            "explainKind": entry["explainKind"],
            "directionMode": entry["direction"]["mode"],
            "hasPriceModel": entry["price"] is not None,
        }

    # ── run ────────────────────────────────────────────────────────────────
    def run(self) -> dict:
        """Run the whole cycle; returns the done-diagnostics. Writes artifacts
        and emits ``done`` on completion and on a user stop."""
        from cycle import store

        failure: BaseException | None = None
        try:
            self._run()
            self.set_overall(1.0)
            self.set_phase("complete", phase_fraction=1.0)
            self.run_status = "complete"
        except StopRequested:
            self.stopped = True
            self.run_status = "stopped"
            self._handle_stop()
            self.set_phase("stopped", phase_fraction=1.0)
        except BaseException as error:  # noqa: BLE001 - the record of what ran is written, then the failure is re-raised
            failure = error
            self.failed = True
            self.run_status = "failed"
            self.failure = f"{type(error).__name__}: {error}"
            self.log(f"[run] failed: {self.failure}; writing the record of what ran", "error")
            try:
                self._handle_failure()
            except Exception as inner:  # noqa: BLE001
                self.log(f"[run] could not close the failed fold cleanly: {type(inner).__name__}: {inner}", "warn")
        protocol.set_active_fold(None)
        protocol.set_active_trial(None)
        try:
            diagnostics = store.write_run(self, final=True)
        except Exception as error:  # noqa: BLE001
            if failure is None:
                raise
            self.log(f"[save] the run record could not be written after the failure: {type(error).__name__}: {error}", "error")
            raise failure from error
        if failure is not None:
            raise failure
        protocol.emit_done(model_path=self.settings.artifact_directory, diagnostics=diagnostics)
        return diagnostics

    def _run(self) -> None:
        s = self.settings
        self.set_phase("loading")
        probe = self.adapter_factory(dict(self.parameters))
        # a model whose trade gate makes one search objective meaningless names the one to use
        required_objective = getattr(probe, "required_tuning_objective", None)
        self.tuning_objective_replaced: str | None = None
        if s.tuning_enabled and required_objective and s.tuning_objective != required_objective:
            self.tuning_objective_replaced = s.tuning_objective
            s.tuning_objective = str(required_objective)
        minimum = int(probe.minimum_history())
        self.minimum_history = minimum
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
        gap_bars = int(self.crosses_gap.sum())
        if self.reversal:
            self.log(f"[plan] label: reversal — 1 when the next {self.horizon} bars move against the previous {self.horizon} bars, 0 when they continue; "
                     "the model's P(turn) is read as P(up) = 1 - P(turn) after an up-move and P(turn) after a down-move, "
                     "so the walk, the search, the scores and the chart all use P(up); a bar with no trailing move outside the threshold has no call")
        if s.label_gap_multiple > 0:
            self.log(
                f"[plan] session-gap rule: a bar whose {self.horizon}-bar horizon crosses a gap over {s.label_gap_multiple:g}× the typical "
                f"bar interval has no label, target or forecast — {gap_bars:,} of {len(self.data):,} bars"
            )
        if s.tuning_enabled:
            budget = (f"{s.resolved_tuning_trials} trials" if s.tuning_budget_seconds <= 0
                      else f"{s.resolved_tuning_trials} trials or {s.tuning_budget_seconds} s")
            self.log(f"[plan] hyperparameters: tuned inside every fold on its own training window, {budget} per fold, "
                     f"objective {s.tuning_objective}" + (f", pinned {', '.join(s.pinned_parameters)}" if s.pinned_parameters else ""))
            if self.tuning_objective_replaced:
                self.log(f"[plan] search objective: {s.tuning_objective} in place of the run's {self.tuning_objective_replaced}. "
                         "This model's trade gate opens only on out-of-fold evidence, so most trials take no trade; a "
                         f"{self.tuning_objective_replaced} search scores those 0 and would pick whichever trial traded by luck")
        else:
            self.log(f"[plan] hyperparameters: {'the values given for the run' if s.given_parameters else 'the reviewed defaults'}, no search")
        self.price_forecasts_on_grid = True
        label = MODEL_LABELS.get(s.model_family, s.model_family)
        if not self.has_price_model:
            self.log(f"[plan] {label} has no regression form: no price model is fitted and no forecast line is drawn this run")
        elif self.direction_mode == "from_price":
            self.log(f"[plan] {label} has no classifier form: each fold fits it to the price target once and reads P(up) "
                     "from its forecast through a logistic curve fitted on that fold's validation bars")
        self._write_explain_inputs(minimum)
        self.set_overall(LOADING_END)
        self.emit_cursor(force=True)
        if s.start_paused:
            self.log("[control] starting paused — press resume to begin")
        self.checkpoint()

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
        # The chart is fed bars in the order the process reads them, each exactly once,
        # so the validation replay can only read bars the run has not walked yet. A
        # rolling window steps forward by less than its own length, so on every fold
        # after the first the validation block reaches back over bars an earlier fold
        # already walked out of sample; those folds do not replay, and say so.
        ts = self.data.timestamps
        replay_rows = spec.validation_index if s.replay_validation else np.empty(0, dtype=np.int64)
        if replay_rows.size and int(replay_rows[0]) < self.next_unemitted:
            self.log(
                f"{prefix}[replay] this fold's validation block starts {format_time(ts[replay_rows[0]])}, "
                f"which an earlier fold has already walked out of sample; it is replayed on the first fold instead",
                "debug",
            )
            replay_rows = np.empty(0, dtype=np.int64)
        self.emit_context_until(int(replay_rows[0]) if replay_rows.size else int(spec.test_index[0]), k)
        parameters, tuning_summary = self._choose_parameters(spec)
        self.active_parameters = dict(parameters)
        directory = os.path.join(s.artifact_directory, f"fold_{k}")
        price_train, price_validation = self._price_rows(spec)
        self._write_fold_index(spec, directory, price_train, price_validation)
        if self.direction_mode == "from_price":
            adapter, training_seconds = self._fit_direction_from_price(spec, price_train, price_validation)
        else:
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
            adapter = self.adapter_factory(dict(self.active_parameters))
            reporter = EngineReporter(self, fold_index=k, train_index=spec.train_index, validation_index=spec.validation_index)
            training_started = self.clock()
            adapter.fit(self.features, self.labels, spec.train_index, spec.validation_index, ts, reporter)
            training_seconds = self.clock() - training_started
            self.fold_progress(k, training_fraction=1.0)
            self.log(f"{prefix}[train] fitted in {training_seconds:.1f} s")
        # each model is saved right after its own fit, so a stop later in the fold keeps it
        model_path = self._save_model(adapter, directory, k, "model")
        price_model_path: str | None = None
        if self.direction_mode == "from_price":
            # the direction model's inner price model is the fold's price model (saved with it);
            # its single fit is timed in trainingSeconds, so it is not counted twice here
            price_adapter, price_seconds = adapter.price_adapter, None
            price_model_path = getattr(adapter, "price_model_path", None) if model_path is not None else None
        elif self.has_price_model:
            price_adapter, price_seconds = self._fit_price_model(spec)
            if price_adapter is not None:
                price_model_path = self._save_model(price_adapter, os.path.join(directory, "price_model"), k, "price model")
        else:
            price_adapter, price_seconds = None, None
            self.fold_progress(k, training_fraction=1.0, model_role="price")

        accumulator = FoldAccumulator(fold_index=k)
        self.accumulators.append(accumulator)
        record = {**spec.plan(ts), "trainingSeconds": training_seconds, "majorityClassUp": spec.majority_up,
                  # the rows the price model was actually fitted on (the direction rows when too few were planned)
                  "priceTrainBarCount": int(price_train.size) if price_adapter is not None else 0,
                  "priceValidationBarCount": int(price_validation.size) if price_adapter is not None else 0,
                  "priceTrainingSeconds": price_seconds,
                  # on disk from here on, so a stop during the walk still records them
                  "modelPath": model_path, "priceModelPath": price_model_path,
                  # what this fold's models were fitted with, and how it was chosen
                  "parameters": dict(parameters), "tuning": tuning_summary, "status": "running"}
        self.fold_records.append(record)
        if replay_rows.size:
            # the market replay: the fitted model walking the validation span bar by
            # bar, before the out-of-sample walk, on its own simulator and equity
            replay_summary = self._replay_validation(spec, adapter, price_adapter)
            # the replay consumed the validation bars, so the context resumes here and
            # the walk below starts from the test span with nothing re-emitted
            self.emit_context_until(int(spec.test_index[0]), k)
            if replay_summary is not None:
                record["validationReplay"] = replay_summary
                self.log(
                    f"{prefix}[replay] {replay_summary['barsWalked']:,} validation bars walked, "
                    f"{replay_summary['tradeCount']} trades, net {format_usd(replay_summary['netProfitUsd'])}, "
                    f"accuracy {_format_number(replay_summary['accuracy'], '.3f')} — the model was fitted and "
                    "selected on these bars, so this is a look at the fitted model, never a test result"
                )
        testing_started = self.clock()
        self._walk_test(spec, adapter, accumulator, price_adapter)
        testing_seconds = self.clock() - testing_started
        self._record_gate_routing(spec, adapter)
        self._record_regime_forecasts(spec)
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
        record["status"] = "complete"
        protocol.emit_fold_complete(k, {**{key: value for key, value in metrics.items() if value is not None}, **spans})
        for name in ("net_profit_usd", "sharpe_ratio", "sortino_ratio", "maximum_drawdown_usd", "profit_factor",
                     "win_rate", "trade_count", "accuracy", "f1_score", "roc_auc", "log_loss", "brier_score",
                     "price_forecast_mean_absolute_error_points", "persistence_mean_absolute_error_points",
                     "price_forecast_skill"):
            if metrics.get(name) is not None:
                self.emit_metric(name, metrics[name], iteration=k, total=self.fold_count)

        test_rows = spec.test_index
        records = [self.prediction_rows[int(row)] for row in test_rows]
        protocol.emit_prediction_markers(
            [int(ts[row]) for row in test_rows],
            [rec["predicted_direction"] for rec in records],
            [None if rec["probability_up"] is None else abs(rec["probability_up"] - 0.5) * 2 for rec in records],
        )
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

        self._land_fold(k)

    def _land_fold(self, fold_index: int) -> None:
        """Write and land the record so far: a crash or a kill later loses at most the fold in progress."""
        from cycle import store

        try:
            store.write_run(self, final=False)
        except Exception as error:  # noqa: BLE001 - landing never fails the run
            self.log(f"{self.fold_prefix(fold_index)}[save] could not write the fold's record: {type(error).__name__}: {error}", "warn")

    def _choose_parameters(self, spec: FoldSpec) -> tuple[dict, dict | None]:
        """The parameters this fold's models are fitted with: the fold's own
        Optuna search over the run's base values when tuning is on and the model
        has a search space; the base values otherwise. Emits `cycle_parameters`."""
        s = self.settings
        k = spec.fold_index
        prefix = self.fold_prefix(k)
        base = dict(self.parameters)
        pinned = s.pinned_parameters
        searchable = self._searchable_parameters()
        summary: dict | None = None
        if s.tuning_enabled and self.suggest_parameters is None:
            self.log(f"{prefix}[tune] no search space is wired for {self.display_name}; this fold uses the run's parameters", "warn")
        if s.tuning_enabled and searchable is not None and not searchable:
            self.log(f"{prefix}[tune] {self.display_name} has no searchable parameter; this fold uses the run's parameters", "warn")
        if s.tuning_enabled and self.suggest_parameters is not None and (searchable is None or searchable):
            from cycle.tuning import run_tuning

            parameters, summary = run_tuning(
                self, spec, trial_budget=s.resolved_tuning_trials, seconds_budget=float(s.tuning_budget_seconds), pinned=pinned,
            )
            source = "tuned"
            minimum_after = int(self.adapter_factory(dict(parameters)).minimum_history())
            if minimum_after != self.minimum_history:
                raise RuntimeError(
                    f"fold {k + 1}: the tuned model needs {minimum_after} bars of history (the plan was made for "
                    f"{self.minimum_history}); a searched parameter changes the history requirement — pin it"
                )
        else:
            parameters = base
            source = "manual" if s.given_parameters else "reviewed_defaults"
        protocol.emit_cycle_parameters(
            fold_index=k, parameters=parameters, source=source,
            objective_name=(s.tuning_objective if summary else None),
            best_trial=(summary or {}).get("bestTrial"), best_value=(summary or {}).get("bestValue"),
            trial_count=(summary or {}).get("trialCount"), pinned=pinned,
        )
        self.fold_parameters[k] = dict(parameters)
        if summary is not None:
            self.tuning_summaries[k] = summary
        return parameters, summary

    def _searchable_parameters(self) -> tuple[str, ...] | None:
        """The names the registry searches for this model; None when the key is not in the registry."""
        if self.registry_entry is None:
            return None
        return tuple(name for name, spec in self.registry_entry["parameters"].items() if spec.get("search"))

    def _handle_failure(self) -> None:
        """Close the record of a run that raised: flush the frame on the wire,
        mark the fold in progress failed, and score what did finish."""
        self._flush_frame()
        if self.fold_records and self.fold_records[-1].get("status") == "running":
            self.fold_records[-1]["status"] = "failed"
            self.fold_records[-1]["error"] = self.failure
        if any(record.get("status") == "complete" for record in self.fold_records):
            self._emit_final_scoreboard()

    # ── artifacts and the from_price fit ───────────────────────────────────
    def _write_explain_inputs(self, sequence_length: int) -> None:
        from cycle import store

        try:
            directory = store.write_explain_inputs(self, sequence_length)
            self.log(f"[save] model inputs for Inside the model -> {directory}", "debug")
        except Exception as error:  # noqa: BLE001 - the run must not fail over its explain files
            self.log(f"[save] the model inputs for Inside the model could not be written: {error}", "warn")

    def _write_fold_index(self, spec: FoldSpec, directory: str, price_train: np.ndarray, price_validation: np.ndarray) -> None:
        from cycle import store

        try:
            store.write_fold_index(directory, train=spec.train_index, validation=spec.validation_index,
                                   test=spec.test_index, price_train=price_train, price_validation=price_validation)
        except Exception as error:  # noqa: BLE001 - the run must not fail over its explain files
            self.log(f"[save] fold {spec.fold_index + 1}/{self.fold_count} row index could not be written: {error}", "warn")

    GATE_ROUTINGS_FILE = "gate_routings.json"

    def _record_gate_routing(self, spec: FoldSpec, adapter: ModelAdapter) -> None:
        """A mixture of experts' gate probabilities over the fold's scored test
        bars, emitted live and written beside the artifacts; nothing for a kind
        with no gate. A failure is a warning, never a lost fold."""
        route = getattr(adapter, "routing", None)
        if not callable(route):
            return
        try:
            rows = spec.test_index[history_valid(self.features, int(adapter.minimum_history()))[spec.test_index]]
            probabilities = route(self.features, rows)
            if probabilities is None or len(rows) == 0:
                return
            timestamps = [int(self.data.timestamps[row]) for row in rows]
            payload = protocol.cycle_gate_routing_payload(fold_index=spec.fold_index, model_role="direction", timestamps=timestamps, probabilities=probabilities)
            protocol.emit_cycle_gate_routing(fold_index=spec.fold_index, model_role="direction", timestamps=timestamps, probabilities=probabilities)
            self.gate_routings.append(payload)
            self._write_json_list(self.GATE_ROUTINGS_FILE, self.gate_routings)
            usage = ", ".join(f"expert {k + 1} {share * 100:.0f}%" for k, share in enumerate(payload["usage"]))
            self.log(f"{self.fold_prefix(spec.fold_index)}[routing] gate over {len(rows):,} test bars: {usage}")
        except Exception as error:  # noqa: BLE001 - the routing is a picture of the fit, not the fit
            self.log(f"{self.fold_prefix(spec.fold_index)}[routing] gate routing not recorded: {error}", "warn")

    REGIME_FORECASTS_FILE = "regime_forecasts.json"
    # the per-bar columns of a regime forecast stretch (everything else is the fold's constants)
    REGIME_FORECAST_COLUMNS = (
        "timestamps", "close", "regimeProbabilities", "mostLikelyRegime", "monteCarloProbabilityUp",
        "monteCarloExpectedMovePoints", "monteCarloPercentile10Points", "monteCarloPercentile50Points",
        "monteCarloPercentile90Points", "kronosOpen", "kronosHigh", "kronosLow", "kronosClose",
        "kronosPredictedMovePoints", "decisionProbabilityUp", "claimedGainPoints", "expectedGainPoints", "gateOpen",
    )

    def _flush_regime_forecasts(self) -> None:
        """Send the walk's bars a regime model has spoken for since the last flush as one
        ``cycle_regime_forecast`` stretch, and fold them into the fold's record."""
        rows, self._regime_rows = self._regime_rows, []
        adapter = self._regime_adapter
        if not rows or adapter is None:
            return
        try:
            payload = protocol.emit_cycle_regime_forecast(
                fold_index=self._regime_fold, model_role="direction", rows=rows, **adapter.regime_forecast_context())
        except Exception as error:  # noqa: BLE001 - the forecasts are a picture of the model, not the walk
            self.log(f"{self.fold_prefix(self._regime_fold or 0)}[regime] {len(rows)} bars of regime forecasts not sent: {error}", "warn")
            return
        record = next((entry for entry in self.regime_forecasts if entry.get("foldIndex") == payload["foldIndex"]), None)
        if record is None:
            self.regime_forecasts.append(payload)
            return
        for name, value in payload.items():
            if name in self.REGIME_FORECAST_COLUMNS:
                record[name].extend(value)
            else:
                record[name] = value

    def _record_regime_forecasts(self, spec: FoldSpec) -> None:
        """At the end of a fold's test walk: write every fold's regime forecasts beside the
        artifacts and say in one line what the fold's regimes and gate did."""
        self._flush_regime_forecasts()
        self._regime_adapter = None
        record = next((entry for entry in self.regime_forecasts if entry.get("foldIndex") == spec.fold_index), None)
        if record is None:
            return
        try:
            self._write_json_list(self.REGIME_FORECASTS_FILE, self.regime_forecasts)
        except Exception as error:  # noqa: BLE001 - a failed write is a warning, never a lost fold
            self.log(f"{self.fold_prefix(spec.fold_index)}[regime] regime forecasts could not be written: {error}", "warn")
        bars = len(record["timestamps"])
        opened = sum(1 for value in record["gateOpen"] if value)
        names = list(record.get("regimeNames") or [f"regime {k + 1}" for k in range(int(record["regimeCount"]))])
        counts = dict.fromkeys(names, 0)
        for regime in record["mostLikelyRegime"]:
            if regime in counts:
                counts[regime] += 1
        occupancy = ", ".join(f"{name} {count / max(bars, 1) * 100:.0f}%" for name, count in counts.items())
        self.log(
            f"{self.fold_prefix(spec.fold_index)}[regime] {bars:,} test bars: most likely {occupancy}; "
            f"trade gate open on {opened:,} ({opened / max(bars, 1) * 100:.1f}%)"
        )

    def _write_json_list(self, file_name: str, rows: list[dict]) -> None:
        """One zstandard-compressed JSON file (``<name>.zst``) of every entry so far beside the run's artifacts, written atomically."""
        os.makedirs(self.settings.artifact_directory, exist_ok=True)
        compressed.write_json(os.path.join(self.settings.artifact_directory, file_name), rows)

    LOSS_SURFACES_FILE = "loss_surfaces.json"

    def write_loss_surfaces(self) -> None:
        """Every loss surface so far, as one JSON file beside the run's
        artifacts (`data/models/<id>/loss_surfaces.json.zst`): the run page reads
        it back for a recorded run. A failed write is a warning, never a lost fold."""
        try:
            self._write_json_list(self.LOSS_SURFACES_FILE, self.loss_surfaces)
        except Exception as error:  # noqa: BLE001 - the run must not fail over its surface file
            self.log(f"[save] loss surfaces could not be written: {error}", "warn")

    def _save_model(self, adapter: ModelAdapter, directory: str, fold_index: int, words: str) -> str | None:
        """Save one fitted model; a failed save is a warning, never a lost fold."""
        try:
            os.makedirs(directory, exist_ok=True)
            path = adapter.save(directory)
        except Exception as error:  # noqa: BLE001 - a failed save must not lose the fold's results
            self.log(f"[save] fold {fold_index + 1}/{self.fold_count} {words} could not be saved: {error}", "warn")
            return None
        self.log(f"[save] fold {fold_index + 1}/{self.fold_count} {words} -> {path}")
        return path

    def _price_rows(self, spec: FoldSpec) -> tuple[np.ndarray, np.ndarray]:
        """The rows the fold's price model fits on: the planned price rows; for
        a from_price model whose fold had too few of them, the direction rows
        whose price target is known (its one model must still be fitted);
        none when the model has no price model."""
        empty = np.empty(0, dtype=np.int64)
        if not self.has_price_model:
            return empty, empty
        if self.direction_mode == "from_price" and spec.price_train_index.size == 0:
            from cycle.derived import price_rows

            return price_rows(spec.train_index, self.price_targets), price_rows(spec.validation_index, self.price_targets)
        return spec.price_train_index, spec.price_validation_index

    def _fit_direction_from_price(self, spec: FoldSpec, train: np.ndarray,
                                  validation: np.ndarray) -> tuple[ModelAdapter, float]:
        """The fold's one fit for a from_price model: the price model on the
        price rows, then the logistic curve on the labelled validation rows."""
        s = self.settings
        k = spec.fold_index
        prefix = self.fold_prefix(k)
        ts = self.data.timestamps
        if train.size == 0 or validation.size == 0:
            raise ValueError(f"fold {k + 1}: no rows with a known {self.horizon}-bar move to fit {s.model_family} on")
        self.log(
            f"{prefix}[train] direction from price: fitting {MODEL_LABELS.get(s.model_family, s.model_family)} to the "
            f"{self.horizon}-bar move divided by its trailing {self.volatility_window}-bar volatility on {train.size:,} bars "
            f"{format_time(ts[train[0]])}..{format_time(ts[train[-1]])}, validating on {validation.size:,} bars "
            f"{format_time(ts[validation[0]])}..{format_time(ts[validation[-1]])}; then a logistic curve from its forecast "
            f"to P(up) on the {spec.validation_index.size:,} labelled validation bars"
        )
        self.set_phase("training", fold_index=k, span_start=int(ts[train[0]]), span_end=int(ts[train[-1]]), model_role="price")
        self.fold_progress(k, training_fraction=0.0, model_role="price")
        adapter = self.adapter_factory(dict(self.active_parameters))
        reporter = EngineReporter(self, fold_index=k, train_index=train, validation_index=validation, model_role="price")
        started = self.clock()
        adapter.fit(self.features, self.labels, spec.train_index, spec.validation_index, ts, reporter,
                    price_target=self.price_targets, price_train_index=train, price_validation_index=validation)
        seconds = self.clock() - started
        self.fold_progress(k, training_fraction=1.0, model_role="price")
        self.log(f"{prefix}[train] fitted in {seconds:.1f} s; it is also this fold's price model")
        return adapter, seconds

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
            adapter = self.adapter_factory(dict(self.active_parameters), task="regression")
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
        row = self.prediction_rows.get(source_row)
        if row is not None:
            row["forecast_error_points"] = predicted_move - actual

    # ── the walk ───────────────────────────────────────────────────────────
    def _walk_test(self, spec: FoldSpec, adapter: ModelAdapter, accumulator: FoldAccumulator,
                   price_adapter: ModelAdapter | None = None) -> None:
        """The fold's out-of-sample walk over the last `test_fraction` of its bars.
        It owns the run: the bars it walks are scored, its trades and its equity are
        the run's, and its metrics are the fold's score."""
        assert self.simulator is not None
        self._walk_span(spec, adapter, price_adapter, WalkSpan(
            label="test", phase="testing", wire_name="test", rows=spec.test_index, fold_index=spec.fold_index,
            simulator=self.simulator, accumulator=accumulator, writes_run_state=True,
        ))

    def _replay_validation(self, spec: FoldSpec, adapter: ModelAdapter,
                           price_adapter: ModelAdapter | None) -> dict | None:
        """The market replay: the fitted model, walked bar by bar over the validation
        span at the run's pace, on its own simulator and its own equity.

        The validation bars are rows the model was fitted on and selected on, so this
        is a look at the fitted model trading the span it learned from — never a test
        result. Nothing it measures is written to the run's prediction rows, trades or
        equity, and no gate reads it: the fold's score still comes from the test walk.
        It returns the summary it puts in the fold's record.
        """
        rows = spec.validation_index
        if rows.size == 0:
            return None
        simulator = Simulator(
            self.cost,
            contracts=self.settings.contracts,
            holding_bars=self.settings.resolved_holding_bars,
            stop_loss_ticks=self.settings.stop_loss_ticks,
            take_profit_ticks=self.settings.take_profit_ticks,
            long_only=self.settings.long_only,
        )
        accumulator = FoldAccumulator(fold_index=spec.fold_index)
        self.emit_context_until(int(rows[0]), spec.fold_index)
        self._walk_span(spec, adapter, price_adapter, WalkSpan(
            label="replay", phase="replaying", wire_name="replay", rows=rows, fold_index=spec.fold_index,
            simulator=simulator, accumulator=accumulator, writes_run_state=False,
        ))
        metrics, _, _ = scoreboard(accumulator.inputs, self.periods_per_year)
        return {
            "barsWalked": int(accumulator.bars_evaluated),
            "barsScored": int(len(accumulator.inputs.scored_actual_up)),
            "tradeCount": int(len(simulator.closed_trades)),
            "netProfitUsd": metrics["net_profit_usd"],
            "winRate": metrics["win_rate"],
            "accuracy": metrics["accuracy"],
            "sharpeRatio": metrics["sharpe_ratio"],
            "totalCostUsd": float(accumulator.inputs.total_cost_usd),
        }

    def _walk_span(self, spec: FoldSpec, adapter: ModelAdapter, price_adapter: ModelAdapter | None,
                   span: WalkSpan) -> None:
        s = self.settings
        d = self.data
        k = span.fold_index
        prefix = self.fold_prefix(k)
        simulator = span.simulator
        simulator.begin_fold(k)
        accumulator = span.accumulator
        rows = span.rows
        equity = 0.0 if not span.writes_run_state else self.equity
        count = rows.size
        valid = history_valid(self.features, int(adapter.minimum_history()))
        span_start, span_end = int(d.timestamps[rows[0]]), int(d.timestamps[rows[-1]])
        self.set_phase(span.phase, fold_index=k, span_start=span_start, span_end=span_end, bar_count=count, bar_index=0)
        self.log(f"{prefix}[{span.label}] walking {count:,} bars one at a time {format_time(span_start)}..{format_time(span_end)}")
        # every processed frame this span flushes says which walk it came from, so a
        # consumer can tell the scored out-of-sample bars from the validation replay's
        self._span = span.wire_name
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
        # a model with its own trade gate (regime_montecarlo_decision): every bar's call is still
        # scored, but the engine enters only where the gate is open and stands aside (signal 0) elsewhere
        trade_gate = getattr(adapter, "trade_gate", None)
        trade_gate = trade_gate if callable(trade_gate) else None
        # a model that speaks per bar for its regimes streams them during the test walk
        regime_forecast = getattr(adapter, "regime_forecast", None)
        regime_forecast = regime_forecast if callable(regime_forecast) and span.writes_run_state else None
        self._regime_adapter = adapter if regime_forecast is not None else None
        self._regime_fold = k
        self._regime_rows = []

        for j in range(count):
            self.checkpoint()
            self._pace()
            i = int(rows[j])
            if self.next_unemitted < i:
                # A walk over a non-contiguous span (the validation replay keeps only the
                # rows with a label and feature history, so it steps over the purged and the
                # gap-crossing bars) leaves rows between two walked bars. The chart is fed
                # every bar exactly once in time order, so those rows are context: the walk's
                # own bars are still the scored ones, and the frame is flushed first so the
                # context cannot overtake the bars already walked.
                self._flush_frame()
                self.emit_context_until(i, k)
            probability: float | None = None
            if valid[i]:
                value = float(adapter.predict_probability(self.features, np.array([i], dtype=np.int64))[0])
                if math.isfinite(value):
                    # one definition downstream: P(up). A reversal model's P(turn) is converted
                    # here (`probability_up`), so the signal, the gate, every probability metric,
                    # the calibration table and the chart all read the same quantity.
                    probability = self.probability_up(min(1.0, max(0.0, value)), i)
                elif not warned_non_finite:
                    warned_non_finite = True
                    self.log(f"{prefix}[{span.label}] the model returned a non-finite probability at {format_time(d.timestamps[i])}; such bars are not traded", "warn")
            # every prediction is traded: long at P(up) >= 0.5, short below (flat
            # below when long only — the simulator maps it). A reversal model has no call
            # (None) on a bar whose trailing move is inside the threshold: nothing to turn against.
            if probability is None:
                direction, signal = 0, None
            else:
                direction = signal = 1 if probability >= 0.5 else -1
                # the model's own gate applies whichever label kind it predicts
                # (|P(turn) - 0.5| = |P(up) - 0.5|, so the gate is the same either way)
                if trade_gate is not None and not bool(trade_gate(self.features, np.array([i], dtype=np.int64))[0]):
                    signal = 0
            # the regime forecast is recorded for every bar the model scored, call or no call: the
            # regime, the simulated fan and Kronos' candles do not depend on whether the bar is traded
            if regime_forecast is not None and valid[i]:
                said = regime_forecast(i)
                if said is not None:
                    row = {**said, "timestamp": int(d.timestamps[i])}
                    if self.reversal and "decision_probability_up" in row:
                        # the decision model spoke in P(turn); the panel is told P(up) like everything else
                        row["decision_probability_up"] = probability
                    if probability is None:
                        # no call on this bar (a reversal bar with no trailing move to turn against, or a
                        # non-finite answer): nothing can be entered on it, so its gate reads closed
                        row["decision_probability_up"] = None
                        row["claimed_gain_points"] = None
                        row["expected_gain_points"] = None
                        row["gate_open"] = False
                    self._regime_rows.append(row)
            # the price model: its output times the causal scale at this bar, in points
            predicted_move: float | None = None
            scale = float(self.move_scale[i])
            crosses_gap = bool(self.crosses_gap[i])
            if price_valid is not None and price_valid[i] and math.isfinite(scale) and not crosses_gap:
                output = float(price_adapter.predict_value(self.features, np.array([i], dtype=np.int64))[0])
                if math.isfinite(output):
                    predicted_move = output * scale
                elif not warned_price:
                    warned_price = True
                    self.log(f"{prefix}[{span.label}] the price model returned a non-finite value at {format_time(d.timestamps[i])}; "
                             "such bars draw no forecast", "warn")
            predicted_close = None
            predicted_move_raw = predicted_move          # the model's own number: output x scale, unrounded
            if predicted_move is not None:
                # the forecast is a price the market can print: the nearest tick, and the move follows it,
                # so the chart, the metrics and the record carry one number
                predicted_close = round_to_tick(float(d.close[i]) + predicted_move, self.cost.tick_size)
                predicted_move = predicted_close - float(d.close[i])
            forecast_timestamp = None if crosses_gap or i + self.horizon >= bar_count else int(d.timestamps[i + self.horizon])
            predicted_move_for_row[i] = predicted_move
            last = j == count - 1
            result = simulator.step(i, int(d.timestamps[i]), d.open[i], d.high[i], d.low[i], d.close[i], signal, probability, decide=not last)
            net = result.net_usd
            position = result.position
            if last:
                net += simulator.flatten(i, int(d.timestamps[i]), float(d.close[i]), "fold_end")
                position = 0
            equity += net
            if span.writes_run_state:
                self.equity = equity
                self.last_processed_row = i
            accumulator.bars_evaluated += 1
            accumulator.inputs.bar_net_usd.append(net)
            accumulator.inputs.bar_exposed.append(result.exposed)
            if accumulator.first_open is None:
                accumulator.first_open = float(d.open[i])
            accumulator.last_close = float(d.close[i])
            predicted_class_for_row[i] = direction
            probability_for_row[i] = probability
            if span.writes_run_state:
                self.prediction_rows[i] = {
                    "timestamp": int(d.timestamps[i]), "fold_index": k,
                    "open": float(d.open[i]), "high": float(d.high[i]), "low": float(d.low[i]),
                    "close": float(d.close[i]), "volume": float(d.volume[i]),
                    "probability_up": probability, "predicted_direction": direction,
                    # `target_position` is the position wanted at the next open; `position_held` was carried through this bar
                    "target_position": int(position), "position_held": int(result.held),
                    "bar_net_profit_usd": float(net), "exposed": bool(result.exposed), "crosses_gap": crosses_gap,
                    "equity_usd": equity, "actual_direction": None, "correct": None,
                    "predicted_move_points": predicted_move, "predicted_move_raw_points": predicted_move_raw,
                    "predicted_close": predicted_close,
                    "forecast_timestamp": forecast_timestamp, "forecast_error_points": None,
                }
            frame = self._frame_for(k)
            for key, value in (("timestamps", int(d.timestamps[i])), ("open", d.open[i]), ("high", d.high[i]), ("low", d.low[i]),
                               ("close", d.close[i]), ("volume", d.volume[i]), ("probabilityUp", probability),
                               ("predictedDirection", direction), ("position", position), ("positionHeld", int(result.held)),
                               ("equityUsd", equity), ("predictedClose", predicted_close), ("forecastTimestamp", forecast_timestamp)):
                frame[key].append(value)

            # A label or a forecast made at row r resolves at row r + horizon. Keyed on
            # the row itself rather than on the walk's position, because a walk over a
            # non-contiguous span (the validation replay skips the purged and the
            # gap-crossing bars) can reach a target row whose source was never walked —
            # and then that label, or that forecast, does not resolve inside this walk.
            resolved_row = i - self.horizon
            if resolved_row in predicted_class_for_row:
                # a bar whose horizon crossed a session gap is not scored (actual 0 = unscored)
                actual = 0 if self.crosses_gap[resolved_row] else actual_direction(
                    d.close, resolved_row, self.horizon, s.label_threshold_ticks, self.cost.tick_size)
                predicted = predicted_class_for_row[resolved_row]
                correct = None if actual == 0 or predicted == 0 else predicted == actual
                frame["resolvedTimestamps"].append(int(d.timestamps[resolved_row]))
                frame["resolvedActual"].append(actual)
                frame["resolvedCorrect"].append(correct)
                record = self.prediction_rows.get(resolved_row)
                if record is not None:
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
                    f"{prefix}[{span.label}] {format_time(d.timestamps[i])} bar {j + 1}/{count} close={d.close[i]:.2f} "
                    f"p_up={_format_number(probability, '.3f')} signal={SIDE_WORDS[signal] if signal is not None else 'NONE'} "
                    f"position={SIDE_WORDS[position]} equity={format_usd(equity)} "
                    f"forecast={self._forecast_words(predicted_close, forecast_timestamp)}"
                )
                self._post_frame.append(lambda line=line: self.log(line))
            self._cursor.update(bar_timestamp=int(d.timestamps[i]), bar_index=j, bar_count=count, phase_fraction=(j + 1) / count)
            self.fold_progress(k, test_fraction=(j + 1) / count, replay=not span.writes_run_state)
            if last or (0 < pace <= 20) or now - self._last_flush >= FRAME_INTERVAL_SECONDS:
                self._flush_frame()
            if not last and now - last_board >= SCOREBOARD_INTERVAL_SECONDS:
                last_board = now
                self._emit_running_scoreboard(k)
        accumulator.inputs.trade_nets = [t.net_profit_usd for t in simulator.closed_trades if t.fold_index == k and t.net_profit_usd is not None]
        accumulator.inputs.total_cost_usd = sum(t.cost_usd or 0.0 for t in simulator.closed_trades if t.fold_index == k)
        accumulator.inputs.buy_and_hold_usd = self._fold_buy_and_hold(accumulator)
        walked = self.clock() - walk_started
        if span.writes_run_state:
            self.test_bars += count
            self._emit_running_scoreboard(k)
        if walked > 0:
            self.log(f"{prefix}[{span.label}] {count / walked:,.1f} bars/s over {count:,} bars", "debug")

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
                "span": self._span,
                **{key: [] for key in ("timestamps", "open", "high", "low", "close", "volume", "probabilityUp",
                                       "predictedDirection", "position", "positionHeld", "equityUsd", "predictedClose",
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
                forecast_timestamp=frame["forecastTimestamp"], position_held=frame["positionHeld"],
                span=frame["span"],
            )
            self._record_bars("processed", frame["foldIndex"], frame["timestamps"], frame["open"], frame["high"],
                              frame["low"], frame["close"], frame["volume"], span=frame["span"])
            self._flush_regime_forecasts()
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
            "probability_up": None, "predicted_direction": 0, "target_position": 0, "position_held": int(result.held),
            "bar_net_profit_usd": float(result.net_usd), "exposed": bool(result.exposed),
            "crosses_gap": bool(self.crosses_gap[following]),
            "equity_usd": self.equity, "actual_direction": None, "correct": None,
            "predicted_move_points": None, "predicted_move_raw_points": None, "predicted_close": None,
            "forecast_timestamp": None, "forecast_error_points": None,
        }
        frame = self._frame_for(k)
        for key, value in (("timestamps", int(d.timestamps[following])), ("open", d.open[following]),
                           ("high", d.high[following]), ("low", d.low[following]), ("close", d.close[following]),
                           ("volume", d.volume[following]), ("probabilityUp", None), ("predictedDirection", 0),
                           ("position", 0), ("positionHeld", int(result.held)), ("equityUsd", self.equity),
                           ("predictedClose", None), ("forecastTimestamp", None)):
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
                if record is not None:
                    record["target_position"] = 0
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
        # a tuning trial's fit is one of many candidates: no surface for it
        self.loss_surface_resolution = 0 if self.tuning else max(0, int(engine.settings.loss_surface_resolution))

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
            words = {"boosting_round": "boosting round", "tree_batch": "trees", "solver_pass": "solver pass", "single_fit": "fit"}[unit]
            head = f"{words} {report.epoch}/{report.epoch_count} step {report.batch}/{report.batch_count}"
        block = f"block={format_time(span[0])}..{format_time(span[1])}"
        tail = " (every round sees the whole training window)" if whole and unit != "epoch" else ""
        self.engine.log(f"{self.prefix}[train] {self.role_words}{head} {' '.join(parts)} {block}{tail}",
                        "debug" if self.tuning else "info")

    def loss_surface(self, surface: dict) -> None:
        """A neural adapter's loss surface around its kept weights: emitted
        live, kept for the record and written beside the fold's artifacts."""
        engine = self.engine
        payload = protocol.cycle_loss_surface_payload(fold_index=self.fold_index, model_role=self.model_role, surface=surface)
        protocol.emit_cycle_loss_surface(fold_index=self.fold_index, model_role=self.model_role, surface=surface)
        engine.loss_surfaces.append(payload)
        engine.write_loss_surfaces()
        d = payload["diagnostics"]
        engine.log(
            f"{self.prefix}[surface] {self.role_words}loss surface {payload['resolution']}x{payload['resolution']} around the kept "
            f"weights in {payload['secondsElapsed']:.1f} s: sharpness={_format_number(d['sharpness'], '.4f')} "
            f"condition_number={_format_number(d['conditionNumber'], '.1f')} valley_width={_format_number(d['valleyWidth'], '.3f')} "
            f"{'locally convex' if d['locallyConvex'] else 'not convex here (a saddle or a ridge)'}"
        )

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
        word = {"epoch": "epoch", "boosting_round": "round", "tree_batch": "trees", "solver_pass": "pass", "single_fit": "fit"}[unit]
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
                    engine.emit_metric(name, value, iteration=engine.price_global_step)
        elif not self.tuning:
            engine.global_step += 1
            if report.train_loss is not None and math.isfinite(report.train_loss):
                engine.emit_metric("train_loss", report.train_loss, iteration=engine.global_step)
            if report.validation_loss is not None and math.isfinite(report.validation_loss):
                engine.emit_metric("validation_loss", report.validation_loss, iteration=engine.global_step)
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
