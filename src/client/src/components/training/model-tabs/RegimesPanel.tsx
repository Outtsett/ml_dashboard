/**
 * RegimesPanel — Discovery viz + regime stats table + transition matrix + SHAP.
 *
 * Information hierarchy:
 *   Scan   → Discovery viz (proportional blocks + top transitions)
 *   Read   → Stats table (label, data, return, vol, candle, persistence)
 *   Explore → Transition matrix (full NxN flow), SHAP heatmap (feature drivers)
 *   Detail  → Hover regime label for full fingerprint + defining features
 */

import {
  Tooltip as RadixTooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import RegimeDiscoveryViz from "@/components/training/RegimeDiscoveryViz";
import { TransitionMatrix } from "@/components/regime-analytics/TransitionMatrix";
import { MiniProgress } from "../MicroComponents";
import type { Diagnostics } from "../types";
import { getRegimeColor, VOL_COLORS, CANDLE_LABELS } from "../types";
import { ShapHeatmap } from "./ShapHeatmap";

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
        <TooltipProvider delayDuration={150}>
          <div className="overflow-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/5 text-muted-foreground">
                  <th className="text-left py-2 px-3 font-medium">Regime</th>
                  <th className="text-right py-2 px-3 font-medium">Data</th>
                  <th className="text-right py-2 px-3 font-medium">Return/Bar</th>
                  <th className="text-center py-2 px-3 font-medium">Vol</th>
                  <th className="text-center py-2 px-3 font-medium">Candle</th>
                  <th className="text-right py-2 px-3 font-medium">Persistence</th>
                </tr>
              </thead>
              <tbody>
                {diagnostics.regime_stats.map((regime) => {
                  const c = getRegimeColor(regime.regime_id);
                  const returnPct = regime.avg_return_pct ?? 0;
                  const volState = regime.volatility_state || "normal";
                  const candle = regime.bar_character || "normal";
                  const label = regime.label?.replace(/_/g, " ") || `Regime ${regime.regime_id}`;
                  const topChars = Object.entries(regime.characteristics || {}).slice(0, 3);

                  return (
                    <tr key={regime.regime_id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                      {/* Regime — label + tooltip with full fingerprint */}
                      <td className="py-2 px-3">
                        <RadixTooltip>
                          <TooltipTrigger asChild>
                            <div className="flex items-center gap-1.5 cursor-default">
                              <div className={`w-2 h-2 rounded-full ${c.bg} ${c.border} border shrink-0`} />
                              <span className="font-medium text-foreground truncate max-w-[150px]">{label}</span>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent side="right" className="max-w-[280px] p-0">
                            <div className="p-3 text-xs">
                              <div className="flex items-center gap-1.5 mb-1.5">
                                <div className={`w-2 h-2 rounded-full ${c.bg} ${c.border} border shrink-0`} />
                                <span className="font-medium text-foreground">{label}</span>
                                <span className={`text-[10px] font-mono font-bold ml-auto ${c.text}`}>{regime.pct.toFixed(1)}%</span>
                              </div>
                              {regime.nickname && (
                                <p className="text-[10px] text-muted-foreground leading-snug mb-2">{regime.nickname}</p>
                              )}
                              {topChars.length > 0 && (
                                <>
                                  <div className="text-[9px] text-muted-foreground/50 uppercase tracking-wider mb-1">Defining Features</div>
                                  <div className="space-y-0.5">
                                    {topChars.map(([feat, z]) => (
                                      <div key={feat} className="flex justify-between text-[10px] font-mono">
                                        <span className="text-muted-foreground">{feat.replace(/_/g, " ")}</span>
                                        <span className={z >= 0 ? "text-emerald-400" : "text-rose-400"}>
                                          {z >= 0 ? "+" : ""}{(z as number).toFixed(2)}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                </>
                              )}
                            </div>
                          </TooltipContent>
                        </RadixTooltip>
                      </td>

                      {/* Data — merged bars + percentage */}
                      <td className="text-right py-2 px-3">
                        <div className="font-mono text-muted-foreground">{regime.count.toLocaleString()}</div>
                        <div className={`text-[10px] font-mono font-bold ${c.text}`}>{regime.pct.toFixed(1)}%</div>
                      </td>

                      {/* Return/Bar — directional color + arrow */}
                      <td className={`text-right py-2 px-3 font-mono ${returnPct >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                        <span className="text-[10px] mr-0.5">{returnPct >= 0 ? "\u25B2" : "\u25BC"}</span>
                        {returnPct >= 0 ? "+" : ""}{returnPct.toFixed(3)}%
                      </td>

                      {/* Vol — badge */}
                      <td className="text-center py-2 px-3">
                        <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${VOL_COLORS[volState] || VOL_COLORS.normal}`}>
                          {volState.toUpperCase()}
                        </span>
                      </td>

                      {/* Candle */}
                      <td className="text-center py-2 px-3">
                        <span className="text-[9px] text-muted-foreground">{CANDLE_LABELS[candle] || candle}</span>
                      </td>

                      {/* Persistence — mini bar + numbers */}
                      <td className="py-2 px-3 w-[110px]">
                        <MiniProgress value={regime.avg_duration} max={regime.max_duration} />
                        <div className="text-right font-mono text-muted-foreground text-[10px] mt-0.5">
                          {regime.avg_duration.toFixed(1)} <span className="opacity-40">/</span> {regime.max_duration}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </TooltipProvider>
      )}

      {/* Transition Matrix */}
      {diagnostics.transition_matrix && diagnostics.transition_matrix.length > 0 && (
        <div>
          <div className="text-[9px] text-muted-foreground/50 uppercase tracking-widest mb-2">Regime Transitions</div>
          <div className="bg-white/[0.02] rounded-xl p-4 border border-white/5">
            <TransitionMatrix
              matrix={diagnostics.transition_matrix}
              labels={diagnostics.regime_stats.map(r =>
                r.label?.replace(/_/g, " ") || `Regime ${r.regime_id}`
              )}
            />
            <p className="text-[10px] text-muted-foreground/40 mt-2">
              Row → Column. Green diagonal = regime persists. Cyan = switches to another.
            </p>
          </div>
        </div>
      )}

      {/* SHAP Feature Importance */}
      {diagnostics.shap_summary && diagnostics.shap_summary.length > 0 && (
        <ShapHeatmap shapSummary={diagnostics.shap_summary} regimeStats={diagnostics.regime_stats} />
      )}
    </div>
  );
}
