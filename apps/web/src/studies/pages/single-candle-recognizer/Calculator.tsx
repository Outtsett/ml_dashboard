/**
 * The calculator: one candle (drawn from four sliders, or a real MNQ firing
 * from the lake) with the ten bars behind it, TA-Lib's thirteen rules run on
 * it, and the thresholds the context sets. The figure is SVG: orange = up
 * candle, blue = down candle, the ten bars behind it drawn faint.
 */

import {
  ControlBar, Finding, OKABE, SegmentControl, SelectControl, SliderControl, StudyState, SwitchControl, fmt, fmtInt, fmtTime,
} from "@/studies/kit";
import {
  PATTERN_RULES, SINGLE_CANDLE_PATTERNS, TRAILING_BARS, type CandleBar, type CandleEvaluation, type RealCandle, type SingleCandlePattern,
} from "@shared/studies/single-candle-recognizer";
import type { CandleView, Controls, SetControl } from "./controls";

const WIDTH = 640;
const HEIGHT = 380;
const MARGIN = { top: 16, right: 168, bottom: 34, left: 46 };

function niceStep(span: number): number {
  const raw = span / 6;
  const power = 10 ** Math.floor(Math.log10(raw));
  const fraction = raw / power;
  return (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * power;
}

interface Threshold {
  label: string;
  price: number;
}

export function CandleFigure({ bars, unit, evaluation, real }: { bars: CandleBar[]; unit: number; evaluation: CandleEvaluation; real: RealCandle | null }) {
  const current = bars[bars.length - 1] as CandleBar;
  const lowest = Math.min(...bars.map((bar) => bar.low));
  const highest = Math.max(...bars.map((bar) => bar.high));
  const pad = Math.max((highest - lowest) * 0.06, unit);
  const low = lowest - pad;
  const high = highest + pad;
  const plotWidth = WIDTH - MARGIN.left - MARGIN.right;
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const y = (price: number) => MARGIN.top + (1 - (price - low) / (high - low)) * plotHeight;
  const slot = plotWidth / bars.length;
  const x = (index: number) => MARGIN.left + slot * (index + 0.5);
  const tickStep = niceStep((high - low) / unit);
  const ticks: number[] = [];
  for (let tick = Math.ceil((low - lowest) / unit / tickStep) * tickStep; lowest + tick * unit <= high; tick += tickStep) ticks.push(tick);

  const thresholds: Threshold[] = [
    { label: "doji body ceiling", price: current.low + evaluation.averages.BodyDoji.value },
    { label: "long body floor", price: current.low + evaluation.averages.BodyLong.value },
    { label: "very short shadow ceiling", price: current.low + evaluation.averages.ShadowVeryShort.value },
  ].sort((a, b) => b.price - a.price);
  // Labels sit at the right margin, pushed apart so they stay readable.
  const labelY: number[] = [];
  thresholds.forEach((threshold, index) => {
    const wanted = y(threshold.price);
    labelY.push(index === 0 ? wanted : Math.max(wanted, (labelY[index - 1] as number) + 12));
  });

  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="mx-auto h-auto max-h-[440px] w-full" role="img" aria-label="The candle and the ten bars behind it, with the thresholds the ten bars set">
      {ticks.map((tick) => {
        const price = lowest + tick * unit;
        return (
          <g key={tick}>
            <line x1={MARGIN.left} x2={MARGIN.left + plotWidth} y1={y(price)} y2={y(price)} stroke="#262626" strokeWidth={1} />
            <text x={MARGIN.left - 6} y={y(price) + 3} textAnchor="end" fontSize={10} fill="#a3a3a3">{fmt(tick, tickStep < 1 ? 1 : 0)}</text>
          </g>
        );
      })}
      <text x={12} y={MARGIN.top + plotHeight / 2} fontSize={10} fill="#a3a3a3" transform={`rotate(-90 12 ${MARGIN.top + plotHeight / 2})`} textAnchor="middle">
        ticks above the lowest low
      </text>
      {thresholds.map((threshold, index) => (
        <g key={threshold.label}>
          <line x1={MARGIN.left} x2={MARGIN.left + plotWidth + 6} y1={y(threshold.price)} y2={y(threshold.price)} stroke={OKABE.grey} strokeDasharray="5 4" strokeWidth={1} />
          <text x={MARGIN.left + plotWidth + 10} y={(labelY[index] as number) + 3} fontSize={10} fill="#d4d4d4">
            {threshold.label} {fmt(((threshold.price - current.low) / unit), 2)}
          </text>
          <title>{`${threshold.label}: ${fmt((threshold.price - current.low) / unit, 3)} ticks above this candle's low`}</title>
        </g>
      ))}
      {bars.map((bar, index) => {
        const isCurrent = index === bars.length - 1;
        const up = bar.close >= bar.open;
        const colour = up ? OKABE.orange : OKABE.blue;
        const top = y(Math.max(bar.open, bar.close));
        const bottom = y(Math.min(bar.open, bar.close));
        const stamp = real?.bars[index]?.timestamp;
        return (
          <g key={index} opacity={isCurrent ? 1 : 0.42}>
            <line x1={x(index)} x2={x(index)} y1={y(bar.high)} y2={y(bar.low)} stroke={colour} strokeWidth={2} />
            <rect x={x(index) - slot * 0.3} width={slot * 0.6} y={top} height={Math.max(bottom - top, 1.5)} fill={colour} stroke={isCurrent ? "#fafafa" : colour} strokeWidth={isCurrent ? 1 : 0} />
            <title>
              {`${isCurrent ? "this candle" : `${bars.length - 1 - index} bars back`}${stamp ? ` ${fmtTime(stamp)}` : ""}: ${up ? "up" : "down"}, body ${fmt(Math.abs(bar.close - bar.open) / unit, 2)}, range ${fmt((bar.high - bar.low) / unit, 2)} ticks`}
            </title>
          </g>
        );
      })}
      <line x1={x(0) - slot * 0.35} x2={x(bars.length - 2) + slot * 0.35} y1={HEIGHT - 20} y2={HEIGHT - 20} stroke="#737373" />
      <text x={(x(0) + x(bars.length - 2)) / 2} y={HEIGHT - 6} textAnchor="middle" fontSize={10} fill="#a3a3a3">the {TRAILING_BARS} bars behind it (the context)</text>
      <text x={x(bars.length - 1)} y={HEIGHT - 6} textAnchor="middle" fontSize={10} fill="#e5e5e5">▶ this candle</text>
    </svg>
  );
}

