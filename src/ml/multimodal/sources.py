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
ORDERFLOW = "s3://derived/multimodal_orderflow/recipe=tick_rule_1s_v1/table=minutes/*.parquet"
CALENDAR_BACKFILL = Path(__file__).resolve().parents[3] / "docs" / "plans" / "2026-09-29-multimodal" / "evidence" / "calendar_2019_2020.json"
STOCKMARKET_THEMES = ("ECON_STOCKMARKET",)
CENTRAL_BANK_ORGANISATIONS = ("federal reserve", "european central bank", "bank of japan", "bank of england")
MEGACAP_ORGANISATIONS = ("apple", "microsoft", "nvidia", "amazon", "alphabet", "google", "meta platforms", "facebook",
                         "tesla", "broadcom", "netflix", "advanced micro devices")


def _connection(with_bars: bool = False):
    from lake.serving import connect

    connection = connect(with_bars=with_bars, with_derived=False)
    connection.execute("SET TimeZone='UTC'")
    return connection


def utc_to_stamp_seconds(utc_seconds: np.ndarray) -> np.ndarray:
    """True-UTC epoch seconds → Pacific wall-clock digits read as UTC (the lake's futures clock)."""
    values = np.asarray(utc_seconds, dtype=np.int64)
    if values.size == 0:
        return values
    index = pd.to_datetime(values, unit="s", utc=True).tz_convert(PACIFIC).tz_localize(None)
    return (index.asi8 // 1_000_000_000).astype(np.int64)


def flow_minutes(start: str, end: str) -> pd.DataFrame:
    connection = _connection()
    frame = connection.execute(
        f"SELECT symbol AS contract, CAST(epoch(minute) AS BIGINT) AS timestamp, volume, buy_volume, sell_volume, "
        f"signed_volume, active_seconds, largest_second_volume, up_seconds, down_seconds FROM read_parquet('{ORDERFLOW}') "
        "WHERE minute >= CAST(? AS TIMESTAMP) AND minute < CAST(? AS TIMESTAMP)",
        [start, end],
    ).df()
    holdout.guard(frame["timestamp"].to_numpy(np.int64) * 1000, what="order flow")
    return frame


def other_minutes(root: str, start: str, end: str) -> pd.DataFrame:
    from multimodal.data import load_minutes

    minutes = load_minutes(start, end, root=root)
    return pd.DataFrame({"timestamp": minutes.timestamp, "close": minutes.close})


def daily_closes(symbols: list[str]) -> dict[str, pd.DataFrame]:
    connection = _connection(with_bars=True)
    placeholders = ",".join("?" for _ in symbols)
    frame = connection.execute(
        f"SELECT symbol, CAST(epoch(ts) AS BIGINT) AS ts, close FROM bars WHERE timeframe = '1d' AND symbol IN ({placeholders}) ORDER BY symbol, ts",
        symbols,
    ).df()
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
        rows.append({"family": family, "utc": int(utc)})
    fomc = connection.execute(
        "SELECT CAST(epoch(statement_timestamp) AS BIGINT) AS utc FROM read_parquet('s3://derived/recipe=fomc_decisions_v1/**/*.parquet', "
        "hive_partitioning = true, union_by_name = true) WHERE statement_timestamp IS NOT NULL"
    ).df()
    rows += [{"family": "fomc_statement", "utc": int(u)} for u in fomc["utc"]]
    if CALENDAR_BACKFILL.exists():
        backfill = json.loads(CALENDAR_BACKFILL.read_text(encoding="utf-8"))
        for row in backfill.get("rows", []):
            local = datetime.fromisoformat(row["date"]).replace(
                hour=int(row["local_time"][:2]), minute=int(row["local_time"][3:5]), tzinfo=ZoneInfo(row.get("timezone", "America/New_York")))
            rows.append({"family": row["family"], "utc": int(local.astimezone(timezone.utc).timestamp())})
        for row in backfill.get("fomc", []):
            local = datetime.fromisoformat(row["statement_date"]).replace(
                hour=int(row["local_time"][:2]), minute=int(row["local_time"][3:5]), tzinfo=ZoneInfo(row.get("timezone", "America/New_York")))
            rows.append({"family": "fomc_statement", "utc": int(local.astimezone(timezone.utc).timestamp())})
    frame = pd.DataFrame(rows).drop_duplicates(["family", "utc"])
    frame["stamp"] = utc_to_stamp_seconds(frame["utc"].to_numpy(np.int64))
    # scheduled times are known in advance, so they are not guarded; they carry no outcome
    return frame[["stamp", "family"]].sort_values("stamp").reset_index(drop=True)


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
    utc = news["known_ts"].astype("int64").to_numpy() // 1_000_000_000 if news["known_ts"].dtype.kind == "M" else pd.to_datetime(news["known_ts"], utc=True).astype("int64").to_numpy() // 1_000_000_000
    out = pd.DataFrame({
        "known_stamp": utc_to_stamp_seconds(utc),
        "tone": news["tone"].to_numpy(float),
        "is_stockmarket": news["themes"].fillna("").str.contains("|".join(STOCKMARKET_THEMES)).to_numpy(),
        "is_central_bank": news["organisations"].fillna("").str.contains("|".join(CENTRAL_BANK_ORGANISATIONS)).to_numpy(),
        "is_megacap": news["organisations"].fillna("").str.contains("|".join(MEGACAP_ORGANISATIONS)).to_numpy(),
    })
    holdout.guard(out["known_stamp"].to_numpy(np.int64) * 1000, what="GDELT news")
    return out.sort_values("known_stamp").reset_index(drop=True)
