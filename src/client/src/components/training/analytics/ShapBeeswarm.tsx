/**
 * ShapBeeswarm — Global SHAP feature importance bar chart + interaction pairs.
 *
 * Horizontal bar chart: features ranked by mean |SHAP| (top 15).
 * Dead features section below. Feature interaction pairs at bottom.
 * Data from useTrainingModelState().modelState.snapshot.feature_attribution.
 */

import { memo, useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import { useTrainingModelState } from "@/contexts/TrainingModelStateCtx";
import { ChartCard } from "./shared";

const MAX_FEATURES = 15;
const MAX_INTERACTIONS = 5;

function ShapBeeswarmInner() {
  const { modelState } = useTrainingModelState();
  const fa = modelState?.snapshot.feature_attribution;

  const { chartData, extraCount } = useMemo(() => {
    if (!fa?.global?.length) return { chartData: [], extraCount: 0 };
    const sorted = [...fa.global].sort((a, b) => b.importance - a.importance);
    const top = sorted.slice(0, MAX_FEATURES);
    return {
      chartData: top.map((f) => ({
        feature: f.feature,
        importance: f.importance,
      })),
      extraCount: Math.max(0, sorted.length - MAX_FEATURES),
    };
  }, [fa]);

  const maxImportance = chartData.length > 0 ? chartData[0]!.importance : 1;

  const interactions = useMemo(() => {
    if (!fa?.interactions?.length) return [];
    return [...fa.interactions]
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_INTERACTIONS);
  }, [fa]);

  const deadFeatures = fa?.dead_features ?? [];

  if (!fa || !fa.global?.length) {
    return (
      <ChartCard title="Feature Importance (SHAP)" className="lg:col-span-2">
        <div className="w-full h-full flex items-center justify-center min-h-[120px]">
          <span className="text-[10px] font-mono text-muted-foreground/30">
            Feature attribution will appear during training
          </span>
        </div>
      </ChartCard>
    );
  }

  return (
    <ChartCard
      title="Feature Importance (SHAP)"
      subtitle={`Top ${Math.min(fa.global.length, MAX_FEATURES)} features by mean |SHAP|`}
      className="lg:col-span-2"
      minHeight={Math.max(200, chartData.length * 28 + 40)}
    >
      <ResponsiveContainer width="100%" height={chartData.length * 28 + 40}>
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 4, right: 24, left: 8, bottom: 4 }}
        >
          <XAxis
            type="number"
            tick={{ fontSize: 8, fill: "#6e7681" }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            type="category"
            dataKey="feature"
            tick={{ fontSize: 9, fill: "#9ca3af" }}
            tickLine={false}
            axisLine={false}
            width={120}
          />
          <Tooltip
            contentStyle={{
              background: "#0d1117",
              border: "1px solid rgba(255,255,255,0.1)",
              fontSize: 10,
              fontFamily: "monospace",
            }}
            formatter={(value: number) => [value.toFixed(4), "Importance"]}
          />
          <Bar dataKey="importance" radius={[0, 3, 3, 0]} isAnimationActive={false}>
            {chartData.map((entry, i) => {
              const ratio = maxImportance > 0 ? entry.importance / maxImportance : 0;
              const opacity = 0.3 + ratio * 0.7;
              return <Cell key={i} fill={`rgba(139, 92, 246, ${opacity})`} />;
            })}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {extraCount > 0 && (
        <p className="text-[9px] text-muted-foreground/40 mt-1 px-1">
          ... and {extraCount} more feature{extraCount > 1 ? "s" : ""}
        </p>
      )}

      {/* Dead features */}
      {deadFeatures.length > 0 && (
        <div className="mt-3 pt-3 border-t border-white/5">
          <div className="text-[9px] text-rose-400/60 font-mono uppercase tracking-wider mb-1">
            Dead Features ({deadFeatures.length})
          </div>
          <div className="flex flex-wrap gap-1.5">
            {deadFeatures.map((f) => (
              <span
                key={f}
                className="text-[8px] font-mono px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-400/50 border border-rose-500/10"
              >
                {f}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Feature interactions */}
      {interactions.length > 0 && (
        <div className="mt-3 pt-3 border-t border-white/5">
          <div className="text-[9px] text-muted-foreground/50 font-mono uppercase tracking-wider mb-1.5">
            Top Feature Interactions
          </div>
          <div className="space-y-1">
            {interactions.map((pair, i) => {
              const maxScore = interactions[0]!.score || 1;
              const width = Math.min((pair.score / maxScore) * 100, 100);
              return (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-[8px] font-mono text-muted-foreground/50 w-40 truncate shrink-0">
                    {pair.f1} x {pair.f2}
                  </span>
                  <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full bg-cyan-500/40"
                      style={{ width: `${width}%` }}
                    />
                  </div>
                  <span className="text-[8px] font-mono text-muted-foreground/40 w-12 text-right shrink-0">
                    {pair.score.toFixed(3)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </ChartCard>
  );
}

export const ShapBeeswarm = memo(ShapBeeswarmInner);
export default ShapBeeswarm;
