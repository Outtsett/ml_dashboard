/**
 * BarsRenderer — Vertical bar chart using visx.
 *
 * Value is number[] or Record<string, number>.
 * Each bar labeled, colored by severity vs threshold.
 * Axis labels from context.labels.
 */

import { useMemo } from 'react';
import { Bar } from '@visx/shape';
import { Group } from '@visx/group';
import { scaleLinear, scaleBand } from '@visx/scale';
import { Text } from '@visx/text';
import type { MetricSeriesEntry, RendererProps } from "@/ml/lib/diagnostics-schema";
import { getMetricSeverity } from "@/ml/lib/diagnostics-schema";
import { RendererShell, useShellProps } from './RendererShell';

const SEVERITY_HEX = {
  great: '#E69F00',
  good: '#22d3ee',
  neutral: '#71717a',
  bad: '#0072B2',
} as const;

interface BarDatum {
  label: string;
  value: number;
}

function parseBarData(value: RendererProps['metric']['value'], labels?: string[]): BarDatum[] {
  if (Array.isArray(value) && typeof value[0] === 'number') {
    return (value as number[]).map((v, i) => ({
      label: labels?.[i] ?? `${i}`,
      value: v,
    }));
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const entries = Object.entries(value as Record<string, number>);
    return entries.map(([k, v]) => ({ label: k, value: v }));
  }
  return [];
}

/** One run's bar within a grouped category (overlay mode). */
interface GroupedBar {
  runId: string;
  label: string;
  color: string;
  value: number;
}
interface CategoryGroup {
  category: string;
  bars: GroupedBar[];
}

/**
 * Union the category labels across every run's bars, so a category present
 * in only some runs still gets a slot (missing runs simply contribute no bar
 * there rather than collapsing the category away).
 */
function buildGroupedCategories(series: MetricSeriesEntry[], labels?: string[]): CategoryGroup[] {
  const perRun = series.map((entry) => ({
    entry,
    data: parseBarData(entry.metric.value, labels),
  }));

  const categories: string[] = [];
  const seen = new Set<string>();
  for (const { data } of perRun) {
    for (const d of data) {
      if (!seen.has(d.label)) {
        seen.add(d.label);
        categories.push(d.label);
      }
    }
  }

  return categories.map((category) => ({
    category,
    bars: perRun
      .map(({ entry, data }) => {
        const found = data.find((d) => d.label === category);
        return found ? { runId: entry.runId, label: entry.label, color: entry.color, value: found.value } : null;
      })
      .filter((b): b is GroupedBar => b != null),
  }));
}

