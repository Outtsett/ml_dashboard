"""Pause / resume / pace / stop for a running Model Cycle, read from stdin.

One JSON object per line (``cycleControlSchema`` in ``src/shared/cycle/schema.ts``):

    {"command": "pause"}
    {"command": "resume"}
    {"command": "pace", "barsPerSecond": 120}     # 0 = as fast as possible
    {"command": "stop"}

A daemon thread reads the lines and updates a lock-guarded state. It never
writes to stdout itself — two threads printing could interleave half-lines of
JSON — so it queues ``(level, message)`` notices that the engine's thread
drains (and logs with the ``[control]`` prefix, followed by a cursor) at its
next checkpoint. Every state change also notifies a condition, so a sleeping
pacer or a paused engine wakes at once. EOF on stdin simply means no more
control; it is not an error.
"""

from __future__ import annotations

import json
import threading
import time
from typing import IO, Callable

from cycle.adapter import StopRequested

MAXIMUM_BARS_PER_SECOND = 100000.0


class ControlState:
    def __init__(self, bars_per_second: float = 0.0, start_paused: bool = False) -> None:
        self._condition = threading.Condition()
        self._paused = bool(start_paused)
        self._stop = False
        self._bars_per_second = max(0.0, float(bars_per_second))
        self._notices: list[tuple[str, str]] = []
        self._changes = 0

    # ── read side (engine thread) ──────────────────────────────────────────
    @property
    def paused(self) -> bool:
        with self._condition:
            return self._paused

    @property
    def stop_requested(self) -> bool:
        with self._condition:
            return self._stop

    @property
    def bars_per_second(self) -> float:
        with self._condition:
            return self._bars_per_second

    @property
    def changes(self) -> int:
        """Counter bumped by every applied command (lets the pacer notice a pace change)."""
        with self._condition:
            return self._changes

    def drain_notices(self) -> list[tuple[str, str]]:
        with self._condition:
            notices, self._notices = self._notices, []
            return notices

    def raise_if_stopped(self) -> None:
        if self.stop_requested:
            raise StopRequested()

    def wait_while_paused(self, heartbeat: Callable[[], None], interval: float = 1.0) -> None:
        """Block while paused, calling ``heartbeat`` about once per ``interval``
        seconds (and after every command); raise ``StopRequested`` on stop."""
        while True:
            with self._condition:
                if self._stop:
                    raise StopRequested()
                if not self._paused:
                    return
                self._condition.wait(timeout=interval)
            heartbeat()

    def sleep(self, seconds: float) -> None:
        """Sleep up to ``seconds``; returns early on any command."""
        if seconds <= 0:
            return
        with self._condition:
            start = self._changes
            deadline = time.monotonic() + seconds
            while self._changes == start and not self._stop:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return
                self._condition.wait(timeout=remaining)

    # ── write side (reader thread, tests) ──────────────────────────────────
    def apply(self, command: dict) -> str:
        """Apply one parsed command; returns the log message for it. Raises
        ValueError for a malformed command."""
        if not isinstance(command, dict):
            raise ValueError("a control line must be a JSON object")
        name = command.get("command")
        with self._condition:
            if name == "pause":
                self._paused = True
                message = "paused"
            elif name == "resume":
                self._paused = False
                message = "resumed"
            elif name == "pace":
                value = command.get("barsPerSecond")
                if isinstance(value, bool) or not isinstance(value, (int, float)):
                    raise ValueError("pace needs a numeric barsPerSecond")
                if not (0 <= float(value) <= MAXIMUM_BARS_PER_SECOND):
                    raise ValueError(f"barsPerSecond must be between 0 and {MAXIMUM_BARS_PER_SECOND:g}")
                self._bars_per_second = float(value)
                message = f"pace {float(value):g} bars/s" if value else "pace unlimited (as fast as possible)"
            elif name == "stop":
                self._stop = True
                self._paused = False
                message = "stop requested"
            else:
                raise ValueError(f"unknown command {name!r}")
            self._changes += 1
            self._notices.append(("info", message))
            self._condition.notify_all()
        return message

    def apply_line(self, line: str) -> None:
        text = line.strip()
        if not text:
            return
        try:
            self.apply(json.loads(text))
        except (ValueError, json.JSONDecodeError) as error:
            shown = text if len(text) <= 120 else text[:117] + "..."
            with self._condition:
                self._notices.append(("warn", f"ignored malformed control line {shown!r}: {error}"))
                self._changes += 1
                self._condition.notify_all()


def start_reader(state: ControlState, stream: IO[str]) -> threading.Thread:
    """Read control lines from ``stream`` on a daemon thread until EOF."""

    def run() -> None:
        try:
            for line in stream:
                state.apply_line(line)
        except (OSError, ValueError):
            return

    thread = threading.Thread(target=run, name="cycle-control", daemon=True)
    thread.start()
    return thread
