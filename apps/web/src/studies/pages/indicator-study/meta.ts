import type { StudyMeta } from "../../types";

export const meta: StudyMeta = {
  slug: "indicator-study",
  title: "MNQ: every TA-Lib indicator on the candles, and what it says about direction",
  summary:
    "Front-month MNQ, 2025-10-01 to 2025-12-31, at 1 minute, 1 hour and 4 hours: how redundant ~150 TA-Lib indicators are, whether any predicts the next 1, 4 or 12 bars' direction once every indicator is tested at once, whether a walk-forward logistic on all of them beats simple baselines, and whether the 61 candlestick patterns form under the same market conditions every time.",
  category: "Descriptive",
  status: "record-of-past-round",
  replaces: "E:/source/repos/datalake/notebooks/mnq_indicator_study.py",
  related: [
    { label: "Market chart (151 client-side indicators, CDL patterns)", href: "/" },
    { label: "Analytics: predictive layer", href: "/analytics" },
    { label: "Candle pattern scorecard", href: "/studies/candle-pattern-scorecard" },
  ],
};
