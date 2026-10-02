/**
 * Candle pattern gallery. The server sends the 61-row summary and the
 * selected pattern's examples with their 48-bar windows (at most 29 x 48
 * bars); the view, side, source, tile size and inspected bar are applied here,
 * so moving those controls never waits on the lake.
 */

import {
  ColumnGrid, ControlBar, Finding, Section, SegmentControl, SelectControl, SliderControl, Stat, StudyNotes, StudyState,
  fmtInt, useStudyControls, useStudyQuery,
} from "@/studies/kit";
import type { GalleryBody } from "@shared/studies/candle-pattern-gallery";
import { Gallery, VIEW_OPTIONS, type GalleryView } from "./Gallery";
import { Inspector, type PriceField } from "./Inspector";
import { Summary } from "./Summary";

const DEFAULT_PATTERN = "CDLENGULFING";

export default function Page() {
  const [controls, set, reset] = useStudyControls({
    pattern: DEFAULT_PATTERN,
    view: "pattern",
    side: "both",
    source: "all",
    tileScale: 1,
    example: "",
    bar: 47,
    field: "close",
    top: 30,
    logScale: false,
  });
  const query = useStudyQuery<GalleryBody>("candle-pattern-gallery", { pattern: controls.pattern });
  const body = query.data?.data;
  const summary = body?.summary ?? [];
  const pattern = body?.pattern ?? controls.pattern;
  const examples = body?.examples ?? [];

  const visible = examples.filter(
    (example) =>
      (controls.side === "both" || example.pattern_side === controls.side) &&
      (controls.source === "all" || (controls.source === "real" ? !example.is_synthetic : example.is_synthetic)),
  );
  const selected = examples.find((example) => example.example_id === controls.example) ?? visible[0] ?? null;
  const view = controls.view as GalleryView;

  const realExamples = summary.reduce((sum, row) => sum + row.real_example_count, 0);
  const syntheticExamples = summary.reduce((sum, row) => sum + row.random_search_synthetic_example_count + row.textbook_synthetic_example_count, 0);
  const patternOptions = (summary.length > 0 ? summary : [{ talib_function: controls.pattern, example_count: 0 }]).map((row) => ({
    value: row.talib_function,
    label: `${row.talib_function} (${row.example_count})`,
  }));

  const pickPattern = (next: string) => {
    set("pattern", next);
    set("example", "");
  };

  return (
    <div className="space-y-3">
      <StudyState isLoading={query.isLoading} error={query.error}>
        <StudyNotes notes={query.data?.notes ?? []} />

        <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
          <Stat label="Patterns" value={fmtInt(summary.length)} hint="The 61 TA-Lib candlestick functions" />
          <Stat label="Real examples" value={fmtInt(realExamples)} hint="Real MNQ 5-minute firings, spread across 2019 to 2025, up to 12 per side per pattern" />
          <Stat label="Synthetic examples" value={fmtInt(syntheticExamples)} hint="Constructed and verified to make TA-Lib fire; for the patterns the real data rarely or never shows" />
          <Stat label="Bars per example" value="48" hint="The window the chart-CNN is given; the other two views crop it" />
        </div>

        <ControlBar onReset={reset}>
          <SelectControl label="Pattern" value={pattern} options={patternOptions} onChange={pickPattern} hint="One of the 61 TA-Lib candlestick functions; the number is how many examples it has" />
          <SelectControl label="View" value={view} options={VIEW_OPTIONS} onChange={(next) => set("view", next)} hint="How each example is drawn" />
          <SegmentControl
            label="Side"
            value={controls.side}
            options={[{ value: "both", label: "both" }, { value: "bullish", label: "▲ bullish" }, { value: "bearish", label: "▼ bearish" }]}
            onChange={(next) => set("side", next)}
          />
          <SegmentControl
            label="Source"
            value={controls.source}
            options={[{ value: "all", label: "all" }, { value: "real", label: "real" }, { value: "synthetic", label: "synthetic" }]}
            onChange={(next) => set("source", next)}
          />
          <SliderControl label="Tile size" value={controls.tileScale} min={0.5} max={2} step={0.1} onChange={(next) => set("tileScale", next)} format={(value) => `${value.toFixed(1)}×`} />
        </ControlBar>

        <Section
          title={`${pattern || "Pattern"} in the three views`}
          question="The notebook's dropdown and radio buttons, with all three views drawn from the same landed 48-bar windows. Click a tile to inspect it."
        >
          <Gallery
            pattern={pattern}
            examples={visible}
            allCount={examples.length}
            view={view}
            tileScale={controls.tileScale}
            selectedId={selected?.example_id ?? null}
            onSelect={(id) => set("example", id)}
          />
        </Section>

        <Inspector
          pattern={pattern}
          example={selected}
          barPosition={controls.bar}
          priceField={controls.field as PriceField}
          onBar={(position) => set("bar", position)}
          onField={(field) => set("field", field)}
        />

        <Summary
          rows={summary}
          selected={pattern}
          onPick={pickPattern}
          top={controls.top}
          onTop={(next) => set("top", next)}
          logScale={controls.logScale}
          onLogScale={(next) => set("logScale", next)}
        />

        <Section title="Every column" question="Each numeric column of the two frames behind this page, with its eight numbers.">
          <div className="space-y-4">
            <ColumnGrid rows={summary} title="Summary table: one row per pattern" />
            <ColumnGrid
              rows={examples.flatMap((example) => example.bars)}
              exclude={["bar_offset", "bar_timestamp_ms"]}
              title={`Bars of ${pattern}'s ${examples.length} examples (absolute prices and volume)`}
            />
          </div>
        </Section>

        <Finding>
          Times are the lake's stamps, which for futures are Pacific wall clock stored as UTC. The notebook's example ids (for example 20191002_1315_bear) read that stamp as
          true UTC and shifted it to New York, so the hour in an id runs four to five hours earlier than the stamp shown here. The ids themselves are unchanged.
          Prices are absolute and labelled as such; every view scales a window to its own range, so a level never enters a comparison between examples.
        </Finding>
      </StudyState>
    </div>
  );
}
