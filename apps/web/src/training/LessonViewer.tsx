import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Target,
  BookOpen,
  Lightbulb,
  Code2,
  HelpCircle,
  Wrench,
  CheckCircle2,
  Clock,
  ArrowLeft,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  Bookmark,
  BookmarkCheck,
  StickyNote,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { ScrollArea } from "@/shared/ui/scroll-area";
import { CodeBlock } from "./CodeBlock";
import { QuizComponent } from "./QuizComponent";
import { useSectionProgress, useMarkSectionViewed, useBookmarks, useToggleBookmark, useUpdateNote } from "@/training/lib/useCurriculum";
import { useTimeTracker } from "@/system/lib/useTimeTracker";
import type { Lesson, LessonSection, LessonProgress } from "@/training/curriculum_types";

interface LessonViewerProps {
  lesson: Lesson;
  progress?: LessonProgress;
  onBack: () => void;
  onComplete: (score: number) => void;
  onNavigateToCatalog?: (modelId: string) => void;
  onPrevLesson?: () => void;
  onNextLesson?: () => void;
  prevLessonTitle?: string;
  nextLessonTitle?: string;
}

function truncateTitle(title: string, max = 30): string {
  return title.length > max ? `${title.slice(0, max)}…` : title;
}

function formatMinutes(ms: number): string {
  return Math.round(ms / 60000) + "m";
}

const difficultyColors = {
  beginner: "bg-[hsl(var(--data-pos)/0.15)] text-[hsl(var(--data-pos))] border-[hsl(var(--data-pos)/0.3)]",
  intermediate: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  advanced: "bg-[hsl(var(--data-neg)/0.15)] text-[hsl(var(--data-neg))] border-[hsl(var(--data-neg)/0.3)]",
};

function SectionIcon({ type }: { type: LessonSection["type"] }) {
  const icons = {
    objective: <Target className="h-4 w-4 text-blue-400" />,
    theory: <BookOpen className="h-4 w-4 text-violet-400" />,
    intuition: <Lightbulb className="h-4 w-4 text-amber-400" />,
    code: <Code2 className="h-4 w-4 text-[hsl(var(--data-pos))]" />,
    quiz: <HelpCircle className="h-4 w-4 text-pink-400" />,
    practice: <Wrench className="h-4 w-4 text-cyan-400" />,
  };
  return icons[type] ?? null;
}

function SectionLabel({ type }: { type: LessonSection["type"] }) {
  const labels = {
    objective: "Learning Objective",
    theory: "Theory",
    intuition: "Intuition",
    code: "Code Example",
    quiz: "Knowledge Check",
    practice: "Practice",
  };
  return <>{labels[type]}</>;
}

