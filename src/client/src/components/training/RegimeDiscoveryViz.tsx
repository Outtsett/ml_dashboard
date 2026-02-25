/**
 * RegimeDiscoveryViz — Visual representation of discovered HDP-HMM regimes.
 *
 * Think of it as: A museum exhibit showing the different "market personalities"
 * the Gibbs sampler found. Each regime is a colored block whose SIZE matches
 * how often the market was in that mood, and the ARROWS between them show
 * how the market typically transitions from one personality to another.
 *
 * Replaces CNNArchitectureViz for the HDP-HMM training flow.
 */

import {
  TrendingUp, TrendingDown, Activity, Zap, Minus, ArrowRight,
} from 'lucide-react';
import { getRegimeColor } from './types';

function getRegimeIcon(label: string) {
  if (label.includes('up')) return <TrendingUp className="h-3 w-3" />;
  if (label.includes('down')) return <TrendingDown className="h-3 w-3" />;
  if (label.includes('volatile') || label.includes('choppy')) return <Zap className="h-3 w-3" />;
  if (label.includes('quiet') || label.includes('calm')) return <Minus className="h-3 w-3" />;
  return <Activity className="h-3 w-3" />;
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RegimeStatMinimal {
  regime_id: number;
  count: number;
  pct: number;
  avg_return: number;
  avg_volatility: number;
  avg_range: number;
  avg_duration: number;
  label: string;
}

export interface TransitionMinimal {
  from: number;
  to: number;
  probability: number;
}

interface RegimeDiscoveryVizProps {
  regimeStats: RegimeStatMinimal[];
  transitions?: TransitionMinimal[];
  nRegimes?: number;
  isTraining?: boolean;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function RegimeDiscoveryViz({
  regimeStats,
  transitions,
  nRegimes,
  isTraining,
}: RegimeDiscoveryVizProps) {
  if (!regimeStats || regimeStats.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-2">
        <Activity className={`h-8 w-8 opacity-30 ${isTraining ? 'animate-pulse' : ''}`} />
        <p className="text-xs">
          {isTraining ? 'Discovering regimes...' : 'Train a model to see discovered regimes'}
        </p>
      </div>
    );
  }

  const totalBars = regimeStats.reduce((s, r) => s + r.count, 0);
  const maxPct = Math.max(...regimeStats.map(r => r.pct));

  // Top 3 strongest transitions for arrows
  const topTransitions = (transitions || [])
    .filter(t => t.from !== t.to && t.probability > 0.05)
    .sort((a, b) => b.probability - a.probability)
    .slice(0, 3);

  return (
    <div className="flex flex-col h-full px-3 py-2 gap-2">
      {/* Summary header */}
      <div className="flex items-center gap-2 px-1">
        <span className="text-[9px] text-muted-foreground uppercase tracking-widest">
          {nRegimes ?? regimeStats.length} regimes · {(totalBars / 1000).toFixed(1)}K bars
        </span>
      </div>

      {/* Regime blocks - proportionally sized */}
      <div className="flex items-end gap-1.5 flex-1 min-h-0 px-1">
        {regimeStats
          .sort((a, b) => b.pct - a.pct)
          .map((regime) => {
            const color = getRegimeColor(regime.regime_id);
            // Height proportional to percentage (min 30%, max 100%)
            const heightPct = Math.max(30, (regime.pct / maxPct) * 100);
            const label = regime.label || `Regime ${regime.regime_id}`;

            return (
              <div
                key={regime.regime_id}
                className="flex flex-col items-center gap-0.5 flex-1 min-w-0"
              >
                {/* Label & icon */}
                <div className={`flex items-center gap-0.5 ${color.text} max-w-full`}>
                  {getRegimeIcon(label)}
                  <span className="text-[8px] font-medium truncate" title={label.replace(/_/g, ' ')}>
                    {label.replace(/_/g, ' ')}
                  </span>
                </div>

                {/* Proportional block */}
                <div
                  className={`w-full rounded-lg border transition-all hover:scale-[1.02] flex flex-col items-center justify-center gap-0.5 ${color.bg} ${color.border}`}
                  style={{ height: `${heightPct}%`, minHeight: 48 }}
                >
                  <div className={`text-sm font-mono font-bold ${color.text}`}>
                    {regime.pct.toFixed(1)}%
                  </div>
                  <div className="text-[8px] text-muted-foreground">
                    {regime.count.toLocaleString()} bars
                  </div>
                </div>

                {/* Key stats */}
                <div className="text-[7px] text-muted-foreground/60 text-center space-y-0.5">
                  <div>ret: {(regime.avg_return * 100).toFixed(3)}%</div>
                  <div>vol: {(regime.avg_volatility * 100).toFixed(2)}%</div>
                  <div>dur: {regime.avg_duration.toFixed(1)} bars</div>
                </div>
              </div>
            );
          })}
      </div>

      {/* Top transitions strip */}
      {topTransitions.length > 0 && (
        <div className="flex items-center gap-2 justify-center pt-1 border-t border-white/5">
          <span className="text-[8px] text-muted-foreground/50">Top transitions:</span>
          {topTransitions.map((t, i) => {
            const fromColor = getRegimeColor(t.from);
            const toColor = getRegimeColor(t.to);
            return (
              <div key={i} className="flex items-center gap-0.5">
                <span className={`text-[9px] font-mono font-bold ${fromColor.text}`}>R{t.from}</span>
                <ArrowRight className="h-2.5 w-2.5 text-muted-foreground/30" />
                <span className={`text-[9px] font-mono font-bold ${toColor.text}`}>R{t.to}</span>
                <span className="text-[8px] text-muted-foreground/40 ml-0.5">
                  {(t.probability * 100).toFixed(0)}%
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
