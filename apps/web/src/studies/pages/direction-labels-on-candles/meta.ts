import type { StudyMeta } from "../../types";

export const meta: StudyMeta = {
  slug: "direction-labels-on-candles",
  title: "Direction labels on real candles",
  summary:
    "Each stored direction bit dir_h{H} is the sign of close[t+H] minus close[t] on 1-minute MNQ bars. See the bit on its candle, the segment it is the sign of, every horizon side by side, and a full-table proof that bars and labels are aligned.",
  category: "Predictive",
  status: "diagnostic-tool",
  replaces: "E:/source/repos/ml_dashboard/Trading/quant/model/notebooks/direction_on_candles.py",
  related: [
    { label: "Label catalog", href: "/labels" },
    { label: "Market chart label overlay", href: "/" },
  ],
};
