/**
 * Plain-words definitions for every name in `CYCLE_METRIC_NAMES`
 * (`@shared/cycle/schema`) — what the Scoreboard tile's info tooltip shows,
 * what format kind renders its value, and which direction is good.
 *
 * `formatKind` picks the `format.ts` function: "usd" -> `formatUsd`,
 * "ratio" -> `formatRatio`, "percent" -> `formatPercent`, "count" -> `formatCount`.
 */
import { CYCLE_METRIC_NAMES, type CycleMetricName } from "@shared/cycle/schema";

export type MetricFormatKind = "usd" | "ratio" | "percent" | "count";
export type MetricDirection = "higher" | "lower" | "closer_to_zero";

export interface MetricDefinition {
  label: string;
  definition: string;
  formula: string;
  unit: string;
  better: MetricDirection;
  formatKind: MetricFormatKind;
  /** Shown in the tile's tooltip in place of a value when the metric is null. */
  nullReason: string;
}

export const METRIC_DEFINITIONS: Record<CycleMetricName, MetricDefinition> = {
  net_profit_usd: {
    label: "Net profit",
    definition: "The total money the run made or lost, after trading costs, across every closed trade.",
    formula: "sum of every closed trade's net profit",
    unit: "US dollars",
    better: "higher",
    formatKind: "usd",
    nullReason: "no trade has closed yet",
  },
  sharpe_ratio: {
    label: "Sharpe ratio",
    definition:
      "Return per unit of risk: the average bar-by-bar return divided by how much that return bounces around, scaled up to a yearly number.",
    formula: "(mean of per-bar returns ÷ standard deviation of per-bar returns) × √(bars per year)",
    unit: "unitless ratio",
    better: "higher",
    formatKind: "ratio",
    nullReason: "fewer than two bars of marked-to-market returns exist yet",
  },
  sortino_ratio: {
    label: "Sortino ratio",
    definition: "The same idea as Sharpe, but it only penalizes downside moves — an upside swing never counts against it.",
    formula: "(mean of per-bar returns ÷ standard deviation of the NEGATIVE per-bar returns only) × √(bars per year)",
    unit: "unitless ratio",
    better: "higher",
    formatKind: "ratio",
    nullReason: "no downside (losing) bars have occurred yet, so there is nothing to divide by",
  },
  calmar_ratio: {
    label: "Calmar ratio",
    definition: "Yearly return compared with the worst peak-to-trough loss the equity curve has taken.",
    formula: "annualized net profit ÷ maximum drawdown",
    unit: "unitless ratio",
    better: "higher",
    formatKind: "ratio",
    nullReason: "no drawdown has occurred yet, so there is nothing to divide by",
  },
  maximum_drawdown_usd: {
    label: "Maximum drawdown",
    definition: "The largest drop, in dollars, from a peak in the equity curve to a later low, before a new peak was made.",
    formula: "max over time of (running peak equity − equity at that time)",
    unit: "US dollars",
    better: "lower",
    formatKind: "usd",
    nullReason: "the equity curve has not moved below its starting peak yet",
  },
  profit_factor: {
    label: "Profit factor",
    definition: "How many dollars the winning trades made for every dollar the losing trades cost.",
    formula: "total gross profit of winning trades ÷ total gross loss of losing trades",
    unit: "unitless ratio",
    better: "higher",
    formatKind: "ratio",
    nullReason: "no losing trade has closed yet, so the ratio has no denominator",
  },
  win_rate: {
    label: "Win rate",
    definition: "The share of closed trades that made money.",
    formula: "count of winning trades ÷ count of all closed trades",
    unit: "percent of trades",
    better: "higher",
    formatKind: "percent",
    nullReason: "no trade has closed yet",
  },
  trade_count: {
    label: "Trade count",
    definition: "How many trades have closed so far. Not itself good or bad — context for every other trading metric.",
    formula: "count of closed trades",
    unit: "trades",
    better: "higher",
    formatKind: "count",
    nullReason: "no trade has closed yet",
  },
  average_trade_usd: {
    label: "Average trade",
    definition: "The typical net profit of one closed trade.",
    formula: "net profit ÷ trade count",
    unit: "US dollars per trade",
    better: "higher",
    formatKind: "usd",
    nullReason: "no trade has closed yet",
  },
  expectancy_usd: {
    label: "Expectancy",
    definition: "The dollar amount a trade is expected to make, blending how often it wins with how much it wins or loses by.",
    formula: "(win rate × average winning trade) − ((1 − win rate) × average losing trade)",
    unit: "US dollars per trade",
    better: "higher",
    formatKind: "usd",
    nullReason: "no trade has closed yet",
  },
  exposure_fraction: {
    label: "Exposure",
    definition: "The share of test bars during which the model held an open position, long or short.",
    formula: "count of bars with a non-flat position ÷ count of test bars walked",
    unit: "percent of bars",
    better: "closer_to_zero",
    formatKind: "percent",
    nullReason: "no test bars have been walked yet",
  },
  gross_profit_usd: {
    label: "Gross profit",
    definition: "The total money made by winning trades alone, before netting off the losers.",
    formula: "sum of net profit over trades with net profit > 0",
    unit: "US dollars",
    better: "higher",
    formatKind: "usd",
    nullReason: "no winning trade has closed yet",
  },
  gross_loss_usd: {
    label: "Gross loss",
    definition: "The total money lost by losing trades alone, before netting off the winners. Shown as a negative amount.",
    formula: "sum of net profit over trades with net profit < 0",
    unit: "US dollars",
    better: "higher",
    formatKind: "usd",
    nullReason: "no losing trade has closed yet",
  },
  total_cost_usd: {
    label: "Total cost",
    definition: "Every dollar paid in trading costs (the MNQ cost model's per-side cost, both legs of every trade).",
    formula: "sum over every fill of the cost model's cost-per-side",
    unit: "US dollars",
    better: "lower",
    formatKind: "usd",
    nullReason: "no trade has closed yet",
  },
  accuracy: {
    label: "Accuracy",
    definition: "The share of scored test bars where the predicted direction matched the actual direction.",
    formula: "count of correct predictions ÷ count of scored predictions",
    unit: "percent of scored bars",
    better: "higher",
    formatKind: "percent",
    nullReason: "no test bar has a resolved (known) label yet",
  },
  balanced_accuracy: {
    label: "Balanced accuracy",
    definition: "Accuracy adjusted so a model that only ever predicts the majority direction doesn't look artificially strong.",
    formula: "average of (recall on up-moves) and (recall on down-moves)",
    unit: "percent",
    better: "higher",
    formatKind: "percent",
    nullReason: "no test bar has a resolved (known) label yet",
  },
  precision: {
    label: "Precision",
    definition: "Of every bar the model predicted \"up\", the share that actually went up.",
    formula: "true positives ÷ (true positives + false positives)",
    unit: "percent of predicted-up bars",
    better: "higher",
    formatKind: "percent",
    nullReason: "the model has not predicted \"up\" on any scored bar yet",
  },
  recall: {
    label: "Recall",
    definition: "Of every bar that actually went up, the share the model caught by predicting \"up\".",
    formula: "true positives ÷ (true positives + false negatives)",
    unit: "percent of actual-up bars",
    better: "higher",
    formatKind: "percent",
    nullReason: "no bar actually went up yet among the scored bars",
  },
  f1_score: {
    label: "F1 score",
    definition: "A single number balancing precision and recall — low if either one is low.",
    formula: "2 × (precision × recall) ÷ (precision + recall)",
    unit: "percent",
    better: "higher",
    formatKind: "percent",
    nullReason: "precision and recall are both undefined, or both zero",
  },
  macro_f1_score: {
    label: "Macro F1 score",
    definition: "F1 computed separately for the up-class and the down-class, then averaged, so neither class dominates the score.",
    formula: "average of (F1 on the up-class) and (F1 on the down-class)",
    unit: "percent",
    better: "higher",
    formatKind: "percent",
    nullReason: "no test bar has a resolved (known) label yet",
  },
  roc_auc: {
    label: "ROC AUC",
    definition:
      "The chance that, given one bar that went up and one that went down, the model's P(up) ranked the up-bar higher. 50% is a coin flip.",
    formula: "area under the receiver-operating-characteristic curve of P(up) against the resolved labels",
    unit: "unitless (0 to 1)",
    better: "higher",
    formatKind: "ratio",
    nullReason: "the scored bars are all one class, so there is no curve to measure",
  },
  log_loss: {
    label: "Log loss",
    definition: "How confidently wrong the model's P(up) was — a bad, confident prediction is penalized far more than a mild one.",
    formula: "−mean over scored bars of [actual × ln(P(up)) + (1 − actual) × ln(1 − P(up))]",
    unit: "nats (lower is better)",
    better: "lower",
    formatKind: "ratio",
    nullReason: "no test bar has a resolved (known) label yet",
  },
  brier_score: {
    label: "Brier score",
    definition: "The average squared distance between P(up) and what actually happened (1 for up, 0 for down).",
    formula: "mean over scored bars of (P(up) − actual)²",
    unit: "unitless (0 to 1, lower is better)",
    better: "lower",
    formatKind: "ratio",
    nullReason: "no test bar has a resolved (known) label yet",
  },
  majority_class_accuracy: {
    label: "Majority-class baseline",
    definition: "The accuracy a model would get by always predicting whichever direction was more common in the test bars — the floor a real model must clear.",
    formula: "count of the more common actual direction ÷ count of scored bars",
    unit: "percent of scored bars",
    better: "higher",
    formatKind: "percent",
    nullReason: "no test bar has a resolved (known) label yet",
  },
  buy_and_hold_net_profit_usd: {
    label: "Buy & hold baseline",
    definition: "What holding one long position for the whole test span, doing nothing else, would have made — the floor a real strategy must clear.",
    formula: "(close of the last test bar − close of the first test bar) × point value × contracts",
    unit: "US dollars",
    better: "higher",
    formatKind: "usd",
    nullReason: "the test span has not produced any bars yet",
  },
};

