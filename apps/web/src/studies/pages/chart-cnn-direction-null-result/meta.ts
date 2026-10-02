import type { StudyMeta } from "../../types";

export const meta: StudyMeta = {
  slug: "chart-cnn-direction-null-result",
  title: "Chart-image CNN: does a picture of 48 bars predict direction?",
  summary:
    "A 2D CNN on rendered 48-bar chart images and a 1D CNN on the same bars as numbers, each scored out of sample on whether price hits +2 ATR before -2 ATR. Both sit at an AUC of 0.50 on MNQ 1-minute, 5-minute and 1-hour bars: the shape carries no direction that the numbers do not.",
  category: "Predictive",
  status: "record-of-past-round",
  replaces: "E:/source/repos/ml_dashboard/Trading/quant/chart_cnn/pkg/report.py",
  related: [
    { label: "Chart CNN pattern recognition", href: "/studies/chart-cnn-pattern-recognition" },
    { label: "Market chart", href: "/" },
  ],
};
