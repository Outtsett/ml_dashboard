/**
 * One exemplar: the real candles around a firing (the pattern's own bars solid
 * on a band, the bars before them faded so the prior trend stays visible) and
 * the firing's shape as three bars in fractions of its own range, beside the
 * pattern's archetype. Up candles are orange and filled, down candles blue and
 * hollow, so the direction never rests on colour alone.
 */

import { CANDLE_DOWN_COLOR, CANDLE_UP_COLOR } from "@/market/components/chartConfig";
import { OKABE, fmt } from "@/studies/kit";
import type { FiringRow, WindowBar } from "@shared/studies/candlestick-pattern-exemplars";

const WIDTH = 200;
const HEIGHT = 110;
const PAD_TOP = 6;
const PAD_BOTTOM = 6;
/** Bars of context drawn before the pattern's own bars. */
export const CONTEXT_BARS_DRAWN = 2;

export const SHAPE_COMPONENTS = [
  { key: "upper", label: "upper shadow", color: OKABE.sky },
  { key: "body", label: "body", color: OKABE.orange },
  { key: "lower", label: "lower shadow", color: OKABE.blue },
] as const;

export function shapeOf(row: Pick<FiringRow, "body_fraction_of_range" | "upper_shadow_fraction_of_range" | "lower_shadow_fraction_of_range">) {
  return {
    body: row.body_fraction_of_range,
    upper: row.upper_shadow_fraction_of_range,
    lower: row.lower_shadow_fraction_of_range,
  };
}

function Candles({ bars, patternBars, label }: { bars: readonly WindowBar[]; patternBars: number; label: string }) {
  const shown = bars.filter((bar) => bar.bar_offset >= -(patternBars - 1) - CONTEXT_BARS_DRAWN);
  if (shown.length === 0) return <div className="h-[110px] rounded bg-black/40" aria-label={label} />;
  let low = Infinity;
  let high = -Infinity;
  for (const bar of shown) {
    low = Math.min(low, bar.absolute_low_price);
    high = Math.max(high, bar.absolute_high_price);
  }
  const span = high - low || 1;
  const y = (price: number) => PAD_TOP + ((high - price) / span) * (HEIGHT - PAD_TOP - PAD_BOTTOM);
  const slot = WIDTH / shown.length;
  const bodyWidth = Math.max(4, Math.min(22, slot * 0.55));
  const patternStart = shown.findIndex((bar) => bar.bar_offset > -patternBars);
  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="block w-full rounded bg-black/40" role="img" aria-label={label}>
      {patternStart >= 0 && <rect x={patternStart * slot} y={0} width={WIDTH - patternStart * slot} height={HEIGHT} fill="rgba(255,255,255,0.06)" />}
      {shown.map((bar, position) => {
        const rising = bar.absolute_close_price >= bar.absolute_open_price;
        const colour = rising ? CANDLE_UP_COLOR : CANDLE_DOWN_COLOR;
        const centre = slot * position + slot / 2;
        const top = y(Math.max(bar.absolute_open_price, bar.absolute_close_price));
        const bottom = y(Math.min(bar.absolute_open_price, bar.absolute_close_price));
        const isPattern = bar.bar_offset > -patternBars;
        return (
          <g key={bar.bar_offset} opacity={isPattern ? 1 : 0.4}>
            <title>
              {`offset ${bar.bar_offset}: open ${bar.absolute_open_price}, high ${bar.absolute_high_price}, low ${bar.absolute_low_price}, close ${bar.absolute_close_price}`}
            </title>
            <line x1={centre} x2={centre} y1={y(bar.absolute_high_price)} y2={y(bar.absolute_low_price)} stroke={colour} strokeWidth={1.4} />
            <rect
              x={centre - bodyWidth / 2}
              y={top}
              width={bodyWidth}
              height={Math.max(1.5, bottom - top)}
              fill={rising ? colour : "rgba(0,114,178,0.18)"}
              stroke={colour}
              strokeWidth={1.2}
            />
          </g>
        );
      })}
    </svg>
  );
}

