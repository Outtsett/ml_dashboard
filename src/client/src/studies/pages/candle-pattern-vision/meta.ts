import type { StudyMeta } from "../../types";

export const meta: StudyMeta = {
  slug: "candle-pattern-vision",
  title: "Recognising the 61 TA-Lib patterns from chart images",
  summary:
    "A convolutional network (or a vision transformer) looks at a picture of the last 20 MNQ 1-minute candles and names every TA-Lib candlestick pattern firing on the last one. Trained 80 / 10 / 10 by trading day, rare patterns topped up with TA-Lib-confirmed synthetic charts; scored per pattern on real and synthetic test charts.",
  category: "Models",
  status: "active-research",
  replaces: "",
  related: [
    { label: "Training", href: "/training" },
    { label: "Candle shapes that stand out", href: "/studies/candle-shape-standouts" },
  ],
};
