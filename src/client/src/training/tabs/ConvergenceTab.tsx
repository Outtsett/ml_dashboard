/**
 * ConvergenceTab — Live convergence charts during training, saved convergence post-training.
 *
 * During live training: renders streaming metric area charts from iterationHistory.
 * Post-training: renders saved convergence curves (log-likelihood + regime count).
 * Pre-training: shows metric reference cards for the selected model type.
 */

import { useMemo } from "react";
import {
  LineChart, Line, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { useTrainingControl, useTrainingLive, useTrainingLogs } from "@/training/lib/TrainingContext";
import { useMetricDescriptions, formatMetricValue } from "@/infrastructure/lib/useMetricDescriptions";
import { EmptyState } from "@/shared/layout/NotImplemented";
import { TrendingUp } from "lucide-react";

export interface ConvergenceTabProps {
  /** Saved convergence data points from /api/training/models/:id/convergence */
  convergenceData: Record<string, unknown>[] | null | undefined;
  /** Merged diagnostics (live SSE or saved) */
  diagnostics: Record<string, unknown> | null;
  /** Whether a completed or selected model is active */
  hasCompleted: boolean;
  /** Whether live streaming data exists */
  hasLiveData: boolean;
  /** Current symbol */
  symbol: string;
  /** Current timeframe */
  timeframe: string;
}

// ── Helper ──────────────────────────────────────────────────────────────────

function snake(s: string): string {
  return s.replace(/[A-Z]/g, m => `_${m.toLowerCase()}`);
}

function DescBox({ label, color, text }: { label: string; color: string; text: string }) {
  if (!text) return null;
  return (
    <div>
      <span className={`text-[9px] font-mono ${color} uppercase tracking-wider`}>{label}</span>
      <p className="text-[10px] text-muted-foreground/50 leading-relaxed mt-0.5">{text}</p>
    </div>
  );
}

// ── Component ───────────────────────────────────────────────────────────────

export function ConvergenceTab({
  convergenceData,
  diagnostics: _diagnostics,
  hasCompleted,
  hasLiveData,
  symbol,
  timeframe,
}: ConvergenceTabProps) {
  const { selectedModelType } = useTrainingControl();
  const { iterationHistory } = useTrainingLive();
  const { logs } = useTrainingLogs();
  const { descriptions, metricOrder } = useMetricDescriptions(selectedModelType || "primitives-discovery");

  const modelName = selectedModelType || "primitives-discovery";

  // ── Live metric series from iterationHistory ──────────────────────────────
  const metricSeries = useMemo(() => {
    const series: Record<string, Array<{ iteration: number; value: number }>> = {};
    for (const key of metricOrder) series[key] = [];
    for (const entry of (iterationHistory ?? [])) {
      for (const key of metricOrder) {
        const val = entry.metrics[key] ?? entry.metrics[snake(key)];
        if (val != null) series[key]?.push({ iteration: entry.iteration, value: val });
      }
    }
    return series;
  }, [iterationHistory, metricOrder]);

  const activeMetrics = metricOrder.filter(k => (metricSeries[k]?.length ?? 0) > 0);

  // ── POST-TRAINING: saved convergence curves ───────────────────────────────
  if (hasCompleted && !hasLiveData) {
    if (!convergenceData || convergenceData.length === 0) {
      return (
        <EmptyState
          title="No convergence data"
          description="Convergence data was not saved for this model."
          icon={TrendingUp}
        />
      );
    }
    return (
      <div className="p-5 space-y-4">
        <div className="rounded-xl border border-white/5 bg-black/20 p-3 h-72">
          <span className="text-[10px] font-mono text-blue-400 font-medium">Convergence</span>
          <ResponsiveContainer width="100%" height="90%">
            <LineChart data={convergenceData} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis dataKey="iter" tick={{ fontSize: 8, fill: '#6e7681' }} tickLine={false} />
              <YAxis yAxisId="ll" tick={{ fontSize: 8, fill: '#6e7681' }} tickLine={false} width={50}
                tickFormatter={(v: number) => `${(v / 1e6).toFixed(1)}M`} />
              <YAxis yAxisId="k" orientation="right" tick={{ fontSize: 8, fill: '#6e7681' }} tickLine={false} width={25} />
              <Tooltip contentStyle={{ background: '#0d1117', border: '1px solid rgba(255,255,255,0.1)', fontSize: 10 }} />
              <Line yAxisId="ll" dataKey="log_likelihood" stroke="#3b82f6" dot={false} strokeWidth={1.5} isAnimationActive={false} name="Log-Lik" />
              <Line yAxisId="k" dataKey="n_active_states" stroke="#ef4444" dot={false} strokeWidth={1.5} isAnimationActive={false} name="Regimes" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    );
  }

  // ── LIVE TRAINING: streaming metric charts ────────────────────────────────
  if (hasLiveData) {
    return (
      <div className="p-5 space-y-4">
        {activeMetrics.map(key => {
          const desc = descriptions[key];
          if (!desc) return null;
          const data = metricSeries[key] ?? [];
          const cur = data.length > 0 ? data[data.length - 1]!.value : null;
          const displayData = desc.format === "percent" ? data.map(d => ({ ...d, v: d.value * 100 }))
            : desc.format === "millions" ? data.map(d => ({ ...d, v: d.value / 1e6 }))
            : data.map(d => ({ ...d, v: d.value }));
          return (
            <div key={key} className="rounded-xl border border-white/5 bg-black/20 overflow-hidden flex h-36">
              <div className="flex-1 min-w-0 flex flex-col">
                <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/5">
                  <span className="text-[10px] font-mono font-semibold" style={{ color: desc.color }}>{desc.title}</span>
                  <span className="text-xs font-mono font-bold" style={{ color: desc.color }}>
                    {cur != null ? formatMetricValue(cur, desc.format) : "--"}
                  </span>
                </div>
                <div className="flex-1 min-h-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={displayData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                      <defs>
                        <linearGradient id={`g-${key}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={desc.color} stopOpacity={0.15} />
                          <stop offset="95%" stopColor={desc.color} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                      <XAxis dataKey="iteration" tick={{ fontSize: 8, fill: '#6e7681' }} tickLine={false} />
                      <YAxis tick={{ fontSize: 8, fill: '#6e7681' }} tickLine={false} width={45} />
                      {desc.target != null && <ReferenceLine y={desc.target} stroke="#ef4444" strokeDasharray="4 4" strokeOpacity={0.5} />}
                      <Tooltip contentStyle={{ background: '#0d1117', border: '1px solid rgba(255,255,255,0.1)', fontSize: 10 }} />
                      <Area type="monotone" dataKey="v" stroke={desc.color} fill={`url(#g-${key})`} strokeWidth={1.5} dot={false} isAnimationActive={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div className="w-64 shrink-0 border-l border-white/5 p-2.5 flex flex-col justify-start overflow-y-auto gap-1.5">
                <p className="text-[10px] text-muted-foreground/60 leading-relaxed">{desc.description}</p>
                {desc.detects && <p className="text-[9px] leading-relaxed"><span className="text-cyan-400/50 font-mono">DETECTS:</span> <span className="text-muted-foreground/40">{desc.detects}</span></p>}
                {desc.usage && <p className="text-[9px] leading-relaxed"><span className="text-amber-400/50 font-mono">READ:</span> <span className="text-muted-foreground/40">{desc.usage}</span></p>}
                <p className="text-[9px] leading-relaxed"><span className="text-emerald-400/50 font-mono">HEALTHY:</span> <span className="text-muted-foreground/40">{desc.healthy}</span></p>
                {desc.crossMetrics && <p className="text-[9px] leading-relaxed"><span className="text-purple-400/50 font-mono">CROSS:</span> <span className="text-muted-foreground/40">{desc.crossMetrics}</span></p>}
              </div>
            </div>
          );
        })}
        {logs.length > 0 && (
          <div className="rounded-xl border border-white/5 bg-black/20 max-h-28 overflow-y-auto p-2">
            {logs.slice(-15).map((l, i) => <div key={i} className="text-[9px] font-mono text-muted-foreground/30 truncate">{l}</div>)}
          </div>
        )}
      </div>
    );
  }

  // ── PRE-TRAINING: metric reference cards ──────────────────────────────────
  return (
    <div className="p-5 space-y-3">
      <div className="flex items-center gap-3 mb-1">
        <h2 className="text-xs font-mono font-medium text-muted-foreground/60 uppercase tracking-wider">
          {modelName} — Metrics Reference
        </h2>
        <span className="text-[10px] font-mono text-muted-foreground/30">{symbol} {timeframe}</span>
      </div>
      {metricOrder.map(key => {
        const d = descriptions[key]; if (!d) return null;
        return (
          <div key={key} className="rounded-xl border border-white/5 bg-black/20 p-4 flex gap-4">
            <div className="w-1 rounded-full shrink-0" style={{ background: d.color }} />
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-mono font-semibold" style={{ color: d.color }}>{d.title}</span>
                <span className="text-[9px] font-mono text-muted-foreground/30 px-1.5 py-0.5 rounded bg-white/3 border border-white/5">{d.unit}</span>
              </div>
              <p className="text-[11px] text-muted-foreground/70 leading-relaxed mb-3">{d.description}</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
                <DescBox label="Detects" color="text-cyan-400/60" text={d.detects} />
                <DescBox label="Purpose" color="text-blue-400/60" text={d.purpose} />
                <DescBox label="How to Read" color="text-amber-400/60" text={d.usage} />
                <DescBox label="Healthy" color="text-emerald-400/60" text={d.healthy} />
                {d.crossMetrics && (
                  <div className="col-span-2">
                    <DescBox label="Cross-Metric Relationships" color="text-purple-400/60" text={d.crossMetrics} />
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
