/**
 * RecommendationEngine — Text cards showing automated parameter recommendations.
 *
 * Generates recommendations from quality_gates where status is 'warn' or 'fail'.
 * Each card: severity icon + colored border + recommendation text.
 */

import { memo } from "react";
import { useTrainingModelState } from "@/contexts/TrainingModelStateCtx";
import { Info, AlertTriangle, XCircle, CheckCircle2 } from "lucide-react";
import { ChartCard } from "./shared";

const SEVERITY_CONFIG = {
  warn: {
    Icon: AlertTriangle,
    borderColor: "border-yellow-500/40",
    bgColor: "bg-yellow-500/5",
    iconColor: "text-yellow-500",
  },
  fail: {
    Icon: XCircle,
    borderColor: "border-red-500/40",
    bgColor: "bg-red-500/5",
    iconColor: "text-red-500",
  },
  info: {
    Icon: Info,
    borderColor: "border-blue-500/40",
    bgColor: "bg-blue-500/5",
    iconColor: "text-blue-500",
  },
} as const;

function RecommendationEngineInner() {
  const { modelState } = useTrainingModelState();

  const gates = modelState?.snapshot?.quality_gates ?? [];
  const actionable = gates.filter(
    (g) => (g.status === "warn" || g.status === "fail") && g.recommendation
  );

  if (!modelState) {
    return (
      <ChartCard title="Recommendations" minHeight={40}>
        <div className="flex items-center gap-2 py-2">
          <Info className="w-4 h-4 text-muted-foreground/30 shrink-0" />
          <span className="text-xs font-mono text-muted-foreground/40">
            No recommendations — train a model to see diagnostics
          </span>
        </div>
      </ChartCard>
    );
  }

  if (actionable.length === 0) {
    return (
      <ChartCard title="Recommendations" minHeight={40}>
        <div className="flex items-center gap-2 py-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
          <span className="text-xs font-mono text-emerald-400">
            All quality gates passing
          </span>
        </div>
      </ChartCard>
    );
  }

  return (
    <ChartCard title="Recommendations" subtitle={`${actionable.length} action${actionable.length > 1 ? "s" : ""} needed`} minHeight={40}>
      <div className="space-y-2">
        {actionable.map((gate) => {
          const severity = gate.status === "fail" ? "fail" : "warn";
          const config = SEVERITY_CONFIG[severity];
          const { Icon } = config;

          return (
            <div
              key={gate.metric}
              className={`flex items-start gap-2 rounded-lg border px-3 py-2 ${config.borderColor} ${config.bgColor}`}
            >
              <Icon className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${config.iconColor}`} />
              <div className="min-w-0">
                <span className="text-[10px] font-mono font-medium text-muted-foreground/70">
                  {gate.metric}
                  <span className="ml-1.5 text-muted-foreground/40">
                    ({gate.value.toFixed(3)})
                  </span>
                </span>
                <p className="text-[11px] font-mono text-muted-foreground/90 mt-0.5 leading-snug">
                  {gate.recommendation}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </ChartCard>
  );
}

export const RecommendationEngine = memo(RecommendationEngineInner);
export default RecommendationEngine;
