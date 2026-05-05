/**
 * ConfusionMatrixRenderer — NxN heatmap grid using visx rects.
 *
 * Value is number[][]. Row/column labels from context.labels.
 * Color intensity by cell value (darker = lower, brighter = higher).
 * Diagonal highlighted (correct predictions). Cell values displayed.
 */

import { useMemo, useState } from 'react';
import { Group } from '@visx/group';
import { scaleLinear } from '@visx/scale';
import { Text } from '@visx/text';
import type { RendererProps } from '@/lib/diagnostics-schema';
import { RendererShell, useShellProps } from './RendererShell';

interface CellData {
  row: number;
  col: number;
  value: number;
  norm: number;
  isDiag: boolean;
}

function parseMatrix(value: RendererProps['metric']['value']): number[][] {
  if (Array.isArray(value) && Array.isArray(value[0])) {
    return value as number[][];
  }
  return [];
}

export function ConfusionMatrixRenderer(props: RendererProps) {
  const { metricKey, mission, compact, context } = useShellProps(props);
  const matrix = useMemo(() => parseMatrix(props.metric.value), [props.metric.value]);
  const labels = context.labels ?? matrix.map((_, i) => `${i}`);

  const [hoveredCell, setHoveredCell] = useState<{ row: number; col: number } | null>(null);

  const n = matrix.length;

  if (n === 0) {
    return (
      <RendererShell metricKey={metricKey} mission={mission} compact={compact} severity="neutral">
        <div className="flex items-center justify-center h-20 text-zinc-600 text-xs font-mono">
          No matrix data
        </div>
      </RendererShell>
    );
  }

  const labelMargin = compact ? 30 : 44;
  const cellSize = compact ? 28 : 42;
  const gap = 2;
  const gridSize = n * cellSize + (n - 1) * gap;
  const totalW = gridSize + labelMargin + 10;
  const totalH = gridSize + labelMargin + 10;

  const flat = matrix.flat();
  const maxVal = Math.max(...flat, 1);

  const colorScale = scaleLinear<string>({
    domain: [0, maxVal * 0.5, maxVal],
    range: ['#18181b', '#164e63', '#22d3ee'],
  });

  const diagColorScale = scaleLinear<string>({
    domain: [0, maxVal * 0.5, maxVal],
    range: ['#18181b', '#064e3b', '#34d399'],
  });

  // Compute overall accuracy
  const totalSamples = flat.reduce((s, v) => s + v, 0);
  const diagSum = matrix.reduce((s, row, i) => s + (row[i] ?? 0), 0);
  const accuracy = totalSamples > 0 ? diagSum / totalSamples : 0;

  const severity = accuracy >= (context.great ?? 0.8)
    ? 'great'
    : accuracy >= (context.good ?? 0.6)
      ? 'good'
      : accuracy >= (context.bad ?? 0.4)
        ? 'neutral'
        : 'bad';

  const cells: CellData[] = matrix.flatMap((row, r) =>
    row.map((value, c) => ({
      row: r,
      col: c,
      value,
      norm: maxVal > 0 ? value / maxVal : 0,
      isDiag: r === c,
    })),
  );

  return (
    <RendererShell metricKey={metricKey} mission={mission} compact={compact} severity={severity}>
      <div className="flex flex-col items-center gap-1.5">
        {/* Accuracy badge */}
        <div className="flex items-baseline gap-1.5">
          <span className="text-[9px] font-mono text-zinc-500 uppercase tracking-wider">Accuracy</span>
          <span className="text-sm font-mono font-bold text-cyan-400 metric-glow">
            {(accuracy * 100).toFixed(1)}%
          </span>
        </div>

        <div className="flex justify-center">
          <svg width={totalW} height={totalH} className="overflow-visible">
            <Group top={8} left={labelMargin}>
              {/* Column header labels */}
              {labels.slice(0, n).map((label, j) => (
                <Text
                  key={`col-${j}`}
                  x={j * (cellSize + gap) + cellSize / 2}
                  y={-4}
                  textAnchor="middle"
                  verticalAnchor="end"
                  fill="#a1a1aa"
                  fontSize={compact ? 7 : 9}
                  fontFamily="'JetBrains Mono', monospace"
                  fontWeight={500}
                >
                  {label}
                </Text>
              ))}

              {/* Cells */}
              <Group top={4}>
                {cells.map(cell => {
                  const x = cell.col * (cellSize + gap);
                  const y = cell.row * (cellSize + gap);
                  const isHovered = hoveredCell?.row === cell.row && hoveredCell?.col === cell.col;
                  const color = cell.isDiag
                    ? diagColorScale(cell.value)
                    : colorScale(cell.value);

                  return (
                    <g
                      key={`${cell.row}-${cell.col}`}
                      onMouseEnter={() => setHoveredCell({ row: cell.row, col: cell.col })}
                      onMouseLeave={() => setHoveredCell(null)}
                    >
                      <rect
                        x={x}
                        y={y}
                        width={cellSize}
                        height={cellSize}
                        fill={color}
                        rx={2}
                        stroke={cell.isDiag ? '#34d39940' : isHovered ? '#71717a' : 'transparent'}
                        strokeWidth={cell.isDiag ? 1.5 : 1}
                        opacity={isHovered ? 1 : 0.9}
                        style={{
                          transition: 'opacity 150ms, stroke 150ms',
                          ...(cell.isDiag && cell.norm > 0.3 ? { filter: 'drop-shadow(0 0 3px rgba(52,211,153,0.2))' } : {}),
                        }}
                      />
                      <Text
                        x={x + cellSize / 2}
                        y={y + cellSize / 2}
                        textAnchor="middle"
                        verticalAnchor="middle"
                        fill={cell.norm > 0.5 ? '#fff' : '#a1a1aa'}
                        fontSize={compact ? 8 : 11}
                        fontFamily="'JetBrains Mono', monospace"
                        fontWeight={cell.isDiag ? 700 : 500}
                      >
                        {cell.value}
                      </Text>
                    </g>
                  );
                })}

                {/* Row labels (predicted) */}
                {labels.slice(0, n).map((label, i) => (
                  <Text
                    key={`row-${i}`}
                    x={-6}
                    y={i * (cellSize + gap) + cellSize / 2}
                    textAnchor="end"
                    verticalAnchor="middle"
                    fill="#a1a1aa"
                    fontSize={compact ? 7 : 9}
                    fontFamily="'JetBrains Mono', monospace"
                    fontWeight={500}
                  >
                    {label}
                  </Text>
                ))}
              </Group>
            </Group>
          </svg>
        </div>

        {/* Axis labels */}
        {!compact && (
          <div className="flex justify-between w-full text-[8px] font-mono text-zinc-600 px-4">
            <span>Predicted -&gt;</span>
            <span>Actual |</span>
          </div>
        )}
      </div>
    </RendererShell>
  );
}
