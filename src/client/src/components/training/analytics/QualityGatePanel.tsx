import { memo, useMemo } from "react";
import { useTrainingModelState } from "@/contexts/TrainingModelStateCtx";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { ShieldCheck, ShieldAlert, ShieldX, Activity, Info } from "lucide-react";

const STATUS_COLORS: Record<string, string> = {
  pass: "#22c55e",
  warn: "#eab308",
  fail: "#ef4444",
};

const STATUS_BG: Record<string, string> = {
  pass: "bg-emerald-500/5",
  warn: "bg-amber-500/5",
  fail: "bg-rose-500/5",
};

const STATUS_ICONS: Record<string, any> = {
  pass: ShieldCheck,
  warn: ShieldAlert,
  fail: ShieldX,
};

function getSyntheticGates(diag: any): any[] {
  if (!diag) return [];
  const metrics = diag.best_metrics || diag.metrics || {};
  const gates = [];

  if (metrics.swing_auc !== undefined) {
    const v = metrics.swing_auc;
    gates.push({
      metric: "edge_confidence",
      value: v,
      status: v >= 0.65 ? "pass" : v >= 0.58 ? "warn" : "fail",
      recommendation: v < 0.65 ? "AUC below institutional threshold. Verify feature orthogonality." : null
    });
  }

  if (metrics.forward_auc !== undefined) {
    const v = metrics.forward_auc;
    gates.push({
      metric: "predictive_power",
      value: v,
      status: v >= 0.52 ? "pass" : v >= 0.51 ? "warn" : "fail",
      recommendation: v < 0.52 ? "Weak forward predictive signal. Adjust target horizon." : null
    });
  }

  if (metrics.profit_factor !== undefined) {
    const v = metrics.profit_factor;
    gates.push({
      metric: "profitability_gate",
      value: v,
      status: v >= 1.5 ? "pass" : v >= 1.2 ? "warn" : "fail",
      recommendation: v < 1.5 ? "Marginal Profit Factor. Review cost-model assumptions." : null
    });
  }

  return gates;
}

function QualityGatePanelInner({ diagnostics }: { diagnostics?: Record<string, any> | null }) {
  const { modelState } = useTrainingModelState();

  const gates = useMemo(() => {
    const raw = modelState?.snapshot?.quality_gates ?? diagnostics?.quality_gates;
    if (raw && raw.length > 0) return raw;
    return getSyntheticGates(modelState?.snapshot ?? diagnostics);
  }, [modelState, diagnostics]);

  if (gates.length === 0) {
    return (
      <div className="space-y-2 opacity-20">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-16 rounded-xl border border-white/5 bg-white/[0.01]" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-2.5">
      {gates.map((gate: any) => {
        const color = STATUS_COLORS[gate.status] || "#6b7280";
        const Icon = STATUS_ICONS[gate.status] || Info;
        const bg = STATUS_BG[gate.status] || "bg-white/[0.02]";

        const content = (
          <div className={`group flex items-center justify-between p-4 rounded-2xl border border-white/[0.06] ${bg} hover:bg-white/[0.04] transition-all cursor-default relative overflow-hidden`}>
            <div className="flex items-center gap-4 relative z-10">
              <div className="relative">
                <Icon className="w-5 h-5 shrink-0" style={{ color }} />
                <div className="absolute inset-0 blur-lg opacity-50" style={{ backgroundColor: color }} />
              </div>
              <div className="min-w-0">
                <div className="text-[10px] font-black font-mono text-muted-foreground/60 uppercase tracking-[0.2em] leading-none mb-1.5">
                  {gate.metric.replace(/_/g, ' ')}
                </div>
                <div className="text-sm font-black font-mono text-foreground/90 tabular-nums">
                  {typeof gate.value === "number" ? gate.value.toFixed(4) : String(gate.value)}
                </div>
              </div>
            </div>
            
            <div className="flex flex-col items-end gap-2 relative z-10">
               <span className="text-[9px] font-black font-mono px-2 py-0.5 rounded-full border border-current opacity-80" style={{ color }}>
                 {gate.status.toUpperCase()}
               </span>
               <div className="w-20 h-1 bg-white/5 rounded-full overflow-hidden shadow-inner">
                  <div 
                    className="h-full rounded-full transition-all duration-1000" 
                    style={{ 
                      width: gate.status === 'pass' ? '100%' : gate.status === 'warn' ? '60%' : '30%',
                      backgroundColor: color,
                      boxShadow: `0 0 8px ${color}`
                    }} 
                  />
               </div>
            </div>

            {/* Inner Glow Effect */}
            <div className="absolute top-0 right-0 w-32 h-full bg-gradient-to-l from-current via-transparent to-transparent opacity-[0.03]" style={{ color }} />
          </div>
        );

        if (!gate.recommendation) return <div key={gate.metric}>{content}</div>;

        return (
          <Tooltip key={gate.metric}>
            <TooltipTrigger asChild>{content}</TooltipTrigger>
            <TooltipContent side="left" className="max-w-[280px] bg-zinc-950 border-white/10 p-4 shadow-2xl glass rounded-xl">
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-primary font-black text-[10px] uppercase tracking-[0.2em]">
                  <Activity className="w-3.5 h-3.5" /> Institutional Advisory
                </div>
                <p className="text-[11px] leading-relaxed text-muted-foreground font-mono">
                  {gate.recommendation}
                </p>
              </div>
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

export const QualityGatePanel = memo(QualityGatePanelInner);
export default QualityGatePanel;
