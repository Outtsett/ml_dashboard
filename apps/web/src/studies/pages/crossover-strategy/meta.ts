import type { StudyMeta } from "../../types";

export const meta: StudyMeta = {
  slug: "crossover-strategy",
  title: "EMA x SMA crossover: equity, drawdown and what it would have cost",
  summary:
    "The always-in fast-EMA-over-slow-SMA rule on MNQ 5-minute bars, after trading cost: one two-week window with MACD crossings and RSI, the compounded equity and drawdown, and a check of the notebook's quoted Sharpe figures against the sweep, walk-forward, bootstrap and Deflated Sharpe Ratio that the analytics package computes.",
  category: "Prescriptive",
  status: "record-of-past-round",
  replaces: "E:/source/repos/ml_dashboard/Trading/quant/analytics/notebooks/crossover_visualization.py",
  related: [
    { label: "Market chart (candles, MACD, RSI)", href: "/" },
    { label: "Backtest presets", href: "/backtest" },
    { label: "Regime-gated crossover study", href: "/studies/regime-gated-crossover" },
  ],
};
