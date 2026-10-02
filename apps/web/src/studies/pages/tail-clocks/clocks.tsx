/**
 * How each clock is drawn. Colour is never the only carrier: the calendar is a
 * filled circle on a solid line, volume a hollow square on a dashed line,
 * dollar a hollow triangle on a dotted line (Okabe-Ito blue, orange, bluish-green).
 */

import { OKABE } from "@/studies/kit";
import type { ClockName } from "@shared/studies/tail-clocks";

export interface ClockStyle {
  label: string;
  color: string;
  dash: string | undefined;
  filled: boolean;
  shape: "circle" | "square" | "triangle";
  glyph: string;
  /** What one bar of this clock is. */
  rule: string;
}

export const CLOCK_STYLE: Record<ClockName, ClockStyle> = {
  time: { label: "time bars", color: OKABE.blue, dash: undefined, filled: true, shape: "circle", glyph: "●", rule: "every N minutes of the calendar" },
  volume: { label: "volume bars", color: OKABE.orange, dash: "6 3", filled: false, shape: "square", glyph: "□", rule: "every N contracts traded" },
  dollar: { label: "dollar bars", color: OKABE.green, dash: "2 3", filled: false, shape: "triangle", glyph: "△", rule: "every N dollars traded" },
};

/** The bell-curve reference, drawn in neutral grey with a dotted line. */
export const NEUTRAL = "#8a8a8a";

/** One marker, centred on (x, y): the shape and fill of the clock. */
export function ClockMarker({ x, y, clock, size = 4 }: { x: number; y: number; clock: ClockName; size?: number }) {
  const style = CLOCK_STYLE[clock];
  const fill = style.filled ? style.color : "none";
  const common = { fill, stroke: style.color, strokeWidth: 1.4 } as const;
  if (style.shape === "square") return <rect x={x - size} y={y - size} width={size * 2} height={size * 2} {...common} />;
  if (style.shape === "triangle") {
    return <polygon points={`${x},${y - size - 1} ${x - size - 1},${y + size} ${x + size + 1},${y + size}`} {...common} />;
  }
  return <circle cx={x} cy={y} r={size} {...common} />;
}

/** A legend entry: the marker, the line dash, the name. */
export function ClockKey({ clock, suffix }: { clock: ClockName; suffix?: string }) {
  const style = CLOCK_STYLE[clock];
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-neutral-300">
      <svg width="34" height="12" aria-hidden="true">
        <line x1="0" x2="26" y1="6" y2="6" stroke={style.color} strokeWidth="1.6" strokeDasharray={style.dash} />
        <ClockMarker x={17} y={6} clock={clock} size={3.5} />
      </svg>
      {style.label}
      {suffix && <span className="font-mono text-neutral-400">{suffix}</span>}
    </span>
  );
}
