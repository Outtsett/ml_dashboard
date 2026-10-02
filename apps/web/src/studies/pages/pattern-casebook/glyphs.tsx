/**
 * Glyphs: every colour on this page also carries a shape. Used as Recharts
 * custom scatter shapes, in hand-drawn SVG charts and in legends.
 */

export type GlyphName = "triangle-up" | "triangle-down" | "diamond" | "square" | "cross" | "wedge" | "circle" | "triangle-right";

/** The SVG path of a glyph centred on (x, y) with half-size r. */
export function glyphPath(name: GlyphName, x: number, y: number, r: number): string {
  switch (name) {
    case "triangle-up":
      return `M${x},${y - r} L${x + r},${y + r * 0.85} L${x - r},${y + r * 0.85} Z`;
    case "triangle-down":
      return `M${x},${y + r} L${x + r},${y - r * 0.85} L${x - r},${y - r * 0.85} Z`;
    case "triangle-right":
      return `M${x + r},${y} L${x - r * 0.85},${y + r} L${x - r * 0.85},${y - r} Z`;
    case "diamond":
      return `M${x},${y - r} L${x + r},${y} L${x},${y + r} L${x - r},${y} Z`;
    case "square":
      return `M${x - r * 0.8},${y - r * 0.8} h${r * 1.6} v${r * 1.6} h${-r * 1.6} Z`;
    case "cross": {
      const w = r * 0.35;
      return `M${x - w},${y - r} h${2 * w} v${r - w} h${r - w} v${2 * w} h${-(r - w)} v${r - w} h${-2 * w} v${-(r - w)} h${-(r - w)} v${-2 * w} h${r - w} Z`;
    }
    case "wedge":
      return `M${x},${y - r} L${x + r * 0.5},${y + r} L${x - r * 0.5},${y + r} Z`;
    case "circle":
    default:
      return `M${x - r},${y} a${r},${r} 0 1,0 ${2 * r},0 a${r},${r} 0 1,0 ${-2 * r},0`;
  }
}

export function Glyph({ name, colour, size = 10, filled = true }: { name: GlyphName; colour: string; size?: number; filled?: boolean }) {
  const half = size / 2;
  return (
    <svg width={size} height={size} className="inline-block shrink-0 align-[-1px]" aria-hidden="true">
      <path d={glyphPath(name, half, half, half * 0.9)} fill={filled ? colour : "none"} stroke={colour} strokeWidth={1} />
    </svg>
  );
}

/** A Recharts `shape` renderer for a scatter point drawn as `name`. */
export function glyphShape(name: GlyphName, colour: string, radius = 6) {
  return function Shape(props: unknown) {
    const { cx, cy } = props as { cx?: number; cy?: number };
    if (typeof cx !== "number" || typeof cy !== "number") return <g />;
    return <path d={glyphPath(name, cx, cy, radius)} fill={colour} stroke="#0a0a0a" strokeWidth={0.6} />;
  };
}
