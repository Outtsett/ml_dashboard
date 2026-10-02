/**
 * MNQ candle vectors (replaced datalake/notebooks/mnq_candle_vectors.py).
 * The three pickers at the top drive every tab, as the notebook's did; each
 * tab reads only its own section of GET /api/studies/candle-vectors.
 */

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import {
  ControlBar, SegmentControl, SelectControl, Stat, StudyNotes, StudyState, fmt, useStudyControls, useStudyQuery,
} from "@/studies/kit";
import { PATTERNS, type OverviewBody } from "@shared/studies/candle-vectors";
import { DEFAULTS, type Controls, type SetControl } from "./controls";
import { AnatomyTab } from "./AnatomyTab";
import { RecogniserTab } from "./RecogniserTab";
import { NeighboursTab } from "./NeighboursTab";
import { PathsTab } from "./PathsTab";
import { ColumnsTab } from "./ColumnsTab";
import { LearnedTab } from "./LearnedTab";
import { NextTab } from "./NextTab";
import { PATTERN_STYLE, Glyph } from "./charts";

const TABS = [
  { value: "anatomy", label: "1 · Vector anatomy" },
  { value: "recogniser", label: "2–3 · Recogniser" },
  { value: "neighbours", label: "4, 6, 7 · Neighbours" },
  { value: "paths", label: "5 · Paths and context" },
  { value: "columns", label: "8 · Every column" },
  { value: "learned", label: "9 · Learned shapes" },
  { value: "next", label: "10 · Next candles" },
] as const;

function range(pair: [number, number] | null, decimals: number): string {
  return pair ? `${fmt(pair[0], decimals)}–${fmt(pair[1], decimals)}` : "—";
}

function Headline() {
  const query = useStudyQuery<OverviewBody>("candle-vectors", { section: "overview" });
  const tiles = query.data?.data.tiles;
  return (
    <StudyState isLoading={query.isLoading} error={query.error}>
      <StudyNotes notes={query.data?.notes ?? []} />
      {tiles && (
        <div className="grid gap-2 grid-cols-2 xl:grid-cols-3">
          <Stat label="Recogniser, 2025 1m, average precision" value={range(tiles.heldOutAveragePrecision, 2)} hint="7 patterns; 1.0 = finds every one with no false alarms" />
          <Stat label="Same model on 1h / 4h it never saw: area under the ROC curve" value={range(tiles.transferAreaUnderCurve, 2)}
            hint={`average precision ${range(tiles.transferAveragePrecision, 2)}; the 1m-tuned threshold misses most 1h/4h shooting stars`} />
          <Stat label="Nearest-neighbour vote on direction" value={fmt(tiles.neighbourMedianAreaUnderCurve, 3)} hint={`median area under the ROC curve over ${tiles.neighbourTests} tests; 0.5 = coin flip`} />
          <Stat label="Neighbour votes beating the null" value={`${tiles.neighbourSignificant} of ${tiles.neighbourTests}`} hint="Benjamini-Hochberg q < 0.10, k = 50" />
          <Stat label="1m: the last bar reversing, 1 bar ahead" value={range(tiles.reversalAreaUnderCurve, 3)} hint="area under the ROC curve on random 2025 bars: small, real, and not what the neighbours find" />
          <Stat label="Vector index (HNSW, hierarchical navigable small world) recall at 50 neighbours, worst corpus" value={fmt(tiles.worstRecallAt50, 3)} hint="against an exact scan, 500 queries each" />
        </div>
      )}
    </StudyState>
  );
}

export default function Page() {
  const [controls, setRaw, reset] = useStudyControls(DEFAULTS);
  const set: SetControl = setRaw;
  const tabProps = { controls: controls as Controls, set };
  return (
    <div className="min-w-0 space-y-3">
      <p className="max-w-prose text-[12px] leading-relaxed text-neutral-300">
        <b>A model is never told the rule.</b> It is shown candles as numbers, and a hammer becomes a <i>region</i> of that number
        space: the place where every window TA-Lib calls a hammer lands. Every price in a 16-bar window is written as its
        distance from the last close in units of the mean high-low range of the ten bars before it, so a calm night and a
        violent open look alike when their shapes are alike, and no price level appears anywhere. Five years of front-month
        MNQ (2021–2025): train on 2021–2023, tune on 2024, score on 2025.
      </p>
      <ControlBar onReset={reset}>
        <SegmentControl label="Timeframe" value={controls.timeframe} options={[{ value: "1m", label: "1 minute" }, { value: "1h", label: "1 hour" }, { value: "4h", label: "4 hours" }]} onChange={(v) => set("timeframe", v)} />
        <SelectControl label="Pattern" value={controls.pattern} options={PATTERNS.map((p) => ({ value: p, label: PATTERN_STYLE[p]?.label ?? p }))} onChange={(v) => { set("pattern", v); set("occurrence", 1); set("neighbourOccurrence", 1); set("shapeOccurrence", 1); }} />
        <SegmentControl label="Horizon" value={controls.horizon} options={[{ value: 1, label: "1 bar ahead" }, { value: 4, label: "4 bars ahead" }, { value: 12, label: "12 bars ahead" }]} onChange={(v) => set("horizon", v)} />
        <span className="self-center text-[11px] text-neutral-400">
          <Glyph glyph={PATTERN_STYLE[controls.pattern]?.glyph ?? "circle"} color={PATTERN_STYLE[controls.pattern]?.color ?? "#999"} /> {PATTERN_STYLE[controls.pattern]?.label}
        </span>
      </ControlBar>
      <Headline />
      <Tabs value={controls.tab} onValueChange={(v) => set("tab", v)} className="min-w-0">
        <TabsList className="flex h-auto flex-wrap justify-start">
          {TABS.map((tab) => <TabsTrigger key={tab.value} value={tab.value} className="text-xs">{tab.label}</TabsTrigger>)}
        </TabsList>
        <TabsContent value="anatomy" className="space-y-3">{controls.tab === "anatomy" && <AnatomyTab {...tabProps} />}</TabsContent>
        <TabsContent value="recogniser" className="space-y-3">{controls.tab === "recogniser" && <RecogniserTab {...tabProps} />}</TabsContent>
        <TabsContent value="neighbours" className="space-y-3">{controls.tab === "neighbours" && <NeighboursTab {...tabProps} />}</TabsContent>
        <TabsContent value="paths" className="space-y-3">{controls.tab === "paths" && <PathsTab {...tabProps} />}</TabsContent>
        <TabsContent value="columns" className="space-y-3">{controls.tab === "columns" && <ColumnsTab {...tabProps} />}</TabsContent>
        <TabsContent value="learned" className="space-y-3">{controls.tab === "learned" && <LearnedTab {...tabProps} />}</TabsContent>
        <TabsContent value="next" className="space-y-3">{controls.tab === "next" && <NextTab {...tabProps} />}</TabsContent>
      </Tabs>
    </div>
  );
}
