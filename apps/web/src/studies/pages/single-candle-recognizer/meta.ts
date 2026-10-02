import type { StudyMeta } from "../../types";

export const meta: StudyMeta = {
  slug: "single-candle-recognizer",
  title: "Recognising TA-Lib's 13 single-candle patterns",
  summary:
    "TA-Lib's thirteen single-candle patterns compare the candle with a 10-bar trailing average, so the candle alone cannot decide them. The study fits four model families with and without that context, and a calculator runs TA-Lib's own arithmetic on a candle you shape or on a real MNQ firing.",
  category: "Predictive",
  status: "record-of-past-round",
  replaces: "E:/source/repos/datalake/notebooks/single_candle_recognizer.py",
  related: [
    { label: "Candle pattern scorecard", href: "/studies/candle-pattern-scorecard" },
    { label: "Market chart pattern overlays", href: "/" },
  ],
};
