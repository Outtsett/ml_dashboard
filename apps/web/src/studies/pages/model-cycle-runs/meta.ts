import type { StudyMeta } from "../../types";

export const meta: StudyMeta = {
  slug: "model-cycle-runs",
  title: "Model Cycle runs: every run, bar and prediction",
  summary:
    "Every recorded Model Cycle run from the lake: the run list and the all-run comparison, then for one run its predictions, trades, folds, tuning trials, training epochs and in-depth metrics, calibration, session days and drawdowns, and the 2026-09-26 audit.",
  category: "Predictive",
  status: "diagnostic-tool",
  replaces: "E:/source/repos/ml_dashboard/notebooks/model_cycle_runs.py",
  related: [
    { label: "Model Cycle (live runs)", href: "/cycle" },
    { label: "Analytics", href: "/analytics" },
  ],
};
