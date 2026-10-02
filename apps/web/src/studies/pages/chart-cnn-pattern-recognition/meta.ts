import type { StudyMeta } from "../../types";

export const meta: StudyMeta = {
  slug: "chart-cnn-pattern-recognition",
  title: "Chart CNN: reading candle patterns it was never shown for real",
  summary:
    "A network trained only on synthetic candles that TA-Lib verifies, scored on 126,624 real MNQ 5-minute windows from 2024 on: how well it recognises each of the 61 TA-Lib patterns, where its confident calls go wrong, and what its 256-number embedding separates.",
  category: "Predictive",
  status: "record-of-past-round",
  replaces: "E:/source/repos/ml_dashboard/Trading/quant/chart_cnn/synth/report_synth.py",
  related: [
    { label: "Candle patterns: read them, or trade them?", href: "/studies/candle-pattern-scorecard" },
    { label: "Market chart pattern overlays", href: "/" },
  ],
};
