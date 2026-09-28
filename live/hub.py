"""Hub state: quotes, 1-minute bars, scored news, source health, and the
server-sent-event broker every browser tab subscribes to.

Everything here runs on the asyncio loop. Worker threads (FinBERT, GDELT,
landing) hand results back with ``Hub.call_soon`` so this state is never
touched from two threads.
"""

from __future__ import annotations

import asyncio
import os
import time
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

PACIFIC = ZoneInfo("America/Los_Angeles")

FOREX = frozenset({
    "AUDJPY", "AUDUSD", "CADJPY", "CHFJPY", "EURAUD", "EURCHF", "EURGBP", "EURJPY", "EURUSD",
    "GBPAUD", "GBPCHF", "GBPJPY", "GBPUSD", "NZDJPY", "NZDUSD", "USDCAD", "USDCHF", "USDJPY",
})


def asset_class(symbol: str) -> str:
    if symbol in FOREX:
        return "forex"
    if symbol == "DXY":
        return "index"
    return "futures"


def chart_ms(utc_ms: int, klass: str) -> int:
    """The timestamp the dashboard's chart uses for this bar. The chart reads the
    2026-09-09 snapshot, which stamps futures in Pacific wall-clock digits stored
    as UTC; a live futures bar spliced onto it must be stamped the same way or it
    lands 7-8 hours away from the history it continues."""
    if klass != "futures":
        return utc_ms
    local = datetime.fromtimestamp(utc_ms / 1000, tz=timezone.utc).astimezone(PACIFIC)
    return int(local.replace(tzinfo=timezone.utc).timestamp() * 1000)


@dataclass
class SourceHealth:
    name: str
    kind: str                 # prices | news
    label: str
    realtime: bool = True
    delay_seconds: float | None = None
    connected: bool = False
    last_message_at: float | None = None
    messages: int = 0
    errors: int = 0
    last_error: str | None = None
    note: str | None = None
    extra: dict = field(default_factory=dict)

    def ok(self, count: int = 1) -> None:
        self.connected = True
        self.last_message_at = time.time()
        self.messages += count

    def fail(self, error: BaseException | str) -> None:
        self.errors += 1
        self.last_error = f"{type(error).__name__}: {error}" if isinstance(error, BaseException) else str(error)
        self.connected = False

    def as_dict(self) -> dict:
        age = None if self.last_message_at is None else round(time.time() - self.last_message_at, 1)
        return {
            "name": self.name, "kind": self.kind, "label": self.label, "realtime": self.realtime,
            "delaySeconds": self.delay_seconds, "connected": self.connected,
            "lastMessageAgeSeconds": age, "messages": self.messages, "errors": self.errors,
            "lastError": self.last_error, "note": self.note, **self.extra,
        }


class Broker:
    """Fan-out to SSE subscribers. A slow tab loses its oldest events rather
    than holding memory or the loop."""

    def __init__(self) -> None:
        self.subscribers: set[asyncio.Queue] = set()
        self.sequence = 0

    def subscribe(self, maxsize: int = 2000) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue(maxsize=maxsize)
        self.subscribers.add(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue) -> None:
        self.subscribers.discard(queue)

    def publish(self, kind: str, payload: dict) -> None:
        self.sequence += 1
        event = (self.sequence, kind, payload)
        for queue in list(self.subscribers):
            if queue.full():
                try:
                    queue.get_nowait()
                except asyncio.QueueEmpty:
                    pass
            queue.put_nowait(event)


