import { useMemo } from "react";
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
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CodeBlock } from "./CodeBlock";
import { QuizComponent } from "./QuizComponent";
import type { Lesson, LessonSection, LessonProgress } from "@/lib/curriculum/types";

interface LessonViewerProps {
  lesson: Lesson;
  progress?: LessonProgress;
  onBack: () => void;
  onComplete: (score: number) => void;
  onNavigateToCatalog?: (modelId: string) => void;
}

const difficultyColors = {
  beginner: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  intermediate: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  advanced: "bg-rose-500/15 text-rose-400 border-rose-500/30",
};

function SectionIcon({ type }: { type: LessonSection["type"] }) {
  const icons = {
    objective: <Target className="h-4 w-4 text-blue-400" />,
    theory: <BookOpen className="h-4 w-4 text-violet-400" />,
    intuition: <Lightbulb className="h-4 w-4 text-amber-400" />,
    code: <Code2 className="h-4 w-4 text-emerald-400" />,
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
}: LessonViewerProps) {
  const isCompleted = progress?.status === "completed";

  const renderedSections = useMemo(
    () =>
      lesson.sections.map((section, idx) => (
        <div key={idx} className="space-y-3">
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
                <p className="text-sm leading-relaxed">{section.content}</p>
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
        </div>
      )),
    [lesson.sections, onComplete, onNavigateToCatalog]
  );

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
            {isCompleted && (
              <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
                <CheckCircle2 className="h-3 w-3 mr-1" />
                {progress?.score != null ? `${progress.score}%` : "Done"}
              </Badge>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="max-w-3xl mx-auto px-6 py-6 space-y-6">
          {renderedSections}
        </div>
      </ScrollArea>
    </div>
  );
}
