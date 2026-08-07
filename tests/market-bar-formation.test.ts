/**
 * Progressive bar formation.
 *
 * Two invariants matter more than anything else here, because breaking either
 * produces a chart that lies:
 *
 *   1. High and low never contract mid-bar. A real bar's range only grows
 *      within its interval; a retracting wick is impossible in a market and
 *      reads instantly as a rendering bug.
 *   2. The final frame equals the source bar exactly, so the committed candle
 *      matches the stored data with no interpolation drift.
 */

import { describe, it, expect } from "vitest";
import {
  partialBar,
  formationFrames,
  mergeBar,
  type Bar,
} from "../src/server/market/ingestion/barFormation";

function bar(overrides: Partial<Bar> = {}): Bar {
  return {
    symbol: "MNQ",
    timestamp: 1_700_000_000_000,
    open: 100,
    high: 110,
    low: 95,
    close: 105,
    volume: 1000,
    ...overrides,
  };
}

describe("partialBar", () => {
  it("returns the source bar exactly on the closing frame", () => {
    const b = bar();
    const closed = partialBar(b, 1);
    expect(closed.open).toBe(b.open);
    expect(closed.high).toBe(b.high);
    expect(closed.low).toBe(b.low);
    expect(closed.close).toBe(b.close);
    expect(closed.volume).toBe(b.volume);
    expect(closed.isClosed).toBe(true);
    expect(closed.progress).toBe(1);
  });

  it("opens at the open", () => {
    const frame = partialBar(bar(), 0);
    expect(frame.close).toBe(100);
    expect(frame.high).toBe(100);
    expect(frame.low).toBe(100);
    expect(frame.isClosed).toBe(false);
  });

  it("never contracts high or low as the bar forms", () => {
    const b = bar();
    let prevHigh = -Infinity;
    let prevLow = Infinity;

    for (let i = 0; i <= 100; i++) {
      const frame = partialBar(b, i / 100);
      expect(frame.high, `high shrank at p=${i / 100}`).toBeGreaterThanOrEqual(prevHigh);
      expect(frame.low, `low grew at p=${i / 100}`).toBeLessThanOrEqual(prevLow);
      prevHigh = frame.high;
      prevLow = frame.low;
    }
  });

  it("keeps close within high and low at every step", () => {
    const b = bar();
    for (let i = 0; i <= 100; i++) {
      const f = partialBar(b, i / 100);
      expect(f.close).toBeLessThanOrEqual(f.high);
      expect(f.close).toBeGreaterThanOrEqual(f.low);
      expect(f.open).toBeLessThanOrEqual(f.high);
      expect(f.open).toBeGreaterThanOrEqual(f.low);
    }
  });

  it("holds those invariants for a down bar", () => {
    const b = bar({ open: 110, close: 95, high: 112, low: 90 });
    let prevHigh = -Infinity;
    let prevLow = Infinity;
    for (let i = 0; i <= 50; i++) {
      const f = partialBar(b, i / 50);
      expect(f.high).toBeGreaterThanOrEqual(prevHigh);
      expect(f.low).toBeLessThanOrEqual(prevLow);
      expect(f.close).toBeLessThanOrEqual(f.high);
      expect(f.close).toBeGreaterThanOrEqual(f.low);
      prevHigh = f.high;
      prevLow = f.low;
    }
  });

  it("handles a doji, where open equals close", () => {
    const b = bar({ open: 100, close: 100, high: 103, low: 97 });
    const mid = partialBar(b, 0.5);
    expect(mid.close).toBe(100);
    expect(mid.high).toBeGreaterThanOrEqual(100);
    expect(mid.low).toBeLessThanOrEqual(100);
    expect(partialBar(b, 1).high).toBe(103);
  });

  it("handles a flat bar with no range at all", () => {
    const b = bar({ open: 100, close: 100, high: 100, low: 100 });
    for (const p of [0, 0.5, 1]) {
      const f = partialBar(b, p);
      expect(f.high).toBe(100);
      expect(f.low).toBe(100);
      expect(f.close).toBe(100);
    }
  });

  it("clamps progress rather than extrapolating past the close", () => {
    const b = bar();
    expect(partialBar(b, 2).close).toBe(b.close);
    expect(partialBar(b, -1).close).toBe(b.open);
  });

  it("treats a non-finite progress as the opening frame", () => {
    expect(partialBar(bar(), NaN).close).toBe(100);
  });

  it("accrues volume rather than showing the full amount immediately", () => {
    const b = bar({ volume: 1000 });
    expect(partialBar(b, 0).volume).toBe(0);
    expect(partialBar(b, 0.5).volume).toBeCloseTo(500);
    expect(partialBar(b, 1).volume).toBe(1000);
  });
});

describe("formationFrames", () => {
  it("emits the requested intermediates plus a close", () => {
    const frames = formationFrames(bar(), 4);
    expect(frames).toHaveLength(5);
    expect(frames.filter((f) => f.isClosed)).toHaveLength(1);
    expect(frames[frames.length - 1]!.isClosed).toBe(true);
  });

  it("emits only the closed bar when no intermediates are wanted", () => {
    const frames = formationFrames(bar(), 0);
    expect(frames).toHaveLength(1);
    expect(frames[0]!.isClosed).toBe(true);
  });

  it("advances progress monotonically", () => {
    const frames = formationFrames(bar(), 6);
    for (let i = 1; i < frames.length; i++) {
      expect(frames[i]!.progress).toBeGreaterThan(frames[i - 1]!.progress);
    }
  });

  it("treats a negative step count as zero rather than throwing", () => {
    expect(formationFrames(bar(), -3)).toHaveLength(1);
  });
});

describe("mergeBar", () => {
  it("widens extremes and preserves the original open", () => {
    const first = bar({ high: 102, low: 99, close: 101, volume: 10 });
    const later = bar({ open: 999, high: 105, low: 97, close: 104, volume: 40 });
    const merged = mergeBar(first, later);

    expect(merged.open).toBe(100); // the later frame must not move the open
    expect(merged.high).toBe(105);
    expect(merged.low).toBe(97);
    expect(merged.close).toBe(104);
    expect(merged.volume).toBe(40);
  });

  it("never narrows a range when a late frame reports a smaller one", () => {
    const wide = bar({ high: 110, low: 90 });
    const narrow = bar({ high: 101, low: 99 });
    const merged = mergeBar(wide, narrow);
    expect(merged.high).toBe(110);
    expect(merged.low).toBe(90);
  });

  it("replaces rather than merges when the timestamp differs", () => {
    const prev = bar({ timestamp: 1000, high: 500 });
    const next = bar({ timestamp: 2000, high: 105 });
    expect(mergeBar(prev, next)).toEqual(next);
  });

  it("returns the incoming bar when there is nothing to merge into", () => {
    const b = bar();
    expect(mergeBar(null, b)).toEqual(b);
  });
});
