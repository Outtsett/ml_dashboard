import { useState, useCallback } from "react";
import { CheckCircle2, XCircle, HelpCircle, ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { QuizQuestion } from "@/lib/curriculum/types";

interface QuizComponentProps {
  questions: QuizQuestion[];
  onComplete?: (score: number) => void;
}

export function QuizComponent({ questions, onComplete }: QuizComponentProps) {
  const [currentIdx, setCurrentIdx] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [answered, setAnswered] = useState(false);
  const [correctCount, setCorrectCount] = useState(0);
  const [finished, setFinished] = useState(false);

  const q = questions[currentIdx];
  const isCorrect = selectedId === q?.correctOptionId;

  const handleSelect = useCallback(
    (optionId: string) => {
      if (answered) return;
      setSelectedId(optionId);
    },
    [answered]
  );

  const handleSubmit = useCallback(() => {
    if (!selectedId) return;
    setAnswered(true);
    if (selectedId === q.correctOptionId) {
      setCorrectCount((c) => c + 1);
    }
  }, [selectedId, q]);

  const handleNext = useCallback(() => {
    if (currentIdx + 1 >= questions.length) {
      const finalCorrect = correctCount + (isCorrect ? 0 : 0); // already counted
      const score = Math.round((correctCount / questions.length) * 100);
      setFinished(true);
      onComplete?.(score);
      return;
    }
    setCurrentIdx((i) => i + 1);
    setSelectedId(null);
    setAnswered(false);
  }, [currentIdx, questions.length, correctCount, isCorrect, onComplete]);

  if (finished) {
    const score = Math.round((correctCount / questions.length) * 100);
    const emoji = score >= 80 ? "🎉" : score >= 50 ? "👍" : "📚";
    return (
      <Card className="border-border/40 bg-card/60">
        <CardContent className="p-6 text-center space-y-4">
          <div className="text-4xl">{emoji}</div>
          <h3 className="text-xl font-semibold">Quiz Complete!</h3>
          <p className="text-muted-foreground">
            You got{" "}
            <span className="text-foreground font-bold">
              {correctCount}/{questions.length}
            </span>{" "}
            correct ({score}%)
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setCurrentIdx(0);
              setSelectedId(null);
              setAnswered(false);
              setCorrectCount(0);
              setFinished(false);
            }}
          >
            Retry Quiz
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/40 bg-card/60">
      <CardContent className="p-6 space-y-4">
        {/* Progress */}
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <HelpCircle className="h-3.5 w-3.5" />
            Question {currentIdx + 1} of {questions.length}
          </span>
          <div className="flex gap-1">
            {questions.map((_, i) => (
              <div
                key={i}
                className={`w-2 h-2 rounded-full ${
                  i < currentIdx
                    ? "bg-primary"
                    : i === currentIdx
                      ? "bg-primary/50"
                      : "bg-muted/40"
                }`}
              />
            ))}
          </div>
        </div>

        {/* Question */}
        <p className="text-sm font-medium leading-relaxed">{q.question}</p>

        {/* Options */}
        <div className="space-y-2">
          {q.options.map((opt) => {
            let optionStyle = "border-border/30 hover:border-primary/40 hover:bg-primary/5";
            if (answered) {
              if (opt.id === q.correctOptionId) {
                optionStyle = "border-emerald-500/60 bg-emerald-500/10";
              } else if (opt.id === selectedId) {
                optionStyle = "border-red-500/60 bg-red-500/10";
              } else {
                optionStyle = "border-border/20 opacity-50";
              }
            } else if (opt.id === selectedId) {
              optionStyle = "border-primary/60 bg-primary/10";
            }

            return (
              <button
                key={opt.id}
                onClick={() => handleSelect(opt.id)}
                className={`w-full text-left px-4 py-3 rounded-lg border text-sm transition-all ${optionStyle}`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                      opt.id === selectedId
                        ? "border-primary bg-primary/20"
                        : "border-muted-foreground/30"
                    }`}
                  >
                    {answered && opt.id === q.correctOptionId && (
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    )}
                    {answered &&
                      opt.id === selectedId &&
                      opt.id !== q.correctOptionId && (
                        <XCircle className="h-4 w-4 text-red-500" />
                      )}
                  </div>
                  <span>{opt.text}</span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Explanation */}
        {answered && (
          <div
            className={`rounded-lg p-4 text-sm ${
              isCorrect
                ? "bg-emerald-500/10 border border-emerald-500/30"
                : "bg-amber-500/10 border border-amber-500/30"
            }`}
          >
            <p className="font-medium mb-1">
              {isCorrect ? "✓ Correct!" : "✗ Not quite."}
            </p>
            <p className="text-muted-foreground">{q.explanation}</p>
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end">
          {!answered ? (
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={!selectedId}
            >
              Check Answer
            </Button>
          ) : (
            <Button size="sm" onClick={handleNext}>
              {currentIdx + 1 >= questions.length ? "See Results" : "Next"}
              <ChevronRight className="h-3.5 w-3.5 ml-1" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
