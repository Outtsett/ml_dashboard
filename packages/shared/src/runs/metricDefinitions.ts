/**
 * How every Model Cycle scoreboard metric is computed, in plain words with the
 * formula, read from the engine source (packages/ml-engine/src/cycle/metrics.py,
 * simulate.py) and verified against it on 2026-10-07. Shown wherever the number
 * is shown (hover, legend, caption): the inputs, the formula, the units, what is
 * excluded. The engine is the one definition; this is its description.
 */

export interface MetricDefinition {
  /** The computation in one or two plain sentences, with the file:line it comes from. */
  how: string;
  /** The formula in compact notation. */
  formula: string;
}

export const METRIC_DEFINITIONS: Record<string, MetricDefinition> = {
  net_profit_usd: {
    how: `Sum of the per-bar marked-to-market USD results over EVERY walked test bar (flat bars contribute 0, not only scored bars). Each bar books the open-to-close (or reference-to-close) mark of the held position, and the per-side cost is subtracted on the bar where an entry or exit fills, so costs are already inside it. A fold's last bar is force-flattened at its close (fold_end). Zero bars returns 0.0, zero trades returns 0 (nothing was marked). In the running scoreboard it also includes the mark of a still-open trade and its entry fill cost; at fold end and final it equals the sum of closed-trade net profits. (metrics.py:327; simulate.py:308-359; engine.py:1476-1487)`,
    formula: `Σ over walked test bars of bar_net_usd[t]; bar_net_usd[t] = position × (close[t] − reference) × point_value × contracts − fill_cost on each fill that bar`,
  },
  sharpe_ratio: {
    how: `Computed on the per-bar net USD series r (dollars per bar, costs included, flat bars as 0) over all walked test bars, not on percentage returns and not on trades. std uses sample ddof=1; there is no risk-free rate subtracted. barsPerYear = bar count / (covered calendar days / 365.25) measured on the loaded data, where weekends and holidays stay in the span but any gap over 4 days (OUTAGE_DAYS) is removed. Returns null (None) if fewer than 2 bars or std is 0, which includes a run with zero trades (all-zero series). (metrics.py:117-124, 92-111; engine.py:456)`,
    formula: `mean(r) / std(r, ddof=1) × √barsPerYear, with r = per-bar net USD`,
  },
  sortino_ratio: {
    how: `Same per-bar net USD series and the same barsPerYear as Sharpe. The denominator is downside deviation against a target of 0: the root of the mean over ALL bars (not only losing bars) of min(r,0) squared. Returns null if there is no bar with r < 0, so a zero-trade run is null. (metrics.py:127-132)`,
    formula: `mean(r) / √mean(min(r, 0)²) × √barsPerYear`,
  },
  calmar_ratio: {
    how: `Annualised mean per-bar net USD (mean(r) times barsPerYear, an arithmetic dollar-per-year figure) divided by maximum_drawdown_usd, with the same r and barsPerYear as Sharpe. Returns null if there are no bars or the drawdown is 0, so a zero-trade run is null. Units are annual USD over USD drawdown, not a percentage CAGR. (metrics.py:144-151)`,
    formula: `mean(r) × barsPerYear / maximum_drawdown_usd`,
  },
  maximum_drawdown_usd: {
    how: `Equity curve is the cumulative sum of per-bar net USD over all walked test bars, starting at 0 (the start counts as a peak). The drawdown is the largest peak-to-trough fall in dollars, reported as a positive number. Bar-level and marked to market, so intra-trade swings count, not just closed-trade results. No bars or no trades gives 0.0. (metrics.py:135-141)`,
    formula: `max over t of (running peak of E[t] − E[t]), E = cumsum(r) with E[0] = 0`,
  },
  profit_factor: {
    how: `From closed trades' net USD (after costs): sum of trades with net > 0 divided by the absolute sum of trades with net < 0. Break-even trades (net == 0) are in neither sum. Returns null with a note when there are zero closed trades or no losing trade (no division by zero); the scoreboard also warns when fewer than 30 closed trades. (metrics.py:154-172)`,
    formula: `gross_profit_usd / |gross_loss_usd|`,
  },
  win_rate: {
    how: `Share of closed trades whose net USD after both fills' costs is strictly greater than 0. Break-evens count as non-wins but stay in the denominator. This is a trade-level figure, unrelated to the bar-level accuracy. Zero closed trades gives null. (metrics.py:172)`,
    formula: `count(closed trades with net_usd > 0) / trade_count`,
  },
  trade_count: {
    how: `Number of trades closed within the scope (a fold, or the whole run), counted by exit, taken from simulator.closed_trades filtered to the fold for fold scope. A trade still open mid-run is not counted; a fold's last bar force-closes its trade at that close, so it is counted at fold end. Each reversal is a close plus a new open. Zero trades returns 0. (metrics.py:159,183; engine.py:1560, 1686)`,
    formula: `count of closed trades`,
  },
  average_trade_usd: {
    how: `Arithmetic mean of closed trades' net profit in USD, each net = gross points × side × point_value × contracts − 2 × cost_per_side × contracts. Equals net_profit_usd / trade_count once all trades are closed. Zero trades gives null. (metrics.py:184; simulate.py:269-271)`,
    formula: `mean(net_profit_usd of closed trades) = Σ trade net / trade_count`,
  },
  expectancy_usd: {
    how: `From closed trades' net USD (after both fills' costs): average_win is the mean of trades with net > 0, average_loss is the mean of trades with net < 0 only (break-evens excluded from that mean), and a missing side contributes 0. The loss term is weighted by (1 − win_rate), which is the share of ALL non-winning trades, break-evens included. So every break-even trade is charged at the average loss, not at zero. With no break-evens this equals average_trade_usd exactly. With k break-evens among n trades, expectancy_usd is lower than average_trade_usd by (k/n) × |average_loss|. It is a different quantity from average_trade_usd, not a rounding variant. Zero closed trades gives null. (metrics.py:173-178; the code is \`win_rate*average_win - (1-win_rate)*abs(average_loss)\`.)`,
    formula: `win_rate × average_win − (1 − win_rate) × |average_loss|, where win_rate = count(net > 0) / trade_count, average_win = mean(net | net > 0), average_loss = mean(net | net < 0). The (1 − win_rate) weight = (losers + break-evens) / trade_count, so break-evens carry the average loss.`,
  },
  exposure_fraction: {
    how: `Fraction of ALL walked test bars (not only scored bars) in which a position was held at any point in the bar: carried in from the previous close, or opened at that bar's open. A bar where the position was closed at the open still counts as exposed. Zero bars gives null; a zero-trade run gives 0.0. (simulate.py:339; metrics.py:334)`,
    formula: `mean over walked test bars of [held_before ≠ 0 or position_after_fill ≠ 0]`,
  },
  gross_profit_usd: {
    how: `Sum of winning closed trades' net USD, which is AFTER costs (each winner's gross minus its round-trip cost), so it is a net-of-cost figure despite the name. Zero trades or no winners gives 0.0. (metrics.py:157-160, 186)`,
    formula: `Σ net_usd over closed trades with net_usd > 0`,
  },
  gross_loss_usd: {
    how: `Sum of losing closed trades' net USD after costs, returned negative (profit_factor takes its absolute value). A trade whose price move was a small gain but is eaten by costs lands here. Zero trades or no losers gives 0.0. (metrics.py:158-161, 187)`,
    formula: `Σ net_usd over closed trades with net_usd < 0 (a negative number)`,
  },
  total_cost_usd: {
    how: `Round-trip cost = 2 fills × total_per_side from packages/config/cost_model.json for the root symbol × contracts. Fold scope sums cost_usd of the fold's closed trades. The running scoreboard instead uses the simulator's cumulative fill costs, so it already includes the entry fill of a still-open trade; a fold or final scope with every trade closed gives the same number. A symbol absent from cost_model.json raises an error rather than reporting without costs. (simulate.py:238-239, 258, 270, 277, 107-124; engine.py:1561, 1687)`,
    formula: `Σ over closed trades of 2 × cost_per_side × contracts`,
  },
  accuracy: {
    how: `Direction hit rate over SCORED bars only. A bar is scored when its label has resolved (horizon bars later was walked), it does not cross a session gap (over label_gap_multiple × typical bar interval), the realised move close[t+h] − close[t] is outside ±label_threshold_ticks × tick_size (inside the threshold means actual 0, unscored), and the model produced a prediction (predicted ≠ 0). Prediction is up if probability_up ≥ 0.5, else down. Pooled across folds for the run score. No scored bars gives null with a note. (metrics.py:236; engine.py:1453, 1520-1538; labels.py:91-99)`,
    formula: `mean(predicted_up == actual_up) over scored bars`,
  },
  balanced_accuracy: {
    how: `Scored bars only (label known: horizon did not cross a session gap, |move over horizon| > label_threshold_ticks*tick_size, and a finite model probability; predicted class = up if P(up) >= 0.5 else down). Average of per-class recall for classes that actually occur; a class with zero support is skipped, so with one class it equals accuracy. Pooled over all folds' scored bars in the final scope (not a mean of fold values); None when no bar is scored. metrics.py:236-243; scored bars appended engine.py:1523-1538.`,
    formula: `(1/K) * sum over classes c present in actual of [ count(actual=c AND predicted=c) / count(actual=c) ], K = classes present (1 or 2)`,
  },
  precision: {
    how: `Over scored bars, TP = actual up and predicted up, FP = actual down and predicted up. None (not 0) when the model never predicted up (TP+FP = 0). Trades, costs and annualisation play no part. metrics.py:245-248.`,
    formula: `TP / (TP + FP), positive class = up`,
  },
  recall: {
    how: `Over scored bars, FN = actual up and predicted down. None when no scored bar was actually up. Positive class is up; down-class recall only enters balanced_accuracy. metrics.py:245-249.`,
    formula: `TP / (TP + FN), positive class = up`,
  },
  f1_score: {
    how: `F1 of the up class over scored bars (harmonic mean of precision and recall, written in count form). None when the denominator is 0 (no actual-up and no predicted-up bars). metrics.py:250.`,
    formula: `2*TP / (2*TP + FP + FN), positive class = up`,
  },
  macro_f1_score: {
    how: `Unweighted mean of the per-class F1 for up and down over scored bars, taking every class that appears in either actual or predicted. Each class F1 treats that class as positive. Pooled over folds; None when no scored bars. metrics.py:252-258.`,
    formula: `(1/K) * sum over c in {classes in actual or predicted} of 2*TP_c / (2*TP_c + FP_c + FN_c)`,
  },
  roc_auc: {
    how: `sklearn roc_auc_score of the scored bars' actual-up labels against the model's raw probability of up (the continuous P(up), not the 0.5-thresholded class), pooled over folds. None when scored bars contain only one class. metrics.py:260-265.`,
    formula: `AUC = P(P(up | actual up bar) > P(up | actual down bar)), ties count half (sklearn roc_auc_score)`,
  },
  log_loss: {
    how: `Binary cross-entropy of P(up) against actual up (1/0) over the N scored bars, natural log, pooled over folds, lower is better. Written by hand in numpy with clipping at machine epsilon (about 2.2e-16). metrics.py:266-268.`,
    formula: `-(1/N) * sum_i [ y_i*ln(p_i) + (1-y_i)*ln(1-p_i) ], p_i clipped to [eps, 1-eps], eps = float64 machine epsilon`,
  },
  brier_score: {
    how: `Mean squared difference between P(up) and the actual up indicator (1/0) over the N scored bars, pooled over folds; 0 is perfect, an always-0.5 model scores 0.25. metrics.py:269.`,
    formula: `(1/N) * sum_i (p_i - y_i)^2`,
  },
  majority_class_accuracy: {
    how: `Baseline that predicts every scored bar as its own fold's training-window majority class (up if the training up-share is >= 0.5, ties go to up). Compared to the actual up/down of the same scored bars that accuracy uses, so it is directly comparable to accuracy; pooled across folds in the final scope. None with no scored bars. engine.py:716 (fold majority), engine.py:1538 (appended per scored bar), metrics.py:342-347.`,
    formula: `(1/N) * sum_i [ m_f(i) == y_i ], m_f = 1 if mean(training labels of fold f) >= 0.5 else 0`,
  },
  buy_and_hold_net_profit_usd: {
    how: `Per fold, take the open of the first walked test bar and the close of the last walked test bar, hold long the configured contracts, and subtract one round trip (two sides of total_per_side from cost_model.json, the same per-side fee model the simulator charges) per contract. The final scope sums the folds; it is not an equity-curve metric and has no annualisation. None if no bar was walked. metrics.py:364-365; first_open/last_close engine.py:1489-1491; cost simulate.py:48-49, engine.py:1580.`,
    formula: `sum over folds f of [ (last_close_f - first_open_f) * point_value * contracts - round_trip_cost * contracts ], round_trip_cost = 2 * total_per_side`,
  },
  price_forecast_mean_absolute_error_points: {
    how: `Over resolved forecasts only: the price model forecast at bar t (output times causal trailing volatility scale, rounded to a tradable tick) and bar t+h (h = label horizon) has been walked. Bars whose horizon crosses a session gap, have no feature history, or a non-finite output draw no forecast and are skipped. The label threshold does NOT filter these bars (every resolved forecast counts, including near-zero moves). Units: points; pooled over folds. None when nothing has resolved. metrics.py:276-299; engine.py:1331-1343, 1455-1472.`,
    formula: `MAE = mean( | predicted_move_i - actual_move_i | ), actual_move_i = close[t+h] - close[t]`,
  },
  persistence_mean_absolute_error_points: {
    how: `Mean absolute actual h-bar move in points on exactly the same resolved-forecast bars as the price-forecast MAE, which equals the error of always predicting zero move. It is the yardstick the skill score divides by. metrics.py:289.`,
    formula: `mean( | actual_move_i | ), i.e. MAE of the no-change forecast (predicted close = this close)`,
  },
  price_forecast_skill: {
    how: `One minus the price model's MAE over the no-change MAE on the same resolved bars. Above 0 beats predicting no change, 0 equals it, negative is worse. None if persistence MAE is 0 (every resolved move was zero) or nothing resolved. metrics.py:294.`,
    formula: `1 - MAE_forecast / MAE_persistence`,
  },
  price_forecast_root_mean_square_error_points: {
    how: `Root mean squared error in points between the tick-rounded predicted move and the actual h-bar close-to-close move over resolved forecasts, pooled over folds; penalises large misses more than MAE. None when nothing has resolved. metrics.py:295.`,
    formula: `RMSE = sqrt( mean( (predicted_move_i - actual_move_i)^2 ) )`,
  },
  price_forecast_direction_accuracy: {
    how: `Share of resolved forecasts whose predicted sign matches the actual move sign, excluding bars where either the predicted (after tick rounding) or the actual move is exactly zero. Unlike accuracy it uses no label threshold, and it uses the price model's sign, not the classifier's P(up). None if no bar has both non-zero. metrics.py:290-298.`,
    formula: `mean( sign(predicted_move_i) == sign(actual_move_i) ) over bars where predicted_move_i != 0 and actual_move_i != 0`,
  },
};

export function metricDefinition(name: string): MetricDefinition | null {
  return METRIC_DEFINITIONS[name] ?? null;
}
