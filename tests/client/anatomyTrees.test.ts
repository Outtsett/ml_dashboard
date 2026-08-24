// @vitest-environment jsdom
/**
 * Pure-logic tests for the model-anatomy tree helpers (no network, no DOM
 * rendering). The fixture mirrors the REAL xgboost JSON dump node shape from
 * booster.get_dump(dump_format='json', with_stats=True): nodeid / depth /
 * split / split_condition / yes / no / missing / gain / cover on split
 * nodes; nodeid / leaf / cover on leaves.
 */

import { describe, expect, it } from "vitest";
import {
  type XgbTreeNode,
  GAIN_STOPS,
  countDescendants,
  coverFraction,
  decisionPath,
  findPath,
  flattenTree,
  formatLeafValue,
  formatThreshold,
  gainFillOpacity,
  gainStopIndex,
  leafValueToken,
  resolveFeature,
} from "../../src/client/src/system/architecture-explorer/trees/types";

/**
 * Realistic 3-level tree over real feature names from the verified
 * xgb_baseline_post dump (return_5, volatility_10, prev_micro_pct).
 *
 *                 [0] return_5 < 0.00123
 *                /                       \
 *   [1] volatility_10 < 0.4        [2] prev_micro_pct < 12.5
 *        /         \                    /          \
 *   [3] -0.0431  [4] +0.0212      [5] +0.0007   [6] +0.088
 */
const FIXTURE: XgbTreeNode = {
  nodeid: 0,
  depth: 0,
  split: "return_5",
  split_condition: 0.00123,
  yes: 1,
  no: 2,
  missing: 1,
  gain: 120.5,
  cover: 1000,
  children: [
    {
      nodeid: 1,
      depth: 1,
      split: "volatility_10",
      split_condition: 0.4,
      yes: 3,
      no: 4,
      missing: 3,
      gain: 60.2,
      cover: 620,
      children: [
        { nodeid: 3, leaf: -0.0431, cover: 400 },
        { nodeid: 4, leaf: 0.0212, cover: 220 },
      ],
    },
    {
      nodeid: 2,
      depth: 1,
      split: "prev_micro_pct",
      split_condition: 12.5,
      yes: 5,
      no: 6,
      missing: 6,
      gain: 22.8,
      cover: 380,
      children: [
        { nodeid: 5, leaf: 0.0007, cover: 180 },
        { nodeid: 6, leaf: 0.088, cover: 200 },
      ],
    },
  ],
};

describe("flattenTree / countDescendants / coverFraction", () => {
  it("flattens preorder — root first, yes-subtree before no-subtree", () => {
    const flat = flattenTree(FIXTURE);
    expect(flat).toHaveLength(7);
    expect(flat.map((n) => n.nodeid)).toEqual([0, 1, 3, 4, 2, 5, 6]);
  });

  it("counts strict descendants", () => {
    expect(countDescendants(FIXTURE)).toBe(6);
    expect(countDescendants(FIXTURE.children![0]!)).toBe(2);
    expect(countDescendants(FIXTURE.children![0]!.children![0]!)).toBe(0);
  });

  it("computes cover fraction relative to root cover", () => {
    const node1 = FIXTURE.children![0]!;
    expect(coverFraction(node1, FIXTURE.cover)).toBeCloseTo(0.62, 10);
    expect(coverFraction(FIXTURE, FIXTURE.cover)).toBe(1);
  });

  it("clamps and survives degenerate root cover", () => {
    const leaf = FIXTURE.children![0]!.children![0]!;
    expect(coverFraction(leaf, 0)).toBe(0);
    expect(coverFraction(leaf, Number.NaN)).toBe(0);
    expect(coverFraction({ nodeid: 99, cover: 5000 }, 1000)).toBe(1); // clamp hi
  });
});

describe("decisionPath / findPath", () => {
  it("returns the correct condition chain to a yes/no mixed leaf", () => {
    // Node 4 = root yes-branch, then node 1's no-branch.
    expect(decisionPath(FIXTURE, 4)).toEqual([
      "return_5 < 0.00123",
      "volatility_10 >= 0.4",
    ]);
  });

  it("returns the correct chain down the no/no side", () => {
    expect(decisionPath(FIXTURE, 6)).toEqual([
      "return_5 >= 0.00123",
      "prev_micro_pct >= 12.5",
    ]);
  });

  it("returns the correct chain down the yes/yes side", () => {
    expect(decisionPath(FIXTURE, 3)).toEqual([
      "return_5 < 0.00123",
      "volatility_10 < 0.4",
    ]);
  });

  it("returns a single condition for depth-1 nodes", () => {
    expect(decisionPath(FIXTURE, 2)).toEqual(["return_5 >= 0.00123"]);
  });

  it("is empty for the root and for unknown nodeids", () => {
    expect(decisionPath(FIXTURE, 0)).toEqual([]);
    expect(decisionPath(FIXTURE, 999)).toEqual([]);
  });

  it("findPath returns the inclusive root→target chain", () => {
    const path = findPath(FIXTURE, 5);
    expect(path).not.toBeNull();
    expect(path!.map((n) => n.nodeid)).toEqual([0, 2, 5]);
    expect(findPath(FIXTURE, 999)).toBeNull();
  });
});

