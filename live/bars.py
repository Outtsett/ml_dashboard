"""Ticks into 1-minute bars.

A bar is keyed by its OPEN (the minute the first tick fell in), like every bar
in the lake. The forming bar is published on every tick so the chart's last
candle moves; it is published once more with ``closed = True`` when the first
tick of a later minute arrives — never on a timer, because a quiet market must
not close a bar at a price nobody traded.
"""

from __future__ import annotations


class MinuteBars:
    def __init__(self, source: str) -> None:
        self.source = source
        self.forming: dict[str, dict] = {}

    def tick(self, symbol: str, utc_seconds: float, price: float, size: float = 1.0) -> list[dict]:
        """Returns the bars to publish: the previous bar closed (if this tick
        opened a new minute) and the forming one."""
        minute_ms = int(utc_seconds // 60) * 60_000
        out: list[dict] = []
        bar = self.forming.get(symbol)
        if bar is not None and minute_ms < bar["t"]:
            return out                      # a late tick for a closed minute: the bar is already final
        if bar is not None and minute_ms > bar["t"]:
            out.append({**bar, "closed": True})
            bar = None
        if bar is None:
            bar = {"t": minute_ms, "open": price, "high": price, "low": price, "close": price,
                   "volume": 0.0, "ticks": 0, "closed": False, "source": self.source, "delaySeconds": 0.0}
            self.forming[symbol] = bar
        bar["high"] = max(bar["high"], price)
        bar["low"] = min(bar["low"], price)
        bar["close"] = price
        bar["volume"] += size
        bar["ticks"] += 1
        out.append(dict(bar))
        return out
