"""Search conditional TA-Lib strategies with bracket exits against a 40% target-hit rate at 2:1.

    .venv/Scripts/python.exe src/ml/ta_strategy/rule_search.py --round 2 --json

Round 1 ran on commit 8e1e93d (stitched bars, coarse-bar stop-first, filter-blind random
baseline); its record is recipe ``round_1_20260929T014217``. From round 2 on, what the
round-1 review found is built in:

- **Bars:** 1-minute bars rebuilt one contract per session (``data.load_minutes_rebuilt``),
  with 27 clean rolls instead of 4,833 intra-session flips. Coarser bars are aggregated
  from them.
- **Fills on the minute path:** a strategy's signals are decided on its own timeframe and
  placed on the last minute of each bar, and ``bracket.simulate`` runs on the minutes. A
  coarse bar that touched both levels is resolved by its minutes. Stops, flattens and
  data-end exits pay ``stop_slippage_ticks``.
- **No entries late in the session:** no entries in the last ``no_entry_minutes_before_session_end``.
- **A real 2:1 test:** the target test counts trades that HIT the target, not trades that
  closed positive at the session end. The session-end exit share is capped.
- **Two nulls per strategy:**
  - ``matched``: random entries on the bars its gate allows, with the same count per hour
    of day and the same long share;
  - ``random_side``: its own signal bars with a coin-flipped side.
- **Significance:** lift over those nulls with standard errors clustered by session day,
  the null matched in each calendar year (a pass needs 5 of 7 years positive), a
  best-of-grid bar from the random-side replicate grids, and Benjamini-Hochberg across
  deduplicated strategies.
- **Sizing:** 600 ticks/day is reported as a question of contract count.
"""

from __future__ import annotations

import argparse
import hashlib
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
TIMEFRAME_MINUTES = {"5m": 5, "15m": 15, "30m": 30, "1h": 60}


# ── per-trade arithmetic ────────────────────────────────────────────────────
def clustered_standard_error(values: np.ndarray, clusters: np.ndarray) -> float:
    """Standard error of the mean of ``values`` with errors clustered by session day."""
    n = values.size
    if n < 2:
        return math.nan
    residual = pd.Series(values - values.mean()).groupby(clusters).sum().to_numpy()
    return float(math.sqrt((residual**2).sum()) / n)


def summarise(trades: dict, mask: np.ndarray, day_count: int, prefix: str) -> dict:
    net, gross, reason = trades["net"][mask], trades["gross"][mask], trades["reason"][mask]
    n = int(net.size)
    out = {f"{prefix}_trade_count": n, f"{prefix}_session_day_count": day_count,
           f"{prefix}_trades_per_session_day": n / day_count if day_count else math.nan}
    if n == 0:
        return out
    wins, losses = net[net > 0], net[net <= 0]
    loss_sum = -losses.sum()
    cumulative = np.cumsum(net)
    out.update({
        f"{prefix}_target_hit_rate": float((reason == 1).mean()),
        f"{prefix}_stop_hit_rate": float((reason == 0).mean()),
        f"{prefix}_session_end_exit_rate": float((reason == 2).mean()),
        f"{prefix}_win_rate_including_session_end": float((net > 0).mean()),
        f"{prefix}_profit_factor": float(wins.sum() / loss_sum) if loss_sum > 0 else math.nan,
        f"{prefix}_net_ticks_per_trade": float(net.mean()),
        f"{prefix}_gross_ticks_per_trade": float(gross.mean()),
        f"{prefix}_net_ticks_per_session_day": float(net.sum() / day_count) if day_count else math.nan,
        f"{prefix}_average_win_ticks": float(wins.mean()) if wins.size else math.nan,
        f"{prefix}_average_loss_ticks": float(losses.mean()) if losses.size else math.nan,
        f"{prefix}_payoff_ratio": float(wins.mean() / -losses.mean()) if wins.size and losses.size and losses.mean() < 0 else math.nan,
        f"{prefix}_long_share_of_trades": float((trades["side"][mask] > 0).mean()),
        f"{prefix}_maximum_drawdown_ticks": float((cumulative - np.maximum.accumulate(np.r_[0.0, cumulative])[1:]).min()),
    })
    return out


