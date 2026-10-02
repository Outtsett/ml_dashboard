/**
 * HeatmapRenderer — 2D numeric grid with color scale using visx.
 *
 * Value is number[][] or Record<string, Record<string, number>>.
 * Color scale from context (min->max). Labels on both axes.
 * Tooltip with exact values on hover.
 */

import { useMemo, useState } from 'react';
import { Group } from '@visx/group';
import { scaleLinear } from '@visx/scale';
import { Text } from '@visx/text';
import type { RendererProps } from "@/ml/lib/diagnostics-schema";
import { RendererShell, useShellProps } from './RendererShell';

interface CellData {
  row: number;
  col: number;
  value: number;
  rowLabel: string;
  colLabel: string;
}

function parseHeatmapValue(
  value: RendererProps['metric']['value'],
  labels?: string[],
): { cells: CellData[]; rowLabels: string[]; colLabels: string[]; nRows: number; nCols: number } {
  // number[][] case
  if (Array.isArray(value) && Array.isArray(value[0])) {
    const matrix = value as number[][];
    const nRows = matrix.length;
    const nCols = matrix[0]?.length ?? 0;
    const rowLabels = labels?.slice(0, nRows) ?? Array.from({ length: nRows }, (_, i) => `${i}`);
    const colLabels = labels?.slice(0, nCols) ?? Array.from({ length: nCols }, (_, i) => `${i}`);

    const cells = matrix.flatMap((row, r) =>
      row.map((v, c) => ({
        row: r,
        col: c,
        value: v,
        rowLabel: rowLabels[r] ?? `${r}`,
        colLabel: colLabels[c] ?? `${c}`,
      })),
    );
    return { cells, rowLabels, colLabels, nRows, nCols };
  }

  // Record<string, Record<string, number>> case
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, Record<string, number> | number>;
    const rowKeys = Object.keys(obj);
    // Check if nested objects
    const firstVal = obj[rowKeys[0]!];
    if (firstVal && typeof firstVal === 'object') {
      const nestedObj = obj as Record<string, Record<string, number>>;
      const colKeySet = new Set<string>();
      for (const row of Object.values(nestedObj)) {
        for (const k of Object.keys(row)) colKeySet.add(k);
      }
      const colKeys = Array.from(colKeySet);
      const cells = rowKeys.flatMap((rk, r) =>
        colKeys.map((ck, c) => ({
          row: r,
          col: c,
          value: nestedObj[rk]?.[ck] ?? 0,
          rowLabel: rk,
          colLabel: ck,
        })),
      );
      return { cells, rowLabels: rowKeys, colLabels: colKeys, nRows: rowKeys.length, nCols: colKeys.length };
    }
  }

  return { cells: [], rowLabels: [], colLabels: [], nRows: 0, nCols: 0 };
}

