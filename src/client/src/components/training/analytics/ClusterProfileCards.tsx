/**
 * ClusterProfileCards — One card per regime with return, volatility, duration stats.
 *
 * SRP: Renders per-regime profile summaries only.
 */

import type { AnalyticsComponentProps } from "./index";
import { getRegimeColor, VOL_COLORS, CANDLE_LABELS } from "../types";
import { ChartCard, EmptyState } from "./shared";

export default function ClusterProfileCards({ diagnostics }: AnalyticsComponentProps) {
  const { regime_stats } = diagnostics;

  if (!regime_stats?.length) {
    return (
      <ChartCard title="Cluster Profiles" className="lg:col-span-2">
        <EmptyState message="No regime stats" />
      </ChartCard>
    );
  }

  return (
    <ChartCard title="Cluster Profiles" subtitle={`${regime_stats.length} regimes discovered`} className="lg:col-span-2">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
        {regime_stats.map((rs, i) => {
          const color = getRegimeColor(i);
          const volBadge = rs.volatility_state ? VOL_COLORS[rs.volatility_state] || "" : "";
          const candleLabel = rs.bar_character ? CANDLE_LABELS[rs.bar_character] || rs.bar_character : "";
          const returnPct = rs.avg_return_pct ?? rs.avg_return * 100;
          return (
            <div
              key={i}
              className="bg-white/[0.02] rounded-xl border p-3"
              style={{ borderColor: `${color.fill}30` }}
            >
              <div className="flex items-center gap-2 mb-2">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color.fill }} />
                <span className="text-[11px] font-medium">{rs.label}</span>
                <span className="text-[9px] font-mono text-muted-foreground/50 ml-auto">{rs.pct.toFixed(1)}%</span>
              </div>

              <div className="space-y-1 text-[9px]">
                <div className="flex justify-between">
                  <span className="text-muted-foreground/50">Return/bar</span>
                  <span className={`font-mono ${returnPct > 0 ? "text-emerald-400" : "text-rose-400"}`}>
                    {returnPct.toFixed(2)}%
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground/50">Volatility</span>
                  <span className="font-mono">{(rs.avg_volatility * 100).toFixed(2)}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground/50">Avg duration</span>
                  <span className="font-mono">{rs.avg_duration?.toFixed(1) ?? "\u2014"} bars</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground/50">Max duration</span>
                  <span className="font-mono">{rs.max_duration ?? "\u2014"} bars</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground/50">Count</span>
                  <span className="font-mono">{rs.count.toLocaleString()}</span>
                </div>
              </div>

              <div className="flex flex-wrap gap-1 mt-2">
                {rs.volatility_state && (
                  <span className={`text-[7px] px-1.5 py-0.5 rounded-full ${volBadge}`}>
                    {rs.volatility_state}
                  </span>
                )}
                {candleLabel && (
                  <span className="text-[7px] px-1.5 py-0.5 rounded-full bg-white/5 text-muted-foreground/50">
                    {candleLabel}
                  </span>
                )}
              </div>

              {rs.characteristics && Object.keys(rs.characteristics).length > 0 && (
                <div className="mt-2 border-t border-white/5 pt-1.5">
                  <div className="text-[7px] text-muted-foreground/30 uppercase mb-1">Defining Features</div>
                  {Object.entries(rs.characteristics)
                    .sort(([, a], [, b]) => Math.abs(b) - Math.abs(a))
                    .slice(0, 3)
                    .map(([feat, z]) => (
                      <div key={feat} className="flex justify-between text-[8px]">
                        <span className="text-muted-foreground/40 truncate">{feat.replace(/_/g, " ")}</span>
                        <span className={`font-mono ${z > 0 ? "text-blue-400/70" : "text-rose-400/70"}`}>
                          {z > 0 ? "+" : ""}{z.toFixed(1)}\u03C3
                        </span>
                      </div>
                    ))
                  }
                </div>
              )}
            </div>
          );
        })}
      </div>
    </ChartCard>
  );
}
