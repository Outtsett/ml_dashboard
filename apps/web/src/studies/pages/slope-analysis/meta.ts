import type { StudyMeta } from "../../types";

export const meta: StudyMeta = {
  slug: "slope-analysis",
  title: "Rolling Linear Regression Slope (Trend Signal)",
  summary: "Does the N-bar linear regression slope of price provide actionable directional edge on MNQ? We measure 'ruler tilt' over 10, 20, and 50-bar windows, generating threshold-based signals and trading the resulting crossovers after a 1.4 point round-trip cost.",
  category: "Predictive",
  status: "active-research",
  replaces: "E:/source/repos/ml_dashboard/Trading/quant/model/notebooks/slope_analysis.py",
  related: [
    { label: "Trend State Calibration", href: "/studies/trend-state-calibration" },
    { label: "Crossover Strategy", href: "/studies/crossover-strategy" },
  ],
};
