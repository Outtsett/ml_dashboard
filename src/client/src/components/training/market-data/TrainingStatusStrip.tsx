import { useTrainingControl } from "@/contexts/TrainingContext";
import { useTrainingModelState } from "@/contexts/TrainingModelStateCtx";
import { useTrainingMetrics } from "@/contexts/TrainingMetricsCtx";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { useLocation } from "wouter";
import { ArrowRight } from "lucide-react";

const gateColor = (status: "pass" | "warn" | "fail") =>
  status === "pass" ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.7)]"
  : status === "warn" ? "bg-yellow-400 shadow-[0_0_6px_rgba(250,204,21,0.7)]"
  : "bg-rose-400 shadow-[0_0_6px_rgba(251,113,133,0.7)]";

export function TrainingStatusStrip() {
  const { progress, phase } = useTrainingControl();
  const { modelState } = useTrainingModelState();
  const { metrics, iterationHistory } = useTrainingMetrics();
  const [, navigate] = useLocation();

  const snapshot = modelState?.snapshot;
  const gates = snapshot?.quality_gates ?? [];
  const cluster = snapshot?.cluster_quality;
  const iteration = modelState?.iteration ?? 0;
  const total = modelState?.total ?? 0;
  const pct = total > 0 ? (iteration / total) * 100 : progress;

  // Latest stability from iteration history
  const latestStability = iterationHistory.length > 0
    ? iterationHistory[iterationHistory.length - 1]!.metrics.assignment_stability
    : metrics.assignment_stability;

  const activeK = snapshot?.regime_profiles?.length ?? (metrics.num_regimes || null);

  return (
    <div className="flex items-center gap-3 px-3 h-[36px] border-b border-white/[0.08] shrink-0 text-[10px] bg-gradient-to-r from-zinc-900/90 via-zinc-900/80 to-zinc-900/90 backdrop-blur-sm">
      {/* Quality gate dots */}
      <TooltipProvider delayDuration={200}>
        <div className="flex items-center gap-1.5">
          {gates.length > 0 ? gates.map((g, i) => (
            <Tooltip key={i}>
              <TooltipTrigger asChild>
                <span className={`inline-block w-2.5 h-2.5 rounded-full ${gateColor(g.status)} pulse-slow`} />
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-[10px] font-mono bg-zinc-800/95 text-zinc-200 border border-white/10 px-2 py-1 backdrop-blur-sm">
                <span className="font-semibold">{g.metric}</span>: {typeof g.value === "number" ? g.value.toFixed(3) : g.value}
                {g.recommendation && <span className="text-muted-foreground ml-1">({g.recommendation})</span>}
              </TooltipContent>
            </Tooltip>
          )) : (
            <span className="text-muted-foreground/60 font-mono italic">gates pending</span>
          )}
        </div>
      </TooltipProvider>

      <div className="w-px h-4 bg-white/[0.1]" />

      {/* Progress */}
      <div className="flex items-center gap-2 min-w-[120px]">
        <span className="font-mono text-foreground/70 whitespace-nowrap">
          <span className="text-foreground/90 font-semibold">{iteration}</span>/{total} <span className="text-muted-foreground/60">({phase})</span>
        </span>
        <div className="w-20 h-2 rounded-full bg-white/[0.06] overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-blue-500 via-cyan-400 to-emerald-400 transition-all duration-300 shadow-[0_0_8px_rgba(34,211,238,0.3)]"
            style={{ width: `${Math.min(pct, 100)}%` }}
          />
        </div>
      </div>

      <div className="flex-1" />

      {/* Key metrics */}
      <div className="flex items-center gap-4 font-mono">
        {cluster?.silhouette != null && (
          <span className="text-cyan-400">
            Sil <span className="text-foreground font-semibold metric-glow">{cluster.silhouette.toFixed(3)}</span>
          </span>
        )}
        {activeK != null && (
          <span className="text-amber-400">
            K <span className="text-foreground font-semibold">{activeK}</span>
          </span>
        )}
        {latestStability != null && (
          <span className="text-emerald-400">
            Stab <span className="text-foreground font-semibold metric-glow">{latestStability.toFixed(1)}%</span>
          </span>
        )}
      </div>

      <div className="w-px h-4 bg-white/[0.1]" />

      {/* View Analytics link */}
      <button
        onClick={() => navigate("/ml-studio")}
        className="flex items-center gap-1 text-primary hover:text-primary/80 transition-colors font-semibold whitespace-nowrap"
      >
        View Analytics <ArrowRight className="h-3 w-3" />
      </button>
    </div>
  );
}
