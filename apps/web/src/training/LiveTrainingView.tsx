/**
 * LiveTrainingView — Split layout for active training sessions.
 *
 * Left panel: streaming metrics from the model's declared training group.
 * Right panel: terminal log (xterm).
 * Below: 3D loss trajectory (if declared) + awaiting group pills.
 *
 * Fully model-agnostic: reads metric_declarations to know what to render.
 * Different model types produce different live views automatically.
 */

import { lazy, Suspense, useMemo } from 'react';
import { useTrainingMetrics, useTrainingOverlays } from "@/training/lib/TrainingContext";
import { cn } from "@/shared/utils/utils";
import { getSectionColor } from '@/ml/components/MetricGrid';
import { DiagnosticsPanel } from './live/DiagnosticsPanel';

const TrainingLogTab = lazy(() =>
  import('@/system/components/TrainingLogTab').then(m => ({ default: m.TrainingLogTab }))
);

// ── Types ───────────────────────────────────────────────────────────────────

interface LiveTrainingViewProps {
  className?: string;
}

interface MetricDecl {
  renderer?: string;
  mission?: string;
  group?: string;
  context?: Record<string, unknown>;
  [key: string]: unknown;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Groups that should show during live training (streaming metrics). */
const LIVE_GROUPS = new Set(['deep_learning', 'training', 'machine_learning']);

function isLiveGroup(group: string): boolean {
  return LIVE_GROUPS.has(group);
}

function formatMetricValue(value: number, context?: Record<string, unknown>): string {
  const decimals = typeof context?.decimals === 'number' ? context.decimals : 4;
  if (Math.abs(value) >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (Math.abs(value) >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return value.toFixed(decimals);
}

function getSeverityColor(value: number, context?: Record<string, unknown>): string {
  if (!context) return 'text-zinc-200';
  const hib = context.higher_is_better !== false;
  const great = typeof context.great === 'number' ? context.great : null;
  const good = typeof context.good === 'number' ? context.good : null;
  const bad = typeof context.bad === 'number' ? context.bad : null;

  if (great != null && (hib ? value >= great : value <= great)) return 'text-[hsl(var(--data-pos))]';
  if (good != null && (hib ? value >= good : value <= good)) return 'text-cyan-400';
  if (bad != null && (hib ? value <= bad : value >= bad)) return 'text-[hsl(var(--data-neg))]';
  return 'text-zinc-200';
}

// ── Sparkline ───────────────────────────────────────────────────────────────

function MiniSparkline({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const w = 100;
  const h = 24;

  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = h - ((v - min) / range) * (h - 2) - 1;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ height: `${h}px` }} preserveAspectRatio="none">
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
  );
}

// ── Metric Card ─────────────────────────────────────────────────────────────

function LiveMetricCard({
  name,
  value,
  history,
  decl,
}: {
  name: string;
  value: number | undefined;
  history: number[];
  decl?: MetricDecl;
}) {
  const renderer = decl?.renderer ?? 'number';
  const context = decl?.context as Record<string, unknown> | undefined;
  const displayValue = value != null ? formatMetricValue(value, context) : '---';
  const valueColor = value != null ? getSeverityColor(value, context) : 'text-zinc-600';

  // Choose sparkline color based on group
  const group = decl?.group ?? 'general';
  const sectionColor = getSectionColor(group);
  const sparkColor = sectionColor.line.includes('purple') ? '#a78bfa'
    : sectionColor.line.includes('cyan') ? '#22d3ee'
    : sectionColor.line.includes('amber') ? '#f59e0b'
    : sectionColor.line.includes('emerald') ? '#E69F00'
    : '#71717a';

  const isTimeSeries = renderer === 'time_series';
  const isGauge = renderer === 'gauge';

  // Show baseline if available
  const baseline = typeof context?.baseline === 'number' ? context.baseline : null;

  return (
    <div className="bg-zinc-900/80 border border-zinc-800/60 rounded-md p-2.5 transition-all">
      <div className="text-[9px] font-mono text-zinc-500 uppercase tracking-wider truncate">
        {name.replace(/_/g, ' ')}
      </div>
      <div className={cn('text-lg font-semibold font-mono mt-0.5', valueColor)}>
        {displayValue}
        {isGauge && typeof context?.max === 'number' && (
          <span className="text-zinc-600 text-xs ml-1">
            / {context.max === 1 ? '100%' : context.max}
          </span>
        )}
      </div>
      {baseline != null && value != null && (
        <div className="text-[9px] text-zinc-600 font-mono">
          baseline: {baseline}
        </div>
      )}
      {isTimeSeries && history.length > 1 && (
        <div className="mt-1.5 rounded-sm overflow-hidden bg-black/20">
          <MiniSparkline values={history} color={sparkColor} />
        </div>
      )}
    </div>
  );
}

// ── Awaiting Group Pills ────────────────────────────────────────────────────

function AwaitingGroupPills({ groups }: { groups: string[] }) {
  if (groups.length === 0) return null;

  return (
    <div className="flex gap-2 flex-wrap px-1">
      {groups.map(group => (
        <span
          key={group}
          className="px-2.5 py-1 rounded bg-zinc-800/60 text-zinc-600 text-[10px] font-mono"
        >
          {group.replace(/_/g, ' ')} (after training)
        </span>
      ))}
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────

export function LiveTrainingView({ className }: LiveTrainingViewProps) {
  const { metrics, iterationHistory } = useTrainingMetrics();
  const { metricDeclarations, elapsedSec } = useTrainingOverlays();

  // Parse declarations into live vs awaiting groups
  const { liveMetrics, structuredMetrics, awaitingGroups } = useMemo(() => {
    const decls = metricDeclarations as Record<string, MetricDecl> | null;
    if (!decls) {
      // No declarations yet — show raw metrics
      return {
        liveMetrics: Object.keys(metrics).map(name => ({
          name,
          decl: undefined as MetricDecl | undefined,
        })),
        structuredMetrics: [] as { name: string; decl: MetricDecl }[],
        awaitingGroups: [] as string[],
      };
    }

    const live: { name: string; decl: MetricDecl }[] = [];
    const structured: { name: string; decl: MetricDecl }[] = [];
    const awaitingSet = new Set<string>();

    /** Renderers that produce complex (non-numeric) values — skip from card grid. */
    const STRUCTURED_RENDERERS = new Set(['surface_3d', 'chart_overlay']);

    for (const [name, decl] of Object.entries(decls)) {
      const group = decl.group ?? 'general';
      if (isLiveGroup(group)) {
        if (STRUCTURED_RENDERERS.has(decl.renderer ?? '')) {
          structured.push({ name, decl });
        } else {
          live.push({ name, decl });
        }
      } else {
        awaitingSet.add(group);
      }
    }

    // Sort live metrics by order
    live.sort((a, b) => {
      const orderA = typeof a.decl.order === 'number' ? a.decl.order : 50;
      const orderB = typeof b.decl.order === 'number' ? b.decl.order : 50;
      return orderA - orderB;
    });

    return {
      liveMetrics: live,
      structuredMetrics: structured,
      awaitingGroups: Array.from(awaitingSet).sort(),
    };
  }, [metricDeclarations, metrics]);

  // Build history per metric from iterationHistory
  const metricHistories = useMemo(() => {
    const histories: Record<string, number[]> = {};
    for (const entry of iterationHistory) {
      for (const [key, val] of Object.entries(entry.metrics)) {
        if (!histories[key]) histories[key] = [];
        histories[key].push(val);
      }
    }
    return histories;
  }, [iterationHistory]);

  return (
    <div className={cn('space-y-4', className)}>
      {/* Split view: metrics left, log right */}
      <div className="grid grid-cols-2 gap-0 min-h-[320px] rounded-lg overflow-hidden border border-white/5">
        {/* LEFT: Streaming metrics */}
        <div className="p-4 border-r border-white/5 overflow-y-auto max-h-[400px]">
          {/* Section header */}
          <div className="flex items-center gap-2 mb-3">
            <span className="text-purple-400 text-[10px] font-semibold tracking-widest uppercase">
              Training Process
            </span>
            <div className="flex-1 h-px bg-purple-500/20" />
            <span className="text-zinc-600 text-[10px] font-mono">
              {elapsedSec > 0 ? `${Math.floor(elapsedSec)}s` : 'live'}
            </span>
          </div>

          {/* Metric cards grid */}
          <div className="grid grid-cols-2 gap-2">
            {liveMetrics.map(({ name, decl }) => (
              <LiveMetricCard
                key={name}
                name={name}
                value={metrics[name]}
                history={metricHistories[name] ?? []}
                decl={decl}
              />
            ))}
          </div>

          {liveMetrics.length === 0 && (
            <div className="flex items-center justify-center h-32 text-zinc-600 text-xs font-mono">
              Waiting for metric declarations...
            </div>
          )}
        </div>

        {/* RIGHT: Diagnostics & Terminal log */}
        <div className="bg-black/40 flex flex-col min-h-0">
          <DiagnosticsPanel metrics={metrics} />
          <div className="flex-1 min-h-0 border-t border-white/5 relative">
            <Suspense fallback={<div className="h-full w-full absolute inset-0 bg-black/40 animate-pulse" />}>
              <div className="absolute inset-0">
                <TrainingLogTab visible />
              </div>
            </Suspense>
          </div>
        </div>
      </div>

      {/* Structured metrics note (surface_3d etc. — rendered post-training, not as live cards) */}
      {structuredMetrics.length > 0 && (
        <div className="flex gap-2 flex-wrap px-1">
          {structuredMetrics.map(({ name, decl: _decl }) => (
            <span
              key={name}
              className="px-2.5 py-1 rounded bg-purple-500/10 border border-purple-500/20 text-purple-400 text-[10px] font-mono"
            >
              {name.replace(/_/g, ' ')} (recording)
            </span>
          ))}
        </div>
      )}

      {/* Awaiting groups */}
      {awaitingGroups.length > 0 && (
        <AwaitingGroupPills groups={awaitingGroups} />
      )}
    </div>
  );
}

export default LiveTrainingView;
