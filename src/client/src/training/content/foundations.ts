import type { LearningPath } from "@/training/lib/types";
import { statsProbModule } from "./foundations/stats-prob";
import { linalgOptModule } from "./foundations/linalg-opt";
import { dimensionalityModule } from "./foundations/dimensionality";

export const foundationsPath: LearningPath = {
  id: "foundations",
  title: "Foundations",
  description:
    "Build the mathematical and statistical foundations essential for understanding machine learning in financial markets. Covers descriptive statistics, probability distributions, linear algebra, and optimization — all through the lens of forex trading data.",
  icon: "Sigma",
  color: "blue",
  difficulty: "beginner",
  estimatedHours: 15,
  modules: [
    statsProbModule,
    linalgOptModule,
    dimensionalityModule,
  ],
};
