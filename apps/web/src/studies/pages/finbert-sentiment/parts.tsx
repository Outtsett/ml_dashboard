/**
 * Small pieces the finbert-sentiment sections share: the eight-number table
 * with the notebook's moment definitions, a paged table, the hatch patterns
 * that keep vendors apart without colour, and a date input.
 */

import { useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { fmt, fmtInt } from "@/studies/kit";
import type { EightNumbers } from "@shared/studies/finbert-sentiment";
import { VENDOR_COLORS } from "./prep";

const EIGHT_COLUMNS: Array<[keyof EightNumbers, string]> = [
  ["count", "count"],
  ["mean", "mean"],
  ["median", "median"],
  ["standardDeviation", "standard deviation"],
  ["skewness", "skewness"],
  ["excessKurtosis", "excess kurtosis"],
  ["percentile25", "25th percentile"],
  ["percentile75", "75th percentile"],
  ["minimum", "minimum"],
  ["maximum", "maximum"],
];

export function EightTable({ rows, label, decimals = 4 }: { rows: Array<{ name: string; summary: EightNumbers }>; label: string; decimals?: number }) {
  return (
    <div className="min-w-0 overflow-x-auto rounded border border-neutral-800">
      <table className="w-full text-[11px] font-mono tnum">
        <thead className="bg-neutral-900">
          <tr>
            <th className="px-2 py-1 text-left font-normal text-neutral-400">{label}</th>
            {EIGHT_COLUMNS.map(([key, heading]) => (
              <th key={key} className="px-2 py-1 text-right font-normal text-neutral-400">
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.name} className="border-t border-neutral-900">
              <td className="px-2 py-0.5 text-neutral-200">{row.name}</td>
              {EIGHT_COLUMNS.map(([key]) => (
                <td key={key} className="px-2 py-0.5 text-right text-neutral-200">
                  {key === "count" ? fmtInt(row.summary.count) : fmt(row.summary[key], decimals)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-neutral-900 px-2 py-1 text-[10px] text-neutral-500">
        Standard deviation divides by n - 1; skewness is m3 / m2^1.5 and excess kurtosis m4 / m2^2 - 3 from population moments; percentiles interpolate linearly. A moment that needs more observations than the column has reads —.
      </p>
    </div>
  );
}

export interface PagedColumn<Row> {
  key: string;
  label: string;
  cell: (row: Row) => ReactNode;
  align?: "left" | "right";
}

export function PagedTable<Row>({ rows, columns, pageSize = 12, rowKey }: { rows: readonly Row[]; columns: ReadonlyArray<PagedColumn<Row>>; pageSize?: number; rowKey: (row: Row, index: number) => string }) {
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.min(page, pageCount - 1);
  const visible = rows.slice(current * pageSize, (current + 1) * pageSize);
  return (
    <div className="min-w-0 space-y-1">
      <div className="overflow-x-auto rounded border border-neutral-800">
        <table className="w-full text-[11px] font-mono tnum">
          <thead className="bg-neutral-900">
            <tr>
              {columns.map((column) => (
                <th key={column.key} className={`px-2 py-1 font-normal text-neutral-400 ${column.align === "right" ? "text-right" : "text-left"}`}>
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row, index) => (
              <tr key={rowKey(row, current * pageSize + index)} className="border-t border-neutral-900">
                {columns.map((column) => (
                  <td key={column.key} className={`px-2 py-0.5 text-neutral-200 ${column.align === "right" ? "text-right" : "text-left"}`}>
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-2 py-3 text-center text-neutral-500">
                  No rows.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-end gap-2 text-[11px] text-neutral-400">
        <span>
          {rows.length === 0 ? 0 : current * pageSize + 1}–{Math.min(rows.length, (current + 1) * pageSize)} of {fmtInt(rows.length)}
        </span>
        <button type="button" disabled={current === 0} onClick={() => setPage(current - 1)} className="rounded border border-neutral-700 p-0.5 disabled:opacity-30" aria-label="Previous page">
          <ChevronLeft className="h-3 w-3" />
        </button>
        <button type="button" disabled={current >= pageCount - 1} onClick={() => setPage(current + 1)} className="rounded border border-neutral-700 p-0.5 disabled:opacity-30" aria-label="Next page">
          <ChevronRight className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

/** Fill for a vendor's bars: a solid colour, a stripe or a dot pattern, so the legend reads without colour. */
export function vendorFill(vendor: string): string {
  return `url(#vendor-${vendor})`;
}

/**
 * `<defs>` for a Recharts chart: gdelt solid, rss diagonal stripes, alphavantage dots (other vendors solid grey).
 * Call it (`{vendorDefs(vendors)}`) rather than rendering it as a component: Recharts only draws its own children.
 */
export function vendorDefs(vendors: readonly string[]) {
  return (
    <defs>
      {vendors.map((vendor) => {
        const color = VENDOR_COLORS[vendor] ?? "#8a8a8a";
        if (vendor === "rss") {
          return (
            <pattern key={vendor} id={`vendor-${vendor}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" fill={color} fillOpacity="0.35" />
              <rect width="3" height="6" fill={color} />
            </pattern>
          );
        }
        if (vendor === "alphavantage") {
          return (
            <pattern key={vendor} id={`vendor-${vendor}`} width="6" height="6" patternUnits="userSpaceOnUse">
              <rect width="6" height="6" fill={color} fillOpacity="0.35" />
              <circle cx="3" cy="3" r="1.6" fill={color} />
            </pattern>
          );
        }
        return (
          <pattern key={vendor} id={`vendor-${vendor}`} width="6" height="6" patternUnits="userSpaceOnUse">
            <rect width="6" height="6" fill={color} />
          </pattern>
        );
      })}
    </defs>
  );
}

export function VendorLegend({ vendors }: { vendors: readonly string[] }) {
  const glyphs: Record<string, string> = { gdelt: "■ solid", rss: "▨ stripes", alphavantage: "◍ dots" };
  return (
    <p className="flex flex-wrap gap-x-3 text-[11px] text-neutral-400">
      {vendors.map((vendor) => (
        <span key={vendor} style={{ color: VENDOR_COLORS[vendor] ?? "#8a8a8a" }}>
          {glyphs[vendor] ?? "■"} {vendor}
        </span>
      ))}
    </p>
  );
}

export function DateInput({ label, value, onChange, min, max }: { label: string; value: string; onChange: (value: string) => void; min?: string; max?: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider text-neutral-500">{label}</span>
      <input
        type="date"
        value={value}
        min={min}
        max={max}
        onChange={(event) => {
          if (event.target.value) onChange(event.target.value);
        }}
        className="h-7 rounded border border-neutral-700 bg-neutral-950 px-2 text-xs text-neutral-200 [color-scheme:dark]"
      />
    </label>
  );
}
