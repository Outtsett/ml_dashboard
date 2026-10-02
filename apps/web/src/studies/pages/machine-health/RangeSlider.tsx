/**
 * A two-thumb slider (the notebook's day-window range slider). The page shows
 * the dragged values at once and sends the window to the server when a thumb is
 * released, so a drag is one request, not one per step.
 */

import { useState } from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";

export function RangeSlider({
  label, value, min, max, onCommit, format = (v) => String(v), hint,
}: {
  label: string; value: [number, number]; min: number; max: number;
  onCommit: (value: [number, number]) => void; format?: (value: number) => string; hint?: string;
}) {
  const [draft, setDraft] = useState<[number, number] | null>(null);
  const shown = draft ?? value;
  return (
    <label className="flex min-w-[16rem] flex-1 flex-col gap-1" title={hint}>
      <span className="flex items-baseline justify-between gap-3 text-[10px] uppercase tracking-wider text-neutral-500">
        <span>{label}</span>
        <span className="font-mono normal-case tracking-normal text-neutral-200">{format(shown[0])} to {format(shown[1])}</span>
      </span>
      <SliderPrimitive.Root
        className="relative flex h-4 w-full touch-none select-none items-center"
        value={shown}
        min={min}
        max={max}
        step={1}
        minStepsBetweenThumbs={0}
        onValueChange={(next) => setDraft([next[0] ?? min, next[1] ?? max])}
        onValueCommit={(next) => {
          setDraft(null);
          onCommit([next[0] ?? min, next[1] ?? max]);
        }}
      >
        <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-neutral-700">
          <SliderPrimitive.Range className="absolute h-full bg-[#56B4E9]" />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb aria-label={`${label}, start`} className="block h-4 w-4 rounded-full border border-neutral-300 bg-neutral-900 shadow focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
        <SliderPrimitive.Thumb aria-label={`${label}, end`} className="block h-4 w-4 rounded-full border border-neutral-300 bg-neutral-900 shadow focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
      </SliderPrimitive.Root>
    </label>
  );
}
