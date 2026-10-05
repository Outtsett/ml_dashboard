/**
 * RegimeLegend — Clickable regime color legend shown above the chart.
 *
 * Each pill represents a discovered regime. Click to filter — only
 * selected regimes get colored candles, the rest revert to standard green/red.
 */

import { REGIME_COLORS } from "@/ml/components/regime-analytics/types";

export interface RegimeInfo {
  id: number;
  label: string;
  count: number;
  pct: number;
}

interface RegimeLegendProps {
  regimes: RegimeInfo[];
  selectedRegimes: Set<number> | null; // null = all visible
  onToggleRegime: (id: number) => void;
  onShowAll: () => void;
}

export function RegimeLegend({ regimes, selectedRegimes, onToggleRegime, onShowAll }: RegimeLegendProps) {
  if (regimes.length === 0) return null;

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {regimes.map((r) => {
        const color = REGIME_COLORS[r.id % REGIME_COLORS.length]!;
        const active = selectedRegimes === null || selectedRegimes.has(r.id);
        return (
          <button
            key={r.id}
            onClick={() => onToggleRegime(r.id)}
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-[9px] transition-colors ${
              active
                ? `${color.border} ${color.text} ${color.bg}`
                : 'border-white/5 text-muted-foreground/30 bg-transparent'
            }`}
            title={`${r.label} (${r.count.toLocaleString()} bars, ${r.pct.toFixed(1)}%) — click to ${active ? 'hide' : 'show'}`}
          >
            <span
              className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{ backgroundColor: active ? color.fill : 'rgba(255,255,255,0.1)' }}
            />
            <span className="font-mono">R{r.id}</span>
            <span className="opacity-60">{r.pct.toFixed(0)}%</span>
          </button>
        );
      })}
      {selectedRegimes !== null && (
        <button
          onClick={onShowAll}
          className="text-[9px] text-primary/70 hover:text-primary underline ml-1"
        >
          Show all
        </button>
      )}
    </div>
  );
}
