/**
 * Section 1: a window of candles becomes 64 numbers, and a rescale or shift of
 * every price changes none of them. Section 1b: the average window of the
 * pattern beside the average of every bar.
 */

import { useState } from "react";
import {
  ControlBar, Empty, Finding, FormulaCard, OKABE, Section, SliderControl, StudyNotes, StudyState, fmt, fmtInt, useStudyQuery,
} from "@/studies/kit";
import { COMPONENTS, largestGap, shapeVector, type AnatomyBody } from "@shared/studies/candle-vectors";
import { CandleChart, CandleKey, MatrixHeatmap, PATTERN_STYLE, diverging, type CandleMark } from "./charts";
import type { TabProps } from "./controls";

const BARS_BACK = Array.from({ length: 16 }, (_, index) => 15 - index);

export function AnatomyTab({ controls, set }: TabProps) {
  const [term, setTerm] = useState(1);
  const query = useStudyQuery<AnatomyBody>("candle-vectors", {
    section: "anatomy", timeframe: controls.timeframe, pattern: controls.pattern, occurrence: controls.occurrence,
  });
  const body = query.data?.data;
  const bars = body?.bars ?? [];
  const recomputed = shapeVector(bars, controls.scale, controls.shift);
  const gap = recomputed && body ? largestGap(recomputed.vector, body.storedVector) : null;
  const moved = bars.map((bar) => ({
    ...bar,
    open: bar.open * controls.scale + controls.shift, high: bar.high * controls.scale + controls.shift,
    low: bar.low * controls.scale + controls.shift, close: bar.close * controls.scale + controls.shift,
  }));
  const window16 = moved.slice(-16);
  const candles: CandleMark[] = window16.map((bar, index) => ({
    x: index - 15, open: bar.open, high: bar.high, low: bar.low, close: bar.close,
    tip: [bar.time_label, `open ${fmt(bar.open, 2)}`, `high ${fmt(bar.high, 2)}`, `low ${fmt(bar.low, 2)}`, `close ${fmt(bar.close, 2)}`],
  }));
  const rangeTerms = moved.slice(-11, -1).reverse().map((bar, index) => ({ i: index + 1, value: bar.high - bar.low, label: bar.time_label }));
  const running = rangeTerms.slice(0, term).reduce((sum, item) => sum + item.value, 0);
  const lastClose = recomputed?.lastClose ?? null;
  const averageRange = recomputed?.averageRange ?? null;
  const cell = (price: string, barsBack: string) => {
    const row = recomputed?.vector[15 - Number(barsBack)];
    const index = COMPONENTS.indexOf(price as (typeof COMPONENTS)[number]);
    return row && index >= 0 ? (row[index] ?? null) : null;
  };
  const maximum = Math.max(2, body?.firingCount ?? 0);

  const average = body?.averageWindow ?? [];
  const averageCandles = (population: string): CandleMark[] => {
    const rows = average.filter((row) => row.population === population);
    return BARS_BACK.map((barsBack) => {
      const of = (price: string) => rows.find((row) => row.bars_back === barsBack && row.price === price)?.mean ?? Number.NaN;
      const candle = { open: of("open"), high: of("high"), low: of("low"), close: of("close") };
      return { x: -barsBack, ...candle, tip: [`${barsBack} bars back`, ...COMPONENTS.map((p) => `${p} ${fmt(candle[p], 3)}`)] };
    });
  };
  const count = (population: string) => average.find((row) => row.population === population)?.window_count ?? 0;

  return (
    <StudyState isLoading={query.isLoading} error={query.error}>
      <StudyNotes notes={query.data?.notes ?? []} />
      <Section title="1 · A window of candles becomes 64 numbers" question="Walk the 2025 firings; drag rescale and shift: every price on the left moves, none of the 64 numbers on the right does.">
        <ControlBar>
          <SliderControl label={`2025 firing (of ${fmtInt(body?.firingCount ?? 0)})`} value={Math.min(controls.occurrence, maximum)} min={1} max={maximum} onChange={(v) => set("occurrence", v)} />
          <SliderControl label="Rescale every price by" value={controls.scale} min={0.25} max={4} step={0.25} onChange={(v) => set("scale", v)} format={(v) => `${v.toFixed(2)}×`} />
          <SliderControl label="Shift every price by (points)" value={controls.shift} min={-5000} max={5000} step={250} onChange={(v) => set("shift", v)} format={(v) => `${v > 0 ? "+" : ""}${v}`} />
        </ControlBar>
        {!body?.landed ? <Empty>The candle windows for this timeframe are not in the lake.</Empty> : bars.length < 16 ? <Empty>No 2025 firing of this pattern here.</Empty> : (
          <div className="grid min-w-0 gap-3 xl:grid-cols-2">
            <div className="min-w-0 space-y-1">
              <CandleChart
                candles={candles} height={300} xDomain={[-15.5, 0.5]} xLabel="bars back from the last candle (0 = the pattern's last candle)" yLabel="price (points)"
                title={`${bars[bars.length - 1]?.time_label} · dashed = last close Cₜ, yellow band = ±Rₜ = ±${fmt(averageRange, 2)} points`}
                band={lastClose !== null && averageRange !== null ? { y1: lastClose - averageRange, y2: lastClose + averageRange, color: OKABE.yellow } : undefined}
                hLines={lastClose !== null ? [{ y: lastClose, color: "#e5e5e5", dash: "4 3" }] : []}
              />
              <CandleKey />
            </div>
            <div className="min-w-0 space-y-2">
              <div className="text-[11px] text-neutral-300">The 64 numbers the model sees (recomputed from the left chart), blue below the last close, orange above, clamped at ±4</div>
              <MatrixHeatmap
                rows={[...COMPONENTS]} columns={BARS_BACK.map(String)} value={cell} color={(v) => diverging(v, 4)}
                format={(v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}`} height={130} xLabel="bars back (k)"
                tip={(row, column) => [`${row}, ${column} bars back`, `x = ${fmt(cell(row, column), 3)} average ranges`]}
              />
              <FormulaCard
                tex={"x^{\\,p}_{t-k} = \\frac{P^{\\,p}_{t-k} - C_t}{R_t},\\qquad R_t = \\frac{1}{10}\\sum_{i=1}^{10}\\left(H_{t-i}-L_{t-i}\\right)"}
                caption={`k = 15 … 0 bars back; p ∈ {open, high, low, close}. Step the sum: after ${term} of 10 terms the running total is ${fmt(running, 2)} points.`}
                symbols={[
                  { tex: "P^{\\,p}_{t-k}", name: "price p of the bar k bars before the last", value: "the candles on the left" },
                  { tex: "C_t", name: "close of the pattern's last candle", value: fmt(lastClose, 2) },
                  { tex: `H_{t-${term}} - L_{t-${term}}`, name: `high minus low of the bar ${term} bars before the last (${rangeTerms[term - 1]?.label ?? "—"})`, value: `${fmt(rangeTerms[term - 1]?.value, 2)} points` },
                  { tex: "\\sum_{i=1}^{10}", name: "sum over the ten bars before the last", value: `running ${fmt(running, 2)} after i = ${term}` },
                  { tex: "R_t", name: "their mean range: the ruler every candle is measured with", value: `${fmt(averageRange, 3)} points` },
                  { tex: "x^{\\,p}_{t-k}", name: "one of the 64 numbers", value: "right-hand grid" },
                  { tex: "\\max|x - x_{\\text{lake}}|", name: "largest gap between these 64 numbers and the ones stored in the lake", value: gap === null ? "—" : gap.toExponential(2) },
                ]}
              />
              <SliderControl label="Sum term i" value={term} min={1} max={10} onChange={setTerm} hint="Step through the ten ranges that make Rₜ" />
            </div>
          </div>
        )}
        <Finding>
          Rescaling by {controls.scale.toFixed(2)}× and shifting by {controls.shift} points moves the ruler Rₜ with the prices, so the 64 numbers
          stay put (largest gap to the stored vector {gap === null ? "—" : gap.toExponential(1)}). That invariance is why one model can recognise a
          hammer on a 1-minute chart and on a 4-hour chart.
        </Finding>
      </Section>

      <Section title="1b · What the data says the pattern looks like, averaged" question="Each candle is the mean of the 64 numbers over every window of that kind, 2021-2025: a summary of the shape, not a candle that ever traded.">
        {average.length === 0 ? <Empty>No average window for this timeframe.</Empty> : (
          <div className="grid min-w-0 gap-3 xl:grid-cols-2">
            {[controls.pattern, "every bar"].map((population) => (
              <CandleChart key={population} candles={averageCandles(population)} height={240} xDomain={[-15.5, 0.5]} yDomain={[-4, 2]}
                format={(v) => fmt(v, 1)} xLabel="bars back from the last candle" yLabel="average ranges from the last close"
                title={`the average ${population === "every bar" ? "bar's" : `${PATTERN_STYLE[population]?.label ?? population}`} window (${fmtInt(count(population))} windows)`}
                hLines={[{ y: 0, color: "#737373", dash: "3 3" }]} />
            ))}
          </div>
        )}
        <CandleKey />
      </Section>
    </StudyState>
  );
}
