/**
 * Reason 1: the recogniser only ever saw five candles. One real MNQ firing of
 * a chosen pattern, drawn with the last five candles solid (what the model
 * received) and any extra context faded (what it never had). Rising candles
 * are hollow orange, falling candles filled blue, so direction is never colour
 * alone. Times are the lake's stamps: Pacific wall clock stored as UTC.
 */

import { useState } from "react";
import { useMeasuredWidth } from "@/market/regression/ScatterPlot";
import {
  AXIS, ControlBar, Finding, GRID, OKABE, SelectControl, SliderControl, TOOLTIP, fmt, fmtInt, fmtTime,
} from "@/studies/kit";
import {
  MODEL_WINDOW_CANDLES, RECORDED_FIGURES, WINDOW_PATTERNS, windowWidthShares,
  type WindowView,
} from "@shared/studies/frozen-candle-encoder";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const HEIGHT = 330;
const MARGIN = { top: 14, right: 12, bottom: 26, left: 58 };
const BAR_MILLISECONDS = 5 * 60_000;

interface Props {
  view: WindowView | null;
  pattern: string;
  index: number;
  context: number;
  onPattern: (value: string) => void;
  onIndex: (value: number) => void;
  onContext: (value: number) => void;
}

async function showOnMarketChart(view: WindowView): Promise<string> {
  const first = view.bars[0];
  const last = view.bars[view.bars.length - 1];
  if (!first || !last) return "No bars to show.";
  try {
    const response = await fetch("/api/chart/view", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startMs: first.timestamp_milliseconds, endMs: last.timestamp_milliseconds + BAR_MILLISECONDS }),
    });
    return response.ok
      ? "Asked the Market chart to show this window (it must be open on MNQ, 5m)."
      : `The chart refused the view (${response.status}).`;
  } catch {
    return "The chart link is not reachable; open the Market page first.";
  }
}

function CandleWindow({ view }: { view: WindowView }) {
  const [wrapper, width] = useMeasuredWidth<HTMLDivElement>();
  const [hovered, setHovered] = useState<number | null>(null);
  const bars = view.bars;
  const count = bars.length;
  const plotWidth = Math.max(60, width - MARGIN.left - MARGIN.right);
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const low = Math.min(...bars.map((bar) => bar.low));
  const high = Math.max(...bars.map((bar) => bar.high));
  const pad = Math.max((high - low) * 0.05, 0.25);
  const top = high + pad;
  const bottom = low - pad;
  const y = (price: number) => MARGIN.top + plotHeight * (1 - (price - bottom) / (top - bottom));
  const slot = plotWidth / count;
  const bodyWidth = Math.max(3, Math.min(24, slot * 0.62));
  const firstSeen = Math.max(0, count - MODEL_WINDOW_CANDLES);
  const priceTicks = Array.from({ length: 5 }, (_, i) => bottom + ((top - bottom) * i) / 4);
  const timeEvery = Math.max(1, Math.ceil(count / Math.max(2, Math.floor(plotWidth / 70))));
  const active = hovered !== null ? bars[hovered] : null;
  const bullish = view.signal > 0;

  return (
    <div ref={wrapper} className="min-w-0">
      {width > 0 && (
        <svg width={width} height={HEIGHT} role="img" aria-label={`${view.pattern} firing with ${count} candles, the last ${Math.min(count, MODEL_WINDOW_CANDLES)} seen by the model`} onMouseLeave={() => setHovered(null)}>
          {priceTicks.map((tick) => (
            <g key={tick}>
              <line x1={MARGIN.left} x2={MARGIN.left + plotWidth} y1={y(tick)} y2={y(tick)} stroke="#262626" />
              <text x={MARGIN.left - 6} y={y(tick) + 3} textAnchor="end" fontSize={10} fill={AXIS.stroke}>{fmt(tick, 2)}</text>
            </g>
          ))}
          {firstSeen > 0 && (
            <g>
              <line x1={MARGIN.left + firstSeen * slot} x2={MARGIN.left + firstSeen * slot} y1={MARGIN.top} y2={MARGIN.top + plotHeight} stroke={OKABE.grey} strokeDasharray="4 3" />
              <text x={MARGIN.left + firstSeen * slot + 4} y={MARGIN.top + 10} fontSize={10} fill="#d4d4d4">model saw these {MODEL_WINDOW_CANDLES} →</text>
              <text x={MARGIN.left + firstSeen * slot - 4} y={MARGIN.top + 10} fontSize={10} fill="#737373" textAnchor="end">← never seen (context)</text>
            </g>
          )}
          {bars.map((bar, i) => {
            const seen = i >= firstSeen;
            const rising = bar.close >= bar.open;
            const colour = rising ? OKABE.orange : OKABE.blue;
            const middle = MARGIN.left + (i + 0.5) * slot;
            const bodyTop = y(Math.max(bar.open, bar.close));
            const bodyBottom = y(Math.min(bar.open, bar.close));
            return (
              <g key={bar.timestamp_milliseconds} opacity={seen ? 1 : 0.3} onMouseEnter={() => setHovered(i)}>
                <rect x={MARGIN.left + i * slot} y={MARGIN.top} width={slot} height={plotHeight} fill={hovered === i ? "#ffffff10" : "transparent"} />
                <line x1={middle} x2={middle} y1={y(bar.high)} y2={y(bar.low)} stroke={colour} strokeWidth={1.5} />
                <rect x={middle - bodyWidth / 2} y={bodyTop} width={bodyWidth} height={Math.max(1.2, bodyBottom - bodyTop)} fill={rising ? "#0a0a0a" : colour} stroke={colour} strokeWidth={1.5} />
                {i % timeEvery === 0 && (
                  <text x={middle} y={HEIGHT - 8} textAnchor="middle" fontSize={9} fill="#a3a3a3">{fmtTime(bar.timestamp_milliseconds).slice(5)}</text>
                )}
              </g>
            );
          })}
          {count > 0 && (
            <text x={MARGIN.left + (count - 0.5) * slot} y={y(bars[count - 1]?.low ?? bottom) + 14} textAnchor="middle" fontSize={12} fill="#e5e5e5">
              {bullish ? "▲" : "▼"}
            </text>
          )}
        </svg>
      )}
      <p className="min-h-[1.25rem] font-mono text-[11px] text-neutral-300">
        {active
          ? `${fmtTime(active.timestamp_milliseconds)}  open ${fmt(active.open)}  high ${fmt(active.high)}  low ${fmt(active.low)}  close ${fmt(active.close)}  volume ${fmtInt(active.volume)}  ${hovered !== null && hovered >= firstSeen ? "(model saw it)" : "(context, not seen)"}`
          : "Hover a candle for its open, high, low, close and volume."}
      </p>
    </div>
  );
}

