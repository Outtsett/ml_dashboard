/**
 * The tile grid: one tile per example of the selected pattern, drawn in the
 * chosen view. A synthetic example has a dashed border and says so in words,
 * a bullish one carries ▲ and a bearish one ▼, so none of it rests on colour.
 * The notebook's widths are kept at tile size 1: 300 px (pattern), 192 px
 * (last 8 bars), 288 px (48-bar CNN input).
 */

import { Finding, OKABE } from "@/studies/kit";
import {
  PATTERN_CANVAS_BARS, SOURCE_LABEL, ZOOM_BARS, formatStamp, type GalleryExample,
} from "@shared/studies/candle-pattern-gallery";
import { CandleStrip } from "./candles";
import { ModelInput } from "./ModelInput";

export type GalleryView = "pattern" | "zoom8" | "model48";

export const VIEW_OPTIONS: ReadonlyArray<{ value: GalleryView; label: string }> = [
  { value: "pattern", label: "pattern (only the pattern's bars)" },
  { value: "zoom8", label: "zoom8 (last 8 bars)" },
  { value: "model48", label: "model48 (exact CNN input)" },
];

/** The notebook's image width per view, in CSS pixels at tile size 1. */
export const VIEW_WIDTH: Record<GalleryView, number> = { pattern: 300, zoom8: 192, model48: 288 };

export function ExampleView({ example, view, width, marker = null }: { example: GalleryExample; view: GalleryView; width: number; marker?: number | null }) {
  const bars = example.bars;
  if (bars.length === 0) return <p className="text-[11px] text-neutral-500">No bars landed for this example.</p>;
  if (view === "model48") return <ModelInput bars={bars} cssWidth={width} shadePattern marker={marker} />;
  if (view === "zoom8") {
    const last = bars.slice(-ZOOM_BARS);
    return (
      <div style={{ width, maxWidth: "100%" }}>
        <CandleStrip bars={last} slotWidth={24} priceHeight={216} volumeHeight={48} shadePattern />
      </div>
    );
  }
  const own = bars.slice(-example.pattern_bar_count);
  return (
    <div style={{ width, maxWidth: "100%" }}>
      <CandleStrip bars={own} slots={PATTERN_CANVAS_BARS} slotWidth={60} priceHeight={240} />
    </div>
  );
}

function Tile({ example, view, width, selected, onSelect }: { example: GalleryExample; view: GalleryView; width: number; selected: boolean; onSelect: () => void }) {
  const bullish = example.pattern_side === "bullish";
  return (
    <figure
      className={`m-0 flex flex-col gap-1 rounded-md border p-1.5 ${example.is_synthetic ? "border-dashed" : "border-solid"} ${selected ? "border-[#F0E442]" : "border-neutral-700"} bg-neutral-900/40`}
      style={{ width: width + 14, maxWidth: "100%" }}
    >
      <button type="button" onClick={onSelect} className="block text-left" aria-pressed={selected} title="Inspect this example below">
        <ExampleView example={example} view={view} width={width} />
      </button>
      <figcaption className="min-w-0 space-y-0.5 text-[10px]">
        <div className="truncate font-mono text-neutral-200" title={example.example_id}>{example.example_id}</div>
        <div className="flex flex-wrap items-center gap-x-2 text-neutral-400">
          <span style={{ color: bullish ? OKABE.orange : OKABE.blue }}>{bullish ? "▲ bullish" : "▼ bearish"}</span>
          <span>{SOURCE_LABEL[example.example_source]}</span>
          {example.bar_timestamp_ms !== null && <span className="font-mono">{formatStamp(example.bar_timestamp_ms)}</span>}
        </div>
      </figcaption>
    </figure>
  );
}

export function Gallery({
  pattern, examples, allCount, view, tileScale, selectedId, onSelect,
}: {
  pattern: string; examples: readonly GalleryExample[]; allCount: number; view: GalleryView; tileScale: number; selectedId: string | null; onSelect: (id: string) => void;
}) {
  const synthetic = examples.filter((example) => example.is_synthetic).length;
  const width = Math.round(VIEW_WIDTH[view] * tileScale);
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-semibold text-neutral-100">
        {pattern} — {examples.length} example{examples.length === 1 ? "" : "s"} ({synthetic} synthetic)
        {examples.length !== allCount && <span className="ml-2 font-normal text-neutral-500">of {allCount} before the filters</span>}
      </h4>
      <Finding>
        Hollow body = up bar, filled body = down bar. A synthetic example was constructed and checked to make the TA-Lib function fire, because the pattern
        never (or almost never) occurs in the real data; it has a dashed border and no clock.
      </Finding>
      {examples.length === 0 ? (
        <p className="text-xs text-neutral-500">No example matches the side and source filters.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {examples.map((example) => (
            <Tile key={example.example_id} example={example} view={view} width={width} selected={example.example_id === selectedId} onSelect={() => onSelect(example.example_id)} />
          ))}
        </div>
      )}
    </div>
  );
}
