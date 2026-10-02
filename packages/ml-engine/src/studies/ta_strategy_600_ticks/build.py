"""Land what section 15 of the TA-strategy notebook rebuilds live, so the dashboard's study page can read it.

    E:/source/repos/ml_dashboard/.venv/Scripts/python.exe packages/ml-engine/src/studies/ta_strategy_600_ticks/build.py

Section 15 of ``notebooks/ta_strategy_600_ticks.py`` ("How a zone is built, on the candles") loads,
for ONE session, the lake's 1-minute bars rebuilt one contract per session and back-adjusted
(``ta_strategy.data.load_minutes_rebuilt``, 16 days before the session to one day after), builds every
level event (``levels.all_level_events`` + the swing levels of ``cascade.level_events``), the session
VWAP and its +/-1 and +/-2 sigma bands (``levels.session_vwap``), aggregates 5m / 15m / 30m bars
(``data.aggregate``), takes TA-Lib's ATR(14) of those bars, and merges the levels into zones with
``levels.zones_for_bars``. None of that is in a lake view, so the page could not show it.

This script runs exactly that code path, per session, for every session of 2025 on MNQ, NQ, ES and MES
(the notebook's four markets) and lands four tables under
``s3://derived/study_ta_strategy_600_ticks/recipe=<recipe>/table=<name>/`` (served as
``derived_study_ta_strategy_600_ticks_<name>``):

``zone_build_sessions``
    one row per (symbol, session): minutes loaded, rolls back-adjusted, level events in the window.
``zone_build_bars``
    the session's 5m / 15m / 30m bars (back-adjusted) with ATR(14), the VWAP band values at each bar's
    last minute (what ``zones_for_bars`` merges) and the raw contract close (to put a drawing on the
    Market chart's unadjusted price scale).
``zone_build_events``
    every level event that is known and still valid at some point of the session.
``zone_build_reference_zones``
    ``levels.zones_for_bars`` at the notebook's default dials (merge gap 0.25 ATR, reach 6 ATR, all
    twelve families): the reference the page's TypeScript port is parity-checked against.

The page re-runs the zone merge in the browser from ``bars`` + ``events`` as the dials move.
Refuses to run when the recipe is already landed: a landed recipe is never overwritten.
"""

from __future__ import annotations

import argparse
import sys
import tempfile
import time
from pathlib import Path

import numpy as np
import pandas as pd
import talib

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT / "src" / "ml"))
sys.path.insert(0, str(ROOT / "src"))

from lake import serving  # noqa: E402

from ta_strategy import cascade, levels  # noqa: E402
from ta_strategy.data import aggregate, load_minutes_rebuilt, session_dates  # noqa: E402
from ta_strategy.store import land, write_local  # noqa: E402

DATASET = "study_ta_strategy_600_ticks"
RECIPE = "zone_build_2025_v1"
SYMBOLS = ("MNQ", "NQ", "ES", "MES")
TIMEFRAMES = {"5m": 5, "15m": 15, "30m": 30}
TICK = 0.25
DEFAULT_WIDTH_ATR = 0.25
DEFAULT_REACH_ATR = 6.0
SOURCE = ("ml_dashboard packages/ml-engine/src/studies/ta_strategy_600_ticks/build.py: notebooks/ta_strategy_600_ticks.py section 15 "
          "(ta_strategy.data.load_minutes_rebuilt, levels.all_level_events + cascade.level_events, levels.session_vwap, "
          "data.aggregate, talib.ATR(14), levels.zones_for_bars)")


def connect_with_retry(tries: int = 20):
    """The lake's object store answers slowly under load; retry until the derived views are defined."""
    last: Exception | None = None
    for attempt in range(tries):
        try:
            connection = serving.connect()
            connection.execute("SET TimeZone='UTC'")
            return connection
        except Exception as error:  # noqa: BLE001 - a busy object store; wait and retry
            last = error
            time.sleep(3 + attempt)
    raise RuntimeError(f"could not connect to the lake: {last}")


def already_landed(connection) -> bool:
    view = f"derived_{DATASET}_zone_build_sessions"
    exists = connection.execute("SELECT count(*) FROM duckdb_views() WHERE view_name = ?", [view]).fetchone()[0] > 0
    if not exists:
        return False
    return connection.execute(f'SELECT count(*) FROM "{view}" WHERE recipe = ?', [RECIPE]).fetchone()[0] > 0


