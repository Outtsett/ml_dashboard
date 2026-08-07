/**
 * ETA estimation.
 *
 * The behaviour worth pinning is mostly about *declining* to estimate. An ETA
 * that appears early and then drifts wildly trains the user to ignore it, so
 * these tests are as much about the null cases as the numeric ones.
 */

import { describe, it, expect } from "vitest";
import {
  pushSample,
  trailingMedianRate,
  estimateEtaSeconds,
  formatDuration,
  MAX_SAMPLES,
  type ProgressSample,
} from "@/ml/telemetry/eta";

/** Samples advancing at a constant `pctPerSec`, starting at t=0. */
function steady(count: number, pctPerSec: number, startPct = 0): ProgressSample[] {
  return Array.from({ length: count }, (_, i) => ({
    t: i * 1000,
    progress: startPct + i * pctPerSec,
  }));
}

describe("pushSample", () => {
  it("appends in order", () => {
    const out = pushSample([{ t: 0, progress: 1 }], { t: 1000, progress: 2 });
    expect(out).toHaveLength(2);
    expect(out[1]!.progress).toBe(2);
  });

  it("drops history when progress moves backwards", () => {
    // A new run restarting at 0 must not inherit the old run's rate.
    const old = steady(10, 5);
    const out = pushSample(old, { t: 99_999, progress: 0 });
    expect(out).toHaveLength(1);
    expect(out[0]!.progress).toBe(0);
  });

  it("replaces rather than appends when progress is unchanged", () => {
    // A stall should show as elapsed time, not as a run of zero-rate samples
    // that would drag the median to zero and suppress the estimate.
    const base = steady(4, 5);
    const stalled = pushSample(base, { t: 10_000, progress: base[3]!.progress });
    expect(stalled).toHaveLength(base.length);
    expect(stalled[stalled.length - 1]!.t).toBe(10_000);
  });

  it("caps the buffer", () => {
    let samples: ProgressSample[] = [];
    for (let i = 0; i < MAX_SAMPLES + 25; i++) {
      samples = pushSample(samples, { t: i * 1000, progress: i * 0.1 });
    }
    expect(samples.length).toBeLessThanOrEqual(MAX_SAMPLES);
  });
});

describe("trailingMedianRate", () => {
  it("returns null below the minimum sample count", () => {
    expect(trailingMedianRate([])).toBeNull();
    expect(trailingMedianRate(steady(2, 5))).toBeNull();
  });

  it("recovers a constant rate", () => {
    // 5% per 1000ms = 0.005 %/ms
    const rate = trailingMedianRate(steady(10, 5));
    expect(rate).toBeCloseTo(0.005, 6);
  });

  it("ignores a single stall outlier, where a mean would not", () => {
    const samples = steady(10, 5);
    // Insert a 60-second stall: one interval with almost no progress.
    samples.push({ t: samples[9]!.t + 60_000, progress: samples[9]!.progress + 0.1 });
    samples.push({ t: samples[10]!.t + 1000, progress: samples[10]!.progress + 5 });

    const rate = trailingMedianRate(samples)!;
    const intervals = samples.slice(1).map((s, i) => ({
      dp: s.progress - samples[i]!.progress,
      dt: s.t - samples[i]!.t,
    }));
    const mean =
      intervals.reduce((acc, x) => acc + x.dp / x.dt, 0) / intervals.length;

    // The median stays near the true 0.005; the mean is dragged down.
    expect(rate).toBeCloseTo(0.005, 3);
    expect(mean).toBeLessThan(rate);
  });

  it("returns null for a fully stalled run rather than a rate of zero", () => {
    const stalled: ProgressSample[] = [
      { t: 0, progress: 40 },
      { t: 1000, progress: 40 },
      { t: 2000, progress: 40 },
      { t: 3000, progress: 40 },
      { t: 4000, progress: 40 },
    ];
    expect(trailingMedianRate(stalled)).toBeNull();
  });

  it("skips non-positive intervals from clock artifacts", () => {
    const samples: ProgressSample[] = [
      { t: 0, progress: 0 },
      { t: 1000, progress: 5 },
      { t: 1000, progress: 10 }, // same timestamp — would divide by zero
      { t: 2000, progress: 15 },
      { t: 3000, progress: 20 },
    ];
    const rate = trailingMedianRate(samples);
    expect(rate).not.toBeNull();
    expect(Number.isFinite(rate!)).toBe(true);
  });
});

describe("estimateEtaSeconds", () => {
  it("returns null without enough data", () => {
    expect(estimateEtaSeconds([])).toBeNull();
    expect(estimateEtaSeconds(steady(2, 5))).toBeNull();
  });

  it("estimates remaining time from the trailing rate", () => {
    // 10 samples at 5%/s ends at 45%; 55% remaining at 5%/s = 11s.
    const eta = estimateEtaSeconds(steady(10, 5));
    expect(eta).toBeCloseTo(11, 1);
  });

  it("returns null once complete", () => {
    const done = steady(21, 5); // reaches 100
    expect(done[done.length - 1]!.progress).toBeGreaterThanOrEqual(100);
    expect(estimateEtaSeconds(done)).toBeNull();
  });

  it("shortens as the run advances", () => {
    const early = estimateEtaSeconds(steady(6, 5))!;
    const late = estimateEtaSeconds(steady(15, 5))!;
    expect(late).toBeLessThan(early);
  });
});

describe("formatDuration", () => {
  it("formats across magnitudes", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(45)).toBe("45s");
    expect(formatDuration(60)).toBe("1m");
    expect(formatDuration(95)).toBe("1m 35s");
    expect(formatDuration(3600)).toBe("1h");
    expect(formatDuration(3900)).toBe("1h 5m");
  });

  it("degrades on nonsense input instead of rendering NaN", () => {
    expect(formatDuration(NaN)).toBe("—");
    expect(formatDuration(-5)).toBe("—");
    expect(formatDuration(Infinity)).toBe("—");
  });
});
