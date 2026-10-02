import type { StudyMeta } from "../../types";

export const meta: StudyMeta = {
  slug: "market-series-explorer",
  title: "Market series explorer: roll-adjusted candles with aligned features",
  summary:
    "One futures root or forex pair at 1 hour, built from the lake's 1-minute bars with one contract per bar, roll-adjusted and causal. Brush a span of history, draw its candles with any scale-free feature as an aligned pane, and compare the span's distribution with the rest.",
  category: "Descriptive",
  status: "diagnostic-tool",
  replaces: "E:/source/repos/datalake/notebooks/lake_explorer.py",
  related: [
    { label: "Market chart", href: "/" },
    { label: "Analytics", href: "/analytics" },
    { label: "Price regression", href: "/regression" },
  ],
};
