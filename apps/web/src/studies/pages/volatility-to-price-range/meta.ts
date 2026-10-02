import type { StudyMeta } from "../../types";

export const meta: StudyMeta = {
  slug: "volatility-to-price-range",
  title: "Volatility value to price range",
  summary:
    "A volatility value v = ln(high − low) is a range with a logarithm taken, so e^v points, × point value dollars, ÷ tick size ticks is exact. Measured on MNQ from 1m to 1h: e^v is the median bar not the average, it runs a few percent above the realised median, the Gaussian mean correction under-states, and range scales as the square root of time.",
  category: "Predictive",
  status: "diagnostic-tool",
  replaces: "E:/source/repos/ml_dashboard/Trading/quant/model/notebooks/volatility_to_price_range.py",
  related: [
    { label: "Analytics (expected move)", href: "/analytics" },
    { label: "Model Cycle (price forecasts)", href: "/cycle" },
    { label: "Label catalog (volatility labels)", href: "/labels" },
  ],
};
