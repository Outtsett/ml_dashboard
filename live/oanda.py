"""OANDA v20: the pricing stream (real time) and an M1 candle backfill.

Stream: ``GET https://stream-fx{practice|trade}.oanda.com/v3/accounts/{id}/pricing/stream``
emits PRICE lines (~4 per second per active pair) and a HEARTBEAT every 5 s. A
stream that goes quiet for ``stallSeconds`` is torn down and reopened - a
half-open socket otherwise looks exactly like a quiet market.

Mid = (best bid + best ask) / 2 per tick; ``volume`` on a live bar is its tick
count (OANDA publishes no traded volume). Every stream line is appended to the
raw spool as received.
"""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timedelta, timezone

import aiohttp

from .bars import MinuteBars
from .config import secret

log = logging.getLogger("live.oanda")

HOSTS = {
    "practice": ("https://api-fxpractice.oanda.com", "https://stream-fxpractice.oanda.com"),
    "live": ("https://api-fxtrade.oanda.com", "https://stream-fxtrade.oanda.com"),
}


def instrument(pair: str) -> str:
    return f"{pair[:3]}_{pair[3:]}"


def pair_of(name: str) -> str:
    return name.replace("_", "")


def parse_time(value: str) -> float:
    """OANDA RFC 3339 with nanoseconds -> epoch seconds."""
    head, _, frac = value.rstrip("Z").partition(".")
    base = datetime.fromisoformat(head).replace(tzinfo=timezone.utc).timestamp()
    return base + (float("0." + frac) if frac else 0.0)


class Oanda:
    def __init__(self, hub, config: dict) -> None:
        self.hub = hub
        self.config = config
        self.pairs: list[str] = config["pairs"]
        env = (secret("OANDA_ENVIRONMENT") or "practice").lower()
        self.rest, self.stream_host = HOSTS["live" if env.startswith("live") else "practice"]
        self.token = secret("OANDA_API_KEY")
        self.account = secret("OANDA_ACCOUNT_ID")
        self.health = hub.source("oanda", "prices", f"OANDA pricing stream ({env})", realtime=True, delay_seconds=0)
        self.bars = MinuteBars("oanda")

    def _headers(self) -> dict:
        return {"Authorization": f"Bearer {self.token}", "Accept-Datetime-Format": "RFC3339"}

    async def run(self) -> None:
        if not (self.token and self.account):
            self.health.note = "OANDA_API_KEY / OANDA_ACCOUNT_ID are not set"
            return
        async with aiohttp.ClientSession(headers=self._headers()) as session:
            # History fills in beside the stream: waiting for 14 days x 18
            # pairs of candles before the first live tick left forex dark for
            # minutes after every restart.
            backfill = asyncio.create_task(self.backfill(session), name="oanda-backfill")
            backoff = 1.0
            while True:
                try:
                    await self._stream(session)
                    backoff = 1.0
                except asyncio.CancelledError:
                    raise
                except Exception as error:  # noqa: BLE001 - reconnect on anything
                    self.health.fail(error)
                    log.warning("oanda stream: %s", error)
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 60.0)
                if backfill.done() and backfill.exception() is not None:
                    self.health.fail(backfill.exception())

    async def _stream(self, session: aiohttp.ClientSession) -> None:
        url = f"{self.stream_host}/v3/accounts/{self.account}/pricing/stream"
        params = {"instruments": ",".join(instrument(p) for p in self.pairs)}
        stall = float(self.config.get("stallSeconds", 20))
        timeout = aiohttp.ClientTimeout(total=None, sock_read=stall)
        async with session.get(url, params=params, timeout=timeout) as response:
            if response.status != 200:
                raise RuntimeError(f"HTTP {response.status}: {(await response.text())[:200]}")
            self.health.connected = True
            async for raw in response.content:
                line = raw.strip()
                if not line:
                    continue
                if self.hub.lander is not None:
                    self.hub.lander.raw("oanda", "pricing-stream", line.decode("utf-8", "replace"))
                message = json.loads(line)
                kind = message.get("type")
                if kind == "HEARTBEAT":
                    self.health.ok(0)
                    continue
                if kind != "PRICE":
                    continue
                self._price(message)

    def _price(self, message: dict) -> None:
        pair = pair_of(message["instrument"])
        bids, asks = message.get("bids") or [], message.get("asks") or []
        if not bids or not asks:
            return
        bid, ask = float(bids[0]["price"]), float(asks[0]["price"])
        seconds = parse_time(message["time"])
        self.health.ok()
        self.hub.on_quote(pair, bid, ask, int(seconds * 1000), "oanda")
        for bar in self.bars.tick(pair, seconds, (bid + ask) / 2):
            self.hub.on_bar(pair, bar)

    async def backfill(self, session: aiohttp.ClientSession) -> None:
        """Closed M1 mid candles over the configured history, so the chart's
        live tail continues the lake instead of starting at today."""
        days = int(self.hub.config.get("barHistoryDays", 14))
        start = datetime.now(timezone.utc) - timedelta(days=days)
        for pair in self.pairs:
            cursor = start
            try:
                while cursor < datetime.now(timezone.utc) - timedelta(minutes=1):
                    url = f"{self.rest}/v3/instruments/{instrument(pair)}/candles"
                    params = {"granularity": "M1", "price": "M", "from": cursor.strftime("%Y-%m-%dT%H:%M:%SZ"),
                              "count": 5000}
                    async with session.get(url, params=params) as response:
                        text = await response.text()
                        if response.status != 200:
                            raise RuntimeError(f"HTTP {response.status}: {text[:200]}")
                    if self.hub.lander is not None:
                        self.hub.lander.raw("oanda", "candles-m1-mid", json.dumps(
                            {"pair": pair, "from": params["from"], "body": json.loads(text)}))
                    candles = json.loads(text).get("candles", [])
                    if not candles:
                        break
                    for candle in candles:
                        if not candle.get("complete"):
                            continue
                        mid = candle["mid"]
                        t = parse_time(candle["time"])
                        self.hub.on_bar(pair, {
                            "t": int(t // 60) * 60_000, "open": float(mid["o"]), "high": float(mid["h"]),
                            "low": float(mid["l"]), "close": float(mid["c"]), "volume": float(candle["volume"]),
                            "closed": True, "source": "oanda", "delaySeconds": 0.0, "backfill": True,
                        })
                    last = parse_time(candles[-1]["time"])
                    nxt = datetime.fromtimestamp(last + 60, tz=timezone.utc)
                    if nxt <= cursor:
                        break
                    cursor = nxt
                    await asyncio.sleep(0.05)
            except asyncio.CancelledError:
                raise
            except Exception as error:  # noqa: BLE001 - one pair's history must not stop the stream
                self.health.fail(error)
                log.warning("oanda backfill %s: %s", pair, error)
        self.health.extra["backfilledDays"] = days
