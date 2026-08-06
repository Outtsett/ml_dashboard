/**
 * BestSoFarLine — running-best objective over wall-clock (or trial index).
 *
 * Reveals at a glance whether the sampler is still improving or has plateaued.
 * Renders a step-line via visx. X axis = trial index (more stable than
 * wall-clock when trials parallelize); Y axis = best-so-far score.
 */

import { useMemo } from "react";
import { ParentSize } from "@visx/responsive";
import { Group } from "@visx/group";
import { scaleLinear } from "@visx/scale";
import { LinePath, Line } from "@visx/shape";
import { AxisLeft, AxisBottom } from "@visx/axis";
import { Text } from "@visx/text";
import { curveStepAfter } from "d3-shape";
import type { HpoTrial } from "@/training/lib/useHpoTrials";

interface BestSoFarLineProps {
  trials: HpoTrial[];
  objective?: "max" | "min";
  height?: number;
}

const MARGIN = { top: 12, right: 12, bottom: 24, left: 40 };

export function BestSoFarLine({
  trials,
  objective = "max",
  height = 180,
}: BestSoFarLineProps) {
  const series = useMemo(() => {
    const completed = trials
      .filter((t) => t.status === "completed" && t.score != null && Number.isFinite(t.score))
      .sort((a, b) => a.trialId - b.trialId);
    let best: number | null = null;
    const out: { trialId: number; best: number; score: number }[] = [];
    for (const t of completed) {
      const s = t.score!;
      if (best == null) best = s;
      else if (objective === "max") best = Math.max(best, s);
      else best = Math.min(best, s);
      out.push({ trialId: t.trialId, best, score: s });
    }
    return out;
  }, [trials, objective]);

  if (series.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-md border border-dashed border-white/10 bg-white/[0.02] text-[11px] text-muted-foreground"
        style={{ height }}
      >
        No completed trials yet.
      </div>
    );
  }

  return (
    <ParentSize parentSizeStyles={{ width: "100%", height }}>
      {({ width }) => {
        if (width < 100) return null;
        const innerW = width - MARGIN.left - MARGIN.right;
        const innerH = height - MARGIN.top - MARGIN.bottom;

        const x = scaleLinear<number>({
          domain: [series[0]!.trialId, series[series.length - 1]!.trialId],
          range: [0, innerW],
        });

        const bestVals = series.map((s) => s.best);
        const scoreVals = series.map((s) => s.score);
        let yLo = Math.min(...bestVals, ...scoreVals);
        let yHi = Math.max(...bestVals, ...scoreVals);
        if (yLo === yHi) {
          yLo -= 1;
          yHi += 1;
        } else {
          const pad = (yHi - yLo) * 0.08;
          yLo -= pad;
          yHi += pad;
        }
        const y = scaleLinear<number>({ domain: [yLo, yHi], range: [innerH, 0], nice: true });

        const finalBest = series[series.length - 1]!.best;

        return (
          <svg width={width} height={height} role="img" aria-label="best-so-far">
            <Group left={MARGIN.left} top={MARGIN.top}>
              {/* Axes */}
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

              {/* Individual trial scores as dots (background) */}
              {series.map((s) => (
                <circle
                  key={s.trialId}
                  cx={x(s.trialId)}
                  cy={y(s.score)}
                  r={2}
                  fill="hsl(var(--data-neutral) / 0.5)"
                />
              ))}

              {/* Best-so-far step line */}
              <LinePath<{ trialId: number; best: number }>
                data={series}
                x={(d) => x(d.trialId)}
                y={(d) => y(d.best)}
                stroke="hsl(var(--data-pos))"
                strokeWidth={1.75}
                fill="none"
                curve={curveStepAfter}
              />

              {/* Annotation: final best */}
              <Line
                from={{ x: 0, y: y(finalBest) }}
                to={{ x: innerW, y: y(finalBest) }}
                stroke="hsl(var(--data-pos) / 0.2)"
                strokeDasharray="2 3"
              />
              <Text
                x={innerW}
                y={y(finalBest) - 4}
                fontSize={10}
                fill="hsl(var(--data-pos))"
                fontFamily="var(--font-mono)"
                textAnchor="end"
              >
                {finalBest.toFixed(4)}
              </Text>
            </Group>
          </svg>
        );
      }}
    </ParentSize>
  );
}

