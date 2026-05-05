/**
 * TimeSeriesRenderer — Line chart for convergence/training curves.
 *
 * Value is {epochs: number[], [metric]: number[]}.
 * Multiple lines with legend. Uses recharts LineChart.
 * Supports brush for zoom.
 */

import { useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Brush,
} from 'recharts';
import type { RendererProps } from '@/lib/diagnostics-schema';
import { RendererShell, useShellProps } from './RendererShell';
import { cn } from '@/lib/utils';

const LINE_COLORS = [
  '#22d3ee', // cyan
  '#34d399', // emerald
  '#fbbf24', // amber
  '#a78bfa', // violet
  '#f472b6', // pink
  '#fb923c', // orange
];

interface DataPoint {
  epoch: number;
  [key: string]: number;
}

function parseTimeSeriesValue(value: RendererProps['metric']['value']): {
  data: DataPoint[];
  metricNames: string[];
} {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, number[] | number>;
    const epochs = Array.isArray(obj['epochs']) ? obj['epochs'] as number[] : [];
    const metricNames = Object.keys(obj).filter(k => k !== 'epochs' && Array.isArray(obj[k]));

    if (epochs.length === 0 && metricNames.length > 0) {
      // Infer epochs from first metric array length
      const firstMetric = obj[metricNames[0]!] as number[];
      const data: DataPoint[] = firstMetric.map((_, i) => {
        const point: DataPoint = { epoch: i + 1 };
        for (const name of metricNames) {
          point[name] = (obj[name] as number[])[i] ?? 0;
        }
        return point;
      });
      return { data, metricNames };
    }

    const data: DataPoint[] = epochs.map((ep, i) => {
      const point: DataPoint = { epoch: ep };
      for (const name of metricNames) {
        point[name] = (obj[name] as number[])[i] ?? 0;
      }
      return point;
    });
    return { data, metricNames };
  }
  return { data: [], metricNames: [] };
}

export function TimeSeriesRenderer(props: RendererProps) {
  const { metricKey, mission, compact, context } = useShellProps(props);

  const { data, metricNames } = useMemo(
    () => parseTimeSeriesValue(props.metric.value),
    [props.metric.value],
  );

  if (data.length === 0 || metricNames.length === 0) {
    return (
      <RendererShell metricKey={metricKey} mission={mission} compact={compact} severity="neutral">
        <div className="flex items-center justify-center h-20 text-zinc-600 text-xs font-mono">
          No time series data
        </div>
      </RendererShell>
    );
  }

  const chartH = compact ? 100 : 140;

  return (
    <RendererShell metricKey={metricKey} mission={mission} compact={compact} severity="neutral">
      <div className={cn('w-full', compact ? 'h-[110px]' : 'h-[150px]')}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: -10 }}>
            <CartesianGrid strokeDasharray="2 4" stroke="#3f3f4640" />
            <XAxis
              dataKey="epoch"
              tick={{ fill: '#71717a', fontSize: 9, fontFamily: "'JetBrains Mono', monospace" }}
              axisLine={{ stroke: '#3f3f46' }}
              tickLine={{ stroke: '#3f3f46' }}
              label={
                !compact
                  ? { value: 'Epoch', position: 'insideBottomRight', offset: -2, style: { fill: '#52525b', fontSize: 8 } }
                  : undefined
              }
            />
            <YAxis
              tick={{ fill: '#71717a', fontSize: 9, fontFamily: "'JetBrains Mono', monospace" }}
              axisLine={{ stroke: '#3f3f46' }}
              tickLine={{ stroke: '#3f3f46' }}
              width={40}
            />
            <Tooltip
              contentStyle={{
                background: 'hsla(220, 15%, 10%, 0.95)',
                border: '1px solid hsla(220, 15%, 25%, 0.5)',
                borderRadius: '4px',
                fontSize: '10px',
                fontFamily: "'JetBrains Mono', monospace",
              }}
              labelStyle={{ color: '#a1a1aa', marginBottom: '4px' }}
              itemStyle={{ padding: '1px 0' }}
              labelFormatter={(label) => `Epoch ${label}`}
            />
            {!compact && (
              <Legend
                wrapperStyle={{ fontSize: '9px', fontFamily: "'JetBrains Mono', monospace" }}
                iconSize={8}
              />
            )}
            {metricNames.map((name, i) => (
              <Line
                key={name}
                type="monotone"
                dataKey={name}
                stroke={LINE_COLORS[i % LINE_COLORS.length]}
                strokeWidth={1.5}
                dot={false}
                activeDot={{ r: 3, strokeWidth: 0 }}
                animationDuration={800}
              />
            ))}
            {!compact && data.length > 20 && (
              <Brush
                dataKey="epoch"
                height={16}
                stroke="#3f3f46"
                fill="hsla(220, 15%, 8%, 0.9)"
                travellerWidth={8}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </RendererShell>
  );
}
