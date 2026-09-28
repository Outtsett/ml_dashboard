"""RSS / Atom news feeds, polled with conditional GETs.

Each feed is polled on its own interval with ``If-None-Match`` /
``If-Modified-Since``; a 304 costs nothing and lands nothing. A body that
changed lands in the raw spool as fetched (gzip-compressed at landing). Items
are parsed with feedparser, which normalises every ``pubDate`` to UTC — the ECB
publishes in CET/CEST and BLS in US Eastern, and a naive parse would move their
releases by hours. The parsed ``pubDate`` is kept as ``published_ts`` only;
``seen_ts`` is the poll that first returned the item.
"""

from __future__ import annotations

import asyncio
import calendar
import json
import logging
import time
from datetime import datetime, timezone

import aiohttp
import feedparser

log = logging.getLogger("live.feeds")

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) ml-dashboard-live/1.0",
    "Accept": "application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.8",
}


def published_of(entry) -> datetime | None:
    parsed = entry.get("published_parsed") or entry.get("updated_parsed")
    if not parsed:
        return None
    return datetime.fromtimestamp(calendar.timegm(parsed), tz=timezone.utc)


class Feed:
    def __init__(self, hub, pipeline, spec: dict) -> None:
        self.hub = hub
        self.pipeline = pipeline
        self.name = spec["name"]
        self.url = spec["url"]
        self.poll = float(spec.get("pollSeconds", 300))
        self.health = hub.source(f"rss:{self.name}", "news", spec.get("label", self.name))
        self.last_success: float | None = None
        self.etag: str | None = None
        self.modified: str | None = None

    async def run(self, session: aiohttp.ClientSession) -> None:
        while True:
            try:
                await self._poll(session)
            except asyncio.CancelledError:
                raise
            except Exception as error:  # noqa: BLE001 - a feed outage must not stop the others
                self.health.fail(error)
                log.warning("feed %s: %s", self.name, error)
            await asyncio.sleep(self.poll)

    async def _poll(self, session: aiohttp.ClientSession) -> None:
        headers = {}
        if self.etag:
            headers["If-None-Match"] = self.etag
        if self.modified:
            headers["If-Modified-Since"] = self.modified
        async with session.get(self.url, headers=headers, allow_redirects=True) as response:
            received = time.time()
            if response.status == 304:
                self._covered(received, 0)
                self.health.ok(0)
                self.health.extra["lastPollAt"] = received
                return
            body = await response.read()
            if response.status != 200:
                raise RuntimeError(f"HTTP {response.status}")
            self.etag = response.headers.get("ETag")
            self.modified = response.headers.get("Last-Modified")
        parsed = feedparser.parse(body)
        new = 0
        for entry in parsed.entries:
            if self.pipeline.headline(
                vendor="rss", source=self.name, title=entry.get("title", ""), url=entry.get("link", ""),
                seen=received, published=published_of(entry), language=parsed.feed.get("language"),
            ):
                new += 1
        if new and self.hub.lander is not None:
            self.hub.lander.raw("rss", self.name, json.dumps({
                "url": self.url, "received": received, "etag": self.etag, "modified": self.modified,
                "body": body.decode("utf-8", "replace"),
            }))
        self._covered(received, new)
        self.health.ok(new)
        self.health.extra.update(lastPollAt=received, items=len(parsed.entries), newItems=new)

    def _covered(self, received: float, new: int) -> None:
        """This poll saw everything the feed published since the previous
        successful poll: that span was collected."""
        # A feed lists only its latest items: after an outage longer than a few
        # polls, items published early in it may have scrolled off unseen.
        start = max(self.last_success or 0.0, received - 3 * self.poll)
        self.last_success = received
        if self.hub.lander is not None:
            self.hub.lander.coverage("rss", self.name, datetime.fromtimestamp(start, tz=timezone.utc),
                                     datetime.fromtimestamp(received, tz=timezone.utc), "live", new)


class Feeds:
    def __init__(self, hub, pipeline, specs: list[dict]) -> None:
        self.feeds = [Feed(hub, pipeline, spec) for spec in specs]

    async def run(self) -> None:
        timeout = aiohttp.ClientTimeout(total=30)
        async with aiohttp.ClientSession(headers=HEADERS, timeout=timeout) as session:
            await asyncio.gather(*(feed.run(session) for feed in self.feeds))
