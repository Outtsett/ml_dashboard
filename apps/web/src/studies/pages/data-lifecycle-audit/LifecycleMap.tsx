/**
 * The stage by part-of-system grid. Each mark's size is the findings in that
 * cell (the number is printed inside it); colour, shape and the legend word say
 * how bad the worst one is. Click a cell to narrow everything below to it,
 * click again to release it; hover or focus a cell for its titles.
 */

import { useState } from "react";
import { SEVERITY_ORDER, STAGE_ORDER, cellKey, markSize, stageLabel, stageShortLabel, strandLabel, type LifecycleCell } from "@shared/studies/data-lifecycle-audit";
import { Glyph } from "./Glyph";
import { severityStyle } from "./style";

export function LifecycleMap({ cells, strands, selected, onToggle, onClear }: {
  cells: readonly LifecycleCell[];
  strands: readonly string[];
  selected: readonly string[];
  onToggle: (key: string) => void;
  onClear: () => void;
}) {
  const [hovered, setHovered] = useState<LifecycleCell | null>(null);
  const byKey = new Map(cells.map((cell) => [cellKey(cell.stage, cell.strand), cell]));
  const maximumCount = Math.max(1, ...cells.map((cell) => cell.count));
  const rows = [...strands].sort((a, b) => strandLabel(a).localeCompare(strandLabel(b)));

  return (
    <div className="min-w-0 space-y-2">
      <div className="overflow-x-auto">
        <div className="grid min-w-[640px] items-center gap-px" style={{ gridTemplateColumns: "9.5rem repeat(7, minmax(0, 1fr))" }} role="grid" aria-label="Findings by lifecycle stage and part of the system">
          <div />
          {STAGE_ORDER.map((stage) => (
            <div key={stage} className="px-1 pb-1 text-center text-[10px] leading-tight text-neutral-400" title={stageLabel(stage)}>
              {stageShortLabel(stage)}
            </div>
          ))}
          {rows.map((strand) => (
            <div key={strand} className="contents" role="row">
              <div className="pr-2 text-right text-[11px] leading-tight text-neutral-300">{strandLabel(strand)}</div>
              {STAGE_ORDER.map((stage) => {
                const key = cellKey(stage, strand);
                const cell = byKey.get(key);
                const isSelected = selected.includes(key);
                return (
                  <div key={key} className={`flex h-[54px] items-center justify-center border border-neutral-900 ${isSelected ? "bg-[#56B4E9]/15 outline outline-1 -outline-offset-1 outline-[#56B4E9]" : "bg-neutral-950/40"}`}>
                    {cell ? (
                      <button
                        type="button"
                        aria-pressed={isSelected}
                        aria-label={`${stageLabel(stage)}, ${strandLabel(strand)}: ${cell.count} findings, worst ${cell.worstSeverity}`}
                        onClick={() => onToggle(key)}
                        onMouseEnter={() => setHovered(cell)}
                        onMouseLeave={() => setHovered(null)}
                        onFocus={() => setHovered(cell)}
                        onBlur={() => setHovered(null)}
                        className="rounded p-0.5 hover:bg-neutral-800"
                      >
                        <Glyph severity={cell.worstSeverity} size={Math.round(markSize(cell.count, maximumCount))} label={cell.count} />
                      </button>
                    ) : (
                      <span className="h-1 w-1 rounded-full bg-neutral-800" aria-hidden="true" />
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-neutral-400">
        <span>Worst severity in the cell:</span>
        {SEVERITY_ORDER.map((severity) => (
          <span key={severity} className="inline-flex items-center gap-1">
            <Glyph severity={severity} size={12} /> {severity}
          </span>
        ))}
        <span>· bigger mark, more findings (the number inside)</span>
        {selected.length > 0 && (
          <button type="button" onClick={onClear} className="ml-auto rounded border border-neutral-700 px-2 py-0.5 text-neutral-300 hover:border-neutral-500">
            Clear {selected.length} selected {selected.length === 1 ? "cell" : "cells"}
          </button>
        )}
      </div>

      <div className="min-h-[3.5rem] rounded border border-neutral-800 bg-neutral-900/40 px-2 py-1 text-[11px] text-neutral-300" aria-live="polite">
        {hovered ? (
          <>
            <div className="font-medium text-neutral-100">
              {stageLabel(hovered.stage)} · {strandLabel(hovered.strand)}: {hovered.count} {hovered.count === 1 ? "finding" : "findings"}, worst {hovered.worstSeverity} {severityStyle(hovered.worstSeverity).glyph}
            </div>
            <ul className="mt-0.5 list-disc pl-4 text-neutral-400">
              {hovered.titles.map((title) => <li key={title}>{title}</li>)}
            </ul>
          </>
        ) : (
          <span className="text-neutral-500">Hover or focus a mark to read the titles in its cell.</span>
        )}
      </div>
    </div>
  );
}
