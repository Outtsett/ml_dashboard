import type { StudyMeta } from "../../types";

export const meta: StudyMeta = {
  slug: "mnq-eda-30m",
  title: "MNQ exploratory analysis: what the direction model is given",
  summary:
    "MNQ's 30-minute bars for the SimpleDirectionTransformer: price and volume, the return distribution and its Q-Q plot, unit-root tests, autocorrelation of returns and squared returns, rolling volatility, weekday effects, the exact 32 x 5 tensor the model reads, direction-label balance and the walk-forward folds. The notebook's file is named 1d; its content, and this page's default, is the 30-minute bar.",
  category: "Predictive",
  status: "diagnostic-tool",
  replaces: "E:/source/repos/ml_dashboard/Trading/quant/model/notebooks/eda_mnq_1d.py",
  related: [
    { label: "Analytics: descriptive and diagnostic", href: "/analytics" },
    { label: "Data page: SQL console and column profiles", href: "/data" },
    { label: "Label catalog", href: "/labels" },
    { label: "Model Cycle walk-forward runs", href: "/cycle" },
  ],
};
