/**
 * Panel A: the five readings of one volume bar on real MNQ 5m bars of the
 * 2025 holdout. The scroll slider pages through the whole holdout by bar
 * position (the notebook's 0 to 1,200 covered the first 1,200 of 70,254);
 * the query reads by timestamp range, and the readings are the same causal
 * code the landed study uses.
 */

import { useEffect, useState } from "react";
import { ColumnGrid, ControlBar, Finding, Section, SliderControl, StudyNotes, StudyState, fmt, fmtInt, fmtTime, useStudyQuery } from "@/studies/kit";
import type { VolumeCandleAnatomyBody, WindowBar } from "@shared/studies/volume-candle-anatomy";
import type { Controls, SetControl } from "./controls";
import { WindowChart } from "./WindowChart";

const READINGS = [
  ["volume_contracts", "the raw contract count", "comparable across time only if activity never drifts, which it does"],
  ["volume_bar_height_in_window", "what your eye reads: this bar against the tallest bar before it in the trailing 120", "scale-free, but its denominator moves whenever a new maximum arrives"],
  ["volume_zscore_trailing", "how surprising this volume is against its own recent history (log volume)", "comparable across instruments and eras; assumes a distribution"],
  ["volume_rank_trailing", "the same question with no distributional assumption: the share of the previous 120 bars below this one", "robust to the fat tail volume actually has"],
  ["volume_signed_by_candle_direction", "volume multiplied by the sign of the candle, which is what a charting platform's colouring draws", "signed participation, not signed aggression"],
] as const;

/** Commit a slider's value to the page state a moment after it stops moving, so a drag is one request, not hundreds. */
function useDraft(value: number, commit: (next: number) => void): [number, (next: number) => void] {
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    setDraft(value);
  }, [value]);
  useEffect(() => {
    if (draft === value) return;
    const timer = setTimeout(() => commit(draft), 180);
    return () => clearTimeout(timer);
  }, [draft, value, commit]);
  return [draft, setDraft];
}

export function WindowPanel({ controls, set }: { controls: Controls; set: SetControl }) {
  const [start, setStart] = useDraft(controls.windowStart, (next) => set("windowStart", next));
  const [length, setLength] = useDraft(controls.windowLength, (next) => set("windowLength", next));
  const [hover, setHover] = useState<number | null>(null);
  const query = useStudyQuery<VolumeCandleAnatomyBody>("volume-candle-anatomy", {
    part: "window", windowStart: controls.windowStart, windowLength: controls.windowLength,
  });
  const frame = query.data?.data.window ?? null;
  const bars: WindowBar[] = frame?.bars ?? [];
  const shown: WindowBar | undefined = hover === null ? bars[bars.length - 1] : bars[hover];
  const maximumStart = Math.max(0, (frame?.holdoutBarCount ?? 1200 + 210) - length - 140);

  return (
    <Section
      title="A. The readings of one volume bar are different numbers"
      question="A model handed one reading cannot recover the others. Scroll through real MNQ 5m bars (2025 holdout) and watch them disagree."
    >
      <div className="space-y-3">
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead className="text-left text-neutral-500">
              <tr><th className="pr-3 font-normal">reading</th><th className="pr-3 font-normal">what it is</th><th className="font-normal">what it is good for</th></tr>
            </thead>
            <tbody className="align-top text-neutral-300">
              {READINGS.map(([name, what, good]) => (
                <tr key={name} className="border-t border-neutral-800">
                  <td className="py-1 pr-3 font-mono text-neutral-100">{name}</td>
                  <td className="py-1 pr-3">{what}</td>
                  <td className="py-1">{good}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ControlBar>
          <SliderControl label="Scroll through bars" value={start} min={0} max={maximumStart} step={20} onChange={setStart} format={(v) => `bar ${fmtInt(v)}`} hint="Position of the first bar read, counted from the start of the 2025 holdout" />
          <SliderControl label="Bars shown" value={length} min={30} max={160} step={10} onChange={setLength} />
        </ControlBar>
        <StudyNotes notes={query.data?.notes ?? []} />
        <StudyState isLoading={query.isLoading} error={query.error}>
          {frame && bars.length > 0 ? (
            <>
              <Finding>
                <strong>The raw count and the chart height rank these bars differently.</strong> Spearman between them on this window is{" "}
                <strong>{fmt(frame.spearmanRawAgainstHeight, 3)}</strong>, not 1.0, because the height&apos;s denominator is a moving trailing maximum. The z-score and signed panes are coloured by candle direction: that colouring is the signed volume bar.
                {" "}Holdout has {fmtInt(frame.holdoutBarCount)} bars; showing bars {fmtInt(frame.windowStart + 140)} to {fmtInt(frame.windowStart + 140 + bars.length - 1)}.
              </Finding>
              <p className="min-h-4 font-mono text-[11px] text-neutral-300">
                {shown
                  ? `${fmtTime(shown.timestamp)} clock · ${shown.candle_direction === "rising" ? "▲ rising" : "▼ falling"} · contracts ${fmtInt(shown.volume_contracts)} · height ${fmt(shown.volume_bar_height_in_window, 3)} · z-score ${fmt(shown.volume_zscore_trailing, 2)} · rank ${fmt(shown.volume_rank_trailing, 3)} · signed ${fmtInt(shown.volume_signed_by_candle_direction)}`
                  : ""}
              </p>
              <WindowChart bars={bars} onHover={setHover} />
              <ColumnGrid rows={bars} title="Every column of the bars on screen" exclude={["timestamp"]} />
            </>
          ) : (
            !query.isLoading && <p className="text-xs text-neutral-500">No bars to show: the 2025 holdout is not in the lake view derived_mnq_next_candles_5m.</p>
          )}
        </StudyState>
      </div>
    </Section>
  );
}
