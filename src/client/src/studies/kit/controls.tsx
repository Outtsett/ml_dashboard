/**
 * Study controls: a bar of labelled sliders, selects and switches. Each one
 * shows its current value, so a reader always knows what the picture is for.
 */

import type { ReactNode } from "react";
import { RotateCcw } from "lucide-react";
import { Slider } from "@/shared/ui/slider";
import { Switch } from "@/shared/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";

export function ControlBar({ children, onReset }: { children: ReactNode; onReset?: () => void }) {
  return (
    <div className="flex flex-wrap items-end gap-x-5 gap-y-3 rounded-lg border border-neutral-800 bg-neutral-900/50 px-3 py-2">
      {children}
      {onReset && (
        <button
          type="button"
          onClick={onReset}
          className="ml-auto flex items-center gap-1 rounded border border-neutral-700 px-2 py-1 text-[11px] text-neutral-400 hover:border-neutral-500 hover:text-neutral-200"
          title="Put every control back to its default"
        >
          <RotateCcw className="h-3 w-3" /> Reset
        </button>
      )}
    </div>
  );
}

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

export function SliderControl({
  label, value, min, max, step = 1, onChange, format = (v) => String(v), hint,
}: {
  label: string; value: number; min: number; max: number; step?: number;
  onChange: (value: number) => void; format?: (value: number) => string; hint?: string;
}) {
  return (
    <Labelled label={label} value={format(value)} hint={hint}>
      <Slider value={[value]} min={min} max={max} step={step} onValueChange={(next) => onChange(next[0] ?? value)} />
    </Labelled>
  );
}

export function SelectControl<V extends string>({
  label, value, options, onChange, hint,
}: {
  label: string; value: V; options: ReadonlyArray<{ value: V; label: string }>; onChange: (value: V) => void; hint?: string;
}) {
  return (
    <Labelled label={label} hint={hint}>
      <Select value={value} onValueChange={(next) => onChange(next as V)}>
        <SelectTrigger className="h-7 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value} className="text-xs">
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Labelled>
  );
}

export function SwitchControl({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (checked: boolean) => void; hint?: string }) {
  return (
    <label className="flex items-center gap-2 pb-1 text-xs text-neutral-300" title={hint}>
      <Switch checked={checked} onCheckedChange={onChange} />
      {label}
    </label>
  );
}

/** Buttons for a small set of choices (timeframes, horizons). */
export function SegmentControl<V extends string | number>({
  label, value, options, onChange, hint,
}: {
  label: string; value: V; options: ReadonlyArray<{ value: V; label: string }>; onChange: (value: V) => void; hint?: string;
}) {
  return (
    <Labelled label={label} hint={hint} width="w-auto">
      <div className="flex overflow-hidden rounded border border-neutral-700">
        {options.map((option) => (
          <button
            key={String(option.value)}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={option.value === value}
            className={`px-2 py-1 text-[11px] font-mono ${option.value === value ? "bg-neutral-700 text-neutral-50" : "text-neutral-400 hover:bg-neutral-800"}`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </Labelled>
  );
}
