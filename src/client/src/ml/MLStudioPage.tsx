/**
 * ML Studio — Stage-driven, end-to-end pipeline shell.
 *
 * No chart inside this page. The chart lives on the Market Data tab (`/`) and
 * is reachable via dashboard.navigateToChart(). Stages push trade markers and
 * highlight ranges through UnifiedDashboardContext rather than embedding
 * IndicatorChartLayout.
 *
 * Previous shell (six-tab Dashboard / Training / Backtest / Forecast / Trades /
 * Curriculum + 300px "Neural Price Context") was deleted on 2026-05-08 — see
 * docs/plans/2026-05-08-ml-studio-end-to-end.md.
 */

import { useBreadcrumbs } from "@/shared/hooks/useBreadcrumbs";
import { useDashboard } from "@/shared/contexts/UnifiedDashboardContext";
import { Button } from "@/shared/ui/button";
import { ArrowRight, Brain } from "lucide-react";
import { Badge } from "@/shared/ui/badge";
import { useTrainingControl } from "@/training/lib/TrainingContext";
import { MLStudioProvider, STAGE_LABELS, useMLStudio } from "@/ml/MLStudioContext";
import { StageStepper } from "@/ml/StageStepper";
import { StatusFooter } from "@/ml/StatusFooter";
import { MetricTicker, SystemLoadStrip, StageProgressRibbon } from "@/ml/telemetry";
import { DataStage } from "@/ml/stages/DataStage";
import { FeaturesStage } from "@/ml/stages/FeaturesStage";
import { LabelsStage } from "@/ml/stages/LabelsStage";
import { TrainStage } from "@/ml/stages/TrainStage";
import { EvaluateStage } from "@/ml/stages/EvaluateStage";
import { PromoteStage } from "@/ml/stages/PromoteStage";
import { AgentReport } from "@/deployment/components/AgentReport";

export default function MLStudio() {
  return (
    <MLStudioProvider>
      <Shell />
    </MLStudioProvider>
  );
}

function Shell() {
  const { state } = useMLStudio();
  const dashboard = useDashboard();
  const training = useTrainingControl();
  const isTraining = training.isTraining;

  useBreadcrumbs([{ label: STAGE_LABELS[state.activeStage] }]);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex justify-between items-center mb-1.5 shrink-0 px-1">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground leading-tight">ML Studio</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            End-to-end pipeline: Data → Features → Labels → Train → Evaluate → Promote
          </p>
        </div>

        <div className="flex gap-2 items-center">
          <Badge
            variant="outline"
            className={`h-7 px-2.5 font-mono gap-1.5 text-[11px] rounded-full transition-all ${
              isTraining
                ? "border-[hsl(var(--data-pos)/0.35)] text-[hsl(var(--data-pos))] bg-[hsl(var(--data-pos)/0.1)] shadow-[0_0_15px_-5px_hsl(var(--data-pos)/0.35)]"
                : "border-white/10 text-muted-foreground bg-white/5"
            }`}
          >
            <Brain className={`h-3 w-3 ${isTraining ? "animate-pulse" : ""}`} />
            {isTraining ? "Training live" : "Idle"}
          </Badge>

          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2.5 rounded-lg text-[11px] gap-1.5 border-primary/30 text-primary hover:bg-primary/10"
            onClick={() => dashboard.navigateToChart()}
          >
            <ArrowRight className="h-3 w-3" /> Market Data chart
          </Button>
        </div>
      </div>

      {/* Live telemetry. Each of these renders null when it has nothing to
          report, so an idle studio looks exactly as it did before. */}
      <div className="flex items-stretch gap-1.5 shrink-0">
        <MetricTicker className="flex-1 min-w-0" />
        <SystemLoadStrip />
      </div>
      <StageProgressRibbon className="mt-1.5" />

      <StageStepper />

      <div className="flex-1 min-h-0 overflow-hidden bg-card/10 rounded-xl border border-white/5">
        <ActiveStageBody />
      </div>

      <StatusFooter />

      {/* W8.e — single global agent panel. Lives at the MLStudio shell so the
          left-side Sheet overlays any active stage and never collides with
          PromoteStage's right-side lineage drawer (W7 risk row mitigation). */}
      <AgentReport />
    </div>
  );
}

function ActiveStageBody() {
  const { state } = useMLStudio();
  switch (state.activeStage) {
    case "data":
      return <DataStage />;
    case "features":
      return <FeaturesStage />;
    case "labels":
      return <LabelsStage />;
    case "train":
      return <TrainStage />;
    case "evaluate":
      return <EvaluateStage />;
    case "promote":
      return <PromoteStage />;
    default:
      return null;
  }
}