def build_session(connection, symbol: str, day: pd.Timestamp) -> dict[str, pd.DataFrame] | None:
    """The notebook's cell at lines 1511-1563, for every bar size at once. None when no session ends on ``day``."""
    minutes = load_minutes_rebuilt(connection, symbol, (day - pd.Timedelta(days=16)).strftime("%Y-%m-%d"),
                                   (day + pd.Timedelta(days=1)).strftime("%Y-%m-%d"))
    frame = minutes.frame
    if frame.empty:
        return None
    context = levels.minute_context(frame)
    vwap = levels.session_vwap(context)
    events = pd.concat([levels.all_level_events(frame, context), cascade.level_events(frame)],
                       ignore_index=True).sort_values("known_from", kind="stable").reset_index(drop=True)
    target = np.datetime64(day.strftime("%Y-%m-%d"))
    bar_frames, zone_frames = [], []
    for label, width in TIMEFRAMES.items():
        bars, _ = aggregate(frame, width)
        values = {k: bars[k].to_numpy(np.float64) for k in ("open", "high", "low", "close", "volume")}
        bar_end = bars["timestamp"].to_numpy(np.int64) + width * 60
        atr = talib.ATR(values["high"], values["low"], values["close"], 14)
        last_minute = bars["last_minute_index"].to_numpy(np.int64)
        zones = levels.zones_for_bars(bar_end, values["close"], atr, last_minute, events, vwap, TICK,
                                      DEFAULT_WIDTH_ATR, DEFAULT_REACH_ATR)
        in_day = session_dates(bars["timestamp"].to_numpy(np.int64)) == target
        if not in_day.any():
            return None
        index = np.flatnonzero(in_day)
        bar_frames.append(pd.DataFrame({
            "symbol": symbol, "session_date": day.date(), "timeframe": label, "bar": np.arange(index.size),
            "timestamp_seconds": bars["timestamp"].to_numpy(np.int64)[index], "bar_end_seconds": bar_end[index],
            "open": values["open"][index], "high": values["high"][index], "low": values["low"][index],
            "close": values["close"][index], "volume": values["volume"][index], "average_true_range_14": atr[index],
            "last_minute_index": last_minute[index],
            **{name: series[last_minute[index]] for name, series in vwap.items()},
            "raw_close": frame["raw_close"].to_numpy(float)[last_minute[index]],
            "contract": frame["contract"].to_numpy()[last_minute[index]],
        }))
        reference = zones.iloc[index].reset_index(drop=True)
        reference.insert(0, "bar", np.arange(index.size))
        reference.insert(0, "timeframe", label)
        reference.insert(0, "session_date", day.date())
        reference.insert(0, "symbol", symbol)
        zone_frames.append(reference)
    bars_out = pd.concat(bar_frames, ignore_index=True)
    window_start = int(bars_out["timestamp_seconds"].min())
    window_end = int(bars_out["bar_end_seconds"].max())
    relevant = events[(events["known_from"] <= window_end) & (events["valid_until"] > window_start)]
    events_out = pd.DataFrame({
        "symbol": symbol, "session_date": day.date(), "price": relevant["price"].to_numpy(float),
        "source": relevant["source"].astype(str).to_numpy(), "family": relevant["family"].astype(str).to_numpy(),
        "family_group": relevant["family_group"].astype(str).to_numpy(),
        "known_from_seconds": relevant["known_from"].to_numpy(np.int64),
        "valid_until_seconds": relevant["valid_until"].to_numpy(np.int64),
    })
    zones_out = pd.concat(zone_frames, ignore_index=True)
    zones_out["inside_zone"] = zones_out["inside_zone"].astype(bool)
    for column in ("support_families", "resistance_families"):
        zones_out[column] = zones_out[column].astype(object).where(zones_out[column].notna(), None)
    session = pd.DataFrame([{
        "symbol": symbol, "session_date": day.date(), "minutes_loaded": len(frame), "rolls_back_adjusted": len(minutes.rolls),
        "level_event_count_in_loaded_window": len(events), "level_event_count_in_session": len(events_out),
        "five_minute_bar_count": int((bars_out["timeframe"] == "5m").sum()),
        "session_start_seconds": window_start, "session_end_seconds": window_end,
        "raw_minus_adjusted_close_median_points": float(np.median(bars_out["raw_close"] - bars_out["close"])),
    }])
    return {"zone_build_sessions": session, "zone_build_bars": bars_out, "zone_build_events": events_out,
            "zone_build_reference_zones": zones_out}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--start", default="2025-01-01")
    parser.add_argument("--end", default="2025-12-31")
    parser.add_argument("--symbols", default=",".join(SYMBOLS))
    parser.add_argument("--dry-run", action="store_true", help="build and write locally, do not land")
    arguments = parser.parse_args()
    connection = connect_with_retry()
    if not arguments.dry_run and already_landed(connection):
        print(f"recipe {RECIPE} is already landed; refusing to overwrite it")
        return
    days = [d for d in pd.date_range(arguments.start, arguments.end, freq="D") if d.dayofweek < 5]
    parts: dict[str, list[pd.DataFrame]] = {}
    started = time.time()
    for symbol in arguments.symbols.split(","):
        built = 0
        for day in days:
            for attempt in range(5):
                try:
                    result = build_session(connection, symbol, day)
                    break
                except Exception as error:  # noqa: BLE001 - the object store drops a request under load; retry
                    if "HTTP" not in str(error) and "connect" not in str(error):
                        raise
                    time.sleep(2 + attempt)
                    connection = connect_with_retry()
            else:
                raise RuntimeError(f"{symbol} {day.date()}: the lake did not answer")
            if result is None:
                continue
            built += 1
            for name, table in result.items():
                parts.setdefault(name, []).append(table)
        print(f"{symbol}: {built} sessions ({time.time() - started:.0f} s)", flush=True)
    tables = {name: pd.concat(frames, ignore_index=True) for name, frames in parts.items()}
    for name, table in tables.items():
        print(f"{name}: {len(table):,} rows", flush=True)
    directory = tempfile.mkdtemp(prefix="study_ta_strategy_600_ticks_")
    paths = write_local(tables, directory)
    if arguments.dry_run:
        print(f"dry run: tables written to {directory}")
        return
    print(land(paths, RECIPE, SOURCE, dataset=DATASET))


if __name__ == "__main__":
    main()
