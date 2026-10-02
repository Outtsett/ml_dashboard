/**
 * A responsive heat map built from a CSS grid: one cell per (row, column),
 * coloured by the caller's scale, with a glyph on marked cells (so a flag is
 * never colour alone) and a readout line that shows the exact value under the
 * pointer. Fluid width, so it fits the resizable side panel.
 */

import { useState, type ReactNode } from "react";

export interface MatrixGridProps {
  rowLabels: readonly string[];
  columnLabels: readonly string[];
  value: (row: number, column: number) => number | null;
  colour: (value: number | null) => string;
  format: (value: number | null) => string;
  /** A glyph drawn inside the cell (e.g. "●" for a survivor, "×" for an unidentifiable pair). */
  glyph?: (row: number, column: number) => string | null;
  /** Extra words for the readout under the pointer. */
  describe?: (row: number, column: number) => string | null;
  cellHeight?: number;
  rowLabelWidth?: number;
  legend?: ReactNode;
}

export function MatrixGrid({
  rowLabels, columnLabels, value, colour, format, glyph, describe, cellHeight = 16, rowLabelWidth = 150, legend,
}: MatrixGridProps) {
  const [hover, setHover] = useState<{ row: number; column: number } | null>(null);
  const hovered = hover ? value(hover.row, hover.column) : null;

  return (
    <div className="min-w-0 space-y-1">
      <div className="flex min-h-[18px] flex-wrap items-center justify-between gap-2 text-[11px]">
        <span className="font-mono tnum text-neutral-200">
          {hover
            ? `${rowLabels[hover.row]} × ${columnLabels[hover.column]}: ${format(hovered)}${describe?.(hover.row, hover.column) ? ` · ${describe(hover.row, hover.column)}` : ""}`
            : "Point at a cell for its exact value."}
        </span>
        {legend}
      </div>
      <div className="overflow-x-auto">
        <div
          className="grid min-w-[420px] gap-px"
          style={{ gridTemplateColumns: `${rowLabelWidth}px repeat(${columnLabels.length}, minmax(0, 1fr))` }}
          onMouseLeave={() => setHover(null)}
        >
          <div />
          {columnLabels.map((label) => (
            <div
              key={label}
              className="flex h-14 items-end justify-center pb-1 text-[9px] text-neutral-400"
              style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
              title={label}
            >
              {label}
            </div>
          ))}
          {rowLabels.map((rowLabel, row) => (
            <div key={rowLabel} className="contents">
              <div className="truncate pr-1 text-right text-[10px] leading-none text-neutral-400" style={{ height: cellHeight, lineHeight: `${cellHeight}px` }} title={rowLabel}>
                {rowLabel}
              </div>
              {columnLabels.map((columnLabel, column) => {
                const cell = value(row, column);
                const mark = glyph?.(row, column) ?? null;
                const active = hover?.row === row && hover?.column === column;
                return (
                  <div
                    key={columnLabel}
                    onMouseEnter={() => setHover({ row, column })}
                    className="flex items-center justify-center text-[9px] leading-none text-neutral-950"
                    style={{
                      height: cellHeight,
                      background: colour(cell),
                      outline: active ? "1px solid #f5f5f5" : undefined,
                      color: "#f5f5f5",
                      textShadow: "0 0 2px #000",
                    }}
                  >
                    {mark}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** A colour bar legend from `low` to `high` drawn with the same scale. */
export function ScaleLegend({ low, high, colour, steps = 11, lowLabel, highLabel }: {
  low: number; high: number; colour: (value: number) => string; steps?: number; lowLabel: string; highLabel: string;
}) {
  return (
    <span className="flex items-center gap-1 text-[10px] text-neutral-400">
      <span>{lowLabel}</span>
      <span className="flex h-2 w-28 overflow-hidden rounded-sm">
        {Array.from({ length: steps }, (_, index) => (
          <span key={index} className="flex-1" style={{ background: colour(low + ((high - low) * index) / (steps - 1)) }} />
        ))}
      </span>
      <span>{highLabel}</span>
    </span>
  );
}
