import type { StudyMeta } from "../../types";

export const meta: StudyMeta = {
  slug: "chart-surfaces",
  title: "Chart surfaces: what shares the chart's context, and what should",
  summary:
    "Every surface a reader thinks of as another tab of the Market chart, measured against the three things the chart publishes (symbol and timeframe, the visible window, the selected bar), with the plumbing drawn as pipes and taps, and the changes that would let the other tabs be tabs.",
  category: "System",
  status: "diagnostic-tool",
  replaces: "N/A",
  related: [
    { label: "Market chart", href: "/" },
    { label: "Analytics", href: "/analytics" },
    { label: "Regression", href: "/regression" },
    { label: "Studies", href: "/studies" },
  ],
};