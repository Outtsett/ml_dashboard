import type { StudyMeta } from "../../types";

export const meta: StudyMeta = {
  slug: "frozen-candle-encoder",
  title: "Why not to freeze the candle recogniser as an encoder",
  summary:
    "Does the 256-number embedding of the chart CNN's candlestick recogniser, frozen as an encoder, predict next-candle direction? The window is only five candles, the 61 TA-Lib labels explain about a quarter of the embedding, and the encoder does not beat an information-free shuffled control at any horizon (negative result).",
  category: "Predictive",
  status: "record-of-past-round",
  replaces: "E:/source/repos/datalake/notebooks/frozen_candle_encoder.py",
  related: [
    { label: "Chart CNN pattern recognition", href: "/studies/chart-cnn-pattern-recognition" },
    { label: "Candle patterns: read them, or trade them?", href: "/studies/candle-pattern-scorecard" },
    { label: "Market chart pattern overlays", href: "/" },
  ],
};
