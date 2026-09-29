"""The locked holdout: the last six months of the lake's MNQ history.

2025-07-01 00:00 to 2025-12-31 00:00 on the lake's futures clock (Pacific wall
clock digits stored as UTC). No design choice may be informed by it, so every
loader in this package calls :func:`guard` on the timestamps it is about to
return, and only :func:`look` — called by the acceptance gate — lets them
through. Each look is appended to the plan's ``state.json`` and counted against
a budget of one: a second look means the holdout is burnt, and the gate must
move to a fresh forward period instead.

Timestamps are epoch milliseconds. ``clock="pacific_stamp"`` is the lake's
futures stamping (``ohlcv_*``, ``mnq_*``, ``derived_labels``); ``clock="utc"``
is true UTC (the Iceberg ``bars`` table, news), converted before the check.
"""

from __future__ import annotations

import json
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator
from zoneinfo import ZoneInfo

import numpy as np

PLAN_DIR = Path(__file__).resolve().parents[3] / "docs" / "plans" / "2026-09-29-multimodal"
STATE_PATH = PLAN_DIR / "state.json"

HOLDOUT_START_MS = int(datetime(2025, 7, 1, tzinfo=timezone.utc).timestamp() * 1000)
HOLDOUT_END_MS = int(datetime(2025, 12, 31, tzinfo=timezone.utc).timestamp() * 1000)
LOOK_BUDGET = 1

_PACIFIC = ZoneInfo("America/Los_Angeles")
_unlocked = False


class HoldoutLocked(RuntimeError):
    """Raised when development code reaches into the locked holdout."""


def to_pacific_stamp(utc_ms: np.ndarray) -> np.ndarray:
    """True-UTC epoch ms → the lake's futures stamping (Pacific wall clock read as UTC)."""
    values = np.asarray(utc_ms, dtype="int64")
    out = np.empty_like(values)
    for i, value in enumerate(values):
        local = datetime.fromtimestamp(value / 1000, tz=timezone.utc).astimezone(_PACIFIC)
        out[i] = int(local.replace(tzinfo=timezone.utc).timestamp() * 1000)
    return out


def in_holdout(timestamps_ms: np.ndarray, clock: str = "pacific_stamp") -> np.ndarray:
    """Boolean mask of the timestamps that fall inside the holdout."""
    values = np.asarray(timestamps_ms, dtype="int64")
    if clock == "utc":
        values = to_pacific_stamp(values)
    elif clock != "pacific_stamp":
        raise ValueError(f"unknown clock {clock!r}")
    return (values >= HOLDOUT_START_MS) & (values < HOLDOUT_END_MS)


def guard(timestamps_ms: np.ndarray, clock: str = "pacific_stamp", what: str = "data") -> None:
    """Refuse any holdout timestamp unless the gate has unlocked it."""
    if _unlocked:
        return
    mask = in_holdout(timestamps_ms, clock)
    if mask.any():
        first = int(np.asarray(timestamps_ms)[mask][0])
        raise HoldoutLocked(
            f"{what}: {int(mask.sum())} timestamp(s) inside the locked holdout "
            f"(first {datetime.fromtimestamp(first / 1000, tz=timezone.utc).isoformat()}). "
            "Only the acceptance gate may read it (multimodal.holdout.look)."
        )


def development_end_ms() -> int:
    """The first instant the development period may not reach."""
    return HOLDOUT_START_MS


def _read_state() -> dict:
    return json.loads(STATE_PATH.read_text(encoding="utf-8"))


def looks_taken() -> int:
    return int(_read_state()["holdout"]["looks"])


@contextmanager
def look(reason: str, *, state_path: Path | None = None) -> Iterator[None]:
    """Open the holdout for one gated evaluation and record the look.

    Refuses once the budget is spent: a burnt holdout cannot certify anything,
    and the gate must use a fresh forward period instead.
    """
    global _unlocked
    path = state_path or STATE_PATH
    state = json.loads(path.read_text(encoding="utf-8"))
    taken = int(state["holdout"]["looks"])
    if taken >= int(state["holdout"].get("look_budget", LOOK_BUDGET)):
        raise HoldoutLocked(f"the holdout has been looked at {taken} time(s); its budget is spent")
    state["holdout"]["looks"] = taken + 1
    state["holdout"].setdefault("look_log", []).append(
        {"at": datetime.now(timezone.utc).isoformat(), "reason": reason}
    )
    path.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")
    _unlocked = True
    try:
        yield
    finally:
        _unlocked = False