def run(args: argparse.Namespace) -> dict:
    import talib
    from scipy import stats

    from cycle.simulate import load_cost_model
    from shared.data import _serving
    from ta_strategy import bracket, rules, store
    from ta_strategy.data import (
        aggregate,
        effective_roll_timestamps,
        load_minutes_rebuilt,
        session_dates,
    )

    started = time.monotonic()
    config = json.loads(Path(args.rounds_file).read_text(encoding="utf-8"))
    rc = config["rounds"][str(args.round_number)]
    symbol = rc.get("symbol", config["symbol"])
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
    recipe = f"round_{args.round_number}_{stamp}"
    # a confirmation round may trade another root's prices at MNQ's cost in ticks (NQ has MNQ's
    # 0.25 tick, so its moves in ticks are MNQ's moves; only the dollar size per tick differs)
    cost = load_cost_model(rc.get("cost_symbol", symbol))
    tick = cost.tick_size
    cost_ticks = cost.round_trip / cost.tick_value
    slippage = float(rc.get("stop_slippage_ticks", 0.0))
    targets = rc["targets"]
    split = np.datetime64(pd.Timestamp(rc["in_sample_end"]))
    matched_seeds = int(rc["nulls"]["matched_seeds"])
    side_replicates = int(rc["nulls"]["random_side_replicates"])

    # ── the minute path every strategy trades on ───────────────────────────
    connection = _serving()
    connection.execute("SET TimeZone='UTC'")
    minutes = load_minutes_rebuilt(connection, symbol, rc["data_start"], rc["data_end"])
    mf = minutes.frame
    m_open, m_high, m_low, m_close = (mf[k].to_numpy(np.float64) for k in ("open", "high", "low", "close"))
    m_stamps = mf["timestamp"].to_numpy(np.int64)
    m_days = session_dates(m_stamps)
    m_session_last = np.r_[m_days[1:] != m_days[:-1], True]
    m_roll_after = np.zeros(m_stamps.size, dtype=np.bool_)
    for r in effective_roll_timestamps(minutes.rolls):
        k = int(np.searchsorted(m_stamps, r))
        if 0 < k < m_stamps.size:
            m_roll_after[k] = True
    all_days = np.unique(m_days)
    years = pd.DatetimeIndex(all_days).year.to_numpy()
    day_count = {"in_sample": int((all_days < split).sum()), "out_of_sample": int((all_days >= split).sum()),
                 "all_years": int(all_days.size)}
    year_days = {int(y): int((years == y).sum()) for y in np.unique(years)}
    protocol.emit_log(f"[data] {symbol} 1m rebuilt one contract per session: {len(mf):,} minutes, {len(minutes.rolls)} rolls, "
                      f"{day_count['in_sample']} in-sample + {day_count['out_of_sample']} out-of-sample session days")

    timeframes: dict[str, dict] = {}

    def timeframe(tf: str) -> dict:
        if tf in timeframes:
            return timeframes[tf]
        width = TIMEFRAME_MINUTES[tf]
        frame, _ = aggregate(mf, width)
        b = rules.bars_dict(frame)
        stamps = frame["timestamp"].to_numpy(np.int64)
        moments = pd.to_datetime(stamps, unit="s")
        start_minute = (moments.hour * 60 + moments.minute).to_numpy()
        end_minute = start_minute + width
        late = np.int64(rc.get("no_entry_minutes_before_session_end", 0))
        # ">=": a 1h bar ending at 13:00 is inside the last 60 minutes (round 2 let 1,044 1h entries through at 13:00)
        blocked = (end_minute >= 14 * 60 - late) & (end_minute <= 14 * 60) if late else np.zeros(stamps.size, dtype=bool)
        # the last COMPLETED 1h bar's EMA50 vs EMA200, for the higher-timeframe side gate
        hour_frame, _ = aggregate(mf, 60)
        hour_ends = hour_frame["timestamp"].to_numpy(np.int64) + 3600
        ema50, ema200 = talib.EMA(hour_frame["close"].to_numpy(float), 50), talib.EMA(hour_frame["close"].to_numpy(float), 200)
        hour_side = np.where(ema50 > ema200, 1, np.where(ema50 < ema200, -1, 0))
        last_done = np.searchsorted(hour_ends, stamps + width * 60, side="right") - 1
        htf_side = np.where(last_done >= 0, hour_side[np.clip(last_done, 0, None)], 0)
        ctx = rules.GateContext(b, start_minute, width, htf_side)
        timeframes[tf] = {"bars": b, "last_minute": frame["last_minute_index"].to_numpy(np.int64), "start_minute": start_minute,
                          "blocked": blocked, "atr": talib.ATR(b["high"], b["low"], b["close"], 14), "ctx": ctx,
                          "hour": start_minute // 60}
        return timeframes[tf]

    def simulate(tf: str, signal: np.ndarray, stop_multiple: float, reward: float) -> dict:
        t = timeframe(tf)
        stops = np.round(stop_multiple * t["atr"] / tick)
        stops = np.where(np.isfinite(stops), np.maximum(stops, 4), np.nan)
        m_signal = np.zeros(m_stamps.size, dtype=np.int8)
        m_stop = np.full(m_stamps.size, np.nan)
        live = signal != 0
        m_signal[t["last_minute"][live]] = signal[live]
        m_stop[t["last_minute"][live]] = stops[live]
        e_i, x_i, side, e_p, x_p, stop_t, reason, rolls = bracket.simulate(
            m_open, m_high, m_low, m_close, m_signal, m_stop, m_session_last, m_roll_after, tick, reward, slippage)
        gross = side * (x_p - e_p) / tick
        net = gross - cost_ticks * (1 + rolls)
        return {"entry": e_i, "exit": x_i, "side": side, "entry_price": e_p, "exit_price": x_p, "stop": stop_t,
                "reason": reason, "rolls": rolls, "gross": gross, "net": net, "day": m_days[e_i],
                "year": pd.DatetimeIndex(m_days[e_i]).year.to_numpy()}

    def period_masks(trades: dict) -> dict:
        return {"in_sample": trades["day"] < split, "out_of_sample": trades["day"] >= split,
                "all_years": np.ones(trades["day"].size, dtype=bool)}

    # ── the grid ────────────────────────────────────────────────────────────
    strategies = []
    for block in rc["blocks"]:
        if "union_of" in block:
            members = [rules.make_rule(f, **p) for f, grid in block["union_of"].items() for p in grid]
            triggers = [("union_" + block["name"], members)]
        else:
            triggers = [(r.rule_id, r) for r in (rules.make_rule(f, **p) for f, grid in block["rules"].items() for p in grid)]
        for trigger_id, trigger in triggers:
            for gate in block["gates"]:
                for k, stop in enumerate(block["stops"]):
                    for reward in block["reward_multiples"]:
                        strategies.append({"block": block["name"], "timeframe": block["timeframe"], "trigger_id": trigger_id,
                                           "trigger": trigger, "gate": gate, "stop_multiple": float(stop), "stop_position": k,
                                           "stop_list": [float(s) for s in block["stops"]], "reward_multiple": float(reward)})
    protocol.emit_config({"study": {"round": args.round_number, "title": rc["title"], "recipe": recipe, "hypothesis": rc["hypothesis"]},
                          "grid": {"strategies": len(strategies), "blocks": [b["name"] for b in rc["blocks"]]},
                          "costs": {"round_trip_ticks": cost_ticks, "stop_slippage_ticks": slippage},
                          "nulls": rc["nulls"], "targets": targets}, scope="run", label=recipe)
    protocol.emit_log(f"[plan] {len(strategies)} strategies; each against {matched_seeds} matched-random and "
                      f"{side_replicates} random-side replicates; cost {cost_ticks:.2f} ticks + {slippage:g} tick stop slippage")

    signal_cache: dict = {}
    rows, yearly_rows, trade_frames, daily_frames, side_null_z = [], [], [], [], []
    for n, s in enumerate(strategies):
        tf = timeframe(s["timeframe"])
        key = (s["timeframe"], s["trigger_id"])
        if key not in signal_cache:
            trig = s["trigger"]
            signal_cache[key] = rules.union([r.signal(tf["bars"]) for r in trig]) if isinstance(trig, list) else trig.signal(tf["bars"])
        signal = rules.apply_gate(signal_cache[key], s["gate"], tf["ctx"])
        signal[tf["blocked"]] = 0
        signal[~np.isfinite(tf["atr"])] = 0
        real = simulate(s["timeframe"], signal, s["stop_multiple"], s["reward_multiple"])
        masks = period_masks(real)
        strategy_id = f"{s['timeframe']}_{s['trigger_id']}_{s['gate']}_atr{s['stop_multiple']:g}_reward{s['reward_multiple']:g}"
        row = {"round": args.round_number, "strategy_id": strategy_id, "block": s["block"], "timeframe": s["timeframe"],
               "trigger_id": s["trigger_id"], "gate": s["gate"], "stop_atr_multiple": s["stop_multiple"],
               "reward_multiple": s["reward_multiple"], "signal_count": int((signal != 0).sum())}
        for period, mask in masks.items():
            row.update(summarise(real, mask, day_count[period], period))

        # matched random: the gate's bars, the strategy's signal count per hour, its long share
        allowed = rules.gate_mask(s["gate"], tf["ctx"]) & ~tf["blocked"] & np.isfinite(tf["atr"])
        fired = np.flatnonzero(signal != 0)
        long_share = float((signal[fired] > 0).mean()) if fired.size else 0.5
        per_hour = pd.Series(tf["hour"][fired]).value_counts()
        matched_runs, side_runs = [], []
        for seed in range(matched_seeds):
            rng = np.random.default_rng(10_000 * n + seed)
            null_signal = np.zeros(signal.shape, dtype=np.int8)
            for hour, count in per_hour.items():
                pool = np.flatnonzero(allowed & (tf["hour"] == hour))
                if pool.size:
                    pick = rng.choice(pool, size=min(int(count), pool.size), replace=False)
                    null_signal[pick] = np.where(rng.random(pick.size) < long_share, 1, -1)
            matched_runs.append(simulate(s["timeframe"], null_signal, s["stop_multiple"], s["reward_multiple"]))
        for replicate in range(side_replicates):
            rng = np.random.default_rng(99_000 + 1_000 * n + replicate)
            flipped = np.zeros(signal.shape, dtype=np.int8)
            # sides drawn at the strategy's own long share: a 50/50 coin would hand any long-leaning
            # rule the market's upward drift as "edge" (the smoke run confirmed 9 of 12 that way)
            flipped[fired] = np.where(rng.random(fired.size) < long_share, 1, -1)
            side_runs.append(simulate(s["timeframe"], flipped, s["stop_multiple"], s["reward_multiple"]))

        def null_mean(runs, key, mask_name, year=None):
            values = []
            for r in runs:
                m = period_masks(r)[mask_name] if year is None else (r["year"] == year)
                if m.any():
                    values.append((r["reason"][m] == 1).mean() if key == "target" else r[key][m].mean())
            return float(np.mean(values)) if values else math.nan

        for period in ("in_sample", "out_of_sample", "all_years"):
            row[f"{period}_matched_null_target_hit_rate"] = null_mean(matched_runs, "target", period)
            row[f"{period}_matched_null_net_ticks_per_trade"] = null_mean(matched_runs, "net", period)
            row[f"{period}_random_side_null_net_ticks_per_trade"] = null_mean(side_runs, "net", period)
            row[f"{period}_target_hit_lift_over_matched_null"] = row.get(f"{period}_target_hit_rate", math.nan) - row[f"{period}_matched_null_target_hit_rate"]
            row[f"{period}_net_per_trade_lift_over_matched_null"] = row.get(f"{period}_net_ticks_per_trade", math.nan) - row[f"{period}_matched_null_net_ticks_per_trade"]
        se = clustered_standard_error(real["net"], real["day"]) if real["net"].size > 1 else math.nan
        row["net_per_trade_clustered_standard_error"] = se
        row["z_over_matched_null"] = (row.get("all_years_net_ticks_per_trade", math.nan) - row["all_years_matched_null_net_ticks_per_trade"]) / se if se and se > 0 else math.nan
        row["z_over_random_side_null"] = (row.get("all_years_net_ticks_per_trade", math.nan) - row["all_years_random_side_null_net_ticks_per_trade"]) / se if se and se > 0 else math.nan
        # each random-side replicate scored like a strategy against the others: the best-of-grid null
        replicate_z = []
        for k, r in enumerate(side_runs):
            others = [o["net"].mean() for j, o in enumerate(side_runs) if j != k and o["net"].size]
            if r["net"].size > 1 and others:
                rse = clustered_standard_error(r["net"], r["day"])
                replicate_z.append((r["net"].mean() - np.mean(others)) / rse if rse > 0 else math.nan)
            else:
                replicate_z.append(math.nan)
        side_null_z.append(replicate_z)
        positive_years = 0
        for year in sorted(year_days):
            ym = real["year"] == year
            yr = {"round": args.round_number, "strategy_id": strategy_id, "year": int(year), "session_day_count": year_days[year],
                  "trade_count": int(ym.sum()),
                  "target_hit_rate": float((real["reason"][ym] == 1).mean()) if ym.any() else math.nan,
                  "net_ticks_per_trade": float(real["net"][ym].mean()) if ym.any() else math.nan,
                  "net_ticks_per_session_day": float(real["net"][ym].sum() / year_days[year]),
                  "matched_null_net_ticks_per_trade": null_mean(matched_runs, "net", None, year),
                  "matched_null_target_hit_rate": null_mean(matched_runs, "target", None, year)}
            yr["net_per_trade_lift_over_matched_null"] = yr["net_ticks_per_trade"] - yr["matched_null_net_ticks_per_trade"]
            positive_years += int(ym.sum() >= 10 and yr["net_per_trade_lift_over_matched_null"] > 0)
            yearly_rows.append(yr)
        row["years_with_positive_lift"] = positive_years
        row["median_stop_ticks"] = float(np.median(real["stop"])) if real["stop"].size else math.nan
        row["trade_fingerprint"] = hashlib.sha1(np.r_[real["entry"], real["side"], real["stop"]].tobytes()).hexdigest()[:16]
        row["_stop_list"], row["_stop_position"] = s["stop_list"], s["stop_position"]
        rows.append(row)
        trade_frames.append(pd.DataFrame({
            "strategy_id": strategy_id, "entry_timestamp": pd.to_datetime(m_stamps[real["entry"]], unit="s"),
            "exit_timestamp": pd.to_datetime(m_stamps[real["exit"]], unit="s"), "session_date": real["day"],
            "side": np.where(real["side"] > 0, "long", "short"), "entry_price": real["entry_price"], "exit_price": real["exit_price"],
            "stop_distance_ticks": real["stop"], "exit_reason": [bracket.EXIT_NAMES[int(x)] for x in real["reason"]],
            "rolls_crossed": real["rolls"], "gross_ticks": real["gross"], "net_ticks": real["net"],
            "period": np.where(real["day"] < split, "in_sample", "out_of_sample")}))
        per_day = pd.Series(real["net"]).groupby(real["day"]).sum().reindex(pd.Index(all_days), fill_value=0.0)
        daily_frames.append(pd.DataFrame({"strategy_id": strategy_id, "session_date": all_days, "net_ticks": per_day.to_numpy(),
                                          "period": np.where(all_days < split, "in_sample", "out_of_sample")}))
        protocol.emit_progress(n + 1, len(strategies), "simulating")
        if (n + 1) % 25 == 0:
            protocol.emit_log(f"[grid] {n + 1}/{len(strategies)} strategies simulated with their nulls")

    table = pd.DataFrame(rows)
    # best-of-grid bar: the 95th percentile, over replicate grids, of the grid's best random-side z
    z_matrix = np.array(side_null_z, dtype=float)                   # strategies x replicates
    grid_best = np.nanmax(z_matrix, axis=0)
    best_of_grid_bar = float(np.nanpercentile(grid_best, 95))
    table["beats_best_of_grid_null"] = table["z_over_random_side_null"] > best_of_grid_bar
    # Benjamini-Hochberg across deduplicated strategies (identical trade lists counted once)
    unique = table.drop_duplicates("trade_fingerprint")
    p = pd.Series(1 - stats.norm.cdf(unique["z_over_random_side_null"].fillna(-np.inf)), index=unique["trade_fingerprint"])
    order = p.sort_values()
    m_tests = len(order)
    thresholds = 0.05 * np.arange(1, m_tests + 1) / m_tests
    passed = order.to_numpy() <= thresholds
    cutoff = order.to_numpy()[np.flatnonzero(passed).max()] if passed.any() else -1.0
    table["benjamini_hochberg_significant"] = table["trade_fingerprint"].map(p <= cutoff).fillna(False)
    # plateau: the neighbouring stop sizes of the same trigger, gate and reward also beat the random-side null
    records = table.to_dict("records")
    z_by = {(r["trigger_id"], r["gate"], r["reward_multiple"], r["timeframe"], r["stop_atr_multiple"]): r["z_over_random_side_null"]
            for r in records}
    plateau = []
    for r in records:
        stop_list, position = r["_stop_list"], r["_stop_position"]
        neighbours = [stop_list[k] for k in (position - 1, position + 1) if 0 <= k < len(stop_list)]
        plateau.append(all(z_by.get((r["trigger_id"], r["gate"], r["reward_multiple"], r["timeframe"], v), -1) > 0 for v in neighbours))
    table["neighbouring_stops_also_beat_null"] = plateau
    table = table.drop(columns=["_stop_list", "_stop_position"])

    def strict(prefix: str, minimum: int) -> pd.Series:
        return ((table[f"{prefix}_trade_count"] >= minimum) & (table.get(f"{prefix}_target_hit_rate", 0) >= targets["target_hit_rate_minimum"])
                & (table.get(f"{prefix}_profit_factor", 0) >= targets["profit_factor_minimum"])
                & (table.get(f"{prefix}_session_end_exit_rate", 1) <= targets["session_end_exit_rate_maximum"]))

    table["meets_strict_2_to_1_all_years"] = (table["reward_multiple"] == 2.0) & strict("all_years", targets["minimum_trades"])
    table["meets_strict_2_to_1_in_both_periods"] = table["meets_strict_2_to_1_all_years"] & strict("in_sample", 30) & strict("out_of_sample", 30)
    table["edge_confirmed"] = (table["beats_best_of_grid_null"] & table["benjamini_hochberg_significant"]
                               & (table["years_with_positive_lift"] >= targets["minimum_positive_years"])
                               & table["neighbouring_stops_also_beat_null"])
    table["passes_round"] = table["meets_strict_2_to_1_in_both_periods"] & table["edge_confirmed"]
    if rc.get("pre_registered"):
        # One pre-registered test per frozen strategy (docs/ta-strategy-600-ticks.md, rule round 3):
        #   1. target-hit lift over the matched null, one-sided, Holm-corrected across the frozen set;
        #   2. the 95% Wilson lower bound of the target-hit rate at or above the rate at which a 2:1 bracket
        #      reaches profit factor 1.333 after costs and slippage, at the strategy's median stop S:
        #      p* = 1.333 (S + slippage + c) / ((R S - c) + 1.333 (S + slippage + c)).
        pf = targets["profit_factor_minimum"]
        n_trades = table["all_years_trade_count"].astype(float)
        hit = table["all_years_target_hit_rate"].astype(float)
        z95 = 1.959963984540054
        centre = (hit + z95**2 / (2 * n_trades)) / (1 + z95**2 / n_trades)
        half = z95 * np.sqrt(hit * (1 - hit) / n_trades + z95**2 / (4 * n_trades**2)) / (1 + z95**2 / n_trades)
        table["target_hit_rate_wilson_lower_95"] = centre - half
        stop = table["median_stop_ticks"]
        loss = stop + slippage + cost_ticks
        table["target_hit_rate_needed_for_profit_factor"] = pf * loss / ((table["reward_multiple"] * stop - cost_ticks) + pf * loss)
        p_values = pd.Series(1 - stats.norm.cdf(table["z_over_matched_null"].fillna(-np.inf)), index=table.index).sort_values()
        holm = pd.Series(False, index=table.index)
        for rank, (index, value) in enumerate(p_values.items()):
            if value <= 0.05 / (len(p_values) - rank):
                holm[index] = True
            else:
                break
        table["holm_significant_lift_over_matched_null"] = holm
        table["confirmed_out_of_sample"] = holm & (table["target_hit_rate_wilson_lower_95"] >= table["target_hit_rate_needed_for_profit_factor"])
    per_day = table["all_years_net_ticks_per_session_day"]
    table["contracts_for_600_ticks_per_day"] = np.where(per_day > 0, np.ceil(targets["ticks_per_session_day_goal"] / per_day), np.nan)
    table["maximum_drawdown_usd_at_that_size"] = table["all_years_maximum_drawdown_ticks"] * cost.tick_value * table["contracts_for_600_ticks_per_day"]

    summary = {
        "round": args.round_number, "recipe": recipe, "title": rc["title"], "hypothesis": rc["hypothesis"],
        "round_configuration_json": json.dumps(rc), "strategy_count": len(table),
        "distinct_trade_lists": int(table["trade_fingerprint"].nunique()),
        "meeting_strict_2_to_1_all_years": int(table["meets_strict_2_to_1_all_years"].sum()),
        "meeting_strict_2_to_1_in_both_periods": int(table["meets_strict_2_to_1_in_both_periods"].sum()),
        "beating_best_of_grid_null": int(table["beats_best_of_grid_null"].sum()), "best_of_grid_z_bar": best_of_grid_bar,
        "benjamini_hochberg_significant": int(table["benjamini_hochberg_significant"].sum()),
        "edge_confirmed": int(table["edge_confirmed"].sum()), "passing_round": int(table["passes_round"].sum()),
        "highest_target_hit_rate_all_years": float(table.loc[table["all_years_trade_count"] >= targets["minimum_trades"], "all_years_target_hit_rate"].max()),
        "best_net_ticks_per_session_day_all_years": float(per_day.max()),
        "best_strategy_by_net_ticks_per_session_day": table.loc[per_day.idxmax(), "strategy_id"],
        "confirmed_out_of_sample": int(table["confirmed_out_of_sample"].sum()) if "confirmed_out_of_sample" in table else None,
        "symbol": symbol, "cost_symbol": rc.get("cost_symbol", symbol),
        "cost_ticks_per_round_trip": cost_ticks, "stop_slippage_ticks": slippage,
        "elapsed_seconds": time.monotonic() - started, "finished_at": datetime.now(timezone.utc).isoformat(),
    }
    protocol.emit_log(
        f"[result] strict 2:1 (target hit >= 40%, PF >= 1.333, session-end <= 25%): {summary['meeting_strict_2_to_1_all_years']} all years, "
        f"{summary['meeting_strict_2_to_1_in_both_periods']} in both periods; edge confirmed {summary['edge_confirmed']}; "
        f"beat the best-of-grid bar z > {best_of_grid_bar:.2f}: {summary['beating_best_of_grid_null']}; highest target-hit "
        f"{summary['highest_target_hit_rate_all_years']:.3f}; best net {summary['best_net_ticks_per_session_day_all_years']:+.1f} ticks/day "
        f"({summary['best_strategy_by_net_ticks_per_session_day']})"
        + (f"; pre-registered confirmation: {summary['confirmed_out_of_sample']} of {len(table)} confirmed" if rc.get("pre_registered") else ""))
    tables = {"rounds": pd.DataFrame([summary]), "strategies": table, "yearly": pd.DataFrame(yearly_rows),
              "trades": pd.concat(trade_frames, ignore_index=True), "daily": pd.concat(daily_frames, ignore_index=True)}
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
    parser.add_argument("--round", dest="round_number", type=int, default=2)
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