/** Metric groups, in display order, exactly as the panel build contract lists them. */
export const METRIC_GROUPS: { title: string; metrics: CycleMetricName[] }[] = [
  {
    title: "Trading",
    metrics: [
      "net_profit_usd",
      "sharpe_ratio",
      "sortino_ratio",
      "calmar_ratio",
      "maximum_drawdown_usd",
      "profit_factor",
      "win_rate",
      "trade_count",
      "average_trade_usd",
      "expectancy_usd",
      "exposure_fraction",
      "gross_profit_usd",
      "gross_loss_usd",
      "total_cost_usd",
    ],
  },
  {
    title: "Classification",
    metrics: ["accuracy", "balanced_accuracy", "precision", "recall", "f1_score", "macro_f1_score", "roc_auc", "log_loss", "brier_score"],
  },
  {
    title: "Baselines",
    metrics: ["majority_class_accuracy", "buy_and_hold_net_profit_usd"],
  },
];

// Every metric group above must exactly cover CYCLE_METRIC_NAMES, in the same
// set. A cheap dev-time assertion so a future edit to either list is caught
// immediately instead of silently dropping a tile.
if (import.meta.env?.DEV) {
  const grouped = new Set(METRIC_GROUPS.flatMap((g) => g.metrics));
  const missing = CYCLE_METRIC_NAMES.filter((name) => !grouped.has(name));
  if (missing.length > 0) {
     
    console.error(`[cycle] METRIC_GROUPS is missing: ${missing.join(", ")}`);
  }
}
