"""Alpha Vantage NEWS_SENTIMENT under the free key's 25-requests-a-day budget.

The budget is spent evenly: one call every 86 400 / 25 s (about 58 minutes),
rotating through ``rotation`` (topics and FOREX tickers) so each theme is
refreshed several times a day. The ledger — calls made per UTC day, where the
rotation stands, the last item time per rotation key — lives in the spool, so a
restart neither re-spends nor forgets the day's budget. A response carrying
"Information" or "Note" is Alpha Vantage refusing (limit reached): it counts
against the budget and pauses the source until the next UTC day.

Alpha Vantage attaches its own sentiment; it is kept in raw only. Every item is
scored by FinBERT like every other headline, so one model produces every score.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import aiohttp

from .config import secret

log = logging.getLogger("live.alphavantage")

URL = "https://www.alphavantage.co/query"


def rotation_key(spec: dict) -> str:
    return ",".join(f"{k}={v}" for k, v in sorted(spec.items()))


class AlphaVantage:
    def __init__(self, hub, pipeline, config: dict, spool: Path) -> None:
        self.hub = hub
        self.pipeline = pipeline
        self.config = config
        self.key = secret(config.get("keyEnv", "ALPHA_VANTAGE_API_KEY"))
        self.budget = int(config.get("dailyBudget", 25))
        self.rotation: list[dict] = config["rotation"]
        self.ledger_path = spool / "alphavantage.json"
        self.ledger = self._load()
        self.health = hub.source("alphavantage", "news", "Alpha Vantage NEWS_SENTIMENT (free tier)")
        # A call lands about once an hour, so a restarted hub would read as
        # disconnected for up to an hour: the last answered call is restored
        # from the ledger instead.
        last = self.ledger.get("lastAnswered")
        if last and not self.ledger.get("pausedUntil"):
            self.health.connected = True
            self.health.last_message_at = float(last["at"])
            self.health.extra.update(lastCall=last["call"], lastItems=last["items"], lastNew=last["new"])

    def _load(self) -> dict:
        try:
            return json.loads(self.ledger_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {"days": {}, "rotationIndex": 0, "lastSeen": {}, "pausedUntil": None}

    def _save(self) -> None:
        self.ledger_path.write_text(json.dumps(self.ledger, indent=1), encoding="utf-8")

    def _used_today(self) -> int:
        return int(self.ledger["days"].get(datetime.now(timezone.utc).strftime("%Y-%m-%d"), 0))

    def status(self) -> dict:
        spacing = 86_400 / max(self.budget, 1)
        next_call = float(self.ledger.get("lastCallAt") or 0) + spacing
        return {"budget": self.budget, "usedToday": self._used_today(),
                "rotationIndex": self.ledger["rotationIndex"], "pausedUntil": self.ledger.get("pausedUntil"),
                "nextCallAt": self.ledger.get("pausedUntil") or next_call}

    async def run(self) -> None:
        if not self.key:
            self.health.note = "ALPHA_VANTAGE_API_KEY is not set"
            return
        spacing = 86_400 / max(self.budget, 1)
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=60)) as session:
            while True:
                self.health.extra.update(self.status())
                paused = self.ledger.get("pausedUntil")
                if paused and time.time() < paused:
                    await asyncio.sleep(min(600, paused - time.time()))
                    continue
                if self._used_today() >= self.budget:
                    tomorrow = (datetime.now(timezone.utc) + timedelta(days=1)).replace(
                        hour=0, minute=1, second=0, microsecond=0)
                    await asyncio.sleep(max(60.0, (tomorrow - datetime.now(timezone.utc)).total_seconds()))
                    continue
                # The spacing is measured from the last call recorded in the
                # ledger, so a restart does not spend a call on the spot.
                wait = float(self.ledger.get("lastCallAt") or 0) + spacing - time.time()
                if wait > 0:
                    await asyncio.sleep(min(wait, 600.0))
                    continue
                try:
                    await self._call(session)
                except asyncio.CancelledError:
                    raise
                except Exception as error:  # noqa: BLE001
                    self.health.fail(error)
                    log.warning("alphavantage: %s", error)

    async def _call(self, session: aiohttp.ClientSession) -> None:
        spec = self.rotation[self.ledger["rotationIndex"] % len(self.rotation)]
        key = rotation_key(spec)
        since = self.ledger["lastSeen"].get(key)
        start = (datetime.fromisoformat(since) if since else datetime.now(timezone.utc) - timedelta(days=1))
        params = {"function": "NEWS_SENTIMENT", "apikey": self.key, "sort": "LATEST",
                  "limit": str(self.config.get("limitPerCall", 1000)),
                  "time_from": start.strftime("%Y%m%dT%H%M"), **spec}
        day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        self.ledger["days"][day] = self._used_today() + 1
        self.ledger["rotationIndex"] = (self.ledger["rotationIndex"] + 1) % len(self.rotation)
        self.ledger["lastCallAt"] = time.time()
        self._save()
        async with session.get(URL, params=params) as response:
            text = await response.text()
        received = time.time()
        body = json.loads(text)
        if self.hub.lander is not None:
            safe = {k: v for k, v in params.items() if k != "apikey"}
            self.hub.lander.raw("alphavantage", "news-sentiment", json.dumps(
                {"params": safe, "received": received, "body": body}))
        if "Information" in body or "Note" in body:
            message = body.get("Information") or body.get("Note")
            self.health.fail(f"refused: {str(message)[:160]}")
            tomorrow = (datetime.now(timezone.utc) + timedelta(days=1)).replace(hour=0, minute=1, second=0)
            self.ledger["pausedUntil"] = tomorrow.timestamp()
            self._save()
            return
        feed = body.get("feed") or []
        new, newest = 0, start
        for item in feed:
            published = None
            if item.get("time_published"):
                # YYYYMMDDTHHMMSS. Kept for diagnosis only; never aligned to bars.
                published = datetime.strptime(item["time_published"], "%Y%m%dT%H%M%S").replace(tzinfo=timezone.utc)
                newest = max(newest, published)
            if self.pipeline.headline(vendor="alphavantage", source=key, title=item.get("title", ""),
                                      url=item.get("url", ""), seen=received, published=published):
                new += 1
        if self.hub.lander is not None:
            self.hub.lander.coverage("alphavantage", key, start, datetime.fromtimestamp(received, tz=timezone.utc),
                                     "live", len(feed))
        self.ledger["lastSeen"][key] = newest.isoformat()
        self.ledger["lastAnswered"] = {"at": received, "call": key, "items": len(feed), "new": new}
        self._save()
        self.health.ok(new)
        self.health.extra.update(self.status(), lastCall=key, lastItems=len(feed), lastNew=new)
