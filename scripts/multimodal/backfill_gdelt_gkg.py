"""Backfill GDELT GKG 2.1 finance news, filtered while streaming (Tyler approved 2026-09-29).

The raw GKG archive is 170-270 GB of zips a year, too large to land whole, so
each 15-minute file is downloaded, checked against GDELT's own md5 from the
master file list, filtered to finance / markets / macro records, and discarded;
only the filtered rows land, write-once, one parquet per UTC day, with a
sources file that names every upstream file, its md5 and size, and the rows
read and kept. Any day can be re-derived from GDELT's permanent archive.

    s3://raw/vendor=gdelt_gkg/dataset=gkg-finance-filtered/filter=<FILTER_VERSION>/day=<YYYY-MM-DD>/part.parquet (+ .sha256)
    s3://raw/vendor=gdelt_gkg/dataset=gkg-finance-filtered/filter=<FILTER_VERSION>/day=<YYYY-MM-DD>/sources.json (+ .sha256)

A record is kept when any of its themes starts with ECON_ or EPU_ (GDELT's
economy and economic-policy-uncertainty taxonomies), or its organisations name a
market institution or a Nasdaq-100 heavyweight (ORGANISATIONS below).

Known time: GDELT publishes each file at its 15-minute stamp for the window
that ENDS there, so an article is known at the file stamp; `known_ts` is that
stamp plus 15 minutes, the conservative rule `lake.sentiment` already uses.

Columns: record_id, known_ts (UTC), gdelt_date, source_name, url, page_title,
tone, tone_positive, tone_negative, tone_polarity, activity_density,
self_group_density, word_count, themes (the kept ECON_/EPU_ themes), organisations.

Resumable: a day whose part.parquet already exists is skipped.

    .venv/Scripts/python.exe scripts/multimodal/backfill_gdelt_gkg.py --start 2019-05-01 --end 2026-01-01 --workers 10
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import re
import sys
import tempfile
import time
import urllib.request
import zipfile
from collections import defaultdict
from concurrent.futures import ProcessPoolExecutor, as_completed
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import polars as pl

MASTER_URL = "https://data.gdeltproject.org/gdeltv2/masterfilelist.txt"
FILTER_VERSION = "finance_v1"
USER_AGENT = {"User-Agent": "ml-dashboard multimodal backfill (research; contact via repo owner)"}
CACHE = Path(__file__).resolve().parents[2] / "data" / "gdelt"

ORGANISATIONS = [
    "federal reserve", "nasdaq", "new york stock exchange", "securities and exchange commission",
    "treasury", "bureau of labor statistics", "european central bank", "bank of japan", "bank of england",
    "chicago mercantile exchange", "cme group", "standard & poor", "s&p", "dow jones", "moody",
    "international monetary fund", "opec", "apple", "microsoft", "nvidia", "amazon", "alphabet", "google",
    "meta platforms", "facebook", "tesla", "broadcom", "netflix", "advanced micro devices", "intel",
    "costco", "adobe", "qualcomm", "cisco",
]
ORGANISATION_PATTERN = re.compile("|".join(re.escape(name) for name in ORGANISATIONS))
THEME_PATTERN = re.compile(r"(?:^|;)(ECON_[A-Z0-9_]+|EPU_[A-Z0-9_]+)")
TITLE_PATTERN = re.compile(r"<PAGE_TITLE>(.*?)</PAGE_TITLE>", re.DOTALL)

# GKG 2.1 column positions (tab separated, no header)
C_RECORD, C_DATE, C_SOURCE, C_URL, C_THEMES, C_ORGS, C_TONE, C_EXTRAS = 0, 1, 3, 4, 7, 13, 15, 26


def fetch(url: str, attempts: int = 5) -> bytes:
    for attempt in range(attempts):
        try:
            request = urllib.request.Request(url, headers=USER_AGENT)
            with urllib.request.urlopen(request, timeout=120) as response:
                return response.read()
        except Exception:  # noqa: BLE001 - retried, then raised
            if attempt == attempts - 1:
                raise
            time.sleep(2.0 * (attempt + 1))
    raise RuntimeError("unreachable")


def master_list(refresh: bool) -> list[tuple[int, str, str]]:
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / "masterfilelist.txt"
    if refresh or not path.exists():
        path.write_bytes(fetch(MASTER_URL))
    out = []
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        parts = line.split()
        if len(parts) == 3 and parts[2].endswith(".gkg.csv.zip") and ".translation." not in parts[2]:
            out.append((int(parts[0]), parts[1], parts[2].replace("http://", "https://")))
    return out


def stamp_of(url: str) -> datetime:
    return datetime.strptime(url.rsplit("/", 1)[1][:14], "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc)


def parse_file(raw_zip: bytes, known: datetime) -> tuple[int, list[dict]]:
    with zipfile.ZipFile(io.BytesIO(raw_zip)) as archive:
        text = archive.read(archive.namelist()[0]).decode("utf-8", errors="replace")
    kept: list[dict] = []
    lines = text.split("\n")
    for line in lines:
        if not line:
            continue
        cols = line.split("\t")
        if len(cols) < 27:
            continue
        themes = cols[C_THEMES]
        orgs = cols[C_ORGS].lower()
        finance_themes = THEME_PATTERN.findall(themes)
        if not finance_themes and not ORGANISATION_PATTERN.search(orgs):
            continue
        tone = (cols[C_TONE].split(",") + [""] * 7)[:7]
        title = TITLE_PATTERN.search(cols[C_EXTRAS])

        def num(value: str) -> float | None:
            try:
                return float(value)
            except ValueError:
                return None

        kept.append({
            "record_id": cols[C_RECORD],
            "known_ts": known,
            "gdelt_date": cols[C_DATE],
            "source_name": cols[C_SOURCE],
            "url": cols[C_URL],
            "page_title": title.group(1).strip() if title else None,
            "tone": num(tone[0]),
            "tone_positive": num(tone[1]),
            "tone_negative": num(tone[2]),
            "tone_polarity": num(tone[3]),
            "activity_density": num(tone[4]),
            "self_group_density": num(tone[5]),
            "word_count": num(tone[6]),
            "themes": ";".join(sorted(set(finance_themes))),
            "organisations": ";".join(sorted({name for name in ORGANISATIONS if name in orgs})),
        })
    return sum(1 for line in lines if line), kept


def process_day(day: str, files: list[tuple[int, str, str]]) -> dict:
    from lake.layout import RAW  # imported in the worker
    from lake.writer import land_raw

    dest_dir = RAW / "vendor=gdelt_gkg" / "dataset=gkg-finance-filtered" / f"filter={FILTER_VERSION}" / f"day={day}"
    if (dest_dir / "part.parquet").exists():
        return {"day": day, "status": "skipped"}
    rows: list[dict] = []
    sources = []
    for size, md5, url in sorted(files, key=lambda item: item[2]):
        try:
            body = fetch(url)
        except Exception as error:  # noqa: BLE001 - recorded, the day still lands
            sources.append({"url": url, "md5": md5, "bytes": size, "status": f"fetch failed: {error}"})
            continue
        digest = hashlib.md5(body).hexdigest()
        if digest != md5:
            sources.append({"url": url, "md5": md5, "bytes": size, "status": f"md5 mismatch ({digest})"})
            continue
        known = stamp_of(url) + timedelta(minutes=15)
        try:
            read, kept = parse_file(body, known)
        except Exception as error:  # noqa: BLE001
            sources.append({"url": url, "md5": md5, "bytes": size, "status": f"parse failed: {error}"})
            continue
        rows.extend(kept)
        sources.append({"url": url, "md5": md5, "bytes": size, "status": "ok", "rows_read": read, "rows_kept": len(kept)})
    frame = pl.DataFrame(rows, schema={
        "record_id": pl.Utf8, "known_ts": pl.Datetime("us", "UTC"), "gdelt_date": pl.Utf8, "source_name": pl.Utf8,
        "url": pl.Utf8, "page_title": pl.Utf8, "tone": pl.Float64, "tone_positive": pl.Float64,
        "tone_negative": pl.Float64, "tone_polarity": pl.Float64, "activity_density": pl.Float64,
        "self_group_density": pl.Float64, "word_count": pl.Float64, "themes": pl.Utf8, "organisations": pl.Utf8,
    })
    with tempfile.TemporaryDirectory() as scratch:
        # The rows land first: a day counts as done once part.parquet exists, so an
        # interrupted run redoes the whole day. A sources file left by an earlier,
        # interrupted attempt is kept (raw is write-once); this attempt's lands beside it.
        local = Path(scratch) / "part.parquet"
        frame.write_parquet(local, compression="zstd", compression_level=9)
        outcome = land_raw(local, dest_dir / "part.parquet")
        local_sources = Path(scratch) / "sources.json"
        local_sources.write_text(json.dumps({"filter": FILTER_VERSION, "day": day, "files": sources}, indent=1), encoding="utf-8")
        try:
            land_raw(local_sources, dest_dir / "sources.json")
        except FileExistsError:
            stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
            land_raw(local_sources, dest_dir / f"sources.{stamp}.json")
    ok = sum(1 for s in sources if s["status"] == "ok")
    return {"day": day, "status": outcome["status"], "files": len(files), "files_ok": ok, "rows": frame.height,
            "bytes_in": sum(s["bytes"] for s in sources if s["status"] == "ok")}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--start", required=True, help="first UTC day, YYYY-MM-DD")
    parser.add_argument("--end", required=True, help="day after the last, YYYY-MM-DD")
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--refresh-master", action="store_true")
    args = parser.parse_args()
    start, end = date.fromisoformat(args.start), date.fromisoformat(args.end)

    by_day: dict[str, list] = defaultdict(list)
    for size, md5, url in master_list(args.refresh_master):
        stamp = stamp_of(url)
        if start <= stamp.date() < end:
            by_day[stamp.strftime("%Y-%m-%d")].append((size, md5, url))
    days = sorted(by_day)
    print(f"{len(days)} days, {sum(len(v) for v in by_day.values()):,} files, "
          f"{sum(s for v in by_day.values() for s, _, _ in v) / 1e9:,.1f} GB to stream", flush=True)
    log = CACHE / f"backfill_{FILTER_VERSION}.jsonl"
    done = 0
    with ProcessPoolExecutor(max_workers=args.workers) as pool, log.open("a", encoding="utf-8") as progress:
        # Newest first: the dense MNQ years and the locked periods land before the older history.
        futures = {pool.submit(process_day, day, by_day[day]): day for day in sorted(days, reverse=True)}
        for future in as_completed(futures):
            day = futures[future]
            try:
                result = future.result()
            except Exception as error:  # noqa: BLE001 - logged; a rerun retries the day
                result = {"day": day, "status": f"failed: {error}"}
            done += 1
            progress.write(json.dumps(result) + "\n")
            progress.flush()
            print(f"[{done}/{len(days)}] {json.dumps(result)}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
