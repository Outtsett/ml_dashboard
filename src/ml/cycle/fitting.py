"""Keeping Pause and Stop responsive while a library fits in one call.

Most registry models train in steps the adapter controls (boosting rounds,
tree chunks, epochs), and call ``reporter.checkpoint()`` between them. A
``single_fit`` model (``progress == "single_fit"`` in
``src/config/cycle_models/``: a decision tree, a support vector machine, a
linear solve, a stacking ensemble, ...) trains in ONE library call that can
take many seconds and offers no hook to stop it.

``run_single_fit(job, reporter)`` runs that call on a daemon thread and, on
the calling thread, calls ``reporter.checkpoint()`` every 0.2 seconds until it
finishes:

- Pause: ``checkpoint()`` blocks the calling thread. The fit itself carries on
  in the background (it cannot be suspended), and its result is returned once
  the user resumes.
- Stop: ``checkpoint()`` raises ``adapter.StopRequested``, which propagates
  immediately. The fit thread is abandoned: it is a daemon, so it never keeps
  the process alive, and its result is discarded. The engine ends the run
  right after a stop, so the abandoned fit costs CPU for at most the rest of
  its own fit.

An exception inside the fit is re-raised on the calling thread, unchanged.
The libraries used here (scikit-learn's libsvm / tree / linear solvers,
statsmodels' numpy code) release the GIL or yield it every few milliseconds,
so the calling thread's 0.2-second checks run on time; measured on a 12,000-row
SVC fit: the longest gap between checks was 0.201 s.
"""

from __future__ import annotations

import threading
import time
from typing import Callable, TypeVar

CHECK_INTERVAL_SECONDS = 0.2

Result = TypeVar("Result")


def run_single_fit(job: Callable[[], Result], reporter, *, interval: float = CHECK_INTERVAL_SECONDS,
                   name: str = "model fit") -> Result:
    """Run ``job()`` on a daemon thread; call ``reporter.checkpoint()`` every
    ``interval`` seconds while it runs. Returns ``job()``'s result, re-raises
    its exception, and lets ``StopRequested`` from the checkpoint propagate
    at once (the thread is abandoned)."""
    outcome: dict = {}

    def target() -> None:
        try:
            outcome["value"] = job()
        except BaseException as error:  # noqa: BLE001 - handed back to the calling thread
            outcome["error"] = error

    thread = threading.Thread(target=target, name=f"cycle {name}", daemon=True)
    reporter.checkpoint()
    thread.start()
    while True:
        thread.join(interval)
        if not thread.is_alive():
            break
        reporter.checkpoint()
    if "error" in outcome:
        raise outcome["error"]
    return outcome.get("value")


class Stopwatch:
    """Seconds since construction (``perf_counter``), floored above zero so a
    rate never divides by zero."""

    def __init__(self) -> None:
        self.started = time.perf_counter()

    def seconds(self) -> float:
        return max(time.perf_counter() - self.started, 1e-9)


__all__ = ["CHECK_INTERVAL_SECONDS", "Stopwatch", "run_single_fit"]
