"""The run's market, as a bridge model may read it: ``MarketView``.

Most Model Cycle adapters read only the causal feature matrix and the labels
the engine hands to ``fit``. The bridge families (reinforcement-learning
agents trading a price tape, series models reading the bar-return series,
survival models timing barrier touches, solvers weighting signals by their
information coefficient, ...) need more of the market: closes, the price
target, the volatility scale, costs. The engine builds ONE ``MarketView`` per
run and hands it to every adapter it constructs that defines
``bind_market(view)`` (``CycleEngine.build_adapter``); the explainer builds one
from the run's saved arrays and binds it to a reloaded model
(``cycle.explain.common.build_context``). Adapters without ``bind_market`` never
see it, so every model that predates it runs bit for bit as before.

Read rules (the contract every bridge is tested against, see
``tests/cycle_bridge_harness.py``):

- **Prediction at bar t** may read only ``timestamps``, ``close``,
  ``raw_features``, ``feature_names``, ``move_scale`` and ``one_bar_returns()``
  at rows <= t, the constants (``horizon``, ``tick_size``,
  ``round_trip_cost_points``), and targets or labels that are already realised:
  rows r <= ``realised_until(t)`` = t - horizon. The price target and the label
  of row r are ``close[r + horizon] - close[r]`` in disguise, so reading them at
  a row after ``realised_until(t)`` is reading the future.
- ``open``, ``high`` and ``low`` are **fit-only** (a reward tape's next-open fill
  and intrabar excursions over the training span). They are ``None`` in the
  explainer's view, so a model that reads them at predict time fails loudly
  there instead of quietly differing from the run. ``volume`` (the bars' traded
  volume) is the same: the engine's view carries it, the explainer's does not.
  One model reads open, high, low and volume at rows <= t at predict time —
  ``regime_montecarlo_decision`` (Kronos reads whole candles, its regime model
  reads volume) — which is causal, and which is why that model refuses to be
  reloaded by the explainer rather than predicting from a different input.
- **Fitting** may read targets and labels only for rows of
  ``fit_rows(train_index)`` — the span from the first to the last training row.
  Every such row resolves at r + horizon <= train_index[-1] + horizon, which the
  engine's purge keeps strictly before validation starts. Validation rows are
  read only through the ``validation_index`` the engine passes (early stopping,
  calibration), never as training targets.
- Nothing in a view is written: the arrays are shared with the engine, and the
  view holds them read-only (an in-place edit raises ``ValueError``); copy first.

``truncated(end)`` is the view a run that stopped at bar ``end - 1`` would
have built: every array cut at ``end``, and the targets and labels whose
horizon ends past the cut unrealised (NaN). The predict truncation test compares
a model's prediction at t under the full view and under ``truncated(t + 1)``.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Any

import numpy as np

from cycle.labels import horizon_crosses_gap

# The fields a bridge may read at predict time; everything else is fit-only
# or target data behind realised_until (see the module docstring).
PREDICT_FIELDS = ("timestamps", "close", "raw_features", "feature_names", "move_scale",
                  "horizon", "tick_size", "round_trip_cost_points")
FIT_ONLY_FIELDS = ("open", "high", "low", "volume")
TARGET_FIELDS = ("price_targets", "labels")
# every array field; each is stored read-only (see MarketView.__post_init__)
ARRAY_FIELDS = ("timestamps", "close", "open", "high", "low", "raw_features", "price_targets", "move_scale", "labels",
                "crosses_gap", "one_bar_crosses_gap", "volume")


@dataclass(frozen=True, eq=False)
class MarketView:
    """One run's bars, targets and costs, row-aligned with the feature matrix.

    ``timestamps`` int64 epoch seconds; ``close`` / ``open`` / ``high`` / ``low``
    float64 points (back-adjusted for a stitched futures root, as the engine
    trades them); ``raw_features`` float32 (n, F) in the features' own units
    before the z-score (None when the run has none); ``feature_names`` the
    matrix's column names; ``horizon`` the label horizon h in bars;
    ``price_targets`` float32, the h-bar move divided by ``move_scale`` (NaN
    where unknown or crossing a session gap); ``move_scale`` float64 points, a
    trailing statistic (closes <= t); ``labels`` float32 1 up / 0 down / NaN;
    ``crosses_gap`` bool, the h-bar horizon of the row spans a session gap;
    ``one_bar_crosses_gap`` bool, the gap after the row (to row + 1) is a
    session gap; ``tick_size`` points; ``round_trip_cost_points`` the cost of
    one round trip of one contract in points (USD cost / point value);
    ``volume`` float64 traded volume per bar (None in the explainer's view)."""

    timestamps: np.ndarray
    close: np.ndarray
    open: np.ndarray | None
    high: np.ndarray | None
    low: np.ndarray | None
    raw_features: np.ndarray | None
    feature_names: tuple[str, ...]
    horizon: int
    price_targets: np.ndarray
    move_scale: np.ndarray
    labels: np.ndarray
    crosses_gap: np.ndarray
    one_bar_crosses_gap: np.ndarray
    tick_size: float
    round_trip_cost_points: float
    volume: np.ndarray | None = None

    def __post_init__(self) -> None:
        count = int(np.asarray(self.timestamps).shape[0])
        for name in ("close", "open", "high", "low", "raw_features", "price_targets", "move_scale", "labels",
                     "crosses_gap", "one_bar_crosses_gap", "volume"):
            values = getattr(self, name)
            if values is not None and int(np.asarray(values).shape[0]) != count:
                raise ValueError(f"MarketView: {name} has {np.asarray(values).shape[0]} rows, timestamps {count}")
        if int(self.horizon) < 1:
            raise ValueError(f"MarketView: horizon must be >= 1 bar, got {self.horizon}")
        # Every array is handed out read-only: the view shares the engine's own arrays (the labels and
        # price target the engine scores the test span with), so an in-place edit by a model would
        # silently change the run. A read-only numpy VIEW is used, so the engine's arrays stay writable.
        for name in ARRAY_FIELDS:
            values = getattr(self, name)
            if values is None or (isinstance(values, np.ndarray) and not values.flags.writeable):
                continue
            locked = np.asarray(values).view()
            locked.flags.writeable = False
            object.__setattr__(self, name, locked)

    def __len__(self) -> int:
        return int(self.timestamps.shape[0])

    # ── the causal accessors ──
    def realised_until(self, row: int) -> int:
        """The largest row r whose target and label are known at bar ``row``:
        r + horizon <= row, so r = row - horizon (-1 when none is). A row whose
        horizon crossed a session gap still counts by bars (its target is NaN,
        never a different number)."""
        return int(row) - int(self.horizon)

    def realised_rows(self, row: int, start: int = 0) -> np.ndarray:
        """Rows ``start..realised_until(row)`` whose price target is known (int64)."""
        stop = self.realised_until(row)
        if stop < start:
            return np.empty(0, dtype=np.int64)
        rows = np.arange(max(0, int(start)), stop + 1, dtype=np.int64)
        return rows[np.isfinite(self.price_targets[rows])]

    def fit_rows(self, train_index: np.ndarray) -> np.ndarray:
        """Every row of the training span, ``train_index[0]..train_index[-1]``
        (int64, contiguous), labelled or not. Their targets resolve by
        ``train_index[-1] + horizon``, which the engine's purge keeps before the
        first validation row; a caller still filters NaN targets itself."""
        index = np.asarray(train_index, dtype=np.int64).reshape(-1)
        if index.size == 0:
            return np.empty(0, dtype=np.int64)
        return np.arange(int(index[0]), int(index[-1]) + 1, dtype=np.int64)

    def one_bar_returns(self) -> np.ndarray:
        """float64 log return of each bar's close over the previous close,
        known at that bar; NaN at row 0, where either close is not positive, and
        where the step from row t-1 to t is a session gap."""
        close = np.asarray(self.close, dtype=np.float64)
        out = np.full(close.shape[0], np.nan, dtype=np.float64)
        if close.shape[0] < 2:
            return out
        previous, current = close[:-1], close[1:]
        usable = (previous > 0) & (current > 0) & np.isfinite(previous) & np.isfinite(current)
        with np.errstate(invalid="ignore", divide="ignore"):
            steps = np.log(np.where(usable, current, 1.0) / np.where(usable, previous, 1.0))
        steps[~usable] = np.nan
        steps[np.asarray(self.one_bar_crosses_gap[:-1], dtype=bool)] = np.nan
        out[1:] = steps
        return out

    def feature_column(self, name: str) -> np.ndarray | None:
        """The raw column called ``name`` (float64), or None when the run does not carry it."""
        if self.raw_features is None or name not in self.feature_names:
            return None
        return np.asarray(self.raw_features[:, self.feature_names.index(name)], dtype=np.float64)

    def truncated(self, end: int) -> MarketView:
        """The view as a run whose data stopped at bar ``end - 1`` would build
        it: arrays cut at ``end``; targets, labels and gap flags of the rows whose
        horizon ends at or past the cut are unknown (NaN / False), as
        ``cycle.labels`` computes them on the shorter series."""
        end = int(end)
        if not 0 < end <= len(self):
            raise ValueError(f"truncated: end must be in 1..{len(self)}, got {end}")

        def cut(values):
            return None if values is None else np.asarray(values)[:end].copy()

        price_targets = cut(self.price_targets)
        labels = cut(self.labels)
        crosses = cut(self.crosses_gap)
        one_bar = cut(self.one_bar_crosses_gap)
        unknown_from = max(0, end - int(self.horizon))
        price_targets[unknown_from:] = np.nan
        labels[unknown_from:] = np.nan
        crosses[unknown_from:] = False
        one_bar[max(0, end - 1):] = False
        return replace(self, timestamps=cut(self.timestamps), close=cut(self.close), open=cut(self.open),
                       high=cut(self.high), low=cut(self.low), raw_features=cut(self.raw_features),
                       price_targets=price_targets, move_scale=cut(self.move_scale), labels=labels,
                       crosses_gap=crosses, one_bar_crosses_gap=one_bar, volume=cut(self.volume))

    def without_intrabar(self) -> MarketView:
        """The same view with ``open``, ``high``, ``low`` and ``volume`` removed (what the explainer has)."""
        return replace(self, open=None, high=None, low=None, volume=None)

    # ── builders ──
    @classmethod
    def from_arrays(cls, *, timestamps, close, horizon: int, price_targets, move_scale, labels,
                    open=None, high=None, low=None, raw_features=None, feature_names=(),  # noqa: A002 - the bar's open
                    crosses_gap=None, gap_multiple: float = 0.0, tick_size: float = 0.25,
                    round_trip_cost_points: float = 0.0, volume=None) -> MarketView:
        """A view from plain arrays; the gap flags are recomputed from the
        timestamps with ``gap_multiple`` unless ``crosses_gap`` is given."""
        timestamps = np.asarray(timestamps, dtype=np.int64)
        horizon = int(horizon)
        if crosses_gap is None:
            crosses_gap = horizon_crosses_gap(timestamps, horizon, float(gap_multiple))
        one_bar = horizon_crosses_gap(timestamps, 1, float(gap_multiple))
        return cls(
            timestamps=timestamps,
            close=np.asarray(close, dtype=np.float64),
            open=None if open is None else np.asarray(open, dtype=np.float64),
            high=None if high is None else np.asarray(high, dtype=np.float64),
            low=None if low is None else np.asarray(low, dtype=np.float64),
            raw_features=None if raw_features is None else np.asarray(raw_features, dtype=np.float32),
            feature_names=tuple(str(name) for name in feature_names),
            horizon=horizon,
            price_targets=np.asarray(price_targets, dtype=np.float32),
            move_scale=np.asarray(move_scale, dtype=np.float64),
            labels=np.asarray(labels, dtype=np.float32),
            crosses_gap=np.asarray(crosses_gap, dtype=bool),
            one_bar_crosses_gap=np.asarray(one_bar, dtype=bool),
            tick_size=float(tick_size),
            round_trip_cost_points=float(round_trip_cost_points),
            volume=None if volume is None else np.asarray(volume, dtype=np.float64),
        )

    @classmethod
    def from_engine(cls, engine: Any) -> MarketView:
        """The view of a ``CycleEngine``'s run: its bars, raw features, price
        target, move scale, labels, gap flags and cost model (one contract)."""
        data = engine.data
        cost = engine.cost
        feature_set = engine.feature_set
        return cls.from_arrays(
            timestamps=data.timestamps, close=data.close, open=data.open, high=data.high, low=data.low,
            volume=getattr(data, "volume", None), raw_features=feature_set.raw, feature_names=feature_set.names, horizon=int(engine.horizon),
            price_targets=engine.price_targets, move_scale=engine.move_scale, labels=engine.labels,
            crosses_gap=engine.crosses_gap, gap_multiple=float(engine.settings.label_gap_multiple),
            tick_size=float(cost.tick_size),
            round_trip_cost_points=float(cost.round_trip) / float(cost.point_value) if cost.point_value else 0.0,
        )

    @classmethod
    def from_explain(cls, run: Any, plan: dict | None = None) -> MarketView:
        """The view of a saved run (``cycle.explain.artifacts.RunArrays``) with
        ``plan`` the explain manifest merged with the run's ``config.json`` plan
        when it exists (``labelHorizonBars``, ``labelGapMultiple``,
        ``featureNames``, ``costModel``). It has no open, high or low (the run
        does not save them): a model that reads them at predict time fails here."""
        plan = dict(plan or {})
        manifest = dict(getattr(run, "manifest", {}) or {})
        merged = {**manifest, **plan}
        horizon = int(merged.get("labelHorizonBars") or 1)
        cost = dict(merged.get("costModel") or {})
        tick_size = float(cost.get("tickSize") or 0.0) or float("nan")
        if cost.get("roundTripCostPoints") is not None:
            round_trip_points = float(cost["roundTripCostPoints"])
        elif cost.get("roundTripCostUsd") is not None and cost.get("pointValueUsd"):
            contracts = max(1, int(((merged.get("trading") or {}).get("contracts")) or 1))
            round_trip_points = float(cost["roundTripCostUsd"]) / contracts / float(cost["pointValueUsd"])
        else:
            round_trip_points = float("nan")
        raw = getattr(run, "raw_features", None)
        if raw is not None and not getattr(run, "raw_available", True):
            raw = None
        return cls.from_arrays(
            timestamps=run.timestamps, close=run.close, raw_features=raw,
            feature_names=merged.get("featureNames") or (), horizon=horizon,
            price_targets=run.price_target, move_scale=run.move_scale, labels=run.labels,
            gap_multiple=float(merged.get("labelGapMultiple") or 0.0), tick_size=tick_size,
            round_trip_cost_points=round_trip_points,
        )


def bind_market(adapter: Any, view: MarketView | None) -> Any:
    """Hand ``view`` to ``adapter`` when it defines ``bind_market``; returns the adapter.
    Adapters without the method are returned untouched (bit-identical runs)."""
    bind = getattr(adapter, "bind_market", None)
    if view is not None and callable(bind):
        bind(view)
    return adapter


__all__ = ["ARRAY_FIELDS", "FIT_ONLY_FIELDS", "MarketView", "PREDICT_FIELDS", "TARGET_FIELDS", "bind_market"]
