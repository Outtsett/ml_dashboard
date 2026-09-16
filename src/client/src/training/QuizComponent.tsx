import { useState, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, XCircle, HelpCircle, ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/shared/ui/card";
import { Button } from "@/shared/ui/button";
import type { QuizQuestion } from "@/training/curriculum_types";

function AnimatedScore({ value }: { value: number }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    let frame: number;
    const start = performance.now();
    const duration = 800;
    const animate = (now: number) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(eased * value));
      if (progress < 1) frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return <>{display}</>;
}

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

  // Derive the correct option ID — supports both explicit correctOptionId and option-level flags
  const correctOptionId = q
    ? q.correctOptionId ?? q.options.find((o) => o.isCorrect || o.correct)?.id ?? ""
    : "";
  const questionText = q ? (q.question ?? q.text ?? "") : "";
  const isCorrect = selectedId === correctOptionId;

  const handleSelect = useCallback(
    (optionId: string) => {
      if (answered) return;
      setSelectedId(optionId);
    },
    [answered]
  );

  const handleSubmit = useCallback(() => {
    if (!selectedId || !q) return;
    setAnswered(true);
    if (selectedId === correctOptionId) {
      setCorrectCount((c) => c + 1);
    }
  }, [selectedId, q, correctOptionId]);

  const handleNext = useCallback(() => {
    if (currentIdx + 1 >= questions.length) {
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
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 200, damping: 20 }}
      >
        <Card className="border-border/40 bg-card/60">
          <CardContent className="p-6 text-center space-y-4">
            <div className="text-4xl">{emoji}</div>
            {score >= 80 && (
              <motion.div
                className="flex justify-center gap-1"
                initial="hidden"
                animate="show"
                variants={{ hidden: {}, show: { transition: { staggerChildren: 0.04 } } }}
              >
                {["🎊", "⭐", "✨", "🌟", "⭐", "✨", "🎊"].map((e, i) => (
                  <motion.span
                    key={i}
                    variants={{
                      hidden: { opacity: 0, y: 20, scale: 0 },
                      show: { opacity: 1, y: 0, scale: 1, transition: { type: "spring", stiffness: 300, damping: 15 } },
                    }}
                    className="text-lg"
                  >
                    {e}
                  </motion.span>
                ))}
              </motion.div>
            )}
            <h3 className="text-xl font-semibold">Quiz Complete!</h3>
            <p className="text-muted-foreground">
              You got{" "}
              <span className="text-foreground font-bold">
                {correctCount}/{questions.length}
              </span>{" "}
              correct (<AnimatedScore value={score} />%)
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
      </motion.div>
    );
  }

  if (!q) return null;

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
        <p className="text-sm font-medium leading-relaxed">{questionText}</p>

        {/* Options */}
        <div className="space-y-2">
          {q.options.map((opt) => {
            let optionStyle = "border-border/30 hover:border-primary/40 hover:bg-primary/5";
            if (answered) {
              if (opt.id === correctOptionId) {
                optionStyle = "border-[hsl(var(--data-pos)/0.6)] bg-[hsl(var(--data-pos)/0.1)]";
              } else if (opt.id === selectedId) {
                optionStyle = "border-[hsl(var(--data-neg)/0.6)] bg-[hsl(var(--data-neg)/0.1)]";
              } else {
                optionStyle = "border-border/20 opacity-50";
              }
            } else if (opt.id === selectedId) {
              optionStyle = "border-primary/60 bg-primary/10";
            }

            return (
              <motion.button
                key={opt.id}
                onClick={() => handleSelect(opt.id)}
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.99 }}
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
                    {answered && opt.id === correctOptionId && (
                      <CheckCircle2 className="h-4 w-4 text-[hsl(var(--data-pos))]" />
                    )}
                    {answered &&
                      opt.id === selectedId &&
                      opt.id !== correctOptionId && (
                        <XCircle className="h-4 w-4 text-[hsl(var(--data-neg))]" />
                      )}
                  </div>
                  <span>{opt.text}</span>
                </div>
              </motion.button>
            );
          })}
        </div>

        {/* Explanation */}
        <AnimatePresence>
          {answered && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
            >
              <div
                className={`rounded-lg p-4 text-sm ${
                  isCorrect
                    ? "bg-[hsl(var(--data-pos)/0.1)] border border-[hsl(var(--data-pos)/0.3)]"
                    : "bg-amber-500/10 border border-amber-500/30"
                }`}
              >
                <p className="font-medium mb-1">
                  {isCorrect ? "✓ Correct!" : "✗ Not quite."}
                </p>
                <p className="text-muted-foreground">{q.explanation}</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

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
