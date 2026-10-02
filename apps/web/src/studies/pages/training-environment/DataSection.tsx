/**
 * Section 1: the data it is training on. The notebook's "bars in view" range
 * slider becomes two sliders (first and last bar; -1 means the notebook's
 * default, the last 300 bars) that clamp each other, and the same window
 * drives the heatmap in section 2. Every column of the bars frame gets its own
 * histogram below the chart.
 */

import { ColumnGrid, ControlBar, Finding, Section, SliderControl, fmt, fmtInt, fmtTime } from "@/studies/kit";
import type { BarRow } from "@shared/studies/training-environment";
import { BarsChart } from "./BarsChart";
import { clampInt, type SetControl, type TrainingControls } from "./shared";

export const DEFAULT_WINDOW_BARS = 300;

export function resolveWindow(firstBar: number, lastBar: number, barCount: number): { first: number; last: number } {
  const newest = Math.max(0, barCount - 1);
  const last = lastBar < 0 ? newest : clampInt(lastBar, 0, newest);
  const first = firstBar < 0 ? Math.max(0, newest - (DEFAULT_WINDOW_BARS - 1)) : clampInt(firstBar, 0, newest);
  return first <= last ? { first, last } : { first: last, last: first };
}

export function DataSection({ bars, controls, set }: { bars: readonly BarRow[]; controls: TrainingControls; set: SetControl }) {
  const { first, last } = resolveWindow(controls.firstBar, controls.lastBar, bars.length);
  const view = bars.slice(first, last + 1);
  const rising = view.filter((bar) => bar.close >= bar.open).length;
  const highest = view.reduce((most, bar) => Math.max(most, bar.high), Number.NEGATIVE_INFINITY);
  const lowest = view.reduce((least, bar) => Math.min(least, bar.low), Number.POSITIVE_INFINITY);

  return (
    <Section title="1 · The data it is training on" question="The bars themselves, not a summary of them: the most recent bars the run published.">
      {bars.length === 0 ? (
        <p className="py-4 text-xs text-neutral-400">This run has not published its bars.</p>
      ) : (
        <div className="space-y-3">
          <ControlBar onReset={() => { set("firstBar", -1); set("lastBar", -1); }}>
            <SliderControl
              label="First bar in view"
              value={first}
              min={0}
              max={bars.length - 1}
              onChange={(value) => { set("firstBar", value); if (value > last) set("lastBar", value); }}
              format={(value) => fmtInt(value)}
              hint={`Bars are numbered 0 to ${bars.length - 1}`}
            />
            <SliderControl
              label="Last bar in view"
              value={last}
              min={0}
              max={bars.length - 1}
              onChange={(value) => { set("lastBar", value); if (value < first) set("firstBar", value); }}
              format={(value) => fmtInt(value)}
              hint={`Of ${fmtInt(bars.length)} bars`}
            />
          </ControlBar>
          <Finding>
            {fmtInt(view.length)} of {fmtInt(bars.length)} bars in view, {fmtTime(view[0]?.timestamp_ms)} to {fmtTime(view[view.length - 1]?.timestamp_ms)};{" "}
            {fmtInt(rising)} rising ▲ and {fmtInt(view.length - rising)} falling ▼, range {fmt(lowest, 2)} to {fmt(highest, 2)}.
          </Finding>
          <BarsChart bars={view} />
          <ColumnGrid rows={bars} exclude={["bar_index", "timestamp_ms"]} title="Every column of the bars frame (all bars)" />
        </div>
      )}
    </Section>
  );
}
