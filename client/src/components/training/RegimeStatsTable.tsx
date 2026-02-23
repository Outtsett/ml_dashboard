/**
 * RegimeStatsTable — Regime characteristics table showing each regime's
 * personality: nickname, bar count, percentage, return/bar, volatility
 * state, candle shape, and average/max duration.
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart3, Layers } from "lucide-react";
import type { TrainingState } from "./types";
import { getRegimeColor, VOL_COLORS, CANDLE_LABELS } from "./types";

export default function RegimeStatsTable({ state }: { state: TrainingState }) {
  const { diagnostics } = state;

  return (
    <Card className="glass rounded-2xl gradient-border">
      <CardHeader className="border-b border-white/5 py-2 px-4">
        <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-2 cursor-help"
          title="Each regime's personality card. Nickname = what the candle pattern looks like. Bars/% = how often it appears. Return/Bar = actual average price change per bar (from close prices, not z-scores). Vol badge = how volatile compared to normal (EXTREME/HIGH/NORMAL/LOW/QUIET based on ATR). Candle = typical candlestick shape. Duration = avg/max consecutive bars.">
          <BarChart3 className="h-3 w-3 text-violet-400" /> Regime Characteristics
          <span className="text-[10px] opacity-50 ml-auto font-normal">
            Think of it as: each regime's personality card
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {diagnostics?.regime_stats && diagnostics.regime_stats.length > 0 ? (
          <div className="overflow-auto max-h-[360px]">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-card z-10">
                <tr className="border-b border-white/5 text-muted-foreground">
                  <th className="text-left py-2 px-3 font-medium">Regime</th>
                  <th className="text-right py-2 px-3 font-medium">Bars</th>
                  <th className="text-right py-2 px-3 font-medium">%</th>
                  <th className="text-right py-2 px-3 font-medium" title="Actual average return per bar from close prices">Return/Bar</th>
                  <th className="text-center py-2 px-3 font-medium" title="Volatility state relative to ATR">Vol</th>
                  <th className="text-center py-2 px-3 font-medium" title="Typical candle shape in this regime">Candle</th>
                  <th className="text-right py-2 px-3 font-medium" title="Average / Maximum consecutive bars">Duration</th>
                </tr>
              </thead>
              <tbody>
                {diagnostics.regime_stats.map((regime) => {
                  const c = getRegimeColor(regime.regime_id);
                  const returnPct = regime.avg_return_pct ?? 0;
                  const volState = regime.volatility_state || 'normal';
                  const candle = regime.bar_character || 'normal';
                  return (
                    <tr key={regime.regime_id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                      <td className="py-2 px-3">
                        <div className="flex items-center gap-1.5">
                          <div className={`w-2 h-2 rounded-full ${c.bg} ${c.border} border shrink-0`} />
                          <span className="font-medium text-foreground truncate max-w-[130px]" title={`${regime.nickname || regime.label} (${regime.label})`}>
                            {regime.nickname || regime.label?.replace(/_/g, ' ') || `Regime ${regime.regime_id}`}
                          </span>
                        </div>
                      </td>
                      <td className="text-right py-2 px-3 font-mono text-muted-foreground">
                        {regime.count.toLocaleString()}
                      </td>
                      <td className={`text-right py-2 px-3 font-mono font-bold ${c.text}`}>
                        {regime.pct.toFixed(1)}%
                      </td>
                      <td className={`text-right py-2 px-3 font-mono ${returnPct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {returnPct >= 0 ? '+' : ''}{returnPct.toFixed(3)}%
                      </td>
                      <td className="text-center py-2 px-3">
                        <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${VOL_COLORS[volState] || VOL_COLORS.normal}`}>
                          {volState.toUpperCase()}
                        </span>
                      </td>
                      <td className="text-center py-2 px-3">
                        <span className="text-[9px] text-muted-foreground" title={candle.replace(/_/g, ' ')}>
                          {CANDLE_LABELS[candle] || candle}
                        </span>
                      </td>
                      <td className="text-right py-2 px-3 font-mono text-muted-foreground">
                        {regime.avg_duration.toFixed(1)}
                        <span className="opacity-40"> / </span>
                        {regime.max_duration}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="h-[200px] flex flex-col items-center justify-center text-muted-foreground">
            <Layers className="h-8 w-8 mb-2 opacity-30" />
            <p className="text-xs">No regime data yet</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
