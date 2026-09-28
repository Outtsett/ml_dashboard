"""GDELT DOC 2.0: a live sweep of every lake.news query, and a backfill that
walks the history backwards with the capacity the sweep leaves.

This process is the machine's only GDELT client, so one pacer
(``lake.gdelt.PACER``, 5 s between requests — faster earns a connection-level
block) governs every request: a separate backfill process running beside a
live sweep would trip it.

- **Sweep**: every ``sweepMinutes``, each GDELT rule over the last
  ``sweepLookbackMinutes`` (overlapping windows; articles already seen are
  not written twice). Rows go to today's spool; a coverage span is recorded per
  rule for the window it asked about.
- **Backfill**: 7-day windows, newest first, from the earliest window already
  swept back to ``backfillFrom``. Rows are buffered and written straight to the
  curated contract every ``backfillWriteDays`` of history (one write, so one
  file per partition instead of one per request), with a coverage span per
  (rule, window); the cursor is saved after each write, so a restart loses at
  most one batch of requests.
"""

from __future__ import annotations

import json
import logging
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pyarrow as pa

log = logging.getLogger("live.gdelt")


def floor_quarter(dt: datetime) -> datetime:
    return dt.replace(minute=dt.minute - dt.minute % 15, second=0, microsecond=0)


class GdeltWorker(threading.Thread):
    def __init__(self, hub, pipeline, config: dict, spool: Path) -> None:
        super().__init__(name="gdelt", daemon=True)
        self.hub = hub
        self.pipeline = pipeline
        self.config = config
        self.policy = config.get("sourcePolicy", "quality")
        self.sweep_every = float(config.get("sweepMinutes", 15)) * 60
        self.lookback = timedelta(minutes=float(config.get("sweepLookbackMinutes", 60)))
        self.window = timedelta(days=int(config.get("backfillWindowDays", 7)))
        self.write_span = timedelta(days=int(config.get("backfillWriteDays", 14)))
        self.floor = datetime.fromisoformat(config.get("backfillFrom", "2024-01-01")).replace(tzinfo=timezone.utc)
        self.cursor_path = spool / "gdelt_backfill.json"
        self.cursor = self._load()
        self.live = hub.source("gdelt", "news", "GDELT DOC 2.0 sweep (every 15 min)")
        self.backfill = hub.source("gdelt_backfill", "news", "GDELT history backfill", realtime=False)
        self.buffer_rows: list[dict] = []
        self.buffer_units: list[tuple[str, datetime, datetime, int]] = []
        self.next_sweep = 0.0
        self.cooloff_until = 0.0
        # A refusal doubles the wait until the next attempt, up to the ceiling;
        # each answered request steps it back down one refusal. GDELT's throttle outlasts a fixed ten
        # minutes, and every probe during it (five retries each) extends it.
        self.cooloff_seconds = float(config.get("cooloffSeconds", 600))
        self.cooloff_ceiling = float(config.get("cooloffMaxSeconds", 4 * 3600))
        self.refusals = 0

    def _load(self) -> dict:
        try:
            state = json.loads(self.cursor_path.read_text(encoding="utf-8"))
            state["windowEnd"] = datetime.fromisoformat(state["windowEnd"])
            return state
        except (OSError, ValueError, KeyError):
            return {"windowEnd": floor_quarter(datetime.now(timezone.utc)), "queryIndex": 0, "written": None}

    def _save(self) -> None:
        state = {**self.cursor, "windowEnd": self.cursor["windowEnd"].isoformat()}
        self.cursor_path.write_text(json.dumps(state, indent=1), encoding="utf-8")

    def status(self) -> dict:
        return {"backfillWindowEnd": self.cursor["windowEnd"].isoformat(),
                "backfillFloor": self.floor.isoformat(), "bufferedRows": len(self.buffer_rows),
                "lastWrite": self.cursor.get("written")}

    def run(self) -> None:
        from lake import gdelt, news

        # 5 s is GDELT's stated floor; bursts at exactly the floor still drew
        # "Please limit requests" refusals here, so the hub keeps a margin.
        gdelt.PACER.interval = float(self.config.get("intervalSeconds", 6.0))
        self.queries = news.queries_for(gdelt_only=True)
        while True:
            if time.time() < self.cooloff_until:
                time.sleep(min(30.0, self.cooloff_until - time.time()))
                continue
            try:
                if time.time() >= self.next_sweep:
                    self.next_sweep = time.time() + self.sweep_every
                    self._sweep(gdelt)
                elif self.cursor["windowEnd"] > self.floor:
                    self._backfill_unit(gdelt)
                else:
                    self._flush_backfill(final=True)
                    time.sleep(30)
            except Exception as error:  # noqa: BLE001 - the worker must outlive any one request
                log.warning("gdelt: %s", error)
                self.live.fail(error)
                time.sleep(10)
            self.backfill.extra.update(self.status())

    # ── live ─────────────────────────────────────────────────────────────

    def _sweep(self, gdelt) -> None:
        end = floor_quarter(datetime.now(timezone.utc)) + timedelta(minutes=15)
        start = end - self.lookback
        new_total = 0
        for query in self.queries:
            result = gdelt.fetch_window(query.phrase, start, end)
            if result.failed:
                self._cool_off(self.live, f"{query.tag}: GDELT refused {len(result.failed)} window(s)")
                self.next_sweep = self.cooloff_until
                return
            self._answered()
            new = self._ingest(gdelt, query, result.articles, live=True, sink=None)
            new_total += new
            if self.hub.lander is not None:
                self.hub.lander.raw("gdelt", "doc-artlist", json.dumps({
                    "query": query.tag, "start": start.isoformat(), "end": end.isoformat(),
                    "requests": result.requests_made, "articles": result.articles}))
                self.hub.lander.coverage("gdelt", query.tag, start, min(end, datetime.now(timezone.utc)),
                                         "live", len(result.articles))
            self.live.ok(new)
        self.live.note = None
        self.live.extra.update(lastSweepAt=time.time(), lastSweepNew=new_total, rules=len(self.queries))

    def _cool_off(self, health, reason: str) -> None:
        self.refusals += 1
        seconds = min(self.cooloff_ceiling, self.cooloff_seconds * 2 ** (self.refusals - 1))
        self.cooloff_until = time.time() + seconds
        health.fail(reason)
        health.note = (f"GDELT is refusing requests ({self.refusals} in a row); "
                       f"next attempt in {seconds / 60:.0f} min")
        log.warning("gdelt cool-off %ds (refusal %d): %s", seconds, self.refusals, reason)

    def _answered(self) -> None:
        # One answer inside a refused stretch must not undo the escalation.
        self.refusals = max(0, self.refusals - 1)

    def _ingest(self, gdelt, query, articles: list[dict], *, live: bool, sink) -> int:
        new = 0
        for art in articles:
            seen = gdelt.parse_seendate(art.get("seendate", ""))
            if seen is None:
                continue
            if self.pipeline.headline(vendor="gdelt", source=query.tag, title=art.get("title", ""),
                                      url=art.get("url", ""), seen=seen.timestamp(), query=query,
                                      language=art.get("language"), country=art.get("sourcecountry"),
                                      live=live, policy=self.policy, sink=sink):
                new += 1
        return new

    # ── history ──────────────────────────────────────────────────────────

    def _backfill_unit(self, gdelt) -> None:
        end = self.cursor["windowEnd"]
        start = max(end - self.window, self.floor)
        query = self.queries[self.cursor["queryIndex"] % len(self.queries)]
        result = gdelt.fetch_window(query.phrase, start, end)
        if result.failed:
            # Same unit again after the cool-off: an unanswered window is neither
            # coverage nor done.
            self._cool_off(self.backfill, f"{query.tag} {start:%Y-%m-%d}: GDELT refused")
            return
        self._answered()
        if self.hub.lander is not None:
            self.hub.lander.raw("gdelt", "doc-artlist-backfill", json.dumps({
                "query": query.tag, "start": start.isoformat(), "end": end.isoformat(),
                "requests": result.requests_made, "saturated": [[a.isoformat(), b.isoformat()] for a, b in result.saturated],
                "articles": result.articles}))
        new = self._ingest(gdelt, query, result.articles, live=False, sink=self.buffer_rows.extend)
        self.buffer_units.append((query.tag, start, end, len(result.articles)))
        self.backfill.ok(new)
        self.cursor["queryIndex"] += 1
        if self.cursor["queryIndex"] >= len(self.queries):
            self.cursor["queryIndex"] = 0
            self.cursor["windowEnd"] = start
            spanned = min(u[1] for u in self.buffer_units) if self.buffer_units else start
            if self.buffer_units and max(u[2] for u in self.buffer_units) - spanned >= self.write_span:
                self._flush_backfill()

    def _flush_backfill(self, final: bool = False) -> None:
        if not self.buffer_units:
            return
        from lake.contracts import NEWS_ARTICLES, NEWS_COVERAGE
        from lake.writer import write

        lo = min(u[1] for u in self.buffer_units)
        hi = max(u[2] for u in self.buffer_units)
        prefix = f"gdelt-backfill-{lo:%Y%m%d}-{hi:%Y%m%d}"
        if self.buffer_rows:
            write(pa.Table.from_pylist(self.buffer_rows, schema=NEWS_ARTICLES.schema), NEWS_ARTICLES,
                  kind="curated", source="live_hub:gdelt_backfill", basename_prefix=prefix)
        now = datetime.now(timezone.utc)
        coverage = [{"vendor": "gdelt", "source": tag, "start_ts": a, "end_ts": b, "mode": "backfill",
                     "articles": n, "recorded_ts": now} for tag, a, b, n in self.buffer_units]
        write(pa.Table.from_pylist(coverage, schema=NEWS_COVERAGE.schema), NEWS_COVERAGE,
              kind="curated", source="live_hub:gdelt_backfill", basename_prefix=prefix)
        self.cursor["written"] = {"from": lo.isoformat(), "to": hi.isoformat(), "rows": len(self.buffer_rows),
                                  "at": now.isoformat()}
        self._save()
        log.info("gdelt backfill landed %s .. %s: %d rows", lo.date(), hi.date(), len(self.buffer_rows))
        self.buffer_rows = []
        self.buffer_units = []
