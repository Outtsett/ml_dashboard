/**
 * SlicePlot — small-multiples 1D scatter, one mini-chart per numeric param.
 *
 * Each mini-chart plots (param value, objective score) for every completed
 * trial — making it easy to spot a hyperparameter that the optimizer has
 * already pinned down (vertical streak) vs. one that's still being explored
 * (horizontal cloud).
 *
 * The chart grid auto-flows: ~3 columns on wide layouts, 2 on medium, 1 on
 * narrow. Each mini-chart is fixed at 120px tall for visual rhythm.
 */

import { useMemo } from "react";
import { ParentSize } from "@visx/responsive";
import { Group } from "@visx/group";
import { scaleLinear } from "@visx/scale";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { Text } from "@visx/text";
import {
  numericParamNames,
  getParamValue,
  type HpoTrial,
} from "@/training/lib/useHpoTrials";

interface SlicePlotProps {
  trials: HpoTrial[];
  /** Restrict the params shown. Default — show every numeric param. */
  params?: string[];
  objective?: "max" | "min";
  /** Fixed per-cell height. Default 120. */
  cellHeight?: number;
}

const MARGIN = { top: 18, right: 8, bottom: 22, left: 32 };

export function SlicePlot({
  trials,
  params,
  objective = "max",
  cellHeight = 120,
}: SlicePlotProps) {
  const allParams = useMemo(() => numericParamNames(trials), [trials]);
  const visibleParams = params && params.length > 0 ? params : allParams;

  // Pre-compute completed-trial-with-score subset for color scaling.
  const completed = useMemo(
    () => trials.filter((t) => t.score != null && Number.isFinite(t.score)),
    [trials],
  );

  const scoreRange = useMemo(() => {
    if (completed.length === 0) return null;
    let lo = Infinity;
    let hi = -Infinity;
    for (const t of completed) {
      const s = t.score!;
      if (s < lo) lo = s;
      if (s > hi) hi = s;
    }
    if (lo === hi) return { lo: lo - 1, hi: hi + 1 };
    return { lo, hi };
  }, [completed]);

  if (visibleParams.length === 0 || !scoreRange) {
    return (
      <div className="flex items-center justify-center rounded-md border border-dashed border-white/10 bg-white/[0.02] p-6 text-[11px] text-muted-foreground">
        Need at least one completed trial with numeric params.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
      {visibleParams.map((p) => (
        <ParentSize
          key={p}
          parentSizeStyles={{ width: "100%", height: cellHeight }}
        >
          {({ width }) =>
            width > 60 ? (
              <SliceMini
                width={width}
                height={cellHeight}
                param={p}
                trials={completed}
                scoreRange={scoreRange}
                objective={objective}
              />
            ) : null
          }
        </ParentSize>
      ))}
    </div>
  );
}

interface SliceMiniProps {
  width: number;
  height: number;
  param: string;
  trials: HpoTrial[];
  scoreRange: { lo: number; hi: number };
  objective: "max" | "min";
}

function SliceMini({
  width,
  height,
  param,
  trials,
  scoreRange,
  objective,
}: SliceMiniProps) {
  const innerW = width - MARGIN.left - MARGIN.right;
  const innerH = height - MARGIN.top - MARGIN.bottom;

  const dots = useMemo(() => {
    const out: { trialId: number; x: number; score: number }[] = [];
    for (const t of trials) {
      const v = getParamValue(t, param);
      if (v == null || t.score == null) continue;
      out.push({ trialId: t.trialId, x: v, score: t.score });
    }
    return out;
  }, [trials, param]);

  if (dots.length === 0) {
    return (
      <svg width={width} height={height}>
        <Text
          x={width / 2}
          y={height / 2}
          fontSize={10}
          fill="hsl(var(--muted-foreground))"
          textAnchor="middle"
          fontFamily="var(--font-mono)"
        >
          {`${param} · no values`}
        </Text>
      </svg>
    );
  }

  const xVals = dots.map((d) => d.x);
  let xLo = Math.min(...xVals);
  let xHi = Math.max(...xVals);
  if (xLo === xHi) {
    xLo -= 1;
    xHi += 1;
  }
  const xScale = scaleLinear<number>({ domain: [xLo, xHi], range: [0, innerW], nice: true });
  const yScale = scaleLinear<number>({
    domain: [scoreRange.lo, scoreRange.hi],
    range: [innerH, 0],
    nice: true,
  });
  const colorScale = scaleLinear<number>({
    domain: [scoreRange.lo, scoreRange.hi],
    range: objective === "max" ? [0, 1] : [1, 0],
  });

  return (
    <svg width={width} height={height} role="img" aria-label={`slice-${param}`}>
      <Group left={MARGIN.left} top={MARGIN.top}>
        <Text
          x={0}
          y={-6}
          fontSize={10}
          fontWeight={600}
          fill="hsl(var(--foreground))"
          fontFamily="var(--font-mono)"
        >
          {param}
        </Text>
        <AxisBottom
          scale={xScale}
          top={innerH}
          numTicks={3}
          stroke="hsl(var(--border))"
          tickStroke="hsl(var(--border))"
          tickLabelProps={{
            fontSize: 8,
            fill: "hsl(var(--muted-foreground))",
            fontFamily: "var(--font-mono)",
            textAnchor: "middle",
            dy: "0.25em",
          }}
        />
        <AxisLeft
          scale={yScale}
          numTicks={3}
          stroke="hsl(var(--border))"
          tickStroke="hsl(var(--border))"
          tickLabelProps={{
            fontSize: 8,
            fill: "hsl(var(--muted-foreground))",
            fontFamily: "var(--font-mono)",
            textAnchor: "end",
            dx: -4,
          }}
        />
        {dots.map((d) => {
          const u = colorScale(d.score);
          return (
            <circle
              key={d.trialId}
              cx={xScale(d.x)}
              cy={yScale(d.score)}
              r={2}
              fill={uToColor(u)}
              fillOpacity={0.85}
            />
          );
        })}
      </Group>
    </svg>
  );
}

function uToColor(u: number): string {
  if (u <= 0.25) return "hsl(var(--data-seq-start))";
  if (u <= 0.6) return "hsl(var(--data-seq-mid))";
  return "hsl(var(--data-seq-end))";
}