export function WindowSection({ view, pattern, index, context, onPattern, onIndex, onContext }: Props) {
  const [chartMessage, setChartMessage] = useState("");
  const shares = windowWidthShares(RECORDED_FIGURES.windowWidthCounts);
  const totalWindows = shares.reduce((sum, entry) => sum + entry.windows, 0);
  const single = shares.find((entry) => entry.candles === 1);

  return (
    <div className="space-y-3">
      <Finding>
        The recogniser was trained on images of exactly five candles (<code>gen_synthetic.py</code> slices every sample to its last five, <code>gpu_render.py</code> builds an image five candles wide), and most of what it scored is narrower, because each pattern is cropped to the bars its rule needs. An image model is usually expected to carry whole-chart context into its embedding; this checkpoint never had it.
      </Finding>
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-1">
          <h4 className="text-xs font-semibold text-neutral-200">How wide the window was, across {totalWindows.toLocaleString("en-US")} scored windows</h4>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={shares} margin={{ top: 14, right: 8, left: 0, bottom: 4 }}>
              <CartesianGrid {...GRID} vertical={false} />
              <XAxis dataKey="candles" {...AXIS} label={{ value: "candles in the pattern's window", position: "insideBottom", offset: -2, fontSize: 10, fill: "#a3a3a3" }} height={34} />
              <YAxis {...AXIS} tickFormatter={(v: number) => `${v / 1000}k`} />
              <Tooltip {...TOOLTIP} formatter={(value, _name, item) => [`${fmtInt(Number(value))} windows (${((item.payload as { share: number }).share * 100).toFixed(1)}%)`, "windows"]} labelFormatter={(label) => `${label} candle${label === 1 ? "" : "s"}`} />
              <Bar dataKey="windows" isAnimationActive={false} label={{ position: "top", fontSize: 10, fill: "#d4d4d4", formatter: (v: unknown) => fmtInt(Number(v)) }}>
                {shares.map((entry) => (
                  <Cell key={entry.candles} fill={entry.candles === 1 ? OKABE.orange : OKABE.sky} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <p className="text-[11px] text-neutral-400">
            A single candle is the most common case at <strong className="text-neutral-200">{single ? (single.share * 100).toFixed(1) : "—"}%</strong>. Counts are the notebook's recorded figures (not recomputed here).
          </p>
        </div>
        <div className="min-w-0 space-y-2">
          <ControlBar>
            <SelectControl label="Pattern" value={pattern} options={WINDOW_PATTERNS.map((name) => ({ value: name, label: name }))} onChange={onPattern} />
            <SliderControl label="Which firing" value={index} min={0} max={29} onChange={onIndex} hint="The n-th holdout firing of the pattern, oldest first" />
            <SliderControl label="Candles drawn" value={context} min={5} max={48} onChange={onContext} hint="5 is what the model saw" />
          </ControlBar>
          {view ? (
            <>
              <p className="text-[12px] text-neutral-300">
                <strong>{view.pattern}</strong> firing {view.firing_index + 1} of {Math.min(view.firing_count, 30)} listed ({view.firing_count.toLocaleString("en-US")} in the holdout) at{" "}
                <span className="font-mono">{fmtTime(view.anchor_timestamp_milliseconds)}</span> wall clock (Pacific stamped as UTC), TA-Lib value {view.signal > 0 ? "+" : ""}{view.signal}.
                Drawing {view.bars.length}; the model received the last <strong>{Math.min(view.bars.length, MODEL_WINDOW_CANDLES)}</strong>. Everything faded is context it never had.
              </p>
              <CandleWindow view={view} />
              <p className="text-[11px] text-neutral-400">
                <span style={{ color: OKABE.orange }}>□ rising (hollow)</span> · <span style={{ color: OKABE.blue }}>■ falling (filled)</span> · ▲ bullish / ▼ bearish firing at the last candle
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => { void showOnMarketChart(view).then(setChartMessage); }}
                  className="rounded border border-neutral-700 px-2 py-1 text-[11px] text-neutral-300 hover:border-neutral-500 hover:text-neutral-100"
                >
                  Show this window on the Market chart
                </button>
                {chartMessage && <span className="text-[11px] text-neutral-400">{chartMessage}</span>}
              </div>
            </>
          ) : (
            <p className="text-xs text-neutral-500">No window to draw: the bars dataset is not landed or this pattern never fires in the holdout.</p>
          )}
        </div>
      </div>
    </div>
  );
}
