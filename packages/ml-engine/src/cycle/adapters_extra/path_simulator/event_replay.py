"""Event-driven simulation: a typed event queue replays rule strategies over the
training span, and the best strategy's signal is the model.

The engine is the classic event-driven backtester, one heap-ordered queue:

    MarketEvent(bar)  -> the portfolio marks its position at the bar's close;
                         the strategy reads its signal (closes <= bar) and,
                         when its target position changes, queues a
    SignalEvent       -> the portfolio turns the change into an
    OrderEvent        -> the execution handler fills it at the NEXT bar's open,
                         adverse by ``slippage_ticks``, charging half the cost
                         model's round trip per contract: a
    FillEvent         -> the portfolio updates cash and position.

Candidates (a fixed grid, so the required history never moves): momentum
(fast minus slow moving average), mean reversion (minus the distance from a
moving average) and their blend, each with an entry threshold; a candidate
goes long above +threshold, short below -threshold, flat between. Every
candidate is replayed over the last ``maximum_training_bars`` training bars;
the one with the best net Sharpe ratio (after slippage and costs) is kept.

At bar t the kept strategy's signal strength (in move-scale units, closes <=
t) is the raw score; the validation curve maps it to P(up). The price forecast
is the training span's least-squares line from the signal to the price target.
"""

from __future__ import annotations

import heapq
import itertools
from dataclasses import dataclass

import numpy as np

from .common import Simulated, Simulator, rows_of, usable_training_rows, windows

MOMENTUM_PAIRS = ((3, 20), (5, 40), (10, 80), (20, 120))
REVERSION_WINDOWS = (10, 20, 40, 80)
THRESHOLDS = (0.0, 0.25, 0.5, 1.0)
LONGEST_LOOKBACK = max(max(slow for _, slow in MOMENTUM_PAIRS), max(REVERSION_WINDOWS))

# priorities inside one bar: a fill (at the open) before the bar's market event, then signals, then orders
FILL, MARKET, SIGNAL, ORDER = 0, 1, 2, 3


@dataclass(frozen=True)
class Rule:
    kind: str                  # momentum | reversion | blend
    fast: int
    slow: int
    window: int
    threshold: float

    def describe(self) -> str:
        parts = {"momentum": f"momentum {self.fast}/{self.slow}", "reversion": f"reversion {self.window}",
                 "blend": f"blend momentum {self.fast}/{self.slow} + reversion {self.window}"}[self.kind]
        return f"{parts}, threshold {self.threshold}"

    def to_dict(self) -> dict:
        return {"kind": self.kind, "fast": self.fast, "slow": self.slow, "window": self.window, "threshold": self.threshold}


def candidate_rules() -> list[Rule]:
    rules = []
    for threshold in THRESHOLDS:
        rules += [Rule("momentum", fast, slow, 0, threshold) for fast, slow in MOMENTUM_PAIRS]
        rules += [Rule("reversion", 0, 0, window, threshold) for window in REVERSION_WINDOWS]
        rules += [Rule("blend", fast, slow, window, threshold) for fast, slow in MOMENTUM_PAIRS for window in REVERSION_WINDOWS]
    return rules


def rule_signal(rule: Rule, view, rows: np.ndarray) -> np.ndarray:
    """The rule's signed strength at each row, from closes <= row (move-scale units)."""
    rows = rows_of(rows)
    close = windows(view.close, rows, LONGEST_LOOKBACK)
    scale = np.asarray(view.move_scale, dtype=np.float64)[rows]
    last = close[:, -1]
    momentum = reversion = 0.0
    if rule.kind in ("momentum", "blend"):
        momentum = (close[:, -rule.fast:].mean(axis=1) - close[:, -rule.slow:].mean(axis=1)) / scale
    if rule.kind in ("reversion", "blend"):
        reversion = -(last - close[:, -rule.window:].mean(axis=1)) / scale
    if rule.kind == "blend":
        return 0.5 * (momentum + reversion)
    return momentum if rule.kind == "momentum" else reversion


# ─── the event engine ───────────────────────────────────────────────────────


@dataclass(frozen=True)
class MarketEvent:
    bar: int


@dataclass(frozen=True)
class SignalEvent:
    bar: int
    target: int
    strength: float


@dataclass(frozen=True)
class OrderEvent:
    bar: int
    quantity: int


@dataclass(frozen=True)
class FillEvent:
    bar: int
    price: float
    quantity: int
    commission: float


