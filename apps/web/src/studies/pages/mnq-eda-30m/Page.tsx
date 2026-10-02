/**
 * MNQ exploratory data analysis, the page that replaced the marimo notebook eda_mnq_1d.py.
 * Two page-wide choices, the bar size and which source of bars, sit at the top and in the
 * URL; every section below has its own controls and its own query (`?section=`), so a slider
 * recomputes only what it changes. Times are the lake's stamps: Pacific wall clock stored as UTC.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ControlBar, SegmentControl, SelectControl, useStudyControls } from "@/studies/kit";
import type { SeriesSource, Timeframe } from "@shared/studies/mnq-eda-30m";
import { AutocorrelationSection } from "./AutocorrelationSection";
import { ColumnProfiles } from "./ColumnProfiles";
import { FoldsSection } from "./FoldsSection";
import { LabelsSection } from "./LabelsSection";
import { PriceSection } from "./PriceSection";
import { ReturnsSection } from "./ReturnsSection";
import { StationaritySection } from "./StationaritySection";
import { SummarySection } from "./SummarySection";
import { TensorSection } from "./TensorSection";
import { VolatilitySection } from "./VolatilitySection";
import { WeekdaySection } from "./WeekdaySection";
import type { SeriesChoice } from "./use";

const TIMEFRAME_OPTIONS: Array<{ value: Timeframe; label: string }> = [
  { value: "5m", label: "5m" }, { value: "15m", label: "15m" }, { value: "30m", label: "30m" }, { value: "1h", label: "1h" }, { value: "4h", label: "4h" },
];

const SOURCE_OPTIONS: Array<{ value: SeriesSource; label: string }> = [
  { value: "full", label: "Full history (mnq_ohlcv)" },
  { value: "notebook", label: "Notebook loader (ohlcv)" },
];

/** Mounts its section (and so its query) when it nears the viewport, so the page does not ask for eleven bodies at once. */
function Lazy({ children, minHeight = 320 }: { children: ReactNode; minHeight?: number }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element || shown) return;
    if (typeof IntersectionObserver === "undefined") {
      setShown(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setShown(true);
        observer.disconnect();
      }
    }, { rootMargin: "500px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [shown]);
  return (
    <div ref={ref} style={shown ? undefined : { minHeight }}>
      {shown ? children : null}
    </div>
  );
}

export default function Page() {
  const [controls, set, reset] = useStudyControls({ timeframe: "30m", source: "full" });
  const choice: SeriesChoice = { timeframe: controls.timeframe as Timeframe, source: controls.source as SeriesSource };

  return (
    <div className="space-y-4">
      <ControlBar onReset={reset}>
        <SegmentControl label="Bar size" value={controls.timeframe} options={TIMEFRAME_OPTIONS} onChange={(v) => set("timeframe", v)} hint="The notebook is the 30-minute bar; the other sizes come from the same views" />
        <div className="w-72 max-w-full">
          <SelectControl label="Bars" value={controls.source} options={SOURCE_OPTIONS} onChange={(v) => set("source", v)} hint="The notebook's loader maps 30m to a shared view whose history is cut to 2023-03; its prose describes the full history" />
        </div>
      </ControlBar>
      <SummarySection choice={choice} />
      <PriceSection choice={choice} />
      <Lazy><ReturnsSection choice={choice} /></Lazy>
      <Lazy><StationaritySection choice={choice} /></Lazy>
      <Lazy><AutocorrelationSection choice={choice} /></Lazy>
      <Lazy><VolatilitySection choice={choice} /></Lazy>
      <Lazy><WeekdaySection choice={choice} /></Lazy>
      <Lazy><TensorSection choice={choice} /></Lazy>
      <Lazy><LabelsSection choice={choice} /></Lazy>
      <Lazy><FoldsSection choice={choice} /></Lazy>
      <Lazy><ColumnProfiles choice={choice} /></Lazy>
    </div>
  );
}
