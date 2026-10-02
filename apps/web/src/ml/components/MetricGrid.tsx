/**
 * MetricGrid — Renders self-describing diagnostics as a responsive grid of metric cards.
 *
 * Receives a SelfDescribingDiagnostics object, groups metrics by their `group` field,
 * sorts by `order`, resolves renderers from the registry, and renders each in a
 * responsive grid layout. Different models produce different metric sets — the grid
 * adapts to whatever the model declares.
 *
 * Usage:
 *   <MetricGrid diagnostics={modelDiagnostics} />
 *   <MetricGrid diagnostics={modelDiagnostics} compact />
 *   <MetricGrid diagnostics={modelDiagnostics} filter={['performance', 'quality']} />
 */

import { useMemo } from 'react';
import type {
  SelfDescribingDiagnostics,
  MetricDeclaration,
  MetricSeriesEntry,
  RendererProps,
} from "@/ml/lib/diagnostics-schema";
import { resolveRenderer, OVERLAY_CAPABLE } from './index';
import { RendererShell } from './RendererShell';
import { paletteColor } from "@/ml/stages/evaluate/palette";
import { cn } from "@/shared/utils/utils";

// ─── Types ───────────────────────────────────────────────────────────────────

/** One additional run to overlay alongside the primary `diagnostics`. */
export interface ComparisonRun {
  runId: string;
  label: string;
  diagnostics: SelfDescribingDiagnostics;
}

interface MetricGridProps {
  /** Self-describing diagnostics from a trained model */
  diagnostics: SelfDescribingDiagnostics;
  /**
   * Additional runs to compare against `diagnostics`.
   *
   * The primary run is ALWAYS `series[0]` — `diagnostics` is prepended here, it
   * is never expected in this array. Renderers in `OVERLAY_CAPABLE` receive the
   * whole series and draw it on shared axes; every other renderer is fanned out
   * into small multiples (see `renderMetricCell`), which is what lets the other
   * 11 renderers stay completely untouched by the overlay feature.
   */
  comparisonRuns?: ComparisonRun[];
  /** Compact mode for dense layouts */
  compact?: boolean;
  /** Filter to only show metrics from these groups. Null/undefined shows all. */
  filter?: string[];
  /** Override grid columns (default: auto based on metric count) */
  columns?: 1 | 2 | 3 | 4;
  /** Additional CSS classes on the outer container */
  className?: string;
  /** Hide group headers */
  hideGroupHeaders?: boolean;
}

interface GroupedMetric {
  key: string;
  metric: MetricDeclaration;
}

interface MetricGroup {
  name: string;
  metrics: GroupedMetric[];
}

// ─── Section Colors ───────────────────────────────────────────────────────────

export interface SectionColor {
  text: string;
  bg: string;
  border: string;
  line: string;
}

export const SECTION_COLORS: Record<string, SectionColor> = {
  deep_learning: {
    text: 'text-purple-400',
    bg: 'bg-purple-500/20',
    border: 'border-purple-500/10',
    line: 'bg-purple-500/30',
  },
  machine_learning: {
    text: 'text-cyan-400',
    bg: 'bg-cyan-500/20',
    border: 'border-cyan-500/10',
    line: 'bg-cyan-500/30',
  },
  trading: {
    text: 'text-amber-400',
    bg: 'bg-amber-500/20',
    border: 'border-amber-500/10',
    line: 'bg-amber-500/30',
  },
  regimes: {
    text: 'text-orange-400',
    bg: 'bg-orange-500/20',
    border: 'border-orange-500/10',
    line: 'bg-orange-500/30',
  },
  quality: {
    text: 'text-teal-400',
    bg: 'bg-teal-500/20',
    border: 'border-teal-500/10',
    line: 'bg-teal-500/30',
  },
  performance: {
    text: 'text-[hsl(var(--data-pos))]',
    bg: 'bg-[hsl(var(--data-pos)/0.2)]',
    border: 'border-[hsl(var(--data-pos)/0.1)]',
    line: 'bg-[hsl(var(--data-pos)/0.3)]',
  },
  features: {
    text: 'text-indigo-400',
    bg: 'bg-indigo-500/20',
    border: 'border-indigo-500/10',
    line: 'bg-indigo-500/30',
  },
  data: {
    text: 'text-sky-400',
    bg: 'bg-sky-500/20',
    border: 'border-sky-500/10',
    line: 'bg-sky-500/30',
  },
  general: {
    text: 'text-zinc-400',
    bg: 'bg-zinc-500/20',
    border: 'border-zinc-500/10',
    line: 'bg-zinc-700',
  },
};

const FALLBACK_COLOR: SectionColor = {
  text: 'text-zinc-400',
  bg: 'bg-zinc-500/20',
  border: 'border-zinc-500/10',
  line: 'bg-zinc-700',
};

