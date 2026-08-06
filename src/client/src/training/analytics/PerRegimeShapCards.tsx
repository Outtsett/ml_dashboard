/**
 * PerRegimeShapCards — Per-regime feature attribution breakdown.
 *
 * Grid of cards, one per active regime. Each shows top 5 features
 * with importance bars and regime profile summary (mean_return, Sharpe).
 * Data from useTrainingModelState().modelState.snapshot.
 */

import { memo, useMemo } from "react";
import { useTrainingModelState } from "@/shared/contexts/TrainingModelStateCtx";
import { ChartCard } from "./shared";

const REGIME_COLORS = [
  "#22c55e", "#3b82f6", "#f59e0b", "#ef4444", "#a855f7",
  "#06b6d4", "#ec4899", "#84cc16", "#f97316", "#6366f1",
];

const TOP_N = 5;

function PerRegimeShapCardsInner() {
  const { modelState } = useTrainingModelState();
  const fa = modelState?.snapshot.feature_attribution;
  const profiles = modelState?.snapshot.regime_profiles;

  const regimeData = useMemo(() => {
    if (!fa?.per_regime?.length) return [];
    return fa.per_regime.map((r) => {
      const sorted = [...r.features].sort((a, b) => b.importance - a.importance);
      const profile = profiles?.find((p) => p.regime_id === r.regime_id);
      return {
        regime_id: r.regime_id,
        topFeatures: sorted.slice(0, TOP_N),
        maxImportance: sorted.length > 0 ? sorted[0]!.importance : 1,
        profile,
      };
    });
  }, [fa, profiles]);

  const hasData = regimeData.length > 0;

  if (!hasData) {
    // Show 3 placeholder regime cards
    const placeholders = [0, 1, 2];
    return (
      <ChartCard title="Per-Regime Feature Attribution" className="lg:col-span-2" minHeight={200}>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {placeholders.map((id) => {
            const color = REGIME_COLORS[id % REGIME_COLORS.length]!;
            return (
              <div
                key={id}
                className="bg-white/[0.02] rounded-xl border border-white/5 overflow-hidden"
                style={{ borderLeftColor: color, borderLeftWidth: 3 }}
              >
                <div className="px-3 pt-2.5 pb-1.5 border-b border-white/5">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color, opacity: 0.4 }} />
                    <span className="text-[11px] font-mono font-medium text-muted-foreground/30">
                      Regime {id}
                    </span>
                  </div>
                </div>
                <div className="px-3 py-2 space-y-1.5">
                  {Array.from({ length: 3 }, (_, i) => (
                    <div key={i} className="space-y-0.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[8px] font-mono text-muted-foreground/20">{"\u2014"}</span>
                        <span className="text-[8px] font-mono text-muted-foreground/20">{"\u2014"}</span>
                      </div>
                      <div className="h-1.5 bg-white/5 rounded-full overflow-hidden" />
                    </div>
                  ))}
                </div>
                <div className="px-3 pb-2.5 pt-1.5 border-t border-white/5">
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                    {["Mean Return", "Sharpe", "Bars", "Avg Dwell"].map((label) => (
                      <div key={label} className="flex justify-between text-[8px]">
                        <span className="text-muted-foreground/20">{label}</span>
                        <span className="font-mono text-muted-foreground/20">{"\u2014"}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </ChartCard>
    );
  }

  const gridCols =
    regimeData.length <= 2 ? "grid-cols-1 md:grid-cols-2"
      : "grid-cols-1 md:grid-cols-2 xl:grid-cols-3";

  return (
    <ChartCard
      title="Per-Regime Feature Attribution"
      subtitle={`${regimeData.length} active regimes`}
      className="lg:col-span-2"
      minHeight={200}
    >
      <div className={`grid ${gridCols} gap-3`}>
        {regimeData.map((rd) => {
          const color = REGIME_COLORS[rd.regime_id % REGIME_COLORS.length]!;
          return (
            <div
              key={rd.regime_id}
              className="bg-white/[0.02] rounded-xl border border-white/5 overflow-hidden"
              style={{ borderLeftColor: color, borderLeftWidth: 3 }}
            >
              {/* Header */}
              <div className="px-3 pt-2.5 pb-1.5 border-b border-white/5">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                  <span className="text-[11px] font-mono font-medium">
                    Regime {rd.regime_id}
                  </span>
                  {rd.profile && (
                    <span className="text-[8px] font-mono text-muted-foreground/40 ml-auto">
                      {rd.profile.label}
                    </span>
                  )}
                </div>
              </div>

              {/* Top features */}
              <div className="px-3 py-2 space-y-1.5">
                {rd.topFeatures.map((f) => {
                  const width = rd.maxImportance > 0
                    ? Math.min((f.importance / rd.maxImportance) * 100, 100)
                    : 0;
                  const barColor = f.importance > rd.maxImportance * 0.5
                    ? "bg-emerald-500/40"
                    : "bg-blue-500/30";
                  return (
                    <div key={f.feature} className="space-y-0.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[8px] font-mono text-muted-foreground/60 truncate max-w-[60%]">
                          {f.feature}
                        </span>
                        <span className="text-[8px] font-mono text-muted-foreground/40">
                          {f.importance.toFixed(4)}
                        </span>
                      </div>
                      <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${barColor}`}
                          style={{ width: `${width}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Regime profile summary */}
              {rd.profile && (
                <div className="px-3 pb-2.5 pt-1.5 border-t border-white/5">
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                    <div className="flex justify-between text-[8px]">
                      <span className="text-muted-foreground/40">Mean Return</span>
                      <span
                        className={`font-mono ${rd.profile.mean_return >= 0 ? "text-emerald-400/70" : "text-rose-400/70"}`}
                      >
                        {(rd.profile.mean_return * 100).toFixed(3)}%
                      </span>
                    </div>
                    <div className="flex justify-between text-[8px]">
                      <span className="text-muted-foreground/40">Sharpe</span>
                      <span
                        className={`font-mono ${rd.profile.sharpe >= 0.5 ? "text-emerald-400/70" : rd.profile.sharpe >= 0 ? "text-muted-foreground/60" : "text-rose-400/70"}`}
                      >
                        {rd.profile.sharpe.toFixed(2)}
                      </span>
                    </div>
                    <div className="flex justify-between text-[8px]">
                      <span className="text-muted-foreground/40">Bars</span>
                      <span className="font-mono text-muted-foreground/60">
                        {rd.profile.bar_count.toLocaleString()} ({rd.profile.bar_pct.toFixed(1)}%)
                      </span>
                    </div>
                    <div className="flex justify-between text-[8px]">
                      <span className="text-muted-foreground/40">Avg Dwell</span>
                      <span className="font-mono text-muted-foreground/60">
                        {rd.profile.mean_dwell.toFixed(1)}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </ChartCard>
  );
}

export const PerRegimeShapCards = memo(PerRegimeShapCardsInner);
export default PerRegimeShapCards;
