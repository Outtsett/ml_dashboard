/**
 * ConfidenceCalibration — Evaluation test results and overall grade.
 *
 * SRP: Renders evaluation pass/fail badges + grade. No business logic.
 * DIP: Reads from diagnostics.evaluation (populated by Python evaluation.py).
 */

import { useState } from "react";
import { CheckCircle, XCircle } from "lucide-react";
import type { AnalyticsComponentProps } from "./index";
import type { EvaluationTestResult } from "@/training/lib/types";
import { ChartCard, EmptyState } from "./shared";

const GRADE_COLORS: Record<string, string> = {
  A: "text-[hsl(var(--data-pos))] bg-[hsl(var(--data-pos)/0.15)]",
  B: "text-blue-400 bg-blue-500/15",
  C: "text-amber-400 bg-amber-500/15",
  D: "text-orange-400 bg-orange-500/15",
  F: "text-[hsl(var(--data-neg))] bg-[hsl(var(--data-neg)/0.15)]",
};

const STAGE_LABELS: Record<string, string> = {
  stage1: "Stage 1: Regime Quality",
  stage2: "Stage 2: Statistical Significance",
  stage3: "Stage 3: OOS Validation",
  stage4: "Stage 4: Conditioned Performance",
  stage5: "Stage 5: Benchmarking",
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
  // Stage 3
  oos_confidence_calibration: "OOS Confidence Calibration",
  oos_return_separation: "OOS Return Separation",
  regime_transition_prediction: "Transition Prediction",
  regime_distribution_drift: "Distribution Drift",
  // Stage 4
  regime_sharpe: "Regime Sharpe Ratio",
  long_bull_short_bear: "Long Bull / Short Bear",
  transition_returns: "Transition Returns",
  stability_premium: "Stability Premium",
  max_regime_drawdown: "Max Regime Drawdown",
  // Stage 5
  vs_buy_and_hold: "vs. Buy & Hold",
  vs_sma_crossover: "vs. SMA Crossover",
  regime_information_ratio: "Information Ratio",
};

export default function ConfidenceCalibration({ diagnostics }: AnalyticsComponentProps) {
  const evaluation = diagnostics.evaluation;
  const [expandedTest, setExpandedTest] = useState<string | null>(null);

  if (!evaluation) {
    return (
      <ChartCard title="Evaluation Results" className="lg:col-span-2">
        <EmptyState message="No evaluation data" hint="Evaluation runs automatically after training" />
      </ChartCard>
    );
  }

  const { grade } = evaluation;
  const gradeStyle = GRADE_COLORS[grade] || GRADE_COLORS.F;

  const renderTests = (tests: Record<string, EvaluationTestResult>, stageLabel: string) => (
    <div>
      <h5 className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/50 mb-2">{stageLabel}</h5>
      <div className="space-y-1.5">
        {Object.entries(tests).map(([name, result]) => (
          <div key={name}>
            <div
              className="flex items-center gap-2 bg-white/[0.02] rounded-lg px-3 py-1.5 cursor-pointer hover:bg-white/[0.04] transition-colors"
              onClick={() => setExpandedTest(expandedTest === name ? null : name)}
            >
              {result.passed
                ? <CheckCircle className="h-3.5 w-3.5 text-[hsl(var(--data-pos))] shrink-0" />
                : <XCircle className="h-3.5 w-3.5 text-[hsl(var(--data-neg))] shrink-0" />
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
              <span className="text-[8px] text-muted-foreground/30">
                {expandedTest === name ? "\u25BE" : "\u25B8"}
              </span>
            </div>
            {expandedTest === name && result.details && Object.keys(result.details).length > 0 && (
              <div className="ml-6 mt-1 mb-1 bg-white/[0.015] rounded-lg px-3 py-2 space-y-0.5">
                {Object.entries(result.details).map(([key, val]) => (
                  <div key={key} className="flex justify-between text-[8px]">
                    <span className="text-muted-foreground/40">{key.replace(/_/g, " ")}</span>
                    <span className="font-mono text-muted-foreground/60">
                      {typeof val === "number" ? val.toFixed(4) : String(val)}
                    </span>
                  </div>
                ))}
              </div>
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
      <div className="space-y-4">
        {(["stage1", "stage2", "stage3", "stage4", "stage5"] as const).map((stageKey) => {
          const stageData = evaluation[stageKey];
          if (!stageData || Object.keys(stageData).length === 0) return null;
          return (
            <div key={stageKey}>
              {renderTests(stageData, STAGE_LABELS[stageKey] || stageKey)}
            </div>
          );
        })}
      </div>
    </ChartCard>
  );
}
