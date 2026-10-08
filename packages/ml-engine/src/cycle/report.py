"""In-depth model and trading metrics for a Model Cycle run, built from the run's own record.

One pure computation over the tables every run lands (``predictions``, ``trades``,
``folds``, and ``runs`` when the run has it), so a run finished a minute ago and a
run recorded months ago get the same numbers from the same code: ``store.write_run``
calls it at every fold end and at the end, and ``scripts/land_model_cycle_metrics.py``
back-fills every run already in the lake. Seven tables land beside the record under
the run's recipe (``derived_model_cycle_runs_<table>``):

    model_metrics      one row per (scope, fold, segment, metric): classification,
                       probability, calibration, baseline and price-forecast metrics
    trading_metrics    the same shape: returns, risk-adjusted, drawdown, trades,
                       exposure, costs and baseline metrics
    calibration_bins   ten equal-width probability bins: forecast versus observed
    confusion_matrix   predicted versus actual direction, counted
    distributions      the eight-number summary of every per-trade, per-bar and
                       per-day quantity (mean, median, standard deviation, skewness,
                       kurtosis, 25th and 75th percentiles, minimum, maximum)
    drawdowns          every drawdown episode: peak, trough, recovery, depth, length
    daily_results      one row per session day

Every metric row carries its label, unit, better direction, plain-English definition
and formula, so a table read without this file still says what each number is. An
undefined number is null with the reason in ``note`` — never 0.

Scopes: ``run`` (every fold together, the way the engine's final scoreboard counts)
and ``fold`` (one fold's test span). Segments: ``all``; model metrics also by
``confidence`` (how far P(up) sat from 0.5); trade metrics also by ``side``,
``exit_reason`` and ``entry_confidence``. The thirty metrics the engine's scoreboard
already reports (``metrics.METRIC_NAMES``) are computed here by the same functions
from the same rows, and ``tests/test_cycle_report.py`` holds them equal to the
engine's own fold and final scoreboards.

Session day (``daily_results``, per-day metrics): futures timestamps in the lake are
Pacific wall clock stored as UTC, and a CME Globex session opens at 15:00 Pacific and
belongs to the next calendar day, so the session day of a futures bar is the date of
its stored time plus nine hours. Any other symbol, and a run whose symbol was not
recorded, uses the stored date; ``daily_results.session_day_rule`` says which rule
dated each row, and the session-day metrics carry a note when the symbol is unknown.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from datetime import datetime, timezone

import numpy as np
import pyarrow as pa

from cycle.metrics import (
    METRIC_NAMES,
    ScoreInputs,
    classification_metrics,
    distribution,
    maximum_drawdown,
    scoreboard,
    sharpe_ratio,
    trade_statistics,
)
from cycle.paths import CONFIG_ROOT

REPORT_TABLES = ("model_metrics", "trading_metrics", "calibration_bins", "confusion_matrix", "distributions",
                 "drawdowns", "daily_results")
CALIBRATION_BIN_COUNT = 10
SESSION_DAYS_PER_YEAR = 252
# CME Globex opens at 15:00 Pacific; stored Pacific wall clock + 9 h lands on the session's date
FUTURES_SESSION_OFFSET_SECONDS = 9 * 3600
# how far P(up) sat from 0.5, for the confidence segments
CONFIDENCE_EDGES = (0.0, 0.05, 0.10, 0.20, 0.5000001)

_COST_MODEL = CONFIG_ROOT / "cost_model.json"


def _finite(value) -> float | None:
    if value is None:
        return None
    value = float(value)
    return value if math.isfinite(value) else None


def futures_roots() -> frozenset[str]:
    """The futures roots the Cycle prices (``packages/config/cost_model.json``)."""
    try:
        return frozenset(key for key in json.loads(_COST_MODEL.read_text(encoding="utf-8")) if not key.startswith("_"))
    except (OSError, ValueError):
        return frozenset()


# ─── definitions ────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Definition:
    table: str
    family: str
    label: str
    unit: str
    better: str
    definition: str
    formula: str


def _define(table: str, family: str, entries: list[tuple[str, str, str, str, str, str]]) -> dict[str, Definition]:
    return {name: Definition(table, family, label, unit, better, definition, formula)
            for name, label, unit, better, definition, formula in entries}


MODEL = "model_metrics"
TRADING = "trading_metrics"

DEFINITIONS: dict[str, Definition] = {
    **_define(MODEL, "coverage", [
        ("processed_bar_count", "Processed bars", "count", "none",
         "Test bars the model made a call on in this scope.", "count of processed test bars"),
        ("scored_bar_count", "Scored bars", "count", "none",
         "Bars whose outcome is known and counted: the move over the label horizon beat the label threshold, the horizon crossed no session gap, and the model made a call.",
         "count of bars with a known up/down outcome and a prediction"),
        ("unscored_bar_count", "Unscored bars", "count", "none",
         "Processed bars left out of the classification metrics: the move stayed inside the label threshold, the horizon crossed a session gap, or the horizon ran past the data.",
         "processed bars - scored bars"),
        ("coverage_fraction", "Coverage", "fraction", "none",
         "The share of processed bars that were scored.", "scored bars / processed bars"),
        ("gap_crossing_bar_count", "Gap-crossing bars", "count", "none",
         "Bars whose label horizon crossed a session gap, so they carry no label, target or forecast.",
         "count of bars with crosses_gap true"),
        ("actual_up_fraction", "Actual up share", "fraction", "none",
         "The share of scored bars whose price rose over the horizon: the base rate a classifier has to beat.",
         "scored bars that went up / scored bars"),
        ("predicted_up_fraction", "Predicted up share", "fraction", "none",
         "The share of scored bars the model called up.", "scored bars called up / scored bars"),
    ]),
    **_define(MODEL, "classification", [
        ("accuracy", "Accuracy", "fraction", "higher",
         "The share of scored bars whose direction the model called correctly.", "correct calls / scored bars"),
        ("balanced_accuracy", "Balanced accuracy", "fraction", "higher",
         "Accuracy with up and down weighted equally, so a lopsided market cannot flatter it.",
         "(recall of up + recall of down) / 2"),
        ("precision", "Precision (up)", "fraction", "higher",
         "Of the bars called up, the share that went up.", "true up calls / all up calls"),
        ("recall", "Recall (up)", "fraction", "higher",
         "Of the bars that went up, the share the model called up.", "true up calls / bars that went up"),
        ("f1_score", "F1 score (up)", "fraction", "higher",
         "The harmonic mean of precision and recall for the up class.", "2 x precision x recall / (precision + recall)"),
        ("precision_down", "Precision (down)", "fraction", "higher",
         "Of the bars called down, the share that went down.", "true down calls / all down calls"),
        ("recall_down", "Recall (down)", "fraction", "higher",
         "Of the bars that went down, the share the model called down (the specificity).",
         "true down calls / bars that went down"),
        ("f1_score_down", "F1 score (down)", "fraction", "higher",
         "The harmonic mean of precision and recall for the down class.",
         "2 x true down / (2 x true down + false down calls + missed downs)"),
        ("macro_f1_score", "Macro F1 score", "fraction", "higher",
         "The F1 score of up and of down, averaged.", "(F1 up + F1 down) / 2"),
        ("matthews_correlation_coefficient", "Matthews correlation", "correlation", "higher",
         "The correlation between the calls and the outcomes, from -1 (always wrong) through 0 (no better than chance) to 1; fair under imbalance.",
         "(TP x TN - FP x FN) / sqrt((TP + FP)(TP + FN)(TN + FP)(TN + FN))"),
        ("cohens_kappa", "Cohen's kappa", "ratio", "higher",
         "Agreement between calls and outcomes beyond what the two base rates would give by chance.",
         "(observed agreement - chance agreement) / (1 - chance agreement)"),
        ("roc_auc", "ROC AUC", "probability", "higher",
         "The chance that a randomly chosen up bar got a higher P(up) than a randomly chosen down bar; 0.5 is no ranking skill.",
         "area under the receiver operating characteristic curve of P(up)"),
        ("average_precision", "Average precision (PR AUC)", "fraction", "higher",
         "The area under the precision-recall curve of P(up): ranking skill for the up class, read against the up base rate.",
         "sum over thresholds of (recall step x precision)"),
        ("true_positive_count", "Up called up", "count", "none", "Bars called up that went up.", "count"),
        ("false_positive_count", "Down called up", "count", "none", "Bars called up that went down.", "count"),
        ("true_negative_count", "Down called down", "count", "none", "Bars called down that went down.", "count"),
        ("false_negative_count", "Up called down", "count", "none", "Bars called down that went up.", "count"),
    ]),
    **_define(MODEL, "probability", [
        ("log_loss", "Log loss", "ratio", "lower",
         "How surprised the model was by what happened, averaged; punishes confident wrong calls hard. 0.693 is a coin flip.",
         "-mean(y ln p + (1 - y) ln(1 - p))"),
        ("brier_score", "Brier score", "ratio", "lower",
         "The mean squared gap between P(up) and the outcome (1 up, 0 down); 0.25 is always saying 0.5.",
         "mean((p - y)^2)"),
        ("brier_skill_score", "Brier skill score", "ratio", "higher",
         "How much better the Brier score is than always forecasting the base rate; above 0 beats the base rate.",
         "1 - Brier score / (base rate x (1 - base rate))"),
        ("mean_probability_up", "Mean P(up)", "probability", "none",
         "The average probability of up the model gave on scored bars.", "mean(p)"),
        ("probability_up_sharpness", "Sharpness", "probability", "none",
         "How far the model's probabilities spread: the standard deviation of P(up). Sharp is only good when it is also calibrated.",
         "standard deviation of p (ddof 1)"),
        ("class_balanced_logarithmic_loss", "Class-balanced log loss", "ratio", "lower",
         "The log loss of the scored up bars and the log loss of the scored down bars, averaged with each class carrying half whatever its share of the bars; the proper score that matches a model fitted with class-balanced weights. P(up) is clipped at machine epsilon as in the log loss. 0.693 is always saying 0.5.",
         "0.5 x mean over up bars of -ln(p) + 0.5 x mean over down bars of -ln(1 - p)"),
        ("extreme_probability_bar_count", "Bars with P(up) of exactly 0 or 1", "count", "none",
         "Scored bars where the model gave a probability of up of exactly 0 or exactly 1; each one that misses costs about 36 in the log loss.",
         "count of scored bars with p <= 0 or p >= 1"),
        ("distinct_probability_level_count", "Distinct P(up) values", "count", "none",
         "How many different values the probability of up took on the scored bars; with only a handful, ROC AUC and average precision are curves of a few points.",
         "count of distinct p"),
    ]),
    **_define(MODEL, "calibration", [
        ("expected_calibration_error", "Expected calibration error", "probability", "lower",
         "The average gap between the probability forecast and how often up happened, over ten equal-width probability bins weighted by their bar counts.",
         "sum over bins of (bars in bin / scored bars) x |observed up share - mean p|"),
        ("maximum_calibration_error", "Maximum calibration error", "probability", "lower",
         "The largest such gap in any non-empty bin.", "max over bins of |observed up share - mean p|"),
        ("brier_reliability_component", "Brier reliability", "ratio", "lower",
         "The part of the Brier score that is miscalibration (Murphy 1973, ten equal-width bins).",
         "sum over bins of n_k (mean p_k - observed_k)^2 / N"),
        ("brier_resolution_component", "Brier resolution", "ratio", "higher",
         "The part of the Brier score that is separation: how far each bin's outcome rate sits from the base rate (Murphy 1973).",
         "sum over bins of n_k (observed_k - base rate)^2 / N"),
        ("brier_uncertainty_component", "Brier uncertainty", "ratio", "none",
         "The Brier score of always forecasting the base rate; a property of the data, not the model. Brier = reliability - resolution + uncertainty, up to the spread of p inside each bin.",
         "base rate x (1 - base rate)"),
        ("calibration_slope", "Calibration slope", "ratio", "none",
         "The slope of a logistic regression of the outcome (1 up, 0 down) on the log-odds of P(up) over scored bars, with P(up) clipped to [0.000001, 0.999999]. It uses no bins. 1 means the probabilities are on the right scale; below 1 they are too extreme (over-confident), above 1 too timid.",
         "fit y ~ sigmoid(a + b x ln(p / (1 - p))) by maximum likelihood; report b"),
        ("calibration_intercept", "Calibration intercept", "ratio", "closer_to_zero",
         "The intercept of the same regression with the slope held at 1, in log-odds. 0 means no overall lean; above 0 up happened more often than the probabilities said, below 0 less often.",
         "fit y ~ sigmoid(a + ln(p / (1 - p))) by maximum likelihood; report a"),
    ]),
    **_define(MODEL, "baseline", [
        ("majority_class_accuracy", "Majority-class accuracy", "fraction", "none",
         "The accuracy of calling every scored bar the class most common in its fold's training labels.",
         "scored bars matching the fold's training majority / scored bars"),
        ("always_up_accuracy", "Always-up accuracy", "fraction", "none",
         "The accuracy of calling every scored bar up.", "scored bars that went up / scored bars"),
        ("accuracy_lift_over_majority_class", "Accuracy over majority class", "fraction", "higher",
         "How much the model's accuracy beats the majority-class baseline, in accuracy points.",
         "accuracy - majority-class accuracy"),
    ]),
    **_define(MODEL, "price_forecast", [
        ("resolved_forecast_count", "Resolved forecasts", "count", "none",
         "Price forecasts whose target bar has been walked, so their error is known.",
         "count of bars with a forecast error"),
        ("price_forecast_mean_absolute_error_points", "Forecast mean absolute error", "points", "lower",
         "The average size of the gap between the forecast move and the actual move.", "mean |predicted move - actual move|"),
        ("persistence_mean_absolute_error_points", "No-change mean absolute error", "points", "none",
         "The same error for the no-change forecast (predicted close = this close): the baseline.", "mean |actual move|"),
        ("price_forecast_skill", "Forecast skill versus no-change", "ratio", "higher",
         "How much smaller the forecast's error is than the no-change forecast's; above 0 beats no-change.",
         "1 - forecast mean absolute error / no-change mean absolute error"),
        ("price_forecast_root_mean_square_error_points", "Forecast root mean square error", "points", "lower",
         "The error's root mean square; weighs big misses more than the mean absolute error does.",
         "sqrt(mean((predicted move - actual move)^2))"),
        ("price_forecast_direction_accuracy", "Forecast direction accuracy", "fraction", "higher",
         "The share of resolved forecasts whose move had the right sign, over bars where neither move is zero.",
         "sign(predicted move) == sign(actual move), averaged"),
        ("price_forecast_median_absolute_error_points", "Forecast median absolute error", "points", "lower",
         "The middle size of the forecast error; not moved by a few large misses.", "median |predicted move - actual move|"),
        ("price_forecast_bias_points", "Forecast bias", "points", "closer_to_zero",
         "Whether the forecasts lean one way: the average signed error. Positive forecasts too high.",
         "mean(predicted move - actual move)"),
        ("predicted_actual_move_correlation", "Forecast-actual correlation", "correlation", "higher",
         "The Pearson correlation between the forecast move and the actual move.", "corr(predicted move, actual move)"),
        ("price_forecast_squared_error_skill", "Forecast squared-error skill versus no-change", "ratio", "higher",
         "How much smaller the forecast's mean squared error is than the no-change forecast's, over resolved forecasts; above 0 beats no-change. It is the out-of-sample R-squared against a zero-move benchmark, the skill measure that matches a forecast of the mean move.",
         "1 - mean((predicted move - actual move)^2) / mean(actual move^2)"),
        ("forecast_call_agreement_fraction", "Forecast and call agree", "fraction", "none",
         "The share of processed bars where the sign of the forecast move is the direction the model called, over bars where the forecast move is not zero and a call was made. Below 1, the step that turns the forecast into P(up) shifted or reversed it.",
         "sign(predicted move) == predicted direction, averaged"),
    ]),
    **_define(TRADING, "returns", [
        ("net_profit_usd", "Net profit", "usd", "higher",
         "Profit after every cost, marked to market bar by bar.", "sum of per-bar net profit"),
        ("net_profit_before_costs_usd", "Net profit before costs", "usd", "higher",
         "What the calls earned before commissions, fees and slippage.", "net profit + total cost"),
        ("annualized_net_profit_usd", "Annualized net profit", "usd", "higher",
         "The average bar's net profit scaled to a year of bars.", "mean(per-bar net) x bars per year"),
        ("net_profit_per_session_day_usd", "Net profit per session day", "usd", "higher",
         "Net profit divided by the session days traded.", "net profit / session days"),
        ("average_bar_net_profit_usd", "Average bar net profit", "usd", "higher",
         "The mean net profit of one bar.", "mean(per-bar net)"),
        ("bar_count", "Bars", "count", "none", "Bars marked to market in this scope.", "count"),
        ("session_day_count", "Session days", "count", "none",
         "CME session days with at least one bar in this scope.", "count of distinct session days"),
    ]),
    **_define(TRADING, "risk_adjusted", [
        ("sharpe_ratio", "Sharpe ratio", "ratio", "higher",
         "Average per-bar profit over its standard deviation, annualized with the run's measured bars per year.",
         "mean(r) / std(r, ddof 1) x sqrt(bars per year)"),
        ("sortino_ratio", "Sortino ratio", "ratio", "higher",
         "Like Sharpe, but only losing bars count as risk.", "mean(r) / sqrt(mean(min(r, 0)^2)) x sqrt(bars per year)"),
        ("calmar_ratio", "Calmar ratio", "ratio", "higher",
         "Annualized profit over the worst drawdown.", "mean(r) x bars per year / maximum drawdown"),
        ("sharpe_ratio_standard_error", "Sharpe ratio standard error", "ratio", "lower",
         "How uncertain the Sharpe estimate is given the sample size and the skew and fat tails of per-bar profit (Lo 2002; Bailey and Lopez de Prado 2012).",
         "sqrt((1 - skew x SR + (kurtosis - 1) / 4 x SR^2) / (N - 1)) x sqrt(bars per year), SR per bar, kurtosis not excess"),
        ("probabilistic_sharpe_ratio", "Probabilistic Sharpe ratio", "probability", "higher",
         "The probability that the true Sharpe ratio is above zero given this sample, its skew and its fat tails (Bailey and Lopez de Prado 2012).",
         "Phi(SR x sqrt(N - 1) / sqrt(1 - skew x SR + (kurtosis - 1) / 4 x SR^2)), SR per bar"),
        ("session_day_sharpe_ratio", "Session-day Sharpe ratio", "ratio", "higher",
         "Sharpe computed on each session day's net profit, annualized with 252 sessions per year.",
         "mean(day net) / std(day net, ddof 1) x sqrt(252)"),
        ("tail_ratio", "Tail ratio", "ratio", "higher",
         "The size of the 95th-percentile bar gain over the 5th-percentile bar loss; above 1 the right tail is fatter.",
         "|95th percentile of r| / |5th percentile of r|"),
        ("common_sense_ratio", "Common sense ratio", "ratio", "higher",
         "Profit factor times tail ratio (Kestner): above 1 the edge survives its tails.", "profit factor x tail ratio"),
        ("recovery_factor", "Recovery factor", "ratio", "higher",
         "Net profit over the worst drawdown: how many times the profit covers its deepest hole.",
         "net profit / maximum drawdown"),
    ]),
    **_define(TRADING, "drawdown", [
        ("maximum_drawdown_usd", "Maximum drawdown", "usd", "lower",
         "The largest fall of the equity curve (starting at 0) from a peak to a later trough.",
         "max over bars of (running peak - equity)"),
        ("maximum_drawdown_duration_bars", "Longest drawdown (bars)", "bars", "lower",
         "The longest stretch the equity spent below a previous peak, from the peak until it was regained or the scope ended.",
         "max over drawdown episodes of bars from peak to recovery"),
        ("maximum_drawdown_duration_days", "Longest drawdown (days)", "days", "lower",
         "The longest time the equity spent below a previous peak, in calendar days; it can be a different episode from the longest in bars (a few bars across a weekend).",
         "max over drawdown episodes of (time of recovery, or of the last bar, - time of the peak) / 86,400 s"),
        ("maximum_drawdown_recovery_bars", "Recovery from the maximum drawdown (bars)", "bars", "lower",
         "Bars from the deepest trough back to the peak before it; null when the scope ended before the equity recovered.",
         "bars from trough to recovery of the deepest episode"),
        ("average_drawdown_usd", "Average drawdown", "usd", "lower",
         "The average depth below the running peak over the bars spent under water.",
         "mean(running peak - equity) over bars below the peak"),
        ("ulcer_index_usd", "Ulcer index", "usd", "lower",
         "The root mean square depth below the running peak over every bar: depth and duration of pain together (Martin and McCann 1989, in USD).",
         "sqrt(mean((running peak - equity)^2))"),
        ("drawdown_count", "Drawdowns", "count", "none",
         "Distinct peak-to-trough-to-recovery episodes.", "count of drawdown episodes"),
    ]),
    **_define(TRADING, "trades", [
        ("trade_count", "Closed trades", "count", "none", "Trades opened and closed in this scope.", "count"),
        ("winning_trade_count", "Winning trades", "count", "none", "Closed trades with a positive net.", "count"),
        ("losing_trade_count", "Losing trades", "count", "none", "Closed trades with a negative net.", "count"),
        ("win_rate", "Win rate", "fraction", "higher",
         "The share of closed trades that made money after costs.", "winning trades / trades"),
        ("profit_factor", "Profit factor", "ratio", "higher",
         "What the winners made per dollar the losers lost; above 1 is profitable.",
         "sum of winning nets / |sum of losing nets|"),
        ("payoff_ratio", "Payoff ratio", "ratio", "higher",
         "The average winner's size over the average loser's.", "average win / |average loss|"),
        ("expectancy_usd", "Expectancy", "usd", "higher",
         "What a trade is expected to make from the win rate and the average win and loss.",
         "win rate x average win - (1 - win rate) x |average loss|"),
        ("average_trade_usd", "Average trade", "usd", "higher", "The mean net of a closed trade.", "mean(trade net)"),
        ("average_win_usd", "Average win", "usd", "higher", "The mean net of a winning trade.", "mean(winning nets)"),
        ("average_loss_usd", "Average loss", "usd", "higher", "The mean net of a losing trade (negative).", "mean(losing nets)"),
        ("largest_win_usd", "Largest win", "usd", "none", "The best closed trade.", "max(trade net)"),
        ("largest_loss_usd", "Largest loss", "usd", "none", "The worst closed trade.", "min(trade net)"),
        ("gross_profit_usd", "Sum of winners", "usd", "higher",
         "The winning trades' nets added up.", "sum of winning nets"),
        ("gross_loss_usd", "Sum of losers", "usd", "higher",
         "The losing trades' nets added up (negative).", "sum of losing nets"),
        ("trade_net_profit_usd", "Trades' net profit", "usd", "higher",
         "The closed trades' nets added up.", "sum of trade nets"),
        ("average_bars_held", "Average bars held", "bars", "none", "How long a trade stayed open, on average.",
         "mean(bars held)"),
        ("average_bars_held_winners", "Average bars held (winners)", "bars", "none",
         "How long winning trades stayed open.", "mean(bars held of winners)"),
        ("average_bars_held_losers", "Average bars held (losers)", "bars", "none",
         "How long losing trades stayed open.", "mean(bars held of losers)"),
        ("longest_winning_streak_trades", "Longest winning streak", "count", "none",
         "The most winning trades in a row.", "longest run of consecutive winners, in entry order"),
        ("longest_losing_streak_trades", "Longest losing streak", "count", "lower",
         "The most losing trades in a row.", "longest run of consecutive losers, in entry order"),
        ("trades_per_session_day", "Trades per session day", "ratio", "none",
         "How often the model trades.", "trades / session days"),
        ("system_quality_number", "System quality number", "ratio", "higher",
         "Van Tharp's measure of how steady the trade results are: the average trade over its spread, times the square root of the trade count (uncapped).",
         "sqrt(trades) x mean(trade net) / std(trade net, ddof 1)"),
    ]),
    **_define(TRADING, "exposure", [
        ("exposure_fraction", "Exposure", "fraction", "none",
         "The share of bars a position was held through.", "bars in a position / bars"),
        ("long_exposure_fraction", "Long exposure", "fraction", "none", "The share of bars held long.", "long bars / bars"),
        ("short_exposure_fraction", "Short exposure", "fraction", "none", "The share of bars held short.", "short bars / bars"),
        ("flat_fraction", "Flat", "fraction", "none", "The share of bars with no position.", "flat bars / bars"),
    ]),
    **_define(TRADING, "costs", [
        ("total_cost_usd", "Total cost", "usd", "lower",
         "Commissions, exchange and NFA fees and slippage on every fill.", "sum of fill costs"),
        ("cost_per_trade_usd", "Cost per trade", "usd", "lower", "The round-trip cost of a trade, on average.",
         "total cost / trades"),
        ("cost_per_contract_per_side_usd", "Cost per contract per side", "usd", "lower",
         "What one contract costs to enter or exit once.", "median over trades of cost / (2 x contracts)"),
        ("cost_share_of_net_profit_before_costs", "Costs' share of the pre-cost profit", "fraction", "lower",
         "How much of what the calls earned went to costs; above 1 the costs took more than the edge.",
         "total cost / net profit before costs"),
        ("break_even_cost_per_contract_per_side_usd", "Break-even cost per contract per side", "usd", "higher",
         "The cost per contract per side at which the net profit would be zero: the cushion the edge has against costs.",
         "cost per contract per side + net profit / (2 x contracts traded)"),
    ]),
    **_define(TRADING, "baseline", [
        ("buy_and_hold_net_profit_usd", "Buy and hold", "usd", "none",
         "One contract position bought at each fold's first open and sold at its last close, one round trip per fold, summed.",
         "sum over folds of (last close - first open) x point value x contracts - one round trip"),
        ("net_profit_minus_buy_and_hold_usd", "Net profit minus buy and hold", "usd", "higher",
         "How much the model made beyond holding the market.", "net profit - buy and hold"),
    ]),
}

_SEGMENT_TRADE_METRICS = ("trade_count", "win_rate", "profit_factor", "payoff_ratio", "expectancy_usd", "average_trade_usd",
                          "trade_net_profit_usd", "largest_win_usd", "largest_loss_usd", "average_bars_held",
                          "total_cost_usd")

METRIC_ROW_COLUMNS = (
    ("model_id", pa.string()), ("scope", pa.string()), ("fold_index", pa.int64()), ("segment_kind", pa.string()),
    ("segment_value", pa.string()), ("metric_family", pa.string()), ("metric_name", pa.string()),
    ("metric_label", pa.string()), ("metric_value", pa.float64()), ("unit", pa.string()), ("better", pa.string()),
    ("sample_count", pa.int64()), ("note", pa.string()), ("definition", pa.string()), ("formula", pa.string()),
    ("metric_order", pa.int64()),
)
CALIBRATION_COLUMNS = (
    ("model_id", pa.string()), ("scope", pa.string()), ("fold_index", pa.int64()), ("bin_number", pa.int64()),
    ("probability_lower", pa.float64()), ("probability_upper", pa.float64()), ("scored_bar_count", pa.int64()),
    ("mean_probability_up", pa.float64()), ("observed_up_fraction", pa.float64()), ("calibration_gap", pa.float64()),
)
CONFUSION_COLUMNS = (
    ("model_id", pa.string()), ("scope", pa.string()), ("fold_index", pa.int64()), ("actual_direction", pa.string()),
    ("predicted_direction", pa.string()), ("bar_count", pa.int64()), ("share_of_scored_bars", pa.float64()),
)
DISTRIBUTION_COLUMNS = (
    ("model_id", pa.string()), ("scope", pa.string()), ("fold_index", pa.int64()), ("quantity_name", pa.string()),
    ("quantity_label", pa.string()), ("unit", pa.string()), ("segment_value", pa.string()), ("count", pa.int64()),
    ("mean", pa.float64()), ("median", pa.float64()), ("standard_deviation", pa.float64()), ("skewness", pa.float64()),
    ("kurtosis", pa.float64()), ("percentile_25", pa.float64()), ("percentile_75", pa.float64()),
    ("minimum", pa.float64()), ("maximum", pa.float64()),
)
DRAWDOWN_COLUMNS = (
    ("model_id", pa.string()), ("scope", pa.string()), ("fold_index", pa.int64()), ("drawdown_number", pa.int64()),
    ("depth_rank", pa.int64()), ("peak_timestamp", pa.int64()), ("trough_timestamp", pa.int64()),
    ("recovery_timestamp", pa.int64()), ("depth_usd", pa.float64()), ("bars_to_trough", pa.int64()),
    ("bars_to_recovery", pa.int64()), ("underwater_bars", pa.int64()), ("underwater_days", pa.float64()),
    ("recovered", pa.bool_()),
)
DAILY_COLUMNS = (
    ("model_id", pa.string()), ("session_day", pa.string()), ("fold_index", pa.int64()), ("bar_count", pa.int64()),
    ("exposed_bar_count", pa.int64()), ("net_profit_usd", pa.float64()), ("cumulative_net_profit_usd", pa.float64()),
    ("intraday_maximum_drawdown_usd", pa.float64()), ("trade_count", pa.int64()), ("winning_trade_count", pa.int64()),
    ("trade_net_profit_usd", pa.float64()), ("total_cost_usd", pa.float64()), ("scored_bar_count", pa.int64()),
    ("correct_bar_count", pa.int64()), ("accuracy", pa.float64()), ("session_day_rule", pa.string()),
)
REPORT_COLUMNS = {
    "model_metrics": METRIC_ROW_COLUMNS, "trading_metrics": METRIC_ROW_COLUMNS, "calibration_bins": CALIBRATION_COLUMNS,
    "confusion_matrix": CONFUSION_COLUMNS, "distributions": DISTRIBUTION_COLUMNS, "drawdowns": DRAWDOWN_COLUMNS,
    "daily_results": DAILY_COLUMNS,
}
_METRIC_ORDER = {name: index for index, name in enumerate(DEFINITIONS)}
_ALL_TRADE_METRICS = tuple(name for name, definition in DEFINITIONS.items() if definition.family == "trades")


# ─── the record, normalised ─────────────────────────────────────────────────


@dataclass
class ReportInputs:
    """A run's record as arrays. ``fold_baselines[k]`` carries what the tables do not:
    the fold's training majority class (``majority_class_up``) or, for a run recorded
    before that column, the fold's landed ``majority_class_accuracy``, and its
    ``buy_and_hold_net_profit_usd``."""

    model_id: str
    symbol: str
    bars_per_year: float
    predictions: dict[str, np.ndarray]
    trades: dict[str, np.ndarray]
    fold_indices: list[int]
    fold_baselines: dict[int, dict] = field(default_factory=dict)
    notes: dict[str, str] = field(default_factory=dict)     # metric name -> provenance or why undefined


def _column(table: pa.Table, name: str, dtype, fill) -> np.ndarray:
    if name not in table.column_names:
        return np.full(table.num_rows, fill, dtype=dtype)
    values = table.column(name).to_pylist()
    return np.array([fill if value is None else value for value in values], dtype=dtype)


def _has_values(table: pa.Table, name: str) -> bool:
    return name in table.column_names and table.column(name).null_count < table.num_rows


def prediction_arrays(predictions: pa.Table) -> tuple[dict[str, np.ndarray], dict[str, str]]:
    """The predictions table as arrays in time order, and notes on what a run recorded
    before 2026-09-27 lacks. Such a run has no per-bar net profit: it is the change in
    the recorded equity (which runs continuously across folds, from 0). It has no
    held position or exposure either, and its older ``position`` column cannot rebuild
    them (the engine counts a bar exposed when a position was held at any point in it;
    measured one bar in 783 off), so those stay unknown."""
    notes: dict[str, str] = {}
    order = np.argsort(_column(predictions, "timestamp", np.int64, 0), kind="stable")
    table = predictions.take(pa.array(order)) if predictions.num_rows else predictions
    out = {
        "timestamp": _column(table, "timestamp", np.int64, 0),
        "fold_index": _column(table, "fold_index", np.int64, -1),
        "open": _column(table, "open", np.float64, np.nan),
        "close": _column(table, "close", np.float64, np.nan),
        "probability_up": _column(table, "probability_up", np.float64, np.nan),
        "predicted_direction": _column(table, "predicted_direction", np.int64, 0),
        "actual_direction": _column(table, "actual_direction", np.int64, 0),
        "bar_net_profit_usd": _column(table, "bar_net_profit_usd", np.float64, 0.0),
        "equity_usd": _column(table, "equity_usd", np.float64, np.nan),
        "predicted_move_points": _column(table, "predicted_move_points", np.float64, np.nan),
        "forecast_error_points": _column(table, "forecast_error_points", np.float64, np.nan),
    }
    if "correct" in table.column_names:
        out["scored"] = np.array([value is not None for value in table.column("correct").to_pylist()], dtype=bool)
    else:
        out["scored"] = (out["actual_direction"] != 0) & (out["predicted_direction"] != 0)
    out["scored"] &= np.isfinite(out["probability_up"])
    if not _has_values(table, "bar_net_profit_usd") and np.isfinite(out["equity_usd"]).any():
        equity = np.nan_to_num(out["equity_usd"], nan=0.0)
        out["bar_net_profit_usd"] = np.diff(np.concatenate([[0.0], equity]))
        notes["bar_net_profit_usd"] = "recorded before 2026-09-27: per-bar net profit is the change in the recorded equity"
    if _has_values(table, "position_held"):
        out["position_held"] = _column(table, "position_held", np.int64, 0)
    else:
        out["position_held"] = None
        notes["position_held"] = "recorded before 2026-09-27, without the position held through each bar"
    if _has_values(table, "exposed"):
        out["exposed"] = _column(table, "exposed", bool, False)
    else:
        out["exposed"] = None
        notes["exposed"] = "recorded before 2026-09-27, without per-bar exposure"
    out["crosses_gap"] = _column(table, "crosses_gap", bool, False) if _has_values(table, "crosses_gap") else None
    if not _has_values(table, "forecast_error_points"):
        notes["price_forecast"] = "this run recorded no resolved price forecasts (no price model, or recorded before 2026-09-27)"
    return out, notes


def trade_arrays(trades: pa.Table) -> dict[str, np.ndarray]:
    closed = [index for index, value in enumerate(_column(trades, "net_profit_usd", np.float64, np.nan))
              if math.isfinite(value)] if trades.num_rows else []
    table = trades.take(pa.array(closed, type=pa.int64())) if trades.num_rows else trades
    out = {
        "fold_index": _column(table, "fold_index", np.int64, -1),
        "side": np.array([str(value or "") for value in (table.column("side").to_pylist() if "side" in table.column_names else [])], dtype=object),
        "contracts": _column(table, "contracts", np.int64, 1),
        "entry_timestamp": _column(table, "entry_timestamp", np.int64, 0),
        "exit_timestamp": _column(table, "exit_timestamp", np.int64, 0),
        "bars_held": _column(table, "bars_held", np.float64, np.nan),
        "probability_up_at_entry": _column(table, "probability_up_at_entry", np.float64, np.nan),
        "gross_profit_usd": _column(table, "gross_profit_usd", np.float64, np.nan),
        "cost_usd": _column(table, "cost_usd", np.float64, 0.0),
        "net_profit_usd": _column(table, "net_profit_usd", np.float64, np.nan),
        "exit_reason": np.array([str(value or "unknown") for value in (table.column("exit_reason").to_pylist() if "exit_reason" in table.column_names else [])], dtype=object),
    }
    if out["side"].size != table.num_rows:
        out["side"] = np.full(table.num_rows, "", dtype=object)
    if out["exit_reason"].size != table.num_rows:
        out["exit_reason"] = np.full(table.num_rows, "unknown", dtype=object)
    order = np.argsort(out["entry_timestamp"], kind="stable")
    return {name: values[order] for name, values in out.items()}


def fold_baselines_from_table(folds: pa.Table | None) -> dict[int, dict]:
    """Per fold: the training majority class when recorded, the landed majority-class
    accuracy and buy-and-hold (the engine's own), from the folds table."""
    out: dict[int, dict] = {}
    if folds is None or folds.num_rows == 0:
        return out
    rows = folds.to_pylist()
    for row in rows:
        metrics = row.get("metrics")
        metrics = json.loads(metrics) if isinstance(metrics, str) and metrics else (metrics or {})
        out[int(row["fold_index"])] = {
            "majority_class_up": row.get("majority_class_up"),
            "majority_class_accuracy": metrics.get("majority_class_accuracy"),
            "buy_and_hold_net_profit_usd": metrics.get("buy_and_hold_net_profit_usd"),
            "landed_metrics": metrics,
        }
    return out


def bars_per_year_from_record(run_bars_per_year, predictions: dict[str, np.ndarray],
                              fold_baselines: dict[int, dict]) -> tuple[float, str]:
    """The engine's bars per year: the run table's when it has one; else recovered
    exactly from a fold's landed Sharpe ratio (Sharpe = mean / std x sqrt(bars per
    year) solved for bars per year); else measured on the tested bars."""
    value = _finite(run_bars_per_year)
    if value:
        return value, "the run table's bars per year (measured on every loaded bar)"
    for fold_index, baseline in sorted(fold_baselines.items()):
        sharpe = _finite((baseline.get("landed_metrics") or {}).get("sharpe_ratio"))
        rows = predictions["bar_net_profit_usd"][predictions["fold_index"] == fold_index]
        if sharpe and rows.size >= 2:
            mean, std = float(np.mean(rows)), float(np.std(rows, ddof=1))
            if mean != 0.0 and std > 0.0:
                return (sharpe * std / mean) ** 2, f"recovered from fold {fold_index + 1}'s landed Sharpe ratio"
    from cycle.metrics import bars_per_year

    return bars_per_year(predictions["timestamp"]), "measured on the tested bars (the run recorded no bars per year)"


def inputs_from_tables(model_id: str, symbol: str, predictions: pa.Table, trades: pa.Table, folds: pa.Table | None,
                       run_bars_per_year=None) -> ReportInputs:
    prediction_columns, notes = prediction_arrays(predictions)
    baselines = fold_baselines_from_table(folds)
    bars_per_year_value, source = bars_per_year_from_record(run_bars_per_year, prediction_columns, baselines)
    notes["bars_per_year"] = source
    if not symbol:
        notes["session_day"] = "the run recorded no symbol, so session days are its stored calendar dates"
    fold_indices = sorted({int(k) for k in prediction_columns["fold_index"].tolist() if int(k) >= 0} | set(baselines))
    return ReportInputs(model_id=model_id, symbol=symbol, bars_per_year=bars_per_year_value,
                        predictions=prediction_columns, trades=trade_arrays(trades), fold_indices=fold_indices,
                        fold_baselines=baselines, notes=notes)


# ─── helpers ────────────────────────────────────────────────────────────────


def session_day_rule(symbol: str) -> str:
    """How ``session_days`` dates a bar of this symbol, in words."""
    if symbol.upper() in futures_roots():
        return "CME Globex session: the stored Pacific time plus 9 hours"
    if not symbol:
        return "the stored calendar date (the run recorded no symbol)"
    return "the stored calendar date"


def session_days(timestamps: np.ndarray, symbol: str) -> np.ndarray:
    """``YYYY-MM-DD`` session day per timestamp (see the module docstring)."""
    offset = FUTURES_SESSION_OFFSET_SECONDS if symbol.upper() in futures_roots() else 0
    return np.array([datetime.fromtimestamp(int(t) + offset, timezone.utc).strftime("%Y-%m-%d") for t in timestamps],
                    dtype=object)


@dataclass
class DrawdownEpisode:
    peak_index: int            # into the equity array (0 = before the first bar)
    trough_index: int
    recovery_index: int | None
    depth: float


def drawdown_episodes(bar_net: np.ndarray) -> tuple[np.ndarray, list[DrawdownEpisode]]:
    """(the underwater depth per equity point, every episode). Equity starts at 0
    before the first bar, as ``metrics.maximum_drawdown`` does; an episode opens when
    equity falls below its running peak and closes when equity regains that peak."""
    equity = np.concatenate([[0.0], np.cumsum(np.asarray(bar_net, dtype=np.float64))])
    peak = np.maximum.accumulate(equity)
    depth = peak - equity
    episodes: list[DrawdownEpisode] = []
    current: DrawdownEpisode | None = None
    for index in range(1, equity.size):
        if depth[index] > 0:
            if current is None:
                current = DrawdownEpisode(peak_index=index - 1, trough_index=index, recovery_index=None, depth=depth[index])
            elif depth[index] > current.depth:
                current.trough_index, current.depth = index, float(depth[index])
        elif current is not None:
            current.recovery_index = index
            episodes.append(current)
            current = None
    if current is not None:
        episodes.append(current)
    return depth, episodes


def _streak(signs: np.ndarray, target: int) -> int:
    longest = run = 0
    for value in signs:
        run = run + 1 if value == target else 0
        longest = max(longest, run)
    return longest


def _moments(values: np.ndarray) -> tuple[float, float] | None:
    """(skewness, kurtosis — not excess), bias-corrected, as ``metrics.distribution``."""
    if values.size < 4:
        return None
    from scipy.stats import kurtosis, skew

    skewness = _finite(skew(values, bias=False))
    excess = _finite(kurtosis(values, fisher=True, bias=False))
    if skewness is None or excess is None:
        return None
    return skewness, excess + 3.0


def sharpe_inference(bar_net: np.ndarray, bars_per_year: float) -> tuple[float | None, float | None, str | None]:
    """(annualized standard error of the Sharpe ratio, probabilistic Sharpe ratio
    against 0, why undefined). Bailey and Lopez de Prado (2012), eq. for PSR with the
    per-bar Sharpe and the sample skewness and (non-excess) kurtosis."""
    r = np.asarray(bar_net, dtype=np.float64)
    if r.size < 4:
        return None, None, "fewer than four bars"
    std = float(np.std(r, ddof=1))
    if std == 0.0:
        return None, None, "per-bar profit never varied"
    moments = _moments(r)
    if moments is None:
        return None, None, "skewness or kurtosis undefined"
    skewness, kurtosis = moments
    per_bar = float(np.mean(r)) / std
    inner = 1.0 - skewness * per_bar + (kurtosis - 1.0) / 4.0 * per_bar ** 2
    if inner <= 0.0:
        return None, None, "the variance term of the estimator is not positive"
    from scipy.stats import norm

    standard_error = math.sqrt(inner / (r.size - 1)) * math.sqrt(bars_per_year)
    probability = float(norm.cdf(per_bar * math.sqrt(r.size - 1) / math.sqrt(inner)))
    return _finite(standard_error), _finite(probability), None


def calibration(actual_up: np.ndarray, probability: np.ndarray) -> list[dict]:
    """Ten equal-width bins over [0, 1], assigned as ``sklearn.calibration.calibration_curve``
    does (``strategy="uniform"``): a probability on an inner edge belongs to the lower bin."""
    edges = np.linspace(0.0, 1.0, CALIBRATION_BIN_COUNT + 1)
    index = np.searchsorted(edges[1:-1], probability, side="left")
    bins = []
    for number in range(CALIBRATION_BIN_COUNT):
        mask = index == number
        count = int(mask.sum())
        mean_p = float(probability[mask].mean()) if count else None
        observed = float(actual_up[mask].mean()) if count else None
        bins.append({"bin_number": number + 1, "probability_lower": float(edges[number]),
                     "probability_upper": float(edges[number + 1]), "scored_bar_count": count,
                     "mean_probability_up": mean_p, "observed_up_fraction": observed,
                     "calibration_gap": (observed - mean_p) if count else None})
    return bins


CALIBRATION_LOGIT_CLIP = 1e-6


def calibration_regression(actual_up: np.ndarray, probability: np.ndarray) -> tuple[float | None, float | None]:
    """(slope, intercept) of Cox's calibration regression of the outcome on the log-odds of the
    forecast. The slope comes from the two-parameter fit ``y ~ sigmoid(a + b logit(p))``; the
    intercept from the fit with the slope held at 1 (``y ~ sigmoid(a + logit(p))``), which is the
    usual "calibration in the large". Probabilities are clipped to [1e-6, 1 - 1e-6] so a forecast
    of exactly 0 or 1 has a finite log-odds. Either value is None when it is undefined: one class
    only, no spread in the forecasts (slope), or a fit that does not converge (the outcomes are
    perfectly separated by the forecast)."""
    y = np.asarray(actual_up, dtype=np.float64)
    if y.size < 2 or y.min() == y.max():
        return None, None
    clipped = np.clip(np.asarray(probability, dtype=np.float64), CALIBRATION_LOGIT_CLIP, 1.0 - CALIBRATION_LOGIT_CLIP)
    z = np.log(clipped / (1.0 - clipped))

    def sigmoid(value: np.ndarray) -> np.ndarray:
        return 1.0 / (1.0 + np.exp(-np.clip(value, -700.0, 700.0)))

    intercept: float | None = 0.0
    for _ in range(100):
        fitted = sigmoid(intercept + z)
        curvature = float(np.sum(fitted * (1.0 - fitted)))
        if curvature <= 0.0:
            intercept = None
            break
        step = float(np.sum(y - fitted)) / curvature
        intercept += step
        if abs(step) < 1e-10:
            break
    else:
        intercept = None
    if intercept is not None and not math.isfinite(intercept):
        intercept = None

    slope: float | None = None
    if float(np.ptp(z)) > 1e-9:
        design = np.column_stack([np.ones_like(z), z])
        beta = np.array([0.0, 1.0])
        for _ in range(100):
            fitted = sigmoid(design @ beta)
            weight = fitted * (1.0 - fitted)
            hessian = design.T @ (design * weight[:, None])
            try:
                step = np.linalg.solve(hessian, design.T @ (y - fitted))
            except np.linalg.LinAlgError:
                break
            beta = beta + step
            if not np.all(np.isfinite(beta)) or abs(beta[1]) > 1e6:
                break
            if float(np.max(np.abs(step))) < 1e-10:
                slope = float(beta[1])
                break
    return slope, intercept


def _confidence_bucket(probability: np.ndarray) -> np.ndarray:
    """The confidence label of each probability: how far it sat from 0.5. The distance is
    rounded to 12 decimals first, so P(up) = 0.45 and 0.55 (0.0499.. and 0.0500.. in
    floating point) share a bucket and a value on an edge falls in the higher one."""
    distance = np.round(np.abs(np.asarray(probability, dtype=np.float64) - 0.5), 12)
    bucket = np.full(distance.shape, "", dtype=object)
    for (low, high), label in zip(zip(CONFIDENCE_EDGES[:-1], CONFIDENCE_EDGES[1:]), confidence_labels()):
        bucket[(distance >= low) & (distance < high)] = label
    return bucket


def confidence_labels() -> list[str]:
    return [f"{low:.2f} to {min(high, 0.5):.2f} from 0.5" for low, high in zip(CONFIDENCE_EDGES[:-1], CONFIDENCE_EDGES[1:])]


# ─── one scope ──────────────────────────────────────────────────────────────


class _Rows:
    """Collects metric rows for one table with the definition of each name attached."""

    def __init__(self, model_id: str) -> None:
        self.model_id = model_id
        self.rows: dict[str, list[dict]] = {MODEL: [], TRADING: []}

    def add(self, scope: str, fold_index: int | None, segment_kind: str, segment_value: str, name: str, value,
            sample_count: int | None, note: str | None = None) -> None:
        definition = DEFINITIONS[name]
        value = _finite(value)
        self.rows[definition.table].append({
            "model_id": self.model_id, "scope": scope, "fold_index": fold_index, "segment_kind": segment_kind,
            "segment_value": segment_value, "metric_family": definition.family, "metric_name": name,
            "metric_label": definition.label, "metric_value": value, "unit": definition.unit,
            "better": definition.better, "sample_count": None if sample_count is None else int(sample_count),
            "note": note if (note or value is None) else None, "definition": definition.definition,
            "formula": definition.formula, "metric_order": _METRIC_ORDER[name],
        })


def _undefined(value, reason: str) -> str | None:
    return reason if _finite(value) is None else None


def _score_inputs(inputs: ReportInputs, rows: np.ndarray, trade_rows: np.ndarray, fold_indices: list[int]) -> ScoreInputs:
    p = inputs.predictions
    t = inputs.trades
    score = ScoreInputs()
    score.bar_net_usd = p["bar_net_profit_usd"][rows].tolist()
    score.bar_exposed = [] if p["exposed"] is None else p["exposed"][rows].tolist()
    score.trade_nets = t["net_profit_usd"][trade_rows].tolist()
    score.total_cost_usd = float(t["cost_usd"][trade_rows].sum())
    scored = rows & p["scored"]
    score.scored_actual_up = (p["actual_direction"][scored] > 0).astype(int).tolist()
    score.scored_predicted_up = (p["predicted_direction"][scored] > 0).astype(int).tolist()
    score.scored_probability_up = p["probability_up"][scored].tolist()
    majority = []
    for fold_index in p["fold_index"][scored]:
        up = (inputs.fold_baselines.get(int(fold_index)) or {}).get("majority_class_up")
        majority.append(None if up is None else int(up))
    score.scored_majority_up = majority if majority and all(value is not None for value in majority) else []
    buy_and_hold = [(inputs.fold_baselines.get(k) or {}).get("buy_and_hold_net_profit_usd") for k in fold_indices]
    known = [value for value in buy_and_hold if value is not None]
    score.buy_and_hold_usd = float(sum(known)) if known else None
    resolved = rows & np.isfinite(p["forecast_error_points"]) & np.isfinite(p["predicted_move_points"])
    score.forecast_predicted_move_points = p["predicted_move_points"][resolved].tolist()
    score.forecast_actual_move_points = (p["predicted_move_points"][resolved] - p["forecast_error_points"][resolved]).tolist()
    return score


def _majority_class_accuracy(inputs: ReportInputs, rows: np.ndarray, fold_indices: list[int], computed) -> tuple[float | None, str | None]:
    """The engine's number when the folds recorded their majority class; else each
    fold's landed majority-class accuracy, weighted by its scored bars."""
    if computed is not None:
        return computed, None
    p = inputs.predictions
    total = weighted = 0.0
    for fold_index in fold_indices:
        value = (inputs.fold_baselines.get(fold_index) or {}).get("majority_class_accuracy")
        count = int((rows & p["scored"] & (p["fold_index"] == fold_index)).sum())
        if value is None or count == 0:
            if count:
                return None, "a fold recorded no majority class"
            continue
        weighted += float(value) * count
        total += count
    if total == 0:
        return None, "no scored bars"
    return weighted / total, "each fold's landed majority-class accuracy, weighted by its scored bars"


def _model_scope(out: _Rows, inputs: ReportInputs, scope: str, fold_index: int | None, rows: np.ndarray,
                 metrics: dict, fold_indices: list[int], extra: dict[str, list]) -> None:
    p = inputs.predictions
    scored = rows & p["scored"]
    y = (p["actual_direction"][scored] > 0).astype(np.int64)
    yhat = (p["predicted_direction"][scored] > 0).astype(np.int64)
    prob = p["probability_up"][scored].astype(np.float64)
    n = int(y.size)
    add = lambda name, value, count, note=None: out.add(scope, fold_index, "all", "all", name, value, count, note)  # noqa: E731

    processed = int(rows.sum())
    add("processed_bar_count", processed, processed)
    add("scored_bar_count", n, n)
    add("unscored_bar_count", processed - n, processed)
    add("coverage_fraction", n / processed if processed else None, processed, _undefined(n / processed if processed else None, "no processed bars"))
    gap_note = None if p["crosses_gap"] is not None else "this run recorded no gap flags (recorded before 2026-09-27)"
    add("gap_crossing_bar_count", int(p["crosses_gap"][rows].sum()) if p["crosses_gap"] is not None else None, processed, gap_note)
    add("actual_up_fraction", float(y.mean()) if n else None, n, _undefined(float(y.mean()) if n else None, "no scored bars"))
    add("predicted_up_fraction", float(yhat.mean()) if n else None, n, _undefined(float(yhat.mean()) if n else None, "no scored bars"))

    # classification: the engine's nine from its own function, then the rest
    for name in ("accuracy", "balanced_accuracy", "precision", "recall", "f1_score", "macro_f1_score", "roc_auc",
                 "log_loss", "brier_score"):
        reason = "no scored bars" if n == 0 else ("only one class among the scored bars" if name == "roc_auc" else "the denominator is zero")
        add(name, metrics.get(name), n, _undefined(metrics.get(name), reason))
    tp = int(((y == 1) & (yhat == 1)).sum())
    tn = int(((y == 0) & (yhat == 0)).sum())
    fp = int(((y == 0) & (yhat == 1)).sum())
    fn = int(((y == 1) & (yhat == 0)).sum())
    precision_down = tn / (tn + fn) if (tn + fn) else None
    recall_down = tn / (tn + fp) if (tn + fp) else None
    f1_down = 2 * tn / (2 * tn + fn + fp) if (2 * tn + fn + fp) else None
    add("precision_down", precision_down, n, _undefined(precision_down, "no bar was called down"))
    add("recall_down", recall_down, n, _undefined(recall_down, "no scored bar went down"))
    add("f1_score_down", f1_down, n, _undefined(f1_down, "no down calls and no down bars"))
    denominator = (tp + fp) * (tp + fn) * (tn + fp) * (tn + fn)
    mcc = (tp * tn - fp * fn) / math.sqrt(denominator) if denominator else None
    add("matthews_correlation_coefficient", mcc, n,
        _undefined(mcc, "a row or column of the confusion matrix is empty (one class called or present only)"))
    kappa = None
    if n:
        observed = (tp + tn) / n
        chance = ((tp + fp) * (tp + fn) + (tn + fn) * (tn + fp)) / (n * n)
        kappa = (observed - chance) / (1.0 - chance) if chance < 1.0 else None
    add("cohens_kappa", kappa, n, _undefined(kappa, "no scored bars, or chance agreement is 1"))
    average_precision = None
    if n and len(np.unique(y)) == 2:
        from sklearn.metrics import average_precision_score

        average_precision = float(average_precision_score(y, prob))
    add("average_precision", average_precision, n, _undefined(average_precision, "no scored bars or only one class"))
    for name, value in (("true_positive_count", tp), ("false_positive_count", fp), ("true_negative_count", tn),
                        ("false_negative_count", fn)):
        add(name, value, n)

    # probability and calibration
    base = float(y.mean()) if n else None
    uncertainty = base * (1.0 - base) if base is not None else None
    brier = metrics.get("brier_score")
    skill = 1.0 - brier / uncertainty if (brier is not None and uncertainty) else None
    add("brier_skill_score", skill, n, _undefined(skill, "no scored bars, or every scored bar went the same way"))
    add("mean_probability_up", float(prob.mean()) if n else None, n, _undefined(float(prob.mean()) if n else None, "no scored bars"))
    sharpness = float(np.std(prob, ddof=1)) if n >= 2 else None
    add("probability_up_sharpness", sharpness, n, _undefined(sharpness, "fewer than two scored bars"))
    balanced_loss = None
    if n and 0 < int(y.sum()) < n:
        eps = np.finfo(np.float64).eps
        clipped = np.clip(prob, eps, 1.0 - eps)
        balanced_loss = 0.5 * float(-np.log(clipped[y == 1]).mean()) + 0.5 * float(-np.log(1.0 - clipped[y == 0]).mean())
    add("class_balanced_logarithmic_loss", balanced_loss, n,
        _undefined(balanced_loss, "no scored bars, or every scored bar went the same way"))
    add("extreme_probability_bar_count", int(((prob <= 0.0) | (prob >= 1.0)).sum()), n)
    add("distinct_probability_level_count", int(np.unique(prob).size), n)
    bins = calibration(y.astype(np.float64), prob) if n else []
    filled = [b for b in bins if b["scored_bar_count"]]
    ece = sum(b["scored_bar_count"] / n * abs(b["calibration_gap"]) for b in filled) if n else None
    mce = max(abs(b["calibration_gap"]) for b in filled) if filled else None
    reliability = sum(b["scored_bar_count"] * (b["mean_probability_up"] - b["observed_up_fraction"]) ** 2 for b in filled) / n if n else None
    resolution = sum(b["scored_bar_count"] * (b["observed_up_fraction"] - base) ** 2 for b in filled) / n if n else None
    add("expected_calibration_error", ece, n, _undefined(ece, "no scored bars"))
    add("maximum_calibration_error", mce, n, _undefined(mce, "no scored bars"))
    add("brier_reliability_component", reliability, n, _undefined(reliability, "no scored bars"))
    add("brier_resolution_component", resolution, n, _undefined(resolution, "no scored bars"))
    add("brier_uncertainty_component", uncertainty, n, _undefined(uncertainty, "no scored bars"))
    slope, intercept = calibration_regression(y, prob) if n else (None, None)
    add("calibration_slope", slope, n,
        _undefined(slope, "fewer than two scored bars, only one class, every P(up) the same, or the outcomes are perfectly separated by P(up)"))
    add("calibration_intercept", intercept, n,
        _undefined(intercept, "fewer than two scored bars, only one class, or the fit did not converge"))
    for b in bins:
        extra["calibration_bins"].append({"model_id": inputs.model_id, "scope": scope, "fold_index": fold_index, **b})
    for actual, actual_label in ((1, "up"), (0, "down")):
        for predicted, predicted_label in ((1, "up"), (0, "down")):
            count = int(((y == actual) & (yhat == predicted)).sum())
            extra["confusion_matrix"].append({
                "model_id": inputs.model_id, "scope": scope, "fold_index": fold_index,
                "actual_direction": actual_label, "predicted_direction": predicted_label, "bar_count": count,
                "share_of_scored_bars": count / n if n else None})

    # baselines
    majority, majority_note = _majority_class_accuracy(inputs, rows, fold_indices, metrics.get("majority_class_accuracy"))
    add("majority_class_accuracy", majority, n, majority_note)
    add("always_up_accuracy", base, n, _undefined(base, "no scored bars"))
    accuracy = metrics.get("accuracy")
    lift = accuracy - majority if (accuracy is not None and majority is not None) else None
    add("accuracy_lift_over_majority_class", lift, n, _undefined(lift, "accuracy or the majority-class accuracy is undefined"))

    # price forecast
    resolved = rows & np.isfinite(p["forecast_error_points"]) & np.isfinite(p["predicted_move_points"])
    error = p["forecast_error_points"][resolved]
    predicted_move = p["predicted_move_points"][resolved]
    actual_move = predicted_move - error
    count = int(error.size)
    forecast_note = inputs.notes.get("price_forecast") if count == 0 else None
    add("resolved_forecast_count", count, count)
    for name in ("price_forecast_mean_absolute_error_points", "persistence_mean_absolute_error_points",
                 "price_forecast_skill", "price_forecast_root_mean_square_error_points",
                 "price_forecast_direction_accuracy"):
        add(name, metrics.get(name), count, forecast_note or _undefined(metrics.get(name), "no resolved forecasts, or every move was zero"))
    median_error = float(np.median(np.abs(error))) if count else None
    bias = float(np.mean(error)) if count else None
    correlation = None
    if count >= 2 and np.std(predicted_move) > 0 and np.std(actual_move) > 0:
        correlation = float(np.corrcoef(predicted_move, actual_move)[0, 1])
    add("price_forecast_median_absolute_error_points", median_error, count, forecast_note or _undefined(median_error, "no resolved forecasts"))
    add("price_forecast_bias_points", bias, count, forecast_note or _undefined(bias, "no resolved forecasts"))
    add("predicted_actual_move_correlation", correlation, count,
        forecast_note or _undefined(correlation, "fewer than two resolved forecasts, or a move series never varied"))
    squared_skill = None
    if count and float(np.mean(actual_move ** 2)) > 0.0:
        squared_skill = 1.0 - float(np.mean(error ** 2)) / float(np.mean(actual_move ** 2))
    add("price_forecast_squared_error_skill", squared_skill, count,
        forecast_note or _undefined(squared_skill, "no resolved forecasts, or every move was zero"))
    called = rows & np.isfinite(p["predicted_move_points"]) & (p["predicted_move_points"] != 0.0) & (p["predicted_direction"] != 0)
    called_count = int(called.sum())
    agreement = float(np.mean(np.sign(p["predicted_move_points"][called]) == p["predicted_direction"][called])) if called_count else None
    add("forecast_call_agreement_fraction", agreement, called_count,
        _undefined(agreement, "no bar had both a non-zero forecast move and a call (the model has no price forecast)"))

    # by confidence: how far P(up) sat from 0.5
    buckets = _confidence_bucket(prob) if n else np.empty(0, dtype=object)
    for label in confidence_labels():
        mask = buckets == label
        count = int(mask.sum())
        values = classification_metrics(y[mask], yhat[mask], prob[mask]) if count else {}
        seg = lambda name, value, note=None: out.add(scope, fold_index, "confidence", label, name, value, count, note)  # noqa: E731
        seg("scored_bar_count", count)
        for name in ("accuracy", "balanced_accuracy", "log_loss", "brier_score"):
            seg(name, values.get(name), _undefined(values.get(name), "no scored bars at this confidence"))
        up_share = float(y[mask].mean()) if count else None
        seg("actual_up_fraction", up_share, _undefined(up_share, "no scored bars at this confidence"))


def _trade_block(out: _Rows, scope: str, fold_index: int | None, segment_kind: str, segment_value: str,
                 trades: dict[str, np.ndarray], mask: np.ndarray, names: tuple[str, ...],
                 session_day_count: int | None = None) -> dict:
    """The trade statistics of the closed trades in ``mask``; the scoreboard's seven
    (trade count, win rate, profit factor, average trade, expectancy, sums of winners
    and losers) come from ``metrics.trade_statistics``, the function the engine uses."""
    nets = trades["net_profit_usd"][mask]
    held = trades["bars_held"][mask]
    count = int(nets.size)
    stats, _notes = trade_statistics(nets)
    wins, losses = nets[nets > 0], nets[nets < 0]
    values = {
        **stats,
        "winning_trade_count": int(wins.size),
        "losing_trade_count": int(losses.size),
        "average_win_usd": float(wins.mean()) if wins.size else None,
        "average_loss_usd": float(losses.mean()) if losses.size else None,
        "largest_win_usd": float(nets.max()) if count else None,
        "largest_loss_usd": float(nets.min()) if count else None,
        "trade_net_profit_usd": float(nets.sum()),
        "average_bars_held": float(np.nanmean(held)) if count and np.isfinite(held).any() else None,
        "average_bars_held_winners": float(np.nanmean(held[nets > 0])) if wins.size and np.isfinite(held[nets > 0]).any() else None,
        "average_bars_held_losers": float(np.nanmean(held[nets < 0])) if losses.size and np.isfinite(held[nets < 0]).any() else None,
        "longest_winning_streak_trades": _streak(np.sign(nets), 1) if count else None,
        "longest_losing_streak_trades": _streak(np.sign(nets), -1) if count else None,
        "total_cost_usd": float(trades["cost_usd"][mask].sum()),
    }
    values["payoff_ratio"] = (values["average_win_usd"] / abs(values["average_loss_usd"])
                              if values["average_win_usd"] is not None and values["average_loss_usd"] is not None else None)
    values["trades_per_session_day"] = count / session_day_count if session_day_count else None
    sqn = sharpe_ratio(nets, 1.0)
    values["system_quality_number"] = sqn * math.sqrt(count) if sqn is not None else None
    reasons = {
        "win_rate": "no closed trades", "profit_factor": "no losing trades" if count else "no closed trades",
        "payoff_ratio": "no winning or no losing trades", "expectancy_usd": "no closed trades",
        "average_trade_usd": "no closed trades", "average_win_usd": "no winning trades",
        "average_loss_usd": "no losing trades", "largest_win_usd": "no closed trades",
        "largest_loss_usd": "no closed trades", "average_bars_held": "no closed trades",
        "average_bars_held_winners": "no winning trades", "average_bars_held_losers": "no losing trades",
        "longest_winning_streak_trades": "no closed trades", "longest_losing_streak_trades": "no closed trades",
        "trades_per_session_day": "no session days", "system_quality_number": "fewer than two trades, or every trade netted the same",
    }
    for name in names:
        value = values.get(name)
        out.add(scope, fold_index, segment_kind, segment_value, name, value, count,
                _undefined(value, reasons.get(name, "undefined")))
    return values


def _trading_scope(out: _Rows, inputs: ReportInputs, scope: str, fold_index: int | None, rows: np.ndarray,
                   trade_rows: np.ndarray, metrics: dict, extra: dict[str, list]) -> None:
    p = inputs.predictions
    t = inputs.trades
    r = p["bar_net_profit_usd"][rows]
    timestamps = p["timestamp"][rows]
    days = session_days(timestamps, inputs.symbol) if r.size else np.empty(0, dtype=object)
    unique_days = sorted(set(days.tolist()))
    day_count = len(unique_days)
    bars = int(r.size)
    add = lambda name, value, count, note=None: out.add(scope, fold_index, "all", "all", name, value, count, note)  # noqa: E731

    net = metrics.get("net_profit_usd")
    cost = metrics.get("total_cost_usd")
    source = inputs.notes.get("bars_per_year", "")
    bars_note = None if source.startswith("the run table") else f"bars per year {source}"
    add("net_profit_usd", net, bars, inputs.notes.get("bar_net_profit_usd"))
    add("net_profit_before_costs_usd", (net + cost) if net is not None and cost is not None else None, bars)
    annualized = float(np.mean(r)) * inputs.bars_per_year if bars else None
    add("annualized_net_profit_usd", annualized, bars, bars_note if annualized is not None else "no bars")
    day_note = inputs.notes.get("session_day")
    add("net_profit_per_session_day_usd", net / day_count if day_count else None, day_count, day_note if day_count else "no session days")
    add("average_bar_net_profit_usd", float(np.mean(r)) if bars else None, bars, None if bars else "no bars")
    add("bar_count", bars, bars)
    add("session_day_count", day_count, day_count, day_note)

    for name, reason in (("sharpe_ratio", "fewer than two bars, or per-bar profit never varied"),
                         ("sortino_ratio", "no losing bar"), ("calmar_ratio", "no drawdown")):
        add(name, metrics.get(name), bars, _undefined(metrics.get(name), reason) or bars_note)
    standard_error, probabilistic, why = sharpe_inference(r, inputs.bars_per_year)
    add("sharpe_ratio_standard_error", standard_error, bars, why)
    add("probabilistic_sharpe_ratio", probabilistic, bars, why)
    day_net = np.array([float(r[days == day].sum()) for day in unique_days]) if day_count else np.empty(0)
    day_sharpe = sharpe_ratio(day_net, SESSION_DAYS_PER_YEAR) if day_count >= 2 else None
    add("session_day_sharpe_ratio", day_sharpe, day_count,
        _undefined(day_sharpe, "fewer than two session days, or every day netted the same") or day_note)
    tail = None
    if bars:
        low = float(np.percentile(r, 5))
        tail = abs(float(np.percentile(r, 95))) / abs(low) if low != 0 else None
    add("tail_ratio", tail, bars, _undefined(tail, "the 5th-percentile bar is zero"))
    profit_factor = metrics.get("profit_factor")
    common = profit_factor * tail if (profit_factor is not None and tail is not None) else None
    add("common_sense_ratio", common, bars, _undefined(common, "profit factor or tail ratio is undefined"))
    drawdown = maximum_drawdown(r)
    recovery_factor = net / drawdown if (net is not None and drawdown > 0) else None
    add("recovery_factor", recovery_factor, bars, _undefined(recovery_factor, "no drawdown"))

    depth, episodes = drawdown_episodes(r)
    add("maximum_drawdown_usd", metrics.get("maximum_drawdown_usd"), bars)
    stamp = lambda index: int(timestamps[min(max(index - 1, 0), bars - 1)])  # noqa: E731  equity index -> bar time
    longest = max(episodes, key=lambda e: ((e.recovery_index or bars) - e.peak_index), default=None)
    deepest = max(episodes, key=lambda e: e.depth, default=None)
    longest_bars = ((longest.recovery_index or bars) - longest.peak_index) if longest else None
    # longest in calendar days over every episode (a few bars across a weekend can outlast the longest in bars)
    longest_days = max(((stamp(e.recovery_index if e.recovery_index is not None else bars) - stamp(e.peak_index)) / 86400.0
                        for e in episodes), default=None)
    recovery_bars = (deepest.recovery_index - deepest.trough_index) if deepest and deepest.recovery_index is not None else None
    add("maximum_drawdown_duration_bars", longest_bars, bars, None if longest else "no drawdown")
    add("maximum_drawdown_duration_days", longest_days, bars, None if longest else "no drawdown")
    add("maximum_drawdown_recovery_bars", recovery_bars, bars,
        None if recovery_bars is not None else ("no drawdown" if deepest is None else "the scope ended before the equity regained its peak"))
    underwater = depth[1:][depth[1:] > 0]
    add("average_drawdown_usd", float(underwater.mean()) if underwater.size else None, bars,
        None if underwater.size else "the equity never fell below a peak")
    add("ulcer_index_usd", float(math.sqrt(np.mean(depth[1:] ** 2))) if bars else None, bars, None if bars else "no bars")
    add("drawdown_count", len(episodes), bars)
    ranks = {id(episode): rank for rank, episode in enumerate(sorted(episodes, key=lambda e: -e.depth), 1)}
    for number, episode in enumerate(episodes, 1):
        recovered = episode.recovery_index is not None
        end = episode.recovery_index if recovered else bars
        extra["drawdowns"].append({
            "model_id": inputs.model_id, "scope": scope, "fold_index": fold_index, "drawdown_number": number,
            "depth_rank": ranks[id(episode)], "peak_timestamp": stamp(episode.peak_index),
            "trough_timestamp": stamp(episode.trough_index),
            "recovery_timestamp": stamp(episode.recovery_index) if recovered else None,
            "depth_usd": float(episode.depth), "bars_to_trough": episode.trough_index - episode.peak_index,
            "bars_to_recovery": (episode.recovery_index - episode.trough_index) if recovered else None,
            "underwater_bars": end - episode.peak_index,
            "underwater_days": (stamp(end) - stamp(episode.peak_index)) / 86400.0, "recovered": recovered,
        })

    # trades
    _trade_block(out, scope, fold_index, "all", "all", t, trade_rows, _ALL_TRADE_METRICS, session_day_count=day_count)

    # exposure
    exposed = p["exposed"]
    held = p["position_held"]
    exposure_note = inputs.notes.get("exposed")
    add("exposure_fraction", metrics.get("exposure_fraction"), bars, exposure_note if exposed is None else None)
    for name, test in (("long_exposure_fraction", lambda h: h > 0), ("short_exposure_fraction", lambda h: h < 0),
                       ("flat_fraction", lambda h: h == 0)):
        value = float(test(held[rows]).mean()) if (held is not None and bars) else None
        add(name, value, bars, inputs.notes.get("position_held") if held is None else None)

    # costs
    count = int(trade_rows.sum())
    contracts = t["contracts"][trade_rows]
    per_side = t["cost_usd"][trade_rows] / (2.0 * np.maximum(contracts, 1))
    cost_per_side = float(np.median(per_side)) if count else None
    before = (net + cost) if net is not None and cost is not None else None
    add("total_cost_usd", cost, bars)
    add("cost_per_trade_usd", cost / count if count and cost is not None else None, count, None if count else "no closed trades")
    add("cost_per_contract_per_side_usd", cost_per_side, count, None if count else "no closed trades")
    share = cost / before if (before is not None and before > 0) else None
    add("cost_share_of_net_profit_before_costs", share, count, _undefined(share, "the calls earned nothing before costs"))
    sides = 2.0 * float(contracts.sum()) if count else 0.0
    break_even = cost_per_side + net / sides if (cost_per_side is not None and sides and net is not None) else None
    add("break_even_cost_per_contract_per_side_usd", break_even, count, _undefined(break_even, "no closed trades"))

    # baseline
    buy_and_hold = metrics.get("buy_and_hold_net_profit_usd")
    add("buy_and_hold_net_profit_usd", buy_and_hold, bars, _undefined(buy_and_hold, "no fold recorded a buy-and-hold figure"))
    excess = net - buy_and_hold if (net is not None and buy_and_hold is not None) else None
    add("net_profit_minus_buy_and_hold_usd", excess, bars, _undefined(excess, "buy and hold is undefined"))

    # trade segments
    for side in ("long", "short"):
        _trade_block(out, scope, fold_index, "side", side, t, trade_rows & (t["side"] == side), _SEGMENT_TRADE_METRICS)
    for reason in sorted(set(t["exit_reason"][trade_rows].tolist())):
        _trade_block(out, scope, fold_index, "exit_reason", reason.replace("_", " "), t,
                     trade_rows & (t["exit_reason"] == reason), _SEGMENT_TRADE_METRICS)
    entry_bucket = _confidence_bucket(np.nan_to_num(t["probability_up_at_entry"], nan=0.5))
    for label in confidence_labels():
        _trade_block(out, scope, fold_index, "entry_confidence", label, t, trade_rows & (entry_bucket == label),
                     _SEGMENT_TRADE_METRICS)

    # distributions
    def summarize(name: str, label: str, unit: str, segment: str, values: np.ndarray) -> None:
        values = np.asarray(values, dtype=np.float64)
        values = values[np.isfinite(values)]
        summary = distribution(values)
        extra["distributions"].append({
            "model_id": inputs.model_id, "scope": scope, "fold_index": fold_index, "quantity_name": name,
            "quantity_label": label, "unit": unit, "segment_value": segment, "count": summary["count"],
            "mean": summary["mean"], "median": summary["median"], "standard_deviation": summary["standardDeviation"],
            "skewness": summary["skewness"], "kurtosis": summary["kurtosis"], "percentile_25": summary["percentile25"],
            "percentile_75": summary["percentile75"], "minimum": summary["minimum"], "maximum": summary["maximum"],
        })

    nets = t["net_profit_usd"][trade_rows]
    sides_of = t["side"][trade_rows]
    held_of = t["bars_held"][trade_rows]
    summarize("trade_net_profit_usd", "Trade net profit", "usd", "all trades", nets)
    summarize("trade_net_profit_usd", "Trade net profit", "usd", "long trades", nets[sides_of == "long"])
    summarize("trade_net_profit_usd", "Trade net profit", "usd", "short trades", nets[sides_of == "short"])
    summarize("trade_net_profit_usd", "Trade net profit", "usd", "winning trades", nets[nets > 0])
    summarize("trade_net_profit_usd", "Trade net profit", "usd", "losing trades", nets[nets < 0])
    summarize("trade_bars_held", "Bars a trade was held", "bars", "all trades", held_of)
    summarize("trade_bars_held", "Bars a trade was held", "bars", "winning trades", held_of[nets > 0])
    summarize("trade_bars_held", "Bars a trade was held", "bars", "losing trades", held_of[nets < 0])
    summarize("bar_net_profit_usd", "Bar net profit", "usd", "all bars", r)
    if exposed is not None:
        summarize("bar_net_profit_usd", "Bar net profit", "usd", "bars in a position", r[exposed[rows]])
    summarize("session_day_net_profit_usd", "Session-day net profit", "usd", "all session days", day_net)
    summarize("drawdown_depth_usd", "Drawdown depth", "usd", "all drawdowns", np.array([e.depth for e in episodes]))
    scored = rows & p["scored"]
    probability = p["probability_up"][scored]
    went_up = p["actual_direction"][scored] > 0
    summarize("probability_up", "P(up)", "probability", "scored bars", probability)
    summarize("probability_up", "P(up)", "probability", "bars that went up", probability[went_up])
    summarize("probability_up", "P(up)", "probability", "bars that went down", probability[~went_up])
    error = p["forecast_error_points"][rows]
    summarize("price_forecast_error_points", "Price forecast error", "points", "resolved forecasts", error)

    if scope == "run":
        _daily(inputs, rows, trade_rows, days, extra)


def _daily(inputs: ReportInputs, rows: np.ndarray, trade_rows: np.ndarray, days: np.ndarray, extra: dict[str, list]) -> None:
    p = inputs.predictions
    t = inputs.trades
    r = p["bar_net_profit_usd"][rows]
    folds = p["fold_index"][rows]
    exposed = p["exposed"][rows] if p["exposed"] is not None else None
    scored = p["scored"][rows]
    correct = scored & ((p["actual_direction"][rows] > 0) == (p["predicted_direction"][rows] > 0))
    trade_days = session_days(t["exit_timestamp"][trade_rows], inputs.symbol) if trade_rows.any() else np.empty(0, dtype=object)
    trade_nets = t["net_profit_usd"][trade_rows]
    trade_costs = t["cost_usd"][trade_rows]
    cumulative = 0.0
    for day in sorted(set(days.tolist())):
        mask = days == day
        day_net = float(r[mask].sum())
        cumulative += day_net
        values, counts = np.unique(folds[mask], return_counts=True)
        closed = trade_days == day
        scored_count = int(scored[mask].sum())
        extra["daily_results"].append({
            "model_id": inputs.model_id, "session_day": day, "fold_index": int(values[np.argmax(counts)]),
            "bar_count": int(mask.sum()), "exposed_bar_count": int(exposed[mask].sum()) if exposed is not None else None,
            "net_profit_usd": day_net, "cumulative_net_profit_usd": cumulative,
            "intraday_maximum_drawdown_usd": maximum_drawdown(r[mask]),
            "trade_count": int(closed.sum()), "winning_trade_count": int((trade_nets[closed] > 0).sum()),
            "trade_net_profit_usd": float(trade_nets[closed].sum()), "total_cost_usd": float(trade_costs[closed].sum()),
            "scored_bar_count": scored_count, "correct_bar_count": int(correct[mask].sum()),
            "accuracy": int(correct[mask].sum()) / scored_count if scored_count else None,
            "session_day_rule": session_day_rule(inputs.symbol),
        })


# ─── the report ─────────────────────────────────────────────────────────────


def _table(rows: list[dict], columns) -> pa.Table:
    schema = pa.schema([pa.field(name, kind) for name, kind in columns])
    clean = lambda value: None if isinstance(value, float) and not math.isfinite(value) else value  # noqa: E731
    return pa.Table.from_pydict({name: [clean(row.get(name)) for row in rows] for name, _ in columns}, schema=schema)


def build_report(inputs: ReportInputs) -> dict[str, pa.Table]:
    """The seven report tables for a run (see the module docstring)."""
    out = _Rows(inputs.model_id)
    extra: dict[str, list] = {name: [] for name in ("calibration_bins", "confusion_matrix", "distributions",
                                                     "drawdowns", "daily_results")}
    p = inputs.predictions
    t = inputs.trades
    everything = np.ones(p["timestamp"].shape[0], dtype=bool)
    all_trades = np.ones(t["net_profit_usd"].shape[0], dtype=bool)
    scopes = [("run", None, everything, all_trades, list(inputs.fold_indices))]
    for fold_index in inputs.fold_indices:
        rows = p["fold_index"] == fold_index
        if rows.any():
            scopes.append(("fold", fold_index, rows, t["fold_index"] == fold_index, [fold_index]))
    for scope, fold_index, rows, trade_rows, fold_indices in scopes:
        metrics, _distribution, _notes = scoreboard(_score_inputs(inputs, rows, trade_rows, fold_indices), inputs.bars_per_year)
        _model_scope(out, inputs, scope, fold_index, rows, metrics, fold_indices, extra)
        _trading_scope(out, inputs, scope, fold_index, rows, trade_rows, metrics, extra)
    tables = {MODEL: _table(out.rows[MODEL], METRIC_ROW_COLUMNS), TRADING: _table(out.rows[TRADING], METRIC_ROW_COLUMNS)}
    for name, rows in extra.items():
        tables[name] = _table(rows, REPORT_COLUMNS[name])
    return tables


def scoreboard_values(tables: dict[str, pa.Table], scope: str, fold_index: int | None) -> dict[str, float | None]:
    """The thirty scoreboard metrics as the report carries them for one scope (segment
    ``all``): what the parity test holds equal to the engine's own scoreboards."""
    out: dict[str, float | None] = {}
    for table_name in (MODEL, TRADING):
        for row in tables[table_name].to_pylist():
            if (row["scope"], row["fold_index"], row["segment_kind"]) == (scope, fold_index, "all") and row["metric_name"] in METRIC_NAMES:
                out[row["metric_name"]] = row["metric_value"]
    return out
