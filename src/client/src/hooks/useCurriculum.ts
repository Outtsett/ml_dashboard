import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { LessonProgress, PathProgress, CurriculumStats } from "@/lib/curriculum/types";
import { allPaths } from "@/lib/curriculum/paths";

const KEYS = {
  progress: ["/api/curriculum/progress"] as const,
  stats: ["/api/curriculum/stats"] as const,
};

// ─── Fetch all progress records ─────────────────────────────────
export function useCurriculumProgress() {
  return useQuery<LessonProgress[]>({
    queryKey: KEYS.progress,
    queryFn: async () => {
      const res = await fetch("/api/curriculum/progress");
      if (!res.ok) return [];
      const data = await res.json();
      return (data ?? []).map((r: any) => ({
        lessonId: r.lessonId,
        status: r.status,
        score: r.score ?? undefined,
        completedAt: r.completedAt ?? undefined,
      }));
    },
    staleTime: 30_000,
  });
}

// ─── Compute path-level progress from lesson progress ───────────
export function usePathProgress(progress: LessonProgress[] | undefined): PathProgress[] {
  if (!progress) return [];

  return allPaths.map((path) => {
    const lessonIds = new Set(
      path.modules.flatMap((m) => m.lessons.map((l) => l.id))
    );
    const relevant = progress.filter((p) => lessonIds.has(p.lessonId));
    const completed = relevant.filter((p) => p.status === "completed");
    const inProgress = relevant.filter((p) => p.status === "in_progress");
    const scores = completed.filter((p) => p.score != null).map((p) => p.score!);

    return {
      pathId: path.id,
      totalLessons: lessonIds.size,
      completedLessons: completed.length,
      inProgressLessons: inProgress.length,
      averageScore: scores.length > 0
        ? scores.reduce((a, b) => a + b, 0) / scores.length
        : undefined,
    };
  });
}

// ─── Compute overall curriculum stats ───────────────────────────
export function useCurriculumStats(progress: LessonProgress[] | undefined): CurriculumStats {
  const totalLessons = allPaths.reduce(
    (sum, p) => sum + p.modules.reduce((s, m) => s + m.lessons.length, 0),
    0
  );
  const totalModules = allPaths.reduce((sum, p) => sum + p.modules.length, 0);

  if (!progress) {
    return {
      totalPaths: allPaths.length,
      totalModules,
      totalLessons,
      completedLessons: 0,
      averageScore: 0,
      streakDays: 0,
    };
  }

  const completed = progress.filter((p) => p.status === "completed");
  const scores = completed.filter((p) => p.score != null).map((p) => p.score!);

  return {
    totalPaths: allPaths.length,
    totalModules,
    totalLessons,
    completedLessons: completed.length,
    averageScore: scores.length > 0
      ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
      : 0,
    streakDays: 0, // TODO: compute from completedAt timestamps
  };
}

// ─── Get progress for a single lesson ───────────────────────────
export function useLessonProgress(
  lessonId: string,
  allProgress: LessonProgress[] | undefined
): LessonProgress | undefined {
  return allProgress?.find((p) => p.lessonId === lessonId);
}

// ─── Update lesson progress ─────────────────────────────────────
export function useUpdateProgress() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (payload: {
      moduleId: string;
      lessonId: string;
      status: string;
      score?: number;
    }) => {
      const res = await fetch("/api/curriculum/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Failed to update progress");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.progress });
    },
  });
}
