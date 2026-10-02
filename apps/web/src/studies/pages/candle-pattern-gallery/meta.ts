import type { StudyMeta } from "../../types";

export const meta: StudyMeta = {
  slug: "candle-pattern-gallery",
  title: "What do the 61 TA-Lib candle patterns look like on MNQ 5-minute bars?",
  summary:
    "Pick a pattern and see real firings from 2019 to 2025 (plus constructed examples for the patterns that almost never fire), three ways: only the pattern's bars, the last eight bars, and the exact 48-bar raster the chart-CNN is shown.",
  category: "Descriptive",
  status: "diagnostic-tool",
  replaces: "E:/source/repos/ml_dashboard/Trading/quant/chart_cnn/pkg/gallery.py",
  related: [
    { label: "Candlestick pattern exemplars", href: "/studies/candlestick-pattern-exemplars" },
    { label: "Chart CNN: reading candle patterns", href: "/studies/chart-cnn-pattern-recognition" },
    { label: "Candle pattern scorecard", href: "/studies/candle-pattern-scorecard" },
    { label: "Market chart pattern overlays", href: "/" },
  ],
};
