/**
 * Two controls the kit does not carry: a date field for the window, and a
 * row of timeframe toggles (colour and marker shape, as on the charts). Plus a
 * debounce for the values that go to the server, so dragging a slider asks the
 * lake once when the hand stops, not once per pixel.
 */

import { useEffect, useState } from "react";
import { TIMEFRAMES, type Timeframe } from "@shared/studies/volatility-to-price-range";
import { TIMEFRAME_COLOR, timeframeLabel } from "./style";

/** The text after it has stopped changing for `delayMs`. Pass a JSON string for a set of values. */
export function useSettled(text: string, delayMs = 350): string {
  const [settled, setSettled] = useState(text);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(text), delayMs);
    return () => window.clearTimeout(timer);
  }, [text, delayMs]);
  return settled;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function DateField({ label, value, onChange, min, max, allowEmpty = false, hint }: { label: string; value: string; onChange: (value: string) => void; min?: string; max?: string; allowEmpty?: boolean; hint?: string }) {
  return (
    <label className="flex flex-col gap-1" title={hint}>
      <span className="text-[10px] uppercase tracking-wider text-neutral-500">{label}</span>
      <span className="flex items-center gap-1">
        <input
          type="date"
          value={value}
          min={min}
          max={max}
          onChange={(event) => {
            const next = event.target.value;
            if (DATE.test(next) || (allowEmpty && next === "")) onChange(next);
          }}
          className="h-7 rounded border border-neutral-700 bg-neutral-950 px-2 text-xs text-neutral-200 [color-scheme:dark]"
        />
        {allowEmpty && value !== "" && (
          <button type="button" onClick={() => onChange("")} className="text-[10px] text-neutral-500 hover:text-neutral-200" title="Clear: read to the latest bar">
            latest
          </button>
        )}
      </span>
    </label>
  );
}

export function parseShown(text: string): Set<Timeframe> {
  const wanted = new Set(text.split(","));
  return new Set(TIMEFRAMES.filter((timeframe) => wanted.has(timeframe)));
}

export function TimeframeToggles({ shown, available, onChange }: { shown: ReadonlySet<Timeframe>; available: readonly Timeframe[]; onChange: (text: string) => void }) {
  const toggle = (timeframe: Timeframe) => {
    const next = new Set(shown);
    if (next.has(timeframe)) next.delete(timeframe);
    else next.add(timeframe);
    if (next.size === 0) return;
    onChange(TIMEFRAMES.filter((entry) => next.has(entry)).join(","));
  };
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider text-neutral-500">Timeframes drawn</span>
      <div className="flex flex-wrap gap-1">
        {available.map((timeframe) => {
          const on = shown.has(timeframe);
          return (
            <button
              key={timeframe}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(timeframe)}
              className={`rounded border px-2 py-0.5 text-[11px] font-mono ${on ? "border-neutral-500 bg-neutral-800" : "border-neutral-800 text-neutral-600 line-through"}`}
              style={on ? { color: TIMEFRAME_COLOR[timeframe] } : undefined}
            >
              {timeframeLabel(timeframe)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
