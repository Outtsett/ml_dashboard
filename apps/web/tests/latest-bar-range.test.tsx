/**
 * latestBarRange — the single definition of "pinned to the most recent candle".
 *
 * Before this existed, five sites framed the newest bars with three different
 * formulas. Two of them (`useChartSeries`) lost their floor when an edit moved
 * them into a requestAnimationFrame: `from: totalBars - 250` with no clamp runs
 * negative as soon as fewer than 250 bars are loaded — weekly-and-higher
 * timeframes fetch 250, and short lake history returns fewer — which pushes the
 * newest candle off the pane's right edge.
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_RIGHT_OFFSET,
  DEFAULT_VISIBLE_BARS,
  latestBarRange,
} from "@/market/components/chartConfig";

/** Distance in bars from the pane's right edge to the newest candle. */
function newestBarMargin(totalBars: number, rightOffset = DEFAULT_RIGHT_OFFSET): number {
  return latestBarRange(totalBars, DEFAULT_VISIBLE_BARS, rightOffset).to - (totalBars - 1);
}

describe("latestBarRange", () => {
  it("leaves the newest candle exactly the right offset inside the right edge", () => {
    for (const total of [250, 1_000, 25_000, 50_000]) {
      expect(newestBarMargin(total)).toBe(DEFAULT_RIGHT_OFFSET);
    }
  });

  it("never starts before the first bar by more than the right offset allows", () => {
    // The regression: totalBars - 250 is negative below 250 bars.
    for (const total of [1, 5, 50, 200, 249, 250]) {
      const { from } = latestBarRange(total);
      expect(from).toBeGreaterThanOrEqual(-DEFAULT_RIGHT_OFFSET);
    }
  });

  it("shows every bar when there are fewer than the requested window", () => {
    const total = 40;
    const range = latestBarRange(total);
    // The range must contain bar 0, or the chart opens on empty space.
    expect(range.from).toBeLessThanOrEqual(0);
    expect(range.to).toBeGreaterThan(total - 1);
  });

  it("preserves the span it is asked for, which is what a jump-to-latest needs", () => {
    const width = 640;
    const range = latestBarRange(10_000, width);
    expect(range.to - range.from).toBe(width);
    // And it matches the hand-rolled formula this replaced, exactly.
    expect(range).toEqual({
      from: 10_000 - 1 - width + DEFAULT_RIGHT_OFFSET,
      to: 10_000 - 1 + DEFAULT_RIGHT_OFFSET,
    });
  });

  it("survives a zero or missing bar count without producing NaN", () => {
    for (const total of [0, -1]) {
      const range = latestBarRange(total);
      expect(Number.isFinite(range.from)).toBe(true);
      expect(Number.isFinite(range.to)).toBe(true);
    }
  });

  it("keeps a single-bar window from collapsing into a zero-width range", () => {
    const range = latestBarRange(100, 0);
    expect(range.to).toBeGreaterThan(range.from);
  });
});