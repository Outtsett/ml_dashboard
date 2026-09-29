"""Readers for the non-MNQ-minute inputs of the feature blocks, all on the lake's futures clock.

Every reader returns epoch SECONDS on the Pacific-stamp clock (the lake's
futures convention) and passes its timestamps through ``holdout.guard``:

    flow_minutes(start, end)      tick-rule order flow per contract minute (derived/multimodal_orderflow)
    other_minutes(root, ...)      ES / RTY / YM back-adjusted minutes (one contract per session)
    daily_closes(symbols)         daily closes from the Iceberg `bars` table (dated by trading day)
    calendar_events()             scheduled releases and FOMC statements (market_calendar_v1,
                                  fomc_decisions_v1, and the 2019-05..2020-12 backfill)
    gdelt_news(start, end)        GDELT GKG finance rows (raw/vendor=gdelt_gkg), known time + 15 min
"""

from __future__ import annotations

import io
import json
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

from multimodal import holdout

PACIFIC = ZoneInfo("America/Los_Angeles")
ORDERFLOW = "s3://derived/multimodal_orderflow/recipe={recipe}/table=minutes/*.parquet"
EVIDENCE = Path(__file__).resolve().parents[3] / "docs" / "plans" / "2026-09-29-multimodal" / "evidence"
# publisher-sourced release dates for the years market_calendar_v1 lacks (every row cites its source)
CALENDAR_BACKFILLS = (EVIDENCE / "calendar_2019_2020.json", EVIDENCE / "calendar_2021_2022.json")
STOCKMARKET_THEMES = ("ECON_STOCKMARKET",)
CENTRAL_BANK_ORGANISATIONS = ("federal reserve", "european central bank", "bank of japan", "bank of england")
MEGACAP_ORGANISATIONS = ("apple", "microsoft", "nvidia", "amazon", "alphabet", "google", "meta platforms", "facebook",
                         "tesla", "broadcom", "netflix", "advanced micro devices")


def _connection(with_bars: bool = False):
    from lake.serving import connect

    connection = connect(with_bars=with_bars, with_derived=False)
    connection.execute("SET TimeZone='UTC'")
    return connection


