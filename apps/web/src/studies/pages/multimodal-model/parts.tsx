/**
 * Small pieces the tabs share: the gate chips, head labels with their
 * direction colour and mark, the cividis scale, a sortable column header.
 * Colours are Okabe-Ito; each one also carries a mark or a word (long is
 * orange and a filled mark, short is blue and an open mark; "meets" is orange
 * with a tick, "misses" is blue with a cross).
 */

import type { ReactNode } from "react";
import { GATE_DEFINITIONS, GATE_KEYS, type GateFlags } from "@shared/studies/multimodal-model";
import { OKABE } from "@/studies/kit";

export function GateChips({ gate }: { gate: GateFlags }) {
  return (
    <span className="inline-flex gap-0.5">
      {GATE_KEYS.map((key) => {
        const known = key in gate;
        const passes = Boolean(gate[key]);
        return (
          <span
            key={key}
            title={`${key} ${GATE_DEFINITIONS[key].name}: ${known ? (passes ? "met" : "missed") : "not scored"} (${GATE_DEFINITIONS[key].threshold})`}
            className="rounded px-1 font-mono text-[10px]"
            style={
              !known
                ? { border: "1px solid #555", color: "#888" }
                : passes
                  ? { background: OKABE.orange, color: "#111" }
                  : { border: `1px solid ${OKABE.blue}`, color: OKABE.sky }
            }
          >
            {key}
            {known ? (passes ? "✓" : "✗") : "?"}
          </span>
        );
      })}
    </span>
  );
}

export const HEADS = ["long_r2", "short_r2", "long_r3", "short_r3"] as const;
export type Head = (typeof HEADS)[number];

export const HEAD_STYLE: Record<Head, { label: string; color: string; glyph: string; dash: string | undefined }> = {
  long_r2: { label: "long 2:1", color: OKABE.orange, glyph: "▲", dash: undefined },
  long_r3: { label: "long 3:1", color: OKABE.yellow, glyph: "△", dash: "5 3" },
  short_r2: { label: "short 2:1", color: OKABE.blue, glyph: "▼", dash: undefined },
  short_r3: { label: "short 3:1", color: OKABE.sky, glyph: "▽", dash: "5 3" },
};

export function headLabel(head: string): string {
  return HEAD_STYLE[head as Head]?.label ?? head;
}

export function headStyle(head: string) {
  return HEAD_STYLE[head as Head] ?? { label: head, color: OKABE.grey, glyph: "●", dash: undefined };
}

// cividis, sampled every tenth (matplotlib): the scale is perceptually even and safe under colour-vision deficiency.
const CIVIDIS = ["#00224e", "#123570", "#3b496c", "#575d6d", "#707173", "#8a8678", "#a59c74", "#c3b369", "#e1cc55", "#fee838"];

function channels(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

/** Cividis colour for a fraction of the scale, and the text colour that reads on it. */
export function cividis(fraction: number): { background: string; text: string } {
  const t = Math.min(1, Math.max(0, fraction));
  const position = t * (CIVIDIS.length - 1);
  const lower = Math.floor(position);
  const upper = Math.min(CIVIDIS.length - 1, lower + 1);
  const a = channels(CIVIDIS[lower] as string);
  const b = channels(CIVIDIS[upper] as string);
  const mixed = a.map((value, index) => Math.round(value + ((b[index] as number) - value) * (position - lower))) as [number, number, number];
  const luminance = (0.299 * mixed[0] + 0.587 * mixed[1] + 0.114 * mixed[2]) / 255;
  return { background: `rgb(${mixed[0]},${mixed[1]},${mixed[2]})`, text: luminance > 0.55 ? "#111" : "#f5f5f5" };
}

export function SortHeader({ label, active, descending, onClick, align = "right", hint }: { label: ReactNode; active: boolean; descending: boolean; onClick: () => void; align?: "left" | "right"; hint?: string }) {
  return (
    <th className={`py-1 font-normal ${align === "right" ? "text-right" : "text-left"}`} title={hint}>
      <button type="button" onClick={onClick} className={`hover:text-neutral-200 ${active ? "text-neutral-100" : "text-neutral-500"}`}>
        {label}
        {active ? (descending ? " ↓" : " ↑") : ""}
      </button>
    </th>
  );
}

/** A number with a direction mark, so the colour is never the only signal. */
export function Signed({ value, text }: { value: number | null; text: string }) {
  if (value === null || !Number.isFinite(value)) return <span className="text-neutral-500">—</span>;
  const up = value > 0;
  return (
    <span style={{ color: value === 0 ? OKABE.grey : up ? OKABE.orange : OKABE.sky }}>
      {value === 0 ? "" : up ? "▲ " : "▼ "}
      {text}
    </span>
  );
}
