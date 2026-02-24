/**
 * RegimesPanel — Discovery viz + regime stats table + duration chart.
 */

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from "recharts";
import RegimeDiscoveryViz from "@/components/training/RegimeDiscoveryViz";
import type { Diagnostics } from "../types";
import { getRegimeColor, VOL_COLORS, CANDLE_LABELS, CHART_GRID, CHART_AXIS, CHART_TOOLTIP } from "../types";

export function RegimesPanel({ diagnostics }: { diagnostics: Diagnostics }) {
  return (
    <div className="space-y-4">
      {/* Discovery Visualization */}
      <div className="h-[380px] border border-white/5 rounded-xl overflow-hidden">
        <RegimeDiscoveryViz
          regimeStats={diagnostics.regime_stats || []}
          transitions={diagnostics.transitions}
          nRegimes={diagnostics.n_regimes}
          isTraining={false}
        />
      </div>

      {/* Stats Table */}
      {diagnostics.regime_stats && diagnostics.regime_stats.length > 0 && (
        <div className="overflow-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-white/5 text-muted-foreground">
                <th className="text-left py-2 px-3 font-medium">Regime</th>
                <th className="text-right py-2 px-3 font-medium">Bars</th>
                <th className="text-right py-2 px-3 font-medium">%</th>
                <th className="text-right py-2 px-3 font-medium">Return/Bar</th>
                <th className="text-center py-2 px-3 font-medium">Vol</th>
                <th className="text-center py-2 px-3 font-medium">Candle</th>
                <th className="text-right py-2 px-3 font-medium">Avg / Max</th>
              </tr>
            </thead>
            <tbody>
              {diagnostics.regime_stats.map((regime) => {
                const c = getRegimeColor(regime.regime_id);
                const returnPct = regime.avg_return_pct ?? 0;
                const volState = regime.volatility_state || "normal";
                const candle = regime.bar_character || "normal";
                return (
                  <tr key={regime.regime_id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                    <td className="py-2 px-3">
                      <div className="flex items-center gap-1.5">
                        <div className={`w-2 h-2 rounded-full ${c.bg} ${c.border} border shrink-0`} />
                        <span className="font-medium text-foreground truncate max-w-[150px]" title={regime.nickname || regime.label}>
                          {regime.nickname || regime.label?.replace(/_/g, " ") || `Regime ${regime.regime_id}`}
                        </span>
                      </div>
                    </td>
                    <td className="text-right py-2 px-3 font-mono text-muted-foreground">{regime.count.toLocaleString()}</td>
                    <td className={`text-right py-2 px-3 font-mono font-bold ${c.text}`}>{regime.pct.toFixed(1)}%</td>
                    <td className={`text-right py-2 px-3 font-mono ${returnPct >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                      {returnPct >= 0 ? "+" : ""}{returnPct.toFixed(3)}%
                    </td>
                    <td className="text-center py-2 px-3">
                      <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${VOL_COLORS[volState] || VOL_COLORS.normal}`}>
                        {volState.toUpperCase()}
                      </span>
                    </td>
                    <td className="text-center py-2 px-3">
                      <span className="text-[9px] text-muted-foreground">{CANDLE_LABELS[candle] || candle}</span>
                    </td>
                    <td className="text-right py-2 px-3 font-mono text-muted-foreground">
                      {regime.avg_duration.toFixed(1)} <span className="opacity-40">/</span> {regime.max_duration}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Regime Durations Chart */}
      {diagnostics.regime_stats && diagnostics.regime_stats.length > 0 && (
        <div className="h-[200px]">
          <div className="text-[9px] text-muted-foreground/50 uppercase tracking-widest mb-2">Duration Distribution (bars per regime visit)</div>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={diagnostics.regime_stats.map(r => ({
              regime: r.nickname || r.label || `R${r.regime_id}`,
              avg: Number(r.avg_duration.toFixed(1)),
              max: r.max_duration,
            }))}>
              <CartesianGrid {...CHART_GRID} />
              <XAxis dataKey="regime" {...CHART_AXIS} fontSize={8} angle={-15} />
              <YAxis {...CHART_AXIS} label={{ value: "bars", angle: -90, position: "insideLeft", fontSize: 8, fill: "hsl(var(--muted-foreground))" }} />
              <Tooltip {...CHART_TOOLTIP} />
              <Legend wrapperStyle={{ fontSize: "9px" }} />
              <Bar dataKey="avg" fill="hsl(350, 70%, 60%)" radius={[2, 2, 0, 0]} name="Avg Duration" />
              <Bar dataKey="max" fill="hsla(350, 70%, 60%, 0.3)" radius={[2, 2, 0, 0]} name="Max Duration" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
