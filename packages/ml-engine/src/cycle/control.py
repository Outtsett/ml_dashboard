"""Pause / resume / pace / stop for a running Model Cycle, read from stdin.

One JSON object per line (``cycleControlSchema`` in ``packages/shared/src/cycle/schema.ts``):

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
import os
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


PIPE_POLL_SECONDS = 0.05


def _windows_pipe(stream: IO[str]):
    """``(fd, handle, kernel32)`` when ``stream`` is an anonymous pipe on
    Windows — how the dashboard spawns the engine — else ``None``."""
    if os.name != "nt":
        return None
    try:
        fd = stream.fileno()
    except (AttributeError, OSError, ValueError):
        return None
    import ctypes
    import msvcrt
    from ctypes import wintypes

    try:
        handle = msvcrt.get_osfhandle(fd)
    except OSError:
        return None
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.GetFileType.argtypes = (wintypes.HANDLE,)
    kernel32.GetFileType.restype = wintypes.DWORD
    kernel32.PeekNamedPipe.argtypes = (
        wintypes.HANDLE, wintypes.LPVOID, wintypes.DWORD,
        wintypes.LPDWORD, wintypes.LPDWORD, wintypes.LPDWORD,
    )
    kernel32.PeekNamedPipe.restype = wintypes.BOOL
    file_type_pipe = 3
    if kernel32.GetFileType(handle) != file_type_pipe:
        return None
    return fd, handle, kernel32


def _poll_windows_pipe(state: ControlState, fd: int, handle, kernel32) -> None:
    """Read control lines without ever blocking on the pipe.

    A thread parked in a synchronous ReadFile on the stdin pipe serialises every
    other synchronous call on that handle — including the GetFileType / fstat
    probes libraries make on ``sys.stdin`` — so the engine's main thread froze
    right after loading bars until the first control line arrived (measured
    2026-09-25 through the dashboard; a CLI run with stdin at /dev/null never
    showed it because the reader hit EOF at once). Polling with PeekNamedPipe
    and reading only the bytes already there keeps no read pending.
    """
    import ctypes
    from ctypes import wintypes

    available = wintypes.DWORD()
    pending = b""
    while True:
        if not kernel32.PeekNamedPipe(handle, None, 0, None, ctypes.byref(available), None):
            break  # the parent closed stdin: no more control, not an error
        if available.value == 0:
            time.sleep(PIPE_POLL_SECONDS)
            continue
        chunk = os.read(fd, available.value)
        if not chunk:
            break
        pending += chunk
        while b"\n" in pending:
            line, pending = pending.split(b"\n", 1)
            state.apply_line(line.decode("utf-8", errors="replace"))
    if pending.strip():
        state.apply_line(pending.decode("utf-8", errors="replace"))


def start_reader(state: ControlState, stream: IO[str]) -> threading.Thread:
    """Read control lines from ``stream`` on a daemon thread until EOF."""
    pipe = _windows_pipe(stream)

    def run() -> None:
        try:
            if pipe is not None:
                _poll_windows_pipe(state, *pipe)
                return
            for line in stream:
                state.apply_line(line)
        except (OSError, ValueError):
            return

    thread = threading.Thread(target=run, name="cycle-control", daemon=True)
    thread.start()
    return thread
