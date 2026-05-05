import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { LessonProgress, PathProgress, CurriculumStats, CurriculumBookmark } from "@/lib/curriculum/types";
import { allPaths } from "@/lib/curriculum/paths";

// ─── Streak computation ─────────────────────────────────────────
/**
 * Count consecutive calendar days (local TZ) with at least one lesson completion,
 * going backward from today (or yesterday if nothing was completed today).
 */
export function computeStreak(progress: LessonProgress[]): number {
  const timestamps = progress
    .filter((p) => p.status === "completed" && p.completedAt != null)
    .map((p) => p.completedAt!);

  if (timestamps.length === 0) return 0;

  // Unique calendar days (local timezone), sorted descending
  const daySet = new Set<string>();
  for (const ts of timestamps) {
    const d = new Date(ts);
    daySet.add(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`);
  }
  const sortedDays = [...daySet]
    .map((key) => {
      const parts = key.split("-");
      return new Date(Number(parts[0]), Number(parts[1]), Number(parts[2]));
    })
    .sort((a, b) => b.getTime() - a.getTime());

  // Determine the anchor day: today if it has a completion, else yesterday
  const now = new Date();
  const todayKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const yesterdayKey = `${yesterday.getFullYear()}-${yesterday.getMonth()}-${yesterday.getDate()}`;

  let anchor: Date;
  if (daySet.has(todayKey)) {
    anchor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  } else if (daySet.has(yesterdayKey)) {
    anchor = yesterday;
  } else {
    return 0; // most recent completion is older than yesterday
  }

  const MS_PER_DAY = 86_400_000;
  let streak = 0;
  for (const day of sortedDays) {
    const expected = new Date(anchor.getTime() - streak * MS_PER_DAY);
    if (day.getTime() === expected.getTime()) {
      streak++;
    } else if (day.getTime() < expected.getTime()) {
      break; // gap detected
    }
    // day > expected means duplicate or future — skip
  }

  return streak;
}

const KEYS = {
  progress: ["/api/curriculum/progress"] as const,
  stats: ["/api/curriculum/stats"] as const,
  sectionProgress: (lessonId: string) => ["/api/curriculum/sections", lessonId] as const,
  bookmarks: ["/api/curriculum/bookmarks"] as const,
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
        timeSpentMs: r.timeSpentMs ?? 0,
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
    streakDays: computeStreak(progress),
  };
}

// ─── Get progress for a single lesson ───────────────────────────
export function useLessonProgress(
  lessonId: string,
  allProgress: LessonProgress[] | undefined
): LessonProgress | undefined {
  return allProgress?.find((p) => p.lessonId === lessonId);
}

// ─── Section-level progress ─────────────────────────────────────
export function useSectionProgress(lessonId: string) {
  return useQuery<number[]>({
    queryKey: KEYS.sectionProgress(lessonId),
    queryFn: async () => {
      const res = await fetch(`/api/curriculum/sections/${encodeURIComponent(lessonId)}`);
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 30_000,
  });
}

export function useMarkSectionViewed() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (payload: { lessonId: string; sectionIndex: number }) => {
      const res = await fetch("/api/curriculum/sections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Failed to mark section viewed");
      return res.json();
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: KEYS.sectionProgress(variables.lessonId) });
    },
  });
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

// ─── Bookmarks ──────────────────────────────────────────────────
export function useBookmarks() {
  return useQuery<CurriculumBookmark[]>({
    queryKey: KEYS.bookmarks,
    queryFn: async () => {
      const res = await fetch("/api/curriculum/bookmarks");
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 30_000,
  });
}

export function useToggleBookmark() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (lessonId: string) => {
      const res = await fetch("/api/curriculum/bookmarks/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lessonId }),
      });
      if (!res.ok) throw new Error("Failed to toggle bookmark");
      return res.json() as Promise<{ bookmarked: boolean }>;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.bookmarks });
    },
  });
}

export function useUpdateNote() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (payload: { lessonId: string; note: string }) => {
      const res = await fetch("/api/curriculum/bookmarks/note", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Failed to update note");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.bookmarks });
    },
  });
}
