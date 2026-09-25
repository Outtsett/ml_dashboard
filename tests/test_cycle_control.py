"""Model Cycle stdin control (src/ml/cycle/control.py): pause / resume / pace /
stop, malformed lines, EOF, and the interruptible waits the engine blocks in."""

from __future__ import annotations

import io
import os
import threading
import time

import pytest

from cycle.adapter import StopRequested
from cycle.control import MAXIMUM_BARS_PER_SECOND, ControlState, start_reader


def later(seconds: float, action) -> threading.Thread:
    def run() -> None:
        time.sleep(seconds)
        action()

    thread = threading.Thread(target=run, daemon=True)
    thread.start()
    return thread


# ─── commands ──────────────────────────────────────────────────────────────


def test_initial_state():
    state = ControlState(40, start_paused=True)
    assert (state.bars_per_second, state.paused, state.stop_requested, state.changes) == (40.0, True, False, 0)
    assert ControlState(-5).bars_per_second == 0.0
    assert state.drain_notices() == []


def test_each_command_changes_the_state_and_leaves_a_notice():
    state = ControlState(10)
    state.apply_line('{"command": "pause"}\n')
    assert state.paused and state.changes == 1
    state.apply_line('{"command": "pace", "barsPerSecond": 250}')
    assert state.bars_per_second == 250.0 and state.paused
    state.apply_line('{"command": "pace", "barsPerSecond": 0}')
    assert state.bars_per_second == 0.0
    state.apply_line('{"command": "resume"}')
    assert not state.paused and not state.stop_requested
    assert state.drain_notices() == [
        ("info", "paused"), ("info", "pace 250 bars/s"), ("info", "pace unlimited (as fast as possible)"),
        ("info", "resumed"),
    ]
    assert state.drain_notices() == []           # drained once
    state.apply_line('{"command": "pause"}')
    state.apply_line('{"command": "stop"}')
    assert state.stop_requested and not state.paused   # stop releases a pause
    with pytest.raises(StopRequested):
        state.raise_if_stopped()
    assert state.changes == 6


@pytest.mark.parametrize(
    "line",
    [
        "not json",
        "[1, 2]",
        '"pause"',
        '{"command": "jump"}',
        '{"verb": "pause"}',
        '{"command": "pace"}',
        '{"command": "pace", "barsPerSecond": "fast"}',
        '{"command": "pace", "barsPerSecond": true}',
        '{"command": "pace", "barsPerSecond": -1}',
        f'{{"command": "pace", "barsPerSecond": {MAXIMUM_BARS_PER_SECOND + 1}}}',
    ],
)
def test_a_malformed_line_is_ignored_with_a_warning(line):
    state = ControlState(30)
    state.apply_line(line)
    assert (state.paused, state.stop_requested, state.bars_per_second) == (False, False, 30.0)
    ((level, message),) = state.drain_notices()
    assert level == "warn" and message.startswith("ignored malformed control line")
    assert state.changes == 1                    # a sleeping pacer still wakes to log it


def test_a_long_malformed_line_is_shortened_in_the_notice_and_blank_lines_are_silent():
    state = ControlState()
    state.apply_line("x" * 500)
    ((_, message),) = state.drain_notices()
    assert "..." in message and len(message) < 300
    state.apply_line("   \n")
    assert state.drain_notices() == [] and state.changes == 1


def test_apply_rejects_non_objects_directly():
    with pytest.raises(ValueError):
        ControlState().apply(["pause"])


# ─── the reader thread ─────────────────────────────────────────────────────


def test_reader_applies_every_line_and_ends_quietly_at_eof():
    state = ControlState(20)
    stream = io.StringIO(
        '{"command": "pause"}\n'
        "garbage\n"
        '{"command": "pace", "barsPerSecond": 75.5}\n'
        '{"command": "resume"}\n'
    )
    thread = start_reader(state, stream)
    thread.join(timeout=5)
    assert not thread.is_alive()                 # EOF ends the reader, no exception
    assert thread.daemon
    assert (state.paused, state.stop_requested, state.bars_per_second) == (False, False, 75.5)
    assert [level for level, _ in state.drain_notices()] == ["info", "warn", "info", "info"]


def test_reader_on_a_real_pipe_acts_while_the_writer_is_still_open():
    read_end, write_end = os.pipe()
    reader = os.fdopen(read_end, "r", encoding="utf-8")
    writer = os.fdopen(write_end, "w", encoding="utf-8")
    state = ControlState(10)
    thread = start_reader(state, reader)
    try:
        writer.write('{"command": "pause"}\n')
        writer.flush()
        deadline = time.monotonic() + 5
        while not state.paused and time.monotonic() < deadline:
            time.sleep(0.01)
        assert state.paused and thread.is_alive()
        writer.write('{"command": "stop"}\n')
        writer.flush()
        deadline = time.monotonic() + 5
        while not state.stop_requested and time.monotonic() < deadline:
            time.sleep(0.01)
        assert state.stop_requested
    finally:
        writer.close()                           # EOF
    thread.join(timeout=5)
    assert not thread.is_alive()
    reader.close()


def test_a_stream_that_raises_ends_the_reader_without_raising():
    class Broken:
        def __iter__(self):
            raise OSError("pytest: reading from stdin while output is captured!")

    thread = start_reader(ControlState(), Broken())
    thread.join(timeout=5)
    assert not thread.is_alive()


# ─── interruptible waits ───────────────────────────────────────────────────


def test_wait_while_paused_blocks_until_resume_and_calls_the_heartbeat():
    state = ControlState(start_paused=True)
    beats: list[float] = []
    later(0.35, lambda: state.apply({"command": "resume"}))
    started = time.monotonic()
    state.wait_while_paused(lambda: beats.append(time.monotonic()), interval=0.1)
    waited = time.monotonic() - started
    assert 0.3 <= waited < 2.0
    assert len(beats) >= 2                        # about one per interval while paused


def test_wait_while_paused_returns_at_once_when_not_paused_and_raises_on_stop():
    state = ControlState()
    started = time.monotonic()
    state.wait_while_paused(lambda: None, interval=5)
    assert time.monotonic() - started < 0.1
    state.apply({"command": "pause"})
    later(0.2, lambda: state.apply({"command": "stop"}))
    started = time.monotonic()
    with pytest.raises(StopRequested):
        state.wait_while_paused(lambda: None, interval=5)
    assert time.monotonic() - started < 2.0      # woken by the stop, not by the 5 s interval


def test_sleep_runs_its_full_length_without_commands():
    state = ControlState()
    started = time.monotonic()
    state.sleep(0.2)
    assert 0.18 <= time.monotonic() - started < 1.0
    state.sleep(0)
    state.sleep(-1)


@pytest.mark.parametrize("line", ['{"command": "pace", "barsPerSecond": 5}', '{"command": "stop"}', "junk"])
def test_sleep_is_interrupted_by_any_command(line):
    state = ControlState(1)
    later(0.15, lambda: state.apply_line(line))
    started = time.monotonic()
    state.sleep(10)
    assert time.monotonic() - started < 2.0


def test_sleep_returns_at_once_after_a_stop():
    state = ControlState()
    state.apply({"command": "stop"})
    started = time.monotonic()
    state.sleep(10)
    assert time.monotonic() - started < 0.1
