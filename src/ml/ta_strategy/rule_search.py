"""Search conditional TA-Lib strategies with 2:1 brackets against a 40% win rate and 600 ticks/day.

    .venv/Scripts/python.exe src/ml/ta_strategy/rule_search.py --round 1 --json

Every (timeframe, rule, filter, stop) is one strategy. Each is simulated over the
whole span once (``bracket.simulate``); its trades are split by the entry's session
day into the in-sample span (where a person would choose) and the out-of-sample
span (where the choice is judged). Beside them, random entries into the same
brackets show what the bracket alone produces. Lands in
``s3://derived/ta_rule_strategies_600_ticks/recipe=round_<n>_<stamp>/``.
"""

from __future__ import annotations

import argparse
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

ROUNDS_PATH = ROOT / "src" / "config" / "ta_rule_rounds.json"
DATASET = "ta_rule_strategies_600_ticks"
KEEP_TRADES_FOR = 40            # strategies whose trades and days are stored (best in-sample + every target-meeting one)


def period_metrics(net: np.ndarray, gross: np.ndarray, reason: np.ndarray, side: np.ndarray, day_count: int,
                   prefix: str) -> dict:
    n = net.size
    out = {f"{prefix}_session_day_count": day_count, f"{prefix}_trade_count": n,
           f"{prefix}_trades_per_session_day": n / day_count if day_count else math.nan}
    if n == 0:
        return out
    wins, losses = net[net > 0], net[net <= 0]
    loss_sum = -losses.sum()
    cumulative = np.cumsum(net)
    out.update({
        f"{prefix}_win_rate": float((net > 0).mean()),
        f"{prefix}_target_hit_rate": float((reason == 1).mean()),
        f"{prefix}_stop_hit_rate": float((reason == 0).mean()),
        f"{prefix}_session_end_exit_rate": float((reason == 2).mean()),
        f"{prefix}_average_win_ticks": float(wins.mean()) if wins.size else math.nan,
        f"{prefix}_average_loss_ticks": float(losses.mean()) if losses.size else math.nan,
        f"{prefix}_payoff_ratio": float(wins.mean() / -losses.mean()) if wins.size and losses.size and losses.mean() < 0 else math.nan,
        f"{prefix}_profit_factor": float(wins.sum() / loss_sum) if loss_sum > 0 else math.nan,
        f"{prefix}_expectancy_net_ticks_per_trade": float(net.mean()),
        f"{prefix}_expectancy_gross_ticks_per_trade": float(gross.mean()),
        f"{prefix}_net_ticks_per_session_day": float(net.sum() / day_count) if day_count else math.nan,
        f"{prefix}_gross_ticks_per_session_day": float(gross.sum() / day_count) if day_count else math.nan,
        f"{prefix}_long_share_of_trades": float((side > 0).mean()),
        f"{prefix}_maximum_drawdown_ticks": float((cumulative - np.maximum.accumulate(np.r_[0.0, cumulative])[1:]).min()),
    })
    return out


def meets(row: dict, prefix: str, targets: dict) -> bool:
    return bool(
        row.get(f"{prefix}_trade_count", 0) >= targets["minimum_trades"]
        and row.get(f"{prefix}_win_rate", 0) >= targets["win_rate_minimum"]
        and row.get(f"{prefix}_profit_factor", 0) >= targets["profit_factor_minimum"]
    )


