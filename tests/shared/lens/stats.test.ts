import { describe, expect, it } from "vitest";
import {
  areaUnderCurve,
  blockBootstrap,
  bootstrapBlockLength,
  bucketLastIndices,
  clipProbability,
  createRandom,
  eightNumberSummary,
  extremeIndices,
  ordinaryLeastSquares,
  proportionEstimate,
  quantileSorted,
  samplingStride,
  standardDeviation,
} from "@shared/lens/index";

describe("eightNumberSummary", () => {
  it("reproduces the known values for 1, 2, 3, 4", () => {
    const summary = eightNumberSummary([1, 2, 3, 4]);
    expect(summary.count).toBe(4);
    expect(summary.mean).toBe(2.5);
    expect(summary.median).toBe(2.5);
    expect(summary.standardDeviation).toBeCloseTo(Math.sqrt(5 / 3), 12);
    expect(summary.skewness).toBeCloseTo(0, 12);
    // Sample excess kurtosis of a four-point uniform ramp is exactly -1.2.
    expect(summary.kurtosis).toBeCloseTo(-1.2, 12);
    expect(summary.percentile25).toBeCloseTo(1.75, 12);
    expect(summary.percentile75).toBeCloseTo(3.25, 12);
    expect(summary.minimum).toBe(1);
    expect(summary.maximum).toBe(4);
  });

  it("reports a moment as null rather than omitting it when there is not enough data", () => {
    const three = eightNumberSummary([1, 2, 4]);
    expect(three.count).toBe(3);
    expect(three.skewness).not.toBeNull();
    expect(three.kurtosis).toBeNull();

    const two = eightNumberSummary([1, 2]);
    expect(two.skewness).toBeNull();
    expect(two.standardDeviation).toBeCloseTo(Math.SQRT1_2, 12);

    const one = eightNumberSummary([5]);
    expect(one.count).toBe(1);
    expect(one.standardDeviation).toBeNull();
    expect(one.median).toBe(5);

    const none = eightNumberSummary([]);
    expect(none.count).toBe(0);
    expect(none.mean).toBeNull();
    expect(none.maximum).toBeNull();
  });

  it("drops non-finite values instead of letting them poison the moments", () => {
    const summary = eightNumberSummary([1, Number.NaN, 2, Number.POSITIVE_INFINITY, 3, 4]);
    expect(summary.count).toBe(4);
    expect(summary.mean).toBe(2.5);
  });

  it("carries a known right-skewed sample", () => {
    // Sample skewness of [1, 1, 1, 5] is 2 exactly.
    const summary = eightNumberSummary([1, 1, 1, 5]);
    expect(summary.skewness).toBeCloseTo(2, 10);
  });
});

describe("quantileSorted", () => {
  it("interpolates linearly between order statistics", () => {
    const sorted = [0, 1, 2, 3, 4];
    expect(quantileSorted(sorted, 0)).toBe(0);
    expect(quantileSorted(sorted, 1)).toBe(4);
    expect(quantileSorted(sorted, 0.5)).toBe(2);
    expect(quantileSorted(sorted, 0.125)).toBeCloseTo(0.5, 12);
    expect(quantileSorted([], 0.5)).toBeNull();
  });
});

describe("areaUnderCurve", () => {
  it("is 1 for a perfect ranking and 0.5 when every score ties", () => {
    expect(areaUnderCurve([0.1, 0.2, 0.8, 0.9], [0, 0, 1, 1])).toBe(1);
    expect(areaUnderCurve([0.5, 0.5, 0.5, 0.5], [0, 0, 1, 1])).toBe(0.5);
  });

  it("averages the rank of tied scores", () => {
    // Scores 1, 2, 2, 3 with positives on the second and fourth row:
    // ranks 1, 2.5, 2.5, 4 -> (2.5 + 4 - 3) / 4 = 0.875.
    expect(areaUnderCurve([1, 2, 2, 3], [0, 1, 0, 1])).toBeCloseTo(0.875, 12);
  });

  it("is null when one class is missing", () => {
    expect(areaUnderCurve([0.1, 0.2], [0, 0])).toBeNull();
    expect(areaUnderCurve([], [])).toBeNull();
  });
});

describe("proportionEstimate", () => {
  it("widens the interval by the overlap factor and never leaves [0, 1]", () => {
    const independent = proportionEstimate(60, 100, 1);
    const overlapping = proportionEstimate(60, 100, 5);
    expect(independent.value).toBeCloseTo(0.6, 12);
    expect(overlapping.value).toBeCloseTo(0.6, 12);
    const independentWidth = (independent.ciHigh as number) - (independent.ciLow as number);
    const overlappingWidth = (overlapping.ciHigh as number) - (overlapping.ciLow as number);
    expect(overlappingWidth).toBeGreaterThan(independentWidth);
    expect(overlappingWidth / independentWidth).toBeCloseTo(Math.sqrt(5), 10);

    const certain = proportionEstimate(100, 100, 1);
    expect(certain.ciHigh).toBeLessThanOrEqual(1);
    expect(certain.ciLow).toBeGreaterThanOrEqual(0);
    expect(proportionEstimate(0, 0, 5).n).toBe(0);
  });
});

