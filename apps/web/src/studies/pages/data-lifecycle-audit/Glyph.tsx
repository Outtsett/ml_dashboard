/** The severity marks: one SVG element per shape, used in the map, the priority chart, chips and tables. */

import type { MarkShape } from "./style";
import { severityStyle } from "./style";

export function MarkShapeElement({ shape, cx, cy, radius, fill, stroke, strokeWidth = 0 }: {
  shape: MarkShape; cx: number; cy: number; radius: number; fill: string; stroke?: string; strokeWidth?: number;
}) {
  const common = { fill, stroke, strokeWidth };
  if (shape === "circle") return <circle cx={cx} cy={cy} r={radius} {...common} />;
  if (shape === "square") return <rect x={cx - radius * 0.88} y={cy - radius * 0.88} width={radius * 1.76} height={radius * 1.76} {...common} />;
  if (shape === "diamond") return <polygon points={`${cx},${cy - radius * 1.1} ${cx + radius * 1.1},${cy} ${cx},${cy + radius * 1.1} ${cx - radius * 1.1},${cy}`} {...common} />;
  return <polygon points={`${cx},${cy - radius} ${cx + radius * 1.05},${cy + radius * 0.85} ${cx - radius * 1.05},${cy + radius * 0.85}`} {...common} />;
}

/** A severity mark at `size` pixels with an optional label (a count) inside it. */
export function Glyph({ severity, size = 14, label }: { severity: string; size?: number; label?: string | number }) {
  const style = severityStyle(severity);
  const half = size / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={severity} className="shrink-0">
      <MarkShapeElement shape={style.shape} cx={half} cy={half} radius={half * 0.9} fill={style.colour} />
      {label !== undefined && (
        <text x={half} y={half} textAnchor="middle" dominantBaseline="central" fontSize={Math.max(9, size * 0.36)} fontWeight={600} fill={style.ink} className="font-mono">
          {label}
        </text>
      )}
    </svg>
  );
}
