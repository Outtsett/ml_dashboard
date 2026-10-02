"""python -m live --port 17192 — started and adopted by the dashboard's sidecar
supervisor (packages/config/sidecars.json); runs standalone the same way."""

from __future__ import annotations

import argparse
import asyncio
import logging
import os
import sys
from pathlib import Path

from aiohttp import web

from . import config as settings
from .alphavantage import AlphaVantage
from .app import build_app
from .feeds import Feeds
from .gdelt import GdeltWorker
from .hub import Hub
from .landing import Lander
from .news import NewsPipeline, known_at
from .oanda import Oanda
from .scoring import Scorer
from .tape import TapeTailer
from .yahoo import Yahoo

log = logging.getLogger("live")


def restore_today(hub: Hub, pipeline: NewsPipeline, lander: Lander) -> int:
    """Rebuild the news list and the dedup memory from today's spool, so a
    restart neither re-stamps nor re-announces what was already seen."""
    scores = {r["article_id"]: r for r in lander.today("news_sentiment")}
    articles: dict[str, dict] = {}
    for row in lander.today("news_articles"):
        seen = row["seen_ts"].timestamp()
        entry = articles.setdefault(row["article_id"], {"row": row, "tags": set(), "routes": {}})
        entry["tags"].add(row["query_tag"])
        if row["root"] != "UNROUTED":
            route = entry["routes"].setdefault(row["root"], {"root": row["root"], "direction": row.get("direction") or 1,
                                                             "relevance": row["relevance"], "tier": row["tier"]})
            if row["relevance"] > route["relevance"]:
                route.update(direction=row.get("direction") or 1, relevance=row["relevance"], tier=row["tier"])
        pipeline.remember(row["article_id"], row["vendor"], seen, {row["query_tag"]})
    restored = []
    for article_id, entry in articles.items():
        score = scores.get(article_id)
        if score is None:
            continue
        row = entry["row"]
        seen = row["seen_ts"].timestamp()
        restored.append({
            "articleId": article_id, "title": row["title"], "url": row["url"], "domain": row["domain"],
            "vendor": row["vendor"], "source": row["query_tag"], "seenTs": int(seen * 1000),
            "knownTs": int(known_at(row["vendor"], seen) * 1000),
            "publishedTs": int(row["published_ts"].timestamp() * 1000) if row.get("published_ts") else None,
            "routes": sorted(entry["routes"].values(), key=lambda e: -e["relevance"]),
            "tags": sorted(entry["tags"]), "score": score["score"], "label": score["label"],
            "pPositive": score["p_positive"], "pNegative": score["p_negative"], "pNeutral": score["p_neutral"],
            "confidence": score["confidence"],
        })
    restored.sort(key=lambda a: a["seenTs"])
    hub.on_scored(restored)
    return len(restored)


def lock_spool(spool: Path):
    """Hold ``<spool>/hub.lock`` for the life of the process, or return None when
    another hub already holds it. Two hubs on one spool would each spend the
    Alpha Vantage budget, walk the GDELT cursor and rewrite the same day files."""
    handle = (spool / "hub.lock").open("a+b")
    try:
        if os.name == "nt":
            import msvcrt

            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl

            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        handle.close()
        return None
    return handle


async def _step(lander: Lander, name: str, fn) -> None:
    """One landing step; an error is recorded and retried at the next tick —
    it must never end the loop, or nothing lands for the rest of the process."""
    try:
        await asyncio.to_thread(fn)
    except Exception as error:  # noqa: BLE001
        lander.counters["lastError"] = f"{name}: {type(error).__name__}: {error}"
        log.exception("landing step %s failed; retried at the next tick", name)


async def periodic(hub: Hub, lander: Lander, config: dict) -> None:
    spool_every = float(config.get("spoolFlushSeconds", 300))
    last_spool = 0.0
    loop = asyncio.get_running_loop()
    while True:
        await asyncio.sleep(30)
        await _step(lander, "flush_raw", lander.flush_raw)
        if loop.time() - last_spool >= spool_every:
            last_spool = loop.time()
            await _step(lander, "flush_spool", lander.flush_spool)


