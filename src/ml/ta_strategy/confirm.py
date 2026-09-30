"""Pre-registered confirmation of FROZEN conditional strategies on a span no round has touched.

    .venv/Scripts/python.exe src/ml/ta_strategy/confirm.py --round 3 --json

No tuning. The specs, the primary endpoint and the pass rule are written in
``src/config/ta_conditional_rounds.json`` and committed BEFORE the run. For each
frozen spec, the whole span is traded once, beside two nulls:
- matched random entries: the same session window, count per hour and long share.
  A level-stop strategy's null uses the real trades' risk in ATR units, resampled;
- random-side replicates: the strategy's own bars with random sides at its long
  share, also geometry-matched.

The primary endpoint is the equal-weight pooled daily excess over the matched
null. It is cost-symmetric: both sides pay the same costs per trade, so a price
era with smaller moves in ticks does not decide the answer by itself.
The verdict is mechanical.
"""

from __future__ import annotations

import argparse
import copy
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


def frozen_spec(templates: dict, entry: dict) -> dict:
    template = copy.deepcopy(templates[entry["template"]])
    if "exit_override" in entry:
        for key, value in entry["exit_override"].items():
            if value is None:
                template["exit"].pop(key, None)
            else:
                template["exit"][key] = value
    params = {k: v for k, v in entry["params"].items() if k in template["params"]}
    unused = set(template["params"]) - set(params)
    if unused:
        raise ValueError(f"frozen spec {entry['name']} leaves {sorted(unused)} unset")
    return template, params


