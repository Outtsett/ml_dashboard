"""`src/ml/multimodal/features.py` — causality of every feature block.

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
        for k in range(390):
            stamps.append(day + (6 * 60 + 30 + k) * 60)
            price += rng.normal(0, 2.0)
            prices.append(price)
    ts = np.array(stamps, dtype=np.int64)
    close = np.array(prices)
    open_ = np.r_[close[0], close[:-1]]
    high = np.maximum(open_, close) + rng.uniform(0, 1.5, close.size)
    low = np.minimum(open_, close) - rng.uniform(0, 1.5, close.size)
    volume = rng.integers(50, 500, close.size).astype(float)
    minutes = Minutes(ts, open_, high, low, close, volume, session_days(ts), np.array(["MNQM4"] * ts.size))
    flow = pd.DataFrame({
        "timestamp": ts, "contract": "MNQM4", "volume": volume,
        "buy_volume": volume * 0.5, "sell_volume": volume * 0.5,
        "signed_volume": rng.normal(0, 50, ts.size), "active_seconds": rng.integers(10, 60, ts.size).astype(float),
        "largest_second_volume": volume / 5, "up_seconds": rng.integers(0, 30, ts.size).astype(float),
        "down_seconds": rng.integers(0, 30, ts.size).astype(float),
    })
    es = pd.DataFrame({"timestamp": ts, "close": 5000 + np.cumsum(rng.normal(0, 0.5, ts.size))})
    days = np.unique(session_days(ts))
    daily = {"ZN": pd.DataFrame({"day": np.r_[days[0] - 3, days - 1], "close": 110 + np.cumsum(rng.normal(0, 0.2, days.size + 1))})}
    news = pd.DataFrame({
        "known_stamp": np.sort(rng.choice(ts, 400)) + rng.integers(0, 59, 400),
        "tone": rng.normal(0, 2, 400),
        "is_stockmarket": rng.random(400) < 0.3, "is_central_bank": rng.random(400) < 0.1, "is_megacap": rng.random(400) < 0.2,
    })
    events = pd.DataFrame({"stamp": ts[::1500] + 17, "family": np.where(np.arange(ts[::1500].size) % 2 == 0, "consumer_price_index", "fomc_statement")})
    return minutes, flow, {"ES": es}, daily, news, events


def build(minutes, flow, others, daily, news, events):
    bars = decision_bars(minutes)
    return features.build(bars, flow_minutes=flow, others=others, daily=daily, news=news, events=events)


def truncate(minutes: Minutes, cut_stamp: int) -> Minutes:
    keep = minutes.timestamp < cut_stamp
    return Minutes(*(getattr(minutes, name)[keep] for name in Minutes.__dataclass_fields__))


def test_every_feature_block_is_causal():
    minutes, flow, others, daily, news, events = synthetic()
    full = build(minutes, flow, others, daily, news, events)
    # cut in the middle of session 20, on a 5-minute boundary
    cut = int(minutes.timestamp[390 * 20 + 157] // 300 * 300)
    short_minutes = truncate(minutes, cut)
    short = build(
        short_minutes,
        flow[flow["timestamp"] < cut],
        {k: v[v["timestamp"] < cut] for k, v in others.items()},
        daily,   # daily closes are read only from sessions before a bar's session
        news[news["known_stamp"] < cut],
        events,  # scheduled times are known in advance
    )
    rows = short.shape[0] - 1    # the prefix's last bar may be partial
    left = full.iloc[:rows].reset_index(drop=True)
    right = short.iloc[:rows].reset_index(drop=True)
    assert list(left.columns) == list(right.columns)
    bad = [c for c in left.columns if not np.allclose(pd.to_numeric(left[c], errors="coerce"), pd.to_numeric(right[c], errors="coerce"), equal_nan=True)]
    assert not bad, f"features that read the future: {bad}"
    modalities = {features.modality_of(c) for c in full.columns if c not in ("decision_timestamp", "session", "is_decision")}
    assert modalities == {"time", "price", "flow", "cross", "news", "calendar"}


def test_warmup_is_nan_not_zero():
    minutes, *_ = synthetic(sessions=3)
    frame = features.build(decision_bars(minutes))
    assert frame["price_return_48_bars_atr"].iloc[:48].isna().all()
    assert frame["price_rsi_14"].iloc[:14].isna().all()
