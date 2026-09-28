"""Every headline, whatever its vendor, through one path: identity, routing,
rows for the lake, and a FinBERT score.

``seen_ts`` is the moment THIS process first saw the item (for GDELT, its crawl
bucket) — never the outlet's ``pubDate``, which is a claim about the past and
would put a headline into bars that opened before anyone could read it. The
outlet's claim is kept as ``published_ts`` for diagnosis only.
"""

from __future__ import annotations

import threading
import time
from datetime import datetime, timezone
from urllib.parse import urlsplit

from lake import news as rules

SEEN_TTL_SECONDS = 7 * 86400


class NewsPipeline:
    def __init__(self, hub, scorer) -> None:
        self.hub = hub
        self.scorer = scorer
        self.lock = threading.Lock()
        self.seen: dict[str, float] = {}              # article_id -> first seen (epoch s)
        self.units: set[tuple[str, str]] = set()      # (article_id, query_tag) already written

    def remember(self, article_id: str, seen: float, tags: set[str]) -> None:
        with self.lock:
            self.seen.setdefault(article_id, seen)
            self.units.update((article_id, tag) for tag in tags)

    def _prune(self) -> None:
        cutoff = time.time() - SEEN_TTL_SECONDS
        if len(self.seen) > 200_000:
            stale = [k for k, v in self.seen.items() if v < cutoff]
            for key in stale:
                self.seen.pop(key, None)
            self.units = {u for u in self.units if u[0] in self.seen}

    def headline(self, *, vendor: str, source: str, title: str, url: str, seen: float,
                 published: datetime | None = None, query: rules.Query | None = None,
                 language: str | None = None, country: str | None = None, live: bool = True,
                 policy: str = "all", sink=None) -> bool:
        """Route, land and score one item. Returns True when the article is new.

        ``query``: the GDELT rule that surfaced it (its roots, not the
        headline's, are the routing); otherwise the headline is routed by rule.
        ``sink``: where the article rows go — today's spool by default; the
        GDELT backfill passes its own batch, which lands straight in the lake.
        """
        title = (title or "").strip()
        if not title:
            return False
        url = (url or "").strip() or f"https://{vendor}.invalid/{source}/{abs(hash(title))}"
        domain = (urlsplit(url).netloc or vendor).lower().removeprefix("www.")
        if query is not None and not rules.keep_domain(domain, policy):
            return False
        article_id = rules.article_id(url)
        routes = rules.routes_for_query(query) if query is not None else rules.route_headline(title)

        with self.lock:
            first = article_id not in self.seen
            seen_at = self.seen.setdefault(article_id, seen)
            self._prune()
            fresh_routes = [r for r in routes if (article_id, r.query_tag) not in self.units]
            self.units.update((article_id, r.query_tag) for r in fresh_routes)
            unrouted = not routes and (article_id, rules.UNROUTED_TIER) not in self.units
            if unrouted:
                self.units.add((article_id, rules.UNROUTED_TIER))

        seen_dt = datetime.fromtimestamp(seen_at, tz=timezone.utc)
        now = datetime.now(timezone.utc)
        base = {
            "article_id": article_id, "seen_ts": seen_dt, "published_ts": published, "title": title,
            "text": title, "text_source": "title", "url": url, "domain": domain, "language": language,
            "source_country": country, "ingested_ts": now, "vendor": vendor,
        }
        rows = [{**base, "root": r.root, "tier": r.tier, "query_tag": r.query_tag,
                 "relevance": r.relevance, "direction": r.direction} for r in fresh_routes]
        if unrouted:
            rows.append({**base, "root": rules.UNROUTED_ROOT, "tier": rules.UNROUTED_TIER,
                         "query_tag": rules.UNROUTED_TIER, "relevance": 1.0, "direction": 1})
        if rows:
            if sink is not None:
                sink(rows)
            elif self.hub.lander is not None:
                self.hub.lander.articles(rows)

        if first:
            by_root: dict[str, dict] = {}
            for r in routes:
                entry = by_root.setdefault(r.root, {"root": r.root, "direction": r.direction,
                                                    "relevance": r.relevance, "tier": r.tier})
                if r.relevance > entry["relevance"]:
                    entry.update(direction=r.direction, relevance=r.relevance, tier=r.tier)
            payload = {
                "articleId": article_id, "title": title, "url": url, "domain": domain,
                "vendor": vendor, "source": source, "seenTs": int(seen_at * 1000),
                "knownTs": int((seen_at + (900 if vendor == "gdelt" else 0)) * 1000),
                "publishedTs": int(published.timestamp() * 1000) if published else None,
                "routes": sorted(by_root.values(), key=lambda e: -e["relevance"]),
                "tags": sorted({r.query_tag for r in routes}),
            }
            self.scorer.submit({"articleId": article_id, "text": title, "seenTs": seen_at,
                                "live": live, "payload": payload})
        return first
