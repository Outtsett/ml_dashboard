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
import type { MetricSeriesEntry, RendererProps } from "@/ml/lib/diagnostics-schema";
import { RendererShell, useShellProps } from './RendererShell';
import { cn } from "@/shared/utils/utils";

const LINE_COLORS = [
  '#22d3ee', // cyan
  '#E69F00', // emerald
  '#fbbf24', // amber
  '#a78bfa', // violet
  '#f472b6', // pink
  '#fb923c', // orange
];

/**
 * Dash patterns disambiguating metric NAME within a run when overlaying
 * multiple runs (run identity is carried by `stroke` color; metric-name
 * identity is carried by dash pattern + the line's legend text — never by
 * hue alone, per the deuteranopia-safe requirement).
 */
const DASH_PATTERNS = ['0', '5 3', '2 2', '8 3 2 3', '1 3'];

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

interface OverlayLine {
  dataKey: string;
  name: string;
  color: string;
  dash: string | undefined;
}

interface OverlayDatum {
  epoch: number;
  [key: string]: number | null;
}

/**
 * Merge N runs' time series into one Recharts-friendly dataset, keyed
 * `${runId}__${metricName}` per column. Run identity → `color` (stroke).
 * Metric-name identity (when a run emits >1 named series, e.g. train/val
 * loss) → dash pattern, so two encodings never collapse onto hue alone.
 */
function parseOverlaySeries(series: MetricSeriesEntry[]): {
  data: OverlayDatum[];
  lines: OverlayLine[];
} {
  const perRun = series.map((entry) => ({
    entry,
    parsed: parseTimeSeriesValue(entry.metric.value),
  }));

  const epochSet = new Set<number>();
  for (const { parsed } of perRun) {
    for (const point of parsed.data) epochSet.add(point.epoch);
  }
  const epochs = [...epochSet].sort((a, b) => a - b);

  const data: OverlayDatum[] = epochs.map((epoch) => {
    const row: OverlayDatum = { epoch };
    for (const { entry, parsed } of perRun) {
      const point = parsed.data.find((p) => p.epoch === epoch);
      for (const metricName of parsed.metricNames) {
        row[`${entry.runId}__${metricName}`] = point ? (point[metricName] ?? null) : null;
      }
    }
    return row;
  });

  const lines: OverlayLine[] = [];
  for (const { entry, parsed } of perRun) {
    parsed.metricNames.forEach((metricName, metricIdx) => {
      const dash = DASH_PATTERNS[metricIdx % DASH_PATTERNS.length]!;
      lines.push({
        dataKey: `${entry.runId}__${metricName}`,
        name: parsed.metricNames.length > 1 ? `${entry.label} · ${metricName}` : entry.label,
        color: entry.color,
        dash: dash === '0' ? undefined : dash,
      });
    });
  }

  return { data, lines };
}

export function TimeSeriesRenderer(props: RendererProps) {
  const { metricKey, mission, compact } = useShellProps(props);
  const isOverlay = (props.series?.length ?? 0) > 1;

  const { data: singleData, metricNames: singleMetricNames } = useMemo(
    () => parseTimeSeriesValue(props.metric.value),
    [props.metric.value],
  );

  const { data: overlayData, lines: overlayLines } = useMemo(
    () => (isOverlay ? parseOverlaySeries(props.series!) : { data: [], lines: [] }),
    [isOverlay, props.series],
  );

  const noData = isOverlay
    ? overlayData.length === 0 || overlayLines.length === 0
    : singleData.length === 0 || singleMetricNames.length === 0;

  if (noData) {
    return (
      <RendererShell metricKey={metricKey} mission={mission} compact={compact} severity="neutral">
        <div className="flex items-center justify-center h-20 text-zinc-600 text-xs font-mono">
          No time series data
        </div>
      </RendererShell>
    );
  }

  const chartData: readonly (DataPoint | OverlayDatum)[] = isOverlay ? overlayData : singleData;
  const showLegend = isOverlay || !compact;

  return (
    <RendererShell metricKey={metricKey} mission={mission} compact={compact} severity="neutral">
      <div className={cn('w-full', compact ? 'h-[110px]' : 'h-[150px]')}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData as DataPoint[]} margin={{ top: 8, right: 8, bottom: 4, left: -10 }}>
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
            {showLegend && (
              <Legend
                wrapperStyle={{ fontSize: '9px', fontFamily: "'JetBrains Mono', monospace" }}
                iconSize={8}
              />
            )}
            {isOverlay
              ? overlayLines.map((line) => (
                  <Line
                    key={line.dataKey}
                    type="monotone"
                    dataKey={line.dataKey}
                    name={line.name}
                    stroke={line.color}
                    strokeDasharray={line.dash}
                    strokeWidth={1.5}
                    dot={false}
                    activeDot={{ r: 3, strokeWidth: 0 }}
                    animationDuration={300}
                    connectNulls
                  />
                ))
              : singleMetricNames.map((name, i) => (
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
            {!compact && chartData.length > 20 && (
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
