"""Bar-by-bar trade simulator for the Model Cycle test walk.

Rules (``docs/plans/2026-09-25-model-cycle.md``):

- Costs come from ``packages/config/cost_model.json``; one fill costs
  ``total_per_side * contracts``, so a round trip costs twice that. A symbol with
  no entry (after mapping a contract code such as ``MNQZ5`` to its root) raises.
- The decision is taken at bar i's CLOSE and filled at bar i+1's OPEN — nothing
  trades at a price the model could not have acted on.
- P&L is marked to market every bar: the per-bar net USD series sums, when flat,
  to the sum of the closed trades' net profit.
- Holding period: at expiry the counter resets if the signal still points the
  same way (no exit, no cost), otherwise the position exits (or reverses on an
  opposite signal). An opposite signal before expiry exits and reverses (two fills).
- Stop loss / take profit in ticks from the entry price, checked intrabar on
  high/low; if both are touched in one bar the stop is assumed first; an open
  that gaps through a level fills at the open.
- ``signal=None`` (the model could not predict this bar) takes no decision at
  all: the position and its counter are kept.
"""

from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path
from typing import Callable

from cycle.paths import CONFIG_ROOT

COST_MODEL_PATH = CONFIG_ROOT / "cost_model.json"
_CONTRACT_CODE = re.compile(r"^([A-Z0-9]+?)([FGHJKMNQUVXZ])(\d{1,2})$")


@dataclass(frozen=True)
class CostModel:
    symbol_key: str
    tick_size: float
    tick_value: float
    point_value: float
    cost_per_side: float
    source: str

    @property
    def round_trip(self) -> float:
        return 2.0 * self.cost_per_side


def tick_decimals(tick_size: float) -> int:
    """Decimal places a price on this tick grid needs (0.25 -> 2, 0.1 -> 1, 1.0 -> 0)."""
    exponent = Decimal(str(tick_size)).normalize().as_tuple().exponent
    return max(0, -int(exponent)) if isinstance(exponent, int) else 0


def round_to_tick(price: float, tick_size: float) -> float:
    """The quotable price nearest to ``price``: a whole number of ticks.

    A tie (exactly half a tick) rounds away from zero, the way a printed quote
    would, never to even. The result is rounded to the grid's own decimals so
    ``2000.1`` on a 0.1 grid is ``2000.1`` and not ``2000.1000000000001``.
    """
    if tick_size <= 0:
        raise ValueError(f"tick size must be > 0, got {tick_size}")
    if not math.isfinite(price):
        raise ValueError(f"cannot put a non-finite price on the tick grid: {price!r}")
    ticks = price / tick_size
    whole = math.floor(abs(ticks) + 0.5)
    signed = whole if ticks >= 0 else -whole
    return round(signed * tick_size, tick_decimals(tick_size))


def level_on_tick(price: float, tick_size: float, direction: int) -> float:
    """``price`` moved onto the grid in ``direction`` (+1 up, -1 down) unless it
    already sits on it: the adverse rounding a stop or target level takes, so a
    level is never a price the market cannot print."""
    if direction not in (1, -1):
        raise ValueError(f"direction must be +1 or -1, got {direction}")
    ticks = price / tick_size
    nearest = round(ticks)
    if abs(ticks - nearest) < 1e-9:
        whole = nearest
    else:
        whole = math.ceil(ticks) if direction > 0 else math.floor(ticks)
    return round(whole * tick_size, tick_decimals(tick_size))


def is_on_tick(price: float, tick_size: float, tolerance: float = 1e-9) -> bool:
    """True when ``price`` is a whole number of ticks (within ``tolerance`` ticks)."""
    ticks = price / tick_size
    return abs(ticks - round(ticks)) <= tolerance


def root_symbol(symbol: str, known: set[str] | None = None) -> str:
    """``MNQZ5`` -> ``MNQ``; a symbol that already is a root is returned as is."""
    symbol = symbol.upper()
    if known is not None and symbol in known:
        return symbol
    match = _CONTRACT_CODE.match(symbol)
    if match and (known is None or match.group(1) in known):
        return match.group(1)
    return symbol


def load_cost_model(symbol: str, path: Path | str = COST_MODEL_PATH) -> CostModel:
    path = Path(path)
    with open(path, encoding="utf-8") as handle:
        table = json.load(handle)
    key = root_symbol(symbol, set(table))
    if key not in table:
        raise ValueError(
            f"{symbol} has no entry in {path} (looked up as {key!r}); "
            "a trading metric without costs is not reported"
        )
    entry = table[key]
    return CostModel(
        symbol_key=key,
        tick_size=float(entry["tick_size"]),
        tick_value=float(entry["tick_value"]),
        point_value=float(entry["point_value"]),
        cost_per_side=float(entry["total_per_side"]),
        source=f"packages/config/cost_model.json:{key}",
    )


