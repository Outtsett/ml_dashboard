import { describe, expect, it } from "vitest";
import {
  buildIntervalSeries,
  buildRegimeHistogram,
  buildTradeMarkers,
  decimalsFromTick,
} from "@/lens/charts/priceLensData";
import { makeBar, makeTrade } from "./fixtures";

describe("decimalsFromTick", () => {
  it("reads decimal count off the tick size", () => {
    expect(decimalsFromTick(0.25)).toBe(2);
    expect(decimalsFromTick(1)).toBe(0);
    expect(decimalsFromTick(0.0001)).toBe(4);
  });

  it("falls back to 2 for a non-finite or non-positive tick", () => {
    expect(decimalsFromTick(0)).toBe(2);
    expect(decimalsFromTick(NaN)).toBe(2);
  });
});

describe("buildIntervalSeries", () => {
  it("plots each row's interval at the timestamp of row + H, not at its own row", () => {
    const bars = [
      makeBar({ rowIndex: 0, timestampSeconds: 1000, intervalLowerPrice: 100, intervalUpperPrice: 110, intervalMedianPrice: 105 }),
      makeBar({ rowIndex: 1, timestampSeconds: 1060 }),
      makeBar({ rowIndex: 2, timestampSeconds: 1120 }),
      makeBar({ rowIndex: 3, timestampSeconds: 1180 }),
      makeBar({ rowIndex: 4, timestampSeconds: 1240 }),
      makeBar({ rowIndex: 5, timestampSeconds: 1300 }),
    ];
    const { upper, lower, median } = buildIntervalSeries(bars, 5);
    expect(upper).toEqual([{ time: 1300, value: 110 }]);
    expect(lower).toEqual([{ time: 1300, value: 100 }]);
    expect(median).toEqual([{ time: 1300, value: 105 }]);
  });

  it("skips a row whose target falls outside the window", () => {
    const bars = [makeBar({ rowIndex: 0, timestampSeconds: 1000, intervalLowerPrice: 100, intervalUpperPrice: 110 })];
    const { upper } = buildIntervalSeries(bars, 5);
    expect(upper).toEqual([]);
  });

  it("skips warmup rows carrying no interval", () => {
    const bars = [
      makeBar({ rowIndex: 0, timestampSeconds: 1000, intervalLowerPrice: null, intervalUpperPrice: null }),
      makeBar({ rowIndex: 5, timestampSeconds: 1300 }),
    ];
    expect(buildIntervalSeries(bars, 5).upper).toEqual([]);
  });
});

describe("buildTradeMarkers", () => {
  const colors = { up: "#E69F00", down: "#0072B2", neutral: "#CC79A7" };

  it("places an orange arrow-up below the bar on enter_long, with the trade's net PnL in the text", () => {
    const bars = [makeBar({ rowIndex: 0, timestampSeconds: 1000, decision: "enter_long" })];
    const trades = [makeTrade({ entryRowIndex: 0, netUsd: 12.5 })];
    const markers = buildTradeMarkers(bars, trades, colors);
    expect(markers).toEqual([{ time: 1000, position: "belowBar", color: "#E69F00", shape: "arrowUp", text: "long +$12.50" }]);
  });

  it("places a blue arrow-down above the bar on enter_short", () => {
    const bars = [makeBar({ rowIndex: 0, timestampSeconds: 1000, decision: "enter_short" })];
    const trades = [makeTrade({ entryRowIndex: 0, direction: -1, netUsd: -3 })];
    const markers = buildTradeMarkers(bars, trades, colors);
    expect(markers).toEqual([{ time: 1000, position: "aboveBar", color: "#0072B2", shape: "arrowDown", text: "short -$3.00" }]);
  });

  it("places a neutral circle in-bar on exit, and omits PnL text when no trade matches the entry row", () => {
    const bars = [
      makeBar({ rowIndex: 0, timestampSeconds: 1000, decision: "enter_long" }),
      makeBar({ rowIndex: 1, timestampSeconds: 1060, decision: "exit" }),
    ];
    const markers = buildTradeMarkers(bars, [], colors);
    expect(markers).toEqual([
      { time: 1000, position: "belowBar", color: "#E69F00", shape: "arrowUp", text: "long" },
      { time: 1060, position: "inBar", color: "#CC79A7", shape: "circle", text: "exit" },
    ]);
  });
});

describe("buildRegimeHistogram", () => {
  it("maps bull/bear/sideways to +1/-1/0 with the paired color, and draws nothing for a warm-up bar", () => {
    const bars = [
      makeBar({ timestampSeconds: 1000, regime: "bull" }),
      makeBar({ timestampSeconds: 1060, regime: "bear" }),
      makeBar({ timestampSeconds: 1120, regime: "sideways" }),
      makeBar({ timestampSeconds: 1180, regime: null }),
    ];
    const colors = { bull: "#E69F00", bear: "#0072B2", sideways: "#808A99" };
    // The last bar has no regime yet (lookback warm-up). It must not be drawn
    // as a measured "sideways" bar — the two are different claims.
    expect(buildRegimeHistogram(bars, colors)).toEqual([
      { time: 1000, value: 1, color: "#E69F00" },
      { time: 1060, value: -1, color: "#0072B2" },
      { time: 1120, value: 0, color: "#808A99" },
    ]);
  });
});
