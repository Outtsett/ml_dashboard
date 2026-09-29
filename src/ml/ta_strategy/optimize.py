"""Multi-timeframe S/R study + conditional strategies whose parameters Optuna tunes, walk-forward.

    .venv/Scripts/python.exe src/ml/ta_strategy/optimize.py --round 1 --json

1. **Levels.** Build every multi-timeframe level event (``levels.all_level_events``) and the
   zones at each strategy bar. Measure each level family's hold rate against two nulls:
   - A, distance-matched random levels in other sessions;
   - B, the whole pipeline re-run on sessions whose minutes were shuffled, which is the
     mechanical bounce a level definition produces on its own.
   A family's real edge is its lift over A minus that same lift in the shuffled world.
2. **Templates.** For each template and each test year Y, Optuna's TPE sampler tunes the
   template's parameters on the sessions BEFORE Y only.
   - Objective: the per-day Sharpe of the daily excess over matched random entries (same
     session window, count per hour and long share, same exits). A strategy therefore
     cannot win by being long a rising market or by holding to the session close.
   - Constraints: at least a minimum number of trades per day, and a cap on session-end exits.
   - The best trials are re-scored against fresh null seeds before one is chosen, so the
     optimizer cannot fit the in-loop null's own noise.
   - The chosen parameters then trade year Y once, against 40 fresh null seeds.
3. **Stitched out-of-sample (2022-2025).** Per template: net and excess ticks per session day,
   Newey-West t of the excess, folds positive, target-hit rate, profit factor, exit mix, and
   a random-side null (own entries, random sides at the strategy's long share). The deflated
   Sharpe counts every trial.
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

ROUNDS_PATH = ROOT / "src" / "config" / "ta_conditional_rounds.json"
TEMPLATES_PATH = ROOT / "src" / "config" / "ta_conditional_templates.json"
DATASET = "ta_conditional_strategies_600_ticks"


def suggest(trial, name: str, space: dict):
    if space["type"] == "int":
        return trial.suggest_int(name, int(space["low"]), int(space["high"]), step=int(space.get("step", 1)))
    return trial.suggest_float(name, float(space["low"]), float(space["high"]), step=space.get("step"))


def run(args: argparse.Namespace) -> dict:
    import optuna

    from cycle.simulate import load_cost_model
    from shared.data import _serving
    from ta_strategy import engine, levels, store, strategy
    from ta_strategy import metrics as m
    from ta_strategy.data import load_minutes_rebuilt

    optuna.logging.set_verbosity(optuna.logging.WARNING)
    started = time.monotonic()
    rounds = json.loads(Path(args.rounds_file).read_text(encoding="utf-8"))
    rc = rounds["rounds"][str(args.round_number)]
    templates = json.loads(Path(args.templates_file).read_text(encoding="utf-8"))["templates"]
    symbol = rounds["symbol"]
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
    recipe = f"round_{args.round_number}_{stamp}"
    cost = load_cost_model(symbol)
    cost_ticks = cost.round_trip / cost.tick_value
    slippage = float(rc["costs"]["stop_slippage_ticks"])
    names = args.templates.split(",") if args.templates else rc["templates"]
    protocol.emit_config({"study": {"round": args.round_number, "title": rc["title"], "recipe": recipe, "hypothesis": rc["hypothesis"]},
                          "templates": names, "test_years": rc["test_years"], "optuna": rc["optuna"], "nulls": rc["nulls"],
                          "constraints": rc["constraints"], "costs": {"round_trip_ticks": cost_ticks, "stop_slippage_ticks": slippage}},
                         scope="run", label=recipe)

    connection = _serving()
    connection.execute("SET TimeZone='UTC'")
    minutes = load_minutes_rebuilt(connection, symbol, rc["data_start"], rc["data_end"])
    protocol.emit_log(f"[data] {symbol} 1m rebuilt one contract per session: {len(minutes.frame):,} minutes, {len(minutes.rolls)} rolls")

    # ── 1. multi-timeframe levels and their quality ────────────────────────
    level_ctx = levels.minute_context(minutes.frame)
    events = levels.all_level_events(minutes.frame, level_ctx)
    tests, quality = levels.level_quality(minutes.frame, events, level_ctx, permutations=int(rc["level_study"]["null_a_permutations"]))
    shuffled_rows = []
    for s in range(int(rc["level_study"]["null_b_shuffles"])):
        shuffled = levels.shuffled_minutes(minutes.frame, 100 + s)
        sctx = levels.minute_context(shuffled)
        _, sq = levels.level_quality(shuffled, levels.all_level_events(shuffled, sctx), sctx,
                                     permutations=int(rc["level_study"]["null_a_permutations"]))
        shuffled_rows.append(sq.assign(shuffle=s))
    shuffled_quality = pd.concat(shuffled_rows).groupby(["family", "year"], as_index=False)[
        ["held_rate", "null_held_rate", "held_rate_lift_over_null"]].mean().rename(columns={
            "held_rate": "shuffled_held_rate", "null_held_rate": "shuffled_null_held_rate",
            "held_rate_lift_over_null": "shuffled_lift_over_null"})
    quality["year"] = quality["year"].astype(str)
    shuffled_quality["year"] = shuffled_quality["year"].astype(str)
    quality = quality.merge(shuffled_quality, on=["family", "year"], how="left")
    quality["lift_net_of_mechanics"] = quality["held_rate_lift_over_null"] - quality["shuffled_lift_over_null"]
    for r in quality[quality["year"] == "all"].sort_values("lift_net_of_mechanics").itertuples():
        protocol.emit_log(f"[levels] {r.family}: held {r.held_rate:.3f} vs distance-matched random {r.null_held_rate:.3f} "
                          f"(lift {r.held_rate_lift_over_null:+.3f}, z {r.lift_z:+.1f}); shuffled-world lift "
                          f"{r.shuffled_lift_over_null:+.3f}; net of mechanics {r.lift_net_of_mechanics:+.3f}")

    # ── 2. strategy context and walk-forward tuning ────────────────────────
    ctx = strategy.build_context(minutes, rc["timeframe"], cost.tick_size, events=events)
    bar_day = ctx.minutes.days[ctx.last_minute]
    all_days = np.unique(ctx.minutes.days)
    base_cache_keys = set(ctx.cache)
    in_loop, rescore_seeds = int(rc["nulls"]["seeds_in_loop"]), int(rc["nulls"]["seeds_rescore_and_test"])

    def evaluate(spec, day_mask_bars, days, seeds, seed_base, exits=None):
        index, sides = strategy.signal_entries(ctx, spec)
        keep = day_mask_bars[index]
        index, sides = index[keep], sides[keep]
        exits = exits or strategy.exit_arrays(ctx, spec)
        real = strategy.run(ctx, spec, index, sides, slippage, cost_ticks, exits)
        real_daily = strategy.daily(real, days)
        nulls = []
        for k in range(seeds):
            ni, ns = strategy.matched_null_entries(ctx, spec, index, sides, seed_base + k, day_mask_bars)
            nulls.append(strategy.daily(strategy.run(ctx, spec, ni, ns, slippage, cost_ticks, exits), days))
        null_daily = np.mean(nulls, axis=0) if nulls else np.zeros(days.size)
        excess = real_daily - null_daily
        sharpe = float(excess.mean() / excess.std(ddof=1)) if excess.std(ddof=1) > 0 else 0.0
        n = real["net"].size
        session_end = float((real["reason"] == engine.EXIT_SESSION_END).mean()) if n else 1.0
        return {"real": real, "real_daily": real_daily, "null_daily": null_daily, "excess": excess, "sharpe": sharpe,
                "trades": n, "trades_per_day": n / max(days.size, 1), "session_end_share": session_end,
                "index": index, "sides": sides}

    trial_rows, fold_rows, stitched = [], [], {}
    trial_sharpes = []
    for name in names:
        template = templates[name]
        stitched[name] = {"trades": [], "real_daily": [], "null_daily": [], "days": [], "params": []}
        for fold, year in enumerate(rc["test_years"]):
            train_end = np.datetime64(f"{year}-01-01")
            test_end = np.datetime64(f"{year + 1}-01-01")
            train_days = all_days[all_days < train_end]
            test_days = all_days[(all_days >= train_end) & (all_days < test_end)]
            train_bars = bar_day < train_end
            test_bars = (bar_day >= train_end) & (bar_day < test_end)

            constraints = {**rc["constraints"], **template.get("constraints", {})}
            rate_floor = float(constraints["minimum_trades_per_session_day"])
            session_end_cap = float(constraints["maximum_session_end_exit_share"])
            seen: dict[str, tuple] = {}

            def objective(trial):
                params = {p: suggest(trial, p, space) for p, space in template["params"].items()}
                key = json.dumps(params, sort_keys=True)
                if key in seen:                  # TPE re-proposes grid points: reuse, never re-count as a new configuration
                    value, attrs = seen[key]
                    for name_, v in attrs.items():
                        trial.set_user_attr(name_, v)
                    trial.set_user_attr("duplicate", True)
                    return value
                spec = strategy.materialize(template, params)
                result = evaluate(spec, train_bars, train_days, in_loop, 7_000)
                attrs = {"trades_per_day": result["trades_per_day"], "session_end_share": result["session_end_share"],
                         "trades": result["trades"], "raw_excess_sharpe": result["sharpe"], "duplicate": False}
                for name_, v in attrs.items():
                    trial.set_user_attr(name_, v)
                if len(ctx.cache) > 600:        # parameter-dependent series: drop them, keep the base ones
                    for k in [k for k in ctx.cache if k not in base_cache_keys]:
                        del ctx.cache[k]
                penalty = max(0.0, rate_floor - result["trades_per_day"]) * 10 + max(0.0, result["session_end_share"] - session_end_cap) * 10
                value = result["sharpe"] - penalty
                seen[key] = (value, {k: v for k, v in attrs.items() if k != "duplicate"})
                return value

            sampler = optuna.samplers.TPESampler(multivariate=True, group=True, constant_liar=True,
                                                 n_startup_trials=int(rc["optuna"]["startup_trials"]),
                                                 seed=int(rc["optuna"]["seed"]) + fold)
            study = optuna.create_study(direction="maximize", sampler=sampler)
            study.enqueue_trial(template["defaults"])
            study.optimize(objective, n_trials=int(rc["optuna"]["trials_per_fold"]))
            done = [t for t in study.trials if t.value is not None]
            study_sharpes = []
            for t in done:
                feasible = (t.user_attrs.get("trades_per_day", 0) >= rate_floor
                            and t.user_attrs.get("session_end_share", 1) <= session_end_cap)
                trial_rows.append({"round": args.round_number, "template": name, "fold": fold, "test_year": year,
                                   "trial": t.number, "objective_excess_sharpe_per_day": t.value,
                                   "raw_excess_sharpe_per_day": t.user_attrs.get("raw_excess_sharpe"),
                                   "feasible": feasible, "duplicate_of_earlier_trial": bool(t.user_attrs.get("duplicate")),
                                   "trades_per_session_day": t.user_attrs.get("trades_per_day"),
                                   "session_end_exit_share": t.user_attrs.get("session_end_share"),
                                   "parameters_json": json.dumps(t.params)})
                if feasible and not t.user_attrs.get("duplicate"):
                    study_sharpes.append(t.user_attrs["raw_excess_sharpe"])
            # deflation input: feasible, DISTINCT configurations' raw Sharpes, demeaned within the study
            # (round 1 used the penalised objective, variance 0.63 against 0.0019)
            if study_sharpes:
                trial_sharpes.extend(np.asarray(study_sharpes) - np.mean(study_sharpes))
            # re-score the best DISTINCT trials against fresh null seeds, then choose
            distinct = {json.dumps(t.params, sort_keys=True): t for t in sorted(done, key=lambda t: t.value)}
            top = sorted(distinct.values(), key=lambda t: -t.value)[: int(rc["optuna"]["rescore_top"])]
            rescored = []
            for t in top:
                spec = strategy.materialize(template, t.params)
                r = evaluate(spec, train_bars, train_days, rescore_seeds, 50_000)
                feasible = r["trades_per_day"] >= rate_floor and r["session_end_share"] <= session_end_cap
                rescored.append((r["sharpe"] if feasible else -np.inf, t, r))
            best_score, best_trial, best_train = max(rescored, key=lambda x: x[0])
            spec = strategy.materialize(template, best_trial.params)
            test = evaluate(spec, test_bars, test_days, rescore_seeds, 90_000)
            real = test["real"]
            wins, losses = real["net"][real["net"] > 0].sum(), -real["net"][real["net"] <= 0].sum()
            row = {"round": args.round_number, "template": name, "fold": fold, "test_year": year,
                   "chosen_parameters_json": json.dumps(best_trial.params), "chosen_trial": best_trial.number,
                   "train_objective": best_trial.value, "train_rescored_excess_sharpe_per_day": best_score,
                   "train_trades_per_session_day": best_train["trades_per_day"],
                   "test_session_day_count": int(test_days.size), "test_trades": test["trades"],
                   "test_trades_per_session_day": test["trades_per_day"],
                   "test_net_ticks_per_session_day": float(test["real_daily"].mean()),
                   "test_null_net_ticks_per_session_day": float(test["null_daily"].mean()),
                   "test_excess_ticks_per_session_day": float(test["excess"].mean()),
                   "test_excess_sharpe_per_day": test["sharpe"],
                   "test_target_hit_rate": float((real["reason"] == engine.EXIT_TARGET).mean()) if real["net"].size else math.nan,
                   "test_win_rate": float((real["net"] > 0).mean()) if real["net"].size else math.nan,
                   "test_profit_factor": float(wins / losses) if losses > 0 else math.nan,
                   "test_session_end_exit_share": test["session_end_share"]}
            fold_rows.append(row)
            protocol.emit_log(f"[{name}] test {year}: {row['test_net_ticks_per_session_day']:+.1f} net ticks/day, excess over "
                              f"matched random {row['test_excess_ticks_per_session_day']:+.1f}, {row['test_trades_per_session_day']:.2f} "
                              f"trades/day, target hit {row['test_target_hit_rate']:.3f}, PF {row['test_profit_factor']:.2f}; "
                              f"params {best_trial.params}")
            protocol.emit_fold_complete(fold, {"template": name, "test_year": year,
                                               "net_ticks_per_session_day": row["test_net_ticks_per_session_day"],
                                               "excess_ticks_per_session_day": row["test_excess_ticks_per_session_day"]})
            trades = pd.DataFrame({k: real[k] for k in ("entry", "exit", "side", "entry_price", "exit_price", "risk_ticks",
                                                        "reason", "rolls", "gross", "net", "mfe", "mae", "held_minutes", "net_r")})
            trades["session_date"] = real["day"]
            trades["test_year"] = year
            stitched[name]["trades"].append(trades)
            stitched[name]["real_daily"].append(test["real_daily"])
            stitched[name]["null_daily"].append(test["null_daily"])
            stitched[name]["days"].append(test_days)
            stitched[name]["params"].append(best_trial.params)
            stitched[name].setdefault("tests", []).append(test)

    # ── 3. stitched out-of-sample per template ─────────────────────────────
    trial_variance = float(np.var(trial_sharpes, ddof=1)) if len(trial_sharpes) > 1 else math.nan
    total_trials = len(trial_sharpes)
    summary_rows, daily_frames, trade_frames = [], [], []
    stamps = ctx.minutes.stamps
    for name, s in stitched.items():
        real_daily = np.concatenate(s["real_daily"])
        null_daily = np.concatenate(s["null_daily"])
        days = np.concatenate(s["days"])
        excess = real_daily - null_daily
        trades = pd.concat(s["trades"], ignore_index=True)
        # random-side null on the stitched out-of-sample entries: same bars, sides at the long share
        side_means = []
        for test, params in zip(s["tests"], s["params"]):
            spec = strategy.materialize(templates[name], params)
            exits = strategy.exit_arrays(ctx, spec)
            long_share = float((test["sides"] > 0).mean()) if test["sides"].size else 0.5
            for k in range(int(rc["nulls"]["random_side_replicates"])):
                rng = np.random.default_rng(123_000 + k)
                sides = np.where(rng.random(test["index"].size) < long_share, 1, -1).astype(np.int8)
                r = strategy.run(ctx, spec, test["index"], sides, slippage, cost_ticks, exits)
                side_means.append((k, r["net"].sum()))
        side_totals = pd.DataFrame(side_means, columns=["replicate", "net"]).groupby("replicate")["net"].sum().to_numpy()
        real_total = trades["net"].sum()
        wins, losses = trades["net"][trades["net"] > 0].sum(), -trades["net"][trades["net"] <= 0].sum()
        benchmark = m.expected_maximum_sharpe(trial_variance, total_trials)
        # the stitched series was chosen in-sample; out of sample the only choice is which template to report,
        # so the honest out-of-sample deflation is over the templates of the round with noise variance 1/(T-1)
        template_benchmark = m.expected_maximum_sharpe(1.0 / max(days.size - 1, 1), len(stitched))
        year_of_day = pd.DatetimeIndex(days).year.to_numpy()
        without_2022 = year_of_day != 2022
        top10 = np.argsort(real_daily)[-10:]
        without_top = np.delete(real_daily, top10)
        row = {"round": args.round_number, "template": name, "description": templates[name]["description"],
               "is_two_to_one_bracket": templates[name]["exit"].get("target", {"kind": "r", "value": 2.0}).get("kind") == "r"
               and float(templates[name]["exit"].get("target", {}).get("value", 2.0)) == 2.0,
               "test_session_day_count": int(days.size), "trades": int(len(trades)),
               "trades_per_session_day": len(trades) / days.size,
               "net_ticks_per_session_day": float(real_daily.mean()),
               "matched_null_net_ticks_per_session_day": float(null_daily.mean()),
               "excess_ticks_per_session_day": float(excess.mean()),
               "excess_newey_west_t": m.newey_west_mean_t(excess, 5),
               "folds_with_positive_excess": int(sum(float((rd - nd).mean()) > 0 for rd, nd in zip(s["real_daily"], s["null_daily"]))),
               "fold_count": len(s["real_daily"]),
               "random_side_null_net_ticks_per_session_day": float(side_totals.mean() / days.size) if side_totals.size else math.nan,
               "share_of_random_side_replicates_beaten": float((real_total > side_totals).mean()) if side_totals.size else math.nan,
               "deflated_sharpe_probability_over_distinct_trials": m.deflated_sharpe_probability(excess, benchmark),
               "deflation_distinct_trial_count": total_trials,
               "deflated_sharpe_probability_over_templates": m.deflated_sharpe_probability(excess, template_benchmark),
               "net_ticks_per_session_day_without_2022": float(real_daily[without_2022].mean()) if without_2022.any() else math.nan,
               "excess_ticks_per_session_day_without_2022": float(excess[without_2022].mean()) if without_2022.any() else math.nan,
               "excess_newey_west_t_without_2022": m.newey_west_mean_t(excess[without_2022], 5) if without_2022.sum() > 20 else math.nan,
               "net_ticks_per_session_day_without_top_10_days": float(without_top.mean()) if without_top.size else math.nan,
               "top_10_days_share_of_net": float(real_daily[top10].sum() / real_daily.sum()) if real_daily.sum() > 0 else math.nan,
               "target_hit_rate": float((trades["reason"] == engine.EXIT_TARGET).mean()) if len(trades) else math.nan,
               "win_rate": float((trades["net"] > 0).mean()) if len(trades) else math.nan,
               "profit_factor": float(wins / losses) if losses > 0 else math.nan,
               "average_net_r": float(trades["net_r"].mean()) if len(trades) else math.nan,
               "gap_to_600_ticks_per_session_day": 600 - float(real_daily.mean())}
        for code, label in engine.EXIT_NAMES.items():
            row[f"exit_share_{label}"] = float((trades["reason"] == code).mean()) if len(trades) else math.nan
        row.update(m.eight_numbers(real_daily, "daily_net_ticks"))
        summary_rows.append(row)
        daily_frames.append(pd.DataFrame({"template": name, "session_date": days, "net_ticks": real_daily,
                                          "matched_null_net_ticks": null_daily, "excess_ticks": excess}))
        trades["template"] = name
        trades["entry_timestamp"] = pd.to_datetime(stamps[trades["entry"].to_numpy()], unit="s")
        trades["exit_timestamp"] = pd.to_datetime(stamps[np.minimum(trades["exit"].to_numpy(), stamps.size - 1)], unit="s")
        trades["exit_reason"] = trades["reason"].map(engine.EXIT_NAMES)
        trades["side"] = np.where(trades["side"] > 0, "long", "short")
        trade_frames.append(trades.drop(columns=["entry", "exit", "reason"]).rename(columns={
            "gross": "gross_ticks", "net": "net_ticks", "mfe": "maximum_favourable_excursion_ticks",
            "mae": "maximum_adverse_excursion_ticks", "net_r": "net_r_multiple"}))
        protocol.emit_log(f"[out-of-sample] {name}: {row['net_ticks_per_session_day']:+.1f} net ticks/day (matched random "
                          f"{row['matched_null_net_ticks_per_session_day']:+.1f}), excess {row['excess_ticks_per_session_day']:+.1f} "
                          f"(t {row['excess_newey_west_t']:+.2f}, {row['folds_with_positive_excess']}/{row['fold_count']} years), "
                          f"target hit {row['target_hit_rate']:.3f}, PF {row['profit_factor']:.2f}, deflated "
                          f"{row['deflated_sharpe_probability_of_excess']:.3f}")

    summary = pd.DataFrame(summary_rows)
    # White's Reality Check across the round's templates: could the best template's excess t arise from noise?
    daily_all = pd.concat(daily_frames, ignore_index=True)
    excess_matrix = daily_all.pivot_table(index="session_date", columns="template", values="excess_ticks").dropna()
    reality_check = m.reality_check_p_value(excess_matrix.to_numpy(), block_days=10, repetitions=5000)
    summary["reality_check_p_value_across_templates"] = reality_check
    protocol.emit_log(f"[out-of-sample] White Reality Check across {excess_matrix.shape[1]} templates: p {reality_check:.3f}")
    best = summary.sort_values("excess_ticks_per_session_day", ascending=False).iloc[0]
    round_row = pd.DataFrame([{
        "round": args.round_number, "recipe": recipe, "title": rc["title"], "hypothesis": rc["hypothesis"],
        "round_configuration_json": json.dumps(rc), "templates_json": json.dumps({n: templates[n] for n in names}),
        "distinct_feasible_trials": total_trials, "reality_check_p_value_across_templates": reality_check,
        "best_template_by_excess": best["template"],
        "best_excess_ticks_per_session_day": float(best["excess_ticks_per_session_day"]),
        "best_excess_newey_west_t": float(best["excess_newey_west_t"]),
        "best_net_ticks_per_session_day": float(summary["net_ticks_per_session_day"].max()),
        "level_family_count": int(quality["family"].nunique()),
        "level_families_holding_better_than_chance_net_of_mechanics": int(
            ((quality["year"] == "all") & (quality["lift_net_of_mechanics"] > 0)).sum()),
        "elapsed_seconds": time.monotonic() - started, "finished_at": datetime.now(timezone.utc).isoformat()}])
    zones = ctx.zones.copy()
    zones.insert(0, "bar_timestamp", pd.to_datetime(ctx.bar_end - 60 * strategy.TIMEFRAME_MINUTES[rc["timeframe"]], unit="s"))
    zones["close"] = ctx.bars["close"]
    zones["atr"] = ctx.atr
    level_events = events.assign(known_from_timestamp=pd.to_datetime(events["known_from"], unit="s"),
                                 valid_until_timestamp=pd.to_datetime(events["valid_until"], unit="s"))
    tables = {"rounds": round_row, "templates": summary, "folds": pd.DataFrame(fold_rows), "trials": pd.DataFrame(trial_rows),
              "daily": pd.concat(daily_frames, ignore_index=True), "trades": pd.concat(trade_frames, ignore_index=True),
              "level_quality": quality, "level_events": level_events, "zones_15m": zones,
              "level_tests": tests.drop(columns=["test_minute"]).assign(test_timestamp=pd.to_datetime(
                  np.where(tests["test_minute"] >= 0, stamps[np.clip(tests["test_minute"], 0, None)], 0), unit="s"))}
    tables = {k: v.assign(round=args.round_number) if "round" not in v.columns else v for k, v in tables.items()}
    directory = os.path.join(args.output_dir, f"MNQ_ta_conditional_{recipe}")
    paths = store.write_local(tables, directory)
    landing = None
    if not args.no_land:
        landing = store.land(paths, recipe, f"TA conditional strategies round {args.round_number}", dataset=DATASET)
        for n, info in landing.items():
            protocol.emit_log(f"[save] {n}: {info['rows']:,} rows -> {info['uri']} (manifest {info['manifest']})")
    protocol.emit_done(directory, {"recipe": recipe, "lake": landing})
    return {"recipe": recipe}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--round", dest="round_number", type=int, default=1)
    parser.add_argument("--rounds-file", default=str(ROUNDS_PATH))
    parser.add_argument("--templates-file", default=str(TEMPLATES_PATH))
    parser.add_argument("--templates", default="", help="comma list overriding the round's templates (tests)")
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
