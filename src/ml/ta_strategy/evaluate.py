"""Walk-forward evaluation of the TA battery, scored in net MNQ ticks per session day.

What the original ``train_direction_ta.py`` got wrong, and what this does instead
(each measured or confirmed in the 2026-09-28 research pass):

1. Conviction gate threshold. The original took the quantile of the TEST fold's
   own convictions (look-ahead; $15,703 vs $4,928 causal in exp01). Here the
   threshold is the quantile of the VALIDATION rows' convictions, fitted before
   the test fold is seen.
2. Fill timing. The original booked ``close[t+H] - close[t]``: entry at the close
   of the bar that produced the signal. Here every decision at bar t's close is
   filled at bar t+1's open by ``cycle.simulate.Simulator`` (the Model Cycle's
   audited simulator), and the label is the move from that open to the open
   H bars later — exactly the trade the signal asks for.
3. Contract rolls. The original read an unadjusted spliced parquet (+213 to +297
   point steps booked as moves). Here bars come from the lake, back-adjusted at
   every roll (``data.load_bars``), and a position held across a real roll is
   charged one extra round trip.
4. Costs. One basis: ``src/config/cost_model.json`` for MNQ (1.39 USD per side,
   5.56 ticks a round trip), every fill.
5. Baseline. Buy-and-hold over the same test days is scored beside every
   configuration, because a model with chance AUC made money in the old logs
   simply by being long in a market that rose 3.4x.

A fold: test = one calendar window; train = every earlier row whose label ends
before the test window opens (purged by the horizon); validation = the last
``validation_fraction`` of train, separated from the fitting rows by the horizon.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from cycle.simulate import CostModel, Simulator

from . import features as feature_battery
from . import metrics as m
from .data import Bars, effective_roll_timestamps, session_dates

GOAL_TICKS_PER_DAY = 600.0


@dataclass(frozen=True)
class FoldWindow:
    index: int
    test_start: pd.Timestamp
    test_end: pd.Timestamp


@dataclass
class HorizonPredictions:
    """Out-of-sample probabilities for one (timeframe, horizon, model)."""
    timeframe: str
    horizon_bars: int
    model: str
    by_fold: dict[int, dict] = field(default_factory=dict)   # fold -> {test_rows, probability, validation_probability, auc, ...}
    importance: pd.DataFrame | None = None


SESSION_OPEN_OFFSET = pd.Timedelta(hours=9)   # session D opens at 15:00 Pacific on D-1 = D minus 9 hours


def fold_windows(first_test: str, test_months: int, end: str) -> list[FoldWindow]:
    """Calendar windows cut at CME session opens, so no session is split between
    two folds (cutting at midnight split three sessions in round 1)."""
    out: list[FoldWindow] = []
    start = pd.Timestamp(first_test)
    stop = pd.Timestamp(end)
    index = 0
    while start < stop:
        finish = min(start + pd.DateOffset(months=test_months), stop)
        out.append(FoldWindow(index, start - SESSION_OPEN_OFFSET, finish - SESSION_OPEN_OFFSET))
        start, index = finish, index + 1
    return out


def labels_for(frame: pd.DataFrame, horizon: int) -> tuple[np.ndarray, np.ndarray]:
    """Label of bar t: does the open H bars after the fill exceed the fill?
    Fill = open[t+1] (the next open), exit = open[t+1+H]. Returns (label with
    NaN where the exit is past the data, the index of the exit bar)."""
    opens = frame["open"].to_numpy(float)
    n = opens.size
    entry = np.arange(n) + 1
    exit_index = entry + horizon
    label = np.full(n, np.nan)
    ok = exit_index < n
    label[ok] = (opens[exit_index[ok]] > opens[entry[ok]]).astype(float)
    ties = ok.copy()
    ties[ok] = opens[exit_index[ok]] == opens[entry[ok]]
    label[ties] = np.nan              # an exact tie is neither up nor down: never trained on
    return label, exit_index


def _auc(labels: np.ndarray, probability: np.ndarray) -> float:
    from sklearn.metrics import roc_auc_score

    mask = np.isfinite(labels) & np.isfinite(probability)
    if mask.sum() < 10 or len(np.unique(labels[mask])) < 2:
        return math.nan
    return float(roc_auc_score(labels[mask], probability[mask]))


def _fit(model: str, x_fit: np.ndarray, y_fit: np.ndarray, x_validation: np.ndarray, y_validation: np.ndarray,
         seed: int, model_parameters: dict):
    if model == "logistic":
        from sklearn.linear_model import LogisticRegression
        from sklearn.pipeline import make_pipeline
        from sklearn.preprocessing import StandardScaler

        estimator = make_pipeline(
            StandardScaler(),
            LogisticRegression(C=float(model_parameters.get("logistic_inverse_regularization", 0.05)), max_iter=4000),
        )
        estimator.fit(x_fit, y_fit)
        return estimator, None
    if model == "lightgbm":
        import lightgbm

        estimator = lightgbm.LGBMClassifier(
            n_estimators=int(model_parameters.get("lightgbm_maximum_trees", 2000)),
            learning_rate=float(model_parameters.get("lightgbm_learning_rate", 0.02)),
            num_leaves=int(model_parameters.get("lightgbm_leaves", 15)),
            min_child_samples=max(100, x_fit.shape[0] // 200),
            subsample=0.7, subsample_freq=1, colsample_bytree=0.5, reg_lambda=1.0,
            random_state=seed, n_jobs=int(model_parameters.get("threads", 20)), verbose=-1,
        )
        estimator.fit(
            x_fit, y_fit, eval_set=[(x_validation, y_validation)], eval_metric="binary_logloss",
            callbacks=[lightgbm.early_stopping(100, verbose=False)],
        )
        return estimator, estimator.booster_.feature_importance(importance_type="gain")
    raise ValueError(f"unknown model {model!r}; use logistic or lightgbm")


def model_specs(models: list) -> list[tuple[str, str, dict]]:
    """``(label, kind, parameters)`` per model entry of a round: a plain string
    (``"logistic"``) or ``{"label": ..., "kind": ..., <parameters>}``."""
    out = []
    for entry in models:
        if isinstance(entry, str):
            out.append((entry, entry, {}))
        else:
            parameters = {k: v for k, v in entry.items() if k not in ("label", "kind")}
            out.append((entry["label"], entry["kind"], parameters))
    return out


def predict_horizon(bars: Bars, feature_frame: pd.DataFrame, horizon: int, model: str, windows: list[FoldWindow],
                    validation_fraction: float, seed: int, model_parameters: dict, log,
                    model_kind: str | None = None) -> HorizonPredictions:
    frame = bars.frame
    label, exit_index = labels_for(frame, horizon)
    # Test rows are chosen by SESSION DAY, not timestamp: a coarse bar stamped before a session's
    # 15:00 open can belong to it (a 4h bar stamped Sunday 12:00 is Monday's), and a timestamp cut
    # put that bar in one fold and the rest of its session in the next.
    days = session_dates(frame["timestamp"].to_numpy(np.int64))
    out = HorizonPredictions(bars.timeframe, horizon, model)
    importance_rows: list[pd.Series] = []
    for window in windows:
        first_day = (window.test_start + SESSION_OPEN_OFFSET).normalize().to_datetime64()
        last_day = (window.test_end + SESSION_OPEN_OFFSET).normalize().to_datetime64()
        test_rows = np.where((days >= first_day) & (days < last_day))[0]
        if test_rows.size == 0:
            continue
        first_test = int(test_rows[0])
        candidate = np.where((exit_index < first_test) & np.isfinite(label))[0]
        if candidate.size < 2000:
            log(f"[fold {window.index}] {bars.timeframe} H{horizon} {model}: {candidate.size} training rows, skipped", "warn")
            continue
        columns = feature_battery.usable_columns(feature_frame, candidate)
        x_all = feature_frame[columns].to_numpy(np.float64)
        finite = np.isfinite(x_all).all(axis=1)
        train_rows = candidate[finite[candidate]]
        split = int(train_rows.size * (1.0 - validation_fraction))
        validation_rows = train_rows[split:]
        fit_rows = train_rows[: max(0, split - (horizon + 1))]        # purge: no fitting label ends inside validation
        estimator, gain = _fit(model_kind or model, x_all[fit_rows], label[fit_rows], x_all[validation_rows],
                               label[validation_rows], seed + window.index, model_parameters)
        validation_probability = estimator.predict_proba(x_all[validation_rows])[:, 1]
        fit_mean_probability = float(estimator.predict_proba(x_all[fit_rows])[:, 1].mean())
        probability = np.full(test_rows.size, np.nan)
        test_finite = finite[test_rows]
        if test_finite.any():
            probability[test_finite] = estimator.predict_proba(x_all[test_rows[test_finite]])[:, 1]
        test_label = label[test_rows]
        known = np.isfinite(test_label) & np.isfinite(probability)
        up_share = float(test_label[known].mean()) if known.any() else math.nan
        accuracy = float(((probability[known] > 0.5) == (test_label[known] > 0.5)).mean()) if known.any() else math.nan
        out.by_fold[window.index] = {
            "test_rows": test_rows,
            "probability": probability,
            "validation_probability": validation_probability,
            "fit_mean_probability": fit_mean_probability,
            "fit_up_rate": float(label[fit_rows].mean()),
            "test_label": test_label,
            "auc": _auc(test_label, probability),
            "validation_auc": _auc(label[validation_rows], validation_probability),
            "accuracy": accuracy,
            "majority_baseline_accuracy": max(up_share, 1 - up_share) if np.isfinite(up_share) else math.nan,
            "fit_row_count": int(fit_rows.size),
            "validation_row_count": int(validation_rows.size),
            "feature_count": len(columns),
        }
        if gain is not None:
            importance_rows.append(pd.Series(gain / max(gain.sum(), 1e-12), index=columns))
        log(f"[fold {window.index}] {bars.timeframe} H{horizon} {model}: fit {fit_rows.size:,} rows, "
            f"validation AUC {out.by_fold[window.index]['validation_auc']:.4f}, test AUC {out.by_fold[window.index]['auc']:.4f}")
    if importance_rows:
        table = pd.concat(importance_rows, axis=1).fillna(0.0)
        out.importance = pd.DataFrame({"feature": table.index, "gain_share_mean": table.mean(axis=1).to_numpy(),
                                       "folds_present": (table > 0).sum(axis=1).to_numpy()})
    return out


@dataclass(frozen=True)
class TradingRule:
    gate_fraction: float                 # trade the top fraction of bars by conviction (threshold from validation)
    session_filter: str = "all"          # "all" | "regular_trading_hours": new entries only 06:30-13:00 Pacific
    stop_loss_ticks: float = 0.0
    take_profit_ticks: float = 0.0
    long_only: bool = False
    contracts: int = 1
    # "half": conviction = |p - 0.5| (round 1). "fit_mean": conviction and side are measured from the mean
    # P(up) the fold's model gives its own fitting rows, so a model centred on the market's upward drift
    # (P ~ 0.55 everywhere) is not read as confidently long on every bar.
    gate_centre: str = "half"
    extra_slippage_ticks_per_side: float = 0.0     # on top of cost_model.json's 1 tick per side

    def label(self) -> str:
        parts = [f"gate {self.gate_fraction:.0%}" + (" centred" if self.gate_centre == "fit_mean" else "")]
        if self.extra_slippage_ticks_per_side:
            parts.append(f"+{self.extra_slippage_ticks_per_side:g} tick slippage per side")
        if self.session_filter != "all":
            parts.append("RTH entries")
        if self.stop_loss_ticks or self.take_profit_ticks:
            parts.append(f"stop {self.stop_loss_ticks:g} / target {self.take_profit_ticks:g} ticks")
        if self.long_only:
            parts.append("long only")
        return ", ".join(parts)


def simulate(bars: Bars, predictions: HorizonPredictions, rule: TradingRule, cost: CostModel,
             windows: list[FoldWindow]) -> dict:
    """Trade one configuration through every fold. Returns per-bar, per-day, per-fold and trade records."""
    if rule.extra_slippage_ticks_per_side:
        from dataclasses import replace

        cost = replace(cost, cost_per_side=cost.cost_per_side + rule.extra_slippage_ticks_per_side * cost.tick_value)
    if rule.gate_centre not in ("half", "fit_mean"):
        raise ValueError(f"gate_centre must be half or fit_mean, got {rule.gate_centre!r}")
    frame = bars.frame
    o, h, l, c = (frame[k].to_numpy(float) for k in ("open", "high", "low", "close"))
    stamps = frame["timestamp"].to_numpy(np.int64)
    days = session_dates(stamps)
    minute = (pd.to_datetime(stamps, unit="s").hour * 60 + pd.to_datetime(stamps, unit="s").minute).to_numpy()
    in_rth = (minute >= feature_battery.RTH_OPEN_MINUTE) & (minute < feature_battery.RTH_CLOSE_MINUTE)
    roll_times = effective_roll_timestamps(bars.rolls)
    tick_value = cost.tick_value
    trades: list[dict] = []
    daily_parts: list[pd.DataFrame] = []
    fold_rows: list[dict] = []
    for window in windows:
        fold = predictions.by_fold.get(window.index)
        if fold is None:
            continue
        rows = fold["test_rows"]
        probability = fold["probability"]
        centre = fold["fit_mean_probability"] if rule.gate_centre == "fit_mean" else 0.5
        validation_conviction = np.abs(fold["validation_probability"] - centre)
        threshold = 0.0 if rule.gate_fraction >= 1.0 else float(np.quantile(validation_conviction, 1.0 - rule.gate_fraction))
        simulator = Simulator(cost, contracts=rule.contracts, holding_bars=predictions.horizon_bars,
                              stop_loss_ticks=rule.stop_loss_ticks, take_profit_ticks=rule.take_profit_ticks,
                              long_only=rule.long_only)
        simulator.begin_fold(window.index)
        net = np.zeros(rows.size)
        held = np.zeros(rows.size, dtype=int)
        for k, i in enumerate(rows):
            p = probability[k]
            if not np.isfinite(p):
                signal = None
            elif p == centre or abs(p - centre) < threshold or (rule.session_filter == "regular_trading_hours" and not in_rth[i]):
                signal = 0
            else:
                signal = 1 if p > centre else -1
            result = simulator.step(int(i), int(stamps[i]), o[i], h[i], l[i], c[i], signal,
                                    None if not np.isfinite(p) else float(p), decide=k < rows.size - 1)
            net[k] = result.net_usd
            held[k] = result.held
        net[-1] += simulator.flatten(int(rows[-1]), int(stamps[rows[-1]]), c[rows[-1]], "end_of_fold")
        # a position held across a real contract roll pays one more round trip, booked on the roll bar
        roll_cost = np.zeros(rows.size)
        fold_trades = [t.to_row() for t in simulator.closed_trades]
        for t in fold_trades:
            crossed = roll_times[(roll_times > t["entry_timestamp"]) & (roll_times <= t["exit_timestamp"])]
            t["rolls_crossed"] = int(crossed.size)
            t["roll_cost_usd"] = float(crossed.size * cost.round_trip * rule.contracts)
            t["net_profit_after_rolls_usd"] = t["net_profit_usd"] - t["roll_cost_usd"]
            for r in crossed:
                position = np.searchsorted(stamps[rows], r)
                roll_cost[min(position, rows.size - 1)] += cost.round_trip * rule.contracts
            t["session_date"] = pd.Timestamp(days[np.searchsorted(stamps, t["entry_timestamp"])])
            t["net_ticks"] = t["net_profit_after_rolls_usd"] / tick_value / rule.contracts
            t["gross_ticks"] = t["gross_profit_usd"] / tick_value / rule.contracts
        net = net - roll_cost
        trades.extend(fold_trades)
        # buy-and-hold over the same bars: long at the first open, out at the last close, rolls charged
        hold_marks = np.r_[c[rows[0]] - o[rows[0]], np.diff(c[rows])] * cost.point_value
        hold_marks[0] -= cost.cost_per_side
        hold_marks[-1] -= cost.cost_per_side
        for r in roll_times[(roll_times > stamps[rows[0]]) & (roll_times <= stamps[rows[-1]])]:
            hold_marks[min(np.searchsorted(stamps[rows], r), rows.size - 1)] -= cost.round_trip
        day_frame = pd.DataFrame({"session_date": days[rows], "net_usd": net, "buy_and_hold_usd": hold_marks,
                                  "exposed_bar": held != 0})
        per_day = day_frame.groupby("session_date").agg(net_usd=("net_usd", "sum"),
                                                        buy_and_hold_usd=("buy_and_hold_usd", "sum"),
                                                        exposed_bars=("exposed_bar", "sum"),
                                                        bars=("exposed_bar", "size")).reset_index()
        entries = pd.Series([t["session_date"] for t in fold_trades], dtype="datetime64[ns]")
        per_day["trade_count"] = per_day["session_date"].map(entries.value_counts()).fillna(0).astype(int)
        per_day["fold_index"] = window.index
        daily_parts.append(per_day)
        fold_net_ticks = per_day["net_usd"].sum() / tick_value / rule.contracts
        fold_rows.append({
            "fold_index": window.index,
            "test_start": window.test_start, "test_end": window.test_end,
            "session_day_count": int(len(per_day)),
            "trade_count": len(fold_trades),
            "gate_threshold_conviction": threshold,
            "gate_centre_probability": centre,
            "fit_mean_probability": fold.get("fit_mean_probability", math.nan),
            "fit_up_rate": fold.get("fit_up_rate", math.nan),
            "long_trade_count": int(sum(t["side"] == "long" for t in fold_trades)),
            "short_trade_count": int(sum(t["side"] == "short" for t in fold_trades)),
            "long_net_ticks": float(sum(t["net_ticks"] for t in fold_trades if t["side"] == "long")),
            "short_net_ticks": float(sum(t["net_ticks"] for t in fold_trades if t["side"] == "short")),
            "net_ticks": float(fold_net_ticks),
            "net_ticks_per_session_day": float(fold_net_ticks / max(len(per_day), 1)),
            "buy_and_hold_ticks_per_session_day": float(per_day["buy_and_hold_usd"].sum() / tick_value / max(len(per_day), 1)),
            "test_area_under_roc_curve": fold["auc"],
            "validation_area_under_roc_curve": fold["validation_auc"],
            "test_accuracy": fold["accuracy"],
            "majority_baseline_accuracy": fold["majority_baseline_accuracy"],
            "fit_row_count": fold["fit_row_count"],
            "feature_count": fold["feature_count"],
        })
    daily = pd.concat(daily_parts, ignore_index=True) if daily_parts else pd.DataFrame()
    return {"trades": pd.DataFrame(trades), "daily": daily, "folds": pd.DataFrame(fold_rows)}


def summarise(result: dict, cost: CostModel, rule: TradingRule, trial_count: int, sharpe_variance: float) -> dict:
    daily = result["daily"]
    trades = result["trades"]
    folds = result["folds"]
    if daily.empty:
        return {"session_day_count": 0}
    per_contract = cost.tick_value * rule.contracts
    daily_ticks = daily["net_usd"].to_numpy() / per_contract
    hold_ticks = daily["buy_and_hold_usd"].to_numpy() / cost.tick_value
    day_count = len(daily)
    out: dict = {"session_day_count": day_count}
    out.update(m.eight_numbers(daily_ticks, "net_ticks_per_session_day"))
    low, high = m.block_bootstrap_mean_interval(daily_ticks)
    out["net_ticks_per_session_day_mean_interval_95_low"] = low
    out["net_ticks_per_session_day_mean_interval_95_high"] = high
    out["total_net_ticks"] = float(daily_ticks.sum())
    out["goal_ticks_per_session_day"] = GOAL_TICKS_PER_DAY
    out["gap_to_goal_ticks_per_session_day"] = GOAL_TICKS_PER_DAY - out["net_ticks_per_session_day_mean"]
    out["share_of_goal"] = out["net_ticks_per_session_day_mean"] / GOAL_TICKS_PER_DAY
    out["share_of_days_at_or_above_goal"] = float((daily_ticks >= GOAL_TICKS_PER_DAY).mean())
    out["share_of_days_positive"] = float((daily_ticks > 0).mean())
    out["buy_and_hold_ticks_per_session_day"] = float(hold_ticks.mean())
    out["excess_over_buy_and_hold_ticks_per_session_day"] = out["net_ticks_per_session_day_mean"] - out["buy_and_hold_ticks_per_session_day"]
    out["trade_count"] = int(len(trades))
    out["trades_per_session_day"] = len(trades) / day_count
    if len(trades):
        out["win_rate"] = float((trades["net_ticks"] > 0).mean())
        out["average_net_ticks_per_trade"] = float(trades["net_ticks"].mean())
        out["average_gross_ticks_per_trade"] = float(trades["gross_ticks"].mean())
        out["long_share_of_trades"] = float((trades["side"] == "long").mean())
        out["average_bars_held"] = float(trades["bars_held"].mean())
        gross = trades["gross_profit_usd"].sum()
        costs = (trades["cost_usd"] + trades["roll_cost_usd"]).sum()
        out["cost_share_of_gross_profit"] = float(costs / gross) if gross > 0 else math.nan
        wins = trades.loc[trades["net_ticks"] > 0, "net_ticks"].sum()
        losses = -trades.loc[trades["net_ticks"] <= 0, "net_ticks"].sum()
        out["profit_factor"] = float(wins / losses) if losses > 0 else math.nan
    out["exposure_share_of_bars"] = float(daily["exposed_bars"].sum() / max(daily["bars"].sum(), 1))
    out["annualised_sharpe_ratio"] = m.annualised_sharpe(daily_ticks)
    # alpha after buy-and-hold beta: the part of the daily ticks that is not "being long a rising market"
    ab = m.alpha_beta(daily_ticks, hold_ticks)
    alpha_series = ab["alpha_series"]
    out["beta_to_buy_and_hold"] = ab["beta"]
    out["beta_contribution_ticks_per_session_day"] = ab.get("beta_contribution", math.nan)
    out["alpha_ticks_per_session_day"] = ab["alpha"]
    out["alpha_newey_west_t"] = ab.get("alpha_newey_west_t", math.nan)
    out["excess_over_buy_and_hold_newey_west_t"] = ab.get("excess_newey_west_t", math.nan)
    low, high = m.block_bootstrap_mean_interval(alpha_series)
    out["alpha_interval_95_low"], out["alpha_interval_95_high"] = low, high
    if len(alpha_series) == len(daily):
        by_fold = pd.Series(alpha_series).groupby(daily["fold_index"].to_numpy()).sum()
        total = by_fold.sum()
        out["folds_with_positive_alpha"] = int((by_fold > 0).sum())
        out["best_fold_share_of_alpha"] = float(by_fold.max() / total) if total > 0 else math.nan
        without_best = np.delete(alpha_series, np.flatnonzero(daily["fold_index"].to_numpy() == by_fold.idxmax()))
        out["alpha_without_best_fold_ticks_per_session_day"] = float(without_best.mean()) if without_best.size else math.nan
    out["net_ticks_per_session_day_without_top_10_days"] = float(np.sort(daily_ticks)[:-10].mean()) if day_count > 10 else math.nan
    benchmark = m.expected_maximum_sharpe(sharpe_variance, int(round(trial_count)))
    out["deflation_trial_count"] = trial_count
    out["deflated_sharpe_probability_on_alpha"] = m.deflated_sharpe_probability(alpha_series, benchmark)
    out["maximum_drawdown_ticks"] = m.maximum_drawdown(np.cumsum(daily_ticks))
    out["folds_positive"] = int((folds["net_ticks"] > 0).sum())
    out["fold_count"] = int(len(folds))
    out["folds_beating_buy_and_hold"] = int((folds["net_ticks_per_session_day"] > folds["buy_and_hold_ticks_per_session_day"]).sum())
    out["test_area_under_roc_curve_median"] = float(folds["test_area_under_roc_curve"].median())
    out["test_accuracy_mean"] = float(folds["test_accuracy"].mean())
    out["accuracy_skill_over_majority_mean"] = float((folds["test_accuracy"] - folds["majority_baseline_accuracy"]).mean())
    mean_usd = out["net_ticks_per_session_day_mean"] * cost.tick_value
    out["contracts_for_300_usd_per_day_at_this_mean"] = (
        float(math.ceil(300.0 / mean_usd)) if mean_usd > 0 else math.nan
    )
    return out
