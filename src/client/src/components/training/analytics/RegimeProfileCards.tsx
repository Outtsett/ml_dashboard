/**
 * RegimeProfileCards — Per-regime stat cards with return, volatility, Sharpe,
 * dwell times, and transition targets.
 *
 * Reads regime_profiles and assignment_confidence from the model state snapshot.
 * One card per active regime, laid out in a 2-3 column grid.
 */

import { memo, useMemo } from "react";
import { useTrainingModelState } from "@/contexts/TrainingModelStateCtx";
import { ChartCard } from "./shared";

const REGIME_COLORS = [
  "#22c55e", "#3b82f6", "#f59e0b", "#ef4444", "#a855f7",
  "#06b6d4", "#ec4899", "#84cc16", "#f97316", "#6366f1",
];

function sharpeColor(s: number): string {
  if (s > 1.0) return "#22c55e";
  if (s >= 0) return "#eab308";
  return "#ef4444";
}

function returnColor(r: number): string {
  return r >= 0 ? "#34d399" : "#fb7185";
}

// ── Transition bar ──────────────────────────────────────────────────────────

function TransitionBar({ targets }: { targets: Array<{ to: number; prob: number }> }) {
  if (!targets || targets.length === 0) return null;
  const sorted = [...targets].sort((a, b) => b.prob - a.prob);

  return (
    <div className="mt-2 border-t border-white/[0.08] pt-2">
      <div className="text-[8px] text-muted-foreground/50 mb-1">Transitions</div>
      <div className="flex h-2.5 rounded-full overflow-hidden bg-white/[0.03]">
        {sorted.map((t) => (
          <div
            key={t.to}
            className="h-full"
            style={{
              width: `${(t.prob * 100).toFixed(1)}%`,
              backgroundColor: REGIME_COLORS[t.to % REGIME_COLORS.length],
              opacity: 0.9,
            }}
            title={`R${t.to}: ${(t.prob * 100).toFixed(1)}%`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-2 mt-1">
        {sorted.slice(0, 4).map((t) => (
          <span key={t.to} className="text-[7px] font-mono text-muted-foreground/60">
            R{t.to}{" "}
            <span className="font-semibold" style={{ color: REGIME_COLORS[t.to % REGIME_COLORS.length] }}>
              {(t.prob * 100).toFixed(0)}%
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Confidence histogram ────────────────────────────────────────────────────

function ConfidenceHistogram({ bins }: { bins: number[] }) {
  const max = Math.max(...bins, 1);
  return (
    <div className="bg-white/[0.04] rounded-xl border border-white/[0.06] p-3">
      <div className="text-[10px] font-medium text-foreground/70 uppercase tracking-wider mb-2">
        Assignment Confidence
      </div>
      <div className="flex items-end gap-0.5 h-12">
        {bins.map((count, i) => {
          const pct = (count / max) * 100;
          return (
            <div
              key={i}
              className="flex-1 rounded-t"
              style={{
                height: `${pct}%`,
                backgroundColor: pct > 60 ? "#34d399" : pct > 30 ? "#facc15" : "#fb7185",
                opacity: 0.85,
              }}
              title={`${(i * 10).toFixed(0)}-${((i + 1) * 10).toFixed(0)}%: ${count}`}
            />
          );
        })}
      </div>
      <div className="flex justify-between mt-1">
        <span className="text-[7px] text-muted-foreground/40 font-mono">0%</span>
        <span className="text-[7px] text-muted-foreground/40 font-mono">100%</span>
      </div>
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

function RegimeProfileCardsInner() {
  const { modelState } = useTrainingModelState();

  const profiles = useMemo(
    () => modelState?.snapshot.regime_profiles ?? [],
    [modelState],
  );
  const confidence = modelState?.snapshot.assignment_confidence;

  const hasData = profiles.length > 0;

  if (!hasData) {
    // Show 3 placeholder regime cards
    const placeholders = [0, 1, 2];
    return (
      <ChartCard title="Regime Profiles" className="lg:col-span-2" minHeight={200}>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
          {placeholders.map((id) => {
            const color = REGIME_COLORS[id % REGIME_COLORS.length];
            return (
              <div
                key={id}
                className="bg-white/[0.04] rounded-xl border border-white/[0.06] p-3"
                style={{ borderLeftColor: color, borderLeftWidth: 4 }}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-medium text-muted-foreground/30">
                    Regime {id}
                  </span>
                  <span className="text-[8px] font-mono px-1.5 py-0.5 rounded bg-white/5 text-muted-foreground/20">
                    {"\u2014"}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[9px]">
                  {["Return", "Vol", "Sharpe", "Avg Dwell", "Max Dwell", "Bars"].map((label) => (
                    <div key={label} className="flex justify-between">
                      <span className="text-muted-foreground/20">{label}</span>
                      <span className="font-mono text-muted-foreground/20">{"\u2014"}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </ChartCard>
    );
  }

  return (
    <ChartCard
      title="Regime Profiles"
      subtitle={`${profiles.length} active regimes`}
      className="lg:col-span-2"
      minHeight={200}
    >
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
        {profiles.map((p) => {
          const color = REGIME_COLORS[p.regime_id % REGIME_COLORS.length];
          return (
            <div
              key={p.regime_id}
              className="bg-white/[0.04] hover:bg-white/[0.08] rounded-xl border border-white/[0.06] p-3 transition-interactive hover-lift"
              style={{ borderLeftColor: color, borderLeftWidth: 5 }}
            >
              {/* Header */}
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-medium text-foreground/90">
                  Regime {p.regime_id}
                  <span className="text-foreground/70"> &mdash; {p.label}</span>
                </span>
                <span className="text-[8px] font-mono font-semibold px-1.5 py-0.5 rounded bg-white/[0.08] text-foreground/70">
                  {(p.bar_pct * 100).toFixed(1)}%
                </span>
              </div>

              {/* Stats grid */}
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[9px]">
                <div className="flex justify-between">
                  <span className="text-muted-foreground/60">Return</span>
                  <span className={`font-mono font-semibold metric-glow ${p.mean_return >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                    {p.mean_return >= 0 ? "+" : ""}{(p.mean_return * 100).toFixed(3)}%
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground/60">Vol</span>
                  <span className="font-mono font-semibold text-foreground/80">{(p.volatility * 100).toFixed(3)}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground/60">Sharpe</span>
                  <span className="font-mono font-semibold metric-glow" style={{ color: sharpeColor(p.sharpe) }}>
                    {p.sharpe.toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground/60">Avg Dwell</span>
                  <span className="font-mono font-semibold text-foreground/80">{p.mean_dwell.toFixed(1)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground/60">Max Dwell</span>
                  <span className="font-mono font-semibold text-foreground/80">{p.max_dwell}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground/60">Bars</span>
                  <span className="font-mono font-semibold text-foreground/80">{p.bar_count.toLocaleString()}</span>
                </div>
              </div>

              {/* Transitions */}
              <TransitionBar targets={p.transition_targets} />
            </div>
          );
        })}
      </div>

      {/* Assignment confidence histogram (shared) */}
      {confidence && confidence.length > 0 && (
        <div className="mt-3">
          <ConfidenceHistogram bins={confidence} />
        </div>
      )}
    </ChartCard>
  );
}

export const RegimeProfileCards = memo(RegimeProfileCardsInner);
export default RegimeProfileCards;