export function HeatmapRenderer(props: RendererProps) {
  const { metricKey, mission, compact, context } = useShellProps(props);
  const [hovered, setHovered] = useState<CellData | null>(null);

  const { cells, rowLabels, colLabels, nRows, nCols } = useMemo(
    () => parseHeatmapValue(props.metric.value, context.labels),
    [props.metric.value, context.labels],
  );

  if (cells.length === 0) {
    return (
      <RendererShell metricKey={metricKey} mission={mission} compact={compact} severity="neutral">
        <div className="flex items-center justify-center h-20 text-zinc-600 text-xs font-mono">
          No heatmap data
        </div>
      </RendererShell>
    );
  }

  const values = cells.map(c => c.value);
  const minVal = context.min ?? Math.min(...values);
  const maxVal = context.max ?? Math.max(...values);

  const colorScale = scaleLinear<string>({
    domain: [minVal, (minVal + maxVal) / 2, maxVal],
    range: ['#18181b', '#164e63', '#22d3ee'],
  });

  const labelMarginLeft = compact ? 32 : 48;
  const labelMarginTop = compact ? 18 : 24;
  const cellSize = compact ? Math.min(24, 180 / Math.max(nRows, nCols)) : Math.min(36, 280 / Math.max(nRows, nCols));
  const gap = 1.5;
  const gridW = nCols * (cellSize + gap);
  const gridH = nRows * (cellSize + gap);
  const totalW = gridW + labelMarginLeft + 10;
  const totalH = gridH + labelMarginTop + 10;

  return (
    <RendererShell metricKey={metricKey} mission={mission} compact={compact} severity="neutral">
      <div className="flex flex-col items-center gap-1">
        {/* Tooltip */}
        {hovered && (
          <div className="text-[9px] font-mono text-zinc-400 h-4">
            <span className="text-zinc-500">{hovered.rowLabel} x {hovered.colLabel}:</span>{' '}
            <span className="text-cyan-400 font-semibold">{hovered.value.toFixed(context.decimals ?? 3)}</span>
          </div>
        )}
        {!hovered && <div className="h-4" />}

        <div className="flex justify-center">
          <svg width={totalW} height={totalH} className="overflow-visible">
            <Group top={labelMarginTop} left={labelMarginLeft}>
              {/* Column labels */}
              {colLabels.map((label, j) => (
                <Text
                  key={`col-${j}`}
                  x={j * (cellSize + gap) + cellSize / 2}
                  y={-4}
                  textAnchor="middle"
                  verticalAnchor="end"
                  fill="#71717a"
                  fontSize={compact ? 6 : 8}
                  fontFamily="'JetBrains Mono', monospace"
                >
                  {label.length > 6 ? label.slice(0, 5) + '..' : label}
                </Text>
              ))}

              {/* Row labels */}
              {rowLabels.map((label, i) => (
                <Text
                  key={`row-${i}`}
                  x={-4}
                  y={i * (cellSize + gap) + cellSize / 2}
                  textAnchor="end"
                  verticalAnchor="middle"
                  fill="#71717a"
                  fontSize={compact ? 6 : 8}
                  fontFamily="'JetBrains Mono', monospace"
                >
                  {label.length > 6 ? label.slice(0, 5) + '..' : label}
                </Text>
              ))}

              {/* Cells */}
              {cells.map(cell => {
                const x = cell.col * (cellSize + gap);
                const y = cell.row * (cellSize + gap);
                const isHovered = hovered?.row === cell.row && hovered?.col === cell.col;

                return (
                  <g
                    key={`${cell.row}-${cell.col}`}
                    onMouseEnter={() => setHovered(cell)}
                    onMouseLeave={() => setHovered(null)}
                  >
                    <rect
                      x={x}
                      y={y}
                      width={cellSize}
                      height={cellSize}
                      fill={colorScale(cell.value)}
                      rx={1.5}
                      stroke={isHovered ? '#22d3ee' : 'transparent'}
                      strokeWidth={1}
                      opacity={isHovered ? 1 : 0.85}
                      style={{ transition: 'opacity 100ms, stroke 100ms' }}
                    />
                    {/* Show value in cell if cell is large enough */}
                    {cellSize >= 28 && (
                      <Text
                        x={x + cellSize / 2}
                        y={y + cellSize / 2}
                        textAnchor="middle"
                        verticalAnchor="middle"
                        fill={cell.value > (maxVal - minVal) * 0.5 + minVal ? '#fff' : '#71717a'}
                        fontSize={compact ? 6 : 8}
                        fontFamily="'JetBrains Mono', monospace"
                      >
                        {cell.value.toFixed(context.decimals != null ? Math.min(context.decimals, 2) : 2)}
                      </Text>
                    )}
                  </g>
                );
              })}
            </Group>
          </svg>
        </div>

        {/* Color scale legend */}
        <div className="flex items-center gap-1.5">
          <span className="text-[7px] font-mono text-zinc-600">{minVal.toFixed(1)}</span>
          <div
            className="h-1.5 w-20 rounded-sm"
            style={{
              background: `linear-gradient(90deg, #18181b, #164e63, #22d3ee)`,
            }}
          />
          <span className="text-[7px] font-mono text-zinc-600">{maxVal.toFixed(1)}</span>
        </div>
      </div>
    </RendererShell>
  );
}