def run(args: argparse.Namespace) -> dict:
    import talib

    from cycle.simulate import load_cost_model
    from shared.data import _serving
    from ta_strategy import bracket, rules, store
    from ta_strategy.data import effective_roll_timestamps, load_bars, session_dates

    started = time.monotonic()
    config = json.loads(Path(args.rounds_file).read_text(encoding="utf-8"))
    rc = config["rounds"][str(args.round_number)]
    symbol = config["symbol"]
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
    recipe = f"round_{args.round_number}_{stamp}"
    cost = load_cost_model(symbol)
    tick = cost.tick_size
    cost_ticks = cost.round_trip / cost.tick_value
    targets = rc["targets"]
    split = np.datetime64(pd.Timestamp(rc["in_sample_end"]))
    rule_list = [rules.make_rule(family, **p) for family, grid in rc["rules"].items() for p in grid]
    total = len(rc["timeframes"]) * len(rule_list) * len(rc["filters"]) * len(rc["stops"])
    protocol.emit_config({"study": {"round": args.round_number, "title": rc["title"], "recipe": recipe,
                                    "hypothesis": rc["hypothesis"]},
                          "grid": {"strategies": total, "rules": len(rule_list), "filters": rc["filters"],
                                   "stops": rc["stops"], "timeframes": rc["timeframes"]},
                          "costs": {"round_trip_ticks": cost_ticks}, "targets": targets}, scope="run", label=recipe)
    protocol.emit_log(f"[plan] {total:,} strategies ({len(rule_list)} rules x {len(rc['filters'])} filters x "
                      f"{len(rc['stops'])} stops x {len(rc['timeframes'])} timeframes), reward {rc['reward_multiple']:g}:1, "
                      f"cost {cost_ticks:.2f} ticks a round trip; choose on < {rc['in_sample_end']}, judge on the rest")

    connection = _serving()
    connection.execute("SET TimeZone='UTC'")
    rows, kept_trades = [], {}
    baseline_rows = []
    done = 0
    for tf in rc["timeframes"]:
        loaded = load_bars(connection, symbol, tf, rc["data_start"], rc["data_end"])
        frame = loaded.frame
        b = rules.bars_dict(frame)
        stamps = frame["timestamp"].to_numpy(np.int64)
        days = session_dates(stamps)
        session_last = np.r_[days[1:] != days[:-1], True]
        roll_after = np.zeros(stamps.size, dtype=np.bool_)
        for r in effective_roll_timestamps(loaded.rolls):
            k = int(np.searchsorted(stamps, r))
            if 0 < k < stamps.size:
                roll_after[k] = True
        moments = pd.to_datetime(stamps, unit="s")
        minute = (moments.hour * 60 + moments.minute).to_numpy()
        atr = talib.ATR(b["high"], b["low"], b["close"], 14)
        in_sample_day = days < split
        day_counts = {"in_sample": int(np.unique(days[in_sample_day]).size),
                      "out_of_sample": int(np.unique(days[~in_sample_day]).size)}
        stop_arrays = {f"{s['mode']}{s['value']:g}": bracket.stop_distance_ticks(s["mode"], s["value"], atr, tick)
                       for s in rc["stops"]}
        protocol.emit_log(f"[data] {symbol} {tf}: {len(frame):,} bars, {day_counts['in_sample']} in-sample and "
                          f"{day_counts['out_of_sample']} out-of-sample session days")

        def score(signal: np.ndarray, stop_key: str):
            e_i, x_i, side, e_p, x_p, stop_t, reason, rolls = bracket.simulate(
                b["open"], b["high"], b["low"], b["close"], signal, stop_arrays[stop_key], session_last, roll_after,
                tick, float(rc["reward_multiple"]))
            gross = side * (x_p - e_p) / tick
            net = gross - cost_ticks * (1 + rolls)
            entry_day = days[e_i]
            return e_i, x_i, side, e_p, x_p, stop_t, reason, rolls, gross, net, entry_day

        def metrics_for(result) -> dict:
            _, _, side_, _, _, _, reason_, _, gross, net, entry_day = result
            out = {}
            for name, mask in (("in_sample", entry_day < split), ("out_of_sample", entry_day >= split)):
                out.update(period_metrics(net[mask], gross[mask], reason_[mask], side_[mask], day_counts[name], name))
            return out

        # random entries into the same brackets: what the bracket alone produces
        for stop_key in stop_arrays:
            for seed in range(int(rc["random_entry"]["seeds"])):
                rng = np.random.default_rng(1000 + seed)
                fire = rng.random(stamps.size) < float(rc["random_entry"]["probability_per_bar"])
                signal = np.where(fire, np.where(rng.random(stamps.size) < 0.5, 1, -1), 0).astype(np.int8)
                baseline_rows.append({"timeframe": tf, "stop": stop_key, "seed": seed, **metrics_for(score(signal, stop_key))})

        for rule in rule_list:
            raw = rule.signal(b)
            for filter_name in rc["filters"]:
                signal = rules.apply_filter(raw, filter_name, b, minute)
                for stop_key in stop_arrays:
                    result = score(signal, stop_key)
                    strategy_id = f"{tf}_{rule.rule_id}_{filter_name}_{stop_key}"
                    row = {"round": args.round_number, "strategy_id": strategy_id, "timeframe": tf,
                           "rule_family": rule.family, "rule_id": rule.rule_id,
                           "rule_parameters": json.dumps(dict(rule.parameters)), "rule_description": rule.description,
                           "filter": filter_name, "stop": stop_key, "reward_multiple": float(rc["reward_multiple"]),
                           "signal_count": int((signal != 0).sum()), **metrics_for(result)}
                    row["in_sample_meets_target"] = meets(row, "in_sample", targets)
                    row["out_of_sample_meets_target"] = meets(row, "out_of_sample", targets)
                    rows.append(row)
                    kept_trades[strategy_id] = (result, stamps, days)
                    done += 1
                    if done % 50 == 0:
                        protocol.emit_progress(done, total, "simulating")
            # keep memory flat: only the best in-sample trades survive past each rule
            if len(kept_trades) > 4 * KEEP_TRADES_FOR:
                keep = {r["strategy_id"] for r in sorted(
                    (r for r in rows if r.get("in_sample_trade_count", 0) >= targets["minimum_trades"]),
                    key=lambda r: -r.get("in_sample_net_ticks_per_session_day", -1e9))[:KEEP_TRADES_FOR]}
                keep |= {r["strategy_id"] for r in rows if r["in_sample_meets_target"]}
                kept_trades = {k: v for k, v in kept_trades.items() if k in keep}
        protocol.emit_log(f"[{tf}] {sum(1 for r in rows if r['timeframe'] == tf):,} strategies scored")

    strategies = pd.DataFrame(rows)
    baselines = pd.DataFrame(baseline_rows)
    eligible = strategies[strategies["in_sample_trade_count"] >= targets["minimum_trades"]]
    chosen = eligible.sort_values("in_sample_net_ticks_per_session_day", ascending=False).head(KEEP_TRADES_FOR)
    keep_ids = set(chosen["strategy_id"]) | set(strategies.loc[strategies["in_sample_meets_target"], "strategy_id"])

    trade_frames, daily_frames = [], []
    for strategy_id in keep_ids:
        if strategy_id not in kept_trades:
            continue
        (e_i, x_i, side, e_p, x_p, stop_t, reason, rolls, gross, net, entry_day), stamps, days = kept_trades[strategy_id]
        trade_frames.append(pd.DataFrame({
            "strategy_id": strategy_id, "entry_timestamp": pd.to_datetime(stamps[e_i], unit="s"),
            "exit_timestamp": pd.to_datetime(stamps[x_i], unit="s"), "session_date": entry_day,
            "side": np.where(side > 0, "long", "short"), "entry_price": e_p, "exit_price": x_p,
            "stop_distance_ticks": stop_t, "exit_reason": [bracket.EXIT_NAMES[int(r)] for r in reason],
            "rolls_crossed": rolls, "gross_ticks": gross, "net_ticks": net,
            "period": np.where(entry_day < split, "in_sample", "out_of_sample")}))
        all_days = pd.Index(np.unique(days), name="session_date")
        per_day = pd.Series(net).groupby(entry_day).sum().reindex(all_days, fill_value=0.0)
        daily_frames.append(pd.DataFrame({"strategy_id": strategy_id, "session_date": all_days, "net_ticks": per_day.to_numpy(),
                                          "period": np.where(all_days.values < split, "in_sample", "out_of_sample")}))

    from scipy import stats

    both = eligible.dropna(subset=["in_sample_net_ticks_per_session_day", "out_of_sample_net_ticks_per_session_day"])
    rank_correlation = float(stats.spearmanr(both["in_sample_net_ticks_per_session_day"],
                                             both["out_of_sample_net_ticks_per_session_day"]).statistic) if len(both) > 3 else math.nan
    baseline_win = baselines.groupby(["timeframe", "stop"])[["in_sample_win_rate", "out_of_sample_win_rate"]].mean()
    top = chosen.iloc[0] if len(chosen) else None
    summary = {
        "round": args.round_number, "recipe": recipe, "title": rc["title"], "hypothesis": rc["hypothesis"],
        "round_configuration_json": json.dumps(rc), "strategy_count": len(strategies),
        "strategies_with_enough_in_sample_trades": len(eligible),
        "in_sample_meeting_target": int(strategies["in_sample_meets_target"].sum()),
        "out_of_sample_meeting_target": int(strategies["out_of_sample_meets_target"].sum()),
        "meeting_target_in_both": int((strategies["in_sample_meets_target"] & strategies["out_of_sample_meets_target"]).sum()),
        "in_sample_to_out_of_sample_rank_correlation": rank_correlation,
        "best_in_sample_strategy_id": None if top is None else top["strategy_id"],
        "best_in_sample_net_ticks_per_session_day": None if top is None else float(top["in_sample_net_ticks_per_session_day"]),
        "best_in_sample_out_of_sample_net_ticks_per_session_day": None if top is None else float(top["out_of_sample_net_ticks_per_session_day"]),
        "best_out_of_sample_net_ticks_per_session_day": float(eligible["out_of_sample_net_ticks_per_session_day"].max()),
        "random_entry_win_rate_mean": float(baselines["out_of_sample_win_rate"].mean()),
        "cost_ticks_per_round_trip": cost_ticks, "elapsed_seconds": time.monotonic() - started,
        "finished_at": datetime.now(timezone.utc).isoformat(),
    }
    protocol.emit_log(f"[result] {summary['in_sample_meeting_target']} strategies meet 40%/PF 1.33 in sample, "
                      f"{summary['out_of_sample_meeting_target']} out of sample, {summary['meeting_target_in_both']} in both; "
                      f"in-sample -> out-of-sample rank correlation {rank_correlation:+.3f}; random-entry win rate "
                      f"{summary['random_entry_win_rate_mean']:.3f}")
    tables = {"rounds": pd.DataFrame([summary]), "strategies": strategies, "random_entry_baselines": baselines,
              "random_entry_win_rate_by_bracket": baseline_win.reset_index(),
              "trades": pd.concat(trade_frames, ignore_index=True) if trade_frames else pd.DataFrame(),
              "daily": pd.concat(daily_frames, ignore_index=True) if daily_frames else pd.DataFrame()}
    tables = {k: v.assign(round=args.round_number) if "round" not in v.columns else v for k, v in tables.items() if len(v)}
    directory = os.path.join(args.output_dir, f"MNQ_ta_rules_{recipe}")
    paths = store.write_local(tables, directory)
    landing = None
    if not args.no_land:
        landing = store.land(paths, recipe, f"TA rule search round {args.round_number}", dataset=DATASET)
        for name, info in landing.items():
            protocol.emit_log(f"[save] {name}: {info['rows']:,} rows -> {info['uri']} (manifest {info['manifest']})")
    protocol.emit_done(directory, {"summary": summary, "lake": landing})
    return summary


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--round", dest="round_number", type=int, default=1)
    parser.add_argument("--rounds-file", default=str(ROUNDS_PATH))
    parser.add_argument("--output-dir", default=str(ROOT / "data" / "models"))
    parser.add_argument("--no-land", action="store_true")
    parser.add_argument("--json", action="store_true")
    for ignored in ("--symbol", "--timeframe", "--model-id", "--max-bars", "--date-start", "--date-end"):
        parser.add_argument(ignored, default=None)
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