@dataclass
class Trade:
    number: int
    fold_index: int
    side: int                      # 1 long, -1 short
    contracts: int
    entry_index: int
    entry_timestamp: int
    entry_price: float
    probability_up_at_entry: float
    exit_index: int | None = None
    exit_timestamp: int | None = None
    exit_price: float | None = None
    bars_held: int = 0
    gross_profit_usd: float | None = None
    cost_usd: float | None = None
    net_profit_usd: float | None = None
    exit_reason: str | None = None

    @property
    def is_open(self) -> bool:
        return self.exit_index is None

    def to_event(self) -> dict:
        return {
            "tradeNumber": self.number,
            "foldIndex": self.fold_index,
            "side": "long" if self.side > 0 else "short",
            "status": "open" if self.is_open else "closed",
            "contracts": self.contracts,
            "entryTimestamp": int(self.entry_timestamp),
            "entryPrice": float(self.entry_price),
            "exitTimestamp": None if self.exit_timestamp is None else int(self.exit_timestamp),
            "exitPrice": self.exit_price,
            "barsHeld": int(self.bars_held),
            "probabilityUpAtEntry": min(1.0, max(0.0, float(self.probability_up_at_entry))),
            "grossProfitUsd": self.gross_profit_usd,
            "costUsd": self.cost_usd,
            "netProfitUsd": self.net_profit_usd,
            "exitReason": self.exit_reason,
        }

    def to_row(self) -> dict:
        return {
            "trade_number": self.number,
            "fold_index": self.fold_index,
            "side": "long" if self.side > 0 else "short",
            "contracts": self.contracts,
            "entry_timestamp": int(self.entry_timestamp),
            "entry_price": float(self.entry_price),
            "exit_timestamp": self.exit_timestamp,
            "exit_price": self.exit_price,
            "bars_held": self.bars_held,
            "probability_up_at_entry": float(self.probability_up_at_entry),
            "gross_profit_usd": self.gross_profit_usd,
            "cost_usd": self.cost_usd,
            "net_profit_usd": self.net_profit_usd,
            "exit_reason": self.exit_reason,
        }


@dataclass(frozen=True)
class BarResult:
    net_usd: float          # marked-to-market net for this bar, costs included
    exposed: bool           # a position was held during some part of this bar
    position: int           # position after acting on this bar's decision (the target for the next open)
    held: int               # position held at this bar's close


TradeCallback = Callable[[Trade, str], None]   # (trade, "open" | "closed")


