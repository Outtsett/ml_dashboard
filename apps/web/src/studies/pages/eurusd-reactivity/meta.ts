import type { StudyMeta } from "../../types";

export const meta: StudyMeta = {
  slug: "eurusd-reactivity",
  title: "EURUSD: brush a span, see what it costs",
  summary:
    "A daily causal z-score of EURUSD's log range is the selector. Brush a span and the detail candles, the brushed-against-rest distribution of one-minute returns and the measured server timings recompute over every one-minute bar in the lake.",
  category: "Predictive",
  status: "diagnostic-tool",
  replaces: "E:/source/repos/ml_dashboard/Trading/forexmodel/notebooks/eurusd_viz.py",
  related: [
    { label: "Market chart", href: "/" },
    { label: "Analytics", href: "/analytics" },
    { label: "Data", href: "/data" },
  ],
};