function ShapeBars({ shape, archetype }: { shape: ReturnType<typeof shapeOf>; archetype: ReturnType<typeof shapeOf> | null }) {
  return (
    <div className="space-y-0.5">
      {SHAPE_COMPONENTS.map((component) => {
        const value = shape[component.key];
        const reference = archetype?.[component.key] ?? null;
        return (
          <div key={component.key} className="grid grid-cols-[4.2rem_1fr_2.6rem] items-center gap-1 text-[10px]">
            <span className="truncate text-neutral-400">{component.label}</span>
            <div className="relative h-2 rounded-sm bg-neutral-800" title={`${component.label}: ${fmt(value, 3)} of the bar's range${reference === null ? "" : `; archetype ${fmt(reference, 3)}`}`}>
              <div className="absolute inset-y-0 left-0 rounded-sm" style={{ width: `${Math.min(100, Math.max(0, (value ?? 0) * 100))}%`, background: component.color }} />
              {reference !== null && <div className="absolute -inset-y-0.5 w-px bg-neutral-100" style={{ left: `${Math.min(100, Math.max(0, reference * 100))}%` }} />}
            </div>
            <span className="text-right font-mono tnum text-neutral-200">{fmt(value, 3)}</span>
          </div>
        );
      })}
    </div>
  );
}

const TREND_GLYPH: Record<string, string> = { up: "↑ up", down: "↓ down", sideways: "↔ sideways", unknown: "? unknown" };

export function ExemplarPanel({
  firing, bars, patternBars, archetype, selected, onSelect,
}: {
  firing: FiringRow;
  bars: readonly WindowBar[];
  patternBars: number;
  archetype: ReturnType<typeof shapeOf> | null;
  selected: boolean;
  onSelect: () => void;
}) {
  const agrees = firing.prior_trend_direction === firing.required_prior_trend;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`min-w-0 space-y-1.5 rounded-md border p-2 text-left ${selected ? "border-[#56B4E9] bg-neutral-900" : "border-neutral-800 bg-neutral-900/40 hover:border-neutral-600"}`}
    >
      <div className="flex items-baseline justify-between gap-2 text-[11px]">
        <span className="font-semibold text-neutral-100">#{firing.prototypicality_rank} · {firing.bar_date}</span>
        <span className="text-neutral-400">{firing.signal_direction === "bullish" ? "▲ bullish" : "▼ bearish"}</span>
      </div>
      <Candles bars={bars} patternBars={patternBars} label={`Candles around the ${firing.bar_date} firing`} />
      <ShapeBars shape={shapeOf(firing)} archetype={archetype} />
      <div className="text-[10px] text-neutral-400">
        before it: <span className="text-neutral-200">{TREND_GLYPH[firing.prior_trend_direction] ?? firing.prior_trend_direction}</span> · needs{" "}
        <span className="text-neutral-200">{firing.required_prior_trend.replace("_", " ")}</span>{" "}
        <span style={{ color: agrees ? OKABE.orange : OKABE.blue }}>{agrees ? "● agrees" : "◆ differs"}</span>
      </div>
    </button>
  );
}

/** The pattern's archetype drawn as the same three bars, for the first panel of the grid. */
export function ArchetypePanel({ archetype, title }: { archetype: ReturnType<typeof shapeOf>; title: string }) {
  return (
    <div className="min-w-0 space-y-1.5 rounded-md border border-dashed border-neutral-600 bg-neutral-900/20 p-2">
      <div className="text-[11px] font-semibold text-neutral-100">{title}</div>
      <p className="text-[10px] text-neutral-400">The median shape of every firing of this pattern. The white ticks on the other panels mark it.</p>
      <ShapeBars shape={archetype} archetype={null} />
    </div>
  );
}
