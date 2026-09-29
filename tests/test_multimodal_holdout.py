"""`src/ml/multimodal/holdout.py` — the locked holdout.

Development code must never reach 2025-07-01 → 2025-12-31 (the lake's futures
clock); only the gate's `look()` opens it, each look is recorded, and the
budget of one is enforced.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone

import numpy as np
import pytest

from multimodal import holdout


def ms(*parts: int) -> int:
    return int(datetime(*parts, tzinfo=timezone.utc).timestamp() * 1000)


def test_development_data_passes_and_holdout_is_refused():
    holdout.guard(np.array([ms(2024, 3, 1), ms(2025, 6, 30, 23, 59)]))
    with pytest.raises(holdout.HoldoutLocked):
        holdout.guard(np.array([ms(2025, 6, 30), ms(2025, 7, 1, 0, 0)]))
    # the end is exclusive: 2025-12-31 onward is outside it
    holdout.guard(np.array([ms(2025, 12, 31, 0, 0)]))


def test_true_utc_is_converted_to_the_lake_clock_before_the_check():
    # 2025-07-01 06:30 UTC is 2025-06-30 23:30 Pacific: still development
    holdout.guard(np.array([ms(2025, 7, 1, 6, 30)]), clock="utc")
    # 07:30 UTC is 00:30 Pacific on July 1: inside
    with pytest.raises(holdout.HoldoutLocked):
        holdout.guard(np.array([ms(2025, 7, 1, 7, 30)]), clock="utc")


def test_a_look_is_recorded_and_the_budget_is_enforced(tmp_path):
    state = tmp_path / "state.json"
    state.write_text(json.dumps({"holdout": {"looks": 0, "look_budget": 1}}), encoding="utf-8")
    inside = np.array([ms(2025, 8, 1)])
    with holdout.look("final gate", state_path=state):
        holdout.guard(inside)  # open inside the look
    with pytest.raises(holdout.HoldoutLocked):
        holdout.guard(inside)  # closed again after it
    recorded = json.loads(state.read_text(encoding="utf-8"))["holdout"]
    assert recorded["looks"] == 1 and recorded["look_log"][0]["reason"] == "final gate"
    with pytest.raises(holdout.HoldoutLocked):
        with holdout.look("second look", state_path=state):
            pass


def test_the_forward_period_is_locked_too(tmp_path):
    after_the_lake = np.array([ms(2026, 8, 3, 10, 0)])
    with pytest.raises(holdout.HoldoutLocked, match="forward"):
        holdout.guard(after_the_lake)
    state = tmp_path / "state.json"
    state.write_text(json.dumps({"holdout": {"looks": 0, "look_budget": 1}}), encoding="utf-8")
    with holdout.look("forward confirmation", period="forward", state_path=state):
        holdout.guard(after_the_lake)
        with pytest.raises(holdout.HoldoutLocked, match="holdout"):
            holdout.guard(np.array([ms(2025, 9, 1)]))  # opening one period does not open the other
    assert json.loads(state.read_text(encoding="utf-8"))["forward"]["looks"] == 1


def test_the_project_state_has_not_looked_yet():
    assert holdout.looks_taken("holdout") == 0
    assert holdout.looks_taken("forward") == 0