export function LessonViewer({
  lesson,
  progress,
  onBack,
  onComplete,
  onNavigateToCatalog,
  onPrevLesson,
  onNextLesson,
  prevLessonTitle,
  nextLessonTitle,
}: LessonViewerProps) {
  const isCompleted = progress?.status === "completed";
  const { elapsedMs, isTracking } = useTimeTracker(lesson.id);

  // Total time spent = previously recorded + current session
  const totalTimeMs = (progress?.timeSpentMs ?? 0) + elapsedMs;
  const estimatedMs = lesson.estimatedMinutes * 60000;
  const timeColor =
    totalTimeMs > estimatedMs * 2
      ? "text-[hsl(var(--data-neg))]"
      : totalTimeMs > estimatedMs * 1.5
        ? "text-amber-400"
        : "text-muted-foreground";

  // ─── Section progress tracking ───────────────────────────────────
  const { data: viewedSections = [] } = useSectionProgress(lesson.id);
  const markViewed = useMarkSectionViewed();
  const sectionRefs = useRef<(HTMLDivElement | null)[]>([]);
  const viewTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const setSectionRef = useCallback((el: HTMLDivElement | null, idx: number) => {
    sectionRefs.current[idx] = el;
  }, []);

  useEffect(() => {
    sectionRefs.current = sectionRefs.current.slice(0, lesson.sections.length);
  }, [lesson.sections.length]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const idx = Number(entry.target.getAttribute("data-section-index"));
          if (isNaN(idx)) return;

          if (entry.isIntersecting) {
            if (!viewTimers.current.has(idx)) {
              const timer = setTimeout(() => {
                markViewed.mutate({ lessonId: lesson.id, sectionIndex: idx });
                viewTimers.current.delete(idx);
              }, 2000);
              viewTimers.current.set(idx, timer);
            }
          } else {
            const timer = viewTimers.current.get(idx);
            if (timer) {
              clearTimeout(timer);
              viewTimers.current.delete(idx);
            }
          }
        });
      },
      { threshold: 0.5 }
    );

    sectionRefs.current.forEach((ref) => ref && observer.observe(ref));

    return () => {
      observer.disconnect();
      viewTimers.current.forEach((timer) => clearTimeout(timer));
      viewTimers.current.clear();
    };
  }, [lesson.id, lesson.sections.length, markViewed]);

  const viewedSet = useMemo(() => new Set(viewedSections), [viewedSections]);
  const viewedCount = viewedSet.size;
  const totalSections = lesson.sections.length;

  // ─── Bookmarks & notes ──────────────────────────────────────────
  const { data: bookmarks = [] } = useBookmarks();
  const toggleBookmark = useToggleBookmark();
  const updateNote = useUpdateNote();

  const currentBookmark = useMemo(
    () => bookmarks.find((b) => b.lessonId === lesson.id),
    [bookmarks, lesson.id]
  );
  const isBookmarked = !!currentBookmark;

  const [showNotes, setShowNotes] = useState(false);
  const [noteText, setNoteText] = useState("");
  const noteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync note text when bookmark data changes
  useEffect(() => {
    setNoteText(currentBookmark?.note ?? "");
  }, [currentBookmark?.note]);

  const handleNoteChange = useCallback(
    (value: string) => {
      setNoteText(value);
      if (noteTimerRef.current) clearTimeout(noteTimerRef.current);
      noteTimerRef.current = setTimeout(() => {
        updateNote.mutate({ lessonId: lesson.id, note: value });
      }, 500);
    },
    [lesson.id, updateNote]
  );

  const handleNoteBlur = useCallback(() => {
    if (noteTimerRef.current) {
      clearTimeout(noteTimerRef.current);
      noteTimerRef.current = null;
    }
    updateNote.mutate({ lessonId: lesson.id, note: noteText });
  }, [lesson.id, noteText, updateNote]);

  // Cleanup timer
  useEffect(() => {
    return () => {
      if (noteTimerRef.current) clearTimeout(noteTimerRef.current);
    };
  }, []);

  const renderedSections = lesson.sections.map((section, idx) => (
        <motion.div
          key={idx}
          ref={(el) => setSectionRef(el, idx)}
          data-section-index={idx}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: idx * 0.08, ease: "easeOut" }}
          className="space-y-3"
        >
          {/* Section header */}
          <div className="flex items-center gap-2 pt-2">
            <div className="p-1.5 rounded-md bg-muted/30">
              <SectionIcon type={section.type} />
            </div>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              <SectionLabel type={section.type} />
            </h3>
          </div>

          {/* Section content */}
          {section.type === "objective" && (
            <Card className="border-blue-500/20 bg-blue-500/5">
              <CardContent className="p-4 space-y-3">
                <p className="text-sm leading-relaxed">{section.content || section.description}</p>
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Key Takeaways
                  </p>
                  {section.keyTakeaways.map((t, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm">
                      <CheckCircle2 className="h-3.5 w-3.5 text-blue-400 mt-0.5 flex-shrink-0" />
                      <span className="text-foreground/80">{t}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {section.type === "theory" && (
            <Card className="border-violet-500/20 bg-violet-500/5">
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-base font-semibold">
                  {section.title}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <div className="text-sm leading-relaxed text-foreground/85 whitespace-pre-line">
                  {section.content}
                </div>
              </CardContent>
            </Card>
          )}

          {section.type === "intuition" && (
            <Card className="border-amber-500/20 bg-amber-500/5">
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  {section.emoji && <span className="text-lg">{section.emoji}</span>}
                  {section.title}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-2">
                <p className="text-sm italic text-amber-300/80">
                  Analogy: {section.analogy}
                </p>
                <p className="text-sm leading-relaxed text-foreground/85 whitespace-pre-line">
                  {section.content}
                </p>
              </CardContent>
            </Card>
          )}

          {section.type === "code" && (
            <div className="space-y-2">
              <CodeBlock
                code={section.code}
                language={section.language}
                title={section.title}
              />
              <p className="text-sm text-muted-foreground leading-relaxed px-1">
                {section.explanation}
              </p>
            </div>
          )}

          {section.type === "quiz" && (
            <QuizComponent
              questions={section.questions}
              onComplete={onComplete}
            />
          )}

          {section.type === "practice" && (
            <Card className="border-cyan-500/20 bg-cyan-500/5">
              <CardContent className="p-4 space-y-3">
                <h4 className="text-sm font-semibold">{section.title}</h4>
                <p className="text-sm text-foreground/80 leading-relaxed">
                  {section.description}
                </p>
                <div className="flex gap-2">
                  {section.catalogModelId && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        onNavigateToCatalog?.(section.catalogModelId!)
                      }
                      className="text-xs"
                    >
                      <ExternalLink className="h-3 w-3 mr-1.5" />
                      Open in Model Catalog
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </motion.div>
      ));

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="shrink-0 border-b border-border/30 px-6 py-4">
        <div className="flex items-center gap-3 mb-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
            className="text-xs text-muted-foreground hover:text-foreground -ml-2"
          >
            <ArrowLeft className="h-3.5 w-3.5 mr-1" />
            Back
          </Button>
        </div>
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl font-display font-bold tracking-tight">
              {lesson.title}
            </h1>
            <p className="text-sm text-muted-foreground">
              {lesson.description}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className={difficultyColors[lesson.difficulty]}
            >
              {lesson.difficulty}
            </Badge>
            <Badge variant="outline" className="text-muted-foreground">
              <Clock className="h-3 w-3 mr-1" />
              {lesson.estimatedMinutes} min
            </Badge>
            <Badge variant="outline" className={timeColor}>
              {isTracking && (
                <span className="relative mr-1.5 flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-current opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-current" />
                </span>
              )}
              {formatMinutes(totalTimeMs)} spent / {formatMinutes(estimatedMs)} est.
            </Badge>
            {isCompleted && (
              <Badge className="bg-[hsl(var(--data-pos)/0.2)] text-[hsl(var(--data-pos))] border-[hsl(var(--data-pos)/0.3)]">
                <CheckCircle2 className="h-3 w-3 mr-1" />
                {progress?.score != null ? `${progress.score}%` : "Done"}
              </Badge>
            )}
            <motion.button
              whileTap={{ scale: 0.85 }}
              onClick={() => toggleBookmark.mutate(lesson.id)}
              className="p-1.5 rounded-md hover:bg-muted/30 transition-colors"
              title={isBookmarked ? "Remove bookmark" : "Bookmark this lesson"}
            >
              {isBookmarked ? (
                <BookmarkCheck className="h-4 w-4 text-amber-400" />
              ) : (
                <Bookmark className="h-4 w-4 text-muted-foreground" />
              )}
            </motion.button>
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={() => setShowNotes((v) => !v)}
              className={`p-1.5 rounded-md hover:bg-muted/30 transition-colors ${showNotes ? "bg-muted/20" : ""}`}
              title="Notes"
            >
              <StickyNote className={`h-4 w-4 ${currentBookmark?.note ? "text-blue-400" : "text-muted-foreground"}`} />
            </motion.button>
          </div>
        </div>

        {/* Section progress dots */}
        <div className="flex items-center gap-2 mt-3">
          <div className="flex items-center gap-1">
            {lesson.sections.map((_, idx) => (
              <div
                key={idx}
                className={`h-2 w-2 rounded-full transition-colors duration-300 ${
                  viewedSet.has(idx)
                    ? "bg-[hsl(var(--data-pos))]"
                    : "border border-muted-foreground/40 bg-transparent"
                }`}
                title={`Section ${idx + 1}: ${lesson.sections[idx]?.type ?? "unknown"}`}
              />
            ))}
          </div>
          <span className="text-xs text-muted-foreground">
            {viewedCount}/{totalSections} sections viewed
          </span>
        </div>

        {/* Collapsible notes */}
        <AnimatePresence>
          {showNotes && (
            <motion.div
              // scaleY + opacity reveal stays on the compositor (height:auto tweening forces per-frame layout)
              initial={{ scaleY: 0.95, opacity: 0 }}
              animate={{ scaleY: 1, opacity: 1 }}
              exit={{ scaleY: 0.95, opacity: 0 }}
              style={{ originY: 0 }}
              transition={{ duration: 0.2, ease: "easeInOut" }}
              className="overflow-hidden"
            >
              <textarea
                value={noteText}
                onChange={(e) => handleNoteChange(e.target.value)}
                onBlur={handleNoteBlur}
                placeholder="Add your notes for this lesson..."
                className="w-full mt-3 bg-muted/10 border border-border/30 rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring/40 resize-none transition-colors"
                style={{ maxHeight: "150px", minHeight: "80px" }}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <ScrollArea className="flex-1 min-h-0">
        <div className="max-w-3xl mx-auto px-6 py-6 space-y-6">
          {renderedSections}
        </div>
      </ScrollArea>

      {/* Prev / Next navigation */}
      {(onPrevLesson || onNextLesson) && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, delay: 0.15, ease: "easeOut" }}
          className="shrink-0 border-t border-border/30 px-6 py-3 flex items-center justify-between"
        >
          <div>
            {onPrevLesson && prevLessonTitle && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onPrevLesson}
                className="text-xs text-muted-foreground hover:text-foreground gap-1"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                <span>
                  Previous:{" "}
                  <span className="text-muted-foreground/70">
                    {truncateTitle(prevLessonTitle)}
                  </span>
                </span>
              </Button>
            )}
          </div>
          <div>
            {onNextLesson && nextLessonTitle && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onNextLesson}
                className="text-xs text-muted-foreground hover:text-foreground gap-1"
              >
                <span>
                  Next:{" "}
                  <span className="text-muted-foreground/70">
                    {truncateTitle(nextLessonTitle)}
                  </span>
                </span>
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </motion.div>
      )}
    </div>
  );
}
