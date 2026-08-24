/**
 * CorrelationMatrix — symmetric N×N heatmap.
 *
 * Cell color is a diverging gradient from --data-div-neg (deep red, ρ → −1)
 * through --data-div-mid (neutral, ρ → 0) to --data-div-pos (green, ρ → +1).
 * Diagonal is always ρ=1 (auto). Null cells (insufficient overlap) render
 * muted gray.
 *
 * Labels sit on the top edge (X) and left edge (Y), font-mono and compact.
 */

import { useMemo } from "react";
import { ParentSize } from "@visx/responsive";
import { Group } from "@visx/group";

interface CorrelationMatrixProps {
  symbols: string[];
  /** m[i][j] = correlation between symbols[i] and symbols[j]; null when not computable. */
  m: (number | null)[][];
  /** Show numeric value inside each cell (only when cell ≥ 24px). Default true. */
  showValues?: boolean;
  height?: number;
}

const MARGIN = { top: 36, right: 8, bottom: 8, left: 56 };

export function CorrelationMatrix({
  symbols,
  m,
  showValues = true,
  height = 280,
}: CorrelationMatrixProps) {
  if (symbols.length < 2) {
    return (
      <div
        className="flex items-center justify-center rounded-md border border-dashed border-white/10 bg-white/[0.02] text-[11px] text-muted-foreground"
        style={{ height }}
      >
        Need at least two symbols.
      </div>
    );
  }

  return (
    <ParentSize parentSizeStyles={{ width: "100%", height }}>
      {({ width }) => {
        if (width < 100) return null;
        const innerW = width - MARGIN.left - MARGIN.right;
        const innerH = height - MARGIN.top - MARGIN.bottom;
        const cellW = innerW / symbols.length;
        const cellH = innerH / symbols.length;
        const cellSize = Math.min(cellW, cellH);

        return (
          <svg width={width} height={height} role="img" aria-label="correlation-matrix">
            <Group left={MARGIN.left} top={MARGIN.top}>
              {/* X labels (top) */}
              {symbols.map((s, i) => (
                <text
                  key={`x-${s}`}
                  x={i * cellSize + cellSize / 2}
                  y={-8}
                  fontSize={9}
                  fill="hsl(var(--muted-foreground))"
                  fontFamily="var(--font-mono)"
                  textAnchor="middle"
                  transform={`rotate(-45, ${i * cellSize + cellSize / 2}, -8)`}
                >
                  {s}
                </text>
              ))}

              {/* Y labels (left) */}
              {symbols.map((s, i) => (
                <text
                  key={`y-${s}`}
                  x={-6}
                  y={i * cellSize + cellSize / 2 + 3}
                  fontSize={9}
                  fill="hsl(var(--muted-foreground))"
                  fontFamily="var(--font-mono)"
                  textAnchor="end"
                >
                  {s}
                </text>
              ))}

              {/* Cells */}
              {symbols.map((_si, i) =>
                symbols.map((_sj, j) => {
                  const v = m[i]?.[j] ?? null;
                  return (
                    <CorrCell
                      key={`${i}-${j}`}
                      x={j * cellSize}
                      y={i * cellSize}
                      size={cellSize}
                      value={v}
                      showValue={showValues && cellSize >= 24}
                    />
                  );
                }),
              )}
            </Group>
          </svg>
        );
      }}
    </ParentSize>
  );
}

function CorrCell({
  x,
  y,
  size,
  value,
  showValue,
}: {
  x: number;
  y: number;
  size: number;
  value: number | null;
  showValue: boolean;
}) {
  const color = useMemo(() => corrColor(value), [value]);
  const text = value == null ? "" : value.toFixed(2);
  const textFill = value != null && Math.abs(value) > 0.5 ? "hsl(var(--background))" : "hsl(var(--foreground))";
  return (
    <g>
      <rect
        x={x + 0.5}
        y={y + 0.5}
        width={size - 1}
        height={size - 1}
        fill={color}
        stroke="hsl(var(--background))"
        strokeWidth={0.5}
      />
      {showValue && value != null && (
        <text
          x={x + size / 2}
          y={y + size / 2 + 3}
          fontSize={Math.min(11, size * 0.4)}
          fill={textFill}
          fontFamily="var(--font-mono)"
          textAnchor="middle"
        >
          {text}
        </text>
      )}
    </g>
  );
}

function corrColor(v: number | null): string {
  if (v == null) return "hsl(var(--data-neutral) / 0.15)";
  // Diverging through three discrete stops; smoother gradients are overkill
  // for the resolution of a typical correlation matrix.
  if (v >= 0.7) return "hsl(var(--data-div-pos-strong))";
  if (v >= 0.3) return "hsl(var(--data-div-pos))";
  if (v >= -0.3) return "hsl(var(--data-div-mid))";
  if (v >= -0.7) return "hsl(var(--data-div-neg))";
  return "hsl(var(--data-div-neg-strong))";
}
