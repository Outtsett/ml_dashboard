/**
 * RingRenderer — Donut/ring chart using visx Pie.
 *
 * Value is Record<string, number> (label -> count).
 * Shows percentages. Center text with total.
 * Animated segment transitions.
 */

import { useMemo, useState } from 'react';
import { Pie } from '@visx/shape';
import { Group } from '@visx/group';
import { Text } from '@visx/text';
import type { RendererProps } from '@/lib/diagnostics-schema';
import { RendererShell, useShellProps } from './RendererShell';
import { cn } from '@/lib/utils';

interface SliceData {
  label: string;
  value: number;
  percent: number;
}

const RING_COLORS = [
  '#22d3ee', // cyan
  '#34d399', // emerald
  '#fbbf24', // amber
  '#a78bfa', // violet
  '#f472b6', // pink
  '#fb923c', // orange
  '#60a5fa', // blue
  '#4ade80', // green
];

function parseRingValue(value: RendererProps['metric']['value']): SliceData[] {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, number>;
    const entries = Object.entries(obj).filter(([, v]) => typeof v === 'number' && v > 0);
    const total = entries.reduce((s, [, v]) => s + v, 0);
    if (total === 0) return [];
    return entries.map(([label, v]) => ({
      label,
      value: v,
      percent: (v / total) * 100,
    }));
  }
  return [];
}

export function RingRenderer(props: RendererProps) {
  const { metricKey, mission, compact, context } = useShellProps(props);
  const slices = useMemo(() => parseRingValue(props.metric.value), [props.metric.value]);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const total = slices.reduce((s, d) => s + d.value, 0);

  const size = compact ? 120 : 170;
  const outerR = size / 2 - 10;
  const innerR = outerR * 0.62;
  const cx = size / 2;
  const cy = size / 2;

  if (slices.length === 0) {
    return (
      <RendererShell metricKey={metricKey} mission={mission} compact={compact} severity="neutral">
        <div className="flex items-center justify-center h-20 text-zinc-600 text-xs font-mono">
          No distribution data
        </div>
      </RendererShell>
    );
  }

  const hoveredSlice = hoveredIdx != null ? slices[hoveredIdx] : null;

  return (
    <RendererShell metricKey={metricKey} mission={mission} compact={compact} severity="neutral">
      <div className="flex flex-col items-center gap-2">
        <div className="relative">
          <svg width={size} height={size} className="overflow-visible">
            <Group top={cy} left={cx}>
              <Pie<SliceData>
                data={slices}
                pieValue={d => d.value}
                outerRadius={outerR}
                innerRadius={innerR}
                padAngle={0.02}
                cornerRadius={3}
              >
                {pie =>
                  pie.arcs.map((arc, i) => {
                    const pathData = pie.path(arc) ?? '';
                    const color = RING_COLORS[i % RING_COLORS.length]!;
                    const isHovered = hoveredIdx === i;

                    return (
                      <g
                        key={arc.data.label}
                        onMouseEnter={() => setHoveredIdx(i)}
                        onMouseLeave={() => setHoveredIdx(null)}
                      >
                        <path
                          d={pathData}
                          fill={color}
                          opacity={isHovered ? 1 : hoveredIdx != null ? 0.4 : 0.75}
                          style={{
                            transition: 'opacity 200ms, transform 100ms',
                            filter: isHovered ? `drop-shadow(0 0 6px ${color}60)` : undefined,
                            transform: isHovered ? 'scale(1.04)' : 'scale(1)',
                            transformOrigin: 'center',
                          }}
                        />
                      </g>
                    );
                  })
                }
              </Pie>

              {/* Center text */}
              <Text
                textAnchor="middle"
                verticalAnchor="middle"
                y={hoveredSlice ? -6 : 0}
                fill={hoveredSlice ? RING_COLORS[hoveredIdx! % RING_COLORS.length] : '#e4e4e7'}
                fontSize={compact ? 14 : 20}
                fontFamily="'JetBrains Mono', monospace"
                fontWeight={700}
              >
                {hoveredSlice ? hoveredSlice.percent.toFixed(1) + '%' : total.toLocaleString()}
              </Text>
              {hoveredSlice && (
                <Text
                  textAnchor="middle"
                  verticalAnchor="middle"
                  y={compact ? 8 : 12}
                  fill="#a1a1aa"
                  fontSize={compact ? 7 : 9}
                  fontFamily="'JetBrains Mono', monospace"
                >
                  {hoveredSlice.label}
                </Text>
              )}
              {!hoveredSlice && (
                <Text
                  textAnchor="middle"
                  verticalAnchor="middle"
                  y={compact ? 10 : 16}
                  fill="#71717a"
                  fontSize={compact ? 7 : 8}
                  fontFamily="'JetBrains Mono', monospace"
                >
                  total
                </Text>
              )}
            </Group>
          </svg>
        </div>

        {/* Legend */}
        <div className={cn('flex flex-wrap gap-x-3 gap-y-1 justify-center', compact ? 'px-1' : 'px-2')}>
          {slices.map((slice, i) => (
            <div
              key={slice.label}
              className="flex items-center gap-1 cursor-default"
              onMouseEnter={() => setHoveredIdx(i)}
              onMouseLeave={() => setHoveredIdx(null)}
            >
              <div
                className="w-1.5 h-1.5 rounded-[1px] flex-shrink-0"
                style={{ background: RING_COLORS[i % RING_COLORS.length] }}
              />
              <span className={cn('font-mono text-zinc-500', compact ? 'text-[7px]' : 'text-[8px]')}>
                {slice.label}
              </span>
              <span className={cn('font-mono font-semibold text-zinc-400', compact ? 'text-[7px]' : 'text-[8px]')}>
                {slice.percent.toFixed(1)}%
              </span>
            </div>
          ))}
        </div>
      </div>
    </RendererShell>
  );
}
