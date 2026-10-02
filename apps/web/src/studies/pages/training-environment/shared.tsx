/**
 * What the page's sections share: the control defaults (kept in the URL), the
 * colour and marker assignments (Okabe-Ito, each series also carries its own
 * marker shape and dash so colour is never the only channel), and the query
 * hook that asks for one part of the study body.
 */

import type { useStudyControls } from "@/studies/kit";
import { OKABE, useStudyQuery } from "@/studies/kit";
import type { TrainingEnvironmentPart } from "@shared/studies/training-environment";

export const DEFAULT_CONTROLS = {
  run: "",
  live: "off",
  firstBar: -1,
  lastBar: -1,
  block: "",
  colourScale: "shared",
  statisticFeature: "",
  termIndex: 0,
  embeddingEpoch: 0,
  colourBy: "barrier outcome",
  layerEpoch: 0,
  activationLayer: "",
  streamPage: 1,
};
export type TrainingControls = typeof DEFAULT_CONTROLS;
export type SetControl = ReturnType<typeof useStudyControls<TrainingControls>>[1];

export const LIVE_OPTIONS = [
  { value: "off", label: "off" },
  { value: "5", label: "every 5 s" },
  { value: "10", label: "every 10 s" },
  { value: "30", label: "every 30 s" },
] as const;

export type Marker = "circle" | "triangle" | "diamond" | "square";

export interface SeriesStyle {
  colour: string;
  marker: Marker;
  dash: string;
}

/** Six series, told apart by colour, marker shape and dash together. */
export const SERIES_STYLES: readonly SeriesStyle[] = [
  { colour: OKABE.orange, marker: "circle", dash: "" },
  { colour: OKABE.blue, marker: "triangle", dash: "6 3" },
  { colour: OKABE.sky, marker: "diamond", dash: "2 3" },
  { colour: OKABE.purple, marker: "square", dash: "8 3 2 3" },
  { colour: OKABE.vermillion, marker: "circle", dash: "1 3" },
  { colour: OKABE.grey, marker: "triangle", dash: "10 4" },
];

/** A recharts `dot` renderer drawing this series' own marker shape. */
export function markerDot(style: SeriesStyle) {
  return function MarkerDot(props: { cx?: number; cy?: number; key?: string | number; index?: number }) {
    const { cx, cy } = props;
    // Recharts calls a function `dot` inside a list: the element needs the key it passes.
    const key = props.key ?? `dot-${props.index ?? cx}`;
    if (cx === undefined || cy === undefined || !Number.isFinite(cx) || !Number.isFinite(cy)) return <g key={key} />;
    const r = 3.5;
    const common = { fill: style.colour, stroke: "#0a0a0a", strokeWidth: 0.5 };
    switch (style.marker) {
      case "triangle":
        return <polygon key={key} points={`${cx},${cy - r - 0.5} ${cx - r - 0.5},${cy + r} ${cx + r + 0.5},${cy + r}`} {...common} />;
      case "diamond":
        return <polygon key={key} points={`${cx},${cy - r - 1} ${cx + r + 1},${cy} ${cx},${cy + r + 1} ${cx - r - 1},${cy}`} {...common} />;
      case "square":
        return <rect key={key} x={cx - r} y={cy - r} width={2 * r} height={2 * r} {...common} />;
      default:
        return <circle key={key} cx={cx} cy={cy} r={r} {...common} />;
    }
  };
}

/** One part of the study body for the chosen run, refreshed on the live interval when one is set. */
export function usePart<T>(part: TrainingEnvironmentPart, controls: TrainingControls, extra: Record<string, string | number | undefined> = {}) {
  const seconds = Number(controls.live);
  return useStudyQuery<T>(
    "training-environment",
    { part, run: controls.run, ...extra },
    { refetchIntervalMs: Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined },
  );
}

export function clampInt(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, Math.round(value)));
}
