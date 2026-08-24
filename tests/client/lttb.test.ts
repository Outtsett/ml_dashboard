// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { lttb, type Point } from "../../src/client/src/ml/stages/evaluate/lttb";

function linearSeries(n: number): Point[] {
  return Array.from({ length: n }, (_, i) => ({ x: i, y: i }));
}

function sineSeries(n: number): Point[] {
  return Array.from({ length: n }, (_, i) => ({
    x: i,
    y: Math.sin((i / n) * Math.PI * 8),
  }));
}

describe("lttb", () => {
  it("returns input unchanged when targetCount >= input length", () => {
    const data = linearSeries(50);
    const out = lttb(data, 50);
    expect(out).toEqual(data);
    expect(out).not.toBe(data); // shallow-cloned
    expect(lttb(data, 100)).toHaveLength(50);
  });

  it("returns input unchanged when targetCount < 3", () => {
    const data = linearSeries(50);
    expect(lttb(data, 2)).toHaveLength(50);
    expect(lttb(data, 0)).toHaveLength(50);
  });

  it("returns input unchanged when input length < 3", () => {
    const data = linearSeries(2);
    expect(lttb(data, 100)).toHaveLength(2);
  });

  it("downsamples to exactly targetCount points", () => {
    const data = sineSeries(2000);
    const out = lttb(data, 200);
    expect(out).toHaveLength(200);
  });

  it("always preserves first and last sample", () => {
    const data = sineSeries(1000);
    const out = lttb(data, 50);
    expect(out[0]).toEqual(data[0]);
    expect(out[out.length - 1]).toEqual(data[data.length - 1]);
  });

  it("retains points in monotonically-increasing x order", () => {
    const data = sineSeries(1000);
    const out = lttb(data, 100);
    for (let i = 1; i < out.length; i += 1) {
      expect(out[i]!.x).toBeGreaterThan(out[i - 1]!.x);
    }
  });

  it("preserves the visual extremes of a sine wave better than naive decimation", () => {
    const data = sineSeries(2000);
    const out = lttb(data, 100);
    // The output min/max should hug the source min/max within tolerance —
    // demonstrating LTTB picks peak/trough points rather than uniform stride.
    const srcMin = Math.min(...data.map((p) => p.y));
    const srcMax = Math.max(...data.map((p) => p.y));
    const outMin = Math.min(...out.map((p) => p.y));
    const outMax = Math.max(...out.map((p) => p.y));
    expect(outMax).toBeGreaterThan(srcMax * 0.85);
    expect(outMin).toBeLessThan(srcMin * 0.85);
  });

  it("handles flat input without throwing", () => {
    const data: Point[] = Array.from({ length: 500 }, (_, i) => ({ x: i, y: 1 }));
    const out = lttb(data, 50);
    expect(out).toHaveLength(50);
    expect(out.every((p) => p.y === 1)).toBe(true);
  });
});
