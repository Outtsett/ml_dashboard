/**
 * One trade on its candles: the contract around the firing, the pattern's own
 * candles shaded yellow (grey for a random bar), the trade's candles sky, the
 * entry at the next open (▶), the exit at the close of candle k (■), the path
 * between them solid orange for a winner and dashed blue for a loser, and the
 * dashed line the exit had to reach just to pay the round trip.
 */

import { useState } from "react";
import { OKABE } from "@/studies/kit";
import type { CaseBody, WindowCandle } from "@shared/studies/pattern-casebook";
import { easternTime, niceTicks, price, useWidth } from "./format";
import { glyphPath } from "./glyphs";

const HEIGHT = 380;
const MARGIN = { top: 12, right: 14, bottom: 34, left: 64 };
const LIGHT = "#e5e5e5";

export function CandleTradeChart({ body, candle }: { body: CaseBody; candle: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hovered, setHovered] = useState<WindowCandle | null>(null);
  const trade = body.trade;
  const candles = body.window;
  return (
    <div ref={ref} className="relative min-w-0">
      {!trade || candles.length === 0 ? (
        <p className="py-8 text-center text-xs text-neutral-500">No candles for this trade in the lake.</p>
      ) : (
        width > 0 && <Drawing body={body} candle={candle} width={width} hovered={hovered} setHovered={setHovered} />
      )}
    </div>
  );
}

