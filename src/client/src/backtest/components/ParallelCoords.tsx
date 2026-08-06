/**
 * ParallelCoords — visx-rendered parallel coordinates plot.
 *
 * Each axis is one numeric hyperparameter; each polyline is one trial. Lines
 * are colored by objective score (sequential blue→teal). Pruned / killed
 * trials render in muted gray. Hover any line for trial id + score.
 *
 * Optional brush filtering can be added later — keeping the v1 surface lean.
 */

import { useMemo, useState } from "react";
import { ParentSize } from "@visx/responsive";
import { Group } from "@visx/group";
import { scaleLinear } from "@visx/scale";
import { AxisLeft } from "@visx/axis";
import { LinePath } from "@visx/shape";
import { Text } from "@visx/text";
import {
  numericParamNames,
  getParamValue,
  type HpoTrial,
} from "@/training/lib/useHpoTrials";

interface ParallelCoordsProps {
  trials: HpoTrial[];
  /** Objective sense — `max` colors higher scores warmer; `min` colors lower scores warmer. */
  objective?: "max" | "min";
  height?: number;
}

const MARGIN = { top: 16, right: 24, bottom: 24, left: 24 };

export function ParallelCoords({
  trials,
  objective = "max",
  height = 300,
}: ParallelCoordsProps) {
  const [hoveredTrialId, setHoveredTrialId] = useState<number | null>(null);

  const params = useMemo(() => numericParamNames(trials), [trials]);

  if (trials.length === 0 || params.length < 2) {
    return (
      <div
        className="flex items-center justify-center rounded-md border border-dashed border-white/10 bg-white/[0.02] text-[11px] text-muted-foreground"
        style={{ height }}
      >
        {trials.length === 0
          ? "Waiting for first trial…"
          : "Need at least two numeric hyperparameters for parallel coords."}
      </div>
    );
  }

  return (
    <ParentSize parentSizeStyles={{ width: "100%", height }}>
      {({ width }) => {
        if (width < 100) return null;
        return (
          <Plot
            width={width}
            height={height}
            trials={trials}
            params={params}
            objective={objective}
            hoveredTrialId={hoveredTrialId}
            setHoveredTrialId={setHoveredTrialId}
          />
        );
      }}
    </ParentSize>
  );
}

interface PlotProps {
  width: number;
  height: number;
  trials: HpoTrial[];
  params: string[];
  objective: "max" | "min";
  hoveredTrialId: number | null;
  setHoveredTrialId: (id: number | null) => void;
}

