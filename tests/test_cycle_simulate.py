"""Model Cycle trade simulator (src/ml/cycle/simulate.py) on hand-built bars.

Every expected price, fill and dollar amount is worked out by hand from the
bars written in each test. MNQ: tick 0.25 points, $2.00 a point, and the
per-side cost read from src/config/cost_model.json.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

from cycle.simulate import COST_MODEL_PATH, CostModel, Simulator, load_cost_model, root_symbol

COST_TABLE = json.loads(Path(COST_MODEL_PATH).read_text(encoding="utf-8"))
MNQ = load_cost_model("MNQ")
PER_SIDE = float(COST_TABLE["MNQ"]["total_per_side"])     # 1.40 today
POINT = float(COST_TABLE["MNQ"]["point_value"])           # 2.00


def usd(points: float, contracts: int = 1) -> float:
    return points * POINT * contracts


class Tape:
    """Feeds bars (open, high, low, close, signal) to a simulator and keeps the
    results and every trade callback."""

    def __init__(self, **kwargs) -> None:
        self.calls: list[tuple[int, str]] = []
        kwargs.setdefault("holding_bars", 50)
        self.simulator = Simulator(MNQ, on_trade=lambda trade, status: self.calls.append((trade.number, status)), **kwargs)
        self.simulator.begin_fold(0)
        self.results = []
        self.index = 0

    def bar(self, o, h, low, c, signal, probability=None, decide=True):
        if probability is None and signal is not None:
            probability = {1: 0.8, -1: 0.2, 0: 0.5}[signal]
        result = self.simulator.step(self.index, 1_000_000 + 300 * self.index, o, h, low, c, signal, probability, decide=decide)
        self.results.append(result)
        self.index += 1
        return result

    @property
    def trades(self):
        return self.simulator.closed_trades

    def net(self) -> float:
        return sum(result.net_usd for result in self.results)


# ─── cost model ────────────────────────────────────────────────────────────


def test_cost_model_is_read_from_the_config_file():
    assert MNQ.symbol_key == "MNQ"
    assert MNQ.cost_per_side == PER_SIDE
    assert MNQ.tick_size == COST_TABLE["MNQ"]["tick_size"]
    assert MNQ.tick_value == COST_TABLE["MNQ"]["tick_value"]
    assert MNQ.point_value == POINT
    assert MNQ.round_trip == pytest.approx(2 * PER_SIDE)
    assert MNQ.round_trip == pytest.approx(COST_TABLE["MNQ"]["total_round_trip"])
    assert MNQ.source == "src/config/cost_model.json:MNQ"


def test_contract_codes_map_to_their_root():
    assert root_symbol("MNQZ5") == "MNQ"
    assert root_symbol("mnqz25", {"MNQ"}) == "MNQ"
    assert root_symbol("MNQ", {"MNQ"}) == "MNQ"
    assert load_cost_model("MNQZ5").symbol_key == "MNQ"
    assert load_cost_model("MNQH26") == MNQ


def test_an_unknown_symbol_raises_instead_of_trading_without_costs(tmp_path):
    with pytest.raises(ValueError, match="no entry"):
        load_cost_model("ZZZ")
    # every lake root is priced (2026-09-27): a contract code resolves to its root's entry
    es = load_cost_model("ESZ5")
    assert es.symbol_key == "ES" and es.tick_size == 0.25 and es.tick_value == 12.5 and es.cost_per_side == 14.42
    table = tmp_path / "costs.json"
    table.write_text(json.dumps({"ES": {"tick_size": 0.25, "tick_value": 12.5, "point_value": 50.0,
                                        "total_per_side": 2.5}}), encoding="utf-8")
    assert load_cost_model("ESZ5", table).cost_per_side == 2.5
    with pytest.raises(ValueError, match="no entry"):
        load_cost_model("MNQ", table)


# ─── fills ─────────────────────────────────────────────────────────────────


def test_a_decision_at_close_fills_at_the_next_open():
    tape = Tape()
    first = tape.bar(100, 101, 99, 100, 1)
    # the decision is taken at bar 0's close: nothing is held or paid during bar 0
    assert (first.net_usd, first.exposed, first.held, first.position) == (0.0, False, 0, 1)
    assert tape.simulator.trade is None
    second = tape.bar(102, 104, 101, 103, 0)
    trade = tape.simulator.trade
    assert trade.entry_price == 102.0 and trade.entry_index == 1  # bar 1's open, not bar 0's close (100)
    assert trade.probability_up_at_entry == 0.8
    # one fill, marked from the 102 open to the 103 close
    assert second.net_usd == pytest.approx(-PER_SIDE + usd(1.0))
    assert (second.exposed, second.held, second.position) == (True, 1, 1)


@pytest.mark.parametrize("contracts", [1, 3])
def test_each_fill_costs_the_per_side_cost_times_contracts(contracts):
    tape = Tape(contracts=contracts, holding_bars=1)
    tape.bar(100, 100, 100, 100, 1)
    tape.bar(100, 101, 99, 101, 0)      # long filled at 100; expiry at this close with signal 0 -> exit
    exit_bar = tape.bar(102, 102, 102, 102, 0)
    (trade,) = tape.trades
    assert trade.exit_price == 102.0 and trade.exit_reason == "holding_period"
    assert trade.cost_usd == pytest.approx(2 * PER_SIDE * contracts)
    assert trade.gross_profit_usd == pytest.approx(usd(2.0, contracts))
    assert trade.net_profit_usd == pytest.approx(usd(2.0, contracts) - 2 * PER_SIDE * contracts)
    assert exit_bar.net_usd == pytest.approx(usd(1.0, contracts) - PER_SIDE * contracts)  # 101 close -> 102 open, one fill
    assert tape.simulator.total_cost_usd == pytest.approx(2 * PER_SIDE * contracts)
    assert tape.net() == pytest.approx(trade.net_profit_usd)


# ─── holding period ────────────────────────────────────────────────────────


def test_holding_expiry_resets_while_the_signal_persists():
    tape = Tape(holding_bars=2)
    tape.bar(100, 100, 100, 100, 1)
    for _ in range(7):                  # bars 1..7 all keep saying long
        tape.bar(100, 101, 99, 100, 1)
    trade = tape.simulator.trade
    assert trade is not None and trade.entry_index == 1 and trade.bars_held == 7
    assert tape.trades == [] and tape.calls == [(1, "open")]
    assert tape.simulator.total_cost_usd == pytest.approx(PER_SIDE)   # the entry fill only


def test_holding_expiry_exits_when_the_signal_no_longer_agrees():
    tape = Tape(holding_bars=2)
    tape.bar(100, 100, 100, 100, 1)
    tape.bar(100, 101, 99, 100, 0)      # bar 1: filled; 1 bar held < 2, a flat signal does NOT exit
    assert tape.results[-1].position == 1
    tape.bar(101, 101, 100, 101, 0)     # bar 2: 2 bars held, the signal is flat -> exit at bar 3's open
    assert tape.results[-1].position == 0 and tape.results[-1].held == 1
    tape.bar(103, 104, 102, 104, 0)
    (trade,) = tape.trades
    assert (trade.exit_index, trade.exit_price, trade.bars_held, trade.exit_reason) == (3, 103.0, 2, "holding_period")
    assert tape.results[-1].exposed and tape.results[-1].held == 0
    assert tape.simulator.position == 0


def test_an_unpredictable_bar_takes_no_decision():
    tape = Tape(holding_bars=1)
    tape.bar(100, 100, 100, 100, 1)
    tape.bar(100, 100, 100, 100, None)  # expiry reached, but no prediction: keep, no exit
    tape.bar(100, 100, 100, 100, None)
    assert tape.simulator.position == 1 and tape.trades == []
    tape = Tape()
    tape.bar(100, 100, 100, 100, None)
    tape.bar(100, 100, 100, 100, 0)
    assert tape.simulator.trade is None and tape.calls == []


# ─── reversal ──────────────────────────────────────────────────────────────


def test_an_opposite_signal_exits_and_reverses_with_two_fills():
    tape = Tape(holding_bars=10)
    tape.bar(100, 100, 100, 100, 1)
    tape.bar(100, 102, 99, 101, -1)     # long filled at 100; short signal before expiry
    assert tape.results[-1].position == -1
    reversal = tape.bar(103, 103, 97, 98, 0)
    long_trade, = tape.trades
    short_trade = tape.simulator.trade
    assert (long_trade.exit_price, long_trade.exit_reason, long_trade.exit_index) == (103.0, "opposite_signal", 2)
    assert (short_trade.side, short_trade.entry_price, short_trade.entry_index) == (-1, 103.0, 2)
    assert short_trade.probability_up_at_entry == 0.2
    # long marked 101 -> 103, exit fill, short entry fill, short marked 103 -> 98
    assert reversal.net_usd == pytest.approx(usd(2.0) - 2 * PER_SIDE + usd(5.0))
    assert tape.calls == [(1, "open"), (1, "closed"), (2, "open")]
    assert tape.simulator.total_cost_usd == pytest.approx(3 * PER_SIDE)


def test_long_only_never_sells_short_and_ignores_short_signals_while_long():
    tape = Tape(long_only=True, holding_bars=10)
    tape.bar(100, 100, 100, 100, -1)
    tape.bar(100, 100, 100, 100, 0)
    assert tape.simulator.position == 0 and tape.calls == []
    tape.bar(100, 100, 100, 100, 1)
    tape.bar(100, 100, 100, 100, -1)    # long: a short signal is read as flat, not as an exit
    tape.bar(100, 100, 100, 100, -1)
    assert tape.simulator.position == 1 and tape.trades == []


# ─── stop loss / take profit ───────────────────────────────────────────────

LONG_STOPS = {"stop_loss_ticks": 4, "take_profit_ticks": 8}   # from a 100 entry: stop 99, target 102


def _long_at_100(**kwargs) -> Tape:
    tape = Tape(**{**LONG_STOPS, **kwargs})
    tape.bar(100, 100, 100, 100, 1)
    tape.bar(100, 100.5, 99.5, 100, 1)  # filled at 100, neither level touched
    assert tape.simulator.trade.entry_price == 100.0
    return tape


@pytest.mark.parametrize(
    ("bar", "exit_price", "reason"),
    [
        ((100.5, 101.0, 98.5, 100.0), 99.0, "stop_loss"),        # low through the stop
        ((100.5, 102.5, 100.0, 102.0), 102.0, "take_profit"),    # high through the target
        ((100.5, 103.0, 98.0, 101.0), 99.0, "stop_loss"),        # both touched: the stop is assumed first
        ((97.5, 98.0, 97.0, 97.75), 97.5, "stop_loss"),          # gap below the stop fills at the open
        ((103.0, 104.0, 102.5, 103.5), 103.0, "take_profit"),    # gap above the target fills at the open
    ],
)
def test_long_stop_and_target_intrabar(bar, exit_price, reason):
    tape = _long_at_100()
    result = tape.bar(*bar, 1)
    (trade,) = tape.trades
    assert (trade.exit_price, trade.exit_reason, trade.exit_index, trade.bars_held) == (exit_price, reason, 2, 2)
    # marked from the previous close (100) to the exit price, one fill
    assert result.net_usd == pytest.approx(usd(exit_price - 100.0) - PER_SIDE)
    assert (result.held, result.exposed) == (0, True)
    assert result.position == 1          # the long signal at this close re-enters at the next open
    assert tape.net() == pytest.approx(trade.net_profit_usd)


@pytest.mark.parametrize(
    ("bar", "exit_price", "reason"),
    [
        ((99.5, 101.25, 99.0, 100.0), 101.0, "stop_loss"),       # stop 4 ticks above 100
        ((99.5, 100.0, 97.75, 98.0), 98.0, "take_profit"),       # target 8 ticks below 100
        ((99.5, 101.5, 97.5, 99.0), 101.0, "stop_loss"),         # both: stop first
        ((102.0, 102.5, 101.5, 102.0), 102.0, "stop_loss"),      # gap above the stop fills at the open
    ],
)
def test_short_stop_and_target_intrabar(bar, exit_price, reason):
    tape = Tape(**LONG_STOPS)
    tape.bar(100, 100, 100, 100, -1)
    tape.bar(100, 100.5, 99.5, 100, -1)
    tape.bar(*bar, 0)
    (trade,) = tape.trades
    assert (trade.side, trade.exit_price, trade.exit_reason) == (-1, exit_price, reason)
    assert trade.gross_profit_usd == pytest.approx(usd(100.0 - exit_price))


def test_the_stop_is_live_on_the_entry_bar_itself():
    tape = Tape(**LONG_STOPS)
    tape.bar(100, 100, 100, 100, 1)
    tape.bar(100, 100.25, 98.75, 99.5, 0)   # filled at the 100 open, the low reaches 99 in the same bar
    (trade,) = tape.trades
    assert (trade.entry_index, trade.exit_index, trade.exit_price, trade.bars_held) == (1, 1, 99.0, 1)
    assert tape.results[-1].net_usd == pytest.approx(-PER_SIDE + usd(-1.0) - PER_SIDE)


# ─── bookkeeping ───────────────────────────────────────────────────────────


def test_marked_to_market_bars_sum_to_the_closed_trades_net_when_flat():
    generator = np.random.default_rng(11)
    tape = Tape(holding_bars=3, stop_loss_ticks=6, take_profit_ticks=10, contracts=2)
    close = 18000.0
    for _ in range(600):
        o = close + 0.25 * generator.integers(-3, 4)
        c = o + 0.25 * generator.integers(-8, 9)
        h = max(o, c) + 0.25 * generator.integers(0, 6)
        low = min(o, c) - 0.25 * generator.integers(0, 6)
        signal = [None, -1, 0, 1][generator.integers(0, 4)]
        tape.bar(o, h, low, c, signal)
        close = c
    flatten = tape.simulator.flatten(tape.index - 1, 0, close, "fold_end")
    total = tape.net() + flatten
    trades = tape.trades
    assert len(trades) > 50
    assert tape.simulator.position == 0 and tape.simulator.trade is None
    assert total == pytest.approx(sum(t.net_profit_usd for t in trades), abs=1e-9)
    assert tape.simulator.total_cost_usd == pytest.approx(sum(t.cost_usd for t in trades))
    assert {t.exit_reason for t in trades} >= {"holding_period", "opposite_signal", "stop_loss", "take_profit"}
    for trade in trades:
        assert trade.cost_usd == pytest.approx(2 * PER_SIDE * 2)
        assert trade.gross_profit_usd == pytest.approx(usd(trade.side * (trade.exit_price - trade.entry_price), 2))
        assert trade.net_profit_usd == pytest.approx(trade.gross_profit_usd - trade.cost_usd)


def test_flatten_closes_at_the_given_price_and_drops_a_pending_order():
    tape = Tape()
    tape.bar(100, 100, 100, 100, 1)
    tape.bar(100, 101, 100, 101, 1)
    adjustment = tape.simulator.flatten(1, 1_000_300, 101.0, "stopped")
    assert adjustment == pytest.approx(-PER_SIDE)
    (trade,) = tape.trades
    assert (trade.exit_price, trade.exit_reason) == (101.0, "stopped")
    tape.bar(101, 101, 101, 101, -1)          # decision -> pending short
    assert tape.simulator.pending_target == -1
    assert tape.simulator.flatten(2, 0, 101.0, "fold_end") == 0.0
    assert tape.simulator.pending_target is None
    tape.bar(101, 101, 101, 101, 0, decide=False)
    assert tape.simulator.position == 0


def test_the_last_bar_of_a_span_takes_no_decision_and_a_fold_must_start_flat():
    tape = Tape()
    result = tape.bar(100, 100, 100, 100, 1, decide=False)
    assert result.position == 0 and tape.simulator.pending_target is None
    tape.bar(100, 100, 100, 100, 1)
    tape.bar(100, 100, 100, 100, 1)
    with pytest.raises(RuntimeError, match="flat"):
        tape.simulator.begin_fold(1)


def test_trade_event_and_row_use_full_word_keys():
    tape = Tape(holding_bars=1)
    tape.bar(100, 100, 100, 100, 1)
    tape.bar(100, 100, 100, 100, 0)
    tape.bar(100, 100, 100, 100, 0)
    (trade,) = tape.trades
    event = trade.to_event()
    assert set(event) == {
        "tradeNumber", "foldIndex", "side", "status", "contracts", "entryTimestamp", "entryPrice",
        "exitTimestamp", "exitPrice", "barsHeld", "probabilityUpAtEntry", "grossProfitUsd", "costUsd",
        "netProfitUsd", "exitReason",
    }
    assert (event["side"], event["status"], event["exitReason"]) == ("long", "closed", "holding_period")
    assert set(trade.to_row()) == {
        "trade_number", "fold_index", "side", "contracts", "entry_timestamp", "entry_price", "exit_timestamp",
        "exit_price", "bars_held", "probability_up_at_entry", "gross_profit_usd", "cost_usd", "net_profit_usd",
        "exit_reason",
    }


def test_invalid_simulator_settings_raise():
    cost = CostModel("MNQ", 0.25, 0.5, 2.0, 1.4, "test")
    with pytest.raises(ValueError, match="contracts"):
        Simulator(cost, contracts=0)
    with pytest.raises(ValueError, match="holding_bars"):
        Simulator(cost, holding_bars=0)