export function BarsRenderer(props: RendererProps) {
  const { metricKey, mission, compact, context } = useShellProps(props);
  const isOverlay = (props.series?.length ?? 0) > 1;

  const data = useMemo(
    () => parseBarData(props.metric.value, context.labels),
    [props.metric.value, context.labels],
  );

  const groups = useMemo(
    () => (isOverlay ? buildGroupedCategories(props.series!, context.labels) : []),
    [isOverlay, props.series, context.labels],
  );

  // Overall severity from average or just neutral
  const avgValue = data.length > 0 ? data.reduce((s, d) => s + d.value, 0) / data.length : 0;
  const overallSeverity = getMetricSeverity(avgValue, context);

  const width = compact ? 200 : 320;
  const height = compact ? 100 : 160;
  const margin = { top: 16, right: 8, bottom: 28, left: 8 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;

  const categoryDomain = isOverlay ? groups.map((g) => g.category) : data.map((d) => d.label);

  const xScale = useMemo(
    () =>
      scaleBand<string>({
        domain: categoryDomain,
        range: [0, innerW],
        padding: 0.3,
      }),
    [categoryDomain, innerW],
  );

  const runsForScale = isOverlay ? (props.series ?? []) : [];
  const groupScale = useMemo(
    () =>
      scaleBand<string>({
        domain: runsForScale.map((s) => s.runId),
        range: [0, xScale.bandwidth()],
        padding: 0.15,
      }),
    [runsForScale, xScale],
  );

  const maxVal = isOverlay
    ? Math.max(...groups.flatMap((g) => g.bars.map((b) => b.value)), context.max ?? 0, 0.01)
    : Math.max(...data.map(d => d.value), context.max ?? 0, 0.01);

  const yScale = useMemo(
    () =>
      scaleLinear<number>({
        domain: [0, maxVal],
        range: [innerH, 0],
      }),
    [maxVal, innerH],
  );

  const noData = isOverlay ? groups.length === 0 : data.length === 0;

  if (noData) {
    return (
      <RendererShell metricKey={metricKey} mission={mission} compact={compact} severity="neutral">
        <div className="flex items-center justify-center h-20 text-zinc-600 text-xs font-mono">
          No data
        </div>
      </RendererShell>
    );
  }

  return (
    <RendererShell metricKey={metricKey} mission={mission} compact={compact} severity={isOverlay ? 'neutral' : overallSeverity}>
      <div className="flex flex-col items-center gap-1">
        <div className="flex justify-center">
          <svg width={width} height={height} className="overflow-visible">
            <Group top={margin.top} left={margin.left}>
              {/* Grid lines */}
              {yScale.ticks(4).map(tick => (
                <line
                  key={tick}
                  x1={0}
                  x2={innerW}
                  y1={yScale(tick)}
                  y2={yScale(tick)}
                  stroke="#3f3f46"
                  strokeDasharray="2 3"
                  opacity={0.4}
                />
              ))}

              {isOverlay
                ? groups.map((group) => {
                    const groupX = xScale(group.category) ?? 0;
                    return (
                      <g key={group.category}>
                        {group.bars.map((b) => {
                          const barX = groupX + (groupScale(b.runId) ?? 0);
                          const barW = groupScale.bandwidth();
                          const barH = innerH - yScale(b.value);
                          const barY = yScale(b.value);
                          return (
                            <Bar
                              key={b.runId}
                              x={barX}
                              y={barY}
                              width={barW}
                              height={Math.max(barH, 1)}
                              fill={b.color}
                              rx={2}
                              opacity={0.85}
                            />
                          );
                        })}
                        <Text
                          x={groupX + xScale.bandwidth() / 2}
                          y={innerH + 4}
                          textAnchor="middle"
                          verticalAnchor="start"
                          fill="#71717a"
                          fontSize={compact ? 7 : 9}
                          fontFamily="'JetBrains Mono', monospace"
                        >
                          {group.category}
                        </Text>
                      </g>
                    );
                  })
                : data.map(d => {
                    const barX = xScale(d.label) ?? 0;
                    const barW = xScale.bandwidth();
                    const barH = innerH - yScale(d.value);
                    const barY = yScale(d.value);
                    const sev = getMetricSeverity(d.value, context);
                    const color = SEVERITY_HEX[sev];

                    return (
                      <g key={d.label}>
                        <Bar
                          x={barX}
                          y={barY}
                          width={barW}
                          height={Math.max(barH, 1)}
                          fill={color}
                          rx={2}
                          opacity={0.8}
                          style={{ filter: `drop-shadow(0 0 4px ${color}30)` }}
                        />
                        {/* Value label above bar */}
                        <Text
                          x={barX + barW / 2}
                          y={barY - 4}
                          textAnchor="middle"
                          verticalAnchor="end"
                          fill={color}
                          fontSize={compact ? 8 : 10}
                          fontFamily="'JetBrains Mono', monospace"
                          fontWeight={600}
                        >
                          {d.value.toFixed(context.decimals ?? 2)}
                        </Text>
                        {/* X-axis label */}
                        <Text
                          x={barX + barW / 2}
                          y={innerH + 4}
                          textAnchor="middle"
                          verticalAnchor="start"
                          fill="#71717a"
                          fontSize={compact ? 7 : 9}
                          fontFamily="'JetBrains Mono', monospace"
                        >
                          {d.label}
                        </Text>
                      </g>
                    );
                  })}
            </Group>
          </svg>
        </div>
        {/* Run legend — color chips paired with text labels (never hue alone) */}
        {isOverlay && (
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
            {(props.series ?? []).map((s) => (
              <div key={s.runId} className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-[1px]" style={{ backgroundColor: s.color }} />
                <span className="text-[8px] font-mono text-zinc-500">{s.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </RendererShell>
  );
}
