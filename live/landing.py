"""Everything the hub fetches, landed in the lake.

Three paths, chosen by what each reader needs and by how the lake behaves
(``lake.writer.write`` lists the whole dataset on every call and writes one file
per partition touched, so a write every minute would bury the news tables in
tiny files):

- **raw** — every payload, as received, appended to a local spool file per
  (vendor, dataset); every ``rawFlushSeconds`` the file is gzip-compressed and
  ``land_raw``-ed write-once to ``raw/vendor=<v>/dataset=<d>/schema=jsonl-gz/
  received=<date>/`` with its sha256 sidecar, then removed locally.
- **today** — article rows, FinBERT scores and coverage spans accumulate in
  memory and are rewritten every ``spoolFlushSeconds`` to
  ``<spool>/curated/<dataset>/day=<date>.parquet``, which ``lake.sentiment``
  reads beside the lake, so a model trained this afternoon sees this morning.
- **finished days** — at the first flush after UTC midnight (and at any later
  flush, for a day whose landing failed or was left behind) the day's news rows
  go through ``lake.writer.write`` into the curated contracts in one write each.
- **bars** — closed 1-minute bars are held by (symbol, minute), one row each: a
  higher-ranked source (``Hub.RANK``) replaces a lower one, never the reverse.
  A bar DATE lands once, ``barLandGraceMinutes`` after it ends (Yahoo runs ~9
  minutes behind), into ``derived/live_bars/recipe=live_<vendor>_<yyyymmdd>``
  (view ``derived_live_bars``) with a file name fixed by (vendor, date), so a
  retried write overwrites rather than duplicates; ``<spool>/live_bars_landed.json``
  records the dates landed, and a bar for a landed date is dropped. The OANDA
  startup backfill re-delivers 14 days on every start; this is what keeps it
  from landing twice. The lake writer dedups only within one write.

A failed lake write leaves the spool in place and is retried on the next flush.
"""

from __future__ import annotations

import gzip
import json
import logging
import os
import shutil
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.parquet as pq

log = logging.getLogger("live.landing")

DATASETS = ("news_articles", "news_sentiment", "news_coverage")


def _live_bars_contract():
    from lake.contracts import BARS, Contract

    return Contract(
        name="live_bars",
        schema=BARS.schema,
        partition_by=("asset_class", "root", "timeframe", "year"),
        unique_key=("ts", "symbol", "timeframe", "vendor"),
        doc="1-minute bars the live hub built or fetched (OANDA mid, Yahoo delayed, Quantower tape).",
    )


def _utc_date(ts: float | None = None) -> str:
    return datetime.fromtimestamp(ts if ts is not None else time.time(), tz=timezone.utc).strftime("%Y-%m-%d")


def _day_end(day: str) -> float:
    return datetime.strptime(day, "%Y-%m-%d").replace(tzinfo=timezone.utc).timestamp() + 86_400


def _rank(vendor: str) -> int:
    from .hub import Hub

    return Hub.RANK.get(vendor, 0)


