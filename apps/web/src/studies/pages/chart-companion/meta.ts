import type { StudyMeta } from "../../types";

export const meta: StudyMeta = {
  slug: "chart-companion",
  title: "Chart companion: what the bars on your chart are doing",
  summary:
    "Follows the Market chart (symbol, timeframe, visible range, clicked bar) and describes exactly those bars: eight numbers for seven columns, every column as a line over its histogram with a brush, a causal return z-score with the unusual moves marked, the clicked bar's rank, and optional drawings pushed back onto the chart.",
  category: "Descriptive",
  status: "diagnostic-tool",
  replaces: "E:/source/repos/ml_dashboard/notebooks/chart_companion.py",
  related: [
    { label: "Market chart", href: "/" },
    { label: "Analytics (session gaps left out)", href: "/analytics" },
  ],
};