class Replay:
    """One strategy replayed through the queue; ``run`` returns the per-bar net P&L (points)."""

    def __init__(self, rule: Rule, signal: np.ndarray, rows: np.ndarray, view, slippage_points: float,
                 commission_points: float) -> None:
        self.rule = rule
        self.signal = dict(zip(rows.tolist(), signal.tolist()))
        self.rows = rows
        self.last_row = int(rows[-1])
        self.open = view.open
        self.close = view.close
        self.slippage = slippage_points
        self.commission = commission_points
        self.queue: list = []
        self.sequence = itertools.count()
        self.position = 0
        self.pending = 0
        self.target = 0
        self.cash = 0.0
        self.trades = 0

    def push(self, bar: int, priority: int, event) -> None:
        heapq.heappush(self.queue, (bar, priority, next(self.sequence), event))

    def run(self) -> np.ndarray:
        for row in self.rows.tolist():
            self.push(row, MARKET, MarketEvent(row))
        equity = []
        while self.queue:
            _, _, _, event = heapq.heappop(self.queue)
            if isinstance(event, MarketEvent):
                equity.append(self.cash + self.position * float(self.close[event.bar]))
                self.on_market(event)
            elif isinstance(event, SignalEvent):
                self.on_signal(event)
            elif isinstance(event, OrderEvent):
                self.on_order(event)
            else:
                self.on_fill(event)
        return np.diff(np.asarray(equity))

    def on_market(self, event: MarketEvent) -> None:
        if event.bar >= self.last_row:
            return                                   # no new orders on the last bar: its fill would land outside
        strength = self.signal[event.bar]
        desired = 1 if strength > self.rule.threshold else (-1 if strength < -self.rule.threshold else 0)
        if desired != self.target:
            self.target = desired
            self.push(event.bar, SIGNAL, SignalEvent(event.bar, desired, strength))

    def on_signal(self, event: SignalEvent) -> None:
        quantity = event.target - (self.position + self.pending)
        if quantity:
            self.pending += quantity
            self.push(event.bar, ORDER, OrderEvent(event.bar, quantity))

    def on_order(self, event: OrderEvent) -> None:
        bar = event.bar + 1
        price = float(self.open[bar]) + self.slippage * np.sign(event.quantity)
        self.push(bar, FILL, FillEvent(bar, price, event.quantity, abs(event.quantity) * self.commission))

    def on_fill(self, event: FillEvent) -> None:
        self.cash -= event.quantity * event.price + event.commission
        self.position += event.quantity
        self.pending -= event.quantity
        self.trades += 1


def sharpe(pnl: np.ndarray) -> float:
    if pnl.size < 2:
        return float("-inf")
    deviation = float(np.std(pnl))
    return float(np.mean(pnl) / deviation * np.sqrt(pnl.size)) if deviation > 0 else float("-inf")


class EventReplay(Simulator):
    variant = "event_replay"
    step_unit = "single_fit"

    @classmethod
    def minimum_history(cls, parameters: dict) -> int:
        return LONGEST_LOOKBACK + 1

    def prepare(self, context) -> None:
        """The candidate grid is fixed (``candidate_rules``)."""

    def train_epoch(self, epoch, report_batch, context) -> float | None:
        p = self.parameters
        view, features = context.view, context.features
        if view.open is None:
            raise RuntimeError("event_replay: the replay fills at the next bar's open; the view has no opens")
        # the replay walks every bar of the span (contiguous); the price line uses the bars with a known target
        rows = view.fit_rows(context.train_index)
        rows = rows[rows >= LONGEST_LOOKBACK - 1]
        rows = rows[np.isfinite(np.asarray(view.move_scale, dtype=np.float64)[rows])]
        rows = rows[-int(p["maximum_training_bars"]):]
        if rows.size < 50:
            raise ValueError(f"event_replay: only {rows.size} usable training bars with {LONGEST_LOOKBACK} bars of history")
        slippage = float(p["slippage_ticks"]) * float(view.tick_size)
        commission = float(view.round_trip_cost_points) / 2.0
        rules = candidate_rules()
        results = []
        for number, rule in enumerate(rules):
            if number and number % 24 == 0:
                context.reporter.checkpoint()
            replay = Replay(rule, rule_signal(rule, view, rows), rows, view, slippage, commission)
            pnl = replay.run()
            results.append((sharpe(pnl), float(pnl.sum()), replay.trades, rule))
        best = max(range(len(results)), key=lambda i: (results[i][0], -i))
        self.best_sharpe, self.best_net_points, self.best_trades, self.rule = results[best]
        labelled = usable_training_rows(view, features, context.train_index, int(p["maximum_training_bars"]))
        labelled = labelled[labelled >= LONGEST_LOOKBACK - 1]
        signal = rule_signal(self.rule, view, labelled)
        targets = np.asarray(view.price_targets, dtype=np.float64)[labelled]
        design = np.column_stack([np.ones(labelled.size), signal])
        (self.intercept, self.slope), *_ = np.linalg.lstsq(design, targets, rcond=None)
        self.intercept, self.slope = float(self.intercept), float(self.slope)
        self.candidate_count = len(rules)
        report_batch(1, 1, int(rows[0]), int(rows[-1]), -self.best_sharpe)
        context.reporter.log(f"event_replay: {len(rules)} strategies replayed over {rows.size} bars; kept "
                             f"{self.rule.describe()} (net Sharpe {self.best_sharpe:.2f}, net {self.best_net_points:.1f} "
                             f"points, {self.best_trades} fills)")
        return -self.best_sharpe

    def simulate(self, features, view, rows) -> Simulated:
        rows = rows_of(rows)
        signal = rule_signal(self.rule, view, rows) if rows.size else np.empty(0)
        signal = np.where(np.isfinite(signal), signal, np.nan)
        return Simulated(signal, self.intercept + self.slope * signal, np.full(rows.size, np.nan))

    def state(self) -> tuple[dict, dict]:
        return {"line": np.array([self.intercept, self.slope])}, {
            "rule": self.rule.to_dict(), "best_sharpe": self.best_sharpe, "best_net_points": self.best_net_points,
            "best_trades": int(self.best_trades), "candidate_count": int(self.candidate_count)}

    def restore(self, arrays, document) -> None:
        self.intercept, self.slope = (float(value) for value in arrays["line"])
        self.rule = Rule(**document["rule"])
        self.best_sharpe = float(document["best_sharpe"])
        self.best_net_points = float(document["best_net_points"])
        self.best_trades = int(document["best_trades"])
        self.candidate_count = int(document["candidate_count"])

    def summary(self) -> dict:
        return {"rule": self.rule.describe(), "net_sharpe": self.best_sharpe, "net_points": self.best_net_points,
                "fills": int(self.best_trades), "candidates": int(self.candidate_count)}
