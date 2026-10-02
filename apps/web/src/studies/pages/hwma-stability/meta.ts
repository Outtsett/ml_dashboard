import type { StudyMeta } from "../../types";

export const meta: StudyMeta = {
  slug: "hwma-stability",
  title: "When does a moving average stop being an average?",
  summary:
    "The Holt-Winters moving average carries a level, a velocity and an acceleration. Move its three correction weights and watch the spectral radius, the recursion on 2,000 real MNQH6 closes, and the boundary between a decaying average and a compounding one.",
  category: "Descriptive",
  status: "diagnostic-tool",
  replaces: "E:/source/repos/ml_dashboard/notebooks/hwma_stability.py",
  related: [{ label: "Market chart (HWMA overlay)", href: "/" }],
};
