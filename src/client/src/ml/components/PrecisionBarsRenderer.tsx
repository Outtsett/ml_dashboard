/**
 * PrecisionBarsRenderer — Grouped precision/recall/f1 bars for each class.
 *
 * Value is Record<string, {precision: number, recall: number, f1: number}>.
 * Baseline dashed line at context.baseline (e.g., 0.33 for random 3-class).
 * Distinct colors per metric type: precision=cyan, recall=amber, f1=emerald.
 */

import { useMemo } from 'react';
import { Bar } from '@visx/shape';
import { Group } from '@visx/group';
import { scaleLinear, scaleBand } from '@visx/scale';
import { Text } from '@visx/text';
import type { RendererProps } from "@/ml/lib/diagnostics-schema";
import { RendererShell, useShellProps } from './RendererShell';

interface ClassMetrics {
  precision: number;
  recall: number;
  f1: number;
}

const METRIC_COLORS = {
  precision: '#22d3ee',
  recall: '#fbbf24',
  f1: '#34d399',
} as const;

const METRIC_KEYS: (keyof ClassMetrics)[] = ['precision', 'recall', 'f1'];

function parseValue(value: RendererProps['metric']['value']): Record<string, ClassMetrics> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const result: Record<string, ClassMetrics> = {};
    for (const [cls, metrics] of Object.entries(value)) {
      if (metrics && typeof metrics === 'object') {
        const m = metrics as Record<string, number>;
        result[cls] = {
          precision: m['precision'] ?? 0,
          recall: m['recall'] ?? 0,
          f1: m['f1'] ?? 0,
        };
      }
    }
    return result;
  }
  return {};
}

export function PrecisionBarsRenderer(props: RendererProps) {
  const { metricKey, mission, compact, context } = useShellProps(props);

  const classData = useMemo(
    () => parseValue(props.metric.value),
    [props.metric.value],
  );

  const classes = Object.keys(classData);

  const width = compact ? 240 : 380;
  const height = compact ? 120 : 180;
  const margin = { top: 12, right: 10, bottom: 30, left: 10 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;

  const classScale = useMemo(
    () =>
      scaleBand<string>({
        domain: classes,
        range: [0, innerW],
        padding: 0.25,
      }),
    [classes, innerW],
  );

  const metricScale = useMemo(
    () =>
      scaleBand<string>({
        domain: METRIC_KEYS,
        range: [0, classScale.bandwidth()],
        padding: 0.1,
      }),
    [classScale],
  );

  const yScale = useMemo(
    () =>
      scaleLinear<number>({
        domain: [0, 1],
        range: [innerH, 0],
      }),
    [innerH],
  );

  // Compute overall severity based on mean f1
  const meanF1 = classes.length > 0
    ? classes.reduce((s, c) => s + (classData[c]?.f1 ?? 0), 0) / classes.length
    : 0;
  const severity = meanF1 >= (context.great ?? 0.8)
    ? 'great'
    : meanF1 >= (context.good ?? 0.6)
      ? 'good'
      : meanF1 >= (context.bad ?? 0.4)
        ? 'neutral'
        : 'bad';

  if (classes.length === 0) {
    return (
      <RendererShell metricKey={metricKey} mission={mission} compact={compact} severity="neutral">
        <div className="flex items-center justify-center h-20 text-zinc-600 text-xs font-mono">
          No class metrics
        </div>
      </RendererShell>
    );
  }

  return (
    <RendererShell metricKey={metricKey} mission={mission} compact={compact} severity={severity}>
      <div className="flex flex-col gap-2">
        {/* Legend */}
        <div className="flex items-center gap-3 justify-center">
          {METRIC_KEYS.map(mk => (
            <div key={mk} className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-[1px]" style={{ background: METRIC_COLORS[mk] }} />
              <span className="text-[8px] font-mono text-zinc-500 uppercase tracking-wider">{mk}</span>
            </div>
          ))}
        </div>

        <div className="flex justify-center">
          <svg width={width} height={height} className="overflow-visible">
            <Group top={margin.top} left={margin.left}>
              {/* Horizontal grid */}
              {[0, 0.25, 0.5, 0.75, 1.0].map(tick => (
                <line
                  key={tick}
                  x1={0}
                  x2={innerW}
                  y1={yScale(tick)}
                  y2={yScale(tick)}
                  stroke="#3f3f46"
                  strokeDasharray="2 3"
                  opacity={0.3}
                />
              ))}

              {/* Baseline dashed line */}
              {context.baseline != null && (
                <g>
                  <line
                    x1={0}
                    x2={innerW}
                    y1={yScale(context.baseline)}
                    y2={yScale(context.baseline)}
                    stroke="#fbbf24"
                    strokeWidth={1.5}
                    strokeDasharray="6 3"
                    opacity={0.5}
                  />
                  <Text
                    x={innerW + 2}
                    y={yScale(context.baseline)}
                    verticalAnchor="middle"
                    fill="#fbbf24"
                    fontSize={7}
                    fontFamily="'JetBrains Mono', monospace"
                    opacity={0.6}
                  >
                    rng
                  </Text>
                </g>
              )}

              {/* Grouped bars per class */}
              {classes.map(cls => {
                const cx = classScale(cls) ?? 0;
                const metrics = classData[cls]!;

                return (
                  <g key={cls}>
                    {METRIC_KEYS.map(mk => {
                      const mx = metricScale(mk) ?? 0;
                      const v = metrics[mk];
                      const barH = innerH - yScale(v);
                      const barY = yScale(v);
                      const barW = metricScale.bandwidth();

                      return (
                        <g key={mk}>
                          <Bar
                            x={cx + mx}
                            y={barY}
                            width={barW}
                            height={Math.max(barH, 1)}
                            fill={METRIC_COLORS[mk]}
                            rx={1}
                            opacity={0.75}
                          />
                          {/* Value on top */}
                          {!compact && (
                            <Text
                              x={cx + mx + barW / 2}
                              y={barY - 2}
                              textAnchor="middle"
                              verticalAnchor="end"
                              fill={METRIC_COLORS[mk]}
                              fontSize={7}
                              fontFamily="'JetBrains Mono', monospace"
                            >
                              {v.toFixed(2)}
                            </Text>
                          )}
                        </g>
                      );
                    })}

                    {/* Class label */}
                    <Text
                      x={cx + classScale.bandwidth() / 2}
                      y={innerH + 6}
                      textAnchor="middle"
                      verticalAnchor="start"
                      fill="#a1a1aa"
                      fontSize={compact ? 7 : 9}
                      fontFamily="'JetBrains Mono', monospace"
                      fontWeight={500}
                    >
                      {cls}
                    </Text>
                  </g>
                );
              })}
            </Group>
          </svg>
        </div>
      </div>
    </RendererShell>
  );
}
