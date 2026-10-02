"""The zone-touch study: what happens at the first touch of every multi-timeframe support/resistance zone.
Lands ``zone_touches`` (one row per touch), ``zone_summary`` (bounce and next-zone-reach rates with paired
lifts over matched random levels / pairs, break-even hit rate, favourable excursion, oracle ceiling, by
condition; Benjamini-Hochberg over the cells) and ``zone_leak_check`` (the deliberately leaky arm).

    .venv/Scripts/python.exe packages/ml-engine/src/ta_strategy/zone_study.py --symbol MNQ --start 2019-06-01 --end 2026-01-01 --recipe <stem> --json
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
    from ta_strategy import cascade, levels, store, strategy, zones
    from ta_strategy.data import load_minutes_rebuilt

    started = time.monotonic()
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
    recipe = f"{args.recipe or 'zones_' + stamp}_{args.symbol}"
    cost = load_cost_model("MNQ" if args.symbol in ("NQ", "MNQ") else args.symbol)
    cost_ticks = cost.round_trip / cost.tick_value
    connection = _serving()
    connection.execute("SET TimeZone='UTC'")
    minutes = load_minutes_rebuilt(connection, args.symbol, args.start, args.end)
    frame = minutes.frame
    protocol.emit_log(f"[data] {args.symbol} {args.start}..{args.end}: {len(frame):,} minutes, {len(minutes.rolls)} rolls")
    events = pd.concat([levels.all_level_events(frame), cascade.level_events(frame)], ignore_index=True).sort_values(
        "known_from", kind="stable").reset_index(drop=True)
    ctx = strategy.build_context(minutes, args.timeframe, cost.tick_size, events=events)
    t = zones.touches(ctx, horizon_minutes=int(args.horizon))
    null = zones.matched_null(ctx, t, permutations=int(args.permutations))
    t = pd.concat([t, null], axis=1)
    days = np.unique(ctx.minutes.days)
    honest = t[t["resolved"] & ~t["gapped_through"]]
    protocol.emit_log(f"[{args.symbol} touches] {len(t):,} first touches ({len(t) / days.size:.1f} a day), {t['resolved'].mean():.0%} resolved, "
                      f"{t['gapped_through'].mean():.1%} gapped through; bounce rate {honest['bounced'].mean():.3f} vs matched random "
                      f"{np.nanmean(honest['null_bounce_rate']):.3f}; next zone reached first {np.nanmean(honest['reached_next_zone']):.3f} "
                      f"vs matched random pair {np.nanmean(honest['null_next_zone_reach_rate']):.3f}")
    # the deliberately leaky control: zones of bar b applied to bar b's own minutes must bounce MORE
    leaky = zones.touches(ctx, horizon_minutes=int(args.horizon), leak=True)
    leaky_honest = leaky[leaky["resolved"] & ~leaky["gapped_through"]]
    leak_check = pd.DataFrame([{"arm": "honest", "touches": len(t), "bounce_rate": float(honest["bounced"].mean())},
                               {"arm": "leaky", "touches": len(leaky), "bounce_rate": float(leaky_honest["bounced"].mean())}])
    separation = leak_check["bounce_rate"].iloc[1] - leak_check["bounce_rate"].iloc[0]
    protocol.emit_log(f"[{args.symbol} leak check] honest bounce {leak_check['bounce_rate'].iloc[0]:.3f} vs leaky {leak_check['bounce_rate'].iloc[1]:.3f} "
                      f"(separation {separation:+.3f}; the leaky arm must be higher: {'ok' if separation > 0 else 'FAILED'})")
    s = zones.summary(t, ctx.minutes.days, bootstrap=int(args.bootstrap), cost_ticks=cost_ticks)
    for r in s[s["condition"].isin(["all", "strength_bucket", "session_part", "side_name"])].itertuples():
        protocol.emit_log(f"[{args.symbol} {r.condition}={r.value}] {r.touches:,} touches in {r.sessions:,} sessions, bounce {r.bounce_rate:.3f} "
                          f"[{r.bounce_wilson_low:.3f}, {r.bounce_wilson_high:.3f}], lift over matched random {r.lift_over_matched_random:+.3f} "
                          f"[{r.lift_bootstrap_low:+.3f}, {r.lift_bootstrap_high:+.3f}] p {r.lift_bootstrap_p:.2f}; next zone reached "
                          f"{r.next_zone_reach_rate:.3f} vs {r.null_next_zone_reach_rate:.3f} (lift {r.reach_lift_over_matched_random:+.3f}); "
                          f"break-even {r.break_even_hit_rate_zone_to_zone_median:.3f}; favourable median {r.favourable_ticks_median:.0f} ticks; "
                          f"oracle {r.oracle_zone_to_zone_ticks_per_session_day:.0f} ticks/day (one position {r.oracle_one_position_ticks_per_session_day:.0f} on "
                          f"{r.oracle_one_position_touches_per_session_day:.1f} touches/day)")
    trend = s[s["condition"] == "strength_trend"]
    if len(trend):
        protocol.emit_log(f"[{args.symbol} strength trend] Spearman rho {trend['lift_over_matched_random'].iloc[0]:+.2f}, p {trend['lift_bootstrap_p'].iloc[0]:.2f}")
    protocol.emit_log(f"[{args.symbol} multiple comparisons] {int(s['cells_tested'].iloc[0])} cells; "
                      f"{int(s['survives_benjamini_hochberg_q10'].sum())} bounce lifts and {int(s['reach_survives_benjamini_hochberg_q10'].sum())} "
                      f"reach lifts survive Benjamini-Hochberg at q = 0.10")
    touches_out = t.drop(columns=["families"]).assign(families=t["families"].astype(str))
    tables = {"zone_touches": touches_out, "zone_summary": s, "zone_leak_check": leak_check}
    tables = {k: v.assign(symbol=args.symbol, recipe=recipe, timeframe=args.timeframe) for k, v in tables.items()}
    directory = os.path.join(args.output_dir, f"ta_zones_{recipe}")
    paths = store.write_local(tables, directory)
    landing = None
    if not args.no_land:
        landing = store.land(paths, recipe, f"TA zone-touch study {args.symbol}", dataset=DATASET)
        for name, info in landing.items():
            protocol.emit_log(f"[save] {name}: {info['rows']:,} rows -> {info['uri']} (manifest {info['manifest']})")
    protocol.emit_done(directory, {"recipe": recipe, "lake": landing, "seconds": time.monotonic() - started})
    return {"recipe": recipe}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--symbol", required=True)
    parser.add_argument("--start", required=True)
    parser.add_argument("--end", required=True)
    parser.add_argument("--timeframe", default="5m")
    parser.add_argument("--horizon", default=240)
    parser.add_argument("--permutations", default=10)
    parser.add_argument("--bootstrap", default=1000)
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
