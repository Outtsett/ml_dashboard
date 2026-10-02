import type { StudyMeta } from "../../types";

export const meta: StudyMeta = {
  slug: "trend-state-calibration",
  title: "TrendState: calibrating τ and η against shuffled-return nulls",
  summary:
    "Five ring-buffer least-squares rungs on bar-close log price flag a trend when a rung's scaled t reaches its entry level τ; τ and η are read from shuffled-return nulls to fire about 0.3 false entries per session. Does the calibrated flag's side agree with where price went, and does it pay after the round trip? On MNQ 2025: not yet usable.",
  category: "Descriptive",
  status: "active-research",
  replaces: "E:/source/repos/ml_dashboard/Trading/quant/analytics/notebooks/trend_state_calibration.py",
  related: [
    { label: "Analytics (trend regime)", href: "/analytics" },
    { label: "Label catalog (trend scanning)", href: "/labels" },
  ],
};
