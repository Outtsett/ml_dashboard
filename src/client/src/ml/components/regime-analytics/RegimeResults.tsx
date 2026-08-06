/**
 * RegimeResults — Full diagnostics display for a trained model.
 *
 * Think of it as: the "report card" for a trained market mood detector —
 * shows quality score, regime breakdown, walk-forward stability, OOS assessment,
 * convergence curves, transition probabilities, and timeline.
 */

import { Badge } from "@/shared/ui/badge";
import { ChevronDown, BarChart3, Shield, Target, Activity, Layers, Zap, Settings2 } from "lucide-react";
import type { Diagnostics, RegimeCategory } from "./types";
import { getRegimeColor, getRegimeIcon, getQualityColor, getQualityLabel } from "./types";

const CATEGORY_STYLE: Record<RegimeCategory, { bg: string; text: string; border: string }> = {
  trend:    { bg: "bg-emerald-500/15", text: "text-emerald-400", border: "border-emerald-500/30" },
  reversal: { bg: "bg-orange-500/15",  text: "text-orange-400",  border: "border-orange-500/30" },
  range:    { bg: "bg-sky-500/15",     text: "text-sky-400",     border: "border-sky-500/30" },
};

function CategoryBadge({ category }: { category?: RegimeCategory }) {
  if (!category) return null;
  const s = CATEGORY_STYLE[category];
  return (
    <Badge variant="outline" className={`text-[6px] px-1 py-0 rounded-full ${s.border} ${s.text} uppercase tracking-widest`}>
      {category}
    </Badge>
  );
}
import { QualityScoreRing, ConvergenceCurve } from "./mini-charts";
import { WalkForwardDisplay } from "./WalkForwardDisplay";
import { OOSDisplay } from "./OOSDisplay";
import { TransitionMatrix } from "./TransitionMatrix";
import { RegimeTimeline } from "./RegimeTimeline";
import { Section } from "./Section";

interface RegimeResultsProps {
  diagnostics: Diagnostics;
  convergenceData: Record<string, Array<{ iter: number; log_likelihood: number; delta: number }>> | null;
  assignmentsData: { rows: Array<{ regime: number; regime_label?: string; split?: string }>; total: number } | null;
  onToggleDiagnostics: () => void;
}

