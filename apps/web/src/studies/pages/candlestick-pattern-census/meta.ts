import type { StudyMeta } from "../../types";

export const meta: StudyMeta = {
  slug: "candlestick-pattern-census",
  title: "How many candlestick patterns are there, and how many are in the data",
  summary:
    "Three numbers get called the number of candlestick patterns: what TA-Lib defines (61, of which 13 are one candle), what fires in MNQ 2021-2025 on five timeframes (59), and what is measurable (at least 60 holdout firings). Move the threshold and the last number moves; the first never does.",
  category: "Diagnostic",
  status: "record-of-past-round",
  replaces: "E:/source/repos/datalake/notebooks/candlestick_pattern_census.py",
  related: [
    { label: "Candle pattern scorecard", href: "/studies/candle-pattern-scorecard" },
    { label: "Market chart pattern overlays", href: "/" },
  ],
};
