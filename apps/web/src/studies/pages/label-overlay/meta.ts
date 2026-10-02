import type { StudyMeta } from "../../types";

export const meta: StudyMeta = {
  slug: "label-overlay",
  title: "Labels on the candles: what every target marks",
  summary:
    "The shipped MNQ 1-minute label dataset drawn on real candles, so a wrong sign, a shifted horizon or a dead class is visible: swing pivots, triple-barrier boxes with their exits, volatility-regime shading, a direction strip per horizon, the continuous targets, and every stored label re-derived from its own bars.",
  category: "Predictive",
  status: "diagnostic-tool",
  replaces: "E:/source/repos/ml_dashboard/Trading/quant/model/notebooks/label_overlay.py",
  related: [
    { label: "Label catalog and lifecycle", href: "/labels" },
    { label: "Market chart label overlays", href: "/" },
  ],
};
