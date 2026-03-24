import { useState, useCallback, useMemo } from "react";
import { CurriculumOverview } from "@/components/curriculum/CurriculumOverview";
import { LearningPathView } from "@/components/curriculum/LearningPathView";
import { LessonViewer } from "@/components/curriculum/LessonViewer";
import { useCurriculumProgress, usePathProgress, useUpdateProgress } from "@/hooks/useCurriculum";
import { allPaths } from "@/lib/curriculum/paths";
import type { LessonProgress } from "@/lib/curriculum/types";

type CurriculumView =
  | { kind: "overview" }
  | { kind: "path"; pathId: string }
  | { kind: "lesson"; pathId: string; lessonId: string };

export default function Curriculum() {
  const [view, setView] = useState<CurriculumView>({ kind: "overview" });
  const { data: progress = [] } = useCurriculumProgress();
  const pathProgress = usePathProgress(progress);
  const updateProgress = useUpdateProgress();

  const handleSelectPath = useCallback((pathId: string) => {
    setView({ kind: "path", pathId });
  }, []);

  const handleSelectLesson = useCallback(
    (lessonId: string) => {
      if (view.kind === "path") {
        setView({ kind: "lesson", pathId: view.pathId, lessonId });
      }
    },
    [view]
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

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {view.kind === "overview" && (
        <div className="flex-1 overflow-auto p-6">
          <div className="mb-6">
            <h1 className="text-2xl font-display font-bold tracking-tight">Curriculum</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Structured learning paths for quantitative trading &amp; machine learning
            </p>
          </div>
          <CurriculumOverview
            paths={allPaths}
            pathProgress={pathProgress}
            onSelectPath={handleSelectPath}
          />
        </div>
      )}

      {view.kind === "path" && currentPath && (
        <LearningPathView
          path={currentPath}
          progress={lessonProgressForPath}
          onBack={handleBack}
          onSelectLesson={handleSelectLesson}
        />
      )}

      {view.kind === "lesson" && currentLesson && (
        <LessonViewer
          lesson={currentLesson}
          progress={progress.find((p) => p.lessonId === currentLesson.id)}
          onBack={handleBack}
          onComplete={(score: number) => handleLessonComplete(currentLesson.id, score)}
        />
      )}
    </div>
  );
}