class Hub:
    def __init__(self, config: dict) -> None:
        self.config = config
        self.started_at = datetime.now(timezone.utc).isoformat()
        self.pid = os.getpid()
        self.loop: asyncio.AbstractEventLoop | None = None
        self.broker = Broker()
        self.health: dict[str, SourceHealth] = {}
        self.quotes: dict[str, dict] = {}
        history = int(config.get("barHistoryDays", 14)) * 1440 + 60
        self._bar_capacity = history
        self.bars: dict[str, dict[int, dict]] = {}          # symbol -> open ms -> bar
        self.bar_order: dict[str, deque[int]] = {}
        self.best_source: dict[str, tuple[int, float]] = {}
        self._last_frame: dict[str, float] = {}
        self.news: deque[dict] = deque(maxlen=5000)
        self.news_by_id: dict[str, dict] = {}
        self.lander = None                                   # set by the app
        self.scorer = None
        # Startup backfills still running, by source: past bar dates are not
        # landed until every one has finished (live/landing.py).
        self.backfills: dict[str, bool] = {}

    # ── plumbing ──────────────────────────────────────────────────────────

    def call_soon(self, fn, *args) -> None:
        """Run ``fn`` on the loop from any thread."""
        assert self.loop is not None
        self.loop.call_soon_threadsafe(fn, *args)

    def source(self, name: str, kind: str, label: str, *, realtime: bool = True,
               delay_seconds: float | None = None) -> SourceHealth:
        if name not in self.health:
            self.health[name] = SourceHealth(name, kind, label, realtime, delay_seconds)
        return self.health[name]

    # ── prices ────────────────────────────────────────────────────────────

    def on_quote(self, symbol: str, bid: float | None, ask: float | None, utc_ms: int, source: str,
                 *, last: float | None = None, delay_seconds: float = 0.0) -> None:
        if self._outranked(symbol, source):
            return
        mid = (bid + ask) / 2 if bid is not None and ask is not None else last
        quote = {
            "symbol": symbol, "assetClass": asset_class(symbol), "bid": bid, "ask": ask, "last": last,
            "mid": mid, "time": utc_ms, "source": source, "delaySeconds": delay_seconds,
            "spread": (ask - bid) if bid is not None and ask is not None else None,
        }
        self.quotes[symbol] = quote
        self.broker.publish("quote", quote)

    # A real-time source seen within PRECEDENCE_SECONDS silences a slower one
    # for the same symbol: while Quantower records MNQ, Yahoo's delayed MNQ
    # would otherwise overwrite live candles with ten-minute-old ones.
    RANK = {"quantower": 3, "oanda": 2, "yahoo": 1}
    PRECEDENCE_SECONDS = 180

    def _outranked(self, symbol: str, source: str) -> bool:
        rank = self.RANK.get(source, 0)
        now = time.time()
        best = self.best_source.get(symbol)
        if best is not None and best[0] > rank and now - best[1] <= self.PRECEDENCE_SECONDS:
            return True
        self.best_source[symbol] = (rank, now)
        return False

    def on_bar(self, symbol: str, bar: dict) -> None:
        """``bar``: {t (open, UTC ms), open, high, low, close, volume, closed,
        source, delaySeconds}. A later frame for the same minute replaces it."""
        if not bar.get("backfill") and self._outranked(symbol, bar["source"]):
            return
        klass = asset_class(symbol)
        record = {"symbol": symbol, "assetClass": klass, "timeframe": "1m",
                  "tChart": chart_ms(int(bar["t"]), klass), **bar}
        by_time = self.bars.setdefault(symbol, {})
        # Precedence lapses after PRECEDENCE_SECONDS, but a minute a better
        # source already built stays its: Yahoo runs ~9 minutes behind, so once
        # Quantower goes quiet Yahoo's next poll re-delivers minutes Quantower
        # recorded in real time.
        held = by_time.get(record["t"])
        if held is not None and self.RANK.get(held["source"], 0) > self.RANK.get(record["source"], 0):
            return
        order = self.bar_order.setdefault(symbol, deque())
        if record["t"] not in by_time:
            order.append(record["t"])
            while len(order) > self._bar_capacity:
                by_time.pop(order.popleft(), None)
        by_time[record["t"]] = record
        # A forming bar changes on every tick (OANDA: ~4 a second per pair);
        # the chart needs at most two frames a second of it.
        if not record.get("closed") and not record.get("backfill"):
            now = time.monotonic()
            if now - self._last_frame.get(symbol, 0.0) < 0.5:
                return
            self._last_frame[symbol] = now
        if not record.get("backfill"):
            # A startup backfill is history the page fetches with /bars; pushing
            # hundreds of thousands of bars down every open stream would stall it.
            self.broker.publish("bar", record)
        if record.get("closed") and self.lander is not None:
            self.lander.bar(record)

    def bars_since(self, symbol: str, since_ms: int = 0, limit: int = 20_000) -> list[dict]:
        by_time = self.bars.get(symbol, {})
        times = sorted(t for t in by_time if t >= since_ms)[-limit:]
        return [by_time[t] for t in times]

    # ── news ──────────────────────────────────────────────────────────────

    def on_scored(self, articles: list[dict]) -> None:
        for article in articles:
            if article["articleId"] in self.news_by_id:
                continue
            self.news_by_id[article["articleId"]] = article
            self.news.appendleft(article)
            self.broker.publish("news", article)
        while len(self.news_by_id) > self.news.maxlen:
            live = {a["articleId"] for a in self.news}
            for key in [k for k in self.news_by_id if k not in live]:
                del self.news_by_id[key]

    def status(self) -> dict:
        return {
            "status": "ok", "sidecar": "live", "pid": self.pid, "startedAt": self.started_at,
            "sources": [h.as_dict() for h in sorted(self.health.values(), key=lambda h: (h.kind, h.name))],
            "quotes": len(self.quotes), "barSymbols": len(self.bars), "news": len(self.news),
            "subscribers": len(self.broker.subscribers),
            "landing": self.lander.status() if self.lander is not None else None,
            "scoring": self.scorer.status() if self.scorer is not None else None,
        }
