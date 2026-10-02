/**
 * DistributionRenderer — Histogram using visx bars.
 *
 * Value is number[] (raw values to bin) or {bins: number[], counts: number[]}.
 * Shows distribution shape with mean/median markers.
 */

import { useMemo } from 'react';
import { Bar } from '@visx/shape';
import { Group } from '@visx/group';
import { scaleLinear, scaleBand } from '@visx/scale';
import { Text } from '@visx/text';
import type { RendererProps } from "@/ml/lib/diagnostics-schema";
import { RendererShell, useShellProps } from './RendererShell';

interface BinData {
  label: string;
  count: number;
  binStart: number;
  binEnd: number;
}

function computeBins(values: number[], nBins: number): BinData[] {
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const step = range / nBins;

  const bins: BinData[] = Array.from({ length: nBins }, (_, i) => ({
    label: (min + step * i + step / 2).toFixed(2),
    count: 0,
    binStart: min + step * i,
    binEnd: min + step * (i + 1),
  }));

  for (const v of values) {
    const idx = Math.min(Math.floor((v - min) / step), nBins - 1);
    bins[idx]!.count++;
  }

  return bins;
}

function parseBinData(value: RendererProps['metric']['value']): {
  bins: BinData[];
  rawValues: number[];
} {
  // Pre-binned: {bins: number[], counts: number[]}
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    if (Array.isArray(obj['bins']) && Array.isArray(obj['counts'])) {
      const binEdges = obj['bins'] as number[];
      const counts = obj['counts'] as number[];
      const bins: BinData[] = counts.map((c, i) => ({
        label: (binEdges[i] ?? i).toFixed(2),
        count: c,
        binStart: binEdges[i] ?? i,
        binEnd: binEdges[i + 1] ?? binEdges[i] ?? i + 1,
      }));
      return { bins, rawValues: [] };
    }
  }

  // Raw array: number[]
  if (Array.isArray(value) && typeof value[0] === 'number') {
    const raw = value as number[];
    const nBins = Math.min(Math.max(Math.ceil(Math.sqrt(raw.length)), 6), 30);
    return { bins: computeBins(raw, nBins), rawValues: raw };
  }

  return { bins: [], rawValues: [] };
}

