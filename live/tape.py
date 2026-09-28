"""Quantower DomFlow tapes, tailed while Quantower records — real-time CME.

DomFlow (Trading/quantower_strategies/DomFlow) writes ``.tape`` files under its
"Tape root" as ``<root>/vendor=quantower/dataset=<symbol>/schema=domflow-tape-v1/
received=<date>/*.tape``: comma lines ``K,seq,vendor_ticks,recv_ticks,...`` with
``T`` = a print (price, size at fields 4-5) and times in .NET UTC ticks. This
reads only the bytes appended since the last scan, keeps a partial trailing
line for the next pass, and turns prints into 1-minute bars under the contract's
root (MNQZ26 -> MNQ). The tapes are already in the raw layout; promoting them is
``scripts/promote_captures.py`` in the Quantower project, not this.

Nothing flows unless AMP Quantower is running with DomFlow added and its Tape
root set — this source reports that state instead of pretending.
"""

from __future__ import annotations

import asyncio
import logging
import re
import time
from pathlib import Path

from .bars import MinuteBars

log = logging.getLogger("live.tape")

TICKS_AT_UNIX_EPOCH = 621_355_968_000_000_000
CONTRACT = re.compile(r"^(?P<root>[A-Z0-9]+?)(?P<month>[FGHJKMNQUVXZ])(?P<year>\d{1,2})$")
ACTIVE_SECONDS = 15 * 60


def root_of(symbol: str) -> str:
    bare = symbol.split(".")[-1].strip().upper()
    match = CONTRACT.match(bare)
    return match.group("root") if match else bare


class TapeTailer:
    def __init__(self, hub, config: dict) -> None:
        self.hub = hub
        self.roots = [Path(r) for r in config.get("roots", [])]
        self.scan = float(config.get("scanSeconds", 5))
        self.health = hub.source("quantower", "prices", "Quantower DomFlow tape (AMP/CQG, real time)")
        self.offsets: dict[Path, int] = {}
        self.partial: dict[Path, bytes] = {}
        self.symbols: dict[Path, str] = {}
        self.bars = MinuteBars("quantower")

    async def run(self) -> None:
        while True:
            try:
                await asyncio.to_thread(self._scan)
            except Exception as error:  # noqa: BLE001
                self.health.fail(error)
                log.warning("tape: %s", error)
            await asyncio.sleep(self.scan)

    def _scan(self) -> None:
        present = [r for r in self.roots if r.exists()]
        if not present:
            self.health.connected = False
            self.health.note = (f"no capture root ({', '.join(map(str, self.roots))}): run DomFlow in AMP Quantower "
                                "with Tape root set to it")
            return
        now = time.time()
        active = [p for r in present for p in r.rglob("*.tape") if now - p.stat().st_mtime < ACTIVE_SECONDS]
        self.health.extra["activeTapes"] = len(active)
        if not active:
            self.health.connected = False
            self.health.note = "no tape written in the last 15 minutes — Quantower is not recording"
            return
        self.health.note = None
        for path in active:
            self._tail(path)

    def _tail(self, path: Path) -> None:
        size = path.stat().st_size
        if path not in self.offsets:
            # Start at the end: history is promote_captures' job; this is the live edge.
            self.offsets[path] = size
            self.symbols[path] = self._symbol(path)
            return
        start = self.offsets[path]
        if size <= start:
            return
        with path.open("rb") as handle:
            handle.seek(start)
            chunk = self.partial.pop(path, b"") + handle.read(size - start)
        self.offsets[path] = size
        lines = chunk.split(b"\n")
        if lines and lines[-1]:
            self.partial[path] = lines.pop()
        symbol = self.symbols.get(path) or self._symbol(path)
        root = root_of(symbol)
        prints = 0
        for line in lines:
            if not line.startswith(b"T,"):
                continue
            fields = line.split(b",")
            try:
                seconds = (int(fields[2]) - TICKS_AT_UNIX_EPOCH) / 10_000_000
                price, size_ = float(fields[4]), float(fields[5])
            except (IndexError, ValueError):
                continue
            prints += 1
            bars = self.bars.tick(root, seconds, price, size_)
            self.hub.call_soon(self._publish, root, bars, price, seconds)
        if prints:
            self.health.ok(prints)

    def _publish(self, root: str, bars: list[dict], price: float, seconds: float) -> None:
        self.hub.on_quote(root, None, None, int(seconds * 1000), "quantower", last=price)
        for bar in bars:
            self.hub.on_bar(root, bar)

    @staticmethod
    def _symbol(path: Path) -> str:
        for part in path.parts:
            if part.startswith("dataset="):
                return part.split("=", 1)[1]
        try:
            with path.open("rb") as handle:
                for raw in handle.read(4096).split(b"\n"):
                    text = raw.decode("utf-8", "replace")
                    if text.startswith("#symbol="):
                        return text.split("=", 1)[1].strip()
        except OSError:
            pass
        return path.stem.split("_")[0]
