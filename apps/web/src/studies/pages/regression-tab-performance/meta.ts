import type { StudyMeta } from "../../types";

export const meta: StudyMeta = {
  slug: "regression-tab-performance",
  title: "Regression tab: how many points to draw, and would Redis help",
  summary:
    "Measurements behind the Price Regression tab: how many points a scatter panel needs before its shape reads true, what the canvas costs, where the read time goes (in-process cache against Redis), and what fitting on the page's own thread costs.",
  category: "Diagnostic",
  status: "record-of-past-round",
  replaces: "E:/source/repos/ml_dashboard/notebooks/regression_tab_performance.py",
  related: [{ label: "Price Regression tab", href: "/regression" }],
};
