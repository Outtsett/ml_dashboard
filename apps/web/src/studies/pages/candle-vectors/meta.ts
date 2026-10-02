import type { StudyMeta } from "../../types";

export const meta: StudyMeta = {
  slug: "candle-vectors",
  title: "How a model learns what a hammer is, and what the market does around one",
  summary:
    "Every MNQ window of 16 candles becomes 64 level-free numbers measured in the trailing ten-bar range. Can a model point out seven TA-Lib patterns from them (yes, and on 1h/4h candles it never saw), do the nearest past windows know which way price goes next (no), what do unsupervised models invent, and does any pattern or learned shape pay after costs in the next six candles (no rule carried a tradeable edge into 2025)?",
  category: "Predictive",
  status: "record-of-past-round",
  replaces: "E:/source/repos/datalake/notebooks/mnq_candle_vectors.py",
  related: [
    { label: "Candle pattern scorecard", href: "/studies/candle-pattern-scorecard" },
    { label: "Market chart pattern overlays", href: "/" },
    { label: "Label catalog", href: "/labels" },
  ],
};
