/**
 * Small pieces the census page shares: the symmetric-log axis helpers, a
 * multi-select for candle counts, and the presence glyphs (shape beside
 * colour, so no meaning rides on colour alone).
 */

import { OKABE } from "@/studies/kit";
import { symlog, symlogInverse, type Presence } from "@shared/studies/candlestick-pattern-census";

/** Compact count for an axis: 1.2k, 3.4M. */
export function compactCount(value: number): string {
  if (value >= 1e6) return `${Number((value / 1e6).toFixed(1))}M`;
  if (value >= 1e3) return `${Number((value / 1e3).toFixed(1))}k`;
  return String(Math.round(value));
}

/** Axis ticks for a symmetric-log count axis: 0, 1, 10, 100, ... up to the largest value. */
export function symlogTicks(maxValue: number): number[] {
  const ticks = [0];
  for (let power = 0; 10 ** power <= Math.max(maxValue, 1); power += 1) ticks.push(symlog(10 ** power));
  return ticks;
}

export function symlogTickLabel(transformed: number): string {
  return compactCount(Math.round(symlogInverse(transformed)));
}

export const PRESENCE_COLOR: Record<Presence, string> = {
  "clears the threshold": OKABE.orange,
  "fires, but below the threshold": OKABE.blue,
  "never fires": OKABE.grey,
};

export const PRESENCE_GLYPH: Record<Presence, string> = {
  "clears the threshold": "●",
  "fires, but below the threshold": "◐",
  "never fires": "○",
};

/** The one legend line for the three presence states. */
export function PresenceLegend() {
  return (
    <p className="text-[11px] text-neutral-400">
      {(Object.keys(PRESENCE_COLOR) as Presence[]).map((presence) => (
        <span key={presence} className="mr-3 whitespace-nowrap" style={{ color: PRESENCE_COLOR[presence] }}>
          {PRESENCE_GLYPH[presence]} {presence}
        </span>
      ))}
    </p>
  );
}

/** A category tick that leads with the presence glyph. */
export function GlyphTick(props: { x?: number; y?: number; payload?: { value: string }; presenceByName?: ReadonlyMap<string, Presence> }) {
  const { x = 0, y = 0, payload, presenceByName } = props;
  const name = payload?.value ?? "";
  const presence = presenceByName?.get(name) ?? "never fires";
  return (
    <text x={x} y={y} dy={3} textAnchor="end" fontSize={10} fill="#a3a3a3">
      <tspan fill={PRESENCE_COLOR[presence]}>{PRESENCE_GLYPH[presence]} </tspan>
      {name}
    </text>
  );
}

/** A toggle per value, at least one always on. */
export function MultiToggle({ label, values, selected, onChange, hint }: {
  label: string;
  values: readonly number[];
  selected: readonly number[];
  onChange: (next: number[]) => void;
  hint?: string;
}) {
  const toggle = (value: number) => {
    const next = selected.includes(value) ? selected.filter((entry) => entry !== value) : [...selected, value].sort((a, b) => a - b);
    if (next.length > 0) onChange(next);
  };
  return (
    <div className="flex flex-col gap-1" title={hint}>
      <span className="text-[10px] uppercase tracking-wider text-neutral-500">{label}</span>
      <div className="flex overflow-hidden rounded border border-neutral-700">
        {values.map((value) => {
          const on = selected.includes(value);
          return (
            <button
              key={value}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(value)}
              className={`px-2 py-1 font-mono text-[11px] ${on ? "bg-neutral-700 text-neutral-50" : "text-neutral-500 hover:bg-neutral-800"}`}
            >
              {on ? "■" : "□"} {value}
            </button>
          );
        })}
      </div>
    </div>
  );
}
