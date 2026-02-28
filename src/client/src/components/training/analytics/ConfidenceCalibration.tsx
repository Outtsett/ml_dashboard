/**
 * ConfidenceCalibration — Evaluation test results and overall grade.
 *
 * SRP: Renders evaluation pass/fail badges + grade. No business logic.
 * DIP: Reads from diagnostics.evaluation (populated by Python evaluation.py).
 */

import { CheckCircle, XCircle, AlertCircle } from "lucide-react";
import type { AnalyticsComponentProps } from "./index";
import { ChartCard, EmptyState } from "./shared";

interface TestResult {
  value: number | null;
  passed: boolean;
  p_value: number | null;
  details?: Record<string, unknown>;
}

const GRADE_COLORS: Record<string, string> = {
  A: "text-emerald-400 bg-emerald-500/15",
  B: "text-blue-400 bg-blue-500/15",
  C: "text-amber-400 bg-amber-500/15",
  D: "text-orange-400 bg-orange-500/15",
  F: "text-rose-400 bg-rose-500/15",
};

const TEST_LABELS: Record<string, string> = {
  silhouette_score: "Silhouette Score",
  calinski_harabasz: "Calinski-Harabasz Index",
  davies_bouldin: "Davies-Bouldin Index",
  return_separation: "Return Separation (t-test)",
  volatility_separation: "Volatility Separation (Levene)",
  min_duration: "Minimum Regime Duration",
  permutation_test: "Permutation Significance",
  bootstrap_ci: "Bootstrap Confidence Interval",
};

export default function ConfidenceCalibration({ diagnostics }: AnalyticsComponentProps) {
  const evaluation = (diagnostics as any).evaluation as {
    stage1: Record<string, TestResult>;
    stage2: Record<string, TestResult>;
    grade: string;
  } | undefined;

  if (!evaluation) {
    return (
      <ChartCard title="Evaluation Results" className="lg:col-span-2">
        <EmptyState message="No evaluation data" hint="Evaluation runs automatically after training" />
      </ChartCard>
    );
  }

  const { stage1, stage2, grade } = evaluation;
  const gradeStyle = GRADE_COLORS[grade] || GRADE_COLORS.F;

  const renderTests = (tests: Record<string, TestResult>, stageLabel: string) => (
    <div>
      <h5 className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/50 mb-2">{stageLabel}</h5>
      <div className="space-y-1.5">
        {Object.entries(tests).map(([name, result]) => (
          <div key={name} className="flex items-center gap-2 bg-white/[0.02] rounded-lg px-3 py-1.5">
            {result.passed
              ? <CheckCircle className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
              : <XCircle className="h-3.5 w-3.5 text-rose-400 shrink-0" />
            }
            <span className="text-[10px] flex-1">{TEST_LABELS[name] || name}</span>
            {result.value != null && (
              <span className="text-[9px] font-mono text-muted-foreground/50">
                {result.value.toFixed(3)}
              </span>
            )}
            {result.p_value != null && (
              <span className="text-[9px] font-mono text-muted-foreground/40">
                p={result.p_value.toFixed(4)}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <ChartCard
      title="Evaluation Results"
      className="lg:col-span-2"
      badge={
        <span className={`text-lg font-bold font-mono px-3 py-1 rounded-lg ${gradeStyle}`}>
          {grade}
        </span>
      }
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {renderTests(stage1, "Stage 1: Regime Quality")}
        {Object.keys(stage2).length > 0
          ? renderTests(stage2, "Stage 2: Statistical Significance")
          : (
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground/40">
              <AlertCircle className="h-3.5 w-3.5" />
              Stage 2 not run (enable --run-significance-tests)
            </div>
          )
        }
      </div>
    </ChartCard>
  );
}
