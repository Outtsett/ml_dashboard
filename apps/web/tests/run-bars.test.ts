/**
 * The run as data for the Market chart (`apps/web/src/cycle/runBars.ts`).
 *
 * These are the two boundaries the unification rests on, and both are units:
 *  - the bars carry epoch MILLISECONDS (`OhlcvData.timestamp`), the store's
 *    columns carry epoch SECONDS, so a missing ×1000 puts every run candle
 *    decades away from the market's;
 *  - the panels carry epoch SECONDS (`IndicatorOverlay.data[].time`), which is
 *    what every indicator calculator emits and what the candle series uses, so a
 *    scale applied twice here silently doubles a panel's spacing.
 *
 * Plus the two shapes the chart consumes: the candle pipeline's own
 * `is_bullish` rule (which the run's bars must match or a candle is drawn with
 * the wrong body colour), and a bar the model produced nothing for becoming a
 * GAP rather than a zero.
 */
import { describe, expect, it } from "vitest";

import {
  emptyBarColumns,
  appendBars,
  type CycleBarColumns,
  type CycleBars,
} from "@shared/cycle/schema";
import {
  runBars,
  runPanelOverlays,
  RUN_PANEL_EQUITY,
  RUN_PANEL_PROBABILITY,
  RUN_PROBABILITY_THRESHOLD,
} from "@/cycle/runBars";
import { CYCLE_COLORS } from "@/cycle/chartModel";

const FIVE_MINUTES = 300;
const START = 1_735_700_000;

function contextEvent(from: number, count: number): CycleBars {
  const timestamps = Array.from({ length: count }, (_, i) => START + (from + i) * FIVE_MINUTES);
  const close = timestamps.map((_, i) => 100 + ((from + i) % 7) - 3);
  return {
    role: "context",
    foldIndex: null,
    timestamps,
    open: close.map((value) => value - 0.5),
    high: close.map((value) => value + 1),
    low: close.map((value) => value - 1),
    close,
    volume: close.map(() => 10),
  };
}

function processedEvent(from: number, count: number, foldIndex: number): CycleBars {
  const event = contextEvent(from, count);
  event.role = "processed";
  event.foldIndex = foldIndex;
  event.probabilityUp = event.timestamps.map((_, i) => ((from + i) % 10) / 10);
  event.predictedDirection = event.probabilityUp.map((p) => ((p ?? 0.5) > 0.55 ? 1 : (p ?? 0.5) < 0.45 ? -1 : 0));
  event.position = event.predictedDirection.map((d) => d);
  event.equityUsd = event.timestamps.map((_, i) => (from + i) * 1.5 - 20);
  return event;
}

function columnsWith(...events: CycleBars[]): CycleBarColumns {
  const columns = emptyBarColumns();
  for (const event of events) appendBars(columns, event);
  return columns;
}

describe("runBars — the run's bars as market-chart OHLCV", () => {
  it("scales timestamps from the store's seconds into the bar pipeline's milliseconds", () => {
    const bars = runBars(columnsWith(contextEvent(0, 3)));
    expect(bars).toHaveLength(3);
    expect(bars[0]!.timestamp).toBe(START * 1000);
    // Bar spacing survives: milliseconds, still five minutes apart.
    expect(bars[2]!.timestamp - bars[1]!.timestamp).toBe(FIVE_MINUTES * 1000);
  });

  it("copies OHLCV and nothing else", () => {
    const columns = columnsWith(contextEvent(0, 2));
    const bars = runBars(columns);
    expect(bars[0]).toMatchObject({
      open: columns.open[0],
      high: columns.high[0],
      low: columns.low[0],
      close: columns.close[0],
      volume: columns.volume[0],
    });
  });

  it("uses the chart's own bullish rule: close against the previous close, first bar against its own open", () => {
    // First bar closes above its open; the second closes below the first's close.
    const event = contextEvent(0, 2);
    event.close = [10.5, 9];
    event.open = [10, 9.5];
    const bars = runBars(columnsWith(event));
    expect(bars[0]!.is_bullish).toBe(true);
    expect(bars[1]!.is_bullish).toBe(false);
  });

  it("carries the run's bars from context into processed without a gap", () => {
    const bars = runBars(columnsWith(contextEvent(0, 2), processedEvent(2, 3, 0)));
    expect(bars).toHaveLength(5);
    expect(bars.map((bar) => bar.timestamp)).toEqual(
      Array.from({ length: 5 }, (_, i) => (START + i * FIVE_MINUTES) * 1000),
    );
  });
});

describe("runPanelOverlays — P(up) and equity as ordinary panels", () => {
  it("keeps panel times in SECONDS, the unit every indicator calculator emits", () => {
    const panels = runPanelOverlays(columnsWith(contextEvent(0, 2), processedEvent(2, 2, 0)));
    const probability = panels.find((panel) => panel.column === RUN_PANEL_PROBABILITY)!;
    expect(probability.data[0]!.time).toBe(START);
    expect(probability.data[3]!.time).toBe(START + 3 * FIVE_MINUTES);
  });

  it("declares both panels as subcharts, so they group and sync like RSI", () => {
    const panels = runPanelOverlays(columnsWith(processedEvent(0, 2, 0)));
    expect(panels.map((panel) => panel.column)).toEqual([RUN_PANEL_PROBABILITY, RUN_PANEL_EQUITY]);
    for (const panel of panels) {
      expect(panel.displayType).toBe("subchart");
      expect(panel.lineWidth).toBe(2);
    }
  });

  it("leaves a gap where the model produced nothing rather than drawing a zero", () => {
    // Two context bars the model was never tested on, then two it was.
    const panels = runPanelOverlays(columnsWith(contextEvent(0, 2), processedEvent(2, 2, 0)));
    const probability = panels.find((panel) => panel.column === RUN_PANEL_PROBABILITY)!;
    const equity = panels.find((panel) => panel.column === RUN_PANEL_EQUITY)!;
    expect(Number.isNaN(probability.data[0]!.value)).toBe(true);
    expect(Number.isNaN(probability.data[1]!.value)).toBe(true);
    expect(Number.isNaN(equity.data[0]!.value)).toBe(true);
    expect(Number.isFinite(probability.data[2]!.value)).toBe(true);
    expect(probability.data[2]!.value).toBeCloseTo(0.2, 10);
    expect(equity.data[2]!.value).toBeCloseTo(2 * 1.5 - 20, 10);
  });

  it("names the trading threshold it is measured against", () => {
    expect(RUN_PROBABILITY_THRESHOLD).toBe(0.5);
    // The panel's colour is the run's own sky blue, not a second palette entry.
    const panels = runPanelOverlays(columnsWith(processedEvent(0, 1, 0)));
    expect(panels[0]!.color).toBe(CYCLE_COLORS.sky);
  });
});