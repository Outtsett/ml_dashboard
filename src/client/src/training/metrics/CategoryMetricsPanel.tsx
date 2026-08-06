/**
 * CategoryMetricsPanel — Renders category-specific metric groups with per-model columns.
 *
 * Think of it as: a scorecard where each row is a test, each column is a model,
 * and cells show the score + pass/fail badge.
 *
 * SRP: Renders one category's metrics. No selection logic, no fetching.
 * OCP: Adding metrics to categoryMetrics.ts automatically renders them here.
 */

import { Badge } from "@/shared/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/shared/ui/tooltip";
import { Check, X, Minus, ArrowUp, ArrowDown, Info } from "lucide-react";
import type { CategoryMetricsConfig, MetricDefinition } from "@shared/categoryMetrics";
import type { MetricSnapshot, MetricValue } from "@/ml/lib/metric_extractors";

interface CategoryMetricsPanelProps {
  config: CategoryMetricsConfig;
  snapshots: MetricSnapshot[];
}

// Row accent colors matching UniversalMetricsStrip
const COL_COLORS = [
  'text-primary',
  'text-cyan-400',
  'text-amber-400',
  'text-pink-400',
];

// ── Value formatting ─────────────────────────────────────────────────────────

function fmt(metric: MetricDefinition, mv: MetricValue | undefined): string {
  if (!mv || mv.value == null) return '--';
  const v = mv.value;
  if (typeof v === 'string') return v;
  switch (metric.unit) {
    case 'percent':
      return typeof v === 'number' && v <= 1 ? `${(v * 100).toFixed(1)}%` : `${Number(v).toFixed(1)}%`;
    case 'ratio':
      return Number(v).toFixed(4);
    case 'score':
      return Number(v).toFixed(1);
    case 'grade':
      return String(v);
    case 'seconds':
      return Number(v) >= 60 ? `${(Number(v) / 60).toFixed(1)}m` : `${Number(v).toFixed(1)}s`;
    case 'currency':
      return `$${Number(v).toFixed(2)}`;
    default:
      return Number(v).toFixed(3);
  }
}

function PassBadge({ mv }: { mv: MetricValue | undefined }) {
  if (!mv || mv.passed == null) {
    return <Minus className="h-3 w-3 text-muted-foreground/30" />;
  }
  return mv.passed
    ? <Check className="h-3 w-3 text-emerald-400" />
    : <X className="h-3 w-3 text-rose-400" />;
}

function DirectionIcon({ dir }: { dir: MetricDefinition['direction'] }) {
  if (dir === 'higher') return <ArrowUp className="h-2.5 w-2.5 text-emerald-400/50 shrink-0" />;
  if (dir === 'lower') return <ArrowDown className="h-2.5 w-2.5 text-amber-400/50 shrink-0" />;
  return <Info className="h-2.5 w-2.5 text-muted-foreground/30 shrink-0" />;
}

function getValueColor(metric: MetricDefinition, mv: MetricValue | undefined): string {
  if (!mv || mv.value == null) return 'text-muted-foreground/30';
  if (mv.passed === true) return 'text-emerald-400';
  if (mv.passed === false) return 'text-rose-400';
  if (metric.threshold != null && typeof mv.value === 'number') {
    if (metric.direction === 'higher') return mv.value >= metric.threshold ? 'text-emerald-400' : 'text-muted-foreground';
    if (metric.direction === 'lower') return mv.value <= metric.threshold ? 'text-emerald-400' : 'text-muted-foreground';
  }
  return 'text-foreground';
}

export default function CategoryMetricsPanel({ config, snapshots }: CategoryMetricsPanelProps) {
  if (snapshots.length === 0) {
    return (
      <div className="text-center text-muted-foreground/30 text-xs py-8">
        Toggle on models above to compare {config.label.toLowerCase()} metrics
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-4">
        {config.groups.map((group) => (
          <Card key={group.id} className="border-white/5 bg-card/50">
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-sm font-semibold">{group.label}</CardTitle>
              <CardDescription className="text-[10px]">{group.description}</CardDescription>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {/* Table header: metric name + one column per model */}
              <div
                className="grid gap-x-3 gap-y-0 mb-2"
                style={{ gridTemplateColumns: `minmax(140px, 1fr) repeat(${snapshots.length}, minmax(80px, 1fr))` }}
              >
                <div className="text-[8px] uppercase tracking-widest text-muted-foreground/30">Metric</div>
                {snapshots.map((snap, idx) => (
                  <div key={snap.modelId} className={`text-[8px] uppercase tracking-widest text-center ${COL_COLORS[idx % COL_COLORS.length]}`}>
                    {snap.modelLabel}
                  </div>
                ))}
              </div>

              {/* Metric rows */}
              {group.metrics.map((metric) => (
                <div
                  key={metric.id}
                  className="grid gap-x-3 gap-y-0 py-1.5 border-t border-white/3 items-center hover:bg-white/2 rounded-sm transition-colors"
                  style={{ gridTemplateColumns: `minmax(140px, 1fr) repeat(${snapshots.length}, minmax(80px, 1fr))` }}
                >
                  {/* Metric label with tooltip */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex items-center gap-1.5 cursor-help">
                        <DirectionIcon dir={metric.direction} />
                        <span className="text-[11px] text-muted-foreground truncate">{metric.label}</span>
                        {metric.threshold != null && (
                          <span className="text-[8px] text-muted-foreground/30 font-mono shrink-0">
                            ({metric.direction === 'higher' ? '≥' : '≤'}{metric.threshold})
                          </span>
                        )}
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="right" className="max-w-xs text-xs">
                      {metric.description}
                    </TooltipContent>
                  </Tooltip>

                  {/* Model value cells */}
                  {snapshots.map((snap) => {
                    const mv = snap.categoryMetrics.find((m) => m.id === metric.id);
                    const color = getValueColor(metric, mv);
                    return (
                      <div key={snap.modelId} className="flex items-center justify-center gap-1.5">
                        <PassBadge mv={mv} />
                        <span className={`font-mono text-[11px] font-medium ${color}`}>
                          {fmt(metric, mv)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ))}

              {/* Group summary bar */}
              <div
                className="grid gap-x-3 mt-2 pt-2 border-t border-white/5"
                style={{ gridTemplateColumns: `minmax(140px, 1fr) repeat(${snapshots.length}, minmax(80px, 1fr))` }}
              >
                <div className="text-[9px] text-muted-foreground/40 italic">Pass Rate</div>
                {snapshots.map((snap) => {
                  const total = group.metrics.length;
                  const passed = group.metrics.filter((m) => {
                    const mv = snap.categoryMetrics.find((cm) => cm.id === m.id);
                    return mv?.passed === true;
                  }).length;
                  const tested = group.metrics.filter((m) => {
                    const mv = snap.categoryMetrics.find((cm) => cm.id === m.id);
                    return mv?.passed != null;
                  }).length;
                  const pct = tested > 0 ? Math.round((passed / tested) * 100) : 0;
                  const color = pct >= 80 ? 'text-emerald-400' : pct >= 50 ? 'text-amber-400' : 'text-rose-400';
                  return (
                    <div key={snap.modelId} className="flex items-center justify-center gap-1">
                      <Badge variant="outline" className={`text-[9px] px-1.5 py-0 ${color} border-current/20`}>
                        {passed}/{tested}
                      </Badge>
                      <span className={`text-[9px] font-mono ${color}`}>{pct}%</span>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </TooltipProvider>
  );
}
