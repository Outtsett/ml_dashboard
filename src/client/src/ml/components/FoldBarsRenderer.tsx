/**
 * FoldBarsRenderer — Walk-forward fold visualization.
 *
 * Value is array of {fold, train_size, val_size, metric_value}.
 * Each fold shown as a bar with train/val segments stacked.
 * Metric value labeled above. Color by whether metric meets context.good threshold.
 */

import { useMemo } from 'react';
import { Bar } from '@visx/shape';
import { Group } from '@visx/group';
import { scaleLinear, scaleBand } from '@visx/scale';
import { Text } from '@visx/text';
import type { MetricSeriesEntry, RendererProps } from "@/ml/lib/diagnostics-schema";
import { RendererShell, useShellProps } from './RendererShell';

interface FoldData {
  fold: number;
  train_size: number;
  val_size: number;
  metric_value: number;
}

function parseFolds(value: RendererProps['metric']['value']): FoldData[] {
  if (Array.isArray(value)) {
    return (value as unknown as Record<string, unknown>[])
      .filter(v => v && typeof v === 'object' && 'fold' in v)
      .map(v => ({
        fold: Number(v['fold'] ?? 0),
        train_size: Number(v['train_size'] ?? 0),
        val_size: Number(v['val_size'] ?? 0),
        metric_value: Number(v['metric_value'] ?? 0),
      }));
  }
  return [];
}

/** One run's fold bar within a grouped-by-fold overlay. */
interface GroupedFoldBar {
  runId: string;
  label: string;
  color: string;
  metric_value: number;
}
interface FoldGroup {
  fold: number;
  bars: GroupedFoldBar[];
}

/**
 * Overlay mode drops the per-run train/val stacked-size bars (structurally
 * about the split, not the outcome, and comparing them across runs is not
 * the point of an overlay) and groups just `metric_value` per fold, one bar
 * per run — the TensorBoard-style comparison the plan asks for.
 */
function buildFoldGroups(series: MetricSeriesEntry[]): FoldGroup[] {
  const perRun = series.map((entry) => ({ entry, folds: parseFolds(entry.metric.value) }));

  const foldNums: number[] = [];
  const seen = new Set<number>();
  for (const { folds } of perRun) {
    for (const f of folds) {
      if (!seen.has(f.fold)) {
        seen.add(f.fold);
        foldNums.push(f.fold);
      }
    }
  }
  foldNums.sort((a, b) => a - b);

  return foldNums.map((fold) => ({
    fold,
    bars: perRun
      .map(({ entry, folds }) => {
        const found = folds.find((f) => f.fold === fold);
        return found
          ? { runId: entry.runId, label: entry.label, color: entry.color, metric_value: found.metric_value }
          : null;
      })
      .filter((b): b is GroupedFoldBar => b != null),
  }));
}

export function FoldBarsRenderer(props: RendererProps) {
  const { metricKey, mission, compact, context } = useShellProps(props);
  const folds = useMemo(() => parseFolds(props.metric.value), [props.metric.value]);

  // Overall severity from mean metric
  const meanMetric = folds.length > 0
    ? folds.reduce((s, f) => s + f.metric_value, 0) / folds.length
    : 0;
  const severity = meanMetric >= (context.great ?? 0.8)
    ? 'great'
    : meanMetric >= (context.good ?? 0.6)
      ? 'good'
      : meanMetric >= (context.bad ?? 0.4)
        ? 'neutral'
        : 'bad';

  const width = compact ? 220 : 360;
  const height = compact ? 110 : 170;
  const margin = { top: 22, right: 10, bottom: 26, left: 10 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;

  const maxSize = Math.max(...folds.map(f => f.train_size + f.val_size), 1);

  const xScale = useMemo(
    () =>
      scaleBand<string>({
        domain: folds.map(f => `F${f.fold}`),
        range: [0, innerW],
        padding: 0.2,
      }),
    [folds, innerW],
  );

  const yScale = useMemo(
    () =>
      scaleLinear<number>({
        domain: [0, maxSize],
        range: [innerH, 0],
      }),
    [maxSize, innerH],
  );

  if (folds.length === 0) {
    return (
      <RendererShell metricKey={metricKey} mission={mission} compact={compact} severity="neutral">
        <div className="flex items-center justify-center h-20 text-zinc-600 text-xs font-mono">
          No fold data
        </div>
      </RendererShell>
    );
  }

  const goodThreshold = context.good ?? 0.6;

  return (
    <RendererShell metricKey={metricKey} mission={mission} compact={compact} severity={severity}>
      <div className="flex flex-col gap-1.5">
        {/* Legend */}
        <div className="flex items-center gap-3 justify-center">
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-[1px] bg-cyan-600" />
            <span className="text-[8px] font-mono text-zinc-500 uppercase tracking-wider">Train</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-[1px] bg-amber-500" />
            <span className="text-[8px] font-mono text-zinc-500 uppercase tracking-wider">Val</span>
          </div>
        </div>

        <div className="flex justify-center">
          <svg width={width} height={height} className="overflow-visible">
            <Group top={margin.top} left={margin.left}>
              {/* Grid */}
              {yScale.ticks(4).map(tick => (
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

              {folds.map(fold => {
                const label = `F${fold.fold}`;
                const barX = xScale(label) ?? 0;
                const barW = xScale.bandwidth();

                // Stacked: train on bottom, val on top
                const trainH = innerH - yScale(fold.train_size);
                const valH = innerH - yScale(fold.val_size);
                const trainY = innerH - trainH;
                const valY = trainY - valH;

                const meetsThreshold = fold.metric_value >= goodThreshold;
                const metricColor = meetsThreshold ? '#34d399' : '#ef4444';

                return (
                  <g key={label}>
                    {/* Train segment */}
                    <Bar
                      x={barX}
                      y={trainY}
                      width={barW}
                      height={Math.max(trainH, 1)}
                      fill="#0e7490"
                      rx={0}
                      opacity={0.7}
                    />
                    {/* Val segment stacked on top */}
                    <Bar
                      x={barX}
                      y={Math.max(valY, 0)}
                      width={barW}
                      height={Math.max(valH, 1)}
                      fill="#d97706"
                      rx={0}
                      opacity={0.7}
                    />
                    {/* Rounded top cap */}
                    <rect
                      x={barX}
                      y={Math.max(valY, 0)}
                      width={barW}
                      height={3}
                      fill="#d97706"
                      rx={2}
                      opacity={0.7}
                    />

                    {/* Metric value above */}
                    <Text
                      x={barX + barW / 2}
                      y={Math.max(valY, 0) - 4}
                      textAnchor="middle"
                      verticalAnchor="end"
                      fill={metricColor}
                      fontSize={compact ? 8 : 10}
                      fontFamily="'JetBrains Mono', monospace"
                      fontWeight={700}
                    >
                      {fold.metric_value.toFixed(context.decimals ?? 3)}
                    </Text>

                    {/* Fold label */}
                    <Text
                      x={barX + barW / 2}
                      y={innerH + 6}
                      textAnchor="middle"
                      verticalAnchor="start"
                      fill="#71717a"
                      fontSize={compact ? 7 : 9}
                      fontFamily="'JetBrains Mono', monospace"
                    >
                      {label}
                    </Text>
                  </g>
                );
              })}
            </Group>
          </svg>
        </div>

        {/* Summary */}
        <div className="flex justify-center gap-4 text-[9px] font-mono text-zinc-500">
          <span>{folds.length} folds</span>
          <span>mean: {meanMetric.toFixed(context.decimals ?? 3)}</span>
        </div>
      </div>
    </RendererShell>
  );
}
