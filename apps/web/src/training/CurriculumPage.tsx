import { useState, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CurriculumOverview } from "@/training/CurriculumOverview";
import { LearningPathView } from "@/training/LearningPathView";
import { LessonViewer } from "@/training/LessonViewer";
import { useCurriculumProgress, usePathProgress, useUpdateProgress, useCurriculumStats } from "@/training/lib/useCurriculum";
import { allPaths } from "@/training/paths";
import type { Lesson } from "@/training/curriculum_types";

type CurriculumView =
  | { kind: "overview" }
  | { kind: "path"; pathId: string }
  | { kind: "lesson"; pathId: string; lessonId: string };

export default function Curriculum() {
  const [view, setView] = useState<CurriculumView>({ kind: "overview" });
  const { data: progress = [] } = useCurriculumProgress();
  const pathProgress = usePathProgress(progress);
  const stats = useCurriculumStats(progress);
  const updateProgress = useUpdateProgress();

  const handleSelectPath = useCallback((pathId: string) => {
    setView({ kind: "path", pathId });
  }, []);

  const handleSearchSelectLesson = useCallback((pathId: string, lessonId: string) => {
    setView({ kind: "lesson", pathId, lessonId });
  }, []);

  const handleSelectLesson = useCallback(
    (lessonId: string) => {
      if (view.kind !== "path") return;

      // Find the lesson to check prerequisites
      const path = allPaths.find((p) => p.id === view.pathId);
      if (!path) return;
      let lesson: Lesson | undefined;
      for (const mod of path.modules) {
        lesson = mod.lessons.find((l) => l.id === lessonId);
        if (lesson) break;
      }
      if (!lesson) return;

      // Guard: block navigation if prerequisites are unmet (unless user confirms)
      if (lesson.prerequisites?.length) {
        const progressMap = new Map(progress.map((p) => [p.lessonId, p]));
        const unmet = lesson.prerequisites.filter(
          (id) => progressMap.get(id)?.status !== "completed"
        );
        if (unmet.length > 0) {
          const lessonMap = new Map<string, Lesson>();
          for (const m of path.modules)
            for (const l of m.lessons) lessonMap.set(l.id, l);
          const names = unmet.map((id) => lessonMap.get(id)?.title ?? id);
          if (
            !window.confirm(
              `This lesson has unmet prerequisites.\n\nComplete ${names.map((t) => `'${t}'`).join(", ")} first.\n\nContinue anyway?`
            )
          ) {
            return;
          }
        }
      }

      setView({ kind: "lesson", pathId: view.pathId, lessonId });
    },
    [view, progress]
  );

  const handleBack = useCallback(() => {
    if (view.kind === "lesson") {
      setView({ kind: "path", pathId: view.pathId });
    } else {
      setView({ kind: "overview" });
    }
  }, [view]);

  const handleLessonComplete = useCallback(
    (lessonId: string, score?: number) => {
      const pathId = view.kind === "lesson" ? view.pathId : "";
      const path = allPaths.find((p) => p.id === pathId);
      const moduleId =
        path?.modules.find((m) => m.lessons.some((l) => l.id === lessonId))?.id ?? "";
      updateProgress.mutate({
        moduleId,
        lessonId,
        status: "completed",
        score: score ?? undefined,
      });
    },
    [view, updateProgress]
  );

  const currentPath = useMemo(() => {
    if (view.kind === "path" || view.kind === "lesson") {
      return allPaths.find((p) => p.id === view.pathId);
    }
    return undefined;
  }, [view]);

  const currentLesson = useMemo(() => {
    if (view.kind === "lesson" && currentPath) {
      for (const mod of currentPath.modules) {
        const lesson = mod.lessons.find((l) => l.id === view.lessonId);
        if (lesson) return lesson;
      }
    }
    return undefined;
  }, [view, currentPath]);

  const lessonProgressForPath = useMemo(() => {
    if (!currentPath) return [];
    const pathLessonIds = new Set(
      currentPath.modules.flatMap((m) => m.lessons.map((l) => l.id))
    );
    return progress.filter((p) => pathLessonIds.has(p.lessonId));
  }, [currentPath, progress]);

  // Flat ordered lesson list for prev/next navigation
  const flatLessons = useMemo(() => {
    if (!currentPath) return [];
    return currentPath.modules.flatMap((m) => m.lessons);
  }, [currentPath]);

  const { prevLesson, nextLesson } = useMemo(() => {
    if (view.kind !== "lesson" || flatLessons.length === 0) {
      return { prevLesson: undefined, nextLesson: undefined };
    }
    const idx = flatLessons.findIndex((l) => l.id === view.lessonId);
    return {
      prevLesson: idx > 0 ? flatLessons[idx - 1] : undefined,
      nextLesson: idx >= 0 && idx < flatLessons.length - 1 ? flatLessons[idx + 1] : undefined,
    };
  }, [view, flatLessons]);

  const handlePrevLesson = useCallback(() => {
    if (view.kind === "lesson" && prevLesson) {
      setView({ kind: "lesson", pathId: view.pathId, lessonId: prevLesson.id });
    }
  }, [view, prevLesson]);

  const handleNextLesson = useCallback(() => {
    if (view.kind === "lesson" && nextLesson) {
      setView({ kind: "lesson", pathId: view.pathId, lessonId: nextLesson.id });
    }
  }, [view, nextLesson]);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <AnimatePresence mode="wait">
        {view.kind === "overview" && (
          <motion.div
            key="overview"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="flex-1 overflow-auto p-6"
          >
            <div className="mb-6">
              <h1 className="text-2xl font-display font-bold tracking-tight">Curriculum</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Structured learning paths for quantitative trading &amp; machine learning
              </p>
              {/* Stats badges */}
              <div className="flex flex-wrap items-center gap-3 mt-3">
                {stats.streakDays > 0 && (
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
                    🔥 {stats.streakDays} day streak
                  </span>
                )}
                <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-[hsl(var(--data-pos)/0.1)] text-[hsl(var(--data-pos))] border border-[hsl(var(--data-pos)/0.2)]">
                  ✓ {stats.completedLessons}/{stats.totalLessons} lessons
                </span>
                {stats.averageScore > 0 && (
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
                    📊 {stats.averageScore}% avg score
                  </span>
                )}
              </div>
            </div>
            <CurriculumOverview
              paths={allPaths}
              pathProgress={pathProgress}
              onSelectPath={handleSelectPath}
              onSelectLesson={handleSearchSelectLesson}
            />
          </motion.div>
        )}

        {view.kind === "path" && currentPath && (
          <motion.div
            key="path"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
          >
            <LearningPathView
              path={currentPath}
              progress={lessonProgressForPath}
              onBack={handleBack}
              onSelectLesson={handleSelectLesson}
            />
          </motion.div>
        )}

        {view.kind === "lesson" && currentLesson && (
          <motion.div
            key="lesson"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
          >
            <LessonViewer
              lesson={currentLesson}
              progress={progress.find((p) => p.lessonId === currentLesson.id)}
              onBack={handleBack}
              onComplete={(score: number) => handleLessonComplete(currentLesson.id, score)}
              onPrevLesson={prevLesson ? handlePrevLesson : undefined}
              onNextLesson={nextLesson ? handleNextLesson : undefined}
              prevLessonTitle={prevLesson?.title}
              nextLessonTitle={nextLesson?.title}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
