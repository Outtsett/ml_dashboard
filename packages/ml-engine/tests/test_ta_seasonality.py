"""Seasonality and time events for the conditional strategies (packages/ml-engine/src/ta_strategy/seasonality.py)."""

from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src" / "ml"))
sys.path.insert(0, str(ROOT / "src"))

from ta_strategy import engine, seasonality, strategy  # noqa: E402
from ta_strategy.data import session_dates  # noqa: E402


def synthetic_minutes(sessions: int = 60, seed: int = 0, loud_offset: int = 930) -> pd.DataFrame:
    """Full 23-hour sessions of 1-minute closes; volatility 4x in the five minutes from ``loud_offset``."""
    rng = np.random.default_rng(seed)
    days = pd.bdate_range("2024-01-02", periods=sessions)
    stamps, closes = [], []
    price = 20000.0
    for d in days:
        start = int(pd.Timestamp(d).value // 10**9) - 9 * 3600          # 15:00 Pacific the evening before
        for o in range(seasonality.SESSION_MINUTES):
            scale = 4.0 if loud_offset <= o < loud_offset + 5 else 1.0
            price *= np.exp(rng.normal(0, 0.0002 * scale))
            stamps.append(start + o * 60)
            closes.append(price)
    closes = np.asarray(closes)
    return pd.DataFrame({"timestamp": np.asarray(stamps, dtype=np.int64), "open": closes, "high": closes + 0.25,
                         "low": closes - 0.25, "close": closes, "volume": 1.0})


def test_offsets_and_labels():
    stamps = np.array([15 * 3600, 6 * 3600 + 30 * 60, 13 * 3600 + 59 * 60])
    assert seasonality.session_offset(stamps).tolist() == [0, seasonality.RTH_START_OFFSET, 1379]
    assert seasonality.offset_label(seasonality.RTH_START_OFFSET) == "06:30"
    assert seasonality.session_part(np.array([929, 930, 1319, 1320])).tolist() == ["overnight", "regular_hours", "regular_hours", "overnight"]


def test_profile_finds_the_loud_bucket_and_is_causal():
    frame = synthetic_minutes()
    days = session_dates(frame["timestamp"].to_numpy(np.int64))
    s = seasonality.build(frame, days, window=30, min_sessions=10)
    loud = seasonality.RTH_START_OFFSET // seasonality.BUCKET_MINUTES
    last = s.profile[-1]
    assert last[loud] > 3.0 and np.nanmedian(last) < 1.2
    assert np.isnan(s.profile[:10]).all()                         # no history yet: no profile
    # truncation: the profile of session k must not change when later sessions change
    changed = frame.copy()
    tail = session_dates(changed["timestamp"].to_numpy(np.int64)) >= days[-1]
    changed.loc[tail, "close"] *= np.exp(np.linspace(0, 0.3, tail.sum()))
    s2 = seasonality.build(changed, days, window=30, min_sessions=10)
    np.testing.assert_allclose(s.profile[:-1], s2.profile[:-1], equal_nan=True)
    first_last = np.flatnonzero(s.session == s.session[-1])[0]
    np.testing.assert_allclose(s.level[:first_last], s2.level[:first_last], equal_nan=True)


def test_ahead_ratio_rises_into_the_loud_bucket_and_expected_move_scales():
    frame = synthetic_minutes()
    days = session_dates(frame["timestamp"].to_numpy(np.int64))
    s = seasonality.build(frame, days, window=30, min_sessions=10)
    last_session = np.flatnonzero(s.session == s.session[-1])
    before = last_session[seasonality.RTH_START_OFFSET - 10]      # 06:20
    after = last_session[seasonality.RTH_START_OFFSET + 30]       # 07:00
    assert s.ahead_ratio(np.array([before]), 15)[0] > 1.5
    assert s.ahead_ratio(np.array([after]), 15)[0] < 1.1
    short, long = s.expected_move_points(np.array([after, after]), 15)[0], s.expected_move_points(np.array([after]), 60)[0]
    assert long == pytest.approx(short * 2, rel=0.05)             # quiet minutes: range grows with sqrt(time)


def test_time_events_anchor_london_and_tokyo_on_the_pacific_clock():
    days = pd.DatetimeIndex(["2024-03-12", "2024-04-02", "2024-10-29", "2024-11-12"])     # US-UK DST mismatch: Mar 12, Oct 29
    stamps = np.array([int(d.value // 10**9) for d in days], dtype=np.int64)            # midnight of each session day
    t = seasonality.time_events(stamps, days.values, None)
    london = (t.anchors["london_open"] % 86400) // 60
    assert london.tolist() == [60, 0, 60, 0]
    tokyo = ((t.anchors["tokyo_open"] % 86400) // 60).tolist()
    assert tokyo == [17 * 60, 17 * 60, 17 * 60, 16 * 60]
    assert (t.anchors["tokyo_open"] < stamps).all()                 # the evening before, inside the session
    assert ((t.anchors["rth_open"] - stamps) == 6 * 3600 + 30 * 60).all()


def test_expiry_week_and_calendar_release_days():
    days = pd.bdate_range("2024-03-11", "2024-03-22")
    stamps = np.array([int(d.value // 10**9) + 6 * 3600 for d in days], dtype=np.int64)
    others = [f for f in seasonality.RELEASE_GROUPS["release_0830"] if f != "consumer_price_index"]
    calendar = pd.DataFrame({"stamp": [int(pd.Timestamp("2024-03-12 05:30").value // 10**9),
                                       int(pd.Timestamp("2024-03-20 11:00").value // 10**9),
                                       int(pd.Timestamp("2024-03-19 11:00").value // 10**9)]
                             + [int(pd.Timestamp("2024-03-01 05:30").value // 10**9)] * len(others),
                             "family": ["consumer_price_index", "fomc_statement", "fomc_statement"] + others,
                             "scheduled": [True, True, False] + [True] * len(others)})
    t = seasonality.time_events(stamps, days.values, calendar)
    labels = [str(d.date()) for d in days]
    assert [labels[k] for k in np.flatnonzero(t.flags["expiry_day"])] == ["2024-03-15"]
    assert [labels[k] for k in np.flatnonzero(t.flags["expiry_week"])] == ["2024-03-11", "2024-03-12", "2024-03-13", "2024-03-14", "2024-03-15"]
    assert [labels[k] for k in np.flatnonzero(t.flags["fomc_day"])] == ["2024-03-20"]    # the unscheduled 03-19 statement is ignored
    assert [labels[k] for k in np.flatnonzero(t.flags["high_impact_day"])] == ["2024-03-12", "2024-03-20"]
    k = labels.index("2024-03-12")
    assert t.minutes_since(np.array([k]), "release_0830")[0] == pytest.approx(30.0)   # stamp 06:00, release 05:30
    assert np.isnan(t.minutes_until(np.array([k]), "release_0830")[0])               # already passed
    assert np.isnan(t.minutes_since(np.array([k + 1]), "release_0830")[0])           # no release that session


def test_release_group_needs_every_family_and_flags_follow_the_exchange_calendar():
    days = pd.bdate_range("2024-03-25", "2024-04-05")          # Good Friday 2024-03-29 is an NYSE holiday
    days = days[days != pd.Timestamp("2024-03-29")]
    stamps = np.array([int(d.value // 10**9) + 6 * 3600 for d in days], dtype=np.int64)
    only_cpi = pd.DataFrame({"stamp": [int(pd.Timestamp("2024-04-02 05:30").value // 10**9)], "family": ["consumer_price_index"],
                             "scheduled": [True]})
    t = seasonality.time_events(stamps, days.values, only_cpi)
    assert not t.flags["release_0830_day"].any()                 # the 08:30 group is not covered by CPI alone
    assert t.flags["high_impact_day"].sum() == 1                 # CPI itself still marks a high-impact day
    labels = [str(d.date()) for d in days]
    assert [labels[k] for k in np.flatnonzero(t.flags["before_holiday"])] == ["2024-03-28"]
    assert [labels[k] for k in np.flatnonzero(t.flags["after_holiday"])] == ["2024-04-01"]
    assert [labels[k] for k in np.flatnonzero(t.flags["month_end"])] == ["2024-03-28"]
    assert [labels[k] for k in np.flatnonzero(t.flags["month_start"])] == ["2024-04-01"]
    # the flags come from the calendar, not from which session follows in the data
    cut = seasonality.time_events(stamps[:4], days.values[:4], only_cpi)
    assert cut.flags["month_end"].tolist() == t.flags["month_end"][:4].tolist()
    assert cut.flags["before_holiday"].tolist() == t.flags["before_holiday"][:4].tolist()


def test_every_seasonal_series_is_unchanged_by_later_data():
    frame = synthetic_minutes(sessions=45, seed=3)
    days = session_dates(frame["timestamp"].to_numpy(np.int64))
    full = seasonality.build(frame, days, window=30, min_sessions=10)
    cut_at = np.flatnonzero(days == np.unique(days)[40])[0] + 700
    part = seasonality.build(frame.iloc[:cut_at], days[:cut_at], window=30, min_sessions=10)
    index = np.arange(cut_at)
    for name in ("shape", "level", "heat", "efficiency"):
        np.testing.assert_allclose(getattr(part, name), getattr(full, name)[:cut_at], equal_nan=True, err_msg=name)
    for minutes in (15, 60):
        np.testing.assert_allclose(part.ahead_ratio(index, minutes), full.ahead_ratio(index, minutes), equal_nan=True)
        np.testing.assert_allclose(part.expected_move_points(index, minutes), full.expected_move_points(index, minutes), equal_nan=True)


def fake_ctx(n=8):
    close = np.linspace(100, 107, n)
    return SimpleNamespace(bar_end=np.arange(n) * 300, bars={"open": close, "high": close + 0.5, "low": close - 0.5, "close": close,
                                                            "volume": np.ones(n)},
                           atr=np.full(n, 2.0), start_minute=np.full(n, 420), cache={}, timeframe="5m", tick=0.25,
                           zones=pd.DataFrame({"support_low": np.full(n, 90.0), "resistance_high": np.full(n, 120.0)}))


def test_in_set_between_and_series_sized_exits():
    ctx = fake_ctx()
    assert strategy.condition(ctx, {"op": "in_set", "a": "close", "values": [100, 101]}).tolist() == [True, True] + [False] * 6
    between = strategy.condition(ctx, {"op": "between", "a": "close", "low": {"const": 102}, "high": {"const": 104}})
    assert between.tolist() == [False, False, True, True, False, False, False, False]
    spec = {"exit": {"stop": {"kind": "series", "of": {"const": 5.0}, "mult": 0.5},
                     "target": {"kind": "series", "long_of": {"const": 3.0}, "short_of": {"const": 4.0}, "mult": 1.0}}}
    plan = strategy.plans(ctx, spec, np.array([1, 2]), np.array([1, -1], dtype=np.int8))
    assert plan[:, engine.P_STOP_TICKS].tolist() == [10.0, 10.0]          # 0.5 x 5 points / 0.25
    assert plan[:, engine.P_TARGET_TICKS].tolist() == [12.0, 16.0]
    assert np.isnan(plan[:, engine.P_TARGET_R]).all()


def test_event_range_is_known_only_after_its_window():
    frame = synthetic_minutes(sessions=3)
    days = session_dates(frame["timestamp"].to_numpy(np.int64))
    stamps = frame["timestamp"].to_numpy(np.int64)
    minutes = SimpleNamespace(stamps=stamps, high=frame["high"].to_numpy(float), low=frame["low"].to_numpy(float),
                              session_id=np.cumsum(np.r_[True, days[1:] != days[:-1]]) - 1, days=days)
    last_minute = np.arange(4, stamps.size, 5)
    ctx = SimpleNamespace(minutes=minutes, last_minute=last_minute, bar_end=stamps[last_minute] + 60, time=None, calendar=pd.DataFrame(
        {"stamp": pd.Series(dtype=np.int64), "family": pd.Series(dtype=str)}))
    high = strategy._event_extreme(ctx, "rth_open", 15, True)
    t = strategy._time(ctx)
    since = t.minutes_since(last_minute, "rth_open")
    known = np.isfinite(high)
    assert known.any()
    assert (since[known] >= 14).all()                                   # bar closing at 06:45 is the first that knows it
    session = minutes.session_id[last_minute[known][0]]
    window = (stamps >= t.anchors["rth_open"][session]) & (stamps < t.anchors["rth_open"][session] + 900)
    assert high[known][0] == pytest.approx(minutes.high[window].max())


def test_flow_imbalance_joins_by_contract_and_minute_and_is_unknown_outside_coverage(monkeypatch):
    import multimodal.sources as sources

    stamps = np.arange(1_700_000_040, 1_700_000_040 + 60 * 12, 60, dtype=np.int64)
    frame = pd.DataFrame({"timestamp": stamps, "contract": ["MNQZ3"] * 12})
    flow = pd.DataFrame({"timestamp": stamps[:8], "contract": ["MNQZ3"] * 8,
                         "signed_volume": [10.0, -4.0, 6.0, 0.0, 8.0, -2.0, 4.0, 2.0], "volume": [20.0] * 8})
    flow = flow.drop(index=3)                                  # a covered minute with no row counts as zero flow
    monkeypatch.setattr(sources, "flow_minutes", lambda start, end, root="MNQ": flow)
    ctx = SimpleNamespace(minutes_frame=frame, minutes=SimpleNamespace(stamps=stamps), last_minute=np.array([3, 7, 11]), flow=None)
    imbalance = strategy._flow_imbalance(ctx, 4)
    assert imbalance[0] == pytest.approx((10 - 4 + 6 + 0) / 60)          # minute 3 had no row: volume 0, signed 0
    assert imbalance[1] == pytest.approx((8 - 2 + 4 + 2) / 80)
    assert np.isnan(imbalance[2])                                        # minutes 8-11 are after the flow's last minute


def test_new_templates_materialize():
    import json

    config = json.loads((ROOT / "src" / "config" / "ta_conditional_templates.json").read_text(encoding="utf-8"))["templates"]
    for name in ("seasonal_breakout_rth", "seasonal_breakout_eth", "seasonal_fade_rth", "seasonal_fade_eth",
                 "atr_breakout_control_rth", "atr_breakout_control_eth", "event_breakout_rth_open",
                 "event_breakout_london_open", "event_breakout_us_data_0830"):
        spec = strategy.materialize(config[name], config[name]["defaults"])
        assert "{\"param\"" not in json.dumps(spec)
        assert set(config[name]["defaults"]) == set(config[name]["params"])