describe("leafValueToken — diverging stops (deuteranopia-safe tokens)", () => {
  const maxAbs = 0.088; // strongest leaf magnitude in the fixture

  it("maps strong negative to --data-div-neg-strong", () => {
    expect(leafValueToken(-0.0431, maxAbs)).toBe("--data-div-neg");
    expect(leafValueToken(-0.088, maxAbs)).toBe("--data-div-neg-strong");
    expect(leafValueToken(-0.05, maxAbs)).toBe("--data-div-neg-strong"); // ≥50% of max
  });

  it("maps strong positive to --data-div-pos-strong and weak to --data-div-pos", () => {
    expect(leafValueToken(0.088, maxAbs)).toBe("--data-div-pos-strong");
    expect(leafValueToken(0.0212, maxAbs)).toBe("--data-div-pos");
  });

  it("maps ~zero and exact zero to the neutral mid stop", () => {
    expect(leafValueToken(0, maxAbs)).toBe("--data-div-mid");
    expect(leafValueToken(0.0007, maxAbs)).toBe("--data-div-mid"); // inside neutral band
    expect(leafValueToken(-0.0007, maxAbs)).toBe("--data-div-mid");
  });

  it("degrades to mid on degenerate inputs", () => {
    expect(leafValueToken(Number.NaN, maxAbs)).toBe("--data-div-mid");
    expect(leafValueToken(0.5, 0)).toBe("--data-div-mid");
    expect(leafValueToken(0.5, Number.NaN)).toBe("--data-div-mid");
  });
});

describe("gain 5-stop scale — discrete and monotonic", () => {
  it("is monotonic non-decreasing in gain", () => {
    const maxGain = 120.5;
    const gains = [0, 1, 5, 12, 22.8, 40, 60.2, 80, 100, 120.5];
    let prev = -1;
    for (const g of gains) {
      const idx = gainStopIndex(g, maxGain);
      expect(idx).toBeGreaterThanOrEqual(prev);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThanOrEqual(GAIN_STOPS.length - 1);
      prev = idx;
    }
  });

  it("pins the extremes: zero gain → first stop, max gain → last stop", () => {
    expect(gainStopIndex(0, 120.5)).toBe(0);
    expect(gainStopIndex(120.5, 120.5)).toBe(GAIN_STOPS.length - 1);
    expect(gainStopIndex(500, 120.5)).toBe(GAIN_STOPS.length - 1); // clamp above max
  });

  it("fill opacity stays inside the 0.06–0.35 band and is monotonic", () => {
    let prev = 0;
    for (const g of [0, 10, 30, 60, 90, 120.5]) {
      const o = gainFillOpacity(g, 120.5);
      expect(o).toBeGreaterThanOrEqual(0.06);
      expect(o).toBeLessThanOrEqual(0.35);
      expect(o).toBeGreaterThanOrEqual(prev);
      prev = o;
    }
  });

  it("degrades to the lowest stop on degenerate inputs", () => {
    expect(gainStopIndex(Number.NaN, 100)).toBe(0);
    expect(gainStopIndex(10, 0)).toBe(0);
    expect(gainFillOpacity(10, 0)).toBe(GAIN_STOPS[0]);
  });
});

describe("formatting + feature resolution", () => {
  it("formatThreshold trims without losing the fixture thresholds", () => {
    expect(formatThreshold(0.00123)).toBe("0.00123");
    expect(formatThreshold(0.4)).toBe("0.4");
    expect(formatThreshold(12.5)).toBe("12.5");
    expect(formatThreshold(0.0000004)).toBe("4.00e-7");
  });

  it("formatLeafValue always carries an explicit sign for non-zero values", () => {
    expect(formatLeafValue(0.0212)).toBe("+0.021");
    expect(formatLeafValue(-0.0431)).toBe("-0.043");
    expect(formatLeafValue(0)).toBe("0.000");
  });

  it("resolveFeature maps fN dump names via booster feature_names", () => {
    const features = ["return_1", "return_5", "volatility_10"];
    expect(resolveFeature("f1", features)).toBe("return_5");
    expect(resolveFeature("f99", features)).toBe("f99"); // out of range → passthrough
    expect(resolveFeature("return_5", features)).toBe("return_5"); // already named
  });
});
