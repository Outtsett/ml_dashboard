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
import type { RendererProps } from '@/lib/diagnostics-schema';
import { getMetricSeverity } from '@/lib/diagnostics-schema';
import { RendererShell, useShellProps } from './RendererShell';

const SEVERITY_HEX = {
  great: '#34d399',
  good: '#22d3ee',
  neutral: '#71717a',
  bad: '#ef4444',
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

export function BarsRenderer(props: RendererProps) {
  const { metricKey, mission, compact, context } = useShellProps(props);

  const data = useMemo(
    () => parseBarData(props.metric.value, context.labels),
    [props.metric.value, context.labels],
  );

  // Overall severity from average or just neutral
  const avgValue = data.length > 0 ? data.reduce((s, d) => s + d.value, 0) / data.length : 0;
  const overallSeverity = getMetricSeverity(avgValue, context);

  const width = compact ? 200 : 320;
  const height = compact ? 100 : 160;
  const margin = { top: 16, right: 8, bottom: 28, left: 8 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;

  const xScale = useMemo(
    () =>
      scaleBand<string>({
        domain: data.map(d => d.label),
        range: [0, innerW],
        padding: 0.3,
      }),
    [data, innerW],
  );

  const maxVal = Math.max(...data.map(d => d.value), context.max ?? 0, 0.01);

  const yScale = useMemo(
    () =>
      scaleLinear<number>({
        domain: [0, maxVal],
        range: [innerH, 0],
      }),
    [maxVal, innerH],
  );

  if (data.length === 0) {
    return (
      <RendererShell metricKey={metricKey} mission={mission} compact={compact} severity="neutral">
        <div className="flex items-center justify-center h-20 text-zinc-600 text-xs font-mono">
          No data
        </div>
      </RendererShell>
    );
  }

  return (
    <RendererShell metricKey={metricKey} mission={mission} compact={compact} severity={overallSeverity}>
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

            {/* Bars */}
            {data.map(d => {
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
    </RendererShell>
  );
}