export function DistributionRenderer(props: RendererProps) {
  const { metricKey, mission, compact, context } = useShellProps(props);

  const { bins, rawValues } = useMemo(
    () => parseBinData(props.metric.value),
    [props.metric.value],
  );

  // Overlay is active only with 2+ runs. A 1-element series would change the
  // fill color for no reason, so it is treated as single-run.
  const overlaySeries =
    props.series && props.series.length > 1 ? props.series : undefined;

  // Stats from raw values
  const stats = useMemo(() => {
    if (rawValues.length === 0 && bins.length === 0) return null;

    if (rawValues.length > 0) {
      const sorted = [...rawValues].sort((a, b) => a - b);
      const mean = rawValues.reduce((s, v) => s + v, 0) / rawValues.length;
      const median = sorted.length % 2 === 0
        ? ((sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2)
        : sorted[Math.floor(sorted.length / 2)]!;
      return { mean, median, n: rawValues.length };
    }

    // Approximate from bins
    const totalCount = bins.reduce((s, b) => s + b.count, 0);
    const weightedSum = bins.reduce((s, b) => s + b.count * (b.binStart + b.binEnd) / 2, 0);
    const mean = totalCount > 0 ? weightedSum / totalCount : 0;
    return { mean, median: mean, n: totalCount };
  }, [rawValues, bins]);

  const width = compact ? 200 : 320;
  const height = compact ? 100 : 150;
  const margin = { top: 12, right: 8, bottom: 24, left: 8 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;

  const xScale = useMemo(
    () =>
      scaleBand<string>({
        domain: bins.map(b => b.label),
        range: [0, innerW],
        padding: 0.08,
      }),
    [bins, innerW],
  );

  const maxCount = Math.max(...bins.map(b => b.count), 1);

  const yScale = useMemo(
    () =>
      scaleLinear<number>({
        domain: [0, maxCount],
        range: [innerH, 0],
      }),
    [maxCount, innerH],
  );

  if (bins.length === 0) {
    return (
      <RendererShell metricKey={metricKey} mission={mission} compact={compact} severity="neutral">
        <div className="flex items-center justify-center h-20 text-zinc-600 text-xs font-mono">
          No distribution data
        </div>
      </RendererShell>
    );
  }

  // Mean position on x axis
  const meanXPos = stats ? (() => {
    const idx = bins.findIndex(b => stats.mean >= b.binStart && stats.mean < b.binEnd);
    if (idx >= 0) {
      const bx = xScale(bins[idx]!.label) ?? 0;
      const bw = xScale.bandwidth();
      const frac = (stats.mean - bins[idx]!.binStart) / (bins[idx]!.binEnd - bins[idx]!.binStart);
      return bx + bw * frac;
    }
    return innerW / 2;
  })() : null;

  return (
    <RendererShell metricKey={metricKey} mission={mission} compact={compact} severity="neutral">
      <div className="flex flex-col gap-1">
        {/* Stats row */}
        {stats && (
          <div className="flex items-center justify-center gap-4 text-[9px] font-mono">
            <span className="text-zinc-500">n={stats.n}</span>
            <span className="text-cyan-400">mean={stats.mean.toFixed(context.decimals ?? 3)}</span>
            <span className="text-[hsl(var(--data-pos))]">med={stats.median.toFixed(context.decimals ?? 3)}</span>
          </div>
        )}

        <div className="flex justify-center">
          <svg width={width} height={height} className="overflow-visible">
            <Group top={margin.top} left={margin.left}>
              {/* Grid */}
              {yScale.ticks(3).map(tick => (
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

              {/* Overlay mode — one translucent histogram per run, drawn over
                  the primary's shared x domain. Each run also gets a distinct
                  stroke dash so the series stay separable without relying on
                  hue (deuteranopia). The primary run still draws its solid bars
                  below via the normal path. */}
              {overlaySeries?.slice(1).map((entry, si) => {
                const { bins: sBins } = parseBinData(entry.metric.value);
                if (sBins.length === 0) return null;
                return (
                  <g key={entry.runId} opacity={0.55}>
                    {sBins.map((bin, i) => {
                      const bx = xScale(bins[i]?.label ?? bin.label) ?? 0;
                      const bw = xScale.bandwidth();
                      const by = yScale(bin.count);
                      return (
                        <Bar
                          key={i}
                          x={bx}
                          y={by}
                          width={bw}
                          height={Math.max(innerH - by, 1)}
                          fill="none"
                          stroke={entry.color}
                          strokeWidth={1.5}
                          strokeDasharray={si % 2 === 0 ? undefined : '3 2'}
                          rx={1}
                        />
                      );
                    })}
                  </g>
                );
              })}

              {/* Bars */}
              {bins.map((bin, i) => {
                const bx = xScale(bin.label) ?? 0;
                const bw = xScale.bandwidth();
                const bh = innerH - yScale(bin.count);
                const by = yScale(bin.count);

                // Color gradient: higher bars more saturated
                const t = maxCount > 0 ? bin.count / maxCount : 0;
                const r = Math.round(34 + t * (34 - 34));
                const g = Math.round(78 + t * (211 - 78));
                const b2 = Math.round(99 + t * (238 - 99));
                const fill = `rgb(${r}, ${g}, ${b2})`;

                return (
                  <g key={i}>
                    <Bar
                      x={bx}
                      y={by}
                      width={bw}
                      height={Math.max(bh, 1)}
                      fill={overlaySeries ? (overlaySeries[0]?.color ?? fill) : fill}
                      rx={1}
                      opacity={overlaySeries ? 0.9 : 0.75}
                    />
                    {/* Count label on tall bars */}
                    {bh > 14 && !compact && (
                      <Text
                        x={bx + bw / 2}
                        y={by + bh / 2}
                        textAnchor="middle"
                        verticalAnchor="middle"
                        fill="#fff"
                        fontSize={7}
                        fontFamily="'JetBrains Mono', monospace"
                        opacity={0.6}
                      >
                        {bin.count}
                      </Text>
                    )}
                  </g>
                );
              })}

              {/* Mean marker line */}
              {meanXPos != null && (
                <g>
                  <line
                    x1={meanXPos}
                    x2={meanXPos}
                    y1={0}
                    y2={innerH}
                    stroke="#22d3ee"
                    strokeWidth={1.5}
                    strokeDasharray="4 2"
                    opacity={0.6}
                  />
                  <Text
                    x={meanXPos}
                    y={-2}
                    textAnchor="middle"
                    verticalAnchor="end"
                    fill="#22d3ee"
                    fontSize={7}
                    fontFamily="'JetBrains Mono', monospace"
                    opacity={0.7}
                  >
                    mean
                  </Text>
                </g>
              )}

              {/* X-axis ticks (show every Nth label to avoid overlap) */}
              {bins.map((bin, i) => {
                const step = Math.max(1, Math.floor(bins.length / 6));
                if (i % step !== 0 && i !== bins.length - 1) return null;
                const bx = (xScale(bin.label) ?? 0) + xScale.bandwidth() / 2;
                return (
                  <Text
                    key={`x-${i}`}
                    x={bx}
                    y={innerH + 4}
                    textAnchor="middle"
                    verticalAnchor="start"
                    fill="#52525b"
                    fontSize={compact ? 6 : 7}
                    fontFamily="'JetBrains Mono', monospace"
                  >
                    {parseFloat(bin.label).toFixed(1)}
                  </Text>
                );
              })}
            </Group>
          </svg>
        </div>
      </div>
    </RendererShell>
  );
}
