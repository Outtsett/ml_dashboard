/**
 * The 61 TA-Lib patterns, one picture each, cut from where they fired on MNQ 1-minute bars. Every
 * control works in the browser on the 88 landed pictures.
 */

import { useState } from "react";
import {
  ColumnGrid, ControlBar, Finding, OKABE, Section, SegmentControl, SelectControl, Stat, StudyNotes, StudyState,
  fmtInt, fmtTime, useStudyControls, useStudyQuery,
} from "@/studies/kit";
import type { PatternImage, PatternImagesBody } from "@shared/studies/candlestick-pattern-images";

const GLYPH: Record<PatternImage["direction"], string> = { bullish: "▲ bullish", bearish: "▼ bearish", neutral: "◆ neutral" };

function PatternCard({ variants }: { variants: PatternImage[] }) {
  const [index, setIndex] = useState(0);
  const shown = variants[Math.min(index, variants.length - 1)] as PatternImage;
  const fired = variants.some((v) => v.image_png_base64);
  return (
    <div className="flex flex-col rounded-md border border-neutral-800 bg-neutral-900/40 p-2 text-[11px]">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-[12px] text-neutral-100">{shown.pattern}</span>
        <span className="text-neutral-400">{shown.candle_count} candle{shown.candle_count > 1 ? "s" : ""}</span>
      </div>
      <div className="font-mono text-[10px] text-neutral-500">{shown.talib_function}</div>
      <div className="my-2 flex min-h-[150px] items-center justify-center rounded bg-white">
        {shown.image_png_base64 ? (
          <img src={`data:image/png;base64,${shown.image_png_base64}`} alt={`${shown.pattern} ${shown.direction}, ${shown.candle_count} candles`}
            className="max-h-[170px] max-w-full" />
        ) : (
          <span className="px-3 text-center text-neutral-600">{fired ? "this direction never fired" : "never fired on MNQ 1-minute bars 2021 → mid-2025"}</span>
        )}
      </div>
      {variants.length > 1 && (
        <div className="mb-1 flex gap-1">
          {variants.map((v, k) => (
            <button key={v.direction} type="button" onClick={() => setIndex(k)}
              className={`rounded border px-1.5 py-0.5 ${k === index ? "border-[#E69F00] text-[#E69F00]" : "border-neutral-700 text-neutral-400"}`}>
              {GLYPH[v.direction]}
            </button>
          ))}
        </div>
      )}
      {variants.length === 1 && <div className="mb-1 text-neutral-400">{GLYPH[shown.direction]}</div>}
      <div className="text-neutral-300">{fmtInt(shown.firings)} firings</div>
      {shown.signal_candle_timestamp !== null && (
        <div className="text-neutral-500">{fmtTime(shown.signal_candle_timestamp)} UTC · {shown.contract_symbol} · TA-Lib {shown.talib_value}</div>
      )}
    </div>
  );
}

export default function Page() {
  const [controls, set, reset] = useStudyControls({ candles: "all", sort: "candles", fired: "all" });
  const query = useStudyQuery<PatternImagesBody>("candlestick-pattern-images");
  const images = query.data?.data.images ?? [];
  const byPattern = new Map<string, PatternImage[]>();
  for (const row of images) byPattern.set(row.pattern, [...(byPattern.get(row.pattern) ?? []), row]);
  const groups = [...byPattern.values()]
    .map((variants) => [...variants].sort((a, b) => b.firings - a.firings))
    .filter((variants) => controls.candles === "all" || String(variants[0]?.candle_count) === controls.candles)
    .filter((variants) => controls.fired === "all" || variants.some((v) => v.image_png_base64))
    .sort((a, b) => {
      const x = a[0] as PatternImage, y = b[0] as PatternImage;
      if (controls.sort === "firings") return b.reduce((s, v) => s + v.firings, 0) - a.reduce((s, v) => s + v.firings, 0);
      if (controls.sort === "name") return x.pattern.localeCompare(y.pattern);
      return x.candle_count - y.candle_count || x.pattern.localeCompare(y.pattern);
    });
  const patterns = byPattern.size;
  const withPicture = [...byPattern.values()].filter((v) => v.some((r) => r.image_png_base64)).length;
  const countOf = (n: number) => [...byPattern.values()].filter((v) => v[0]?.candle_count === n).length;

  return (
    <div className="space-y-3">
      <StudyState isLoading={query.isLoading} error={query.error}>
        <StudyNotes notes={query.data?.notes ?? []} />
        <div className="grid gap-2 grid-cols-2 xl:grid-cols-6">
          <Stat label="Patterns" value={fmtInt(patterns)} />
          <Stat label="With a real firing" value={fmtInt(withPicture)} tone={OKABE.orange} />
          {[1, 2, 3, 4].map((n) => (
            <Stat key={n} label={`${n === 4 ? "4 – 5" : n} candle${n > 1 ? "s" : ""}`} value={fmtInt(n === 4 ? countOf(4) + countOf(5) : countOf(n))} />
          ))}
        </div>
        <Section title="Every pattern, one picture" question="Each picture is the real MNQ 1-minute firing whose candles have the most typical shape of all that pattern's firings — only the candles TA-Lib's rule reads. Hollow orange = rising candle, filled blue = falling.">
          <ControlBar onReset={reset}>
            <SegmentControl label="Candles in the pattern" value={controls.candles} onChange={(v) => set("candles", v)}
              options={[{ value: "all", label: "All" }, { value: "1", label: "1" }, { value: "2", label: "2" }, { value: "3", label: "3" }, { value: "4", label: "4" }, { value: "5", label: "5" }]} />
            <SelectControl label="Order" value={controls.sort} onChange={(v) => set("sort", v)}
              options={[{ value: "candles", label: "By candle count" }, { value: "name", label: "By name" }, { value: "firings", label: "Most firings first" }]} />
            <SegmentControl label="Show" value={controls.fired} onChange={(v) => set("fired", v)}
              options={[{ value: "all", label: "All 61" }, { value: "fired", label: "Fired only" }]} />
          </ControlBar>
          <Finding>
            A TA-Lib rule also compares its candles with the average of the 10 bars before them (how long is a long body, how short a doji),
            so the same shapes can fire or not depending on those bars; the pictures show the pattern itself. Hammer and hanging man are two
            candles here because TA-Lib's rule reads the candle before the hammer too.
          </Finding>
          <div className="mt-2 grid gap-2 grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6">
            {groups.map((variants) => <PatternCard key={variants[0]?.pattern} variants={variants} />)}
          </div>
        </Section>
        <ColumnGrid rows={images.map(({ firings, candle_count, distance_to_median_shape }) => ({ firings, candle_count, distance_to_median_shape }))} title="Every column" />
      </StudyState>
    </div>
  );
}
