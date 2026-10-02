/**
 * DrawdownChart — underwater equity curve.
 *
 * Renders the % drawdown over time as a filled area below zero. The deepest
 * point and the current point are annotated. Pairs with an equity curve as a
 * stacked panel in the Risk page.
 */

import { useMemo } from "react";
import { ParentSize } from "@visx/responsive";
import { Group } from "@visx/group";
import { scaleLinear, scaleTime } from "@visx/scale";
import { AxisLeft, AxisBottom } from "@visx/axis";
import { AreaClosed, Line } from "@visx/shape";
import { Text } from "@visx/text";
import { LinearGradient } from "@visx/gradient";
import type { DrawdownPoint } from "@/portfolio/lib/risk";

interface DrawdownChartProps {
  series: DrawdownPoint[];
  height?: number;
}

const MARGIN = { top: 12, right: 16, bottom: 22, left: 40 };

export function DrawdownChart({ series, height = 180 }: DrawdownChartProps) {
  const deepest = useMemo(() => {
    let mn: DrawdownPoint | null = null;
    for (const p of series) {
      if (!mn || p.drawdown < mn.drawdown) mn = p;
    }
    return mn;
  }, [series]);

  const current = series[series.length - 1] ?? null;

  if (series.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-md border border-dashed border-white/10 bg-white/[0.02] text-[11px] text-muted-foreground"
        style={{ height }}
      >
        No equity history.
      </div>
    );
  }

  return (
    <ParentSize parentSizeStyles={{ width: "100%", height }}>
      {({ width }) => {
        if (width < 100) return null;
        const innerW = width - MARGIN.left - MARGIN.right;
        const innerH = height - MARGIN.top - MARGIN.bottom;

        const ts = series.map((p) => p.t);
        const dds = series.map((p) => p.drawdown);
        const tLo = Math.min(...ts);
        const tHi = Math.max(...ts);
        const ddLo = Math.min(...dds, 0);

        const x = scaleTime<number>({ domain: [tLo, tHi], range: [0, innerW] });
        // y range from min dd (most negative) up to 0
        const y = scaleLinear<number>({
          domain: [ddLo === 0 ? -0.01 : ddLo * 1.05, 0],
          range: [innerH, 0],
        });

        return (
          <svg width={width} height={height} role="img" aria-label="drawdown">
            <LinearGradient
              id="dd-grad"
              from="hsl(var(--data-neg))"
              fromOpacity={0.5}
              to="hsl(var(--data-neg))"
              toOpacity={0.05}
              x1={0}
              x2={0}
              y1={0}
              y2={1}
            />
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
                numTicks={3}
                stroke="hsl(var(--border))"
                tickStroke="hsl(var(--border))"
                tickFormat={(v) => `${(Number(v) * 100).toFixed(0)}%`}
                tickLabelProps={{
                  fontSize: 9,
                  fill: "hsl(var(--muted-foreground))",
                  fontFamily: "var(--font-mono)",
                  textAnchor: "end",
                  dx: -4,
                }}
              />

              {/* Filled drawdown area */}
              <AreaClosed<DrawdownPoint>
                data={series}
                x={(d) => x(d.t)}
                y={(d) => y(d.drawdown)}
                yScale={y}
                fill="url(#dd-grad)"
                stroke="hsl(var(--data-neg))"
                strokeWidth={1.25}
              />

              {/* Zero baseline */}
              <Line
                from={{ x: 0, y: y(0) }}
                to={{ x: innerW, y: y(0) }}
                stroke="hsl(var(--border))"
              />

              {/* Deepest annotation */}
              {deepest && (
                <>
                  <Line
                    from={{ x: x(deepest.t), y: y(deepest.drawdown) }}
                    to={{ x: x(deepest.t), y: y(0) }}
                    stroke="hsl(var(--data-neg) / 0.5)"
                    strokeDasharray="2 3"
                  />
                  <circle
                    cx={x(deepest.t)}
                    cy={y(deepest.drawdown)}
                    r={3}
                    fill="hsl(var(--data-neg))"
                    stroke="hsl(var(--background))"
                    strokeWidth={1}
                  />
                  <Text
                    x={x(deepest.t)}
                    y={y(deepest.drawdown) + 14}
                    fontSize={10}
                    fill="hsl(var(--data-neg))"
                    fontFamily="var(--font-mono)"
                    textAnchor="middle"
                  >
                    {`${(deepest.drawdown * 100).toFixed(1)}%`}
                  </Text>
                </>
              )}

              {/* Current marker */}
              {current && (
                <circle
                  cx={x(current.t)}
                  cy={y(current.drawdown)}
                  r={3}
                  fill="hsl(var(--data-neg))"
                  stroke="hsl(var(--foreground))"
                  strokeWidth={1}
                />
              )}
            </Group>
          </svg>
        );
      }}
    </ParentSize>
  );
}