class Lander:
    def __init__(self, hub, config: dict, spool: Path) -> None:
        self.hub = hub
        self.config = config
        self.spool = spool
        self.raw_dir = spool / "raw"
        self.day_dir = spool / "curated"
        self.lock = threading.Lock()
        self.raw_files: dict[tuple[str, str], tuple[object, Path, float]] = {}
        self.day = _utc_date()
        self.buffers: dict[str, list[dict]] = {name: [] for name in DATASETS}
        self.bar_rows: dict[tuple[str, int], dict] = {}       # (symbol, open ms) -> row, not yet landed
        self.bars_file = spool / "bars" / "pending.parquet"
        self.bars_ledger = spool / "live_bars_landed.json"
        self.bars_landed: set[str] = self._load_bars_landed()
        self.bar_grace = float(config.get("barLandGraceMinutes", 30)) * 60
        self.counters = {"rawLanded": 0, "rawBytes": 0, "daysLanded": 0, "barDaysLanded": 0,
                         "lastRawLand": None, "lastSpoolFlush": None, "lastError": None}
        self.raw_dir.mkdir(parents=True, exist_ok=True)
        self.day_dir.mkdir(parents=True, exist_ok=True)
        self.bars_file.parent.mkdir(parents=True, exist_ok=True)

    def _load_bars_landed(self) -> set[str]:
        try:
            return set(json.loads(self.bars_ledger.read_text(encoding="utf-8")))
        except (OSError, ValueError):
            return set()

    def _save_bars_landed(self) -> None:
        temporary = self.bars_ledger.with_suffix(".tmp")
        temporary.write_text(json.dumps(sorted(self.bars_landed)), encoding="utf-8")
        temporary.replace(self.bars_ledger)

    # ── intake (any thread) ──────────────────────────────────────────────

    def raw(self, vendor: str, dataset: str, line: str) -> None:
        with self.lock:
            key = (vendor, dataset)
            entry = self.raw_files.get(key)
            if entry is None:
                folder = self.raw_dir / vendor / dataset
                folder.mkdir(parents=True, exist_ok=True)
                path = folder / f"{datetime.now(timezone.utc):%Y%m%dT%H%M%S}-{os.getpid()}.jsonl"
                handle = path.open("a", encoding="utf-8")
                entry = (handle, path, time.time())
                self.raw_files[key] = entry
            entry[0].write(line.rstrip("\n") + "\n")

    def articles(self, rows: list[dict]) -> None:
        with self.lock:
            self.buffers["news_articles"].extend(rows)

    def sentiment(self, row: dict) -> None:
        with self.lock:
            self.buffers["news_sentiment"].append(row)

    def coverage(self, vendor: str, source: str, start: datetime, end: datetime, mode: str, articles: int) -> None:
        if end <= start:
            return
        with self.lock:
            self.buffers["news_coverage"].append({
                "vendor": vendor, "source": source, "start_ts": start, "end_ts": end, "mode": mode,
                "articles": int(articles), "recorded_ts": datetime.now(timezone.utc)})

    def bar(self, record: dict) -> None:
        t = int(record["t"])
        self._hold_bar({
            "ts": datetime.fromtimestamp(t / 1000, tz=timezone.utc), "symbol": record["symbol"],
            "timeframe": "1m", "asset_class": record["assetClass"], "root": record["symbol"],
            "open": record["open"], "high": record["high"], "low": record["low"], "close": record["close"],
            "volume": record.get("volume"), "vendor": record["source"]})

    def _hold_bar(self, row: dict) -> None:
        key = (row["symbol"], int(row["ts"].timestamp() * 1000))
        with self.lock:
            if row["ts"].strftime("%Y-%m-%d") in self.bars_landed:
                return
            held = self.bar_rows.get(key)
            # The first closed bar of a source stands; a better-ranked source replaces it.
            if held is not None and _rank(held["vendor"]) >= _rank(row["vendor"]):
                return
            self.bar_rows[key] = row

    # ── raw ───────────────────────────────────────────────────────────────

    def flush_raw(self, force: bool = False) -> None:
        interval = float(self.config.get("rawFlushSeconds", 900))
        with self.lock:
            due = [(k, v) for k, v in self.raw_files.items() if force or time.time() - v[2] >= interval]
            for key, (handle, _, _) in due:
                handle.close()
                del self.raw_files[key]
        for (vendor, dataset), (_, path, _) in due:
            self._land_raw_file(vendor, dataset, path)

    def _land_raw_file(self, vendor: str, dataset: str, path: Path) -> None:
        from lake.layout import raw_path
        from lake.writer import land_raw

        try:
            if not path.exists():
                return
            if path.stat().st_size == 0:
                path.unlink(missing_ok=True)
                return
            packed = path.with_suffix(".jsonl.gz")
            with path.open("rb") as src, gzip.open(packed, "wb", compresslevel=6) as dst:
                shutil.copyfileobj(src, dst)
            dest = raw_path(vendor, dataset, "jsonl-gz", _utc_date(), packed.name)
            result = land_raw(packed, dest)
            self.counters["rawLanded"] += 1
            self.counters["rawBytes"] += int(result.get("bytes", 0) or packed.stat().st_size)
            self.counters["lastRawLand"] = time.time()
            path.unlink(missing_ok=True)
            packed.unlink(missing_ok=True)
        except Exception as error:  # noqa: BLE001 - keep the spool file; retried at the next flush
            self.counters["lastError"] = f"raw {vendor}/{dataset}: {type(error).__name__}: {error}"
            log.warning(self.counters["lastError"])

    # ── today + finished days ────────────────────────────────────────────

    def _schemas(self) -> dict:
        from lake.contracts import NEWS_ARTICLES, NEWS_COVERAGE, NEWS_SENTIMENT

        return {"news_articles": NEWS_ARTICLES, "news_sentiment": NEWS_SENTIMENT,
                "news_coverage": NEWS_COVERAGE}

    def _day_file(self, dataset: str, day: str) -> Path:
        folder = self.day_dir / dataset
        folder.mkdir(parents=True, exist_ok=True)
        return folder / f"day={day}.parquet"

    def flush_spool(self) -> None:
        """Rewrite today's spool files and the pending bars; land any finished
        news day still in the spool (yesterday at the first flush after UTC
        midnight, or one whose earlier landing failed) and every bar date past
        its grace period."""
        today = _utc_date()
        contracts = self._schemas()
        with self.lock:
            day, snapshot = self.day, {k: list(v) for k, v in self.buffers.items()}
            bars = list(self.bar_rows.values())
            if today != day:
                self.day = today
                self.buffers = {name: [] for name in DATASETS}
        for dataset, rows in snapshot.items():
            if rows:
                self._write_local(dataset, day, rows, contracts[dataset])
        self._write_file(self.bars_file, bars, _live_bars_contract())
        for leftover in self._spool_days():
            if leftover < self.day:
                self.land_day(leftover)
        self.land_bars()
        self.counters["lastSpoolFlush"] = time.time()

    def _spool_days(self) -> list[str]:
        return sorted({p.stem.removeprefix("day=") for dataset in DATASETS
                       for p in (self.day_dir / dataset).glob("day=*.parquet")})

    def _write_local(self, dataset: str, day: str, rows: list[dict], contract) -> None:
        self._write_file(self._day_file(dataset, day), rows, contract)

    @staticmethod
    def _write_file(target: Path, rows: list[dict], contract) -> None:
        table = pa.Table.from_pylist(rows, schema=contract.schema)
        temporary = target.with_suffix(".tmp")
        pq.write_table(table, temporary, compression="zstd")
        temporary.replace(target)

    def land_bars(self) -> None:
        """Land every bar date whose end is ``barLandGraceMinutes`` past, once."""
        from lake.writer import write

        contract = _live_bars_contract()
        now = time.time()
        with self.lock:
            by_date: dict[str, list[tuple[tuple[str, int], dict]]] = {}
            for key, row in self.bar_rows.items():
                by_date.setdefault(row["ts"].strftime("%Y-%m-%d"), []).append((key, row))
        for day in sorted(by_date):
            if day in self.bars_landed or _day_end(day) + self.bar_grace > now:
                continue
            held = by_date[day]
            table = pa.Table.from_pylist([row for _, row in held], schema=contract.schema)
            try:
                for vendor in sorted(set(table.column("vendor").to_pylist())):
                    part = table.filter(pc.equal(table.column("vendor"), vendor))
                    write(part, contract, kind="derived", recipe=f"live_{vendor}_{day.replace('-', '')}",
                          source="live_hub", basename_prefix=f"live-{day}")
            except Exception as error:  # noqa: BLE001 - the rows stay pending; retried at the next flush
                self.counters["lastError"] = f"land live_bars {day}: {type(error).__name__}: {error}"
                log.warning(self.counters["lastError"])
                return
            with self.lock:
                self.bars_landed.add(day)
                for key, row in held:
                    if self.bar_rows.get(key) is row:
                        del self.bar_rows[key]
                self._save_bars_landed()
            self.counters["barDaysLanded"] += 1
            log.info("landed live bars for %s: %d rows", day, table.num_rows)

    def land_day(self, day: str) -> None:
        """Write one finished day from the spool into the lake; the spool file
        moves to ``landed/`` only once its write succeeded."""
        from lake.writer import write

        contracts = self._schemas()
        for dataset in DATASETS:
            source = self._day_file(dataset, day)
            if not source.exists():
                continue
            try:
                table = pq.read_table(source)
                if table.num_rows:
                    write(table, contracts[dataset], kind="curated", source="live_hub",
                          basename_prefix=f"live-{day}")
                done = self.spool / "landed" / dataset
                done.mkdir(parents=True, exist_ok=True)
                source.replace(done / source.name)
            except Exception as error:  # noqa: BLE001 - retried on the next start / rollover
                self.counters["lastError"] = f"land {dataset} {day}: {type(error).__name__}: {error}"
                log.warning(self.counters["lastError"])
                return
        self.counters["daysLanded"] += 1
        log.info("landed %s", day)

    def recover(self) -> None:
        """On start: land raw spool files a previous process left, land any
        finished day still in the spool, and reload today's rows so the next
        rewrite of today's files keeps them."""
        for path in sorted(self.raw_dir.rglob("*.jsonl")):
            vendor, dataset = path.parent.parent.name, path.parent.name
            self._land_raw_file(vendor, dataset, path)
        # Bars: the pending file, plus any per-day bar file an earlier version
        # of the hub left (moved aside once read, so it is read once).
        legacy = sorted((self.day_dir / "live_bars").glob("day=*.parquet"))
        for source in [self.bars_file, *legacy]:
            if source.exists():
                for row in pq.read_table(source).to_pylist():
                    self._hold_bar(row)
        for source in legacy:
            done = self.spool / "landed" / "live_bars_legacy"
            done.mkdir(parents=True, exist_ok=True)
            source.replace(done / source.name)
        for day in self._spool_days():
            if day < self.day:
                self.land_day(day)
        for dataset in DATASETS:
            source = self._day_file(dataset, self.day)
            if source.exists():
                rows = pq.read_table(source).to_pylist()
                with self.lock:
                    self.buffers[dataset] = rows + self.buffers[dataset]

    def coverage_spans(self) -> list[tuple[str, str, float, float]]:
        with self.lock:
            return [(r["vendor"], r["source"], r["start_ts"].timestamp(), r["end_ts"].timestamp())
                    for r in self.buffers["news_coverage"]]

    def today(self, dataset: str) -> list[dict]:
        with self.lock:
            return list(self.buffers[dataset])

    def today_articles(self) -> list[dict]:
        with self.lock:
            return list(self.buffers["news_articles"])

    def status(self) -> dict:
        with self.lock:
            return {**self.counters, "day": self.day, "openRawFiles": len(self.raw_files),
                    "todayRows": {k: len(v) for k, v in self.buffers.items()},
                    "pendingBars": len(self.bar_rows), "barDatesLanded": len(self.bars_landed)}
