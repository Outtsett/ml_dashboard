import { memo, useMemo } from "react";
import { useTrainingModelState } from "@/shared/contexts/TrainingModelStateCtx";
import { useTrainingControl } from "@/training/lib/TrainingContext";
import { useMetricDescriptions, formatMetricValue } from "@/infrastructure/lib/useMetricDescriptions";
import { RadialGauge } from "./RadialGauge";
import { Clock, Settings2, HelpCircle } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/shared/ui/tooltip";
import { metricNumber, type MetricsBag, type MetricsSnapshot, type QualityGate } from "@/training/lib/types";

const STATUS_COLORS: Record<string, string> = {
  pass: "#E69F00",
  warn: "#f59e0b",
  fail: "#0072B2",
};

function MetricScorecardInner({ diagnostics }: { diagnostics?: MetricsSnapshot | null }) {
  const { modelState } = useTrainingModelState();
  const { selectedModelType, availableModels } = useTrainingControl();
  const { descriptions } = useMetricDescriptions(selectedModelType);

  const modelDef = availableModels[selectedModelType];
  const snap = (modelState?.snapshot ?? diagnostics ?? null) as MetricsSnapshot | null;
  
  // DYNAMIC ADAPTATION: Derive UI purely from Registry + Snapshots
  // No hardcoded model-type lists.
  const activeMetrics = useMemo(() => {
    if (!modelDef?.outputs) return [];
    
    const outputKeys = Array.isArray(modelDef.outputs) 
      ? modelDef.outputs 
      : Object.keys(modelDef.outputs);
      
    // Filter to metrics that actually exist in the current snapshot
    const metricsInSnap: MetricsBag = snap?.best_metrics || snap?.metrics || {};
    return outputKeys.filter(k => metricsInSnap[k] !== undefined || descriptions[k]);
  }, [modelDef, snap, descriptions]);

  if (!snap) return null;

  const gateMap = new Map(
    (snap?.quality_gates ?? []).map((g): [string, QualityGate["status"]] => [g.metric, g.status]),
  );
  const currentMetrics: MetricsBag = snap.best_metrics || snap.metrics || {};

  return (
    <div className="space-y-12 animate-in fade-in duration-1000">
      {/* 1. Adaptive Performance Gauges (Top 3 Primary Outputs) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
        {activeMetrics.slice(0, 3).map((key) => {
          const value = metricNumber(currentMetrics, key) ?? 0;
          const desc = descriptions[key];
          const status = String(gateMap.get(key) || 'pass');
          const color = STATUS_COLORS[status] || "#3b82f6";
          
          const isPct = desc?.unit === 'percent' || key.includes('accuracy');
          const displayValue = isPct ? value * 100 : value;
          const displayMax = desc?.target ? (desc.target > 1 ? desc.target * 1.5 : 100) : 100;

          return (
            <div key={key} className="relative group">
              <RadialGauge
                value={displayValue}
                min={0}
                max={displayMax}
                label={desc?.title || key.replace(/_/g, ' ')}
                unit={desc?.unit === 'percent' ? '%' : ''}
                color={color}
                sublabel={status === 'fail' ? "BELOW TARGET" : "VERIFIED"}
              />
              {desc?.target !== undefined && (
                <div className="absolute top-0 right-0 p-2 text-right opacity-40 group-hover:opacity-100 transition-opacity">
                   <div className="text-[8px] font-black uppercase tracking-widest text-muted-foreground/20">Target</div>
                   <div className="text-xs font-mono font-bold text-foreground/20">
                      {desc.targetDirection === 'above' ? '≥' : '≤'} {isPct ? (desc.target * 100).toFixed(0) : desc.target}{isPct ? '%' : ''}
                   </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 2. Adaptive Diagnostic Grid (Remaining Outputs) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-12 gap-y-10 px-4">
        {activeMetrics.slice(3).map((key) => {
          const value = metricNumber(currentMetrics, key);
          const desc = descriptions[key];
          if (value === undefined) return null;

          return (
            <div key={key} className="flex flex-col gap-2 group relative">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-[0.25em] text-muted-foreground/30 group-hover:text-primary/50 transition-colors">
                  {desc?.title || key.replace(/_/g, ' ')}
                </span>
                {desc && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <HelpCircle className="w-3.5 h-3.5 text-muted-foreground/10 hover:text-primary/60 cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-[320px] bg-zinc-950 border-white/10 p-5 shadow-2xl glass rounded-2xl">
                      <div className="space-y-4">
                        <div className="space-y-1.5">
                          <div className="text-[10px] font-black text-primary uppercase tracking-widest italic">Diagnostic Intent</div>
                          <p className="text-[11px] text-foreground/80 font-mono leading-relaxed">{desc.purpose || desc.description}</p>
                        </div>
                        {desc.controlParameters && desc.controlParameters.length > 0 && (
                          <div className="space-y-2 pt-3 border-t border-white/5">
                            <div className="text-[10px] font-black text-amber-400 uppercase tracking-widest flex items-center gap-1.5">
                              <Settings2 className="w-3 h-3" /> Control Flags
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {desc.controlParameters.map(p => (
                                <span key={p} className="text-[9px] font-mono bg-primary/5 px-2 py-0.5 rounded border border-primary/10 text-primary/80">--{p.replace(/_/g, '-')}</span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
              <div className="flex items-baseline gap-3">
                <span className="text-2xl font-mono font-black text-foreground/80 tabular-nums tracking-tighter">
                  {desc ? formatMetricValue(value, desc.format) : value.toFixed(3)}
                </span>
              </div>
            </div>
          );
        })}
        
        {/* Dynamic System Stats */}
        <div className="flex flex-col gap-2 group">
          <span className="text-[10px] font-black uppercase tracking-[0.25em] text-muted-foreground/30">Total Compute</span>
          <div className="flex items-center gap-2 text-cyan-400/20">
            <Clock className="w-4 h-4" />
            <span className="text-2xl font-mono font-black text-foreground/80 tracking-tighter">
              {snap?.training?.total_time_sec ? `${(snap.training.total_time_sec / 60).toFixed(1)}m` : "0.0m"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export const MetricScorecard = memo(MetricScorecardInner);
export default MetricScorecard;
