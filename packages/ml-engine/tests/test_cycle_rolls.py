"""Contract-roll detection and additive back-adjustment (packages/ml-engine/src/cycle/rolls.py)."""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from cycle.rolls import back_adjust, find_rolls, source_contracts  # noqa: E402

BAR = 300


def _two_contract_market():
    """Old contract trades 100.00.., the new one 250 points higher; the stitched
    series switches from old to new at bar 5. Both contracts trade every bar."""
    timestamps = np.arange(10, dtype=np.int64) * BAR + 1_760_000_000
    old = 100.0 + np.arange(10) * 0.25
    new = old + 250.0
    stitched_close = np.concatenate([old[:5], new[5:]])
    stitched_open = stitched_close - 0.25
    rows = []
    for i, t in enumerate(timestamps):
        rows.append(("MNQZ5", int(t), float(old[i]), 1000.0 if i < 5 else 100.0))
        rows.append(("MNQH6", int(t), float(new[i]), 100.0 if i < 5 else 1000.0))
    return timestamps, stitched_open, stitched_close, rows


def test_each_bar_is_attributed_to_the_contract_whose_close_it_matches():
    timestamps, _, close, rows = _two_contract_market()
    assert source_contracts(timestamps, close, rows) == ["MNQZ5"] * 5 + ["MNQH6"] * 5


def test_the_roll_gap_is_measured_on_a_bar_both_contracts_traded():
    timestamps, open_prices, close, rows = _two_contract_market()
    (roll,) = find_rolls(timestamps, open_prices, close, rows)
    assert roll.index == 5
    assert (roll.from_contract, roll.to_contract) == ("MNQZ5", "MNQH6")
    assert roll.gap_points == pytest.approx(250.0)
    assert roll.exact and roll.measured_at == int(timestamps[4])


def test_back_adjustment_removes_the_step_and_keeps_every_other_point_move():
    timestamps, open_prices, close, rows = _two_contract_market()
    rolls = find_rolls(timestamps, open_prices, close, rows)
    o, h, lo, c, adjustment = back_adjust(open_prices, open_prices + 1, open_prices - 1, close, rolls)
    raw_moves = np.diff(close)
    adjusted_moves = np.diff(c)
    assert raw_moves[4] == pytest.approx(250.25)          # the splice as stored
    assert adjusted_moves[4] == pytest.approx(0.25)        # the new contract's real move
    mask = np.ones(raw_moves.shape, dtype=bool)
    mask[4] = False
    np.testing.assert_allclose(adjusted_moves[mask], raw_moves[mask])
    np.testing.assert_allclose(c[5:], close[5:])            # newest contract as traded
    np.testing.assert_allclose(adjustment[:5], 250.0)
    np.testing.assert_allclose(h - o, np.ones(10))          # bar shapes untouched


def test_no_contract_rows_or_one_contract_means_no_roll():
    timestamps, open_prices, close, rows = _two_contract_market()
    assert find_rolls(timestamps, open_prices, close, []) == []
    only_old = [row for row in rows if row[0] == "MNQZ5"]
    assert find_rolls(timestamps[:5], open_prices[:5], close[:5], only_old) == []


def test_without_a_common_bar_the_gap_falls_back_to_open_minus_previous_close():
    timestamps, open_prices, close, rows = _two_contract_market()
    # the new contract has no bars before the switch
    rows = [row for row in rows if not (row[0] == "MNQH6" and row[1] < int(timestamps[5]))]
    (roll,) = find_rolls(timestamps, open_prices, close, rows)
    assert not roll.exact
    assert roll.gap_points == pytest.approx(float(open_prices[5] - close[4]))
