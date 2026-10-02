import type { StudyMeta } from "../../types";

export const meta: StudyMeta = {
  slug: "quant-bars-to-tensor",
  title: "From bars to a tensor",
  summary:
    "How quantlab's transformer input is built: front-month 1-minute bars, six scale-free features, a trailing z-score that stays unknown until its window is full, sliding windows with the next bar's log return as the target, and a purged 70/30 split scored against a predict-zero and a copy-the-last-return baseline.",
  category: "Predictive",
  status: "diagnostic-tool",
  replaces: "E:/source/repos/ml_dashboard/Trading/quantlab/notebooks/transformer_pipeline.py",
  related: [
    { label: "Model Cycle (walk-forward runs)", href: "/cycle" },
    { label: "Analytics (the same bars, four layers)", href: "/analytics" },
  ],
};
