/**
 * Pure data-shaping helpers for PriceLens — no lightweight-charts instance, no
 * React, so they can be tested without a canvas.
 */

import type { Time } from "lightweight-charts";
import type { LensBar, LensRegime, LensTrade } from "@shared/lens/types";

/** Price precision inferred from the instrument's tick size (e.g. 0.25 -> 2 decimals). */
export function decimalsFromTick(tickSize: number): number {
  if (!Number.isFinite(tickSize) || tickSize <= 0) return 2;
  const text = tickSize.toString();
  const dot = text.indexOf(".");
  return dot === -1 ? 0 : text.length - dot - 1;
}

export interface IntervalSeriesPoint {
  time: Time;
  value: number;
}

export interface IntervalSeries {
  upper: IntervalSeriesPoint[];
  lower: IntervalSeriesPoint[];
  median: IntervalSeriesPoint[];
}

/**
 * Interval band for row t + H, plotted at the timestamp of the bar H rows
 * later than the row the prediction was made at — so the band always sits
 * over the bar it is actually a forecast of, never over the row that made it.
 * A row whose target falls outside the loaded window is skipped rather than
 * guessed.
 */
export function buildIntervalSeries(bars: LensBar[], horizonBars: number): IntervalSeries {
  const byRowIndex = new Map(bars.map((bar) => [bar.rowIndex, bar]));
  const upper: IntervalSeriesPoint[] = [];
  const lower: IntervalSeriesPoint[] = [];
  const median: IntervalSeriesPoint[] = [];
  for (const bar of bars) {
    if (bar.intervalLowerPrice == null || bar.intervalUpperPrice == null) continue;
    const target = byRowIndex.get(bar.rowIndex + horizonBars);
    if (!target) continue;
    const time = target.timestampSeconds as Time;
    upper.push({ time, value: bar.intervalUpperPrice });
    lower.push({ time, value: bar.intervalLowerPrice });
    if (bar.intervalMedianPrice != null) median.push({ time, value: bar.intervalMedianPrice });
  }
  return { upper, lower, median };
}

export interface TradeMarkerInput {
  time: Time;
  position: "aboveBar" | "belowBar" | "inBar";
  color: string;
  shape: "arrowUp" | "arrowDown" | "circle" | "square";
  text: string;
}

function formatNetUsd(netUsd: number): string {
  return `${netUsd >= 0 ? "+" : "-"}$${Math.abs(netUsd).toFixed(2)}`;
}

/**
 * Markers driven by each bar's own `decision`, not by iterating `trades`
 * directly — a trade that entered outside this window would otherwise be
 * invisible. `trades` is only consulted to attach the realized PnL text to
 * an entry marker when the entry row has a matching trade.
 */
export function buildTradeMarkers(
  bars: LensBar[],
  trades: LensTrade[],
  colors: { up: string; down: string; neutral: string },
): TradeMarkerInput[] {
  const tradeByEntryRow = new Map(trades.map((trade) => [trade.entryRowIndex, trade]));
  const markers: TradeMarkerInput[] = [];
  for (const bar of bars) {
    if (bar.decision === "enter_long") {
      const trade = tradeByEntryRow.get(bar.rowIndex);
      markers.push({
        time: bar.timestampSeconds as Time,
        position: "belowBar",
        color: colors.up,
        shape: "arrowUp",
        text: trade ? `long ${formatNetUsd(trade.netUsd)}` : "long",
      });
    } else if (bar.decision === "enter_short") {
      const trade = tradeByEntryRow.get(bar.rowIndex);
      markers.push({
        time: bar.timestampSeconds as Time,
        position: "aboveBar",
        color: colors.down,
        shape: "arrowDown",
        text: trade ? `short ${formatNetUsd(trade.netUsd)}` : "short",
      });
    } else if (bar.decision === "exit") {
      markers.push({
        time: bar.timestampSeconds as Time,
        position: "inBar",
        color: colors.neutral,
        shape: "circle",
        text: "exit",
      });
    }
  }
  return markers;
}

export interface RegimeHistogramPoint {
  time: Time;
  value: number;
  color: string;
}

/** +1 bull, -1 bear, 0 sideways/unknown — height and sign carry the meaning, not color alone. */
export function regimeValue(regime: LensRegime | null): number {
  if (regime === "bull") return 1;
  if (regime === "bear") return -1;
  return 0;
}

export function buildRegimeHistogram(
  bars: LensBar[],
  colors: { bull: string; bear: string; sideways: string },
): RegimeHistogramPoint[] {
  return bars.map((bar) => ({
    time: bar.timestampSeconds as Time,
    value: regimeValue(bar.regime),
    color: bar.regime === "bull" ? colors.bull : bar.regime === "bear" ? colors.bear : colors.sideways,
  }));
}