def run(args: argparse.Namespace) -> dict:
    from cycle.simulate import load_cost_model
    from shared.data import _serving
    from ta_strategy import engine, levels, store, strategy
    from ta_strategy import metrics as m
    from ta_strategy.data import load_minutes_rebuilt

    started = time.monotonic()
    rounds = json.loads(Path(args.rounds_file).read_text(encoding="utf-8"))
    rc = rounds["rounds"][str(args.round_number)]
    templates = json.loads(Path(args.templates_file).read_text(encoding="utf-8"))["templates"]
    symbol = rc["symbol"]
    cost = load_cost_model(rc.get("cost_symbol", symbol))
    cost_ticks = cost.round_trip / cost.tick_value
    slippage = float(rc["costs"]["stop_slippage_ticks"])
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
    recipe = f"round_{args.round_number}_{stamp}"
    protocol.emit_config({"study": {"round": args.round_number, "title": rc["title"], "recipe": recipe, "hypothesis": rc["hypothesis"]},
                          "frozen": rc["frozen"], "primary": rc["primary_endpoint"], "pass": rc["pass_criteria"],
                          "span": [rc["data_start"], rc["data_end"]], "symbol": symbol, "cost_symbol": rc.get("cost_symbol", symbol)},
                         scope="run", label=recipe)
    connection = _serving()
    connection.execute("SET TimeZone='UTC'")
    minutes = load_minutes_rebuilt(connection, symbol, rc["data_start"], rc["data_end"])
    protocol.emit_log(f"[data] {symbol} 1m rebuilt one contract per session: {len(minutes.frame):,} minutes, {len(minutes.rolls)} rolls; "
                      f"costs {cost_ticks:.2f} ticks ({rc.get('cost_symbol', symbol)}) + {slippage:g} tick stop slippage")
    zone_events = None
    if rc.get("level_source") == "cascade":
        from ta_strategy import cascade as cascade_module

        zone_events = cascade_module.level_events(minutes.frame, tuple(rc.get("zone_timeframes", ("5m", "15m", "30m"))))
    ctx = strategy.build_context(minutes, rc["timeframe"], cost.tick_size, events=zone_events)
    days = np.unique(ctx.minutes.days)
    seeds = int(rc["nulls"]["matched_seeds"])
    side_reps = int(rc["nulls"]["random_side_replicates"])

    rows, daily_frames, trade_frames, excess_by_spec = [], [], [], {}
    for entry in rc["frozen"]:
        template, params = frozen_spec(templates, entry)
        spec = strategy.materialize(template, params)
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
        excess_by_spec[entry["name"]] = excess
        long_share = float((sides > 0).mean()) if sides.size else 0.5
        side_totals = []
        for k in range(side_reps):
            rng = np.random.default_rng(400_000 + k)
            random_sides = np.where(rng.random(index.size) < long_share, 1, -1).astype(np.int8)
            stops = strategy.geometry_matched_stops(ctx, real, index, 500_000 + k) if level_stop else None
            side_totals.append(strategy.run(ctx, spec, index, random_sides, slippage, cost_ticks, exits, stop_ticks=stops)["net"].sum())
        net = real["net"]
        wins, losses = net[net > 0].sum(), -net[net <= 0].sum()
        win_rate = float((net > 0).mean()) if net.size else math.nan
        profit_factor = float(wins / losses) if losses > 0 else math.nan
        row = {"round": args.round_number, "name": entry["name"], "template": entry["template"],
               "frozen_parameters_json": json.dumps(entry["params"]), "exit_override_json": json.dumps(entry.get("exit_override", {})),
               "is_two_to_one_bracket": spec["exit"].get("target", {}).get("kind") == "r" and float(spec["exit"]["target"].get("value", 0)) == 2.0,
               "session_day_count": int(days.size), "trades": int(net.size), "trades_per_session_day": net.size / days.size,
               "net_ticks_per_session_day": float(real_daily.mean()), "matched_null_net_ticks_per_session_day": float(null_daily.mean()),
               "excess_ticks_per_session_day": float(excess.mean()), "excess_newey_west_t": m.newey_west_mean_t(excess, 5),
               "random_side_null_net_ticks_per_session_day": float(np.mean(side_totals) / days.size),
               "share_of_random_side_replicates_beaten": float((net.sum() > np.asarray(side_totals)).mean()),
               "win_rate": win_rate, "profit_factor": profit_factor,
               "target_hit_rate": float((real["reason"] == engine.EXIT_TARGET).mean()) if net.size else math.nan,
               "meets_40_percent_win_rate_and_profit_factor_1_33": bool(win_rate >= 0.40 and profit_factor >= 1.333),
               "average_net_r": float(np.nanmean(real["net_r"])) if net.size else math.nan,
               "rejected_signals": int(real["rejected"])}
        for code, label in engine.EXIT_NAMES.items():
            row[f"exit_share_{label}"] = float((real["reason"] == code).mean()) if net.size else math.nan
        row.update(m.eight_numbers(real_daily, "daily_net_ticks"))
        rows.append(row)
        daily_frames.append(pd.DataFrame({"name": entry["name"], "session_date": days, "net_ticks": real_daily,
                                          "matched_null_net_ticks": null_daily, "excess_ticks": excess}))
        stamps = ctx.minutes.stamps
        trade_frames.append(pd.DataFrame({
            "name": entry["name"], "entry_timestamp": pd.to_datetime(stamps[real["entry"]], unit="s"),
            "exit_timestamp": pd.to_datetime(stamps[np.minimum(real["exit"], stamps.size - 1)], unit="s"),
            "session_date": real["day"], "side": np.where(real["side"] > 0, "long", "short"),
            "entry_price": real["entry_price"], "exit_price": real["exit_price"], "risk_ticks": real["risk_ticks"],
            "exit_reason": [engine.EXIT_NAMES[int(x)] for x in real["reason"]], "gross_ticks": real["gross"],
            "net_ticks": real["net"], "net_r_multiple": real["net_r"]}))
        protocol.emit_log(f"[{entry['name']}] {row['net_ticks_per_session_day']:+.1f} net ticks/day, excess over matched random "
                          f"{row['excess_ticks_per_session_day']:+.1f} (t {row['excess_newey_west_t']:+.2f}), win rate {win_rate:.3f}, "
                          f"PF {profit_factor:.2f}, {row['trades_per_session_day']:.2f} trades/day")

    # ── the pre-registered primary endpoint ─────────────────────────────────
    pooled = np.mean(np.vstack(list(excess_by_spec.values())), axis=0)
    trim = float(rc["primary_endpoint"]["trim_each_tail"])
    low, high = np.quantile(pooled, [trim, 1 - trim])
    trimmed = pooled[(pooled >= low) & (pooled <= high)]
    periods = np.array_split(np.arange(days.size), int(rc["primary_endpoint"]["sub_periods"]))
    period_means = [float(pooled[p].mean()) for p in periods]
    t_pooled = m.newey_west_mean_t(pooled, 5)
    t_trimmed = m.newey_west_mean_t(trimmed, 5)
    criteria = rc["pass_criteria"]
    verdict = bool(t_pooled >= criteria["pooled_excess_newey_west_t_minimum"]
                   and t_trimmed >= criteria["trimmed_pooled_excess_newey_west_t_minimum"]
                   and sum(v > 0 for v in period_means) >= criteria["sub_periods_positive_minimum"])
    protocol.emit_log(f"[primary] pooled excess {pooled.mean():+.2f} ticks/day (t {t_pooled:+.2f}); trimmed {trimmed.mean():+.2f} "
                      f"(t {t_trimmed:+.2f}); sub-periods {', '.join(f'{v:+.1f}' for v in period_means)} -> "
                      f"{'CONFIRMED' if verdict else 'NOT CONFIRMED'}")
    round_row = pd.DataFrame([{
        "round": args.round_number, "recipe": recipe, "title": rc["title"], "hypothesis": rc["hypothesis"],
        "round_configuration_json": json.dumps(rc), "symbol": symbol, "cost_symbol": rc.get("cost_symbol", symbol),
        "span_start": rc["data_start"], "span_end": rc["data_end"], "session_day_count": int(days.size),
        "pooled_excess_ticks_per_session_day": float(pooled.mean()), "pooled_excess_newey_west_t": t_pooled,
        "trimmed_pooled_excess_ticks_per_session_day": float(trimmed.mean()), "trimmed_pooled_excess_newey_west_t": t_trimmed,
        "sub_period_pooled_excess_json": json.dumps(period_means),
        "sub_period_bounds_json": json.dumps([[str(pd.Timestamp(days[p[0]]).date()), str(pd.Timestamp(days[p[-1]]).date())] for p in periods]),
        "confirmed": verdict, "elapsed_seconds": time.monotonic() - started, "finished_at": datetime.now(timezone.utc).isoformat()}])
    tables = {"confirmation_rounds": round_row, "confirmation_strategies": pd.DataFrame(rows),
              "confirmation_daily": pd.concat(daily_frames, ignore_index=True),
              "confirmation_trades": pd.concat(trade_frames, ignore_index=True)}
    # the level study again, with the fractal test window fixed (secondary, descriptive)
    if rc.get("level_study_symbol"):
        level_minutes = minutes if rc["level_study_symbol"] == symbol else load_minutes_rebuilt(
            connection, rc["level_study_symbol"], rc["level_study_start"], rc["level_study_end"])
        lctx = levels.minute_context(level_minutes.frame)
        _, quality = levels.level_quality(level_minutes.frame, levels.all_level_events(level_minutes.frame, lctx), lctx,
                                          permutations=int(rc["level_study"]["null_a_permutations"]))
        shuffled = []
        for s in range(int(rc["level_study"]["null_b_shuffles"])):
            sm = levels.shuffled_minutes(level_minutes.frame, 100 + s)
            sctx = levels.minute_context(sm)
            _, sq = levels.level_quality(sm, levels.all_level_events(sm, sctx), sctx, permutations=int(rc["level_study"]["null_a_permutations"]))
            shuffled.append(sq)
        sq = pd.concat(shuffled).groupby(["family", "year"], as_index=False)["held_rate_lift_over_null"].mean().rename(
            columns={"held_rate_lift_over_null": "shuffled_lift_over_null"})
        quality["year"] = quality["year"].astype(str)
        sq["year"] = sq["year"].astype(str)
        quality = quality.merge(sq, on=["family", "year"], how="left")
        quality["lift_net_of_mechanics"] = quality["held_rate_lift_over_null"] - quality["shuffled_lift_over_null"]
        quality["symbol"] = rc["level_study_symbol"]
        tables["level_quality_fractal_window_fixed"] = quality
        for r in quality[quality["year"] == "all"].sort_values("lift_net_of_mechanics").itertuples():
            protocol.emit_log(f"[levels, fixed window] {r.family}: lift {r.held_rate_lift_over_null:+.3f}, shuffled {r.shuffled_lift_over_null:+.3f}, "
                              f"net of mechanics {r.lift_net_of_mechanics:+.3f}")
    tables = {k: v.assign(round=args.round_number) if "round" not in v.columns else v for k, v in tables.items()}
    directory = os.path.join(args.output_dir, f"{symbol}_ta_conditional_{recipe}")
    paths = store.write_local(tables, directory)
    landing = None
    if not args.no_land:
        landing = store.land(paths, recipe, f"TA conditional confirmation round {args.round_number}", dataset=DATASET)
        for n, info in landing.items():
            protocol.emit_log(f"[save] {n}: {info['rows']:,} rows -> {info['uri']} (manifest {info['manifest']})")
    protocol.emit_done(directory, {"recipe": recipe, "confirmed": verdict, "lake": landing})
    return {"recipe": recipe, "confirmed": verdict}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--round", dest="round_number", type=int, default=3)
    parser.add_argument("--rounds-file", default=str(ROUNDS_PATH))
    parser.add_argument("--templates-file", default=str(TEMPLATES_PATH))
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
