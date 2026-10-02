/**
 * Two controls the kit does not have: a slider that previews while it drags
 * and asks the server only when released (the normalization window re-scans
 * the lake, so a drag must not fire one request per step), and a date input.
 */

import { useState, type ReactNode } from "react";
import { Slider } from "@/shared/ui/slider";

function Labelled({ label, value, hint, children, width = "w-44" }: { label: string; value?: string; hint?: string; children: ReactNode; width?: string }) {
  return (
    <label className={`flex flex-col gap-1 ${width}`} title={hint}>
      <span className="flex items-baseline justify-between text-[10px] uppercase tracking-wider text-neutral-500">
        <span>{label}</span>
        {value !== undefined && <span className="font-mono normal-case tracking-normal text-neutral-200">{value}</span>}
      </span>
      {children}
    </label>
  );
}

export function CommitSlider({
  label, value, min, max, step = 1, onCommit, format = (v) => String(v), hint,
}: {
  label: string; value: number; min: number; max: number; step?: number;
  onCommit: (value: number) => void; format?: (value: number) => string; hint?: string;
}) {
  const [draft, setDraft] = useState<number | null>(null);
  const shown = draft ?? value;
  return (
    <Labelled label={label} value={format(shown)} hint={hint}>
      <Slider
        value={[shown]}
        min={min}
        max={max}
        step={step}
        onValueChange={(next) => setDraft(next[0] ?? shown)}
        onValueCommit={(next) => {
          setDraft(null);
          onCommit(next[0] ?? shown);
        }}
      />
    </Labelled>
  );
}

export function DateControl({ label, value, onChange, hint }: { label: string; value: string; onChange: (value: string) => void; hint?: string }) {
  return (
    <Labelled label={label} hint={hint} width="w-36">
      <input
        type="date"
        value={value}
        onChange={(event) => {
          if (/^\d{4}-\d{2}-\d{2}$/.test(event.target.value)) onChange(event.target.value);
        }}
        className="h-7 rounded border border-neutral-700 bg-neutral-950 px-2 text-xs text-neutral-200"
      />
    </Labelled>
  );
}
