/**
 * One example in full: the three views side by side, the whole 48-bar window
 * with the pattern's bars shaded, and the arithmetic that turns a price into a
 * pixel row of the network's input (render.py) with every symbol carrying the
 * value it holds for the bar and price chosen below. The slider moves the
 * inspected bar through the window; the raster outlines its three columns and
 * draws the row the chosen price lands on.
 */

import {
  ControlBar, FormulaCard, Section, SegmentControl, SliderControl, fmt, fmtInt, type FormulaSymbol,
} from "@/studies/kit";
import {
  MODEL_INPUT, SOURCE_LABEL, formatStamp, modelInputRow, modelInputScale, modelInputVolumeRows,
  type GalleryExample,
} from "@shared/studies/candle-pattern-gallery";
import { CandleStrip } from "./candles";
import { ExampleView } from "./Gallery";
import { ModelInput } from "./ModelInput";

export type PriceField = "open" | "high" | "low" | "close";
export const PRICE_FIELDS: ReadonlyArray<{ value: PriceField; label: string }> = [
  { value: "open", label: "open" },
  { value: "high", label: "high" },
  { value: "low", label: "low" },
  { value: "close", label: "close" },
];

export function Inspector({
  pattern, example, barPosition, priceField, onBar, onField,
}: {
  pattern: string; example: GalleryExample | null; barPosition: number; priceField: PriceField; onBar: (position: number) => void; onField: (field: PriceField) => void;
}) {
  if (!example || example.bars.length !== MODEL_INPUT.bars) {
    return (
      <Section title="Inspect one example" question="Choose a tile above.">
        <p className="text-xs text-neutral-500">No example with a full 48-bar window is selected.</p>
      </Section>
    );
  }
  const position = Math.min(MODEL_INPUT.bars - 1, Math.max(0, barPosition));
  const bar = example.bars[position]!;
  const scale = modelInputScale(example.bars);
  const price = bar[priceField];
  const row = modelInputRow(price, scale.windowLow, scale.windowRange);
  const volumeRows = modelInputVolumeRows(bar.volume, scale.windowMaximumVolume);
  const symbols: FormulaSymbol[] = [
    { tex: "r(p)", name: "pixel row of the price, counted down from the top of the image", value: `row ${row} of 0 to ${MODEL_INPUT.pricePixels - 1}` },
    { tex: "p", name: `the price being placed: bar ${bar.bar_offset}'s ${priceField}`, value: fmt(price, 4) },
    { tex: "L", name: "lowest low among the 48 bars", value: fmt(scale.windowLow, 4) },
    { tex: "R", name: "range of the 48 bars: highest high minus L (never below 1e-9)", value: fmt(scale.windowRange, 4) },
    { tex: "H_p", name: "rows the image gives to price", value: String(MODEL_INPUT.pricePixels) },
    { tex: "\\lfloor\\cdot\\rfloor", name: "round down to a whole pixel (drop the fraction)", value: "" },
    { tex: "h_v", name: "pixel rows this bar's volume fills, rising from the bottom edge", value: String(volumeRows + 1) },
    { tex: "v", name: `bar ${bar.bar_offset}'s volume`, value: fmtInt(bar.volume) },
    { tex: "v_{\\max}", name: "largest volume among the 48 bars", value: fmtInt(scale.windowMaximumVolume) },
    { tex: "H_v", name: "rows the image gives to volume", value: String(MODEL_INPUT.volumePixels) },
  ];
  const clock = example.bar_timestamp_ms === null ? "a constructed series has no clock" : `fired at ${formatStamp(example.bar_timestamp_ms)} (lake clock)`;

  return (
    <Section
      title={`Inspect ${example.example_id}`}
      question={`${pattern} · ${example.pattern_side} · ${SOURCE_LABEL[example.example_source]} · ${example.pattern_bar_count} bar${example.pattern_bar_count === 1 ? "" : "s"} · ${clock}`}
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-start gap-3">
          <figure className="m-0 space-y-1">
            <ExampleView example={example} view="pattern" width={240} />
            <figcaption className="text-[10px] text-neutral-400">pattern (only the pattern's bars)</figcaption>
          </figure>
          <figure className="m-0 space-y-1">
            <ExampleView example={example} view="zoom8" width={192} />
            <figcaption className="text-[10px] text-neutral-400">zoom8 (last 8 bars, volume below)</figcaption>
          </figure>
          <figure className="m-0 space-y-1">
            <ModelInput bars={example.bars} cssWidth={432} shadePattern marker={position} guideRows={[row]} onSelectBar={onBar} />
            <figcaption className="text-[10px] text-neutral-400">
              model48: the exact 144 × 94 image the chart-CNN is given. Blue shading = the pattern's bars, yellow outline = the inspected bar, orange line = the row its {priceField} lands on. Click a column to inspect it.
            </figcaption>
          </figure>
        </div>

        <div className="space-y-1">
          <div className="text-[11px] text-neutral-400">All 48 bars ending at the firing bar (blue shading = the pattern's own bars; hollow = up, filled = down; click a bar to inspect it).</div>
          <CandleStrip bars={example.bars} slotWidth={14} priceHeight={200} volumeHeight={50} shadePattern marker={position} onSelectBar={onBar} />
        </div>

        <ControlBar>
          <SliderControl
            label="Inspected bar"
            value={position}
            min={0}
            max={MODEL_INPUT.bars - 1}
            onChange={onBar}
            format={(value) => `${value - (MODEL_INPUT.bars - 1)} (${bar.bar_timestamp_ms === null ? "no clock" : formatStamp(bar.bar_timestamp_ms)})`}
            hint="0 to 47 along the window; the last is the bar the pattern fired on (bar 0)"
          />
          <SegmentControl label="Price placed" value={priceField} options={PRICE_FIELDS} onChange={onField} />
        </ControlBar>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-0.5 font-mono text-[11px] tnum sm:grid-cols-5">
          {([["open", bar.open], ["high", bar.high], ["low", bar.low], ["close", bar.close]] as const).map(([name, value]) => (
            <div key={name} className="flex justify-between gap-2">
              <dt className="text-neutral-500">{name}</dt>
              <dd className={priceField === name ? "text-[#F0E442]" : "text-neutral-200"}>{fmt(value, 2)}</dd>
            </div>
          ))}
          <div className="flex justify-between gap-2">
            <dt className="text-neutral-500">volume</dt>
            <dd className="text-neutral-200">{fmtInt(bar.volume)}</dd>
          </div>
        </dl>

        <FormulaCard
          tex={"r(p) = H_p - 1 - \\left\\lfloor \\frac{p - L}{R}\\,(H_p - 1) \\right\\rfloor \\qquad h_v = \\left\\lfloor \\frac{v}{v_{\\max}}\\,(H_v - 1) \\right\\rfloor + 1"}
          symbols={symbols}
          caption="How render.py places bar i: the high-to-low wick fills column 3i + 1 between r(high) and r(low), the open ticks column 3i, the close ticks column 3i + 2, and volume rises on column 3i + 1 from the bottom edge. The window is scaled to its own range, so absolute price never reaches the network."
        />
      </div>
    </Section>
  );
}
