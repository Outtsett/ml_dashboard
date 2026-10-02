import type { StudyMeta } from "../../types";

export const meta: StudyMeta = {
  slug: "chart-cnn-arithmetic-patterns",
  title: "Chart CNN control: does it read arithmetic candle patterns?",
  summary:
    "The same 48-bar chart images and the same network as the direction experiment, scored on 17 deterministic one-to-three-bar patterns instead of direction. Near-perfect recognition here means the near-0.50 direction AUC is about the market, not the model.",
  category: "Predictive",
  status: "record-of-past-round",
  replaces: "E:/source/repos/ml_dashboard/Trading/quant/chart_cnn/pkg/report_patterns.py",
  related: [
    { label: "Chart CNN: direction null result", href: "/studies/chart-cnn-direction-null-result" },
    { label: "Chart CNN: TA-Lib patterns on real windows", href: "/studies/chart-cnn-pattern-recognition" },
    { label: "Candle patterns: read them, or trade them?", href: "/studies/candle-pattern-scorecard" },
  ],
};
