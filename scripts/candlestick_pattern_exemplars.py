"""Which candle best embodies each pattern, and does its context agree?

Two questions this answers, both asked of real bars rather than of the textbook.

WHICH CANDLE MOST RESEMBLES THE PATTERN. TA-Lib does not rank. It emits a flat
magnitude — +100, -100, occasionally +/-80 or +/-200 — that is the same on a
textbook hammer and on a bar that barely scraped past the threshold. So there is
no built-in notion of a better or worse example. This builds one: every firing of
a pattern is reduced to its shape, in fractions of its own range so the number is
about geometry and not about price level, and the ARCHETYPE of that pattern is
the median shape across all its firings. A firing's distance to that archetype
ranks it, and rank 1 is the candle that most resembles the pattern.

DOES THE CONTEXT AGREE. A hammer and a hanging man are the SAME SHAPE. What
separates them is the trend that came before, and TA-Lib checks the prior trend
for none of its 61 patterns while 47 of them have a meaning that depends on it.
Its own source says so; `talib_candlestick_rules.json` carries the comment for
each. So every firing here is also stamped with the trend that actually preceded
it and whether that trend matches what the pattern needs to mean what it claims.
A bullish reversal fired after a rally is a shape match and a context failure,
and until you compare the two you cannot tell those apart.

Writes two tables into data/diagnostics.duckdb:
  candlestick_pattern_rules      one row per pattern, the rule as TA-Lib states it
  candlestick_pattern_exemplars  one row per firing, ranked, with its context
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sys

import duckdb
import numpy as np
import pandas as pd
import talib

REPOSITORY_ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPOSITORY_ROOT))

DEFAULT_DATABASE_PATH = REPOSITORY_ROOT / "data" / "diagnostics.duckdb"
RULES_PATH = pathlib.Path(r"E:\source\repos\datalake\scripts\talib_candlestick_rules.json")

# Bars used to judge "what came before". Long enough that a single bar cannot
# flip it, short enough to still be the local trend a pattern reacts to.
PRIOR_TREND_LOOKBACK_BARS = 10
# Move needed before the prior stretch counts as a trend rather than chop,
# in fractions of the median bar range over the same window.
PRIOR_TREND_MINIMUM_RANGE_MULTIPLE = 1.0


def load_rules() -> pd.DataFrame:
    document = json.loads(RULES_PATH.read_text(encoding="utf-8"))
    rows = []
    for pattern in document["patterns"]:
        rows.append({
            "talib_function": pattern["talib_function"],
            "bars_the_rule_reads": int(pattern["candle_count"]),
            "pattern_type": pattern.get("pattern_type"),
            "required_prior_trend_for_bullish_signal":
                pattern.get("required_prior_trend_for_bullish_signal"),
            "required_prior_trend_for_bearish_signal":
                pattern.get("required_prior_trend_for_bearish_signal"),
            "talib_verifies_prior_trend": bool(pattern.get("talib_checks_prior_trend")),
            "emitted_values": pattern.get("emitted_values"),
            "shape_conditions": " | ".join(pattern.get("shape_conditions") or []),
            "adaptive_settings_used": ", ".join(pattern.get("candle_settings_used") or []),
        })
    return pd.DataFrame(rows)


def load_bars(symbol: str, timeframe: str, max_bars: int) -> pd.DataFrame:
    from core.shared.data import load_ohlcv_arrays

    arrays = load_ohlcv_arrays(symbol, timeframe, max_bars=max_bars)
    frame = pd.DataFrame({
        "bar_timestamp": pd.to_datetime(arrays["timestamp"], utc=True),
        "open": np.asarray(arrays["open"], dtype=float),
        "high": np.asarray(arrays["high"], dtype=float),
        "low": np.asarray(arrays["low"], dtype=float),
        "close": np.asarray(arrays["close"], dtype=float),
        "volume": np.asarray(arrays["volume"], dtype=float),
    })
    return frame.sort_values("bar_timestamp").reset_index(drop=True)


def prior_trend_direction(close: np.ndarray, high: np.ndarray, low: np.ndarray) -> np.ndarray:
    """'up', 'down' or 'sideways' for the stretch ENDING at the bar before each bar.

    Measured on closes only, and called a trend only when the move clears the
    typical bar range over the same window. Without that floor a two-tick drift
    across ten bars would be called a downtrend and every bullish reversal would
    look context-confirmed.
    """
    n = len(close)
    out = np.full(n, "sideways", dtype=object)
    lookback = PRIOR_TREND_LOOKBACK_BARS
    for i in range(n):
        end = i - 1              # the bar before this one
        start = end - lookback
        if start < 0:
            out[i] = "unknown"
            continue
        move = close[end] - close[start]
        typical_range = float(np.median(high[start:end + 1] - low[start:end + 1]))
        if typical_range <= 0:
            out[i] = "sideways"
            continue
        if abs(move) < PRIOR_TREND_MINIMUM_RANGE_MULTIPLE * typical_range:
            out[i] = "sideways"
        else:
            out[i] = "up" if move > 0 else "down"
    return out


def build_exemplars(bars: pd.DataFrame, rules: pd.DataFrame) -> pd.DataFrame:
    open_ = bars["open"].to_numpy()
    high = bars["high"].to_numpy()
    low = bars["low"].to_numpy()
    close = bars["close"].to_numpy()

    total_range = high - low
    body_size = np.abs(close - open_)
    upper_shadow = high - np.maximum(open_, close)
    lower_shadow = np.minimum(open_, close) - low

    # Shape in fractions of the bar's own range: a statement about geometry, not
    # about price level, so a 2019 bar and a 2026 bar are comparable.
    safe_range = np.where(total_range > 0, total_range, np.nan)
    body_fraction = body_size / safe_range
    upper_fraction = upper_shadow / safe_range
    lower_fraction = lower_shadow / safe_range

    previous_close = np.concatenate([[np.nan], close[:-1]])
    trend = prior_trend_direction(close, high, low)

    rules_by_function = rules.set_index("talib_function").to_dict("index")
    frames = []

    for function_name in talib.get_function_groups()["Pattern Recognition"]:
        emitted = getattr(talib, function_name)(open_, high, low, close)
        fired = np.flatnonzero(emitted != 0)
        if fired.size == 0:
            continue

        rule = rules_by_function.get(function_name, {})
        direction = np.where(emitted[fired] > 0, "bullish", "bearish")
        required = np.where(
            emitted[fired] > 0,
            rule.get("required_prior_trend_for_bullish_signal", "unknown"),
            rule.get("required_prior_trend_for_bearish_signal", "unknown"),
        )

        frame = pd.DataFrame({
            "talib_function": function_name,
            "bar_timestamp": bars["bar_timestamp"].to_numpy()[fired],
            "emitted_value": emitted[fired],
            "signal_direction": direction,
            "bars_the_rule_reads": rule.get("bars_the_rule_reads", 0),
            "pattern_type": rule.get("pattern_type"),
            "body_fraction_of_range": body_fraction[fired],
            "upper_shadow_fraction_of_range": upper_fraction[fired],
            "lower_shadow_fraction_of_range": lower_fraction[fired],
            "body_size_points": body_size[fired],
            "total_range_points": total_range[fired],
            "close_versus_open": np.where(
                close[fired] > open_[fired], "above",
                np.where(close[fired] < open_[fired], "below", "equal")),
            "close_versus_previous_close": np.where(
                close[fired] > previous_close[fired], "above",
                np.where(close[fired] < previous_close[fired], "below", "equal")),
            "prior_trend_direction": trend[fired],
            "required_prior_trend": required,
            "volume": bars["volume"].to_numpy()[fired],
        })

        # The archetype is the MEDIAN shape of this pattern's own firings, and a
        # firing is ranked by how far its shape sits from it. Median rather than
        # mean because a handful of extreme bars would otherwise drag the
        # archetype somewhere no real candle lives.
        shape = frame[[
            "body_fraction_of_range",
            "upper_shadow_fraction_of_range",
            "lower_shadow_fraction_of_range",
        ]].to_numpy(dtype=float)
        archetype = np.nanmedian(shape, axis=0)
        frame["archetype_distance"] = np.sqrt(
            np.nansum((shape - archetype) ** 2, axis=1))
        frame["prototypicality_rank"] = (
            frame["archetype_distance"].rank(method="min").astype("Int64"))

        # Does the trend that actually preceded it match what the pattern needs?
        frame["prior_trend_matches_requirement"] = np.where(
            frame["required_prior_trend"].isin(["not_applicable", "none", None]),
            True,
            frame["prior_trend_direction"] == frame["required_prior_trend"],
        )
        frames.append(frame)

    return pd.concat(frames, ignore_index=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--symbol", default="MNQ")
    parser.add_argument("--timeframe", default="1d")
    parser.add_argument("--max-bars", type=int, default=5000)
    parser.add_argument("--database-path", default=str(DEFAULT_DATABASE_PATH))
    arguments = parser.parse_args()

    rules = load_rules()
    bars = load_bars(arguments.symbol, arguments.timeframe, arguments.max_bars)
    print(f"bars loaded          : {len(bars):,}  "
          f"{bars.bar_timestamp.iloc[0].date()} .. {bars.bar_timestamp.iloc[-1].date()}")

    exemplars = build_exemplars(bars, rules)
    exemplars.insert(0, "symbol", arguments.symbol)
    exemplars.insert(1, "timeframe", arguments.timeframe)

    database_path = pathlib.Path(arguments.database_path)
    database_path.parent.mkdir(parents=True, exist_ok=True)
    connection = duckdb.connect(str(database_path))
    try:
        connection.execute("DROP TABLE IF EXISTS candlestick_pattern_rules")
        connection.execute(
            "CREATE TABLE candlestick_pattern_rules AS SELECT * FROM rules")

        table_exists = connection.execute(
            "SELECT count(*) FROM information_schema.tables "
            "WHERE table_name = 'candlestick_pattern_exemplars'"
        ).fetchone()[0] > 0

        if table_exists:
            # Re-running for the same symbol and timeframe replaces that slice
            # rather than stacking a second copy of every firing on top of it.
            connection.execute(
                "DELETE FROM candlestick_pattern_exemplars "
                "WHERE symbol = ? AND timeframe = ?",
                [arguments.symbol, arguments.timeframe],
            )
            connection.execute(
                "INSERT INTO candlestick_pattern_exemplars SELECT * FROM exemplars")
        else:
            connection.execute(
                "CREATE TABLE candlestick_pattern_exemplars AS SELECT * FROM exemplars")

        total = connection.execute(
            "SELECT count(*) FROM candlestick_pattern_exemplars").fetchone()[0]
        patterns_fired = connection.execute(
            "SELECT count(DISTINCT talib_function) FROM candlestick_pattern_exemplars"
        ).fetchone()[0]
        context_agrees = connection.execute(
            "SELECT count(*) FROM candlestick_pattern_exemplars "
            "WHERE prior_trend_matches_requirement").fetchone()[0]
    finally:
        connection.close()

    print(f"firings written      : {len(exemplars):,}")
    print(f"patterns that fired  : {patterns_fired} of 61")
    print(f"rows in table        : {total:,}")
    print(f"context agrees       : {context_agrees:,} "
          f"({100.0 * context_agrees / max(total, 1):.1f}%)")


if __name__ == "__main__":
    main()
