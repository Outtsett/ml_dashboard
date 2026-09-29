"""The locked periods: the holdout (the last six months of the lake's MNQ
history) and the forward period (everything after the lake's end).

HOLDOUT: 2025-07-01 00:00 to 2025-12-31 00:00 on the lake's futures clock
(Pacific wall clock digits stored as UTC). No design choice may be informed by
it, so every loader in this package calls :func:`guard` on the timestamps it is
about to return, and only :func:`look` — called by the acceptance gate — lets
them through. Each look is appended to the plan's ``state.json`` and counted
against a budget of one: a second look means the period is burnt.

FORWARD: 2026-01-01 onward on the same clock — the clean confirmation set
(Yahoo history landed 2026-09-29 plus the live hub), which no study on this
machine has seen. Locked the same way, read once through
``look(..., period="forward")``.

Timestamps are epoch milliseconds. ``clock="pacific_stamp"`` is the lake's
futures stamping (``ohlcv_*``, ``mnq_*``, ``derived_labels``); ``clock="utc"``
is true UTC (the Iceberg ``bars`` table, news, Yahoo), converted before the check.
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
FORWARD_START_MS = int(datetime(2026, 1, 1, tzinfo=timezone.utc).timestamp() * 1000)
LOOK_BUDGET = 1
PERIODS = ("holdout", "forward")

_PACIFIC = ZoneInfo("America/Los_Angeles")
_unlocked: set[str] = set()


class HoldoutLocked(RuntimeError):
    """Raised when development code reaches into a locked period."""


def to_pacific_stamp(utc_ms: np.ndarray) -> np.ndarray:
    """True-UTC epoch ms → the lake's futures stamping (Pacific wall clock read as UTC)."""
    values = np.asarray(utc_ms, dtype="int64")
    out = np.empty_like(values)
    for i, value in enumerate(values):
        local = datetime.fromtimestamp(value / 1000, tz=timezone.utc).astimezone(_PACIFIC)
        out[i] = int(local.replace(tzinfo=timezone.utc).timestamp() * 1000)
    return out


def _stamped(timestamps_ms: np.ndarray, clock: str) -> np.ndarray:
    values = np.asarray(timestamps_ms, dtype="int64")
    if clock == "utc":
        return to_pacific_stamp(values)
    if clock != "pacific_stamp":
        raise ValueError(f"unknown clock {clock!r}")
    return values


def in_holdout(timestamps_ms: np.ndarray, clock: str = "pacific_stamp") -> np.ndarray:
    """Boolean mask of the timestamps that fall inside the holdout."""
    values = _stamped(timestamps_ms, clock)
    return (values >= HOLDOUT_START_MS) & (values < HOLDOUT_END_MS)


def in_forward(timestamps_ms: np.ndarray, clock: str = "pacific_stamp") -> np.ndarray:
    """Boolean mask of the timestamps in the forward (post-lake) period."""
    return _stamped(timestamps_ms, clock) >= FORWARD_START_MS


def guard(timestamps_ms: np.ndarray, clock: str = "pacific_stamp", what: str = "data") -> None:
    """Refuse any locked timestamp (holdout or forward) unless the gate has unlocked that period."""
    for period, mask in (("holdout", in_holdout(timestamps_ms, clock)), ("forward", in_forward(timestamps_ms, clock))):
        if period in _unlocked or not mask.any():
            continue
        first = int(np.asarray(timestamps_ms)[mask][0])
        raise HoldoutLocked(
            f"{what}: {int(mask.sum())} timestamp(s) inside the locked {period} period "
            f"(first {datetime.fromtimestamp(first / 1000, tz=timezone.utc).isoformat()}). "
            "Only the acceptance gate may read it (multimodal.holdout.look)."
        )


def development_end_ms() -> int:
    """The first instant the development period may not reach."""
    return HOLDOUT_START_MS


def _read_state() -> dict:
    return json.loads(STATE_PATH.read_text(encoding="utf-8"))


def looks_taken(period: str = "holdout") -> int:
    return int(_read_state().get(period, {}).get("looks", 0))


@contextmanager
def look(reason: str, *, period: str = "holdout", state_path: Path | None = None) -> Iterator[None]:
    """Open a locked period for one gated evaluation and record the look.

    Refuses once the budget is spent: a burnt period cannot certify anything.
    """
    if period not in PERIODS:
        raise ValueError(f"unknown period {period!r}")
    path = state_path or STATE_PATH
    state = json.loads(path.read_text(encoding="utf-8"))
    record = state.setdefault(period, {"looks": 0, "look_budget": LOOK_BUDGET})
    taken = int(record.get("looks", 0))
    if taken >= int(record.get("look_budget", LOOK_BUDGET)):
        raise HoldoutLocked(f"the {period} period has been looked at {taken} time(s); its budget is spent")
    record["looks"] = taken + 1
    record.setdefault("look_log", []).append({"at": datetime.now(timezone.utc).isoformat(), "reason": reason})
    path.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")
    _unlocked.add(period)
    try:
        yield
    finally:
        _unlocked.discard(period)
