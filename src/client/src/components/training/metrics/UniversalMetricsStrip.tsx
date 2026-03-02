/**
 * UniversalMetricsStrip — Always-visible metrics header for all model categories.
 *
 * Renders one row per toggled-on model, showing universal metrics side by side.
 * Think of it as: the dashboard gauges on a car — always visible regardless of mode.
 *
 * SRP: Renders universal metrics only. No category-specific content.
 */

import { Badge } from "@/components/ui/badge";
import { UNIVERSAL_METRICS, type MetricDefinition } from "@shared/categoryMetrics";
import type { MetricSnapshot, MetricValue } from "@/lib/metricExtractors";

interface UniversalMetricsStripProps {
  snapshots: MetricSnapshot[];
}

// ── Metric cell rendering ────────────────────────────────────────────────────

function formatValue(metric: MetricDefinition, mv: MetricValue | undefined): string {
  if (!mv || mv.value == null) return '--';
  const v = mv.value;
  if (typeof v === 'string') return v;
  switch (metric.unit) {
    case 'percent':
      return typeof v === 'number' && v <= 1 ? `${(v * 100).toFixed(0)}%` : `${Number(v).toFixed(0)}%`;
    case 'ratio':
      return Number(v).toFixed(3);
    case 'score':
      return Number(v).toFixed(0);
    case 'grade':
      return String(v);
    case 'seconds':
      return Number(v) >= 60 ? `${(Number(v) / 60).toFixed(1)}m` : `${Number(v).toFixed(0)}s`;
    case 'currency':
      return `$${Number(v).toFixed(2)}`;
    default:
      return Number(v).toFixed(2);
  }
}

function getValueColor(metric: MetricDefinition, mv: MetricValue | undefined): string {
  if (!mv || mv.value == null) return 'text-muted-foreground/40';
  if (mv.passed === true) return 'text-emerald-400';
  if (mv.passed === false) return 'text-rose-400';

  // Grade coloring
  if (metric.unit === 'grade') {
    const g = String(mv.value);
    if (g === 'A') return 'text-emerald-400';
    if (g === 'B') return 'text-emerald-400/80';
    if (g === 'C') return 'text-amber-400';
    if (g === 'D') return 'text-orange-400';
    return 'text-rose-400';
  }

  // Score coloring
  if (metric.id === 'quality_score' && typeof mv.value === 'number') {
    if (mv.value >= 80) return 'text-emerald-400';
    if (mv.value >= 60) return 'text-amber-400';
    if (mv.value >= 40) return 'text-orange-400';
    return 'text-rose-400';
  }

  // Threshold-based
  if (metric.threshold != null && typeof mv.value === 'number') {
    if (metric.direction === 'higher') return mv.value >= metric.threshold ? 'text-emerald-400' : 'text-amber-400';
    if (metric.direction === 'lower') return mv.value <= metric.threshold ? 'text-emerald-400' : 'text-amber-400';
  }

  return 'text-foreground';
}

// Row colors for multi-model comparison (up to 4)
const ROW_ACCENTS = [
  'border-l-primary',
  'border-l-cyan-400',
  'border-l-amber-400',
  'border-l-pink-400',
];

export default function UniversalMetricsStrip({ snapshots }: UniversalMetricsStripProps) {
  const metrics = UNIVERSAL_METRICS.metrics;

  if (snapshots.length === 0) {
    return (
      <div className="text-center text-muted-foreground/30 text-[10px] py-2">
        Toggle on a model to see metrics
      </div>
    );
  }

  return (
    <div className="w-full">
      {/* Column headers */}
      <div className="grid gap-1 mb-1" style={{ gridTemplateColumns: `120px repeat(${metrics.length}, 1fr)` }}>
        <div className="text-[8px] uppercase tracking-widest text-muted-foreground/30 px-1">Model</div>
        {metrics.map((m) => (
          <div key={m.id} className="text-[8px] uppercase tracking-widest text-muted-foreground/30 text-center px-0.5" title={m.description}>
            {m.label}
          </div>
        ))}
      </div>

      {/* One row per toggled model */}
      {snapshots.map((snap, idx) => {
        const accent = ROW_ACCENTS[idx % ROW_ACCENTS.length];
        return (
          <div
            key={snap.modelId}
            className={`grid gap-1 py-1.5 border-l-2 ${accent} pl-1 rounded-r-md mb-0.5 bg-white/1.5`}
            style={{ gridTemplateColumns: `120px repeat(${metrics.length}, 1fr)` }}
          >
            {/* Model label cell */}
            <div className="flex items-center gap-1.5 overflow-hidden">
              <span className="font-mono text-[10px] font-medium truncate">{snap.modelLabel}</span>
              <Badge variant="outline" className="text-[8px] px-1 py-0 border-0 text-muted-foreground/40 shrink-0">
                {snap.category}
              </Badge>
            </div>

            {/* Metric value cells */}
            {metrics.map((m) => {
              const mv = snap.universal.find(u => u.id === m.id);
              const formatted = formatValue(m, mv);
              const color = getValueColor(m, mv);
              return (
                <div key={m.id} className="flex items-center justify-center" title={m.description}>
                  <span className={`font-mono text-[11px] font-bold ${color}`}>
                    {formatted}
                  </span>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
