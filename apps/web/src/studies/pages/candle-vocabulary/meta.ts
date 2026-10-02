import type { StudyMeta } from "../../types";

export const meta: StudyMeta = {
  slug: "candle-vocabulary",
  title: "The candle vocabulary, and what it is worth",
  summary:
    "A VQ-VAE codebook of 24 multi-bar candle archetypes: what the archetypes look like, whether the code adds anything to HAR-RV on forward volatility (only once magnitude is kept: +0.043 R-squared), and why next-symbol prediction fails once symbols stop overlapping.",
  category: "Predictive",
  status: "record-of-past-round",
  replaces: "E:/source/repos/ml_dashboard/Trading/quant/model/notebooks/candle_vocab.py",
  related: [
    { label: "Candle vectors study", href: "/studies/candle-vectors" },
    { label: "Single-candle recognizer", href: "/studies/single-candle-recognizer" },
    { label: "Candle pattern scorecard", href: "/studies/candle-pattern-scorecard" },
  ],
};
