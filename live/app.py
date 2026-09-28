"""The hub's HTTP surface on 127.0.0.1:<port>, proxied by the dashboard at /api/live.

    GET /health                      {status, sidecar: "live", pid, startedAt}
    GET /status                      every source's health, landing and scoring counters
    GET /quotes                      the latest quote per symbol
    GET /bars?symbol=&since=&limit=  1-minute bars (true-UTC ``t``, chart-stamped ``tChart``)
    GET /news?limit=&root=           scored headlines, newest first (optionally routed to ``root``)
    GET /sentiment?roots=&hours=&step=  the FinBERT family on a grid for each root, from the
                                     hub's scored headlines — the same computation models get
    GET /stream?kinds=&symbols=      server-sent events: quote, bar, news, status
"""

from __future__ import annotations

import asyncio
import json
import time

import numpy as np
from aiohttp import web
from lake import sentiment


def _json(data, status: int = 200) -> web.Response:
    return web.json_response(data, status=status, dumps=lambda o: json.dumps(o, default=str))


def build_app(hub) -> web.Application:
    app = web.Application()

    async def health(_request):
        return _json({"status": "ok", "sidecar": "live", "pid": hub.pid, "startedAt": hub.started_at})

    async def status(_request):
        return _json(hub.status())

    async def quotes(_request):
        return _json({"quotes": sorted(hub.quotes.values(), key=lambda q: (q["assetClass"], q["symbol"]))})

    async def bars(request):
        symbol = request.query.get("symbol", "").upper()
        if not symbol:
            return _json({"error": "symbol is required"}, 400)
        since = int(request.query.get("since", 0) or 0)
        limit = min(int(request.query.get("limit", 20_000) or 20_000), 50_000)
        return _json({"symbol": symbol, "bars": hub.bars_since(symbol, since, limit)})

    async def news(request):
        limit = min(int(request.query.get("limit", 200) or 200), 2000)
        root = request.query.get("root", "").upper()
        items = [a for a in hub.news if not root or any(r["root"] == root for r in a["routes"])]
        return _json({"news": items[:limit]})

    async def sentiment_grid(request):
        roots = [r.strip().upper() for r in request.query.get("roots", "").split(",") if r.strip()]
        hours = min(float(request.query.get("hours", 24) or 24), 24 * 7)
        step = max(float(request.query.get("step", 5) or 5), 1.0)
        now = time.time()
        grid = np.arange(now - hours * 3600, now + 1, step * 60.0)
        spans = hub.lander.coverage_spans() if hub.lander is not None else []
        out = {}
        for root in roots:
            rows = [
                {"article_id": a["articleId"], "vendor": a["vendor"], "tier": r["tier"],
                 "relevance": r["relevance"], "direction": r["direction"], "title": a["title"],
                 "seen_epoch": a["seenTs"] / 1000, "score": a["score"]}
                for a in hub.news for r in a["routes"] if r["root"] == root
            ]
            known, weight, score, macro = sentiment.collapse_rows(rows) if rows else (np.zeros(0),) * 4
            reach = [(a, b) for vendor, source, a, b in spans if sentiment.source_reaches(vendor, source, root)]
            stream = sentiment.ArticleStream(known, weight, score, macro, sentiment.merge_spans(reach))
            matrix = sentiment.compute_from_stream(grid, stream, step)
            out[root] = {
                "t": (grid * 1000).astype(np.int64).tolist(),
                "features": {name: matrix[:, i].round(5).tolist() for i, name in enumerate(sentiment.FEATURE_NAMES)},
                "articles": int(known.size),
            }
        return _json({"roots": out, "names": list(sentiment.FEATURE_NAMES),
                      "displayNames": sentiment.DISPLAY_NAMES, "stepMinutes": step})

    async def stream(request):
        kinds = {k for k in request.query.get("kinds", "quote,bar,news,status").split(",") if k}
        symbols = {s.upper() for s in request.query.get("symbols", "").split(",") if s}
        response = web.StreamResponse(headers={
            "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive", "X-Accel-Buffering": "no",
        })
        await response.prepare(request)
        await response.write(b"retry: 2000\n\n")
        queue = hub.broker.subscribe()
        last_status = 0.0
        try:
            while True:
                try:
                    sequence, kind, payload = await asyncio.wait_for(queue.get(), timeout=5.0)
                except asyncio.TimeoutError:
                    sequence, kind, payload = None, None, None
                if kind is not None and kind in kinds:
                    symbol = payload.get("symbol")
                    if not symbols or symbol is None or symbol in symbols:
                        data = json.dumps(payload, default=str)
                        await response.write(f"id: {sequence}\nevent: {kind}\ndata: {data}\n\n".encode())
                if "status" in kinds and time.time() - last_status >= 5.0:
                    last_status = time.time()
                    await response.write(f"event: status\ndata: {json.dumps(hub.status(), default=str)}\n\n".encode())
                elif kind is None:
                    await response.write(b": keepalive\n\n")
        except (ConnectionResetError, asyncio.CancelledError):
            pass
        finally:
            hub.broker.unsubscribe(queue)
        return response

    app.router.add_get("/health", health)
    app.router.add_get("/status", status)
    app.router.add_get("/quotes", quotes)
    app.router.add_get("/bars", bars)
    app.router.add_get("/news", news)
    app.router.add_get("/sentiment", sentiment_grid)
    app.router.add_get("/stream", stream)
    return app
