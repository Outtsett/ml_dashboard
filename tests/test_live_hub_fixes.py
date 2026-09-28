"""Regression tests for the live hub's review fixes (2026-09-28).

- An RSS or Alpha Vantage row for an article GDELT saw first is stamped when
  the article was KNOWN (bucket + 15 min), never with GDELT's raw bucket stamp.
- A minute a better-ranked source built is never replaced by a worse one, in
  memory or in the lake, and a bar date lands once however often the OANDA
  backfill re-delivers it.
- A failing FinBERT batch is scored one headline at a time; a headline that
  keeps failing is counted, not silently lost.
- Two hubs cannot share one spool.
"""

from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone

import pytest
from lake import news as rules
from live import landing as landing_module
from live.__main__ import lock_spool
from live.hub import Hub
from live.landing import Lander
from live.news import NewsPipeline, known_at
from live.scoring import Scorer

S = 1_765_990_800.0          # a GDELT 15-minute bucket stamp


class _Scorer:
    def __init__(self) -> None:
        self.items: list[dict] = []

    def submit(self, item: dict) -> None:
        self.items.append(item)


class _HubStub:
    lander = None


def _rows_for(pipeline: NewsPipeline, **kwargs) -> list[dict]:
    rows: list[dict] = []
    pipeline.headline(sink=rows.extend, **kwargs)
    return rows


# ── news: first-known time ────────────────────────────────────────────────────

def test_rss_copy_of_a_gdelt_article_is_known_no_earlier_than_gdelt_rule():
    pipeline = NewsPipeline(_HubStub(), _Scorer())
    common = {"title": "Fed holds rates steady", "url": "https://example.com/fed-holds"}
    fomc = next(q for q in rules.queries_for(gdelt_only=True) if q.tag == "fomc")
    _rows_for(pipeline, vendor="gdelt", source="fomc", seen=S, query=fomc, **common)
    rss = _rows_for(pipeline, vendor="rss", source="investing", seen=S + 1500, **common)
    assert rss, "the RSS headline routes somewhere"
    for row in rss:
        assert known_at(row["vendor"], row["seen_ts"].timestamp()) == S + 900


def test_rss_first_then_gdelt_keeps_the_rss_time():
    pipeline = NewsPipeline(_HubStub(), _Scorer())
    common = {"title": "Fed holds rates steady", "url": "https://example.com/fed-holds"}
    rss = _rows_for(pipeline, vendor="rss", source="investing", seen=S + 60, **common)
    assert {row["seen_ts"].timestamp() for row in rss} == {S + 60}


def test_restored_gdelt_article_carries_its_delay():
    pipeline = NewsPipeline(_HubStub(), _Scorer())
    pipeline.remember("a", "gdelt", S, {"fomc"})
    assert pipeline.known["a"] == S + 900


# ── bars ──────────────────────────────────────────────────────────────────────

def _bar(t_ms: int, source: str, close: float, **extra) -> dict:
    return {"t": t_ms, "open": close, "high": close, "low": close, "close": close, "volume": 1.0,
            "closed": True, "source": source, "delaySeconds": 0.0, **extra}


def test_a_delayed_source_never_replaces_a_minute_a_better_source_built(monkeypatch):
    hub = Hub({})
    minute = 1_790_000_040_000
    hub.on_bar("MNQ", _bar(minute, "quantower", 100.0))
    hub.best_source.clear()                     # precedence lapsed: Quantower went quiet
    hub.on_bar("MNQ", _bar(minute, "yahoo", 99.0))
    assert hub.bars["MNQ"][minute]["source"] == "quantower"


@pytest.fixture
def lander(tmp_path):
    return Lander(_HubStub(), {"barLandGraceMinutes": 30, "barLandWarmupSeconds": 0}, tmp_path)


def _record(t: datetime, source: str, close: float) -> dict:
    return {"t": int(t.timestamp() * 1000), "symbol": "MNQ", "assetClass": "futures", "open": close,
            "high": close, "low": close, "close": close, "volume": 1.0, "source": source}


def test_one_row_per_minute_and_the_better_source_wins(lander):
    t = datetime(2026, 9, 1, 14, 30, tzinfo=timezone.utc)
    lander.bar(_record(t, "yahoo", 99.0))
    lander.bar(_record(t, "quantower", 100.0))
    lander.bar(_record(t, "yahoo", 98.0))
    assert len(lander.bar_rows) == 1
    assert next(iter(lander.bar_rows.values()))["vendor"] == "quantower"


