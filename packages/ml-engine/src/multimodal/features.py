"""Features at every decision bar, one block per modality.

Level-free: a percentage change is measured against the price AS TRADED
(`raw_close`), never against the back-adjusted level, whose value depends on
the roll gaps that come later; every other price quantity is a difference in
points divided by the ATR. Shifting the adjusted prices by a constant changes
no feature (tests/test_multimodal_features.py).

Every value at decision bar t is computed from data known at t's CLOSE: bars up
to and including t, order flow up to t's last minute, cross-asset bars that
closed by then, daily series from sessions before t's session, news known
before t's close, and scheduled (not realised) calendar times. Warm-up values
are NaN, never zero. The truncation test in tests/test_multimodal_features.py
recomputes every block on a prefix of the data and requires identical values.

Blocks (column prefixes):
    price_     MNQ 5-minute RTH bars: multi-horizon returns, volatility, range position, VWAP, trend, volume
    flow_      tick-rule order flow from the 1-second bars (buy/sell imbalance, activity)
    cross_     ES / RTY / YM intraday returns and spreads against MNQ; daily rates, metals and dollar (prior session)
    context_   the overnight session, the opening range and the previous sessions
    news_      GDELT GKG finance news (counts and tone over trailing windows)
    calendar_  scheduled macro releases and FOMC statements (time to / since, event-day flags)
    time_      time of day and day of week
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from multimodal.data import DECISION_MINUTES, RTH_OPEN_MINUTE, DecisionBars, Minutes, minute_of_day

HORIZONS_BARS = (1, 3, 6, 12, 24, 48)
CALENDAR_TIER_ONE = ("consumer_price_index", "employment_situation", "fomc_statement", "producer_price_index",
                     "gross_domestic_product", "retail_sales", "personal_income_and_outlays")
CALENDAR_FAMILIES = CALENDAR_TIER_ONE + ("job_openings_and_labor_turnover", "durable_goods", "ism_manufacturing_pmi",
                                         "ism_services_pmi", "michigan_consumer_sentiment")
FLOW_WINDOWS_MINUTES = (5, 15, 30, 60)
NEWS_WINDOWS_MINUTES = (15, 60, 240)


def _rolling_same_time(values: pd.Series, keys: pd.Series, sessions: int) -> pd.Series:
    """Mean of the value at the same time of day over the previous `sessions` sessions (excludes today)."""
    return values.groupby(keys).transform(lambda s: s.shift(1).rolling(sessions, min_periods=sessions).mean())


def price_block(bars: DecisionBars) -> pd.DataFrame:
    f = bars.frame
    close = f["close"].to_numpy(float)
    atr = f["atr_points"].to_numpy(float)
    session = f["session"].to_numpy()
    out = pd.DataFrame(index=f.index)
    for k in HORIZONS_BARS:
        past = pd.Series(close).shift(k).to_numpy()
        out[f"price_return_{k}_bars_atr"] = (close - past) / atr
    raw_close = f["raw_close"].to_numpy(float)
    returns = pd.Series(np.r_[np.nan, np.diff(close) / raw_close[:-1]])     # percentage change as traded
    for k in (6, 12, 48):
        out[f"price_volatility_{k}_bars"] = returns.rolling(k, min_periods=k).std().to_numpy()
    out["price_volatility_ratio_6_48"] = out["price_volatility_6_bars"] / out["price_volatility_48_bars"]
    out["price_atr_points"] = atr
    out["price_atr_ratio_to_20_sessions"] = atr / pd.Series(atr).rolling(78 * 20, min_periods=78 * 5).mean().to_numpy()
    # the session so far (RTH): open, high, low, VWAP
    g = pd.DataFrame({"session": session, "high": f["high"], "low": f["low"], "open": f["open"], "close": close,
                      "volume": f["volume"], "typical": (f["high"] + f["low"] + f["close"]) / 3})
    session_open = g.groupby("session")["open"].transform("first").to_numpy()
    day_high = g.groupby("session")["high"].cummax().to_numpy()
    day_low = g.groupby("session")["low"].cummin().to_numpy()
    pv = (g["typical"] * g["volume"]).groupby(g["session"]).cumsum()
    vv = g["volume"].groupby(g["session"]).cumsum()
    vwap = (pv / vv.replace(0, np.nan)).to_numpy()
    out["price_return_since_open_atr"] = (close - session_open) / atr
    out["price_position_in_day_range"] = np.where(day_high > day_low, (close - day_low) / (day_high - day_low), np.nan)
    out["price_distance_to_vwap_atr"] = (close - vwap) / atr
    out["price_day_range_atr"] = (day_high - day_low) / atr
    # previous session's RTH close, high and low; the overnight gap
    per_session = g.groupby("session").agg(last_close=("close", "last"), high=("high", "max"), low=("low", "min"), first_open=("open", "first"))
    previous = per_session.shift(1)
    prev_close = pd.Series(session).map(previous["last_close"]).to_numpy()
    prev_high = pd.Series(session).map(previous["high"]).to_numpy()
    prev_low = pd.Series(session).map(previous["low"]).to_numpy()
    out["price_gap_from_previous_close_atr"] = (session_open - prev_close) / atr
    out["price_distance_to_previous_high_atr"] = (close - prev_high) / atr
    out["price_distance_to_previous_low_atr"] = (close - prev_low) / atr
    # trend: least-squares slope t-statistic of the last 12 and 48 closes
    for k in (12, 48):
        x = np.arange(k, dtype=float)
        x = x - x.mean()
        windows = np.lib.stride_tricks.sliding_window_view(close, k)
        slope = (windows - windows.mean(axis=1, keepdims=True)) @ x / (x @ x)
        fitted = windows.mean(axis=1, keepdims=True) + np.outer(slope, x)
        residual = np.sqrt(((windows - fitted) ** 2).sum(axis=1) / (k - 2))
        t_stat = slope / (residual / np.sqrt(x @ x))
        column = np.full(close.size, np.nan)
        column[k - 1:] = t_stat
        out[f"price_trend_t_statistic_{k}_bars"] = column
    # RSI(14) and Bollinger z(20) on 5-minute closes
    delta = pd.Series(close).diff()
    gain = delta.clip(lower=0).rolling(14, min_periods=14).mean()
    loss = (-delta.clip(upper=0)).rolling(14, min_periods=14).mean()
    out["price_rsi_14"] = (100 - 100 / (1 + gain / loss.replace(0, np.nan))).to_numpy()
    mean20 = pd.Series(close).rolling(20, min_periods=20).mean()
    std20 = pd.Series(close).rolling(20, min_periods=20).std()
    out["price_bollinger_z_20"] = ((pd.Series(close) - mean20) / std20).to_numpy()
    # bar anatomy of the decision bar
    rng = (f["high"] - f["low"]).to_numpy(float)
    out["price_bar_body_atr"] = (close - f["open"].to_numpy(float)) / atr
    out["price_bar_range_atr"] = rng / atr
    out["price_bar_close_position"] = np.where(rng > 0, (close - f["low"].to_numpy(float)) / rng, 0.5)
    # volume against the same time of day over the previous 20 sessions
    time_key = pd.Series(minute_of_day(f["timestamp"].to_numpy()))
    typical_volume = _rolling_same_time(f["volume"].astype(float), time_key, 20)
    out["price_volume_ratio_same_time"] = (f["volume"] / typical_volume).to_numpy()
    cumulative = f["volume"].groupby(session).cumsum().astype(float)
    typical_cumulative = _rolling_same_time(cumulative, time_key, 20)
    out["price_cumulative_volume_ratio_same_time"] = (cumulative / typical_cumulative).to_numpy()
    return out


def flow_block(bars: DecisionBars, flow_minutes: pd.DataFrame) -> pd.DataFrame:
    """`flow_minutes`: per contract minute (timestamp in epoch seconds, contract, volume, buy_volume,
    sell_volume, signed_volume, active_seconds, largest_second_volume, up_seconds, down_seconds)."""
    m = bars.minutes
    key = pd.DataFrame({"timestamp": m.timestamp, "contract": m.contract, "session": m.session})
    joined = key.merge(flow_minutes, on=["timestamp", "contract"], how="left")
    for column in ("volume", "buy_volume", "sell_volume", "signed_volume", "active_seconds", "largest_second_volume", "up_seconds", "down_seconds"):
        joined[column] = joined[column].fillna(0.0)
    f = bars.frame
    last = f["last_minute"].to_numpy()
    out = pd.DataFrame(index=f.index)
    cumsum = {c: np.r_[0.0, np.cumsum(joined[c].to_numpy(float))] for c in ("volume", "signed_volume", "active_seconds", "up_seconds", "down_seconds")}
    minute_session = joined["session"].to_numpy()
    for w in FLOW_WINDOWS_MINUTES:
        start = np.maximum(last + 1 - w, 0)
        valid = minute_session[start] == minute_session[last]      # windows stay inside the session's RTH minutes
        volume = cumsum["volume"][last + 1] - cumsum["volume"][start]
        signed = cumsum["signed_volume"][last + 1] - cumsum["signed_volume"][start]
        active = cumsum["active_seconds"][last + 1] - cumsum["active_seconds"][start]
        up = cumsum["up_seconds"][last + 1] - cumsum["up_seconds"][start]
        down = cumsum["down_seconds"][last + 1] - cumsum["down_seconds"][start]
        out[f"flow_imbalance_{w}_minutes"] = np.where(valid & (volume > 0), signed / np.where(volume > 0, volume, 1), np.nan)
        out[f"flow_activity_{w}_minutes"] = np.where(valid, active / (60.0 * w), np.nan)
        out[f"flow_up_down_seconds_{w}_minutes"] = np.where(valid & (up + down > 0), (up - down) / np.where(up + down > 0, up + down, 1), np.nan)
    first = f.groupby("session")["first_minute"].transform("min").to_numpy()
    day_volume = cumsum["volume"][last + 1] - cumsum["volume"][first]
    day_signed = cumsum["signed_volume"][last + 1] - cumsum["signed_volume"][first]
    out["flow_imbalance_since_open"] = np.where(day_volume > 0, day_signed / np.where(day_volume > 0, day_volume, 1), np.nan)
    return out


def cross_block(bars: DecisionBars, others: dict[str, pd.DataFrame], daily: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """`others`: root -> 1-minute bars (timestamp s, close) on the same clock, back-adjusted.
    `daily`: symbol -> daily closes (date as days since epoch, close)."""
    f = bars.frame
    decision_close_minute = f["timestamp"].to_numpy() + 60 * (DECISION_MINUTES - 1)   # the decision bar's last minute
    mnq_close = f["close"].to_numpy(float)
    mnq_raw = f["raw_close"].to_numpy(float)
    out = pd.DataFrame(index=f.index)
    mnq_returns = {}
    for k in (1, 3, 12):
        # (adjusted change) / (traded price then): the move as a percentage of what was traded
        mnq_returns[k] = (mnq_close - pd.Series(mnq_close).shift(k).to_numpy()) / pd.Series(mnq_raw).shift(k).to_numpy()
    for root, minutes in others.items():
        series = minutes.sort_values("timestamp")
        stamps_other = series["timestamp"].to_numpy()
        # the last close at or before the decision bar's last minute (as-of)
        position = np.searchsorted(stamps_other, decision_close_minute, side="right") - 1
        valid = position >= 0
        close = np.where(valid, series["close"].to_numpy()[np.maximum(position, 0)], np.nan)
        raw = np.where(valid, series["raw_close"].to_numpy()[np.maximum(position, 0)], np.nan) if "raw_close" in series else close
        stale = decision_close_minute - np.where(valid, stamps_other[np.maximum(position, 0)], 0)
        close = np.where(stale <= 300, close, np.nan)
        name = root.lower()
        for k in (1, 3, 12):
            past = pd.Series(close).shift(k).to_numpy()
            other_return = (close - past) / pd.Series(raw).shift(k).to_numpy()
            out[f"cross_{name}_return_{k}_bars"] = other_return
            out[f"cross_mnq_minus_{name}_return_{k}_bars"] = mnq_returns[k] - other_return
    session = f["session"].to_numpy()
    for symbol, frame in daily.items():
        days = frame["day"].to_numpy()
        closes = frame["close"].to_numpy(float)
        daily_return = np.r_[np.nan, np.diff(np.log(closes))]
        # the latest daily bar dated before today's session (known at today's open)
        position = np.searchsorted(days, session, side="left") - 1
        value = np.where(position >= 0, daily_return[np.maximum(position, 0)], np.nan)
        five = pd.Series(np.log(closes)).diff(5).to_numpy()
        out[f"cross_daily_{symbol.lower()}_return_previous_session"] = value
        out[f"cross_daily_{symbol.lower()}_return_5_sessions"] = np.where(position >= 0, five[np.maximum(position, 0)], np.nan)
    return out


def _windowed(known: np.ndarray, values: dict[str, np.ndarray], decision_close: np.ndarray, window_seconds: int):
    """Count and per-value sums of the rows known in [close - window, close) for every decision bar."""
    end = np.searchsorted(known, decision_close, side="left")
    start = np.searchsorted(known, decision_close - window_seconds, side="left")
    count = end - start
    sums = {}
    for name, v in values.items():
        cumulative = np.r_[0.0, np.cumsum(v)]
        sums[name] = cumulative[end] - cumulative[start]
    return count, sums


def news_block(bars: DecisionBars, news: pd.DataFrame, headlines: pd.DataFrame | None = None,
               covered_days: set[str] | None = None, decision_close_utc: np.ndarray | None = None) -> pd.DataFrame:
    """`news`: GDELT rows with known_stamp (epoch s on the bars' clock), tone, and boolean subset columns
    (is_stockmarket, is_central_bank, is_megacap). `headlines`: FinBERT-scored core headlines
    (known_stamp, finbert_score, copies, the same subset columns), deduplicated per day.

    `covered_days` (UTC dates whose news landed complete and was scored) with `decision_close_utc`:
    a bar whose trailing 24 hours reach a day outside the coverage gets NaN in EVERY news column —
    missing news is unknown, never "no news"."""
    f = bars.frame
    decision_close = f["timestamp"].to_numpy() + 60 * DECISION_MINUTES
    out = pd.DataFrame(index=f.index)
    covered_rows = None
    if covered_days is not None and decision_close_utc is not None:
        today = pd.to_datetime(decision_close_utc, unit="s").strftime("%Y-%m-%d").to_numpy()
        yesterday = pd.to_datetime(decision_close_utc - 86400, unit="s").strftime("%Y-%m-%d").to_numpy()
        covered_rows = np.array([a in covered_days and b in covered_days for a, b in zip(today, yesterday)])
    if headlines is not None and not headlines.empty:
        h = headlines.sort_values("known_stamp")
        known_h = h["known_stamp"].to_numpy()
        score = h["finbert_score"].to_numpy(float)
        for name, mask in (("all", np.ones(len(h), bool)), ("stockmarket", h["is_stockmarket"].to_numpy(bool)),
                           ("central_bank", h["is_central_bank"].to_numpy(bool)), ("megacap", h["is_megacap"].to_numpy(bool))):
            for w in (60, 240, 1440):
                count, sums = _windowed(known_h[mask], {"score": score[mask], "negative": (score[mask] < -0.5).astype(float),
                                                        "positive": (score[mask] > 0.5).astype(float)}, decision_close, 60 * w)
                safe = np.where(count > 0, count, 1)
                out[f"news_finbert_{name}_mean_{w}_minutes"] = np.where(count > 0, sums["score"] / safe, np.nan)
                out[f"news_finbert_{name}_net_share_{w}_minutes"] = np.where(count > 0, (sums["positive"] - sums["negative"]) / safe, np.nan)
                out[f"news_finbert_{name}_count_{w}_minutes"] = count
    if news.empty:
        if covered_rows is not None:
            out.loc[~covered_rows, :] = np.nan
        return out
    news = news.sort_values("known_stamp")
    known = news["known_stamp"].to_numpy()
    subsets = {"all": np.ones(len(news), bool), "stockmarket": news["is_stockmarket"].to_numpy(bool),
               "central_bank": news["is_central_bank"].to_numpy(bool), "megacap": news["is_megacap"].to_numpy(bool)}
    tone = news["tone"].to_numpy(float)
    for name, mask in subsets.items():
        k = known[mask]
        count_cum = np.r_[0, np.cumsum(np.ones(mask.sum()))]
        tone_cum = np.r_[0.0, np.cumsum(tone[mask])]
        # known strictly before the decision bar closes
        end = np.searchsorted(k, decision_close, side="left")
        for w in NEWS_WINDOWS_MINUTES:
            start = np.searchsorted(k, decision_close - 60 * w, side="left")
            count = count_cum[end] - count_cum[start]
            out[f"news_{name}_count_{w}_minutes"] = count
            out[f"news_{name}_tone_{w}_minutes"] = np.where(count > 0, (tone_cum[end] - tone_cum[start]) / np.where(count > 0, count, 1), np.nan)
        start = np.searchsorted(k, decision_close - 60 * 60 * 24, side="left")
        out[f"news_{name}_count_24_hours"] = count_cum[end] - count_cum[start]
    out["news_all_burst_60_over_24h"] = out["news_all_count_60_minutes"] / (out["news_all_count_24_hours"] / 24.0).replace(0, np.nan)
    if covered_rows is not None:
        out.loc[~covered_rows, :] = np.nan
    return out


def calendar_block(bars: DecisionBars, events: pd.DataFrame, coverage_start_session: int | None = None) -> pd.DataFrame:
    """`events`: release times (stamp = epoch s on the bars' clock, family, scheduled).

    Forward-looking columns (minutes to the next event, events today, FOMC day) use SCHEDULED
    events only: an unscheduled statement was unknown until published. Minutes since the last
    event use every event (a published one is known). Sessions before `coverage_start_session`
    are outside the sourced calendar: every column is NaN there, never "no event"."""
    f = bars.frame
    decision_close = f["timestamp"].to_numpy() + 60 * DECISION_MINUTES
    session = f["session"].to_numpy()
    out = pd.DataFrame(index=f.index)
    if events.empty:
        return out
    # only families recorded in every year of the history, so a count means the same thing throughout
    events = events[events["family"].isin(CALENDAR_FAMILIES)].sort_values("stamp")
    scheduled = events["scheduled"].to_numpy(bool) if "scheduled" in events else np.ones(len(events), bool)
    stamps = events["stamp"].to_numpy()
    families = events["family"].to_numpy()
    event_session = (stamps + 9 * 3600) // 86400
    tier_one = np.isin(families, CALENDAR_TIER_ONE)
    for name, family_mask in (("any", np.ones(len(events), bool)), ("tier_one", tier_one)):
        known_ahead = family_mask & scheduled
        s, es = stamps[known_ahead], event_session[known_ahead]
        if s.size:
            nxt = np.searchsorted(s, decision_close, side="left")
            next_stamp = np.where(nxt < s.size, s[np.minimum(nxt, s.size - 1)], np.nan)
            next_same_session = np.where(nxt < s.size, es[np.minimum(nxt, s.size - 1)] == session, False)
            out[f"calendar_{name}_minutes_to_next_today"] = np.where(next_same_session, (next_stamp - decision_close) / 60.0, np.nan)
        else:
            out[f"calendar_{name}_minutes_to_next_today"] = np.nan
        day_counts = pd.Series(es).value_counts()
        out[f"calendar_{name}_events_today"] = pd.Series(session).map(day_counts).fillna(0).to_numpy()
        s_all, es_all = stamps[family_mask], event_session[family_mask]
        if s_all.size:
            prv = np.searchsorted(s_all, decision_close, side="left") - 1
            prev_stamp = np.where(prv >= 0, s_all[np.maximum(prv, 0)], np.nan)
            prev_same_session = np.where(prv >= 0, es_all[np.maximum(prv, 0)] == session, False)
            out[f"calendar_{name}_minutes_since_last_today"] = np.where(prev_same_session, (decision_close - prev_stamp) / 60.0, np.nan)
        else:
            out[f"calendar_{name}_minutes_since_last_today"] = np.nan
    fomc = stamps[(families == "fomc_statement") & scheduled]
    fomc_sessions = set(((fomc + 9 * 3600) // 86400).tolist())
    out["calendar_fomc_day"] = np.isin(session, list(fomc_sessions)).astype(float)
    if coverage_start_session is not None:
        out.loc[session < coverage_start_session, :] = np.nan
    return out


def context_block(bars: DecisionBars, minutes_all: Minutes) -> pd.DataFrame:
    """The session's context: the overnight (ETH) session before 06:30, the opening range,
    and the previous sessions. `minutes_all` holds every minute (ETH and RTH), same clock."""
    f = bars.frame
    close = f["close"].to_numpy(float)
    atr = f["atr_points"].to_numpy(float)
    session = f["session"].to_numpy()
    stamps = f["timestamp"].to_numpy()
    out = pd.DataFrame(index=f.index)
    # overnight: minutes of the session before the RTH open (15:00 the day before → 06:29)
    minute = minute_of_day(minutes_all.timestamp)
    eth = (minute < RTH_OPEN_MINUTE) | (minute >= 15 * 60)
    frame = pd.DataFrame({"session": minutes_all.session, "high": minutes_all.high, "low": minutes_all.low,
                          "close": minutes_all.close, "open": minutes_all.open, "volume": minutes_all.volume})[eth]
    overnight = frame.groupby("session").agg(eth_open=("open", "first"), eth_close=("close", "last"), eth_high=("high", "max"),
                                             eth_low=("low", "min"), eth_volume=("volume", "sum"))
    # the overnight session is complete before the first decision (06:35), so it is known at every RTH bar
    s = pd.Series(session)
    eth_high = s.map(overnight["eth_high"]).to_numpy()
    eth_low = s.map(overnight["eth_low"]).to_numpy()
    eth_close = s.map(overnight["eth_close"]).to_numpy()
    eth_open = s.map(overnight["eth_open"]).to_numpy()
    eth_volume = s.map(overnight["eth_volume"]).to_numpy(float)
    typical_eth_volume = s.map(overnight["eth_volume"].shift(1).rolling(20, min_periods=20).mean()).to_numpy(float)
    out["context_overnight_return_atr"] = (eth_close - eth_open) / atr
    out["context_overnight_range_atr"] = (eth_high - eth_low) / atr
    out["context_overnight_volume_ratio"] = eth_volume / typical_eth_volume
    out["context_close_vs_overnight_high_atr"] = (close - eth_high) / atr
    out["context_close_vs_overnight_low_atr"] = (close - eth_low) / atr
    # opening range: 06:30-06:44 and 06:30-06:59, known once those minutes have closed
    minute_rth = minute_of_day(stamps)
    g = pd.DataFrame({"session": session, "high": f["high"], "low": f["low"], "minute": minute_rth})
    for length in (15, 30):
        inside = g[g["minute"] < RTH_OPEN_MINUTE + length]
        ranges = inside.groupby("session").agg(high=("high", "max"), low=("low", "min"))
        known = (minute_rth + DECISION_MINUTES) >= RTH_OPEN_MINUTE + length
        high = np.where(known, s.map(ranges["high"]).to_numpy(), np.nan)
        low = np.where(known, s.map(ranges["low"]).to_numpy(), np.nan)
        out[f"context_opening_range_{length}_atr"] = (high - low) / atr
        out[f"context_close_vs_opening_high_{length}_atr"] = (close - high) / atr
        out[f"context_close_vs_opening_low_{length}_atr"] = (close - low) / atr
    # previous sessions (RTH)
    per_session = pd.DataFrame({"session": session, "open": f["open"], "close": close, "high": f["high"], "low": f["low"]}) \
        .groupby("session").agg(open=("open", "first"), close=("close", "last"), high=("high", "max"), low=("low", "min"))
    previous = per_session.shift(1)
    prev_return = s.map(previous["close"] - previous["open"]).to_numpy()
    prev_range = s.map(previous["high"] - previous["low"]).to_numpy()
    five_close = s.map(per_session["close"].shift(1) - per_session["close"].shift(6)).to_numpy()
    five_high = s.map(per_session["high"].shift(1).rolling(5, min_periods=5).max()).to_numpy()
    five_low = s.map(per_session["low"].shift(1).rolling(5, min_periods=5).min()).to_numpy()
    out["context_previous_session_return_atr"] = prev_return / atr
    out["context_previous_session_range_atr"] = prev_range / atr
    out["context_five_session_return_atr"] = five_close / atr
    out["context_close_vs_five_session_high_atr"] = (close - five_high) / atr
    out["context_close_vs_five_session_low_atr"] = (close - five_low) / atr
    return out


def time_block(bars: DecisionBars) -> pd.DataFrame:
    f = bars.frame
    minute = minute_of_day(f["timestamp"].to_numpy()) + DECISION_MINUTES
    out = pd.DataFrame(index=f.index)
    out["time_minutes_since_rth_open"] = minute - RTH_OPEN_MINUTE
    angle = 2 * np.pi * (minute - RTH_OPEN_MINUTE) / 390.0
    out["time_of_day_sine"] = np.sin(angle)
    out["time_of_day_cosine"] = np.cos(angle)
    weekday = ((f["session"].to_numpy() + 3) % 7)   # 1970-01-01 was a Thursday: day 0 -> 3
    for d, name in enumerate(["monday", "tuesday", "wednesday", "thursday", "friday"]):
        out[f"time_weekday_{name}"] = (weekday == d).astype(float)
    return out


def build(bars: DecisionBars, *, flow_minutes: pd.DataFrame | None = None, others: dict | None = None,
          daily: dict | None = None, news: pd.DataFrame | None = None, events: pd.DataFrame | None = None,
          minutes_all: Minutes | None = None, headlines: pd.DataFrame | None = None) -> pd.DataFrame:
    """All blocks side by side, one row per 5-minute RTH bar (decision rows marked by `is_decision`)."""
    parts = [bars.frame[["timestamp", "session", "is_decision"]].rename(columns={"timestamp": "decision_timestamp"}),
             time_block(bars), price_block(bars)]
    if minutes_all is not None:
        parts.append(context_block(bars, minutes_all))
    if flow_minutes is not None:
        parts.append(flow_block(bars, flow_minutes))
    if others or daily:
        parts.append(cross_block(bars, others or {}, daily or {}))
    if news is not None:
        parts.append(news_block(bars, news, headlines))
    if events is not None:
        parts.append(calendar_block(bars, events))
    return pd.concat(parts, axis=1)


def modality_of(column: str) -> str:
    return column.split("_", 1)[0]


__all__ = ["build", "modality_of", "price_block", "flow_block", "cross_block", "news_block", "calendar_block", "context_block", "time_block", "Minutes"]
