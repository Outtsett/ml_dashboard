import type { LearningPath } from "@/training/lib/types";
import { foundationsPath } from "./content/foundations";
import { classicalMlPath } from "./content/classical-ml";
import { timeSeriesPath } from "./content/time-series";
import { deepLearningPath } from "./content/deep-learning";
import { reinforcementLearningPath } from "./content/reinforcement-learning";
import { generativePath } from "./content/generative";
import { appliedQuantPath } from "./content/applied-quant";

export const allPaths: LearningPath[] = [
  foundationsPath,
  classicalMlPath,
  timeSeriesPath,
  deepLearningPath,
  reinforcementLearningPath,
  generativePath,
  appliedQuantPath,
];

/** Lookup a path by id */
export function getPath(id: string): LearningPath | undefined {
  return allPaths.find((p) => p.id === id);
}

/** Lookup a lesson across all paths */
export function getLesson(lessonId: string) {
  for (const path of allPaths) {
    for (const mod of path.modules) {
      const lesson = mod.lessons.find((l) => l.id === lessonId);
      if (lesson) return { path, module: mod, lesson };
    }
  }
  return undefined;
}
