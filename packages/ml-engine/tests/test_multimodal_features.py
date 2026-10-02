"""`packages/ml-engine/src/multimodal/features.py` — causality of every feature block.

The truncation test: compute every block on the full synthetic history, then on
a prefix of it, and require every row inside the prefix to be identical. A
feature that reads a later bar, a later article or a later daily close changes
when the future is cut off, and fails here.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from multimodal import features
from multimodal.data import Minutes, decision_bars, session_days

DAY = 86400
MONDAY = 1_717_977_600   # 2024-06-10 00:00, Pacific-stamp clock


def synthetic(sessions: int = 30, seed: int = 11):
    rng = np.random.default_rng(seed)
    stamps, prices = [], []
    price = 20000.0
    for d in range(sessions):
        day = MONDAY + (d + 2 * (d // 5)) * DAY          # weekdays only
        for k in range(540):                               # 05:00-13:59: pre-open, RTH and the hour after the close
            stamps.append(day + (5 * 60 + k) * 60)
            price += rng.normal(0, 2.0)
            prices.append(price)
    ts = np.array(stamps, dtype=np.int64)
    close = np.array(prices)
    open_ = np.r_[close[0], close[:-1]]
    high = np.maximum(open_, close) + rng.uniform(0, 1.5, close.size)
    low = np.minimum(open_, close) - rng.uniform(0, 1.5, close.size)
    volume = rng.integers(50, 500, close.size).astype(float)
    minutes = Minutes(ts, open_, high, low, close, volume, session_days(ts), np.array(["MNQM4"] * ts.size), close.copy())
    flow = pd.DataFrame({
        "timestamp": ts, "contract": "MNQM4", "volume": volume,
        "buy_volume": volume * 0.5, "sell_volume": volume * 0.5,
        "signed_volume": rng.normal(0, 50, ts.size), "active_seconds": rng.integers(10, 60, ts.size).astype(float),
        "largest_second_volume": volume / 5, "up_seconds": rng.integers(0, 30, ts.size).astype(float),
        "down_seconds": rng.integers(0, 30, ts.size).astype(float),
    })
    es_close = 5000 + np.cumsum(rng.normal(0, 0.5, ts.size))
    es = pd.DataFrame({"timestamp": ts, "close": es_close, "raw_close": es_close.copy()})
    days = np.unique(session_days(ts))
    daily = {"ZN": pd.DataFrame({"day": np.r_[days[0] - 3, days - 1], "close": 110 + np.cumsum(rng.normal(0, 0.2, days.size + 1))})}
    news = pd.DataFrame({
        "known_stamp": np.sort(rng.choice(ts, 400)) + rng.integers(0, 59, 400),
        "tone": rng.normal(0, 2, 400),
        "is_stockmarket": rng.random(400) < 0.3, "is_central_bank": rng.random(400) < 0.1, "is_megacap": rng.random(400) < 0.2,
    })
    events = pd.DataFrame({"stamp": ts[::1500] + 17, "family": np.where(np.arange(ts[::1500].size) % 2 == 0, "consumer_price_index", "fomc_statement")})
    headlines = pd.DataFrame({
        "known_stamp": np.sort(rng.choice(ts, 300)) + rng.integers(0, 59, 300), "finbert_score": rng.uniform(-1, 1, 300),
        "copies": rng.integers(1, 5, 300), "is_stockmarket": rng.random(300) < 0.4, "is_central_bank": rng.random(300) < 0.1,
        "is_megacap": rng.random(300) < 0.3,
    })
    news.attrs["headlines"] = headlines
    return minutes, flow, {"ES": es}, daily, news, events


def build(minutes, flow, others, daily, news, events, headlines=None):
    bars = decision_bars(minutes)
    headlines = news.attrs.get("headlines") if headlines is None else headlines
    return features.build(bars, flow_minutes=flow, others=others, daily=daily, news=news, events=events, minutes_all=minutes,
                          headlines=headlines)


def truncate(minutes: Minutes, cut_stamp: int) -> Minutes:
    keep = minutes.timestamp < cut_stamp
    return Minutes(*(getattr(minutes, name)[keep] for name in Minutes.__dataclass_fields__))


def test_every_feature_block_is_causal():
    minutes, flow, others, daily, news, events = synthetic()
    full = build(minutes, flow, others, daily, news, events)
    # cut in the middle of session 20, on a 5-minute boundary
    cut = int(minutes.timestamp[540 * 20 + 90 + 157] // 300 * 300)   # session 20, 157 minutes after the open
    short_minutes = truncate(minutes, cut)
    short = build(
        short_minutes,
        flow[flow["timestamp"] < cut],
        {k: v[v["timestamp"] < cut] for k, v in others.items()},
        daily,   # daily closes are read only from sessions before a bar's session
        news[news["known_stamp"] < cut],
        events,  # scheduled times are known in advance
        headlines=news.attrs["headlines"][news.attrs["headlines"]["known_stamp"] < cut],
    )
    rows = short.shape[0] - 1    # the prefix's last bar may be partial
    left = full.iloc[:rows].reset_index(drop=True)
    right = short.iloc[:rows].reset_index(drop=True)
    assert list(left.columns) == list(right.columns)
    bad = [c for c in left.columns if not np.allclose(pd.to_numeric(left[c], errors="coerce"), pd.to_numeric(right[c], errors="coerce"), equal_nan=True)]
    assert not bad, f"features that read the future: {bad}"
    modalities = {features.modality_of(c) for c in full.columns if c not in ("decision_timestamp", "session", "is_decision")}
    assert modalities == {"time", "price", "flow", "cross", "news", "calendar", "context"}


def test_warmup_is_nan_not_zero():
    minutes, *_ = synthetic(sessions=3)
    frame = features.build(decision_bars(minutes))
    assert frame["price_return_48_bars_atr"].iloc[:48].isna().all()
    assert frame["price_rsi_14"].iloc[:14].isna().all()


def test_features_do_not_depend_on_the_back_adjusted_level():
    """A later roll shifts every earlier adjusted price by a constant; no feature may move with it."""
    minutes, flow, others, daily, news, events = synthetic()
    base = build(minutes, flow, others, daily, news, events)
    shift = 2500.0
    shifted = Minutes(minutes.timestamp, minutes.open + shift, minutes.high + shift, minutes.low + shift, minutes.close + shift,
                      minutes.volume, minutes.session, minutes.contract, minutes.raw_close)
    shifted_others = {k: v.assign(close=v["close"] + 100.0) for k, v in others.items()}
    moved = build(shifted, flow, shifted_others, daily, news, events)
    bad = [c for c in base.columns if not np.allclose(pd.to_numeric(base[c], errors="coerce"), pd.to_numeric(moved[c], errors="coerce"), equal_nan=True)]
    assert not bad, f"features that move with the adjusted level: {bad}"


def test_unscheduled_events_are_never_forecast_and_the_calendar_is_unknown_before_its_coverage():
    minutes, *_ = synthetic(sessions=4)
    bars = decision_bars(minutes)
    session = bars.frame["session"].to_numpy()
    day2 = int(np.unique(session)[2])
    at_noon = day2 * 86400 - 9 * 3600 + 11 * 3600          # session day2's 11:00 on the bars' clock
    events = pd.DataFrame({"stamp": [at_noon], "family": ["fomc_statement"], "scheduled": [False]})
    frame = features.calendar_block(bars, events, coverage_start_session=int(np.unique(session)[1]))
    rows = session == day2
    assert frame.loc[rows, "calendar_tier_one_minutes_to_next_today"].isna().all()   # a surprise is never counted down to
    assert (frame.loc[rows, "calendar_fomc_day"] == 0).all()
    after = rows & (bars.frame["timestamp"].to_numpy() + 300 > at_noon)
    assert frame.loc[after, "calendar_tier_one_minutes_since_last_today"].notna().all()  # once published, it is known
    assert frame.loc[session < np.unique(session)[1]].isna().all().all()                  # before coverage: unknown


def test_news_outside_its_coverage_is_unknown_not_zero():
    minutes, flow, others, daily, news, events = synthetic(sessions=3)
    bars = decision_bars(minutes)
    close_utc = bars.frame["timestamp"].to_numpy() + 300 + 7 * 3600
    days = sorted(set(pd.to_datetime(close_utc, unit="s").strftime("%Y-%m-%d")))
    covered = set(days[1:])                                    # the first day's news did not land
    frame = features.news_block(bars, news, news.attrs["headlines"], covered_days=covered, decision_close_utc=close_utc)
    day_of = pd.to_datetime(close_utc, unit="s").strftime("%Y-%m-%d")
    previous_day = pd.to_datetime(close_utc - 86400, unit="s").strftime("%Y-%m-%d")
    both_covered = np.array([a in covered and b in covered for a, b in zip(day_of, previous_day)])
    assert frame.loc[~both_covered].isna().all().all()          # the trailing 24 hours reach an uncovered day
    assert both_covered.any() and frame.loc[both_covered, "news_all_count_60_minutes"].notna().all()


def test_news_timestamps_convert_whatever_their_unit():
    from multimodal import sources

    stamp = pd.Timestamp("2025-06-10 14:30:00", tz="UTC")
    for unit in ("ns", "us", "ms"):
        series = pd.Series([stamp]).astype(f"datetime64[{unit}, UTC]")
        assert sources.utc_seconds(series)[0] == int(stamp.timestamp())
