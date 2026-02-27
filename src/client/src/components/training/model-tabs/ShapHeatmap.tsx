/**
 * ShapHeatmap — Global bar chart + per-regime heatmap of SHAP feature importance.
 */

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { ShapRegimeSummary, RegimeStat } from "../types";
import { getRegimeColor, CHART_GRID, CHART_AXIS, CHART_TOOLTIP } from "../types";

const featureLabel = (name: string) =>
  name.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());

export function ShapHeatmap({ shapSummary, regimeStats }: { shapSummary: ShapRegimeSummary[]; regimeStats: RegimeStat[] }) {
  // Aggregate global feature importance
  const featureScores = new Map<string, { abs: number; dir: number; count: number }>();
  for (const regime of shapSummary) {
    for (const f of regime.top_features) {
      const prev = featureScores.get(f.feature) || { abs: 0, dir: 0, count: 0 };
      prev.abs += f.mean_abs_shap;
      prev.dir += f.mean_shap;
      prev.count += 1;
      featureScores.set(f.feature, prev);
    }
  }

  // Top 8 features for heatmap columns
  const topFeatures = Array.from(featureScores.entries())
    .sort((a, b) => b[1].abs / b[1].count - a[1].abs / a[1].count)
    .slice(0, 8)
    .map(([name]) => name);

  // Global bar chart data (top 10)
  const globalData = Array.from(featureScores.entries())
    .map(([name, { abs, count }]) => ({
      feature: featureLabel(name),
      importance: parseFloat((abs / count).toFixed(4)),
    }))
    .sort((a, b) => b.importance - a.importance)
    .slice(0, 10);

  // Per-regime lookup
  const lookup = new Map<number, Map<string, number>>();
  for (const regime of shapSummary) {
    const fm = new Map<string, number>();
    for (const f of regime.top_features) fm.set(f.feature, f.mean_shap);
    lookup.set(regime.regime_id, fm);
  }

  // Color scaling
  let maxMag = 0;
  for (const regime of shapSummary) {
    for (const f of regime.top_features) {
      if (topFeatures.includes(f.feature)) {
        maxMag = Math.max(maxMag, Math.abs(f.mean_shap));
      }
    }
  }
  const cellColor = (v: number) => {
    const intensity = Math.min(1, Math.abs(v) / (maxMag || 1));
    const alpha = (0.1 + intensity * 0.65).toFixed(2);
    return v >= 0 ? `rgba(59, 130, 246, ${alpha})` : `rgba(244, 63, 94, ${alpha})`;
  };

  return (
    <div className="space-y-4">
      {/* Global Feature Importance */}
      <div>
        <div className="text-[9px] text-muted-foreground/50 uppercase tracking-widest mb-2">
          Global Feature Importance (SHAP)
        </div>
        <div className="h-[200px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={globalData} layout="vertical" margin={{ left: 95, right: 10, top: 5, bottom: 5 }}>
              <CartesianGrid {...CHART_GRID} />
              <XAxis type="number" {...CHART_AXIS} />
              <YAxis type="category" dataKey="feature" {...CHART_AXIS} width={90} tick={{ fontSize: 9 }} />
              <Tooltip {...CHART_TOOLTIP} />
              <Bar dataKey="importance" fill="hsl(210, 70%, 55%)" radius={[0, 3, 3, 0]} name="Mean |SHAP|" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Per-Regime Heatmap */}
      <div>
        <div className="text-[9px] text-muted-foreground/50 uppercase tracking-widest mb-1">
          Per-Regime Feature Effects
        </div>
        <p className="text-[10px] text-muted-foreground/40 mb-2">
          Blue = feature supports this regime. Red = feature argues against it. Brighter = stronger.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-[10px] border-collapse">
            <thead>
              <tr className="border-b border-white/10">
                <th className="text-left py-1.5 px-2 font-medium text-muted-foreground sticky left-0 bg-background/80 backdrop-blur-sm z-10">
                  Regime
                </th>
                {topFeatures.map(f => (
                  <th key={f} className="text-center py-1.5 px-0.5 font-medium text-muted-foreground/70 whitespace-nowrap">
                    <span className="text-[8px]">{featureLabel(f)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {regimeStats.map(regime => {
                const c = getRegimeColor(regime.regime_id);
                const fm = lookup.get(regime.regime_id);
                return (
                  <tr key={regime.regime_id} className="border-b border-white/5 hover:bg-white/[0.02]">
                    <td className="py-1 px-2 sticky left-0 bg-background/80 backdrop-blur-sm z-10">
                      <div className="flex items-center gap-1">
                        <div className={`w-1.5 h-1.5 rounded-full ${c.bg} ${c.border} border shrink-0`} />
                        <span className="font-medium truncate max-w-[100px] text-[9px]">
                          {regime.nickname || regime.label}
                        </span>
                      </div>
                    </td>
                    {topFeatures.map(f => {
                      const val = fm?.get(f) ?? 0;
                      return (
                        <td key={f} className="py-0.5 px-0.5 text-center">
                          <div
                            className="mx-auto rounded text-[8px] font-mono flex items-center justify-center"
                            style={{
                              backgroundColor: cellColor(val),
                              minWidth: "2.5rem",
                              height: "1.25rem",
                            }}
                            title={`${f}: ${val >= 0 ? "+" : ""}${val.toFixed(4)}`}
                          >
                            {Math.abs(val) >= 0.005
                              ? `${val >= 0 ? "+" : ""}${val.toFixed(2)}`
                              : "\u00B7"}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
