"""Run one round of the TA-indicator strategy study and land it in the lake.

    .venv/Scripts/python.exe packages/ml-engine/src/ta_strategy/main.py --round 1 --model-id <id> --json

Started from the dashboard through the ``ta_indicator_battery+ticks_per_day_goal``
runner (``/api/training/start``); ``--symbol`` / ``--timeframe`` / ``--max-bars``
/ ``--date-*`` from the runner are accepted and ignored, because a round's grid
(``packages/config/ta_strategy_rounds.json``) names its own timeframes and window.
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

ROUNDS_PATH = ROOT / "src" / "config" / "ta_strategy_rounds.json"


def rule_slug(rule) -> str:
    parts = [f"gate{round(rule.gate_fraction * 100):d}"]
    if rule.gate_centre == "fit_mean":
        parts.append("centred")
    if rule.extra_slippage_ticks_per_side:
        parts.append(f"slippage{rule.extra_slippage_ticks_per_side:g}")
    if rule.session_filter != "all":
        parts.append("rth")
    if rule.stop_loss_ticks or rule.take_profit_ticks:
        parts.append(f"stop{rule.stop_loss_ticks:g}_target{rule.take_profit_ticks:g}")
    if rule.long_only:
        parts.append("longonly")
    return "_".join(parts)


def parse(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--round", dest="round_number", type=int, default=1)
    parser.add_argument("--model-id", default=None)
    parser.add_argument("--output-dir", default=str(ROOT / "data" / "models"))
    parser.add_argument("--no-land", action="store_true", help="write local parquet only")
    parser.add_argument("--rounds-file", default=str(ROUNDS_PATH), help="the rounds definition (tests pass a small one)")
    parser.add_argument("--json", action="store_true")
    for ignored in ("--symbol", "--timeframe", "--max-bars", "--date-start", "--date-end"):
        parser.add_argument(ignored, default=None)
    return parser.parse_args(argv)


def run(args: argparse.Namespace) -> dict:
    from cycle.simulate import load_cost_model
    from shared.data import _serving
    from ta_strategy import evaluate, features, oracle, store
    from ta_strategy.data import load_bars, roll_table

    started = time.monotonic()
    config = json.loads(Path(args.rounds_file).read_text(encoding="utf-8"))
    round_config = config["rounds"][str(args.round_number)]
    symbol = config["symbol"]
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
    model_id = args.model_id or f"MNQ_ta_strategy_round_{args.round_number}_{stamp}"
    recipe = f"round_{args.round_number}_{stamp}"
    cost = load_cost_model(symbol)
    rules = [evaluate.TradingRule(**r) for r in round_config["rules"]]
    models = evaluate.model_specs(round_config["models"])
    fits = [(g["timeframe"], h, spec) for g in round_config["grid"] for h in g["horizons"] for spec in models]
    trial_count = len(fits) * len(rules)
    protocol.emit_config({
        "study": {"round": args.round_number, "title": round_config["title"], "hypothesis": round_config["hypothesis"],
                  "recipe": recipe, "goal_ticks_per_session_day": config["goal_ticks_per_session_day"]},
        "data": {"symbol": symbol, "start": round_config["data_start"], "end": round_config["data_end"],
                 "first_test": round_config["first_test"], "test_months": round_config["test_months"]},
        "grid": {"fits": len(fits), "rules": len(rules), "configurations": trial_count},
        "costs": {"round_trip_usd": cost.round_trip, "round_trip_ticks": cost.round_trip / cost.tick_value,
                  "source": cost.source},
    }, scope="run", label=recipe)
    protocol.emit_log(f"[plan] round {args.round_number}: {len(fits)} model fits x {len(rules)} trading rules = "
                      f"{trial_count} configurations; costs {cost.round_trip:.2f} USD a round trip ({cost.source})")

    def log(message: str, level: str = "info") -> None:
        protocol.emit_log(message, level)

    connection = _serving()
    connection.execute("SET TimeZone='UTC'")
    windows = evaluate.fold_windows(round_config["first_test"], int(round_config["test_months"]), round_config["data_end"])
    bars_by_timeframe = {}
    features_by_timeframe = {}
    roll_frames = []
    for g in round_config["grid"]:
        tf = g["timeframe"]
        bars = load_bars(connection, symbol, tf, round_config["data_start"], round_config["data_end"])
        bars_by_timeframe[tf] = bars
        computed = features.compute(bars.frame)
        excluded = tuple(round_config.get("excluded_feature_prefixes", []))
        features_by_timeframe[tf] = computed[[c for c in computed.columns if not c.startswith(excluded)]] if excluded else computed
        roll_frames.append(roll_table(bars))
        log(f"[data] {symbol} {tf}: {len(bars.frame):,} bars, {len(bars.rolls)} contract switches back-adjusted, "
            f"{features_by_timeframe[tf].shape[1]} features")

    predictions = []
    for n, (tf, horizon, (label, kind, own_parameters)) in enumerate(fits):
        protocol.emit_progress(n, len(fits), "fitting")
        predictions.append(evaluate.predict_horizon(
            bars_by_timeframe[tf], features_by_timeframe[tf], horizon, label, windows,
            float(round_config["validation_fraction"]), 7, {**round_config.get("model_parameters", {}), **own_parameters},
            log, model_kind=kind))
    protocol.emit_progress(len(fits), len(fits), "fitting")

    simulated = []
    for prediction in predictions:
        for rule in rules:
            result = evaluate.simulate(bars_by_timeframe[prediction.timeframe], prediction, rule, cost, windows)
            simulated.append((prediction, rule, result))
    # Grid-wide numbers on the ALPHA series (daily ticks minus buy-and-hold beta), on the days all
    # configurations share: how many independent tests the grid is, the spread of their Sharpe ratios
    # (the deflated-Sharpe benchmark), and White's Reality Check for the best one.
    from ta_strategy import metrics as grid_metrics

    def config_id_of(prediction, rule) -> str:
        return f"{prediction.timeframe}_h{prediction.horizon_bars}_{prediction.model}_{rule_slug(rule)}"

    alpha_columns = {}
    for prediction, rule, result in simulated:
        daily = result["daily"]
        if len(daily) < 20:
            continue
        ab = grid_metrics.alpha_beta(daily["net_usd"].to_numpy() / (cost.tick_value * rule.contracts),
                                     daily["buy_and_hold_usd"].to_numpy() / cost.tick_value)
        alpha_columns[config_id_of(prediction, rule)] = pd.Series(ab["alpha_series"], index=daily["session_date"].to_numpy())
    alpha_matrix = pd.DataFrame(alpha_columns).dropna()
    effective_trials = grid_metrics.effective_trial_count(alpha_matrix.to_numpy())
    alpha_sharpes = (alpha_matrix.mean() / alpha_matrix.std(ddof=1)).to_numpy()
    sharpe_variance = float(np.var(alpha_sharpes, ddof=1)) if alpha_sharpes.size > 1 else math.nan
    reality_check = grid_metrics.reality_check_p_value(alpha_matrix.to_numpy())
    log(f"[grid] {alpha_matrix.shape[1]} configurations on {alpha_matrix.shape[0]:,} shared session days behave like "
        f"{effective_trials:.1f} independent tests; Reality Check p-value for the best alpha {reality_check:.3f}")

    config_rows, fold_frames, daily_frames, trade_frames = [], [], [], []
    for index, (prediction, rule, result) in enumerate(simulated):
        config_id = config_id_of(prediction, rule)
        identity = {"round": args.round_number, "configuration_id": config_id, "timeframe": prediction.timeframe,
                    "horizon_bars": prediction.horizon_bars, "model": prediction.model,
                    "gate_fraction": rule.gate_fraction, "session_filter": rule.session_filter,
                    "stop_loss_ticks": rule.stop_loss_ticks, "take_profit_ticks": rule.take_profit_ticks,
                    "long_only": rule.long_only, "contracts": rule.contracts, "gate_centre": rule.gate_centre,
                    "extra_slippage_ticks_per_side": rule.extra_slippage_ticks_per_side, "trading_rule": rule.label()}
        summary = evaluate.summarise(result, cost, rule, effective_trials, sharpe_variance)
        config_rows.append({**identity, **summary})
        for name, frames in (("folds", fold_frames), ("daily", daily_frames), ("trades", trade_frames)):
            frame = result[name]
            if len(frame):
                frames.append(frame.assign(round=args.round_number, configuration_id=config_id))
        protocol.emit_metric("net_ticks_per_session_day", summary.get("net_ticks_per_session_day_mean", math.nan),
                             index, len(simulated))
        log(f"[score] {config_id}: {summary.get('net_ticks_per_session_day_mean', math.nan):+.1f} net ticks/day "
            f"(buy-and-hold {summary.get('buy_and_hold_ticks_per_session_day', math.nan):+.1f}, alpha "
            f"{summary.get('alpha_ticks_per_session_day', math.nan):+.1f}, t {summary.get('alpha_newey_west_t', math.nan):+.2f}), "
            f"{summary.get('trades_per_session_day', 0):.2f} trades/day, AUC {summary.get('test_area_under_roc_curve_median', math.nan):.4f}")

    configs = pd.DataFrame(config_rows).sort_values("net_ticks_per_session_day_mean", ascending=False)
    best = configs.iloc[0]
    all_folds = pd.concat(fold_frames, ignore_index=True)
    for _, row in all_folds[all_folds["configuration_id"] == best["configuration_id"]].iterrows():
        protocol.emit_fold_complete(int(row["fold_index"]), {
            "net_ticks_per_session_day": row["net_ticks_per_session_day"],
            "buy_and_hold_ticks_per_session_day": row["buy_and_hold_ticks_per_session_day"],
            "trade_count": row["trade_count"], "test_area_under_roc_curve": row["test_area_under_roc_curve"],
            "configuration_id": best["configuration_id"]})

    prediction_rows = []
    importance_rows = []
    for prediction in predictions:
        stamps = bars_by_timeframe[prediction.timeframe].frame["timestamp"].to_numpy(np.int64)
        for fold_index, fold in prediction.by_fold.items():
            prediction_rows.append(pd.DataFrame({
                "round": args.round_number, "timeframe": prediction.timeframe, "horizon_bars": prediction.horizon_bars,
                "model": prediction.model, "fold_index": fold_index,
                "timestamp": pd.to_datetime(stamps[fold["test_rows"]], unit="s"),
                "probability_up": fold["probability"], "label_up": fold["test_label"]}))
        if prediction.importance is not None:
            importance_rows.append(prediction.importance.assign(
                round=args.round_number, timeframe=prediction.timeframe, horizon_bars=prediction.horizon_bars,
                model=prediction.model))

    oracle_start = round_config["first_test"]
    oracle_bars = load_bars(connection, symbol, round_config.get("oracle_timeframe", "1m"), oracle_start, round_config["data_end"])
    oracle_table = oracle.by_session(oracle_bars, cost.tick_size, cost.round_trip / cost.tick_value)
    log(f"[oracle] {len(oracle_table):,} sessions from {oracle_start}: median complete-session 40-tick-swing ceiling "
        f"{oracle_table.loc[oracle_table.complete_session, 'session_oracle_40_tick_swing_net_ticks'].median():,.0f} net ticks")

    elapsed = time.monotonic() - started
    primary_id = round_config.get("primary_configuration_id")
    primary = configs[configs["configuration_id"] == primary_id].iloc[0] if primary_id in set(configs["configuration_id"]) else None
    criteria = round_config.get("pass_criteria", {})
    primary_passes = None
    if primary is not None and criteria:
        primary_passes = bool(
            primary.get("alpha_newey_west_t", math.nan) >= criteria.get("alpha_newey_west_t_minimum", 2.0)
            and reality_check <= criteria.get("reality_check_p_value_maximum", 0.05)
            and primary.get("folds_with_positive_alpha", 0) >= criteria.get("folds_with_positive_alpha_minimum", 7)
        )
        log(f"[verdict] pre-registered primary {primary_id}: alpha {primary['alpha_ticks_per_session_day']:+.1f} ticks/day "
            f"(t {primary['alpha_newey_west_t']:+.2f}), {int(primary['folds_with_positive_alpha'])} of "
            f"{int(primary['fold_count'])} folds positive, grid Reality Check p {reality_check:.3f} -> "
            f"{'PASSES' if primary_passes else 'does not pass'}")
    round_row = pd.DataFrame([{
        "primary_configuration_id": primary_id,
        "primary_net_ticks_per_session_day": float(primary["net_ticks_per_session_day_mean"]) if primary is not None else math.nan,
        "primary_alpha_ticks_per_session_day": float(primary["alpha_ticks_per_session_day"]) if primary is not None else math.nan,
        "primary_alpha_newey_west_t": float(primary["alpha_newey_west_t"]) if primary is not None else math.nan,
        "primary_passes_pre_registered_criteria": primary_passes,
        "effective_trial_count": effective_trials,
        "reality_check_p_value_best_alpha": reality_check,
        "best_alpha_configuration_id": configs.sort_values("alpha_newey_west_t", ascending=False).iloc[0]["configuration_id"],
        "best_alpha_newey_west_t": float(configs["alpha_newey_west_t"].max()),
        "round": args.round_number, "recipe": recipe, "model_id": model_id, "title": round_config["title"],
        "hypothesis": round_config["hypothesis"], "round_configuration_json": json.dumps(round_config),
        "goal_ticks_per_session_day": float(config["goal_ticks_per_session_day"]),
        "round_trip_cost_usd": cost.round_trip, "round_trip_cost_ticks": cost.round_trip / cost.tick_value,
        "configuration_count": len(configs), "best_configuration_id": best["configuration_id"],
        "best_net_ticks_per_session_day": float(best["net_ticks_per_session_day_mean"]),
        "best_interval_95_low": float(best["net_ticks_per_session_day_mean_interval_95_low"]),
        "best_interval_95_high": float(best["net_ticks_per_session_day_mean_interval_95_high"]),
        "best_deflated_sharpe_probability_on_alpha": float(best["deflated_sharpe_probability_on_alpha"]),
        "configurations_positive": int((configs["net_ticks_per_session_day_mean"] > 0).sum()),
        "configurations_beating_buy_and_hold": int((configs["excess_over_buy_and_hold_ticks_per_session_day"] > 0).sum()),
        "elapsed_seconds": elapsed, "finished_at": datetime.now(timezone.utc).isoformat(),
    }])
    tables = {
        "rounds": round_row,
        "configurations": configs,
        "folds": all_folds,
        "daily": pd.concat(daily_frames, ignore_index=True),
        "trades": pd.concat(trade_frames, ignore_index=True),
        "predictions": pd.concat(prediction_rows, ignore_index=True),
        "feature_importance": pd.concat(importance_rows, ignore_index=True) if importance_rows else pd.DataFrame(),
        "rolls": pd.concat(roll_frames, ignore_index=True),
        "oracle_by_session": oracle_table.assign(round=args.round_number),
    }
    tables = {k: v for k, v in tables.items() if len(v)}
    directory = os.path.join(args.output_dir, model_id)
    paths = store.write_local(tables, directory)
    landing = None
    if not args.no_land:
        landing = store.land(paths, recipe, f"TA strategy round {args.round_number} ({model_id})")
        for name, info in landing.items():
            log(f"[save] {name}: {info['rows']:,} rows -> {info['uri']} (manifest {info['manifest']})")
    diagnostics = {"recipe": recipe, "round": args.round_number, "best": best.to_dict(), "tables": paths,
                   "lake": landing, "elapsed_seconds": elapsed}
    with open(os.path.join(directory, "diagnostics.json"), "w", encoding="utf-8") as handle:
        handle.write(protocol.dumps_safe(diagnostics, indent=1))
    protocol.emit_done(directory, diagnostics)
    return diagnostics


def main(argv: list[str] | None = None) -> int:
    args = parse(sys.argv[1:] if argv is None else argv)
    try:
        run(args)
        return 0
    except Exception as error:  # noqa: BLE001 - the dashboard needs the error as an event
        import traceback

        protocol.emit_error(f"{type(error).__name__}: {error}", traceback.format_exc())
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
