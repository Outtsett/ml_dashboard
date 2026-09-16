import { describe, expect, it } from "vitest";
import {
  clampLensParams,
  computeBarState,
  defaultLensParams,
  resolveRange,
  simulateTrades,
  tradeCostUsd,
} from "@shared/lens/index";
import { makeManifest, makeSeries } from "./fixtures";

/**
 * Ten rows priced 100..109, horizon 2, threshold 0.60, cost 2 points at $1 a
 * point. The probabilities are chosen so the state machine has to do every
 * thing it can do: take a trade, refuse a signal that fires while a position is
 * open, and re-enter ON the exit bar.
 */
function scenario() {
  const series = makeSeries({
    close: [100, 101, 102, 103, 104, 105, 106, 107, 108, 109],
    probabilityUp: [0.7, 0.9, 0.8, 0.1, 0.05, 0.99, 0.5, 0.5, 0.5, 0.5],
    horizonBars: 2,
    roundTripPoints: 2,
    pointValueUsd: 1,
  });
  const manifest = makeManifest(series, { defaultThreshold: 0.6 });
  const params = clampLensParams({ rollingWindowBars: 20 }, manifest);
  const range = resolveRange(series, params);
  return { series, manifest, params, range };
}

describe("simulateTrades", () => {
  it("takes non-overlapping trades and allows a new entry on the exit bar", () => {
    const { series, params, range } = scenario();
    const { trades, longCount, shortCount } = simulateTrades(series, params, range);

    expect(trades.map((trade) => [trade.entryRowIndex, trade.exitRowIndex, trade.direction])).toEqual([
      [0, 2, 1],
      [2, 4, 1],
      [4, 6, -1],
    ]);
    expect(longCount).toBe(2);
    expect(shortCount).toBe(1);
  });

  it("charges the full round trip once per trade and accumulates net dollars", () => {
    const { series, params, range } = scenario();
    const { trades } = simulateTrades(series, params, range);
    expect(tradeCostUsd(series, params)).toBe(2);

    expect(trades.map((trade) => trade.grossUsd)).toEqual([2, 2, -2]);
    expect(trades.map((trade) => trade.netUsd)).toEqual([0, 0, -4]);
    expect(trades.map((trade) => trade.cumulativeNetUsd)).toEqual([0, 0, -4]);
    expect(trades[0]?.entryPrice).toBe(100);
    expect(trades[0]?.exitPrice).toBe(102);
  });

  it("scales the cost with the cost multiplier and leaves the gross alone", () => {
    const { series, manifest, range } = scenario();
    const doubled = clampLensParams({ costMultiplier: 2 }, manifest);
    const { trades } = simulateTrades(series, doubled, resolveRange(series, doubled));
    expect(trades.map((trade) => trade.grossUsd)).toEqual([2, 2, -2]);
    expect(trades.map((trade) => trade.netUsd)).toEqual([-2, -2, -6]);
    expect(range.barCount).toBe(10);
  });

  it("takes no trade when no row reaches the threshold", () => {
    const series = makeSeries({
      close: [100, 101, 102, 103, 104],
      probabilityUp: [0.5, 0.5, 0.5, 0.5, 0.5],
      horizonBars: 2,
    });
    const manifest = makeManifest(series, { defaultThreshold: 0.6 });
    const params = clampLensParams({}, manifest);
    const result = simulateTrades(series, params, resolveRange(series, params));
    expect(result.trades).toHaveLength(0);
    expect(result.longCount).toBe(0);
    expect(result.shortCount).toBe(0);
  });

  it("honours a start and end timestamp window", () => {
    const { series, manifest } = scenario();
    const windowed = clampLensParams(
      {
        startTimestampSeconds: (series.timestampSeconds[2] as number),
        endTimestampSeconds: (series.timestampSeconds[8] as number),
      },
      manifest,
    );
    const range = resolveRange(series, windowed);
    expect(range.firstRowIndex).toBe(2);
    expect(range.lastRowIndex).toBe(8);
    expect(range.barCount).toBe(7);
    const { trades } = simulateTrades(series, windowed, range);
    expect(trades.map((trade) => trade.entryRowIndex)).toEqual([2, 4]);
  });
});

describe("computeBarState", () => {
  it("marks each row with the decision the strategy took there", () => {
    const { series, params, range } = scenario();
    const { trades } = simulateTrades(series, params, range);
    const state = computeBarState(series, params, range, trades);

    expect(state.decision).toEqual([
      "enter_long", // row 0 signal taken
      "skip", // row 1 signal fired inside an open position
      "enter_long", // row 2 is the exit of trade 1 and the entry of trade 2
      "skip", // row 3 short signal fired inside an open position
      "enter_short", // row 4 is the exit of trade 2 and the entry of trade 3
      "skip", // row 5 long signal fired inside an open position
      "exit", // row 6 closes trade 3, no new signal
      "flat",
      "flat",
      "flat",
    ]);
    expect(state.exitAndEntryRowCount).toBe(2);
  });

  it("holds the position on (entry, exit] and marks to market every row", () => {
    const { series, params, range } = scenario();
    const { trades } = simulateTrades(series, params, range);
    const state = computeBarState(series, params, range, trades);

    expect(Array.from(state.position)).toEqual([0, 1, 1, 1, 1, -1, -1, 0, 0, 0]);
    expect(Array.from(state.barPnlUsd)).toEqual([-2, 1, -1, 1, -1, -1, -1, 0, 0, 0]);
    expect(Array.from(state.cumulativeNetUsd)).toEqual([-2, -1, -2, -1, -2, -3, -4, -4, -4, -4]);
    // 6 of 10 rows hold a position.
    expect(state.exposureShare).toBeCloseTo(0.6, 12);
    expect(state.maxDrawdownUsd).toBe(-4);
  });

  it("charges the buy-and-hold leg the same round trip once, at the first row", () => {
    const { series, params, range } = scenario();
    const { trades } = simulateTrades(series, params, range);
    const state = computeBarState(series, params, range, trades);
    expect(state.buyHoldCumulativeUsd?.[0]).toBe(-2);
    expect(state.buyHoldCumulativeUsd?.[9]).toBe(9 - 2);
  });

  it("clamps a rolling window that asks for more rows than the record holds", () => {
    const { series, manifest } = scenario();
    const params = clampLensParams({ rollingWindowBars: 19999 }, manifest);
    expect(series.length).toBe(10);
    expect(params.rollingWindowBars).toBe(20);
    expect(defaultLensParams(manifest).threshold).toBe(0.6);
  });
});
