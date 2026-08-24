import { memo } from "react";
import { useTrainingModelState } from "@/shared/contexts/TrainingModelStateCtx";
import { Info, AlertTriangle, XCircle, CheckCircle2, Lightbulb } from "lucide-react";
import type { MetricsSnapshot } from "@/training/lib/types";

const SEVERITY_CONFIG = {
  warn: {
    Icon: AlertTriangle,
    borderColor: "border-amber-500/30",
    bgColor: "bg-amber-500/5",
    iconColor: "text-amber-500",
    glow: "shadow-[0_0_15px_rgba(245,158,11,0.1)]",
  },
  fail: {
    Icon: XCircle,
    borderColor: "border-rose-500/30",
    bgColor: "bg-rose-500/5",
    iconColor: "text-rose-500",
    glow: "shadow-[0_0_15px_rgba(244,63,94,0.1)]",
  },
  info: {
    Icon: Info,
    borderColor: "border-blue-500/30",
    bgColor: "bg-blue-500/5",
    iconColor: "text-blue-500",
    glow: "shadow-[0_0_15px_rgba(59,130,246,0.1)]",
  },
} as const;

function RecommendationEngineInner({ diagnostics }: { diagnostics?: MetricsSnapshot | null }) {
  const { modelState } = useTrainingModelState();

  const gates = modelState?.snapshot?.quality_gates ?? diagnostics?.quality_gates ?? [];
  const actionable = gates.filter(
    (g: any) => (g.status === "warn" || g.status === "fail") && g.recommendation
  );
  const hasData = !!modelState || !!diagnostics;

  if (!hasData) return null;

  if (actionable.length === 0) {
    return (
      <div className="flex items-center gap-3 p-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5 shadow-[0_0_20px_rgba(16,185,129,0.05)]">
        <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
        <div className="min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-widest text-emerald-400/80 mb-0.5">Strategy Status</div>
          <div className="text-xs font-mono text-emerald-400/60">
            All institutional quality gates passed. Model is ready for inference deployment.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-1 px-1">
        <Lightbulb className="w-3.5 h-3.5 text-primary/60" />
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">Optimization Insights</span>
      </div>
      
      <div className="grid grid-cols-1 gap-2">
        {actionable.map((gate: any) => {
          const severity = gate.status === "fail" ? "fail" : "warn";
          const config = SEVERITY_CONFIG[severity];
          const { Icon } = config;

          return (
            <div
              key={gate.metric}
              className={`group flex items-start gap-3 rounded-xl border p-3 ${config.borderColor} ${config.bgColor} ${config.glow} hover:bg-white/[0.02] transition-all`}
            >
              <div className={`mt-0.5 p-1.5 rounded-lg bg-white/5 border border-white/5 ${config.iconColor}`}>
                <Icon className="w-4 h-4 shrink-0" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-bold font-mono uppercase tracking-widest text-foreground/80">
                    {gate.metric.replace(/_/g, ' ')}
                  </span>
                  <span className={`text-[10px] font-mono font-bold ${config.iconColor}`}>
                    {typeof gate.value === 'number' ? gate.value.toFixed(4) : gate.value}
                  </span>
                </div>
                <p className="text-xs font-mono text-muted-foreground/90 leading-relaxed">
                  {gate.recommendation}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export const RecommendationEngine = memo(RecommendationEngineInner);
export default RecommendationEngine;
