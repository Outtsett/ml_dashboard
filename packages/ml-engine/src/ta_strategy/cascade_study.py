"""The cascade study: swing levels per timeframe, how often the cascade forms and where price goes after it,
volume around levels, volatility indicators, and the delayed-oracle ceiling. Lands ``cascade_*`` tables.

    .venv/Scripts/python.exe packages/ml-engine/src/ta_strategy/cascade_study.py --symbol MNQ --start 2019-06-01 --end 2026-01-01 --recipe <stem> --json
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "src" / "ml"))
sys.path.insert(0, str(ROOT / "src"))

from shared import protocol  # noqa: E402

DATASET = "ta_conditional_strategies_600_ticks"


def run(args: argparse.Namespace) -> dict:
    from cycle.simulate import load_cost_model
    from shared.data import _serving
    from ta_strategy import cascade, seasonality, store
    from ta_strategy.data import load_minutes_rebuilt, session_dates

    started = time.monotonic()
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
    recipe = f"{args.recipe or 'cascade_' + stamp}_{args.symbol}"
    cost = load_cost_model("MNQ" if args.symbol in ("NQ", "MNQ") else args.symbol)
    cost_ticks = cost.round_trip / cost.tick_value        # the oracle has no stop: the round trip only
    connection = _serving()
    connection.execute("SET TimeZone='UTC'")
    minutes = load_minutes_rebuilt(connection, args.symbol, args.start, args.end)
    frame = minutes.frame
    days = session_dates(frame["timestamp"].to_numpy(np.int64))
    protocol.emit_log(f"[data] {args.symbol} {args.start}..{args.end}: {len(frame):,} minutes, {len(minutes.rolls)} rolls")

    c = cascade.build(frame, window_minutes=int(args.window))
    lv = c.levels
    known_life = np.where(lv["break_minute"] >= 0, lv["break_minute"], lv["retire_minute"]) - lv["known_minute"]
    levels_table = lv.assign(life_minutes=known_life).groupby("timeframe").agg(
        levels=("price", "size"), broken_share=("break_minute", lambda x: float((x >= 0).mean())),
        median_life_minutes=("life_minutes", "median"), levels_per_session_day=("price", lambda x: x.size / np.unique(days).size)).reset_index()
    stamps = frame["timestamp"].to_numpy(np.int64)
    part = seasonality.session_part(seasonality.session_offset(stamps))
    occupancy = []
    for scope in ("all", "overnight", "regular_hours"):
        mask = np.ones(stamps.size, bool) if scope == "all" else part == scope
        for name in ("stage_up", "stage_down", "aligned_up", "aligned_down"):
            values = getattr(c, name)[mask]
            for s in range(5):
                occupancy.append({"session_part": scope, "state": name, "stage": s, "share_of_minutes": float((values == s).mean())})
        direction = c.direction[mask]
        for v, label in ((1, "up"), (-1, "down"), (0, "none")):
            occupancy.append({"session_part": scope, "state": "direction", "stage": v, "share_of_minutes": float((direction == v).mean()), "label": label})
    protocol.emit_log(f"[{args.symbol} cascade] " + ", ".join(f"{r.timeframe} {int(r.levels):,} levels ({r.broken_share:.0%} broken)"
                                                            for r in levels_table.itertuples()))
    moves = cascade.stage_forward_moves(frame, days, c, cost.tick_size)
    for r in moves[(moves.session_part == "all") & (moves.horizon_minutes == 60)].itertuples():
        protocol.emit_log(f"[{args.symbol} stage {r.stage} {r.direction}] {r.events_per_session_day:.2f}/day, next 60 min with the cascade "
                          f"{r.mean_signed_move_ticks:+.1f} ticks, over drift {r.excess_over_drift_ticks:+.1f} [{r.excess_bootstrap_low:+.1f}, {r.excess_bootstrap_high:+.1f}]")
    tests, deciles, volume_summary = cascade.volume_at_levels(frame, days, lv, shuffles=int(args.shuffles))
    for r in volume_summary.itertuples():
        protocol.emit_log(f"[{args.symbol} volume] {r.measure}: Spearman with break {r.spearman_with_break:+.3f}, given the approach range "
                          f"{r.spearman_with_break_given_range:+.3f}, with range {r.spearman_with_approach_range:+.3f} (n {r.tests:,})")
    seasonal = seasonality.build(frame, days)
    indicators = cascade.volatility_indicators(frame, days, c, seasonal, bootstrap=int(args.bootstrap))
    top = indicators[(indicators.session_part == "all")].sort_values("spearman", ascending=False)
    for outcome in ("range_ahead_ticks", "range_ahead_over_atr", "follow_through_over_atr"):
        best = top[top.outcome == outcome].head(3)
        protocol.emit_log(f"[{args.symbol} volatility -> {outcome}] " + "; ".join(f"{r.measure} {r.spearman:+.3f}" for r in best.itertuples()))
    oracle = cascade.delayed_oracle(frame, days, lv, cost.tick_size, cost_ticks)
    for r in oracle.itertuples():
        protocol.emit_log(f"[{args.symbol} delayed oracle {r.timeframe}] {r.ceiling_net_ticks_per_session_day_mean:,.0f} net ticks/day mean "
                          f"(median {r.ceiling_net_ticks_per_session_day_median:,.0f}) from {r.trades_per_session_day:.1f} trades/day; "
                          f"600 needs {100 * r.required_capture_share_for_600:.1f}% of it")
    detail = lv.assign(known_timestamp=pd.to_datetime(stamps[lv["known_minute"]], unit="s"),
                       end_timestamp=pd.to_datetime(stamps[np.where(lv["break_minute"] >= 0, lv["break_minute"], lv["retire_minute"])], unit="s"),
                       broken=lv["break_minute"] >= 0, session_date=days[lv["known_minute"]]).drop(columns=["bar_index"])
    state = pd.DataFrame({"timestamp": pd.to_datetime(stamps, unit="s"), "session_date": days, "close": frame["close"].to_numpy(float),
                          "volume": frame["volume"].to_numpy(float), "stage_up": c.stage_up, "stage_down": c.stage_down,
                          "aligned_up": c.aligned_up, "aligned_down": c.aligned_down, "direction": c.direction})
    tables = {"cascade_levels_detail": detail, "cascade_minute_state": state, "cascade_levels": levels_table, "cascade_occupancy": pd.DataFrame(occupancy), "cascade_stage_moves": moves,
              "cascade_volume_deciles": deciles, "cascade_volume_summary": volume_summary, "cascade_volatility_indicators": indicators,
              "cascade_oracle": oracle,
              "cascade_level_tests": tests[["timeframe", "price", "side", "known_minute", "test_minute", "tested_side", "broke", "session_part",
                                            "session_date", "relative_volume", "volume_trend", "approach_range_over_atr"]]}
    tables = {k: v.assign(symbol=args.symbol, recipe=recipe) for k, v in tables.items()}
    directory = os.path.join(args.output_dir, f"ta_cascade_{recipe}")
    paths = store.write_local(tables, directory)
    landing = None
    if not args.no_land:
        landing = store.land(paths, recipe, f"TA cascade study {args.symbol}", dataset=DATASET)
        for name, info in landing.items():
            protocol.emit_log(f"[save] {name}: {info['rows']:,} rows -> {info['uri']} (manifest {info['manifest']})")
    protocol.emit_done(directory, {"recipe": recipe, "lake": landing, "seconds": time.monotonic() - started})
    return {"recipe": recipe}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--symbol", required=True)
    parser.add_argument("--start", required=True)
    parser.add_argument("--end", required=True)
    parser.add_argument("--window", default=120)
    parser.add_argument("--shuffles", default=5)
    parser.add_argument("--bootstrap", default=200)
    parser.add_argument("--recipe", default=None)
    parser.add_argument("--output-dir", default=str(ROOT / "data" / "models"))
    parser.add_argument("--no-land", action="store_true")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    try:
        run(args)
        return 0
    except Exception as error:  # noqa: BLE001
        import traceback

        protocol.emit_error(f"{type(error).__name__}: {error}", traceback.format_exc())
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