def test_a_bar_date_lands_once(lander, monkeypatch):
    writes: list[tuple[str, int]] = []

    def fake_write(table, contract, **kwargs):
        writes.append((kwargs["recipe"], table.num_rows))

    monkeypatch.setattr("lake.writer.write", fake_write)
    day = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=3)
    for k in range(5):
        lander.bar(_record(day + timedelta(minutes=k), "oanda", 1.0))
    lander.land_bars()
    for k in range(5):                           # the OANDA backfill delivers the same day again
        lander.bar(_record(day + timedelta(minutes=k), "oanda", 1.0))
    lander.land_bars()
    assert writes == [(f"live_oanda_{day:%Y%m%d}", 5)]
    assert lander.bar_rows == {}
    reopened = Lander(_HubStub(), {}, lander.spool)           # the ledger survives a restart
    reopened.bar(_record(day, "oanda", 1.0))
    assert reopened.bar_rows == {}


def test_todays_bars_wait_for_the_grace_period(lander, monkeypatch):
    monkeypatch.setattr("lake.writer.write", lambda *a, **k: pytest.fail("landed too early"))
    lander.bar(_record(datetime.now(timezone.utc) - timedelta(minutes=5), "oanda", 1.0))
    lander.land_bars()
    assert len(lander.bar_rows) == 1


# ── scoring ───────────────────────────────────────────────────────────────────

class _Model:
    def __init__(self, bad: set[str]) -> None:
        self.bad = bad

    def score_batch(self, texts):
        if any(t in self.bad for t in texts):
            raise RuntimeError("cannot score")
        return [f"score:{t}" for t in texts]


def test_one_bad_headline_does_not_take_the_batch_with_it():
    scorer = Scorer(_HubStub(), {})
    scorer.model = _Model({"bad"})
    batch = [{"articleId": x, "text": x} for x in ("a", "bad", "c")]
    scored = scorer._score(batch)
    assert [item["articleId"] for item, _ in scored] == ["a", "c"]
    assert len(scorer.retry) == 1 and scorer.dropped == 0


def test_a_headline_that_keeps_failing_is_counted_as_dropped():
    scorer = Scorer(_HubStub(), {})
    scorer.model = _Model({"bad"})
    item = {"articleId": "x", "text": "bad"}
    for _ in range(3):
        scorer._score([item])
        if scorer.retry:
            item = scorer.retry.pop()[1]
    assert scorer.dropped == 1 and list(scorer.dropped_ids) == ["x"]


# ── one hub per spool ─────────────────────────────────────────────────────────

def test_a_second_hub_cannot_take_the_spool(tmp_path):
    first = lock_spool(tmp_path)
    assert first is not None
    import subprocess
    import sys
    code = ("import sys; from pathlib import Path; from live.__main__ import lock_spool; "
            f"sys.exit(0 if lock_spool(Path(r'{tmp_path}')) is None else 1)")
    assert subprocess.run([sys.executable, "-c", code], cwd=landing_module.__file__.rsplit("live", 1)[0]).returncode == 0
    first.close()
    time.sleep(0.05)


def test_no_bar_date_lands_while_the_startup_backfills_run(tmp_path, monkeypatch):
    monkeypatch.setattr("lake.writer.write", lambda *a, **k: pytest.fail("landed during warm-up"))
    warming = Lander(_HubStub(), {}, tmp_path)                 # default warm-up: 15 minutes
    warming.bar(_record(datetime(2026, 9, 1, 14, 30, tzinfo=timezone.utc), "oanda", 1.0))
    warming.land_bars()
    assert len(warming.bar_rows) == 1


def test_a_device_fault_spends_no_attempts():
    scorer = Scorer(_HubStub(), {})
    scorer.model = _Model({"a", "b", "c"})                     # nothing scores
    batch = [{"articleId": x, "text": x} for x in ("a", "b", "c")]
    assert scorer._score(batch) == []
    assert scorer.dropped == 0 and scorer.device_faults == 1
    assert [item.get("attempts", 0) for _, item in scorer.retry] == [0, 0, 0]


def test_an_unconfigured_source_does_not_stop_the_hub():
    import asyncio

    from live.__main__ import until_fatal

    async def quiet():                  # a source with no credential returns at once
        return None

    async def landing():
        await asyncio.sleep(0.2)
        raise RuntimeError("landing broke")

    async def run():
        source = asyncio.create_task(quiet(), name="alphavantage")
        loop_task = asyncio.create_task(landing(), name="periodic")
        still = asyncio.create_task(asyncio.sleep(5), name="oanda")
        pending = await until_fatal([source, loop_task, still])
        assert source.done() and loop_task.done() and pending == {still}
        still.cancel()

    asyncio.run(run())
