"""Yahoo chart API: 1-minute bars for the futures roots and the dollar index.

``GET https://query1.finance.yahoo.com/v8/finance/chart/<T>?interval=1m&range=1d``
returns the continuous front contract (``ES=F`` is CME's E-mini, ``ZN=F`` CBOT's
10-year, ``GC=F`` COMEX gold) about ten minutes behind the exchange. That delay
is measured on every poll (now minus the newest bar's open) and travels on
every bar and quote as ``delaySeconds``: a delayed feed that looks live is worse
than no feed.

The first poll asks for ``range=7d`` (Yahoo's limit at 1-minute resolution) so
the chart's tail reaches back past the lake's last bar; later polls take
``range=1d``. The newest bar of each response is still forming.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time

import aiohttp

log = logging.getLogger("live.yahoo")

URL = "https://query1.finance.yahoo.com/v8/finance/chart/{ticker}"
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Accept": "application/json"}


class Yahoo:
    def __init__(self, hub, config: dict) -> None:
        self.hub = hub
        self.symbols: dict[str, str] = config["symbols"]
        self.poll = float(config.get("pollSeconds", 60))
        self.health = hub.source("yahoo", "prices", "Yahoo futures (delayed ~10 min)", realtime=False)
        self.primed: set[str] = set()
        self.last_open: dict[str, int] = {}

    async def run(self) -> None:
        async with aiohttp.ClientSession(headers=HEADERS, timeout=aiohttp.ClientTimeout(total=20)) as session:
            while True:
                started = time.monotonic()
                delays: list[float] = []
                for symbol, ticker in self.symbols.items():
                    try:
                        delay = await self._poll(session, symbol, ticker)
                        if delay is not None:
                            delays.append(delay)
                    except asyncio.CancelledError:
                        raise
                    except Exception as error:  # noqa: BLE001 - one symbol must not stop the rest
                        self.health.fail(f"{symbol}: {error}")
                        log.warning("yahoo %s: %s", symbol, error)
                    await asyncio.sleep(0.25)
                if delays:
                    self.health.delay_seconds = round(sorted(delays)[len(delays) // 2], 1)
                await asyncio.sleep(max(1.0, self.poll - (time.monotonic() - started)))

    async def _poll(self, session: aiohttp.ClientSession, symbol: str, ticker: str) -> float | None:
        first = symbol not in self.primed
        params = {"interval": "1m", "range": "7d" if first else "1d", "includePrePost": "true"}
        async with session.get(URL.format(ticker=ticker), params=params) as response:
            text = await response.text()
            if response.status != 200:
                raise RuntimeError(f"HTTP {response.status}: {text[:160]}")
        received = time.time()
        if self.hub.lander is not None:
            self.hub.lander.raw("yahoo", "chart-1m", json.dumps({"symbol": symbol, "ticker": ticker,
                                                                 "received": received, "body": json.loads(text)}))
        result = (json.loads(text).get("chart") or {}).get("result") or []
        if not result:
            raise RuntimeError("empty chart result")
        result = result[0]
        stamps = result.get("timestamp") or []
        quote = ((result.get("indicators") or {}).get("quote") or [{}])[0]
        if not stamps:
            return None
        newest_open = stamps[-1]
        delay = max(0.0, received - newest_open - 60.0)
        rows = list(zip(stamps, quote.get("open", []), quote.get("high", []), quote.get("low", []),
                        quote.get("close", []), quote.get("volume", []), strict=False))
        # Each poll returns the whole day; only the bar that was forming last
        # time and anything newer is news. Everything before is already final.
        since = self.last_open.get(symbol, 0)
        for index, (t, o, h, low, c, v) in enumerate(rows):
            if None in (o, h, low, c) or int(t) < since:
                continue
            forming = index == len(rows) - 1
            self.hub.on_bar(symbol, {
                "t": int(t) * 1000, "open": float(o), "high": float(h), "low": float(low), "close": float(c),
                "volume": float(v or 0.0), "closed": not forming, "source": "yahoo",
                "delaySeconds": round(delay, 1), "backfill": first and not forming,
            })
        last = rows[-1]
        if last[4] is not None:
            self.hub.on_quote(symbol, None, None, int(newest_open * 1000), "yahoo", last=float(last[4]),
                              delay_seconds=round(delay, 1))
        self.last_open[symbol] = int(newest_open)
        self.primed.add(symbol)
        if self.primed >= set(self.symbols):
            self.hub.backfills["yahoo"] = True
        self.health.ok()
        return delay