export function getSectionColor(group: string): SectionColor {
  return SECTION_COLORS[group] ?? FALLBACK_COLOR;
}

// ─── Group Order ─────────────────────────────────────────────────────────────

/** Canonical group ordering. Shared by MetricGrid, GroupTabs, and Training page. */
export const METRIC_GROUP_ORDER: Record<string, number> = {
  deep_learning: 0,
  machine_learning: 1,
  trading: 2,
  regimes: 3,
  quality: 4,
  performance: 5,
  data: 6,
  features: 7,
  training: 8,
  general: 99,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function groupAndSort(
  metrics: Record<string, MetricDeclaration>,
  filter?: string[],
): MetricGroup[] {
  // Collect all metrics into groups
  const groupMap = new Map<string, GroupedMetric[]>();

  for (const [key, metric] of Object.entries(metrics)) {
    const groupName = metric.group ?? 'general';

    // Apply filter if provided
    if (filter && filter.length > 0 && !filter.includes(groupName)) {
      continue;
    }

    if (!groupMap.has(groupName)) {
      groupMap.set(groupName, []);
    }
    groupMap.get(groupName)!.push({ key, metric });
  }

  // Sort metrics within each group by order field
  for (const metrics of groupMap.values()) {
    metrics.sort((a, b) => (a.metric.order ?? 0) - (b.metric.order ?? 0));
  }

  // Sort groups: put well-known groups first, then alphabetical
  const GROUP_ORDER = METRIC_GROUP_ORDER;

  const groups = Array.from(groupMap.entries())
    .map(([name, metrics]) => ({ name, metrics }))
    .sort((a, b) => {
      const orderA = GROUP_ORDER[a.name] ?? 50;
      const orderB = GROUP_ORDER[b.name] ?? 50;
      if (orderA !== orderB) return orderA - orderB;
      return a.name.localeCompare(b.name);
    });

  return groups;
}

/**
 * 12-column CSS grid — same system as Neptune, Grafana, Bloomberg.
 * Each renderer type gets a span assignment based on its content needs.
 */
const GRID_CLASS = 'grid grid-cols-12 gap-3';

/** Column span per renderer type (out of 12) */
const RENDERER_SPAN: Record<string, number> = {
  // Wide — charts and matrices need room
  time_series: 6,
  confusion_matrix: 6,
  precision_bars: 6,
  heatmap: 6,
  fold_bars: 6,
  table: 12,
  chart_overlay: 12,
  // Medium — gauges and distributions
  gauge: 3,
  ring: 3,
  distribution: 4,
  bars: 4,
  // Compact — scalar values
  number: 3,
  percent: 3,
  text: 3,
  // 3D — loss surface
  surface_3d: 6,
};

/** Map span number → full Tailwind class (must be literal for tree-shaking) */
const SPAN_CLASS: Record<number, string> = {
  3: 'col-span-3',
  4: 'col-span-4',
  6: 'col-span-6',
  12: 'col-span-12',
};

function getSpanClass(renderer: string): string {
  const span = RENDERER_SPAN[renderer] ?? 3;
  return SPAN_CLASS[span] ?? 'col-span-3';
}

// ─── Group Header ────────────────────────────────────────────────────────────

function GroupHeader({ name, compact }: { name: string; compact?: boolean }) {
  const label = name.replace(/_/g, ' ').toUpperCase();
  const colors = getSectionColor(name);
  return (
    <div className={cn('flex items-center gap-3', compact ? 'mb-2' : 'mb-4 mt-2')}>
      <h3 className={cn(
        'font-display font-medium uppercase tracking-widest shrink-0',
        colors.text,
        compact ? 'text-[10px]' : 'text-xs',
      )}>
        {label}
      </h3>
      <div className={cn('flex-1 h-px', colors.line)} />
    </div>
  );
}

// ─── MetricGrid ──────────────────────────────────────────────────────────────

/**
 * Assemble the per-metric run series, or `undefined` when there is nothing to
 * compare.
 *
 * Returns `undefined` — not a 1-element array — for the single-run case. That
 * is what preserves the "renderers cannot tell the overlay feature exists"
 * invariant: `RendererProps.series` is absent entirely, so every existing
 * renderer takes exactly the code path it took before.
 *
 * Colors come from the shared Wong-2011 palette already used by
 * `WalkForwardFoldOverlay`, so a given run keeps one color across every surface.
 * Deuteranopia-safe, and always paired with a text label.
 *
 * A comparison run that simply lacks this metric is skipped rather than
 * rendered as a hole — models legitimately declare different metric sets.
 */
function buildSeries(
  key: string,
  primary: MetricDeclaration,
  primaryDiagnostics: SelfDescribingDiagnostics,
  comparisonRuns: ComparisonRun[] | undefined,
): MetricSeriesEntry[] | undefined {
  if (!comparisonRuns || comparisonRuns.length === 0) return undefined;

  const entries: MetricSeriesEntry[] = [
    {
      runId: primaryDiagnostics.model_type,
      label: primaryDiagnostics.model_label ?? primaryDiagnostics.model_type,
      color: paletteColor(0),
      metric: primary, // invariant: series[0].metric === metric
    },
  ];

  comparisonRuns.forEach((run, i) => {
    const m = run.diagnostics.metrics?.[key];
    if (!m) return;
    entries.push({
      runId: run.runId,
      label: run.label,
      color: paletteColor(i + 1),
      metric: m,
    });
  });

  return entries.length > 1 ? entries : undefined;
}

export function MetricGrid({
  diagnostics,
  comparisonRuns,
  compact,
  filter,
  columns: _columns,
  className,
  hideGroupHeaders,
}: MetricGridProps) {
  const groups = useMemo(
    () => groupAndSort(diagnostics.metrics, filter),
    [diagnostics.metrics, filter],
  );

  if (groups.length === 0) {
    return (
      <div className="text-zinc-500 text-sm text-center py-8">
        No metrics available for this model.
      </div>
    );
  }

  return (
    <div className={cn('space-y-4', className)}>
      {/* Model header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-zinc-500 bg-zinc-800/50 px-2 py-0.5 rounded">
            {diagnostics.model_type}
          </span>
          <span className="text-xs text-zinc-400">
            {diagnostics.symbol} · {diagnostics.timeframe}
          </span>
          {diagnostics.model_label && (
            <span className="text-xs text-zinc-500">{diagnostics.model_label}</span>
          )}
        </div>
        {diagnostics.training && (
          <span className="text-[10px] text-zinc-600 font-mono">
            {new Date(diagnostics.training.trained_at).toLocaleDateString()}
          </span>
        )}
      </div>

      {/* Metric groups */}
      {groups.map((group) => {
        const groupColor = getSectionColor(group.name);

        return (
          <div key={group.name}>
            {!hideGroupHeaders && group.name !== 'general' && (
              <GroupHeader name={group.name} compact={compact} />
            )}
            <div className={GRID_CLASS}>
              {group.metrics.map(({ key, metric }) => {
                const spanClass = getSpanClass(metric.renderer);
                const isAwaiting = metric.value === null || metric.value === undefined;

                if (isAwaiting) {
                  return (
                    <div key={key} className={spanClass}>
                      <RendererShell
                        metricKey={key}
                        mission={metric.mission}
                        compact={compact}
                        awaitingData
                        context={metric.context}
                        groupColor={groupColor.border}
                      >
                        {null}
                      </RendererShell>
                    </div>
                  );
                }

                const Component = resolveRenderer(metric.renderer);
                const series = buildSeries(key, metric, diagnostics, comparisonRuns);

                // Single run — unchanged path. `series` stays undefined so no
                // renderer can tell the overlay feature exists.
                if (!series) {
                  return (
                    <div key={key} className={spanClass}>
                      <Component {...{ metricKey: key, metric, compact } satisfies RendererProps} />
                    </div>
                  );
                }

                // Multi-run, renderer understands overlay — one chart, N series.
                if (OVERLAY_CAPABLE.has(metric.renderer)) {
                  return (
                    <div key={key} className={spanClass}>
                      <Component {...{ metricKey: key, metric, series, compact } satisfies RendererProps} />
                    </div>
                  );
                }

                // Multi-run, renderer cannot overlay (confusion_matrix, heatmap,
                // surface_3d, table, …) — fan out into small multiples. Each cell
                // is the EXISTING single-metric component in compact mode, so
                // this needs zero changes in any non-overlay renderer, and any
                // renderer added later gets small multiples for free.
                return (
                  <div key={key} className="col-span-12">
                    <div className="mb-1 text-[10px] uppercase tracking-widest text-zinc-500">
                      {key.replace(/_/g, ' ')} — {series.length} runs
                    </div>
                    <div
                      className={cn(
                        'grid gap-2',
                        series.length >= 3
                          ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
                          : 'grid-cols-1 sm:grid-cols-2',
                      )}
                    >
                      {series.map((entry) => (
                        <div key={entry.runId} className="min-w-0">
                          <div className="mb-1 flex items-center gap-1.5">
                            {/* Color chip + text label — never color alone. */}
                            <span
                              aria-hidden
                              className="h-2 w-2 shrink-0 rounded-sm"
                              style={{ backgroundColor: entry.color }}
                            />
                            <span className="truncate text-[10px] text-zinc-400">{entry.label}</span>
                          </div>
                          <Component
                            {...{
                              metricKey: key,
                              metric: entry.metric,
                              compact: true,
                            } satisfies RendererProps}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default MetricGrid;
