import type { StudyMeta } from "../../types";

export const meta: StudyMeta = {
  slug: "candlestick-pattern-exemplars",
  title: "Which candle actually is the pattern?",
  summary:
    "TA-Lib emits the same flat signal on a textbook hammer and on a bar that barely qualified, and checks the prior trend for none of its 61 patterns. Every firing on MNQ daily bars is ranked by how close its shape is to the pattern's median shape, and stamped with the trend that came before against the trend its meaning needs.",
  category: "Descriptive",
  status: "active-research",
  replaces: "E:/source/repos/ml_dashboard/notebooks/candlestick_pattern_exemplars.py",
  related: [
    { label: "Candle pattern scorecard", href: "/studies/candle-pattern-scorecard" },
    { label: "Candlestick pattern census", href: "/studies/candlestick-pattern-census" },
    { label: "Market chart pattern overlays", href: "/" },
  ],
};
