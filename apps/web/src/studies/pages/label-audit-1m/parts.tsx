/**
 * Small pieces the label-audit page's sections share: a plain table, a
 * covered/uncovered badge that carries a glyph as well as a colour, and a
 * legend line.
 */

import type { ReactNode } from "react";
import { OKABE } from "@/studies/kit";

export interface Column<Row> {
  header: string;
  cell: (row: Row) => ReactNode;
  align?: "left" | "right";
  title?: string;
}

export function DataTable<Row>({ rows, columns, rowKey, highlight }: { rows: readonly Row[]; columns: ReadonlyArray<Column<Row>>; rowKey: (row: Row, index: number) => string; highlight?: (row: Row) => boolean }) {
  return (
    <div className="min-w-0 overflow-x-auto">
      <table className="w-full text-[11px] font-mono tnum">
        <thead>
          <tr className="text-neutral-500">
            {columns.map((column) => (
              <th key={column.header} title={column.title} className={`whitespace-nowrap px-1.5 py-1 font-normal ${column.align === "right" ? "text-right" : "text-left"}`}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={rowKey(row, index)} className={`border-t border-neutral-900 ${highlight?.(row) ? "bg-neutral-800/60" : ""}`}>
              {columns.map((column) => (
                <td key={column.header} className={`px-1.5 py-0.5 align-top text-neutral-200 ${column.align === "right" ? "text-right" : "text-left"}`}>
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A yes/no verdict: orange with ✓ for yes, blue with ✗ for no, so neither colour carries it alone. */
export function Verdict({ ok, yes, no }: { ok: boolean; yes: string; no: string }) {
  const color = ok ? OKABE.orange : OKABE.blue;
  return (
    <span className="inline-flex items-center gap-1 rounded border px-1.5 py-px text-[10px] font-sans" style={{ borderColor: color, color }}>
      {ok ? "✓" : "✗"} {ok ? yes : no}
    </span>
  );
}

export function Legend({ items }: { items: ReadonlyArray<{ glyph: string; label: string; color: string }> }) {
  return (
    <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-neutral-400">
      {items.map((item) => (
        <span key={item.label} style={{ color: item.color }}>
          {item.glyph} <span className="text-neutral-300">{item.label}</span>
        </span>
      ))}
    </p>
  );
}

/** A labelled number inside a sentence-sized card row. */
export function Pill({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <span className="inline-flex items-baseline gap-1 rounded border border-neutral-800 bg-neutral-900/60 px-2 py-0.5 text-[11px]">
      <span className="text-neutral-500">{label}</span>
      <span className="font-mono tnum" style={tone ? { color: tone } : { color: "#e5e5e5" }}>
        {value}
      </span>
    </span>
  );
}