function Drawing({
  body, candle, width, hovered, setHovered,
}: {
  body: CaseBody; candle: number; width: number;
  hovered: WindowCandle | null; setHovered: (candle: WindowCandle | null) => void;
}) {
  const trade = body.trade as NonNullable<CaseBody["trade"]>;
  const candles = body.window;
  const isPattern = body.population === "pattern";
  const winner = trade.net_dollars > 0;
  const outcome = winner ? OKABE.orange : OKABE.blue;
  const breakEven = trade.entry_price + body.tradeDirection * body.costTicks * body.tickSize;
  const first = Math.min(...candles.map((bar) => bar.bars_from_signal));
  const xLow = first - 0.6;
  const xHigh = 6.6;
  const yLow = Math.min(...candles.map((bar) => bar.low), breakEven, trade.exit_price) - body.tickSize * 4;
  const yHigh = Math.max(...candles.map((bar) => bar.high), breakEven, trade.exit_price) + body.tickSize * 4;
  const plotWidth = Math.max(10, width - MARGIN.left - MARGIN.right);
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const x = (value: number) => MARGIN.left + ((value - xLow) / (xHigh - xLow)) * plotWidth;
  const y = (value: number) => MARGIN.top + (1 - (value - yLow) / (yHigh - yLow)) * plotHeight;
  const half = Math.max(1.5, ((x(1) - x(0)) * 0.66) / 2);
  const regions = [
    { from: isPattern ? -(body.patternCandleCount - 1) - 0.5 : -0.5, to: 0.5, colour: isPattern ? OKABE.yellow : OKABE.grey, label: isPattern ? "pattern candles" : "the random bar" },
    { from: 0.5, to: candle + 0.5, colour: OKABE.sky, label: `trade: candles 1 to ${candle}` },
  ];
  const breaks = candles.filter((bar, index) => index > 0 && bar.trading_day !== candles[index - 1]?.trading_day);
  const entryX = x(1 - 0.33);
  const exitX = x(candle + 0.33);

  return (
    <>
        <svg width={width} height={HEIGHT} role="img" aria-label="the trade on its candles" onMouseLeave={() => setHovered(null)}>
          {regions.map((region) => (
            <rect key={region.label} x={x(region.from)} width={x(region.to) - x(region.from)} y={MARGIN.top} height={plotHeight} fill={region.colour} opacity={0.18} />
          ))}
          {niceTicks(yLow, yHigh, 6).map((tick) => (
            <g key={tick}>
              <line x1={MARGIN.left} x2={MARGIN.left + plotWidth} y1={y(tick)} y2={y(tick)} stroke="#262626" />
              <text x={MARGIN.left - 6} y={y(tick)} dy="0.32em" textAnchor="end" fontSize={10} fill="#a3a3a3">{price(tick)}</text>
            </g>
          ))}
          {Array.from({ length: Math.floor(xHigh) - Math.ceil(xLow) + 1 }, (_, index) => Math.ceil(xLow) + index)
            .filter((tick) => tick % 2 === 0 || tick >= 0)
            .map((tick) => (
              <text key={tick} x={x(tick)} y={HEIGHT - MARGIN.bottom + 14} textAnchor="middle" fontSize={10} fill={tick === 0 ? LIGHT : "#a3a3a3"}>{tick}</text>
            ))}
          <text x={MARGIN.left + plotWidth / 2} y={HEIGHT - 4} textAnchor="middle" fontSize={10} fill="#a3a3a3">candles from the signal (0 = the pattern's last candle)</text>
          <text transform={`translate(12 ${MARGIN.top + plotHeight / 2}) rotate(-90)`} textAnchor="middle" fontSize={10} fill="#a3a3a3">price, points</text>
          {breaks.map((bar) => (
            <g key={bar.timestamp_milliseconds}>
              <line x1={x(bar.bars_from_signal - 0.5)} x2={x(bar.bars_from_signal - 0.5)} y1={MARGIN.top} y2={MARGIN.top + plotHeight} stroke={OKABE.grey} strokeDasharray="2 2" strokeWidth={1.5} />
              <text x={x(bar.bars_from_signal - 0.4)} y={MARGIN.top + 10} fontSize={10} fill={OKABE.grey}>new session</text>
            </g>
          ))}
          {candles.map((bar) => {
            const up = bar.close >= bar.open;
            const colour = up ? OKABE.orange : OKABE.blue;
            const top = y(Math.max(bar.open, bar.close));
            const bottom = y(Math.min(bar.open, bar.close));
            return (
              <g key={bar.timestamp_milliseconds} onMouseEnter={() => setHovered(bar)}>
                <line x1={x(bar.bars_from_signal)} x2={x(bar.bars_from_signal)} y1={y(bar.high)} y2={y(bar.low)} stroke={colour} strokeWidth={1.2} />
                <rect x={x(bar.bars_from_signal) - half} width={half * 2} y={top} height={Math.max(1, bottom - top)} fill={up ? "#0a0a0a" : colour} stroke={colour} strokeWidth={1.4} />
                <rect x={x(bar.bars_from_signal) - half - 2} width={half * 2 + 4} y={MARGIN.top} height={plotHeight} fill="transparent" />
              </g>
            );
          })}
          <line x1={entryX} x2={exitX} y1={y(breakEven)} y2={y(breakEven)} stroke={LIGHT} strokeDasharray="4 3" />
          <line x1={entryX} x2={exitX} y1={y(trade.entry_price)} y2={y(trade.exit_price)} stroke={outcome} strokeWidth={2.5} strokeDasharray={winner ? undefined : "6 3"} />
          <path d={glyphPath("triangle-right", entryX, y(trade.entry_price), 7)} fill={LIGHT} stroke="#0a0a0a" />
          <path d={glyphPath("square", exitX, y(trade.exit_price), 7)} fill={LIGHT} stroke="#0a0a0a" />
        </svg>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-neutral-400">
        <span><span style={{ color: isPattern ? OKABE.yellow : OKABE.grey }}>■</span> {regions[0]?.label}</span>
        <span><span style={{ color: OKABE.sky }}>■</span> {regions[1]?.label}</span>
        <span><span style={{ color: OKABE.orange }}>▯</span> up candle (hollow) · <span style={{ color: OKABE.blue }}>▮</span> down candle (filled)</span>
        <span>▶ entry at the next open · ■ exit at the close of candle {candle}</span>
        <span>┄ price that pays the round trip ({price(breakEven)})</span>
        <span style={{ color: outcome }}>{winner ? "━ winner (solid orange)" : "╌ loser (dashed blue)"}</span>
      </div>
      {hovered && (
        <div className="pointer-events-none absolute right-2 top-2 rounded border border-neutral-700 bg-neutral-900/95 px-2 py-1 font-mono text-[11px] text-neutral-200">
          <div>{easternTime(hovered.timestamp_milliseconds)} · candle {hovered.bars_from_signal}</div>
          <div>open {price(hovered.open)} · high {price(hovered.high)}</div>
          <div>low {price(hovered.low)} · close {price(hovered.close)}</div>
        </div>
      )}
    </>
  );
}
