/**
 * FinBERT news sentiment: what every model reads. The server returns the
 * scored headlines routed to a root (collapsed to one story per headline,
 * syndicated copies counted once, GDELT known 15 minutes late) and the
 * coverage spans; this page computes the nine columns on its own bar grid with
 * the shared port of lake.sentiment, so the grid, the half-life and the bar
 * stepper react without a round trip.
 */

import { useState } from "react";
import {
  ControlBar, Finding, SegmentControl, SelectControl, SliderControl, Stat, StudyNotes, StudyState, fmtInt,
  useStudyControls, useStudyQuery,
} from "@/studies/kit";
import { barGrid, computeFeatures, type FinbertBody } from "@shared/studies/finbert-sentiment";
import { Columns } from "./Columns";
import { Headlines } from "./Headlines";
import { DateInput } from "./parts";
import { utcDate } from "./prep";
import { Stepper } from "./Stepper";

const GRIDS = [
  { value: 1, label: "1 minute" },
  { value: 5, label: "5 minutes" },
  { value: 15, label: "15 minutes" },
  { value: 60, label: "1 hour" },
  { value: 1440, label: "1 day" },
] as const;

const MAXIMUM_BARS = 50_000;

export default function Page() {
  const [now] = useState(() => Date.now());
  const [controls, set, reset] = useStudyControls({
    root: "MNQ",
    gridMinutes: 5,
    start: utcDate(now, 3),
    end: utcDate(now),
    bins: 30,
    bar: -1,
    halfLife: 0,
    term: 40,
  });
  const query = useStudyQuery<FinbertBody>("finbert-sentiment", { root: controls.root, start: controls.start, end: controls.end });
  const body = query.data?.data;

  const grid = body
    ? barGrid(body.windowStartMs / 1000, Math.min(body.windowEndMs / 1000, now / 1000), controls.gridMinutes, MAXIMUM_BARS)
    : { times: new Float64Array(0), truncated: false };
  const features = body ? computeFeatures(grid.times, { stories: body.stories, coverage: body.coverage }, controls.gridMinutes) : null;
  const barIndex = grid.times.length === 0 ? 0 : controls.bar < 0 ? grid.times.length - 1 : Math.min(controls.bar, grid.times.length - 1);
  const defaultHalfLife = Math.max(20, 4 * controls.gridMinutes);
  const halfLife = controls.halfLife > 0 ? controls.halfLife : defaultHalfLife;

  const rootOptions = (body?.roots.length ? body.roots : [controls.root]).map((root) => ({ value: root, label: root }));
  if (!rootOptions.some((option) => option.value === controls.root)) rootOptions.unshift({ value: controls.root, label: controls.root });

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <p className="max-w-prose text-[12px] leading-relaxed text-neutral-300">
          <strong>Think of FinBERT as a desk reader who has read years of financial copy.</strong> Every headline the live hub sees (RSS feeds, Alpha Vantage, GDELT) is handed to it, and it returns how positive, negative and neutral the text reads. The <em>score</em> is positive minus negative, from -1 (clearly bad news) to +1. Scores are then <em>routed</em> to instruments (a Fed story reaches every index future, the Treasury curve and every dollar pair) and <em>added up on each bar, fading with age</em>: that sum, and eight other columns built the same way, are appended to the features of every model the dashboard trains.
        </p>
        <p className="text-[11px] text-neutral-500">
          The numbers come from the same algorithm the models use (lake.sentiment, ported and held to it by a parity test), over the curated lake plus today&apos;s spool. Bars are true UTC. This page does not run FinBERT: the live hub scores and lands the headlines.
        </p>
      </div>

      <ControlBar onReset={reset}>
        <SelectControl label="Instrument root" value={controls.root} options={rootOptions} onChange={(value) => set("root", value)} hint="Headlines the router sent to this instrument" />
        <SegmentControl label="Bar grid" value={controls.gridMinutes} options={GRIDS.map((grid) => ({ value: grid.value, label: grid.label }))} onChange={(value) => set("gridMinutes", value)} hint="The bar opens the nine columns are read at" />
        <DateInput label="Window start (UTC day)" value={controls.start} max={controls.end} onChange={(value) => set("start", value)} />
        <DateInput label="Window end (UTC day)" value={controls.end} min={controls.start} onChange={(value) => set("end", value)} />
        <SliderControl label="Histogram bins" value={controls.bins} min={10} max={60} step={5} onChange={(value) => set("bins", value)} />
      </ControlBar>

      <StudyState isLoading={query.isLoading} error={query.error}>
        <StudyNotes notes={query.data?.notes ?? []} />
        {body && features && (
          <>
            <div className="grid gap-2 grid-cols-2 xl:grid-cols-5">
              <Stat label="Distinct scored headlines" value={fmtInt(body.distinctHeadlineCount)} hint="In the window, one per article" />
              <Stat label="Routes" value={fmtInt(body.routeCount)} hint="Article x root rows in the window" />
              <Stat label="Stories feeding the sums" value={fmtInt(body.stories.length)} hint={`Distinct headlines from ${body.lookbackDays} days before the window to its end, syndicated copies counted once`} />
              <Stat label="Coverage spans" value={fmtInt(body.coverage.length)} hint="Merged spans when some source that reaches this root was collecting" />
              <Stat label="Bars on the grid" value={fmtInt(grid.times.length)} hint="Bar opens from the window start to now or the window end" />
            </div>
            {query.isFetching && <Finding>Reading the lake…</Finding>}

            <Headlines body={body} bins={controls.bins} coverageCount={body.coverage.length} />
            <Columns times={grid.times} features={features} gridMinutes={controls.gridMinutes} cursorIndex={grid.times.length === 0 ? -1 : barIndex} truncated={grid.truncated} />
            <Stepper
              stories={body.stories}
              times={grid.times}
              barIndex={barIndex}
              halfLifeMinutes={halfLife}
              defaultHalfLifeMinutes={defaultHalfLife}
              termCount={controls.term}
              onBar={(index) => set("bar", index)}
              onHalfLife={(minutes) => set("halfLife", minutes)}
              onTerm={(count) => set("term", count)}
            />
          </>
        )}
      </StudyState>
    </div>
  );
}
