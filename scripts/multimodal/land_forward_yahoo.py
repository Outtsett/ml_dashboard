"""Land the clean forward period: Yahoo's recent intraday history, write-once, before any model is frozen.

The lake's MNQ history ends 2025-12-30, so every bar after it is data no study
on this machine has seen. Yahoo keeps 60 days of 5-minute and 30 days of
1-minute history per futures ticker (1-minute requests are limited to 8 days
each), and drops the oldest day every day — so this runs now and again later
(the landing is idempotent: an identical response is a no-op, a different one
lands under its own received= stamp).

    s3://raw/vendor=yahoo/dataset=chart-history/received=<UTC date>/<ticker>_<interval>_<start>_<end>.json (+ .sha256)

Responses are raw Yahoo chart JSON; parsing happens at read time (multimodal.forward).
These bars are LOCKED like the holdout (multimodal.holdout): landing is not reading.

    .venv/Scripts/python.exe scripts/multimodal/land_forward_yahoo.py
"""

from __future__ import annotations

import json
import sys
import tempfile
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

from lake.layout import RAW
from lake.writer import land_raw

URL = "https://query1.finance.yahoo.com/v8/finance/chart/{ticker}"
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Accept": "application/json"}
# MNQ and the equity-index cross-asset set, plus rates, gold and the dollar.
TICKERS = ["MNQ=F", "NQ=F", "ES=F", "RTY=F", "YM=F", "ZN=F", "GC=F", "DX-Y.NYB"]


def fetch(ticker: str, params: dict) -> bytes:
    query = urllib.parse.urlencode(params)
    request = urllib.request.Request(f"{URL.format(ticker=urllib.parse.quote(ticker))}?{query}", headers=HEADERS)
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read()


def windows(now: datetime) -> list[tuple[str, dict]]:
    out: list[tuple[str, dict]] = [("5m", {"interval": "5m", "range": "60d", "includePrePost": "true"})]
    # 1-minute: the last 29 days in 7-day requests (Yahoo refuses more than 8 per request, 30 back).
    end = now
    oldest = now - timedelta(days=29)
    while end > oldest:
        start = max(oldest, end - timedelta(days=7))
        out.append(("1m", {"interval": "1m", "period1": int(start.timestamp()), "period2": int(end.timestamp()), "includePrePost": "true"}))
        end = start
    return out


def main() -> int:
    now = datetime.now(timezone.utc).replace(second=0, microsecond=0)
    received = now.strftime("%Y-%m-%d")
    landed = 0
    with tempfile.TemporaryDirectory() as scratch:
        for ticker in TICKERS:
            for interval, params in windows(now):
                try:
                    body = fetch(ticker, params)
                except Exception as error:  # noqa: BLE001 - one window's failure must not stop the rest
                    print(f"  {ticker} {interval} {params.get('period1', params.get('range'))}: FAILED {error}")
                    continue
                result = (json.loads(body).get("chart") or {}).get("result") or []
                stamps = (result[0].get("timestamp") if result else None) or []
                if not stamps:
                    print(f"  {ticker} {interval}: no bars")
                    continue
                first = datetime.fromtimestamp(stamps[0], tz=timezone.utc).strftime("%Y%m%dT%H%M")
                last = datetime.fromtimestamp(stamps[-1], tz=timezone.utc).strftime("%Y%m%dT%H%M")
                name = f"{ticker.replace('=', '_').replace('.', '_')}_{interval}_{first}_{last}.json"
                local = Path(scratch) / name
                local.write_bytes(body)
                dest = RAW / "vendor=yahoo" / "dataset=chart-history" / f"received={received}" / name
                outcome = land_raw(local, dest)
                landed += outcome["status"] == "landed"
                print(f"  {ticker} {interval}: {len(stamps):,} bars {first} to {last}: {outcome['status']}")
                time.sleep(0.5)
    print(f"landed {landed} new object(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
