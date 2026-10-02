import type { StudyMeta } from "../../types";

export const meta: StudyMeta = {
  slug: "quant-oos-results",
  title: "Transformer walk-forward results",
  summary:
    "Six expanding-window folds of quantlab's MNQ transformer, each scored on bars it never saw with 512 windows purged at every boundary: does it beat predicting zero, does conviction gating help, and what directional accuracy would the round-turn cost demand?",
  category: "Predictive",
  status: "record-of-past-round",
  replaces: "E:/source/repos/ml_dashboard/Trading/quantlab/notebooks/oos_results.py",
  related: [
    { label: "From bars to a tensor", href: "/studies/quant-bars-to-tensor" },
    { label: "Model Cycle (walk-forward runs)", href: "/cycle" },
  ],
};
