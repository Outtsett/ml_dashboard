"""Frequency and session round: the frozen conditional specs traded through the overnight (ETH)
and regular (RTH) sessions, long and short, with more entries per session.

    .venv/Scripts/python.exe packages/ml-engine/src/ta_strategy/frequency.py --round 4 --json

600 ticks a day counts every trade in the CME session day. Rounds 1-3 capped each template at
2 entries per session inside an RTH window. This round keeps every frozen parameter (round 3)
and changes only three things, as written in ``packages/config/ta_conditional_rounds.json`` before
the run:
- the session window: the frozen RTH window, the overnight session (13:00 -> 06:30 Pacific,
  wrapping midnight) or the whole day;
- the maximum entries per session: 2, 5 or unlimited (one position at a time either way);
- the strategy timeframe: 15m (frozen) or 5m.
A template bound to the regular session (the opening range) keeps its frozen window.

Each variant is scored beside matched random entries (same window, count per hour, long share)
and random-side replicates, and split by direction (long / short) and by session (RTH / ETH)
of the entry. The books are also summed per setting, because the goal is the day's total.
"""

from __future__ import annotations

import argparse
import copy
import itertools
import json
import math
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

ROUNDS_PATH = ROOT / "src" / "config" / "ta_conditional_rounds.json"
TEMPLATES_PATH = ROOT / "src" / "config" / "ta_conditional_templates.json"
DATASET = "ta_conditional_strategies_600_ticks"


def with_session(node, window: dict | None):
    """Every session_window node in a template (gate and entries) set to ``window``."""
    if window is None:
        return node
    if isinstance(node, dict):
        if node.get("op") == "session_window":
            return {**node, "start": window["start"], "end": window["end"]}
        return {k: with_session(v, window) for k, v in node.items()}
    if isinstance(node, list):
        return [with_session(v, window) for v in node]
    return node


def variant_template(template: dict, window: dict | None, cap: int) -> dict:
    out = copy.deepcopy(template)
    out["gate"] = with_session(out.get("gate"), window) if out.get("gate") else out.get("gate")
    out["entry"] = with_session(out["entry"], window)
    out["exit"].setdefault("risk", {})["max_entries_per_session"] = int(cap)
    return out


def minute_of_day(stamps: np.ndarray) -> np.ndarray:
    """Pacific wall-clock minute of day (the lake stores futures wall-clock as UTC)."""
    return (stamps % 86400) // 60


def split_stats(net: np.ndarray, mask: np.ndarray, day_count: int, prefix: str) -> dict:
    x = net[mask]
    return {f"{prefix}_trades_per_session_day": x.size / day_count,
            f"{prefix}_net_ticks_per_session_day": float(x.sum() / day_count),
            f"{prefix}_net_ticks_per_trade": float(x.mean()) if x.size else math.nan,
            f"{prefix}_win_rate": float((x > 0).mean()) if x.size else math.nan}


def max_drawdown(daily: np.ndarray) -> float:
    equity = np.cumsum(daily)
    return float(np.max(np.maximum.accumulate(np.r_[0.0, equity])[1:] - equity)) if daily.size else math.nan


