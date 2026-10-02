/**
 * ShapEvolution — Feature importance over training iterations.
 *
 * Line chart: X = iteration, Y = mean |SHAP|. One line per top-8 feature
 * (ranked by final importance). Interactive legend toggles line visibility.
 * Data from useTrainingModelState().modelStateHistory.
 */

import { memo, useMemo, useState, useCallback } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from "recharts";
import { useTrainingModelState } from "@/shared/contexts/TrainingModelStateCtx";
import { WONG_PALETTE_DARK } from "@/shared/theme/dataColors";
import { ChartCard } from "./shared";

/**
 * Eight lines on one chart is exactly the case the shared palette is ordered
 * for — the previous ad-hoc list had two indistinguishable blues and a green
 * that vanished against them.
 */
const FEATURE_COLORS = WONG_PALETTE_DARK;

const MAX_FEATURES = 8;
const MAX_HISTORY = 50;

function ShapEvolutionInner() {
  const { modelStateHistory } = useTrainingModelState();
  const [hiddenFeatures, setHiddenFeatures] = useState<Set<string>>(new Set());

  // Slice to last MAX_HISTORY entries
  const recentHistory = useMemo(() => {
    if (!modelStateHistory?.length) return [];
    return modelStateHistory.slice(-MAX_HISTORY);
  }, [modelStateHistory]);

  // Determine top features by final iteration importance
  const topFeatures = useMemo(() => {
    if (!recentHistory.length) return [];
    const last = recentHistory[recentHistory.length - 1]!;
    const globalAttr = last.state.snapshot.feature_attribution?.global;
    if (!globalAttr?.length) return [];
    return [...globalAttr]
      .sort((a, b) => b.importance - a.importance)
      .slice(0, MAX_FEATURES)
      .map((f) => f.feature);
  }, [recentHistory]);

  // Build chart data: one row per iteration, one key per feature
  const chartData = useMemo(() => {
    if (!recentHistory.length || !topFeatures.length) return [];
    return recentHistory.map((entry) => {
      const row: Record<string, number> = { iteration: entry.iteration };
      const globalMap = new Map(
        (entry.state.snapshot.feature_attribution?.global ?? []).map((f) => [f.feature, f.importance]),
      );
      for (const feat of topFeatures) {
        row[feat] = globalMap.get(feat) ?? 0;
      }
      return row;
    });
  }, [recentHistory, topFeatures]);

  const toggleFeature = useCallback((feature: string) => {
    setHiddenFeatures((prev) => {
      const next = new Set(prev);
      if (next.has(feature)) next.delete(feature);
      else next.add(feature);
      return next;
    });
  }, []);

  const hasData = recentHistory.length > 0 && topFeatures.length > 0;
  const subtitle = hasData
    ? `Top ${topFeatures.length} features over ${chartData.length} snapshots`
    : undefined;

  return (
    <ChartCard
      title="Feature Importance Evolution"
      subtitle={subtitle}
      className="lg:col-span-2"
      minHeight={280}
    >
      {/* Interactive legend */}
      {hasData && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {topFeatures.map((feat, i) => {
            const color = FEATURE_COLORS[i % FEATURE_COLORS.length]!;
            const hidden = hiddenFeatures.has(feat);
            return (
              <button
                key={feat}
                onClick={() => toggleFeature(feat)}
                className={`text-[8px] font-mono px-2 py-0.5 rounded-full border transition-all ${
                  hidden
                    ? "border-white/5 text-muted-foreground/20 line-through"
                    : "border-white/15 bg-white/5"
                }`}
                style={{ color: hidden ? undefined : color }}
              >
                {feat}
              </button>
            );
          })}
        </div>
      )}

      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={hasData ? chartData : []} margin={{ top: 4, right: 12, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
          <XAxis
            dataKey="iteration"
            tick={{ fontSize: 8, fill: "#6e7681" }}
            tickLine={false}
            axisLine={false}
            label={!hasData ? { value: "Iteration", position: "bottom", fontSize: 9, fill: "rgba(255,255,255,0.2)" } : undefined}
          />
          <YAxis
            tick={{ fontSize: 8, fill: "#6e7681" }}
            tickLine={false}
            axisLine={false}
            width={50}
            tickFormatter={(v: number) => v.toFixed(3)}
            label={!hasData ? { value: "Importance", angle: -90, position: "insideLeft", fontSize: 9, fill: "rgba(255,255,255,0.2)" } : undefined}
          />
          <Tooltip
            contentStyle={{
              background: "#0d1117",
              border: "1px solid rgba(255,255,255,0.1)",
              fontSize: 9,
              fontFamily: "monospace",
            }}
            formatter={(value: number, name: string) => [value.toFixed(4), name]}
            labelFormatter={(label: number) => `Iteration ${label}`}
          />
          {hasData && topFeatures.map((feat, i) => {
            const color = FEATURE_COLORS[i % FEATURE_COLORS.length]!;
            const hidden = hiddenFeatures.has(feat);
            return (
              <Line
                key={feat}
                type="monotone"
                dataKey={feat}
                stroke={color}
                strokeWidth={1.5}
                strokeOpacity={hidden ? 0 : 1}
                dot={false}
                isAnimationActive={false}
              />
            );
          })}
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export const ShapEvolution = memo(ShapEvolutionInner);
export default ShapEvolution;
