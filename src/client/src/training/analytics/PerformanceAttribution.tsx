import React, { memo } from 'react';
import { useTrainingControl } from "@/training/lib/TrainingContext";
import { useMetricDescriptions } from "@/infrastructure/lib/useMetricDescriptions";
import { Settings2, ArrowRight, TrendingUp, AlertTriangle } from 'lucide-react';

export const PerformanceAttribution = memo(({ diagnostics }: { diagnostics: any }) => {
  const { selectedModelType } = useTrainingControl();
  const { descriptions, metricOrder } = useMetricDescriptions(selectedModelType);

  const snap = diagnostics || {};
  const metrics = snap.best_metrics || snap.metrics || {};

  // Find metrics with prescriptive data
  const attributedMetrics = metricOrder
    .filter(key => descriptions[key]?.prescriptive)
    .map(key => ({
      key,
      ...descriptions[key],
      currentValue: metrics[key]
    }));

  if (attributedMetrics.length === 0) return null;

  return (
    <div className="space-y-6 animate-in fade-in duration-700">
      <div className="flex items-center gap-3 mb-2 px-1">
        <div className="p-1.5 rounded-lg bg-amber-400/10 border border-amber-400/20">
          <TrendingUp className="w-4 h-4 text-amber-400" />
        </div>
        <h3 className="text-xs font-black uppercase tracking-[0.3em] text-muted-foreground/80 font-display">Performance Attribution Map</h3>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {attributedMetrics.map((metric) => {
          const p = metric.prescriptive as any;
          const isFailing = metric.target !== undefined && 
            (metric.targetDirection === 'above' ? metric.currentValue < metric.target : metric.currentValue > metric.target);

          return (
            <div key={metric.key} className={`group p-5 rounded-2xl border transition-all duration-500 ${isFailing ? 'border-[color-mix(in_srgb,hsl(var(--data-neg)/0.2)_88%,black)] bg-[color-mix(in_srgb,hsl(var(--data-neg))_88%,black)]/[0.02]' : 'border-white/[0.05] bg-white/[0.01] hover:border-white/[0.1]'}`}>
              <div className="flex items-start justify-between mb-4">
                <div className="space-y-1">
                  <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/40 font-mono italic">{metric.title}</div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xl font-mono font-black ${isFailing ? 'text-[hsl(var(--data-neg))]' : 'text-foreground/80'}`}>
                      {metric.currentValue !== undefined ? (typeof metric.currentValue === 'number' ? metric.currentValue.toFixed(4) : metric.currentValue) : 'N/A'}
                    </span>
                    {isFailing && <AlertTriangle className="w-3.5 h-3.5 text-[color-mix(in_srgb,hsl(var(--data-neg))_88%,black)] animate-pulse" />}
                  </div>
                </div>
                {isFailing && (
                  <div className="px-2 py-1 rounded bg-[color-mix(in_srgb,hsl(var(--data-neg)/0.1)_88%,black)] border border-[color-mix(in_srgb,hsl(var(--data-neg)/0.2)_88%,black)] text-[8px] font-black text-[hsl(var(--data-neg))] uppercase tracking-tighter">
                    Action Prescribed
                  </div>
                )}
              </div>

              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="h-[1px] flex-1 bg-white/5" />
                  <span className="text-[8px] font-black uppercase tracking-widest text-muted-foreground/20">Control Vector</span>
                  <div className="h-[1px] flex-1 bg-white/5" />
                </div>

                <div className="flex flex-col gap-2">
                  {p.flags.map((flag: any) => (
                    <div key={flag.name} className="flex items-center justify-between group/flag">
                      <div className="flex items-center gap-2">
                        <Settings2 className="w-3 h-3 text-muted-foreground/30 group-hover/flag:text-amber-400/60 transition-colors" />
                        <span className="text-[11px] font-mono text-muted-foreground/60 group-hover/flag:text-foreground/80 transition-colors">--{flag.name.replace(/_/g, '-')}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <ArrowRight className={`w-3 h-3 ${isFailing ? 'text-[hsl(var(--data-neg))]' : 'text-muted-foreground/20'}`} />
                        <span className={`text-[10px] font-bold font-mono uppercase ${isFailing ? (flag.direction === 'up' ? 'text-[hsl(var(--data-pos))]' : 'text-[hsl(var(--data-neg))]') : 'text-muted-foreground/40'}`}>
                          {flag.direction}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {isFailing && (
                <div className="mt-4 pt-3 border-t border-[color-mix(in_srgb,hsl(var(--data-neg)/0.1)_88%,black)]">
                  <div className="text-[9px] font-black uppercase tracking-widest text-[hsl(var(--data-neg)/0.6)] mb-1">Prescription:</div>
                  <div className="text-[11px] font-mono text-[color-mix(in_srgb,hsl(var(--data-neg)/0.8)_80%,white)] leading-tight italic">
                    "{isFailing ? (p.low_signal_action || p.high_overfit_action || p.poor_calibration_action || p.no_trades_action) : ''}"
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
});
PerformanceAttribution.displayName = 'PerformanceAttribution';
