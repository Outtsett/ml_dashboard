/**
 * The four multi-selects and the text search. Each option is a toggle chip
 * (pressed = included); a severity chip carries its mark, so the colour is
 * never the only signal. The controls hold what is switched OFF, so the
 * default, everything on, is an empty value in the URL.
 */

import type { ReactNode } from "react";
import { EFFORT_ORDER, SEVERITY_ORDER, STAGE_ORDER, stageLabel, strandLabel, toggleIn } from "@shared/studies/data-lifecycle-audit";
import { Glyph } from "./Glyph";

interface ChipOption {
  value: string;
  label: string;
  mark?: ReactNode;
}

function ChipGroup({ label, options, off, onChange }: { label: string; options: readonly ChipOption[]; off: readonly string[]; onChange: (off: string[]) => void }) {
  const allOn = off.length === 0;
  return (
    <fieldset className="min-w-0 space-y-1">
      <legend className="flex items-baseline gap-2 text-[10px] uppercase tracking-wider text-neutral-500">
        {label}
        <button type="button" onClick={() => onChange(allOn ? options.map((option) => option.value) : [])} className="normal-case tracking-normal text-[#56B4E9] hover:underline">
          {allOn ? "none" : "all"}
        </button>
      </legend>
      <div className="flex flex-wrap gap-1">
        {options.map((option) => {
          const on = !off.includes(option.value);
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(toggleIn(off, option.value))}
              className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] ${on ? "border-neutral-500 bg-neutral-800 text-neutral-100" : "border-neutral-800 text-neutral-500 line-through hover:border-neutral-600"}`}
            >
              {option.mark}
              {option.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

export function Filters({ strands, off, search, onOff, onSearch }: {
  strands: readonly string[];
  off: { stage: string[]; severity: string[]; effort: string[]; strand: string[] };
  search: string;
  onOff: (key: "stage" | "severity" | "effort" | "strand", value: string[]) => void;
  onSearch: (value: string) => void;
}) {
  return (
    <div className="grid gap-3 rounded-lg border border-neutral-800 bg-neutral-900/50 p-3 md:grid-cols-2">
      <ChipGroup label="Lifecycle stage" off={off.stage} onChange={(value) => onOff("stage", value)} options={STAGE_ORDER.map((stage) => ({ value: stage, label: stageLabel(stage) }))} />
      <ChipGroup label="Where in the system" off={off.strand} onChange={(value) => onOff("strand", value)} options={strands.map((strand) => ({ value: strand, label: strandLabel(strand) }))} />
      <ChipGroup
        label="Severity"
        off={off.severity}
        onChange={(value) => onOff("severity", value)}
        options={SEVERITY_ORDER.map((severity) => ({ value: severity, label: severity, mark: <Glyph severity={severity} size={11} /> }))}
      />
      <ChipGroup label="Effort" off={off.effort} onChange={(value) => onOff("effort", value)} options={EFFORT_ORDER.map((effort) => ({ value: effort, label: effort }))} />
      <label className="flex flex-col gap-1 md:col-span-2">
        <span className="text-[10px] uppercase tracking-wider text-neutral-500">Search text (title, component, behaviour, fix, file)</span>
        <input
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder="e.g. cache, iceberg, float32"
          className="h-7 max-w-md rounded border border-neutral-700 bg-neutral-950 px-2 text-xs text-neutral-200"
        />
      </label>
    </div>
  );
}
