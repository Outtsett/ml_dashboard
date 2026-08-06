/**
 * ContourPlot — 2D scatter of trials over two hyperparameters, colored by
 * objective score.
 *
 * Optuna's `optuna.visualization.plot_contour` interpolates a smooth surface;
 * with sparse trial data (a few hundred points) a colored scatter conveys the
 * same shape at a fraction of the implementation cost. Each dot is a trial;
 * dot color = score (sequential cool→warm), dot size scales with score
 * percentile to draw the eye to the better trials.
 *
 * Users pick the X and Y param from dropdowns supplied externally — this
 * component just renders whichever pair is selected.
 */

import { useMemo } from "react";
import { ParentSize } from "@visx/responsive";
import { Group } from "@visx/group";
import { scaleLinear } from "@visx/scale";
import { AxisLeft, AxisBottom } from "@visx/axis";
import { Text } from "@visx/text";
import { getParamValue, type HpoTrial } from "@/training/lib/useHpoTrials";

interface ContourPlotProps {
  trials: HpoTrial[];
  xParam: string;
  yParam: string;
  objective?: "max" | "min";
  height?: number;
}

const MARGIN = { top: 12, right: 12, bottom: 28, left: 44 };

export function ContourPlot({
  trials,
  xParam,
  yParam,
  objective = "max",
  height = 280,
}: ContourPlotProps) {
  const points = useMemo(() => {
    const out: { trialId: number; x: number; y: number; score: number }[] = [];
    for (const t of trials) {
      if (t.score == null || !Number.isFinite(t.score)) continue;
      const x = getParamValue(t, xParam);
      const y = getParamValue(t, yParam);
      if (x == null || y == null) continue;
      out.push({ trialId: t.trialId, x, y, score: t.score });
    }
    return out;
  }, [trials, xParam, yParam]);

  if (points.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-md border border-dashed border-white/10 bg-white/[0.02] text-[11px] text-muted-foreground"
        style={{ height }}
      >
        No completed trials for both axes yet.
      </div>
    );
  }

  return (
    <ParentSize parentSizeStyles={{ width: "100%", height }}>
      {({ width }) => {
        if (width < 100) return null;
        const innerW = width - MARGIN.left - MARGIN.right;
        const innerH = height - MARGIN.top - MARGIN.bottom;

        const xVals = points.map((p) => p.x);
        const yVals = points.map((p) => p.y);
        const sVals = points.map((p) => p.score);

        const xLo = Math.min(...xVals);
        const xHi = Math.max(...xVals);
        const yLo = Math.min(...yVals);
        const yHi = Math.max(...yVals);
        const sLo = Math.min(...sVals);
        const sHi = Math.max(...sVals);

        const xScale = scaleLinear<number>({
          domain: xLo === xHi ? [xLo - 1, xLo + 1] : [xLo, xHi],
          range: [0, innerW],
          nice: true,
        });
        const yScale = scaleLinear<number>({
          domain: yLo === yHi ? [yLo - 1, yLo + 1] : [yLo, yHi],
          range: [innerH, 0],
          nice: true,
        });
        const scoreScale = scaleLinear<number>({
          domain: sLo === sHi ? [sLo - 1, sLo + 1] : [sLo, sHi],
          range: objective === "max" ? [0, 1] : [1, 0],
        });

        return (
          <svg width={width} height={height} role="img" aria-label={`contour-${xParam}-${yParam}`}>
            <Group left={MARGIN.left} top={MARGIN.top}>
              <AxisBottom
                scale={xScale}
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
                label={xParam}
                labelProps={{
                  fontSize: 10,
                  fill: "hsl(var(--muted-foreground))",
                  fontFamily: "var(--font-mono)",
                  textAnchor: "middle",
                  dy: 14,
                }}
                labelOffset={4}
              />
              <AxisLeft
                scale={yScale}
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
              <g transform={`rotate(-90, ${-32}, ${innerH / 2})`}>
                <Text
                  x={-32}
                  y={innerH / 2}
                  fontSize={10}
                  fill="hsl(var(--muted-foreground))"
                  fontFamily="var(--font-mono)"
                  textAnchor="middle"
                >
                  {yParam}
                </Text>
              </g>

              {/* Trial dots — sorted so warmest renders last and stays on top */}
              {points
                .slice()
                .sort((a, b) => scoreScale(a.score) - scoreScale(b.score))
                .map((p) => {
                  const u = scoreScale(p.score);
                  return (
                    <circle
                      key={p.trialId}
                      cx={xScale(p.x)}
                      cy={yScale(p.y)}
                      r={2 + u * 3}
                      fill={scoreToColor(u)}
                      fillOpacity={0.85}
                      stroke="hsl(var(--background))"
                      strokeWidth={0.4}
                    />
                  );
                })}
            </Group>
          </svg>
        );
      }}
    </ParentSize>
  );
}

function scoreToColor(u: number): string {
  if (u <= 0.25) return "hsl(var(--data-seq-start))";
  if (u <= 0.6) return "hsl(var(--data-seq-mid))";
  return "hsl(var(--data-seq-end))";
}
