import { useState, useMemo } from "react";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Clock,
  CheckCircle2,
  Circle,
  PlayCircle,
  Lock,
} from "lucide-react";
import { Card } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { ScrollArea } from "@/shared/ui/scroll-area";
import { ProgressRing } from "./ProgressRing";
import type { LearningPath } from "@/training/lib/types";
import type { LessonProgress, Lesson } from "@/training/curriculum_types";

interface LearningPathViewProps {
  path: LearningPath;
  progress: LessonProgress[];
  onBack: () => void;
  onSelectLesson: (lessonId: string) => void;
}

const difficultyColors: Record<string, string> = {
  beginner: "text-emerald-400",
  intermediate: "text-amber-400",
  advanced: "text-rose-400",
};

function LessonStatusIcon({ status }: { status?: string }) {
  if (status === "completed")
    return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
  if (status === "in_progress")
    return <PlayCircle className="h-4 w-4 text-amber-500" />;
  return <Circle className="h-4 w-4 text-muted-foreground/30" />;
}

function formatMinutes(ms: number): string {
  return Math.round(ms / 60000) + "m";
}

export function LearningPathView({
  path,
  progress,
  onBack,
  onSelectLesson,
}: LearningPathViewProps) {
  const [expandedModules, setExpandedModules] = useState<Set<string>>(
    () => new Set(path.modules.map((m) => m.id))
  );

  const toggleModule = (moduleId: string) => {
    setExpandedModules((prev) => {
      const next = new Set(prev);
      if (next.has(moduleId)) next.delete(moduleId);
      else next.add(moduleId);
      return next;
    });
  };

  const progressMap = new Map(progress.map((p) => [p.lessonId, p]));
  const totalLessons = path.modules.reduce((s, m) => s + m.lessons.length, 0);
  const completedLessons = progress.filter((p) => p.status === "completed").length;
  const pct = totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0;

  // Build a flat map of all lessons for prerequisite title lookups
  const lessonMap = useMemo(() => {
    const map = new Map<string, Lesson>();
    for (const mod of path.modules) {
      for (const l of mod.lessons) map.set(l.id, l);
    }
    return map;
  }, [path]);

  /** Returns titles of unmet prerequisites, or empty array if all met */
  const getUnmetPrereqs = (lesson: Lesson): string[] => {
    if (!lesson.prerequisites?.length) return [];
    return lesson.prerequisites
      .filter((id) => progressMap.get(id)?.status !== "completed")
      .map((id) => lessonMap.get(id)?.title ?? id);
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="shrink-0 border-b border-border/30 px-6 py-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="text-xs text-muted-foreground hover:text-foreground -ml-2 mb-3"
        >
          <ArrowLeft className="h-3.5 w-3.5 mr-1" />
          All Paths
        </Button>
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl font-display font-bold tracking-tight">
              {path.title}
            </h1>
            <p className="text-sm text-muted-foreground">{path.description}</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right text-xs text-muted-foreground space-y-0.5">
              <div>{completedLessons}/{totalLessons} lessons</div>
              <div className="flex items-center gap-1 justify-end">
                <Clock className="h-3 w-3" />
                {path.estimatedHours}h estimated
              </div>
            </div>
            <ProgressRing value={pct} size={52} strokeWidth={4} />
          </div>
        </div>
      </div>

      {/* Modules */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="max-w-3xl mx-auto px-6 py-6 space-y-4">
          {path.modules.map((mod, modIdx) => {
            const isExpanded = expandedModules.has(mod.id);
            const modCompleted = mod.lessons.filter(
              (l) => progressMap.get(l.id)?.status === "completed"
            ).length;
            const modPct =
              mod.lessons.length > 0
                ? Math.round((modCompleted / mod.lessons.length) * 100)
                : 0;

            return (
              <Card
                key={mod.id}
                className="border-border/30 bg-card/40 overflow-hidden"
              >
                {/* Module header */}
                <button
                  onClick={() => toggleModule(mod.id)}
                  className="w-full px-5 py-4 flex items-center gap-4 hover:bg-muted/20 transition-colors"
                >
                  <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-muted/30 text-sm font-mono font-bold text-muted-foreground">
                    {modIdx + 1}
                  </div>
                  <div className="flex-1 text-left">
                    <h3 className="text-sm font-semibold">{mod.title}</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {mod.description}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground">
                      {modCompleted}/{mod.lessons.length}
                    </span>
                    <ProgressRing
                      value={modPct}
                      size={32}
                      strokeWidth={3}
                      showLabel={false}
                    />
                    {isExpanded ? (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                </button>

                {/* Lesson list */}
                {isExpanded && (
                  <div className="border-t border-border/20">
                    {mod.lessons.map((lesson, _lesIdx) => {
                      const lp = progressMap.get(lesson.id);
                      const unmet = getUnmetPrereqs(lesson);
                      const isLocked = unmet.length > 0;
                      const lockTooltip = isLocked
                        ? `Complete ${unmet.map((t) => `'${t}'`).join(", ")} first`
                        : undefined;

                      return (
                        <button
                          key={lesson.id}
                          onClick={() => {
                            if (isLocked) {
                              if (
                                window.confirm(
                                  `This lesson has unmet prerequisites.\n\n${lockTooltip}\n\nContinue anyway?`
                                )
                              ) {
                                onSelectLesson(lesson.id);
                              }
                              return;
                            }
                            onSelectLesson(lesson.id);
                          }}
                          title={lockTooltip}
                          className={`w-full px-5 py-3 flex items-center gap-3 hover:bg-muted/15 transition-colors border-b border-border/10 last:border-b-0${
                            isLocked ? " opacity-50" : ""
                          }`}
                        >
                          {isLocked ? (
                            <Lock className="h-4 w-4 text-muted-foreground/50" />
                          ) : (
                            <LessonStatusIcon status={lp?.status} />
                          )}
                          <div className="flex-1 text-left">
                            <span className="text-sm font-medium">
                              {lesson.title}
                            </span>
                            <span className="text-xs text-muted-foreground ml-2">
                              {lesson.description}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge
                              variant="outline"
                              className={`text-[10px] border-none ${difficultyColors[lesson.difficulty]}`}
                            >
                              {lesson.difficulty}
                            </Badge>
                            <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                              <Clock className="h-2.5 w-2.5" />
                              {lp?.timeSpentMs && lp.timeSpentMs > 0
                                ? `${formatMinutes(lp.timeSpentMs)} / ${lesson.estimatedMinutes}m`
                                : `${lesson.estimatedMinutes}m`}
                            </span>
                            {lp?.score != null && (
                              <Badge
                                variant="outline"
                                className="text-[10px] bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                              >
                                {lp.score}%
                              </Badge>
                            )}
                            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50" />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