class Simulator:
    def __init__(
        self,
        cost: CostModel,
        *,
        contracts: int = 1,
        holding_bars: int = 1,
        stop_loss_ticks: float = 0.0,
        take_profit_ticks: float = 0.0,
        long_only: bool = False,
        on_trade: TradeCallback | None = None,
        first_trade_number: int = 1,
    ) -> None:
        if contracts < 1:
            raise ValueError("contracts must be >= 1")
        if holding_bars < 1:
            raise ValueError("holding_bars must be >= 1")
        self.cost = cost
        self.contracts = int(contracts)
        self.holding_bars = int(holding_bars)
        self.stop_loss_ticks = float(stop_loss_ticks)
        self.take_profit_ticks = float(take_profit_ticks)
        self.long_only = bool(long_only)
        self.on_trade = on_trade
        self.next_trade_number = int(first_trade_number)
        self.fold_index = 0
        self.position = 0
        self.trade: Trade | None = None
        self.closed_trades: list[Trade] = []
        self.pending_target: int | None = None
        self.pending_reason: str | None = None
        self.pending_probability: float = 0.5
        self.previous_close: float | None = None
        self.bars_since_reset = 0
        self.total_cost_usd = 0.0

    # ── helpers ────────────────────────────────────────────────────────────
    @property
    def fill_cost(self) -> float:
        return self.cost.cost_per_side * self.contracts

    def _usd(self, points: float) -> float:
        return points * self.cost.point_value * self.contracts

    def _open(self, side: int, index: int, timestamp: int, price: float, probability_up: float) -> float:
        self.trade = Trade(
            number=self.next_trade_number,
            fold_index=self.fold_index,
            side=side,
            contracts=self.contracts,
            entry_index=index,
            entry_timestamp=int(timestamp),
            entry_price=float(price),
            probability_up_at_entry=float(probability_up),
        )
        self.next_trade_number += 1
        self.position = side
        self.bars_since_reset = 0
        self.total_cost_usd += self.fill_cost
        if self.on_trade:
            self.on_trade(self.trade, "open")
        return -self.fill_cost

    def _close(self, index: int, timestamp: int, price: float, reason: str) -> float:
        trade = self.trade
        assert trade is not None
        trade.exit_index = index
        trade.exit_timestamp = int(timestamp)
        trade.exit_price = float(price)
        trade.gross_profit_usd = self._usd(trade.side * (float(price) - trade.entry_price))
        trade.cost_usd = 2.0 * self.fill_cost
        trade.net_profit_usd = trade.gross_profit_usd - trade.cost_usd
        trade.exit_reason = reason
        self.closed_trades.append(trade)
        self.trade = None
        self.position = 0
        self.bars_since_reset = 0
        self.total_cost_usd += self.fill_cost
        if self.on_trade:
            self.on_trade(trade, "closed")
        return -self.fill_cost

    # ── public ─────────────────────────────────────────────────────────────
    def begin_fold(self, fold_index: int) -> None:
        if self.position != 0:
            raise RuntimeError("a fold must start flat")
        self.fold_index = int(fold_index)
        self.pending_target = None
        self.pending_reason = None
        self.previous_close = None

    def target_for(self, signal: int | None) -> tuple[int | None, str | None]:
        """What the decision at this close does: (new target or None, exit reason)."""
        if signal is None:
            return None, None
        if self.long_only and signal < 0:
            signal = 0
        if self.position == 0:
            return (signal, None) if signal != 0 else (None, None)
        if signal == -self.position:
            return signal, "opposite_signal"
        if self.bars_since_reset >= self.holding_bars:
            if signal == self.position:
                self.bars_since_reset = 0          # still pointing the same way: keep, no cost
                return None, None
            return 0, "holding_period"
        return None, None

    def step(
        self,
        index: int,
        timestamp: int,
        open_price: float,
        high: float,
        low: float,
        close: float,
        signal: int | None,
        probability_up: float | None,
        *,
        decide: bool = True,
    ) -> BarResult:
        """Process one bar: fill the pending order at the open, check stops,
        mark to market to the close, then take this bar's decision (unless
        ``decide`` is False — the last bar of a span, which has no next open)."""
        net = 0.0
        held_before = self.position
        reference = self.previous_close

        if self.pending_target is not None and self.pending_target != self.position:
            if self.position != 0:
                assert reference is not None
                net += self._usd(self.position * (open_price - reference))
                net += self._close(index, timestamp, open_price, self.pending_reason or "opposite_signal")
            if self.pending_target != 0:
                net += self._open(self.pending_target, index, timestamp, open_price, self.pending_probability)
            reference = open_price
        self.pending_target = None
        self.pending_reason = None

        exposed = held_before != 0 or self.position != 0
        if self.position != 0:
            assert self.trade is not None and reference is not None
            self.trade.bars_held += 1
            self.bars_since_reset += 1
            exit_price, reason = self._stop_exit(open_price, high, low)
            if exit_price is not None:
                net += self._usd(self.position * (exit_price - reference))
                net += self._close(index, timestamp, exit_price, reason)
            else:
                net += self._usd(self.position * (close - reference))
        self.previous_close = float(close)

        if decide:
            target, reason = self.target_for(signal)
            if target is not None and target != self.position:
                self.pending_target = target
                self.pending_reason = reason
                self.pending_probability = 0.5 if probability_up is None else float(probability_up)
        next_position = self.pending_target if self.pending_target is not None else self.position
        return BarResult(net_usd=net, exposed=exposed, position=int(next_position), held=int(self.position))

    def _stop_exit(self, open_price: float, high: float, low: float) -> tuple[float | None, str | None]:
        trade = self.trade
        assert trade is not None
        tick = self.cost.tick_size
        side = trade.side
        # Levels sit on the tick grid, rounded the adverse way: a long's stop
        # down and its target up, a short's the mirror. A 2.5-tick stop on a
        # 0.25 grid is 0.75 points away, never 0.625 (a price no book prints).
        stop = take = None
        if self.stop_loss_ticks > 0:
            stop = level_on_tick(trade.entry_price - side * self.stop_loss_ticks * tick, tick, -side)
        if self.take_profit_ticks > 0:
            take = level_on_tick(trade.entry_price + side * self.take_profit_ticks * tick, tick, side)
        if side > 0:
            if stop is not None and open_price <= stop:
                return open_price, "stop_loss"
            if take is not None and open_price >= take:
                return open_price, "take_profit"
            if stop is not None and low <= stop:
                return stop, "stop_loss"
            if take is not None and high >= take:
                return take, "take_profit"
        else:
            if stop is not None and open_price >= stop:
                return open_price, "stop_loss"
            if take is not None and open_price <= take:
                return open_price, "take_profit"
            if stop is not None and high >= stop:
                return stop, "stop_loss"
            if take is not None and low <= take:
                return take, "take_profit"
        return None, None

    def flatten(self, index: int, timestamp: int, price: float, reason: str) -> float:
        """Close any open trade at ``price`` (the last marked close) and drop the
        pending order. Returns the net USD this adds (minus the exit fill)."""
        self.pending_target = None
        self.pending_reason = None
        if self.position == 0:
            return 0.0
        return self._close(index, timestamp, price, reason)