def utc_seconds(values) -> np.ndarray:
    """Epoch SECONDS of any timestamp column, whatever its unit (ns, us, ms) or zone.

    `astype("int64")` on a datetime column returns the column's own unit — pandas 2 keeps
    microseconds from parquet — so dividing by 1e9 put every news row in January 1970."""
    stamps = pd.to_datetime(pd.Series(values), utc=True)
    return ((stamps - pd.Timestamp("1970-01-01", tz="UTC")) // pd.Timedelta(seconds=1)).to_numpy(np.int64)


def stamp_to_utc_seconds(stamp_seconds: np.ndarray) -> np.ndarray:
    """The lake's futures clock (Pacific wall-clock digits read as UTC) → true UTC seconds."""
    local = pd.to_datetime(np.asarray(stamp_seconds, dtype=np.int64), unit="s").tz_localize(
        PACIFIC, ambiguous="NaT", nonexistent="shift_forward")
    out = (local.tz_convert("UTC") - pd.Timestamp("1970-01-01", tz="UTC")) // pd.Timedelta(seconds=1)
    values = np.asarray(out.to_numpy(dtype="float64"), dtype=float)
    # the repeated hour of a DST fall-back: take the standard-time reading (the later instant)
    missing = np.isnan(values)
    if missing.any():
        values[missing] = np.asarray(stamp_seconds, dtype=np.int64)[missing] + 8 * 3600
    return values.astype(np.int64)


def utc_to_stamp_seconds(utc_seconds: np.ndarray) -> np.ndarray:
    """True-UTC epoch seconds → Pacific wall-clock digits read as UTC (the lake's futures clock)."""
    values = np.asarray(utc_seconds, dtype=np.int64)
    if values.size == 0:
        return values
    index = pd.to_datetime(values, unit="s", utc=True).tz_convert(PACIFIC).tz_localize(None)
    return (index.asi8 // 1_000_000_000).astype(np.int64)


def flow_minutes(start: str, end: str, root: str = "MNQ") -> pd.DataFrame:
    connection = _connection()
    recipe = "tick_rule_1s_v1" if root == "MNQ" else f"tick_rule_1s_v1_{root.lower()}"
    frame = connection.execute(
        f"SELECT symbol AS contract, CAST(epoch(minute) AS BIGINT) AS timestamp, volume, buy_volume, sell_volume, "
        f"signed_volume, active_seconds, largest_second_volume, up_seconds, down_seconds FROM read_parquet('{ORDERFLOW.format(recipe=recipe)}') "
        "WHERE minute >= CAST(? AS TIMESTAMP) AND minute < CAST(? AS TIMESTAMP)",
        [start, end],
    ).df()
    holdout.guard(frame["timestamp"].to_numpy(np.int64) * 1000, what="order flow")
    return frame


def other_minutes(root: str, start: str, end: str) -> pd.DataFrame:
    """A cross-asset root's back-adjusted minutes; empty when it has no history in the window (RTY before 2017)."""
    from multimodal.data import load_minutes

    try:
        minutes = load_minutes(start, end, root=root)
    except (ValueError, IndexError, KeyError):
        return pd.DataFrame({"timestamp": np.array([], dtype=np.int64), "close": np.array([], dtype=float), "raw_close": np.array([], dtype=float)})
    return pd.DataFrame({"timestamp": minutes.timestamp, "close": minutes.close, "raw_close": minutes.raw_close})


def daily_closes(symbols: list[str]) -> dict[str, pd.DataFrame]:
    connection = _connection(with_bars=True)
    placeholders = ",".join("?" for _ in symbols)
    frame = connection.execute(
        f"SELECT symbol, CAST(epoch(ts) AS BIGINT) AS ts, close FROM bars WHERE timeframe = '1d' AND symbol IN ({placeholders}) ORDER BY symbol, ts",
        symbols,
    ).df()
    if not holdout.is_unlocked("holdout"):
        frame = frame[frame["ts"] * 1000 < holdout.development_end_ms()]
    out = {}
    for symbol, group in frame.groupby("symbol"):
        day = (group["ts"].to_numpy(np.int64) // 86400).astype(np.int64)
        out[symbol] = pd.DataFrame({"day": day, "close": group["close"].to_numpy(float)})
    return out


def _stamp_of(date: str, local_time: str, zone: str) -> int:
    hour, minute = (int(x) for x in (local_time or "08:30").split(":")[:2])
    local = datetime.fromisoformat(date).replace(hour=hour, minute=minute, tzinfo=ZoneInfo(zone))
    return int(utc_to_stamp_seconds(np.array([int(local.astimezone(timezone.utc).timestamp())]))[0])


def calendar_events() -> pd.DataFrame:
    """Every scheduled release and FOMC statement, stamped on the lake's futures clock."""
    connection = _connection()
    rows: list[dict] = []
    market = connection.execute(
        "SELECT family, CAST(epoch(timestamp) AS BIGINT) AS utc FROM read_parquet('s3://derived/recipe=market_calendar_v1/**/*.parquet', "
        "hive_partitioning = true, union_by_name = true) WHERE timestamp IS NOT NULL AND family NOT IN ('cme_holiday_close', 'wasde')"
    ).df()
    for family, utc in market.itertuples(index=False):
        rows.append({"family": family, "utc": int(utc), "scheduled": True})
    fomc = connection.execute(
        "SELECT CAST(epoch(statement_timestamp) AS BIGINT) AS utc FROM read_parquet('s3://derived/recipe=fomc_decisions_v1/**/*.parquet', "
        "hive_partitioning = true, union_by_name = true) WHERE statement_timestamp IS NOT NULL"
    ).df()
    rows += [{"family": "fomc_statement", "utc": int(u), "scheduled": True} for u in fomc["utc"]]
    for path in CALENDAR_BACKFILLS:
        if not path.exists():
            continue
        backfill = json.loads(path.read_text(encoding="utf-8"))
        for row in backfill.get("rows", []):
            local = datetime.fromisoformat(row["date"]).replace(
                hour=int(row["local_time"][:2]), minute=int(row["local_time"][3:5]), tzinfo=ZoneInfo(row.get("timezone", "America/New_York")))
            rows.append({"family": row["family"], "utc": int(local.astimezone(timezone.utc).timestamp()), "scheduled": True})
        for row in backfill.get("fomc", []):
            local = datetime.fromisoformat(row["statement_date"]).replace(
                hour=int(row["local_time"][:2]), minute=int(row["local_time"][3:5]), tzinfo=ZoneInfo(row.get("timezone", "America/New_York")))
            # an unscheduled statement (2020-03-03, 2020-03-15 ...) was unknown until it was published
            rows.append({"family": "fomc_statement", "utc": int(local.astimezone(timezone.utc).timestamp()),
                         "scheduled": bool(row.get("scheduled", True))})
    frame = pd.DataFrame(rows).sort_values("scheduled").drop_duplicates(["family", "utc"], keep="first")
    frame["stamp"] = utc_to_stamp_seconds(frame["utc"].to_numpy(np.int64))
    # scheduled times are known in advance, so they are not guarded; they carry no outcome
    return frame[["stamp", "family", "scheduled"]].sort_values("stamp").reset_index(drop=True)


# The first date the sourced calendar covers every family (evidence/calendar_2019_2020.json starts 2019-05-01);
# before it the calendar is UNKNOWN, not empty.
CALENDAR_COVERAGE_START = "2019-05-01"


def news_coverage(start: str, end: str, filter_version: str = "finance_v1") -> set[str]:
    """UTC days whose GDELT file landed complete (every upstream file ok) and whose headlines were scored."""
    from lake.layout import RAW, derived_root

    root = RAW / "vendor=gdelt_gkg" / "dataset=gkg-finance-filtered" / f"filter={filter_version}"
    scored = derived_root("multimodal_news_scores", "finbert_core_v1") / "table=titles"
    covered = set()
    for day in pd.date_range(start, end, freq="D", inclusive="left"):
        name = f"{day:%Y-%m-%d}"
        directory = root / f"day={name}"
        if not (directory / "part.parquet").exists() or not (scored / f"day={name}" / "part-0.parquet").exists():
            continue
        complete = False
        for manifest in directory.iterdir():
            if manifest.name.startswith("sources") and manifest.name.endswith(".json"):
                files = json.loads(manifest.read_text(encoding="utf-8")).get("files", [])
                complete = complete or (len(files) >= 90 and all(f.get("status") == "ok" for f in files))
        if complete:
            covered.add(name)
    return covered


def gdelt_news(start: str, end: str, filter_version: str = "finance_v1") -> pd.DataFrame:
    """GDELT finance rows known in [start, end): known_stamp (bars' clock), tone and subset flags."""
    from lake.layout import RAW

    root = RAW / "vendor=gdelt_gkg" / "dataset=gkg-finance-filtered" / f"filter={filter_version}"
    days = pd.date_range(start, end, freq="D", inclusive="left")
    parts = []
    for day in days:
        path = root / f"day={day:%Y-%m-%d}" / "part.parquet"
        if not path.exists():
            continue
        with path.open("rb") as handle:
            frame = pd.read_parquet(io.BytesIO(handle.read()), columns=["known_ts", "tone", "themes", "organisations"])
        parts.append(frame)
    if not parts:
        return pd.DataFrame(columns=["known_stamp", "tone", "is_stockmarket", "is_central_bank", "is_megacap"])
    news = pd.concat(parts, ignore_index=True)
    utc = utc_seconds(news["known_ts"])
    out = pd.DataFrame({
        "known_stamp": utc_to_stamp_seconds(utc),
        "tone": news["tone"].to_numpy(float),
        "is_stockmarket": news["themes"].fillna("").str.contains("|".join(STOCKMARKET_THEMES)).to_numpy(),
        "is_central_bank": news["organisations"].fillna("").str.contains("|".join(CENTRAL_BANK_ORGANISATIONS)).to_numpy(),
        "is_megacap": news["organisations"].fillna("").str.contains("|".join(MEGACAP_ORGANISATIONS)).to_numpy(),
    })
    holdout.guard(out["known_stamp"].to_numpy(np.int64) * 1000, what="GDELT news")
    return out.sort_values("known_stamp").reset_index(drop=True)


def finbert_headlines(start: str, end: str) -> pd.DataFrame:
    """FinBERT-scored core headlines known in [start, end) (derived/multimodal_news_scores), on the bars' clock."""
    from lake.layout import derived_root

    root = derived_root("multimodal_news_scores", "finbert_core_v1") / "table=titles"
    parts = []
    for day in pd.date_range(start, end, freq="D", inclusive="left"):
        path = root / f"day={day:%Y-%m-%d}" / "part-0.parquet"
        if not path.exists():
            continue
        with path.open("rb") as handle:
            parts.append(pd.read_parquet(io.BytesIO(handle.read()), columns=["known_ts", "finbert_score", "copies",
                                                                             "is_stockmarket", "is_central_bank", "is_megacap"]))
    if not parts:
        return pd.DataFrame(columns=["known_stamp", "finbert_score", "copies", "is_stockmarket", "is_central_bank", "is_megacap"])
    frame = pd.concat(parts, ignore_index=True)
    frame["known_stamp"] = utc_to_stamp_seconds(utc_seconds(frame["known_ts"]))
    holdout.guard(frame["known_stamp"].to_numpy(np.int64) * 1000, what="FinBERT headlines")
    return frame.drop(columns=["known_ts"]).sort_values("known_stamp").reset_index(drop=True)