export function RegimeResults({ diagnostics, convergenceData, assignmentsData, onToggleDiagnostics }: RegimeResultsProps) {
  return (
    <div className="space-y-3 pt-1">
      {/* Header with quality score */}
      <div className="flex items-center justify-between">
        <button
          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          onClick={onToggleDiagnostics}
        >
          <ChevronDown className="h-3 w-3" />
          <span className="font-medium uppercase tracking-wider">Training Analytics</span>
          <Badge variant="outline" className="text-[7px] px-1 py-0 ml-1 rounded-full border-orange-500/30 text-orange-400">
            {diagnostics.symbol} {diagnostics.timeframe}
          </Badge>
        </button>
        {diagnostics.quality_score != null && (
          <div className="flex items-center gap-1">
            <QualityScoreRing score={diagnostics.quality_score} />
            <span className={`text-[8px] font-medium ${getQualityColor(diagnostics.quality_score)}`}>
              {getQualityLabel(diagnostics.quality_score)}
            </span>
          </div>
        )}
      </div>

      {/* Data split summary */}
      {diagnostics.n_bars_train_val != null && (
        <div className="p-2 rounded-lg bg-black/20 border border-white/5">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[8px] text-muted-foreground">Data Split</span>
            <span className="text-[8px] font-mono text-foreground/70">
              {(diagnostics.n_bars_total || 0).toLocaleString()} total bars
            </span>
          </div>
          <div className="w-full h-2 rounded-full overflow-hidden flex bg-white/5">
            <div className="h-full bg-blue-500/60"
              style={{ width: `${((diagnostics.n_bars_train_val || 0) / (diagnostics.n_bars_total || 1)) * 100}%` }}
            />
            <div className="h-full bg-amber-500/60"
              style={{ width: `${((diagnostics.n_bars_test || 0) / (diagnostics.n_bars_total || 1)) * 100}%` }}
            />
          </div>
          <div className="flex justify-between mt-0.5">
            <span className="text-[7px] text-blue-400">Train+Val: {(diagnostics.n_bars_train_val || 0).toLocaleString()}</span>
            <span className="text-[7px] text-amber-400">Test: {(diagnostics.n_bars_test || 0).toLocaleString()}</span>
          </div>
        </div>
      )}

      {/* Discovery Info */}
      <Section title="Regime Discovery" icon={<BarChart3 className="h-3 w-3 text-cyan-400" />} defaultOpen>
        <div className="p-1.5 rounded-lg bg-black/30 border border-white/5 space-y-1.5">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[8px] px-1.5 py-0.5 rounded-full border-emerald-500/30 text-emerald-400">
              {diagnostics.n_regimes} regimes discovered
            </Badge>
            <span className="text-[7px] text-muted-foreground font-mono">
              auto (no cap)
            </span>
          </div>
          {diagnostics.hyperparams && (
            <div className="flex gap-1.5 flex-wrap">
              <Badge variant="outline" className="text-[7px] px-1 py-0 rounded-full border-cyan-500/30 text-cyan-400">
                alpha={diagnostics.hyperparams.alpha}
              </Badge>
              <Badge variant="outline" className="text-[7px] px-1 py-0 rounded-full border-violet-500/30 text-violet-400">
                gamma={diagnostics.hyperparams.gamma}
              </Badge>
              <Badge variant="outline" className="text-[7px] px-1 py-0 rounded-full border-orange-500/30 text-orange-400">
                kappa={diagnostics.hyperparams.kappa}
              </Badge>
            </div>
          )}
        </div>
        {/* Convergence info */}
        {diagnostics.convergence_summary && (
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[7px] text-muted-foreground font-mono">
              {diagnostics.convergence_summary.n_iterations} Gibbs iters
            </span>
            <span className="text-[7px] text-muted-foreground font-mono">
              final states: {diagnostics.convergence_summary.final_active_states || diagnostics.n_regimes}
            </span>
          </div>
        )}
      </Section>

      {/* Walk-Forward Results */}
      {diagnostics.walk_forward && diagnostics.walk_forward.n_windows > 0 && (
        <Section title="Walk-Forward Stability" icon={<Target className="h-3 w-3 text-emerald-400" />} defaultOpen>
          <div className="p-1.5 rounded bg-black/20 border border-white/5">
            <WalkForwardDisplay wf={diagnostics.walk_forward} />
          </div>
        </Section>
      )}

      {/* Out-of-Sample Assessment */}
      {diagnostics.out_of_sample && (
        <Section title="Out-of-Sample Assessment" icon={<Shield className="h-3 w-3 text-blue-400" />} defaultOpen>
          <div className="p-1.5 rounded bg-black/20 border border-white/5">
            <OOSDisplay oos={diagnostics.out_of_sample} n_regimes={diagnostics.n_regimes} />
          </div>
        </Section>
      )}

      {/* Gibbs Convergence Curves */}
      {convergenceData && Object.keys(convergenceData).length > 0 && (
        <Section title="Gibbs Convergence" icon={<Activity className="h-3 w-3 text-violet-400" />}>
          <div className="p-1.5 rounded bg-black/20 border border-white/5 space-y-2">
            {Object.entries(convergenceData).map(([key, history]) => (
              <ConvergenceCurve key={key} data={history} label={key === "gibbs" ? "Gibbs Sampler" : key} />
            ))}
          </div>
        </Section>
      )}

      {/* Regime Stats */}
      <Section title="Regime Breakdown" icon={<Layers className="h-3 w-3 text-orange-400" />} defaultOpen>
        {diagnostics.regime_stats.map((r) => {
          const color = getRegimeColor(r.regime_id);
          return (
            <div key={r.regime_id} className={`p-2 rounded-lg ${color.bg} border ${color.border} mb-1.5`}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1.5">
                  <span className={`${color.text}`}>{getRegimeIcon(r.label)}</span>
                  <span className={`text-[10px] font-medium ${color.text}`}>
                    R{r.regime_id}: {r.nickname || r.label.replace(/_/g, " ")}
                  </span>
                  <CategoryBadge category={r.category} />
                </div>
                <Badge variant="outline" className={`text-[7px] px-1 py-0 ${color.border} ${color.text}`}>
                  {r.pct.toFixed(1)}%
                </Badge>
              </div>
              <div className="grid grid-cols-4 gap-x-2 gap-y-0.5">
                <div>
                  <span className="text-[7px] text-muted-foreground">Bars</span>
                  <p className="text-[9px] font-mono">{r.count.toLocaleString()}</p>
                </div>
                <div>
                  <span className="text-[7px] text-muted-foreground">Ret/Bar</span>
                  <p className={`text-[9px] font-mono ${(r.avg_return_pct ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                    {(r.avg_return_pct ?? 0) >= 0 ? '+' : ''}{(r.avg_return_pct ?? 0).toFixed(3)}%
                  </p>
                </div>
                <div>
                  <span className="text-[7px] text-muted-foreground">Volatility</span>
                  <p className="text-[9px] font-mono">{(r.avg_volatility * 100).toFixed(3)}%</p>
                </div>
                <div>
                  <span className="text-[7px] text-muted-foreground">Avg Dur</span>
                  <p className="text-[9px] font-mono">{r.avg_duration.toFixed(0)} bars</p>
                </div>
              </div>
              {/* Proportion bar */}
              <div className="mt-1 h-1 rounded-full bg-white/5 overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${r.pct}%`, backgroundColor: color.hex, opacity: 0.6 }} />
              </div>
            </div>
          );
        })}
      </Section>

      {/* Transition Matrix */}
      {diagnostics.transition_matrix.length > 0 && (
        <Section title="Transition Probabilities" icon={<Activity className="h-3 w-3 text-cyan-400" />}>
          <div className="p-2 rounded-lg bg-black/30 border border-white/5 flex justify-center">
            <TransitionMatrix
              matrix={diagnostics.transition_matrix}
              labels={diagnostics.regime_stats.map(r => r.nickname || r.label)}
            />
          </div>
          <p className="text-[7px] text-muted-foreground/50 text-center mt-1">
            Row → Col · Green = self-stay · Cyan = switch
          </p>
        </Section>
      )}

      {/* Regime Timeline */}
      {assignmentsData?.rows && assignmentsData.rows.length > 0 && (
        <Section title={`Regime Timeline (${assignmentsData.total.toLocaleString()} bars)`} icon={<BarChart3 className="h-3 w-3 text-amber-400" />} defaultOpen>
          <RegimeTimeline
            assignments={assignmentsData.rows.map(r => ({ regime: r.regime }))}
            n_regimes={diagnostics.n_regimes}
          />
          {/* Legend */}
          <div className="flex flex-wrap gap-1.5 mt-1">
            {diagnostics.regime_stats.map(r => {
              const color = getRegimeColor(r.regime_id);
              return (
                <div key={r.regime_id} className="flex items-center gap-1">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color.hex }} />
                  <span className="text-[7px] text-muted-foreground">{(r.nickname || r.label).replace(/_/g, " ")}</span>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* Feature list */}
      <Section title={`Features (${diagnostics.n_features})`} icon={<Zap className="h-3 w-3 text-amber-400" />}>
        <div className="flex flex-wrap gap-1">
          {diagnostics.feature_names.map(f => (
            <Badge key={f} variant="outline" className="text-[7px] px-1.5 py-0 rounded-full border-white/10">
              {f}
            </Badge>
          ))}
        </div>
      </Section>

      {/* Training config summary */}
      {diagnostics.training_config && (
        <Section title="Training Config" icon={<Settings2 className="h-3 w-3 text-muted-foreground" />}>
          <div className="grid grid-cols-3 gap-1 p-1.5 rounded bg-black/20 border border-white/5">
            {Object.entries(diagnostics.training_config).map(([k, v]) => (
              <div key={k}>
                <span className="text-[7px] text-muted-foreground/50">{k.replace(/_/g, " ")}</span>
                <p className="text-[8px] font-mono text-foreground/70">{String(v)}</p>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