async def until_fatal(tasks: list[asyncio.Task]) -> set[asyncio.Task]:
    """Wait until a task raises or the landing loop ("periodic") ends; a task
    that returns normally is a source running degraded and is let go. Returns
    the tasks still running."""
    pending = set(tasks)
    while pending:
        done, pending = await asyncio.wait(pending, return_when=asyncio.FIRST_COMPLETED)
        for task in done:
            error = None if task.cancelled() else task.exception()
            if error is not None or task.get_name() == "periodic":
                log.error("task %s ended: %r", task.get_name(), error)
                return pending
            log.info("source %s stopped without error (disabled or unconfigured)", task.get_name())
    return pending


async def main(port: int) -> None:
    config = settings.load()
    spool = settings.spool_dir(config)
    spool_lock = lock_spool(spool)
    if spool_lock is None:
        log.error("another live hub holds %s; not starting a second one on it", spool / "hub.lock")
        raise SystemExit(3)
    hub = Hub(config)
    hub.loop = asyncio.get_running_loop()
    lander = Lander(hub, config, spool)
    hub.lander = lander

    app = build_app(hub)
    runner = web.AppRunner(app)
    await runner.setup()
    await web.TCPSite(runner, "127.0.0.1", port).start()
    log.info("live hub listening on 127.0.0.1:%d", port)

    await asyncio.to_thread(lander.recover)
    scorer = Scorer(hub, config.get("finbert", {}))
    hub.scorer = scorer
    scorer.start()
    pipeline = NewsPipeline(hub, scorer)
    log.info("restored %d scored headlines from today's spool", restore_today(hub, pipeline, lander))

    tasks = [asyncio.create_task(periodic(hub, lander, config), name="periodic")]
    if config.get("oanda", {}).get("enabled", True):
        tasks.append(asyncio.create_task(Oanda(hub, config["oanda"]).run(), name="oanda"))
    if config.get("yahoo", {}).get("enabled", True):
        tasks.append(asyncio.create_task(Yahoo(hub, config["yahoo"]).run(), name="yahoo"))
    if config.get("tape", {}).get("enabled", True):
        tasks.append(asyncio.create_task(TapeTailer(hub, config["tape"]).run(), name="tape"))
    if config.get("feeds"):
        tasks.append(asyncio.create_task(Feeds(hub, pipeline, config["feeds"]).run(), name="feeds"))
    if config.get("alphavantage", {}).get("enabled", True):
        tasks.append(asyncio.create_task(AlphaVantage(hub, pipeline, config["alphavantage"], spool).run(),
                                         name="alphavantage"))
    if config.get("gdelt", {}).get("enabled", True):
        GdeltWorker(hub, pipeline, config["gdelt"], spool).start()

    # A source task that RETURNS is a supported degraded mode (no credential:
    # it set a health note and stopped). One that RAISES, or the landing loop
    # ending, is not: save what is buffered and exit, so the dashboard's
    # supervisor restarts the whole hub rather than leaving it half alive
    # (still streaming, no longer landing).
    pending = await until_fatal(tasks)
    for task in pending:
        task.cancel()
    await asyncio.gather(*pending, return_exceptions=True)
    await _step(lander, "flush_raw", lambda: lander.flush_raw(force=True))
    await _step(lander, "flush_spool", lander.flush_spool)
    spool_lock.close()
    raise SystemExit(1)


def cli() -> None:
    parser = argparse.ArgumentParser(prog="python -m live", description=__doc__)
    parser.add_argument("--port", type=int, default=17192)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, stream=sys.stderr,
                        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s", datefmt="%H:%M:%S")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    asyncio.run(main(args.port))


if __name__ == "__main__":
    cli()
