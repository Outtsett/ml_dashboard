/**
 * The marker shapes of the event strip and the dump scatter, as SVG. Colour is
 * never the only channel: every event kind and dump kind has its own shape, and
 * filled shapes carry a thin light outline so the black kind stays visible on
 * the dark page.
 */

import type { MarkerShape } from "@shared/studies/machine-health";

const OUTLINE = "#e5e5e5";

export function Marker({ shape, color, cx, cy, size = 5, opacity = 0.9 }: { shape: MarkerShape; color: string; cx: number; cy: number; size?: number; opacity?: number }) {
  const common = { fill: color, fillOpacity: opacity, stroke: OUTLINE, strokeWidth: 0.7, strokeOpacity: 0.8 };
  switch (shape) {
    case "square":
      return <rect x={cx - size} y={cy - size} width={size * 2} height={size * 2} {...common} />;
    case "triangleUp":
      return <polygon points={`${cx},${cy - size * 1.25} ${cx + size * 1.1},${cy + size * 0.9} ${cx - size * 1.1},${cy + size * 0.9}`} {...common} />;
    case "triangleDown":
      return <polygon points={`${cx},${cy + size * 1.25} ${cx + size * 1.1},${cy - size * 0.9} ${cx - size * 1.1},${cy - size * 0.9}`} {...common} />;
    case "triangleRight":
      return <polygon points={`${cx + size * 1.25},${cy} ${cx - size * 0.9},${cy + size * 1.1} ${cx - size * 0.9},${cy - size * 1.1}`} {...common} />;
    case "diamond":
      return <polygon points={`${cx},${cy - size * 1.35} ${cx + size * 1.1},${cy} ${cx},${cy + size * 1.35} ${cx - size * 1.1},${cy}`} {...common} />;
    case "cross":
      return (
        <g {...common}>
          <rect x={cx - size * 1.2} y={cy - size * 0.35} width={size * 2.4} height={size * 0.7} />
          <rect x={cx - size * 0.35} y={cy - size * 1.2} width={size * 0.7} height={size * 2.4} />
        </g>
      );
    case "stroke":
      return <rect x={cx - size * 1.3} y={cy - size * 0.3} width={size * 2.6} height={size * 0.6} {...common} />;
    case "ring":
      return <circle cx={cx} cy={cy} r={size} fill="none" stroke={color} strokeWidth={1.6} strokeOpacity={opacity} />;
    default:
      return <circle cx={cx} cy={cy} r={size} {...common} />;
  }
}

/** A marker on its own, for legends and chips. */
export function MarkerIcon({ shape, color, size = 5 }: { shape: MarkerShape; color: string; size?: number }) {
  const box = size * 3;
  return (
    <svg width={box} height={box} viewBox={`0 0 ${box} ${box}`} aria-hidden="true" className="shrink-0">
      <Marker shape={shape} color={color} cx={box / 2} cy={box / 2} size={size} />
    </svg>
  );
}

/** Dump kinds take the notebook's palette and shapes in order. */
export const DUMP_PALETTE = ["#0072B2", "#E69F00", "#56B4E9", "#D55E00", "#CC79A7", "#009E73", "#000000", "#999999"] as const;
export const DUMP_SHAPES: MarkerShape[] = ["circle", "square", "triangleUp", "diamond", "cross", "triangleDown", "triangleRight", "stroke"];
