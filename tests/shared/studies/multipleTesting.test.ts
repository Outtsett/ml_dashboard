import { describe, expect, it } from "vitest";
import { benjaminiYekutieli, harmonicNumber } from "../../../src/shared/studies/multipleTesting";

describe("Benjamini-Yekutieli", () => {
  it("uses the exact harmonic number", () => {
    expect(harmonicNumber(1)).toBe(1);
    expect(harmonicNumber(4)).toBeCloseTo(1 + 1 / 2 + 1 / 3 + 1 / 4, 12);
  });

  it("rejects up to the largest passing rank (step-up)", () => {
    // m = 4, c = 2.0833, q = 0.1: thresholds 0.012, 0.024, 0.036, 0.048
    const result = benjaminiYekutieli([0.001, 0.03, 0.02, 0.5], 0.1);
    expect(result.steps.map((step) => step.passes)).toEqual([true, true, true, false]);
    expect(result.cutoffRank).toBe(3);
  });

  it("passes nothing when no p-value clears its threshold", () => {
    expect(benjaminiYekutieli([0.2, 0.3, 0.4]).cutoffRank).toBe(0);
  });
});
