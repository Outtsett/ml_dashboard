/**
 * Pieces the TrendState calibration page shares between its tabs: rung colours
 * and glyphs, a plain data table, a pass/fail gate chip and a width hook.
 */

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { OKABE, fmt, fmtInt } from "@/studies/kit";

/** The notebook's rung palette (Okabe-Ito), each paired with a glyph and a dash so colour is never the only cue. */
const RUNG_STYLE = [
  { color: OKABE.blue, glyph: "●", dash: "0" },
  { color: OKABE.orange, glyph: "▲", dash: "6 2" },
  { color: OKABE.green, glyph: "■", dash: "2 2" },
  { color: OKABE.purple, glyph: "◆", dash: "8 3 2 3" },
  { color: OKABE.vermillion, glyph: "✚", dash: "1 3" },
] as const;

export function rungStyle(index: number) {
  return RUNG_STYLE[((index % RUNG_STYLE.length) + RUNG_STYLE.length) % RUNG_STYLE.length] as (typeof RUNG_STYLE)[number];
}

export const SESSION_LABEL: Record<string, string> = {
  first_thirty_minutes: "first thirty minutes",
  regular_trading_hours: "regular trading hours",
  overnight: "overnight",
};

/** Numbers in a table: integers as integers, small magnitudes in exponent form. */
export function cell(value: unknown, decimals = 3): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "—";
    if (Number.isInteger(value) && Math.abs(value) >= 1) return fmtInt(value);
    if (value !== 0 && Math.abs(value) < 1e-3) return value.toExponential(2);
    return fmt(value, decimals);
  }
  return String(value);
}

export interface Column<Row> {
  key: string;
  label: string;
  render?: (row: Row) => ReactNode;
  align?: "left" | "right";
}

/** A dense table with a sticky header; `maxHeight` scrolls long tables inside their section. */
export function DataTable<Row extends Record<string, unknown>>({
  rows, columns, maxHeight, rowKey,
}: {
  rows: readonly Row[];
  columns: ReadonlyArray<Column<Row>>;
  maxHeight?: number;
  rowKey?: (row: Row, index: number) => string;
}) {
  if (rows.length === 0) return <p className="py-2 text-[11px] text-neutral-500">No rows.</p>;
  return (
    <div className="min-w-0 overflow-auto rounded border border-neutral-800" style={maxHeight ? { maxHeight } : undefined}>
      <table className="w-full text-[11px] font-mono tnum">
        <thead className="sticky top-0 bg-neutral-900">
          <tr>
            {columns.map((column) => (
              <th key={column.key} className={`whitespace-nowrap px-2 py-1 font-normal text-neutral-500 ${column.align === "left" ? "text-left" : "text-right"}`}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={rowKey ? rowKey(row, index) : index} className="border-t border-neutral-900 hover:bg-neutral-900/60">
              {columns.map((column) => (
                <td key={column.key} className={`whitespace-nowrap px-2 py-0.5 text-neutral-200 ${column.align === "left" ? "text-left" : "text-right"}`}>
                  {column.render ? column.render(row) : cell(row[column.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A gate of the acceptance protocol: ✓ orange when it passed, ✗ blue when it failed. */
export function GateChip({ name, passed }: { name: string; passed: boolean | null }) {
  const color = passed === null ? OKABE.grey : passed ? OKABE.orange : OKABE.blue;
  return (
    <span className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-mono" style={{ borderColor: `${color}80`, color }}>
      <span aria-hidden="true">{passed === null ? "?" : passed ? "✓" : "✗"}</span>
      {name}
      <span className="sr-only">{passed ? "passed" : "failed"}</span>
    </span>
  );
}

/** The element's content width, following resizes of the side panel. */
export function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    setWidth(element.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width;
      if (next !== undefined) setWidth(next);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

/** Parse the settings' JSON-in-a-string columns (p_entry by session type); {} when unreadable. */
export function parseProbabilities(raw: unknown): Record<string, number> {
  if (typeof raw !== "string") return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed)) if (typeof value === "number") out[key] = value;
    return out;
  } catch {
    return {};
  }
}

export function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** p values the way the notebook printed them (`:g`). */
export function fmtProbability(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return String(Number(value.toPrecision(6)));
}
