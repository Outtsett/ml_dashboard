import type { StudyMeta } from "../../types";

export const meta: StudyMeta = {
  slug: "ta-strategy-600-ticks",
  title: "TA strategies vs 600 MNQ ticks a day",
  summary:
    "Can technical analysis on one MNQ contract net 600 ticks (150 points, 300 USD) a day after the 5.56-tick round trip? Thirteen rounds — a model battery, TA-Lib rules with 2:1 brackets, multi-timeframe support/resistance, tuned conditional templates, frequency, time of day, the swing cascade and trading at the zones — say no: the best is a few ticks a day of alpha.",
  category: "Prescriptive",
  status: "active-research",
  replaces: "E:/source/repos/ml_dashboard/notebooks/ta_strategy_600_ticks.py",
  related: [
    { label: "Market chart (zones drawn here)", href: "/" },
    { label: "Model Cycle", href: "/cycle" },
    { label: "Analytics", href: "/analytics" },
    { label: "Labels", href: "/labels" },
  ],
};
