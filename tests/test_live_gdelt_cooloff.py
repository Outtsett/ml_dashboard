"""The live hub's GDELT worker backs off harder the longer GDELT refuses it.

GDELT throttles an address for longer than a fixed ten minutes, and every
probe during the throttle (five retries each) extends it, so a fixed cool-off
kept the hub refused all day and the history backfill never advanced.
"""

from __future__ import annotations

import time

from live.gdelt import GdeltWorker
from live.hub import SourceHealth


class _Hub:
    lander = None

    def __init__(self) -> None:
        self.health: dict[str, SourceHealth] = {}

    def source(self, name, kind, label, *, realtime=True, delay_seconds=None):
        return self.health.setdefault(name, SourceHealth(name, kind, label, realtime, delay_seconds))


def _worker(tmp_path, **config) -> GdeltWorker:
    return GdeltWorker(_Hub(), pipeline=None, config={"cooloffSeconds": 600, **config}, spool=tmp_path)


def _wait(worker: GdeltWorker) -> float:
    return worker.cooloff_until - time.time()


def test_each_refusal_in_a_row_doubles_the_wait_up_to_the_ceiling(tmp_path):
    worker = _worker(tmp_path, cooloffMaxSeconds=3600)
    waits = []
    for _ in range(5):
        worker._cool_off(worker.live, "refused")
        waits.append(round(_wait(worker) / 60))
    assert waits == [10, 20, 40, 60, 60]
    assert "5 in a row" in worker.live.note


def test_an_answered_request_resets_the_wait(tmp_path):
    worker = _worker(tmp_path)
    for _ in range(3):
        worker._cool_off(worker.backfill, "refused")
    worker._answered()
    worker._cool_off(worker.backfill, "refused")
    assert round(_wait(worker) / 60) == 10