function signalCell(pattern: SingleCandlePattern, signal: number | null | undefined) {
  if (signal === null || signal === undefined) return <span className="text-neutral-600">n/a</span>;
  if (signal === 0) return <span className="text-neutral-500">· no</span>;
  const signed = PATTERN_RULES[pattern].signed;
  if (signal > 0) return <span style={{ color: OKABE.orange }}>{signed ? "▲ +100" : "● 100"}</span>;
  return <span style={{ color: OKABE.blue }}>▼ −100</span>;
}

export function FiredTable({ view, stored }: { view: CandleView; stored: RealCandle["bars"][number]["stored"] | null }) {
  const { evaluation, shortcut } = view;
  return (
    <table className="w-full text-[11px]">
      <thead>
        <tr className="text-left text-neutral-500">
          <th className="py-0.5 font-normal">pattern</th>
          <th className="py-0.5 font-normal">TA-Lib arithmetic</th>
          {shortcut && <th className="py-0.5 font-normal" title="The notebook's shortcut: trailing body = range x |body fraction|, short shadow = half the trailing range">notebook shortcut</th>}
          {stored && <th className="py-0.5 font-normal" title="The lake's candlestick_<pattern> column for this bar">lake TA-Lib column</th>}
        </tr>
      </thead>
      <tbody>
        {SINGLE_CANDLE_PATTERNS.map((pattern) => {
          const signal = evaluation.signals[pattern];
          const shortcutFires = shortcut?.includes(pattern) ?? false;
          const disagrees = shortcut !== null && shortcutFires !== (signal !== 0);
          const storedSignal = stored?.[pattern];
          const storedDisagrees = stored !== null && storedSignal !== null && storedSignal !== undefined && storedSignal !== signal;
          return (
            <tr key={pattern} className="border-t border-neutral-900">
              <td className="py-0.5 font-mono text-neutral-200" title={PATTERN_RULES[pattern].text}>{pattern}</td>
              <td className="py-0.5 font-mono">{signalCell(pattern, signal)}</td>
              {shortcut && (
                <td className="py-0.5 font-mono" style={disagrees ? { color: OKABE.vermillion } : undefined}>
                  {shortcutFires ? "fires" : "·"}{disagrees ? " ≠" : ""}
                </td>
              )}
              {stored && (
                <td className="py-0.5 font-mono" style={storedDisagrees ? { color: OKABE.vermillion } : undefined}>
                  {signalCell(pattern, storedSignal)}{storedDisagrees ? " ≠" : ""}
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function CalculatorControls({ controls, set, real }: { controls: Controls; set: SetControl; real: { data: RealCandle | null; isLoading: boolean; error: unknown } }) {
  return (
    <div className="space-y-2">
      <ControlBar>
        <SegmentControl
          label="Candle from"
          value={controls.source}
          options={[{ value: "sliders", label: "sliders" }, { value: "real", label: "a real MNQ firing" }]}
          onChange={(value) => set("source", value)}
        />
        {controls.source === "sliders" ? (
          <>
            <SliderControl label="Signed body / range" value={controls.bodyFraction} min={-1} max={1} step={0.01} onChange={(v) => set("bodyFraction", v)} format={(v) => v.toFixed(2)} hint="Fraction of the candle's high - low taken by the body; negative is a down candle" />
            <SliderControl label="Upper shadow / range" value={controls.upperFraction} min={0} max={1} step={0.01} onChange={(v) => set("upperFraction", v)} format={(v) => v.toFixed(2)} />
            <SliderControl label="This candle's range (ticks)" value={controls.candleRangeTicks} min={1} max={200} onChange={(v) => set("candleRangeTicks", v)} />
            <SliderControl label="Previous 10 bars' range (ticks)" value={controls.trailingRangeTicks} min={1} max={200} onChange={(v) => set("trailingRangeTicks", v)} hint="Changes nothing about the candle: only how big the ten bars behind it were" />
            <SwitchControl label="Their body follows this candle's" checked={controls.tieTrailingBody} onChange={(v) => set("tieTrailingBody", v)} hint="The notebook's rule: previous bodies are range x |signed body| (0.3 x range at 0). Off: set it yourself" />
            {!controls.tieTrailingBody && (
              <SliderControl label="Their body / range" value={controls.trailingBodyFraction} min={0} max={1} step={0.01} onChange={(v) => set("trailingBodyFraction", v)} format={(v) => v.toFixed(2)} />
            )}
          </>
        ) : (
          <>
            <SelectControl label="Pattern that fired" value={controls.candlePattern} options={SINGLE_CANDLE_PATTERNS.map((p) => ({ value: p, label: p }))} onChange={(v) => set("candlePattern", v)} />
            <SegmentControl label="Bars" value={controls.candleTimeframe} options={["1m", "5m", "15m", "1h", "4h"].map((v) => ({ value: v, label: v }))} onChange={(v) => { set("candleTimeframe", v); set("candleIndex", 0); }} />
            <SliderControl
              label={`Firing number (of ${real.data ? fmtInt(real.data.firedCount) : "…"})`}
              value={Math.min(controls.candleIndex, Math.max(0, (real.data?.firedCount ?? 1) - 1))}
              min={0}
              max={Math.max(1, (real.data?.firedCount ?? 2) - 1)}
              onChange={(v) => set("candleIndex", v)}
              format={(v) => fmtInt(v + 1)}
              hint="The n-th time in history the lake's TA-Lib column fired this pattern, in time order"
            />
          </>
        )}
      </ControlBar>
      {controls.source === "real" && (
        <StudyState isLoading={real.isLoading && !real.data} error={real.error}>
          {real.data ? (
            <p className="text-[11px] text-neutral-400">
              {real.data.contractSymbol} · {fmtTime(real.data.bars[real.data.bars.length - 1]?.timestamp)} (the lake stamps futures in Pacific wall clock) · {real.data.sampleSplit ?? "no split"} · prices in index points, shown in ticks of 0.25
            </p>
          ) : (
            <p className="text-[11px] text-neutral-400">No firing found for that pattern and bar size; the sliders' candle is shown.</p>
          )}
        </StudyState>
      )}
    </div>
  );
}

export function CalculatorReadout({ view, real }: { view: CandleView; real: RealCandle | null }) {
  const { evaluation, unit, shortcut } = view;
  const fired = SINGLE_CANDLE_PATTERNS.filter((pattern) => evaluation.signals[pattern] !== 0);
  const shortcutFired = shortcut?.length ?? 0;
  const stored = view.realShown && real ? real.bars[real.bars.length - 1]?.stored ?? null : null;
  const agree = stored ? SINGLE_CANDLE_PATTERNS.filter((pattern) => stored[pattern] === null || stored[pattern] === undefined || stored[pattern] === evaluation.signals[pattern]).length : null;
  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold text-neutral-100">
        Fires here: {fired.length} of 13
        {shortcut && <span className="ml-2 text-[11px] font-normal text-neutral-400">(the notebook's shortcut: {shortcutFired})</span>}
        {agree !== null && <span className="ml-2 text-[11px] font-normal text-neutral-400">(agrees with the lake's TA-Lib column on {agree} of 13)</span>}
      </p>
      <table className="w-full text-[11px] font-mono tnum">
        <tbody>
          {[
            ["body", evaluation.body / unit],
            ["upper shadow", evaluation.upper / unit],
            ["lower shadow", evaluation.lower / unit],
            ["this candle's range", evaluation.range / unit],
            ["previous 10 bars' mean range", evaluation.averages.BodyDoji.yardstick / unit],
            ["doji body ceiling", evaluation.averages.BodyDoji.value / unit],
            ["long body floor", evaluation.averages.BodyLong.value / unit],
            ["very short shadow ceiling", evaluation.averages.ShadowVeryShort.value / unit],
          ].map(([label, value]) => (
            <tr key={label as string} className="border-t border-neutral-900">
              <td className="py-0.5 text-neutral-400">{label as string}</td>
              <td className="py-0.5 text-right text-neutral-200">{fmt(value as number, 2)} ticks</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Finding>
        Hold the shape sliders still and drag the previous-10-bars range: the candle does not move a pixel and the fired list changes. The label is a function of the candle and the ten bars in front of it, so a model shown only the candle is being asked a question its inputs do not contain.
      </Finding>
    </div>
  );
}
