import type { StudyMeta } from "../../types";

export const meta: StudyMeta = {
  slug: "regime-gated-crossover",
  title: "Crossover gated by volatility regime",
  summary:
    "Does the MNQ 5m EMA5 / SMA100 crossover's cost-adjusted edge live in some 1m volatility regimes (k-means on size and flow) and not others, and does sitting out the rest improve it? The record says no: the gate's per-bar effect has a 95% BCa interval that straddles zero.",
  category: "Prescriptive",
  status: "record-of-past-round",
  replaces: "E:/source/repos/ml_dashboard/Trading/quant/analytics/notebooks/regime_gated_crossover.py",
  related: [
    { label: "Analytics: volatility regimes", href: "/analytics" },
    { label: "Model Cycle", href: "/cycle" },
  ],
};