function Plot({
  width,
  height,
  trials,
  params,
  objective,
  hoveredTrialId,
  setHoveredTrialId,
}: PlotProps) {
  const innerW = width - MARGIN.left - MARGIN.right;
  const innerH = height - MARGIN.top - MARGIN.bottom;

  // Per-param y-scale: domain is the observed range across all trials.
  const yScales = useMemo(() => {
    const map = new Map<string, ReturnType<typeof scaleLinear<number>>>();
    for (const p of params) {
      let lo = Infinity;
      let hi = -Infinity;
      for (const t of trials) {
        const v = getParamValue(t, p);
        if (v == null) continue;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
        lo = 0;
        hi = 1;
      } else if (lo === hi) {
        // Degenerate domain — give it a small range so the scale doesn't collapse.
        lo = lo - 1;
        hi = hi + 1;
      }
      map.set(
        p,
        scaleLinear<number>({ domain: [lo, hi], range: [innerH, 0], nice: true }),
      );
    }
    return map;
  }, [params, trials, innerH]);

  // Score scale → 0..1 used to pick a color from sequential gradient.
  const scoreScale = useMemo(() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const t of trials) {
      if (t.score == null || !Number.isFinite(t.score)) continue;
      if (t.score < lo) lo = t.score;
      if (t.score > hi) hi = t.score;
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
    if (lo === hi) {
      lo = lo - 1;
      hi = hi + 1;
    }
    // Higher = warmer when objective is `max`, inverted otherwise.
    return objective === "max"
      ? scaleLinear<number>({ domain: [lo, hi], range: [0, 1] })
      : scaleLinear<number>({ domain: [lo, hi], range: [1, 0] });
  }, [trials, objective]);

  const xPos = (i: number) =>
    params.length === 1 ? innerW / 2 : (i * innerW) / (params.length - 1);

  return (
    <svg width={width} height={height} role="img" aria-label="parallel-coordinates">
      <Group left={MARGIN.left} top={MARGIN.top}>
        {/* Trial polylines (background trials first; hovered last) */}
        {trials
          .slice()
          .sort((a, b) =>
            a.trialId === hoveredTrialId ? 1 : b.trialId === hoveredTrialId ? -1 : 0,
          )
          .map((t) => {
            const points: { x: number; y: number }[] = [];
            for (let i = 0; i < params.length; i += 1) {
              const v = getParamValue(t, params[i]!);
              if (v == null) continue;
              const yScale = yScales.get(params[i]!)!;
              points.push({ x: xPos(i), y: yScale(v) });
            }
            if (points.length < 2) return null;
            const color = trialColor(t, scoreScale);
            const isHovered = t.trialId === hoveredTrialId;
            return (
              <LinePath
                key={t.trialId}
                data={points}
                x={(d) => d.x}
                y={(d) => d.y}
                stroke={color}
                strokeOpacity={
                  hoveredTrialId == null ? 0.5 : isHovered ? 1 : 0.15
                }
                strokeWidth={isHovered ? 2 : 1}
                fill="none"
                onMouseEnter={() => setHoveredTrialId(t.trialId)}
                onMouseLeave={() => setHoveredTrialId(null)}
                style={{ cursor: "pointer" }}
              />
            );
          })}

        {/* Axes */}
        {params.map((p, i) => {
          const x = xPos(i);
          const yScale = yScales.get(p)!;
          return (
            <Group key={p} left={x}>
              <line
                x1={0}
                x2={0}
                y1={0}
                y2={innerH}
                stroke="hsl(var(--border))"
                strokeWidth={1}
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
              <Text
                x={0}
                y={-6}
                fontSize={10}
                fontWeight={600}
                fill="hsl(var(--foreground))"
                textAnchor="middle"
                fontFamily="var(--font-mono)"
              >
                {p}
              </Text>
            </Group>
          );
        })}

        {/* Hover tooltip */}
        {hoveredTrialId != null && (() => {
          const t = trials.find((tr) => tr.trialId === hoveredTrialId);
          if (!t) return null;
          return (
            <Group left={innerW - 100} top={4}>
              <rect
                width={100}
                height={28}
                rx={4}
                fill="hsl(var(--popover))"
                stroke="hsl(var(--border))"
              />
              <Text
                x={6}
                y={12}
                fontSize={10}
                fill="hsl(var(--foreground))"
                fontFamily="var(--font-mono)"
              >
                {`#${t.trialId} · ${t.status}`}
              </Text>
              <Text
                x={6}
                y={24}
                fontSize={10}
                fill="hsl(var(--muted-foreground))"
                fontFamily="var(--font-mono)"
              >
                {`score: ${t.score?.toFixed(4) ?? "—"}`}
              </Text>
            </Group>
          );
        })()}
      </Group>
    </svg>
  );
}

function trialColor(
  t: HpoTrial,
  scoreScale: ReturnType<typeof scaleLinear<number>> | null,
): string {
  if (t.status === "pruned" || t.status === "killed") {
    return "hsl(var(--data-neutral) / 0.4)";
  }
  if (t.status === "running") {
    return "hsl(var(--primary))";
  }
  if (t.status === "failed") {
    return "hsl(var(--data-neg) / 0.4)";
  }
  if (t.score == null || !scoreScale) return "hsl(var(--data-neutral))";
  const u = scoreScale(t.score);
  // Sequential cool → warm: interpolate var(--data-seq-start) → end via mid.
  if (u <= 0.5) {
    return `hsl(var(--data-seq-start))`;
  }
  if (u <= 0.8) {
    return `hsl(var(--data-seq-mid))`;
  }
  return `hsl(var(--data-seq-end))`;
}
