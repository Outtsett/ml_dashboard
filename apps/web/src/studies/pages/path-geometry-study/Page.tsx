/**
 * Path geometry study. Sections 1 to 3 (efficiency ratio), 5 (direction labels)
 * are live SQL over the bars in view; section 4 reads the landed forecast
 * results. Every control is in the URL; the server controls are settled for
 * 400 ms before a request so dragging a slider does not fire one per pixel.
 */

import { useEffect, useState } from "react";
import {
  ColumnGrid, ControlBar, Section, SliderControl, Stat, StudyNotes, StudyState, fmt, fmtInt, fmtTime, useStudyControls, useStudyQuery,
} from "@/studies/kit";
import { FRAME_ROWS, type PathGeometryBody } from "@shared/studies/path-geometry-study";
import { DEFAULT_CONTROLS, serverControls, type Controls, type Setter } from "./controls";
import { Geometry } from "./Geometry";
import { Labels } from "./Labels";
import { Results } from "./Results";

export default function Page() {
  const [controls, set, reset] = useStudyControls(DEFAULT_CONTROLS);
  const key = JSON.stringify(serverControls(controls));
  const [settled, setSettled] = useState(key);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(key), 400);
    return () => clearTimeout(timer);
  }, [key]);
  const query = useStudyQuery<PathGeometryBody>("path-geometry-study", JSON.parse(settled) as Record<string, string | number>);
  const body = query.data?.data;
  const pending = settled !== key || query.isFetching;
  const setter: Setter = (name, value) => set(name, value as Controls[typeof name]);

  return (
    <div className="space-y-3">
      <ControlBar onReset={reset}>
        <SliderControl
          label="Bars in view"
          value={controls.bars}
          min={50_000}
          max={2_400_000}
          step={50_000}
          onChange={(value) => set("bars", value)}
          format={(value) => `${fmtInt(value)}${value >= 2_344_645 ? " (all)" : ""}`}
          hint="The most recent N one-minute bars; the notebook read 400,000"
        />
        <span className="self-end pb-1 text-[11px] text-neutral-500">{pending ? "Reading the lake…" : "Every control below is kept in the URL."}</span>
      </ControlBar>
      <StudyState isLoading={query.isLoading} error={query.error}>
        <StudyNotes notes={query.data?.notes ?? []} />
        {body && (
          <>
            <div className="grid gap-2 grid-cols-2 xl:grid-cols-4">
              <Stat label="Bars in view" value={fmtInt(body.bars.loaded)} hint={`${fmtInt(body.bars.available)} MNQ one-minute bars pass the loader's filters`} />
              <Stat label="From (as stamped)" value={fmtTime(body.bars.firstMs)} hint="Futures stamps in the lake are Pacific wall clock stored as UTC" />
              <Stat label="To (as stamped)" value={fmtTime(body.bars.lastMs)} />
              <Stat label="Forecast rows per target" value={body.targets.length > 0 ? fmtInt(Math.max(...body.targets.map((row) => row.training_row_count))) : "—"} hint="Landed results: 34 features, 5 purged folds, horizon 60" />
            </div>
            <Geometry body={body} controls={controls} set={setter} />
            <Results body={body} controls={controls} set={setter} />
            <Labels body={body} controls={controls} set={setter} />
            <Section title="Every column" question={`The bar frame is ${fmtInt(body.frame.rows.length)} bars thinned to every ${fmtInt(body.frame.step)}th of ${fmtInt(body.bars.loaded)} (at most ${fmtInt(FRAME_ROWS)}), so each histogram and its eight numbers describe the sample; the landed result tables are shown whole.`}>
              <div className="space-y-4">
                <ColumnGrid rows={body.frame.rows} title={`Bar frame: ${fmtInt(body.frame.rows.length)} sampled bars`} />
                <ColumnGrid rows={body.targets} exclude={["horizon_bars", "purge_bars", "fold_count", "fold_months", "feature_count"]} title={`Forecast results per target (${fmt(body.targets.length, 0)} rows)`} />
                <ColumnGrid rows={body.folds} exclude={["fold"]} title={`Forecast results per fold (${fmt(body.folds.length, 0)} rows)`} />
              </div>
            </Section>
          </>
        )}
      </StudyState>
    </div>
  );
}
