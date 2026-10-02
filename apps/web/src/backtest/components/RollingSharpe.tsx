/**
 * RollingSharpe — overlay of 3 rolling-window Sharpe ratios.
 *
 * Default windows: 20 / 60 / 252 returns (≈ 1m / 3m / 1y at daily). Each
 * window is a separate line; the legend keys the colors. Annualized using
 * periodsPerYear (default 252).
 */

import { useMemo } from "react";
import { ParentSize } from "@visx/responsive";
import { Group } from "@visx/group";
import { scaleLinear } from "@visx/scale";
import { AxisLeft, AxisBottom } from "@visx/axis";
import { LinePath, Line } from "@visx/shape";
import { Text } from "@visx/text";
import { rollingSharpe } from "@/portfolio/lib/risk";

interface RollingSharpeProps {
  returns: number[];
  windows?: [number, number, number];
  periodsPerYear?: number;
  height?: number;
}

const MARGIN = { top: 18, right: 12, bottom: 22, left: 36 };

const WINDOW_COLOR = [
  "hsl(var(--data-cat-1))",
  "hsl(var(--data-cat-3))",
  "hsl(var(--data-cat-5))",
] as const;

export function RollingSharpe({
  returns,
  windows = [20, 60, 252],
  periodsPerYear = 252,
  height = 200,
}: RollingSharpeProps) {
  const series = useMemo(() => {
    return windows.map((w) => ({
      window: w,
      values: rollingSharpe(returns, w, periodsPerYear),
    }));
  }, [returns, windows, periodsPerYear]);

  const allDefined = useMemo(() => {
    const xs: number[] = [];
    for (const s of series) for (const v of s.values) if (v != null && Number.isFinite(v)) xs.push(v);
    return xs;
  }, [series]);

  if (returns.length === 0 || allDefined.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-md border border-dashed border-white/10 bg-white/[0.02] text-[11px] text-muted-foreground"
        style={{ height }}
      >
        Insufficient history.
      </div>
    );
  }

  return (
    <ParentSize parentSizeStyles={{ width: "100%", height }}>
      {({ width }) => {
        if (width < 100) return null;
        const innerW = width - MARGIN.left - MARGIN.right;
        const innerH = height - MARGIN.top - MARGIN.bottom;

        const n = returns.length;
        const x = scaleLinear<number>({ domain: [0, n - 1], range: [0, innerW] });
        let yLo = Math.min(...allDefined);
        let yHi = Math.max(...allDefined);
        if (yLo === yHi) {
          yLo -= 1;
          yHi += 1;
        }
        // Snap zero into view so the user can see whether ratios cross 0.
        yLo = Math.min(yLo, 0);
        yHi = Math.max(yHi, 0);
        const y = scaleLinear<number>({ domain: [yLo, yHi], range: [innerH, 0], nice: true });

        return (
          <svg width={width} height={height} role="img" aria-label="rolling-sharpe">
            <Group left={MARGIN.left} top={MARGIN.top}>
              <AxisBottom
                scale={x}
                top={innerH}
                numTicks={4}
                stroke="hsl(var(--border))"
                tickStroke="hsl(var(--border))"
                tickLabelProps={{
                  fontSize: 9,
                  fill: "hsl(var(--muted-foreground))",
                  fontFamily: "var(--font-mono)",
                  textAnchor: "middle",
                  dy: "0.25em",
                }}
              />
              <AxisLeft
                scale={y}
                numTicks={4}
                stroke="hsl(var(--border))"
                tickStroke="hsl(var(--border))"
                tickLabelProps={{
                  fontSize: 9,
                  fill: "hsl(var(--muted-foreground))",
                  fontFamily: "var(--font-mono)",
                  textAnchor: "end",
                  dx: -4,
                }}
              />
              <Line
                from={{ x: 0, y: y(0) }}
                to={{ x: innerW, y: y(0) }}
                stroke="hsl(var(--border))"
              />
              {series.map((s, idx) => {
                const pts = s.values
                  .map((v, i) => ({ i, v }))
                  .filter((p): p is { i: number; v: number } => p.v != null);
                if (pts.length < 2) return null;
                return (
                  <LinePath
                    key={s.window}
                    data={pts}
                    x={(p) => x(p.i)}
                    y={(p) => y(p.v)}
                    stroke={WINDOW_COLOR[idx % WINDOW_COLOR.length]}
                    strokeWidth={1.5}
                    fill="none"
                  />
                );
              })}

              {/* Legend */}
              {series.map((s, idx) => (
                <g key={`leg-${s.window}`} transform={`translate(${idx * 64}, ${-12})`}>
                  <rect
                    x={0}
                    y={-8}
                    width={10}
                    height={2}
                    fill={WINDOW_COLOR[idx % WINDOW_COLOR.length]}
                  />
                  <Text
                    x={14}
                    y={-4}
                    fontSize={10}
                    fill="hsl(var(--muted-foreground))"
                    fontFamily="var(--font-mono)"
                  >
                    {`${s.window}p`}
                  </Text>
                </g>
              ))}
            </Group>
          </svg>
        );
      }}
    </ParentSize>
  );
}