def run_span(span: dict, rc: dict, templates: dict, round_number: int, recipe: str, connection):
    from cycle.simulate import load_cost_model
    from ta_strategy import engine, levels, strategy
    from ta_strategy import metrics as m
    from ta_strategy.confirm import frozen_spec
    from ta_strategy.data import load_minutes_rebuilt

    symbol = span["symbol"]
    cost = load_cost_model(span["cost_symbol"])
    cost_ticks = cost.round_trip / cost.tick_value
    slippage = float(rc["costs"]["stop_slippage_ticks"])
    seeds = int(rc["nulls"]["matched_seeds"])
    side_reps = int(rc["nulls"]["random_side_replicates"])
    goal = float(rc["goal_ticks_per_session_day"])
    rth = rc["regular_hours_pacific"]
    rth_start = int(rth["start"][:2]) * 60 + int(rth["start"][3:])
    rth_end = int(rth["end"][:2]) * 60 + int(rth["end"][3:])
    variants = rc["variants"]
    bound = set(variants["session_bound_templates"])

    minutes = load_minutes_rebuilt(connection, symbol, span["data_start"], span["data_end"])
    protocol.emit_log(f"[data] {symbol} {span['data_start']}..{span['data_end']}: {len(minutes.frame):,} minutes, "
                      f"{len(minutes.rolls)} rolls; costs {cost_ticks:.2f} ticks ({span['cost_symbol']}) + {slippage:g} tick stop slippage")
    events = levels.all_level_events(minutes.frame, levels.minute_context(minutes.frame))

    rows, hour_rows, daily_frames, year_rows = [], [], [], []
    daily_by_setting: dict[tuple, dict[str, np.ndarray]] = {}
    trades_by_setting: dict[tuple, dict[str, float]] = {}
    null_by_setting: dict[tuple, dict[str, np.ndarray]] = {}
    for timeframe in variants["timeframes"]:
        ctx = strategy.build_context(minutes, timeframe, cost.tick_size, events)
        days = np.unique(ctx.minutes.days)
        stamps = ctx.minutes.stamps
        for entry in rc["frozen"]:
            base_template, params = frozen_spec(templates, entry)
            for session_name, window in variants["sessions"].items():
                if entry["template"] in bound and window is not None:
                    continue
                for cap, (strictness, overrides) in itertools.product(variants["maximum_entries_per_session"],
                                                                     variants["strictness"][entry["name"]].items()):
                    template = variant_template(base_template, window, cap)
                    entry_parameters = {**params, **overrides}
                    spec = strategy.materialize(template, entry_parameters)
                    exits = strategy.exit_arrays(ctx, spec)
                    index, sides = strategy.signal_entries(ctx, spec)
                    real = strategy.run(ctx, spec, index, sides, slippage, cost_ticks, exits)
                    real_daily = strategy.daily(real, days)
                    level_stop = strategy.uses_level_stop(spec)
                    nulls = []
                    for k in range(seeds):
                        ni, ns = strategy.matched_null_entries(ctx, spec, index, sides, 200_000 + k)
                        stops = strategy.geometry_matched_stops(ctx, real, ni, 300_000 + k) if level_stop else None
                        nulls.append(strategy.daily(strategy.run(ctx, spec, ni, ns, slippage, cost_ticks, exits, stop_ticks=stops), days))
                    null_daily = np.mean(nulls, axis=0)
                    excess = real_daily - null_daily
                    long_share = float((sides > 0).mean()) if sides.size else 0.5
                    side_totals = []
                    for k in range(side_reps):
                        rng = np.random.default_rng(400_000 + k)
                        random_sides = np.where(rng.random(index.size) < long_share, 1, -1).astype(np.int8)
                        stops = strategy.geometry_matched_stops(ctx, real, index, 500_000 + k) if level_stop else None
                        side_totals.append(strategy.run(ctx, spec, index, random_sides, slippage, cost_ticks, exits, stop_ticks=stops)["net"].sum())
                    net = real["net"]
                    entry_minute = minute_of_day(stamps[real["entry"]]) if net.size else np.empty(0, np.int64)
                    in_rth = (entry_minute >= rth_start) & (entry_minute < rth_end)
                    wins, losses = net[net > 0].sum(), -net[net <= 0].sum()
                    win_rate = float((net > 0).mean()) if net.size else math.nan
                    profit_factor = float(wins / losses) if losses > 0 else math.nan
                    net_per_trade = float(net.mean()) if net.size else math.nan
                    variant = f"{entry['name']}|{session_name}|cap{cap}|{timeframe}|{strictness}"
                    row = {"round": round_number, "recipe": recipe, "symbol": symbol, "variant": variant, "name": entry["name"],
                           "template": entry["template"], "session_window": session_name,
                           "session_window_json": json.dumps(window), "maximum_entries_per_session": int(cap),
                           "timeframe": timeframe, "entry_strictness": strictness, "entry_parameters_json": json.dumps(entry_parameters),
                           "session_day_count": int(days.size), "trades": int(net.size),
                           "trades_per_session_day": net.size / days.size,
                           "net_ticks_per_session_day": float(real_daily.mean()),
                           "gross_ticks_per_trade": float(real["gross"].mean()) if net.size else math.nan,
                           "net_ticks_per_trade": net_per_trade,
                           "matched_null_net_ticks_per_session_day": float(null_daily.mean()),
                           "excess_ticks_per_session_day": float(excess.mean()),
                           "excess_newey_west_t": m.newey_west_mean_t(excess, 5),
                           "random_side_null_net_ticks_per_session_day": float(np.mean(side_totals) / days.size),
                           "share_of_random_side_replicates_beaten": float((net.sum() > np.asarray(side_totals)).mean()),
                           "win_rate": win_rate, "profit_factor": profit_factor,
                           "meets_40_percent_win_rate_and_profit_factor_1_33": bool(win_rate >= 0.40 and profit_factor >= 1.333),
                           "long_share_of_trades": float((real["side"] > 0).mean()) if net.size else math.nan,
                           "share_of_goal_600": float(real_daily.mean() / goal),
                           "trades_per_session_day_needed_for_600_at_this_net_per_trade":
                               float(goal / net_per_trade) if net.size and net_per_trade > 0 else math.nan,
                           "maximum_drawdown_ticks": max_drawdown(real_daily),
                           "session_end_exit_share": float((real["reason"] == engine.EXIT_SESSION_END).mean()) if net.size else math.nan,
                           "rejected_signals": int(real["rejected"])}
                    row.update(split_stats(net, real["side"] > 0, days.size, "long"))
                    row.update(split_stats(net, real["side"] < 0, days.size, "short"))
                    row.update(split_stats(net, in_rth, days.size, "regular_hours"))
                    row.update(split_stats(net, ~in_rth, days.size, "overnight"))
                    row.update(m.eight_numbers(real_daily, "daily_net_ticks"))
                    rows.append(row)
                    if net.size:
                        hours = pd.DataFrame({"hour": entry_minute // 60, "net": net, "gross": real["gross"], "side": real["side"]})
                        for hour, g in hours.groupby("hour"):
                            hour_rows.append({"round": round_number, "recipe": recipe, "symbol": symbol, "variant": variant,
                                              "name": entry["name"], "session_window": session_name,
                                              "maximum_entries_per_session": int(cap), "timeframe": timeframe, "entry_strictness": strictness,
                                              "entry_hour_pacific": int(hour), "trades": int(len(g)),
                                              "net_ticks_per_trade": float(g["net"].mean()), "gross_ticks_per_trade": float(g["gross"].mean()),
                                              "win_rate": float((g["net"] > 0).mean()),
                                              "long_net_ticks_per_trade": float(g.loc[g["side"] > 0, "net"].mean()) if (g["side"] > 0).any() else math.nan,
                                              "short_net_ticks_per_trade": float(g.loc[g["side"] < 0, "net"].mean()) if (g["side"] < 0).any() else math.nan,
                                              "net_ticks_per_session_day": float(g["net"].sum() / days.size)})
                    day_years = pd.DatetimeIndex(days).year.to_numpy()
                    trade_years = real["year"]
                    for year in np.unique(day_years):
                        in_year = day_years == year
                        year_rows.append({"row_kind": "variant", "round": round_number, "recipe": recipe, "symbol": symbol, "variant": variant,
                                          "name": entry["name"], "session_window": session_name,
                                          "maximum_entries_per_session": int(cap), "timeframe": timeframe,
                                          "entry_strictness": strictness, "year": int(year), "session_day_count": int(in_year.sum()),
                                          "trades_per_session_day": float((trade_years == year).sum() / in_year.sum()),
                                          "net_ticks_per_session_day": float(real_daily[in_year].mean()),
                                          "excess_ticks_per_session_day": float(excess[in_year].mean()),
                                          "net_ticks_per_trade": float(net[trade_years == year].mean()) if (trade_years == year).any() else math.nan,
                                          "average_close_price": float(np.nanmean(ctx.minutes.close[np.isin(ctx.minutes.days, days[in_year])])),
                                          "share_of_goal_600": float(real_daily[in_year].mean() / goal)})
                    daily_frames.append(pd.DataFrame({"symbol": symbol, "variant": variant, "session_date": days,
                                                      "net_ticks": real_daily, "matched_null_net_ticks": null_daily, "excess_ticks": excess}))
                    # the day's total across books: a session-bound book joins every session setting with its frozen window
                    for setting_session in (variants["sessions"] if entry["template"] in bound else [session_name]):
                        key = (setting_session, int(cap), timeframe, strictness)
                        daily_by_setting.setdefault(key, {})[entry["name"]] = real_daily
                        null_by_setting.setdefault(key, {})[entry["name"]] = null_daily
                        trades_by_setting.setdefault(key, {})[entry["name"]] = net.size / days.size
                    protocol.emit_log(f"[{symbol} {variant}] {row['net_ticks_per_session_day']:+.1f} net ticks/day from "
                                      f"{row['trades_per_session_day']:.2f} trades/day ({net_per_trade:+.2f} per trade; RTH "
                                      f"{row['regular_hours_net_ticks_per_trade']:+.2f}, ETH {row['overnight_net_ticks_per_trade']:+.2f}; "
                                      f"long {row['long_net_ticks_per_session_day']:+.1f}/day, short {row['short_net_ticks_per_session_day']:+.1f}/day); "
                                      f"excess {row['excess_ticks_per_session_day']:+.1f} (t {row['excess_newey_west_t']:+.2f})")
    portfolio_rows, portfolio_year_rows = [], []
    for (session_name, cap, timeframe, strictness), books in sorted(daily_by_setting.items()):
        total = np.sum(np.vstack(list(books.values())), axis=0)
        null_total = np.sum(np.vstack(list(null_by_setting[(session_name, cap, timeframe, strictness)].values())), axis=0)
        excess = total - null_total
        prow = {"round": round_number, "recipe": recipe, "symbol": symbol, "session_window": session_name,
                "maximum_entries_per_session": cap, "timeframe": timeframe, "entry_strictness": strictness, "books": ",".join(sorted(books)),
                "trades_per_session_day": float(sum(trades_by_setting[(session_name, cap, timeframe, strictness)].values())),
                "net_ticks_per_session_day": float(total.mean()), "excess_ticks_per_session_day": float(excess.mean()),
                "excess_newey_west_t": m.newey_west_mean_t(excess, 5), "share_of_goal_600": float(total.mean() / goal),
                "share_of_days_net_positive": float((total > 0).mean()), "maximum_drawdown_ticks": max_drawdown(total)}
        prow.update(m.eight_numbers(total, "daily_net_ticks"))
        portfolio_rows.append(prow)
        years = pd.DatetimeIndex(days).year.to_numpy()
        for year in np.unique(years):
            in_year = years == year
            portfolio_year_rows.append({"row_kind": "all_books", "round": round_number, "recipe": recipe, "symbol": symbol, "session_window": session_name,
                                        "maximum_entries_per_session": cap, "timeframe": timeframe, "entry_strictness": strictness,
                                        "year": int(year), "session_day_count": int(in_year.sum()),
                                        "net_ticks_per_session_day": float(total[in_year].mean()),
                                        "excess_ticks_per_session_day": float(excess[in_year].mean()),
                                        "share_of_goal_600": float(total[in_year].mean() / goal),
                                        "share_of_days_at_or_above_600": float((total[in_year] >= goal).mean())})
        protocol.emit_log(f"[{symbol} all books | {session_name} cap{cap} {timeframe} {strictness}] {prow['net_ticks_per_session_day']:+.1f} net ticks/day "
                          f"({100 * prow['share_of_goal_600']:.1f}% of 600) from {prow['trades_per_session_day']:.2f} trades/day; "
                          f"excess {prow['excess_ticks_per_session_day']:+.1f} (t {prow['excess_newey_west_t']:+.2f})")
    return rows, hour_rows, daily_frames, portfolio_rows, year_rows + portfolio_year_rows


def run(args: argparse.Namespace) -> dict:
    from shared.data import _serving
    from ta_strategy import store

    started = time.monotonic()
    rounds = json.loads(Path(args.rounds_file).read_text(encoding="utf-8"))
    rc = rounds["rounds"][str(args.round_number)]
    templates = json.loads(Path(args.templates_file).read_text(encoding="utf-8"))["templates"]
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
    recipe = args.recipe or f"round_{args.round_number}_{stamp}"
    protocol.emit_config({"study": {"round": args.round_number, "title": rc["title"], "recipe": recipe, "hypothesis": rc["hypothesis"]},
                          "frozen": rc["frozen"], "variants": rc["variants"], "spans": rc["spans"]}, scope="run", label=recipe)
    connection = _serving()
    connection.execute("SET TimeZone='UTC'")
    rows, hour_rows, daily_frames, portfolio_rows, year_rows = [], [], [], [], []
    for span in rc["spans"]:
        if args.symbol and span["symbol"] != args.symbol:
            continue
        r, h, d, p, y = run_span(span, rc, templates, args.round_number, recipe, connection)
        year_rows += y
        rows += r
        hour_rows += h
        daily_frames += d
        portfolio_rows += p
    variants = pd.DataFrame(rows)
    portfolio = pd.DataFrame(portfolio_rows)
    goal = float(rc["goal_ticks_per_session_day"])
    summary = {}
    for symbol, g in portfolio.groupby("symbol"):
        best = g.sort_values("net_ticks_per_session_day").iloc[-1]
        v = variants[variants["symbol"] == symbol]
        both = v.dropna(subset=["regular_hours_net_ticks_per_trade", "overnight_net_ticks_per_trade"])
        summary[symbol] = {
            "best_setting": f"{best['session_window']} cap{best['maximum_entries_per_session']} {best['timeframe']} {best['entry_strictness']}",
            "best_net_ticks_per_session_day": float(best["net_ticks_per_session_day"]),
            "best_trades_per_session_day": float(best["trades_per_session_day"]),
            "best_share_of_goal_600": float(best["net_ticks_per_session_day"] / goal),
            "share_of_variants_where_overnight_nets_less_per_trade": float(
                (both["overnight_net_ticks_per_trade"] < both["regular_hours_net_ticks_per_trade"]).mean()) if len(both) else math.nan,
            "hypothesis_held_below_5_percent_of_goal": bool(best["net_ticks_per_session_day"] < 0.05 * goal)}
        protocol.emit_log(f"[{symbol} best] {summary[symbol]['best_setting']}: {summary[symbol]['best_net_ticks_per_session_day']:+.1f} "
                          f"net ticks/day ({100 * summary[symbol]['best_share_of_goal_600']:.1f}% of 600) from "
                          f"{summary[symbol]['best_trades_per_session_day']:.2f} trades/day; overnight nets less per trade in "
                          f"{100 * summary[symbol]['share_of_variants_where_overnight_nets_less_per_trade']:.0f}% of variants")
    round_row = pd.DataFrame([{"round": args.round_number, "recipe": recipe, "title": rc["title"], "question": rc["question"],
                               "hypothesis": rc["hypothesis"], "round_configuration_json": json.dumps(rc),
                               "summary_json": json.dumps(summary), "variant_count": int(len(variants)),
                               "elapsed_seconds": time.monotonic() - started,
                               "finished_at": datetime.now(timezone.utc).isoformat()}])
    tables = {"frequency_rounds": round_row, "frequency_variants": variants,
              "frequency_hours": pd.DataFrame(hour_rows), "frequency_portfolio": portfolio,
              "frequency_years": pd.DataFrame(year_rows),
              "frequency_daily": pd.concat(daily_frames, ignore_index=True)}
    directory = os.path.join(args.output_dir, f"ta_conditional_{recipe}_{args.symbol or 'all'}")
    paths = store.write_local(tables, directory)
    landing = None
    if not args.no_land:
        landing = store.land(paths, f"{recipe}_{args.symbol}" if args.symbol else recipe, f"TA conditional frequency round {args.round_number}", dataset=DATASET)
        for n, info in landing.items():
            protocol.emit_log(f"[save] {n}: {info['rows']:,} rows -> {info['uri']} (manifest {info['manifest']})")
    protocol.emit_done(directory, {"recipe": recipe, "summary": summary, "lake": landing})
    return {"recipe": recipe, "summary": summary}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--round", dest="round_number", type=int, default=4)
    parser.add_argument("--rounds-file", default=str(ROUNDS_PATH))
    parser.add_argument("--templates-file", default=str(TEMPLATES_PATH))
    parser.add_argument("--output-dir", default=str(ROOT / "data" / "models"))
    parser.add_argument("--symbol", default=None, help="run one span of the round (the spans are independent)")
    parser.add_argument("--recipe", default=None, help="shared recipe stem when the spans run as separate processes")
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
