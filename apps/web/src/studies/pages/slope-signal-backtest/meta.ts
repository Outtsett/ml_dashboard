import type { StudyMeta } from "../../types";

export const meta: StudyMeta = {
  slug: "slope-signal-backtest",
  title: "Slope of price as a trading signal: a ruler laid on the last N closes",
  summary:
    "A rolling least-squares line through the last N MNQ closes, its slope turned into long, short or flat with a threshold that adapts to the slope's own spread, and that rule backtested after cost against buy and hold. Two accountings sit side by side: the notebook's own, bug for bug, and a corrected one that prices each side traded, annualises by the bars observed and back-adjusts the contract roll.",
  category: "Predictive",
  status: "record-of-past-round",
  replaces: "E:/source/repos/ml_dashboard/Trading/quant/model/notebooks/slope_analysis.py",
  related: [
    { label: "Market chart (linear regression slope indicator)", href: "/" },
    { label: "Backtest presets", href: "/backtest" },
    { label: "Model Cycle (linear model)", href: "/cycle" },
    { label: "EMA x SMA crossover study", href: "/studies/crossover-strategy" },
  ],
};
