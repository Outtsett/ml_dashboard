/**
 * Point markers for line charts: a shape per series class, so a line is never
 * told apart by colour alone.
 */

import type { ReactElement } from "react";

export type MarkShape = "circle" | "square" | "diamond" | "triangle";

interface DotProps {
  cx?: number;
  cy?: number;
  index?: number;
}

export function markDot(shape: MarkShape, color: string, size = 4) {
  return function Mark({ cx, cy, index }: DotProps): ReactElement<SVGElement> {
    if (cx === undefined || cy === undefined || Number.isNaN(cx) || Number.isNaN(cy)) return <g key={index} />;
    if (shape === "square") return <rect key={index} x={cx - size} y={cy - size} width={size * 2} height={size * 2} fill={color} />;
    if (shape === "diamond") return <polygon key={index} points={`${cx},${cy - size * 1.3} ${cx + size * 1.3},${cy} ${cx},${cy + size * 1.3} ${cx - size * 1.3},${cy}`} fill={color} />;
    if (shape === "triangle") return <polygon key={index} points={`${cx},${cy - size * 1.2} ${cx + size * 1.2},${cy + size} ${cx - size * 1.2},${cy + size}`} fill={color} />;
    return <circle key={index} cx={cx} cy={cy} r={size} fill={color} />;
  };
}
