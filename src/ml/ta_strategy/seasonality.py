"""Intraday seasonality of volatility and ranging, and time events, for CME equity-index futures.

The lake stamps futures in Pacific wall clock, so a CME session runs 15:00 -> 14:00 Pacific
(1,380 minutes; the hour 14:00-15:00 is the maintenance halt). Every profile here is CAUSAL:
the value used on session s is estimated from sessions strictly before s.

Pieces
------
- ``session_offset``: minute of the session, 0 = 15:00 Pacific.
- ``Seasonal`` (built by ``build``): per minute
  * ``shape`` - the expected absolute 1-minute return of this minute's 5-minute bucket, as a
    multiple of the session's average minute (mean 1 over the session), from prior sessions
    (half from the last 120 sessions, half from the last 40 sessions on the same weekday);
  * ``level`` - the de-seasonalised volatility: an exponentially weighted mean (half-life
    60 minutes) of |r| / shape, i.e. today's average-minute |r| with the time-of-day pattern
    divided out, so it does not lag at the session transitions the way a trailing ATR does;
  * ``heat`` - level / the median level of the previous 60 sessions (above 1 = a hotter day
    than usual for any time of day);
  * ``efficiency`` - the expected efficiency ratio (|net move| / path length) of the 30 minutes
    starting in this bucket, from prior sessions: high = the bucket usually trends, low = ranges.
  From ``shape`` the expected variance over any horizon ahead or behind follows by summing
  shape^2 over the minutes (``ahead_ratio``, ``expected_move_points``).
- ``study``: the measurement tables (buckets by year and weekday, ETH vs RTH per session,
  event studies, calendar effects, profile stability and forecast skill).
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

SESSION_OPEN_MINUTE = 15 * 60          # 15:00 Pacific
SESSION_MINUTES = 23 * 60              # to 14:00 Pacific
BUCKET_MINUTES = 5
BUCKETS = SESSION_MINUTES // BUCKET_MINUTES
RTH_START_OFFSET = (6 * 60 + 30 - SESSION_OPEN_MINUTE) % 1440     # 06:30 Pacific = offset 930
RTH_END_OFFSET = (13 * 60 - SESSION_OPEN_MINUTE) % 1440           # 13:00 Pacific = offset 1320
RANGE_FACTOR = float(np.sqrt(8 / np.pi))    # expected range of a random walk / (sigma sqrt(h))
ABS_TO_SIGMA = float(np.sqrt(np.pi / 2))    # sigma / E|r| for a normal return


def session_offset(stamps: np.ndarray) -> np.ndarray:
    """Minute of the CME session (0 = 15:00 Pacific, 1379 = 13:59)."""
    minute = (np.asarray(stamps, dtype=np.int64) % 86400) // 60
    return ((minute - SESSION_OPEN_MINUTE) % 1440).astype(np.int64)


def offset_label(offset: np.ndarray | int) -> np.ndarray | str:
    minute = (np.asarray(offset) + SESSION_OPEN_MINUTE) % 1440
    if np.ndim(minute) == 0:
        return f"{int(minute) // 60:02d}:{int(minute) % 60:02d}"
    return np.array([f"{m // 60:02d}:{m % 60:02d}" for m in minute])


def session_part(offset: np.ndarray) -> np.ndarray:
    """'regular_hours' 06:30-13:00 Pacific, else 'overnight'."""
    offset = np.asarray(offset)
    return np.where((offset >= RTH_START_OFFSET) & (offset < RTH_END_OFFSET), "regular_hours", "overnight")


def _trailing_mean(values: np.ndarray, window: int, min_count: int, groups: np.ndarray | None = None) -> np.ndarray:
    """Row s = nanmean of rows [s - window, s) (strictly before s), per column; within ``groups``
    (e.g. weekday) the window counts sessions of the same group. NaN when fewer than min_count."""
    out = np.full(values.shape, np.nan)
    keys = [None] if groups is None else np.unique(groups)
    for key in keys:
        rows = np.arange(values.shape[0]) if key is None else np.flatnonzero(groups == key)
        v = values[rows]
        finite = np.isfinite(v)
        csum = np.vstack([np.zeros((1, v.shape[1])), np.cumsum(np.where(finite, v, 0.0), axis=0)])
        ccount = np.vstack([np.zeros((1, v.shape[1])), np.cumsum(finite, axis=0)])
        k = np.arange(v.shape[0])
        lo = np.maximum(k - window, 0)
        total = csum[k] - csum[lo]
        count = ccount[k] - ccount[lo]
        with np.errstate(invalid="ignore", divide="ignore"):
            out[rows] = np.where(count >= min_count, total / np.maximum(count, 1), np.nan)
    return out


def _normalise_rows(profile: np.ndarray, min_valid_share: float = 0.9) -> np.ndarray:
    """Each row scaled to mean 1 over its finite buckets; a row with too few finite buckets is NaN;
    a missing bucket inside a valid row means nothing trades then and is set to 0."""
    finite = np.isfinite(profile)
    share = finite.mean(axis=1)
    with np.errstate(invalid="ignore"):
        row_mean = np.nanmean(np.where(finite, profile, np.nan), axis=1)
    out = np.where(finite, profile, 0.0) / np.where(row_mean > 0, row_mean, np.nan)[:, None]
    out[share < min_valid_share] = np.nan
    return out


@dataclass
class Seasonal:
    session: np.ndarray            # per minute: session index
    offset: np.ndarray             # per minute: minute of the session
    session_day: np.ndarray        # per session: the CME session date
    profile: np.ndarray            # sessions x buckets: causal |r| shape, mean 1
    efficiency_profile: np.ndarray  # sessions x buckets: causal expected 30-minute efficiency ratio
    shape: np.ndarray              # per minute
    level: np.ndarray              # per minute: de-seasonalised E|r| of an average minute (log units)
    heat: np.ndarray               # per minute
    efficiency: np.ndarray         # per minute
    close: np.ndarray              # per minute
    cumulative_square: np.ndarray = field(repr=False, default=None)   # sessions x (SESSION_MINUTES + 1)

    def _window_square(self, index: np.ndarray, minutes: int, ahead: bool) -> tuple[np.ndarray, np.ndarray]:
        s, o = self.session[index], np.minimum(self.offset[index], SESSION_MINUTES - 1)
        if ahead:
            a, b = o + 1, np.minimum(o + 1 + minutes, SESSION_MINUTES)
        else:
            a, b = np.maximum(o + 1 - minutes, 0), o + 1
        q = self.cumulative_square[s, b] - self.cumulative_square[s, a]
        return q, (b - a).astype(float)

    def ahead_ratio(self, index: np.ndarray, minutes: int) -> np.ndarray:
        """Expected volatility of the next ``minutes`` over that of the last ``minutes``
        (above 1: volatility is due to rise), from the causal profile alone."""
        qa, na = self._window_square(index, minutes, True)
        qb, nb = self._window_square(index, minutes, False)
        with np.errstate(invalid="ignore", divide="ignore"):
            ratio = np.sqrt((qa / na) / (qb / nb))
        return np.where((na > 0) & (nb > 0), ratio, np.nan)

    def expected_move_points(self, index: np.ndarray, minutes: int) -> np.ndarray:
        """Expected high-low range, in index points, of the next ``minutes`` (to the session end at
        most): sqrt(8/pi) x sigma x sqrt(sum of shape^2) x price, with sigma = sqrt(pi/2) x level."""
        q, n = self._window_square(index, minutes, True)
        sigma_path = ABS_TO_SIGMA * self.level[index] * np.sqrt(np.maximum(q, 0))
        return np.where(n > 0, RANGE_FACTOR * sigma_path * self.close[index], np.nan)


def build(frame: pd.DataFrame, session_days: np.ndarray, window: int = 120, weekday_window: int = 40,
          min_sessions: int = 20, level_half_life_minutes: float = 60.0, heat_window: int = 60) -> Seasonal:
    """``frame``: one row per minute (timestamp, high, low, close) of a rebuilt one-contract series;
    ``session_days``: the CME session date of each minute (``data.session_dates``)."""
    stamps = frame["timestamp"].to_numpy(np.int64)
    close = frame["close"].to_numpy(float)
    offset = session_offset(stamps)
    new_session = np.r_[True, session_days[1:] != session_days[:-1]]
    session = np.cumsum(new_session) - 1
    n_sessions = int(session[-1]) + 1
    day_of_session = session_days[new_session]
    with np.errstate(divide="ignore", invalid="ignore"):
        r = np.r_[np.nan, np.diff(np.log(close))]
    r[new_session] = np.nan                      # the first minute of a session spans the halt: not a 1-minute return
    inside = offset < SESSION_MINUTES            # a few minutes are stamped inside the 14:00-15:00 halt: kept out of every profile
    r[~inside] = np.nan
    absolute = np.abs(r)

    bucket = np.minimum(offset // BUCKET_MINUTES, BUCKETS - 1)
    flat = session * BUCKETS + bucket
    total = np.bincount(flat, weights=np.where(np.isfinite(absolute), absolute, 0.0), minlength=n_sessions * BUCKETS)
    count = np.bincount(flat, weights=np.isfinite(absolute).astype(float), minlength=n_sessions * BUCKETS)
    with np.errstate(invalid="ignore", divide="ignore"):
        bucket_mean = (total / np.where(count > 0, count, np.nan)).reshape(n_sessions, BUCKETS)
        row_mean = np.nanmean(bucket_mean, axis=1)
        relative = bucket_mean / row_mean[:, None]
    weekday = pd.DatetimeIndex(day_of_session).dayofweek.to_numpy()
    general = _trailing_mean(relative, window, min_sessions)
    same_day = _trailing_mean(relative, weekday_window, max(min_sessions // 2, 8), groups=weekday)
    blended = np.where(np.isfinite(same_day), 0.5 * general + 0.5 * same_day, general)
    profile = _normalise_rows(blended)

    shape_minute = np.repeat(profile, BUCKET_MINUTES, axis=1)            # sessions x 1380
    cumulative_square = np.hstack([np.zeros((n_sessions, 1)), np.cumsum(shape_minute ** 2, axis=1)])
    shape = np.where(inside, profile[session, bucket], np.nan)

    with np.errstate(invalid="ignore", divide="ignore"):
        deseasonalised = np.where(shape > 0, absolute / shape, np.nan)
    level = pd.Series(deseasonalised).ewm(halflife=level_half_life_minutes, ignore_na=True,
                                          min_periods=60).mean().to_numpy()
    session_level = pd.Series(level).groupby(session).mean()
    typical = session_level.shift(1).rolling(heat_window, min_periods=min_sessions).median().to_numpy()
    with np.errstate(invalid="ignore", divide="ignore"):
        heat = level / typical[session]

    # expected efficiency of the 30 minutes starting in each bucket
    matrix = np.full((n_sessions, SESSION_MINUTES), np.nan)
    matrix[session[inside], offset[inside]] = close[inside]
    filled = pd.DataFrame(matrix).ffill(axis=1).to_numpy()
    steps = np.abs(np.diff(filled, axis=1))
    path = np.hstack([np.zeros((n_sessions, 1)), np.nancumsum(steps, axis=1)])
    starts = np.arange(BUCKETS) * BUCKET_MINUTES
    ends = np.minimum(starts + 30, SESSION_MINUTES - 1)
    with np.errstate(invalid="ignore", divide="ignore"):
        efficiency_now = np.abs(filled[:, ends] - filled[:, starts]) / (path[:, ends] - path[:, starts])
    efficiency_profile = _trailing_mean(efficiency_now, window, min_sessions)

    return Seasonal(session=session, offset=offset, session_day=day_of_session, profile=profile,
                    efficiency_profile=efficiency_profile, shape=shape, level=level, heat=heat,
                    efficiency=np.where(inside, efficiency_profile[session, bucket], np.nan), close=close,
                    cumulative_square=cumulative_square)


# ── time events ──────────────────────────────────────────────────────────────
# Clock anchors on the Pacific-stamp clock. US anchors are fixed in Pacific all year (ET - 3 h);
# Tokyo and London are converted from their own clocks, so they move when the US and their
# daylight-saving dates differ (London 01:00 PT for 1-3 weeks in March and in Oct/Nov).
US_CLOCK_ANCHORS = {"globex_open": None, "us_data_0830": "05:30", "rth_open": "06:30", "us_data_1000": "07:00",
                    "rth_close": "13:00", "session_end": "14:00"}
FOREIGN_ANCHORS = {"tokyo_open": ("09:00", "Asia/Tokyo"), "london_open": ("08:00", "Europe/London")}
RELEASE_GROUPS = {
    "release_0830": ("consumer_price_index", "employment_situation", "producer_price_index", "retail_sales",
                     "gross_domestic_product", "personal_income_and_outlays", "durable_goods"),
    "release_1000": ("ism_manufacturing_pmi", "ism_services_pmi", "job_openings_and_labor_turnover",
                     "michigan_consumer_sentiment"),
    "fomc_statement": ("fomc_statement",),
    "consumer_price_index": ("consumer_price_index",),
    "employment_situation": ("employment_situation",),
}
FLAG_NAMES = ("expiry_day", "expiry_week", "month_start", "month_end", "fomc_day", "release_0830_day",
              "release_1000_day", "high_impact_day", "after_holiday", "before_holiday")


def calendar_frame(evidence_dir=None) -> pd.DataFrame:
    """Scheduled releases and FOMC statements on the Pacific-stamp clock (``stamp`` seconds, ``family``):
    the lake calendars through ``multimodal.sources.calendar_events`` plus the 2010-2019 backfill."""
    import json
    from datetime import datetime, timezone
    from pathlib import Path
    from zoneinfo import ZoneInfo

    from multimodal.sources import EVIDENCE, calendar_events, utc_to_stamp_seconds

    frame = calendar_events()
    extra = Path(evidence_dir or EVIDENCE) / "calendar_2010_2019.json"
    if extra.exists():
        rows = []
        backfill = json.loads(extra.read_text(encoding="utf-8"))
        for row in backfill.get("rows", []):
            local = datetime.fromisoformat(row["date"]).replace(hour=int(row["local_time"][:2]), minute=int(row["local_time"][3:5]),
                                                                tzinfo=ZoneInfo(row.get("timezone", "America/New_York")))
            rows.append({"family": row["family"], "utc": int(local.astimezone(timezone.utc).timestamp())})
        for row in backfill.get("fomc", []):
            local = datetime.fromisoformat(row["statement_date"]).replace(hour=int(row["local_time"][:2]), minute=int(row["local_time"][3:5]),
                                                                          tzinfo=ZoneInfo(row.get("timezone", "America/New_York")))
            rows.append({"family": "fomc_statement", "utc": int(local.astimezone(timezone.utc).timestamp())})
        if rows:
            more = pd.DataFrame(rows)
            more["stamp"] = utc_to_stamp_seconds(more["utc"].to_numpy(np.int64))
            frame = pd.concat([frame, more[["stamp", "family"]]], ignore_index=True)
    return frame.drop_duplicates(["family", "stamp"]).sort_values("stamp").reset_index(drop=True)


def _third_friday(year: int, month: int) -> pd.Timestamp:
    first = pd.Timestamp(year=year, month=month, day=1)
    return first + pd.Timedelta(days=(4 - first.dayofweek) % 7 + 14)


@dataclass
class TimeEvents:
    session: np.ndarray             # per minute
    stamps: np.ndarray              # per minute
    anchors: dict                   # event -> per-session stamp (float seconds, NaN when absent)
    flags: dict                     # flag -> per-session bool
    weekday: np.ndarray             # per session, 0 = Monday
    covered_from: float             # first stamp the release calendar covers

    def minutes_since(self, index: np.ndarray, event: str) -> np.ndarray:
        at = self.anchors[event][self.session[index]]
        delta = (self.stamps[index] - at) / 60.0
        return np.where(np.isfinite(at) & (delta >= 0), delta, np.nan)

    def minutes_until(self, index: np.ndarray, event: str) -> np.ndarray:
        at = self.anchors[event][self.session[index]]
        delta = (at - self.stamps[index]) / 60.0
        return np.where(np.isfinite(at) & (delta > 0), delta, np.nan)

    def flag(self, index: np.ndarray, name: str) -> np.ndarray:
        return self.flags[name][self.session[index]].astype(float)


def time_events(stamps: np.ndarray, session_days: np.ndarray, calendar: pd.DataFrame | None) -> TimeEvents:
    from zoneinfo import ZoneInfo

    stamps = np.asarray(stamps, dtype=np.int64)
    new_session = np.r_[True, session_days[1:] != session_days[:-1]]
    session = np.cumsum(new_session) - 1
    days = pd.DatetimeIndex(session_days[new_session])
    day_seconds = (days.asi8 // 10**9).astype(np.int64)
    anchors = {}
    for name, clock in US_CLOCK_ANCHORS.items():
        if clock is None:
            anchors[name] = (day_seconds - 9 * 3600).astype(float)
        else:
            anchors[name] = (day_seconds + int(clock[:2]) * 3600 + int(clock[3:]) * 60).astype(float)
    pacific = ZoneInfo("America/Los_Angeles")
    for name, (clock, zone) in FOREIGN_ANCHORS.items():
        values = []
        for d in days:
            local = pd.Timestamp(year=d.year, month=d.month, day=d.day, hour=int(clock[:2]), minute=int(clock[3:]), tz=zone)
            values.append(local.tz_convert(pacific).tz_localize(None).value // 10**9)
        anchors[name] = np.asarray(values, dtype=float)

    covered_from = np.inf
    session_of_day = pd.Series(np.arange(days.size), index=days)
    for group, families in RELEASE_GROUPS.items():
        at = np.full(days.size, np.nan)
        if calendar is not None and len(calendar):
            rows = calendar[calendar["family"].isin(families)]
            if len(rows):
                covered_from = min(covered_from, float(rows["stamp"].min()))
                event_days = pd.DatetimeIndex(pd.to_datetime(rows["stamp"].to_numpy(np.int64) + 9 * 3600, unit="s").normalize())
                for stamp, day in zip(rows["stamp"].to_numpy(np.int64), event_days):
                    k = session_of_day.get(day)
                    if k is not None and not (np.isfinite(at[k]) and at[k] <= stamp):
                        at[k] = float(stamp)
        anchors[group] = at

    weekday = days.dayofweek.to_numpy()
    third = {(y, mth): _third_friday(y, mth) for y in range(days.year.min(), days.year.max() + 1) for mth in (3, 6, 9, 12)}
    expiry_day = np.array([d.month in (3, 6, 9, 12) and d == third[(d.year, d.month)] for d in days])
    expiry_week = np.array([d.month in (3, 6, 9, 12) and 0 <= (third[(d.year, d.month)] - d).days <= 4 for d in days])
    month = days.month.to_numpy()
    month_start = np.r_[True, month[1:] != month[:-1]]
    month_end = np.r_[month[1:] != month[:-1], False]
    gap_before = np.r_[1, (days[1:] - days[:-1]).days]
    after_holiday = (gap_before > 1) & ~((weekday == 0) & (gap_before == 3))
    before_holiday = np.r_[after_holiday[1:], False]
    flags = {"expiry_day": expiry_day, "expiry_week": expiry_week, "month_start": month_start, "month_end": month_end,
             "fomc_day": np.isfinite(anchors["fomc_statement"]), "release_0830_day": np.isfinite(anchors["release_0830"]),
             "release_1000_day": np.isfinite(anchors["release_1000"]),
             "high_impact_day": np.isfinite(anchors["fomc_statement"]) | np.isfinite(anchors["consumer_price_index"])
             | np.isfinite(anchors["employment_situation"]),
             "after_holiday": after_holiday, "before_holiday": before_holiday}
    return TimeEvents(session=session, stamps=stamps, anchors=anchors, flags=flags, weekday=weekday,
                      covered_from=covered_from)