describe("ordinaryLeastSquares", () => {
  it("recovers an exact line", () => {
    const fit = ordinaryLeastSquares([0, 1, 2, 3], [1, 3, 5, 7]);
    expect(fit?.slope).toBeCloseTo(2, 12);
    expect(fit?.intercept).toBeCloseTo(1, 12);
    expect(fit?.rSquared).toBeCloseTo(1, 12);
    expect(fit?.n).toBe(4);
  });

  it("refuses a degenerate predictor", () => {
    expect(ordinaryLeastSquares([1, 1, 1], [1, 2, 3])).toBeNull();
    expect(ordinaryLeastSquares([1], [1])).toBeNull();
  });
});

describe("clipProbability", () => {
  it("keeps a log from reaching infinity", () => {
    expect(Number.isFinite(Math.log(clipProbability(0)))).toBe(true);
    expect(Number.isFinite(Math.log(1 - clipProbability(1)))).toBe(true);
    expect(clipProbability(0.3)).toBe(0.3);
  });
});

describe("downsampling", () => {
  it("keeps the last index of every bucket and always ends on the final index", () => {
    const kept = bucketLastIndices(10, 5);
    expect(Array.from(kept)).toEqual([1, 3, 5, 7, 9]);
    expect(Array.from(bucketLastIndices(4, 10))).toEqual([0, 1, 2, 3]);
    expect(Array.from(bucketLastIndices(0, 10))).toEqual([]);
  });

  it("keeps the extremes so a drawdown cannot be thinned away", () => {
    const values = new Float64Array(100);
    for (let index = 0; index < 100; index += 1) values[index] = index;
    values[37] = -1000; // the bottom of a drawdown
    values[63] = 1000; // a spike
    const kept = Array.from(extremeIndices(values, 10));
    expect(kept).toContain(37);
    expect(kept).toContain(63);
    expect(kept[0]).toBe(0);
    expect(kept[kept.length - 1]).toBe(99);
    expect(kept.length).toBeLessThanOrEqual(12);
    // Ascending, no duplicates.
    expect(kept).toEqual([...new Set(kept)].sort((a, b) => a - b));
  });

  it("computes a deterministic stride", () => {
    expect(samplingStride(100, 10)).toBe(10);
    expect(samplingStride(10, 100)).toBe(1);
    expect(samplingStride(0, 100)).toBe(1);
  });
});

describe("blockBootstrap", () => {
  it("uses the cube-root block length", () => {
    expect(bootstrapBlockLength(264)).toBe(7);
    expect(bootstrapBlockLength(8)).toBe(2);
    expect(bootstrapBlockLength(1)).toBe(1);
    expect(bootstrapBlockLength(0)).toBe(1);
  });

  it("is seeded, so the same sample always yields the same interval", () => {
    const values = Array.from({ length: 200 }, (_, index) => Math.sin(index) * 3 - 1);
    const statistic = (indices: Int32Array) => {
      let total = 0;
      for (let i = 0; i < indices.length; i += 1) total += values[indices[i] as number] as number;
      return total / indices.length;
    };
    const first = blockBootstrap(values.length, { meanValue: statistic });
    const second = blockBootstrap(values.length, { meanValue: statistic });
    expect(first.statistics.meanValue).toEqual(second.statistics.meanValue);
    expect(first.blockLength).toBe(6);
    expect((first.statistics.meanValue?.ciLow as number) < (first.statistics.meanValue?.ciHigh as number)).toBe(true);
  });

  it("counts the resamples on which a statistic was undefined", () => {
    const result = blockBootstrap(20, { always: () => null }, { resampleCount: 25 });
    expect(result.statistics.always?.skippedResamples).toBe(25);
    expect(result.statistics.always?.ciLow).toBeNull();
  });

  it("returns an empty result for an empty sample", () => {
    const result = blockBootstrap(0, { any: () => 1 });
    expect(result.statistics.any?.ciLow).toBeNull();
  });
});

describe("createRandom", () => {
  it("produces the same stream for the same seed and stays inside [0, 1)", () => {
    const first = createRandom(42);
    const second = createRandom(42);
    for (let draw = 0; draw < 50; draw += 1) {
      const value = first();
      expect(value).toBe(second());
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe("standardDeviation", () => {
  it("divides by n - 1 and is null below two observations", () => {
    expect(standardDeviation([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.1380899352993947, 12);
    expect(standardDeviation([1])).toBeNull();
  });
});
