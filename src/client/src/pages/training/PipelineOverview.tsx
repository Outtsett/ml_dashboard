import { PHASES, type Phase, type PhaseStatus } from "./types";
import { cn } from "@/lib/utils";

interface PipelineOverviewProps {
  phaseStatuses: Record<Phase, PhaseStatus>;
  onSelectPhase: (phase: Phase) => void;
}

const EXIT_CRITERIA: Record<Phase, { metric: string; target: string }[]> = {
  A: [
    { metric: "MAE Loss", target: "< 0.05" },
    { metric: "Direction Loss", target: "< 1.0" },
  ],
  B: [
    { metric: "Regime Count", target: "Stable" },
    { metric: "Slot Entropy", target: "Converged" },
  ],
  C: [
    { metric: "Supervised Loss", target: "< 0.5" },
    { metric: "Consistency Loss", target: "< 0.1" },
  ],
  D: [
    { metric: "Direction Accuracy", target: "> 55%" },
    { metric: "Calibration ECE", target: "< 0.05" },
  ],
  E: [
    { metric: "Sharpe Ratio", target: "> 1.0" },
    { metric: "Max Drawdown", target: "< 15%" },
    { metric: "Profit Factor", target: "> 1.3" },
  ],
};

const PHASE_COLORS: Record<Phase, string> = {
  A: "from-blue-500/10 to-blue-500/5 border-blue-500/20",
  B: "from-violet-500/10 to-violet-500/5 border-violet-500/20",
  C: "from-amber-500/10 to-amber-500/5 border-amber-500/20",
  D: "from-emerald-500/10 to-emerald-500/5 border-emerald-500/20",
  E: "from-rose-500/10 to-rose-500/5 border-rose-500/20",
};

const PHASE_ACCENT: Record<Phase, string> = {
  A: "text-blue-400",
  B: "text-violet-400",
  C: "text-amber-400",
  D: "text-emerald-400",
  E: "text-rose-400",
};

const STATUS_BADGE: Record<PhaseStatus, { label: string; className: string }> = {
  idle: { label: "Idle", className: "text-neutral-400 bg-neutral-500/10" },
  running: { label: "Running", className: "text-blue-400 bg-blue-500/10 animate-pulse" },
  completed: { label: "Done", className: "text-emerald-400 bg-emerald-500/10" },
  failed: { label: "Failed", className: "text-red-400 bg-red-500/10" },
};

export function PipelineOverview({ phaseStatuses, onSelectPhase }: PipelineOverviewProps) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-mono font-semibold">Training Curriculum</h2>
        <p className="text-sm text-muted-foreground mt-1">
          5-phase progressive training: self-supervised foundations through end-to-end optimization
        </p>
      </div>

      <div className="grid gap-3">
        {PHASES.map((phase) => {
          const status = phaseStatuses[phase.id];
          const badge = STATUS_BADGE[status];
          const criteria = EXIT_CRITERIA[phase.id];

          return (
            <button
              key={phase.id}
              onClick={() => onSelectPhase(phase.id)}
              className={cn(
                "text-left border rounded-lg p-4 bg-gradient-to-r transition-all",
                "hover:shadow-md hover:shadow-black/20 hover:scale-[1.005]",
                PHASE_COLORS[phase.id]
              )}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3 min-w-0">
                  <span className={cn(
                    "text-2xl font-mono font-bold leading-none mt-0.5",
                    PHASE_ACCENT[phase.id]
                  )}>
                    {phase.id}
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-mono font-medium">{phase.name}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{phase.description}</div>
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  {/* Exit criteria chips */}
                  <div className="hidden md:flex items-center gap-2">
                    {criteria.map((c) => (
                      <div
                        key={c.metric}
                        className="px-2 py-0.5 rounded bg-background/50 text-[10px] font-mono text-muted-foreground whitespace-nowrap"
                      >
                        {c.metric} {c.target}
                      </div>
                    ))}
                  </div>

                  <span className={cn(
                    "px-2 py-0.5 rounded text-[10px] font-mono font-medium whitespace-nowrap",
                    badge.className
                  )}>
                    {badge.label}
                  </span>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Architecture summary */}
      <div className="border border-border rounded-lg p-5 bg-card/30">
        <h3 className="text-sm font-mono font-medium mb-3">Model Tiers</h3>
        <div className="grid grid-cols-3 gap-3 text-xs font-mono">
          <div className="space-y-1.5">
            <div className="text-muted-foreground text-[10px] uppercase tracking-wider">Representation</div>
            <div>Masked Autoencoder</div>
            <div>Slot Attention</div>
            <div>Anomaly Detector</div>
          </div>
          <div className="space-y-1.5">
            <div className="text-muted-foreground text-[10px] uppercase tracking-wider">Structure</div>
            <div>SOM + GAT (Relations)</div>
            <div>ICA + DCC (Correlations)</div>
            <div>HDP-HMM (Regime)</div>
            <div>MoE Gating</div>
          </div>
          <div className="space-y-1.5">
            <div className="text-muted-foreground text-[10px] uppercase tracking-wider">Prediction</div>
            <div>GARCH + KDE + BGMM</div>
            <div>CPC + TS-TCC (Direction)</div>
            <div>MAML + NP (Probability)</div>
            <div>Neuro-Symbolic Reasoning</div>
          </div>
        </div>
      </div>
    </div>
  );
}
