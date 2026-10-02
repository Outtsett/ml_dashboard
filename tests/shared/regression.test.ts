/**
 * Parity of packages/shared/src/regression against statsmodels / scipy.
 *
 * The fixture is produced by scripts/regression_parity_fixture.py from five
 * fixed-seed datasets chosen to exercise what the regression tab will see:
 * clean noise, two independent random walks (the spurious regression a price
 * level produces), heavy tails with planted outliers and high-leverage points,
 * tied integers (midrank Spearman), and AR(1) errors (Durbin-Watson, HAC).
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BASIS_POINTS,
  GAP_ALLOWANCE_MILLISECONDS,
  MAXIMUM_MARGINAL_BINS,
  MINIMUM_MARGINAL_BINS,
  benjaminiHochberg,
  buildPairs,
  clusterPoints,
  densityAt,
  densityGrid,
  densityRegionAt,
  fitSimpleRegression,
  kMeans,
  localLinearTrend,
  marginalHistogram,
  midranks,
  quantileBuckets,
  refitWithout,
  silhouetteScore,
  studentTQuantile,
  studentTUpperTail,
  trendAt,
  type RegressionFit,
} from "@shared/regression/index";

interface FixtureCase {
  name: string;
  x: number[];
  y: number[];
  expected: Record<string, unknown> & {
    band: Record<string, number[]>;
    residualSummary: Record<string, number>;
    quintiles: {
      buckets: Array<Record<string, number>>;
      spread: number;
      spreadTStatistic: number;
      spreadPValue: number;
    };
  };
}

interface Fixture {
  confidenceLevel: number;
  outlierFamilyAlpha: number;
  bandSamples: number;
  cases: FixtureCase[];
  student: {
    quantiles: Array<{ probability: number; degreesOfFreedom: number; quantile: number }>;
    upperTails: Array<{ t: number; degreesOfFreedom: number; upperTail: number }>;
  };
  benjaminiHochberg: { pValues: number[]; qValues: number[] };
}

const fixture = JSON.parse(
  readFileSync(path.join(__dirname, "..", "fixtures", "regression-parity.json"), "utf-8"),
) as Fixture;

const RELATIVE = 1e-9;

function close(actual: number, expected: number, relative = RELATIVE, absolute = 1e-12): void {
  if (!Number.isFinite(expected)) {
    expect(actual).toBe(expected);
    return;
  }
  const tolerance = Math.max(absolute, relative * Math.abs(expected));
  if (!(Math.abs(actual - expected) <= tolerance)) {
    throw new Error(`expected ${expected}, got ${actual} (difference ${Math.abs(actual - expected)}, tolerance ${tolerance})`);
  }
}

function closeArray(actual: ArrayLike<number>, expected: number[], relative = RELATIVE, absolute = 1e-12): void {
  expect(actual.length).toBe(expected.length);
  for (let index = 0; index < expected.length; index += 1) {
    close(actual[index] as number, expected[index] as number, relative, absolute);
  }
}

describe("Student's t", () => {
  it("matches scipy.stats.t.ppf, including the Bonferroni tails", () => {
    for (const row of fixture.student.quantiles) {
      close(studentTQuantile(row.probability, row.degreesOfFreedom), row.quantile, 1e-9, 1e-12);
    }
  });

  it("matches scipy.stats.t.sf", () => {
    for (const row of fixture.student.upperTails) {
      close(studentTUpperTail(row.t, row.degreesOfFreedom), row.upperTail, 1e-9, 1e-15);
    }
  });

  it("reproduces the critical values to 40-digit (mpmath) precision", () => {
    close(studentTQuantile(0.975, 10), 2.2281388519862747, 1e-14);
    close(studentTQuantile(0.975, 30), 2.0422724563012378, 1e-14);
  });
});

describe("fitSimpleRegression parity with statsmodels", () => {
  for (const testCase of fixture.cases) {
    describe(testCase.name, () => {
      const result = fitSimpleRegression(testCase.x, testCase.y, {
        confidenceLevel: fixture.confidenceLevel,
        outlierFamilyAlpha: fixture.outlierFamilyAlpha,
        bandSamples: fixture.bandSamples,
      });
      if (!result.ok) throw new Error(result.reason);
      const fit: RegressionFit = result.fit;
      const expected = testCase.expected;

      it("coefficients, errors and tests", () => {
        expect(fit.n).toBe(expected.n);
        expect(fit.degreesOfFreedom).toBe(expected.degreesOfFreedom);
        for (const key of [
          "intercept", "slope", "interceptStandardError", "slopeStandardError", "slopeTStatistic",
          "rSquared", "adjustedRSquared", "pearsonCorrelation", "spearmanCorrelation",
          "residualStandardError", "tCritical", "durbinWatson", "residualLagOneAutocorrelation",
          "verticalOutlierCutoff",
        ] as const) {
          close(fit[key] as number, expected[key] as number);
        }
        // A p-value is a tail area: hold it relatively, down to 1e-300.
        close(fit.slopePValue, expected.slopePValue as number, 1e-8, 1e-300);
        closeArray(fit.slopeConfidenceInterval, expected.slopeConfidenceInterval as number[]);
      });

      it("Newey-West slope error (statsmodels HAC, no small-sample correction)", () => {
        expect(fit.neweyWestLag).toBe(expected.neweyWestLag);
        close(fit.slopeStandardErrorNeweyWest, expected.slopeStandardErrorNeweyWest as number, 1e-8);
        close(fit.slopeTStatisticNeweyWest, expected.slopeTStatisticNeweyWest as number, 1e-8);
        close(fit.slopePValueNeweyWest, expected.slopePValueNeweyWest as number, 1e-7, 1e-300);
      });

      it("per-point influence", () => {
        closeArray(fit.fitted, expected.fitted as number[]);
        closeArray(fit.residuals, expected.residuals as number[], 1e-8, 1e-9);
        closeArray(fit.leverage, expected.leverage as number[]);
        closeArray(fit.studentizedInternal, expected.studentizedInternal as number[], 1e-8, 1e-9);
        closeArray(fit.studentizedExternal, expected.studentizedExternal as number[], 1e-8, 1e-9);
        closeArray(fit.cookDistance, expected.cookDistance as number[], 1e-8, 1e-14);
      });

      it("confidence and prediction bands", () => {
        closeArray(fit.band.x, expected.band.x as number[]);
        closeArray(fit.band.fitted, expected.band.fitted as number[]);
        closeArray(fit.band.meanLower, expected.band.meanLower as number[]);
        closeArray(fit.band.meanUpper, expected.band.meanUpper as number[]);
        closeArray(fit.band.predictionLower, expected.band.predictionLower as number[]);
        closeArray(fit.band.predictionUpper, expected.band.predictionUpper as number[]);
      });

      it("outlier flags follow their cut-offs", () => {
        let vertical = 0;
        let influential = 0;
        for (let index = 0; index < fit.n; index += 1) {
          const expectedVertical = Math.abs((expected.studentizedExternal as number[])[index] as number) > fit.verticalOutlierCutoff;
          const expectedInfluential = ((expected.cookDistance as number[])[index] as number) > 4 / fit.n;
          expect(fit.verticalOutlier[index] === 1).toBe(expectedVertical);
          expect(fit.influential[index] === 1).toBe(expectedInfluential);
          vertical += expectedVertical ? 1 : 0;
          influential += expectedInfluential ? 1 : 0;
        }
        expect(fit.verticalOutlierCount).toBe(vertical);
        expect(fit.influentialCount).toBe(influential);
      });

      it("residual eight-number summary", () => {
        for (const [key, value] of Object.entries(expected.residualSummary)) {
          close(fit.residualSummary[key as keyof typeof fit.residualSummary] as number, value, 1e-8, 1e-10);
        }
      });

      it("quintile means and the top-minus-bottom spread", () => {
        const buckets = quantileBuckets(testCase.x, testCase.y, 5, fixture.confidenceLevel);
        if (!buckets) throw new Error("no buckets");
        expect(buckets.buckets).toHaveLength(expected.quintiles.buckets.length);
        buckets.buckets.forEach((bucket, index) => {
          const reference = expected.quintiles.buckets[index] as Record<string, number>;
          for (const [key, value] of Object.entries(reference)) {
            close(bucket[key as keyof typeof bucket] as number, value);
          }
        });
        close(buckets.spread, expected.quintiles.spread);
        close(buckets.spreadTStatistic, expected.quintiles.spreadTStatistic);
        close(buckets.spreadPValue, expected.quintiles.spreadPValue, 1e-7, 1e-300);
      });
    });
  }

  it("flags the two independent random walks as a suspected spurious regression", () => {
    const walks = fixture.cases.find((entry) => entry.name === "independent_random_walks") as FixtureCase;
    const result = fitSimpleRegression(walks.x, walks.y);
    if (!result.ok) throw new Error(result.reason);
    expect(result.fit.spuriousRegressionSuspected).toBe(true);
    const clean = fixture.cases.find((entry) => entry.name === "linear_independent_noise") as FixtureCase;
    const cleanResult = fitSimpleRegression(clean.x, clean.y);
    if (!cleanResult.ok) throw new Error(cleanResult.reason);
    expect(cleanResult.fit.spuriousRegressionSuspected).toBe(false);
  });

  it("catches the planted outliers", () => {
    const planted = fixture.cases.find((entry) => entry.name === "heavy_tails_with_outliers") as FixtureCase;
    const result = fitSimpleRegression(planted.x, planted.y);
    if (!result.ok) throw new Error(result.reason);
    // The two high-leverage points (indices 5 and 6) pull the line.
    expect(result.fit.influential[5]).toBe(1);
    expect(result.fit.influential[6]).toBe(1);
    expect(result.fit.verticalOutlierCount).toBeGreaterThanOrEqual(3);
  });
});

describe("degenerate inputs", () => {
  it("refuses fewer than four points", () => {
    const result = fitSimpleRegression([1, 2, 3], [1, 2, 3]);
    expect(result.ok).toBe(false);
  });

  it("refuses values too large to square instead of reporting no relationship", () => {
    const result = fitSimpleRegression([1e200, 2e200, 3e200, 4e200, 5e200], [1, 2, 3, 5, 4]);
    expect(result.ok).toBe(false);
  });

  it("refuses a constant X", () => {
    const result = fitSimpleRegression([2, 2, 2, 2, 2], [1, 2, 3, 4, 5]);
    expect(result.ok).toBe(false);
  });
});

describe("refitWithout", () => {
  it("drops the flagged points and refits", () => {
    const x = [1, 2, 3, 4, 5, 6];
    const y = [2, 4, 6, 8, 10, 100];
    const result = refitWithout(x, y, [0, 0, 0, 0, 0, 1]);
    if (!result.ok) throw new Error(result.reason);
    close(result.fit.slope, 2);
    close(result.fit.intercept, 0, 1e-9, 1e-12);
  });
});

describe("buildPairs", () => {
  const close_ = [100, 101, 99, 102, 105];
  const variable = [null, 1, 2, 4, 8];

  it("level: drops the missing X, keeps bar order", () => {
    const pairs = buildPairs(close_, variable, { mode: "level", horizonBars: 1 });
    expect(Array.from(pairs.x)).toEqual([1, 2, 4, 8]);
    expect(Array.from(pairs.y)).toEqual([101, 99, 102, 105]);
    expect(Array.from(pairs.barIndex)).toEqual([1, 2, 3, 4]);
  });

  it("difference: needs both this and the previous value", () => {
    const pairs = buildPairs(close_, variable, { mode: "difference", horizonBars: 1 });
    expect(Array.from(pairs.x)).toEqual([1, 2, 4]);
    expect(Array.from(pairs.y)).toEqual([-2, 3, 3]);
    expect(Array.from(pairs.barIndex)).toEqual([2, 3, 4]);
  });

  it("forward_return: X now against the log return h bars ahead, in basis points", () => {
    const pairs = buildPairs(close_, variable, { mode: "forward_return", horizonBars: 2 });
    expect(Array.from(pairs.barIndex)).toEqual([1, 2]);
    expect(Array.from(pairs.x)).toEqual([1, 2]);
    close(pairs.y[0] as number, BASIS_POINTS * Math.log(102 / 101));
    close(pairs.y[1] as number, BASIS_POINTS * Math.log(105 / 99));
  });
});

describe("buildPairs across gaps in the data", () => {
  const minute = 60_000;
  // Five contiguous one-minute bars, then a two-month hole, then five more.
  const hole = 60 * 24 * 60 * minute;
  const times = [0, 1, 2, 3, 4].map((index) => index * minute)
    .concat([0, 1, 2, 3, 4].map((index) => 4 * minute + hole + index * minute));
  const closes = [100, 101, 102, 103, 104, 200, 201, 202, 203, 204];
  const variable = closes.map((_, index) => index);
  const clock = { timestampsMilliseconds: times, barMilliseconds: minute };

  it("drops a forward return that spans the hole, and counts it", () => {
    const pairs = buildPairs(closes, variable, { mode: "forward_return", horizonBars: 2, ...clock });
    // Starts 3 and 4 would reach across the hole to bars 5 and 6.
    expect(Array.from(pairs.barIndex)).toEqual([0, 1, 2, 5, 6, 7]);
    expect(pairs.skippedAcrossGaps).toBe(2);
  });

  it("drops the one change that spans the hole", () => {
    const pairs = buildPairs(closes, variable, { mode: "difference", horizonBars: 1, ...clock });
    expect(pairs.skippedAcrossGaps).toBe(1);
    expect(Array.from(pairs.barIndex)).not.toContain(5);
  });

  it("keeps a weekend, which is within the allowance", () => {
    const weekend = [0, minute, minute + GAP_ALLOWANCE_MILLISECONDS - minute, minute + GAP_ALLOWANCE_MILLISECONDS];
    const pairs = buildPairs([1, 2, 3, 4], [1, 2, 3, 4], {
      mode: "difference", horizonBars: 1, timestampsMilliseconds: weekend, barMilliseconds: minute,
    });
    expect(pairs.skippedAcrossGaps).toBe(0);
    expect(pairs.x.length).toBe(3);
  });

  it("level pairs never span bars, so nothing is dropped", () => {
    const pairs = buildPairs(closes, variable, { mode: "level", horizonBars: 1, ...clock });
    expect(pairs.skippedAcrossGaps).toBe(0);
    expect(pairs.x.length).toBe(10);
  });
});

describe("quantileBuckets with a discrete X", () => {
  it("never splits one X value across buckets, so the spread is not time order", () => {
    // X is 1 on 90 of 100 rows and y is the row index: a tie-splitting rule
    // turned time order into a 'significant' top-minus-bottom spread.
    const x = Array.from({ length: 100 }, (_, index) => (index % 10 === 0 ? 0 : 1));
    const y = Array.from({ length: 100 }, (_, index) => index);
    const buckets = quantileBuckets(x, y, 5);
    if (!buckets) throw new Error("expected two buckets");
    expect(buckets.buckets).toHaveLength(2);
    expect(buckets.buckets[0]?.maximumX).toBe(0);
    expect(buckets.buckets[1]?.minimumX).toBe(1);
  });

  it("returns nothing when X takes one value", () => {
    expect(quantileBuckets(new Array(50).fill(3), Array.from({ length: 50 }, (_, index) => index))).toBeNull();
  });
});

describe("midranks and Benjamini-Hochberg", () => {
  it("averages tied ranks", () => {
    expect(Array.from(midranks([10, 20, 20, 5]))).toEqual([2, 3.5, 3.5, 1]);
  });

  it("matches statsmodels multipletests(fdr_bh)", () => {
    closeArray(benjaminiHochberg(fixture.benjaminiHochberg.pValues), fixture.benjaminiHochberg.qValues);
  });
});

// ── The scatter's context layers: local trend, density, marginals, groups ──

interface ContextFixture {
  lowess: Array<{ name: string; x: number[]; y: number[]; span: number; grid: number[]; fitted: Array<number | null> }>;
  kMeans: Array<{
    name: string; x: number[]; y: number[]; initialX: number[]; initialY: number[];
    labels: number[]; inertia: number; centersX: number[]; centersY: number[]; silhouette: number;
  }>;
  histograms: Array<{ name: string; values: number[]; binCount: number; rule: "fd" | "sturges" }>;
}
const context = fixture as unknown as ContextFixture;

describe("localLinearTrend parity with statsmodels lowess(it=0)", () => {
  for (const testCase of context.lowess) {
    it(testCase.name, () => {
      const trend = localLinearTrend(testCase.x, testCase.y, { span: testCase.span, evaluationPoints: testCase.grid.length });
      expect(trend).not.toBeNull();
      closeArray(trend!.x, testCase.grid, 1e-12, 1e-12);
      closeArray(trend!.fitted, testCase.fitted.map((value) => value ?? Number.NaN), 1e-9, 1e-9);
    });
  }

  it("recovers a straight line exactly, slope included, with zero-width bands", () => {
    const x = Array.from({ length: 200 }, (_, index) => Math.sin(index * 12.9898) * 50);
    const y = x.map((value) => 4 - 0.75 * value);
    const trend = localLinearTrend(x, y, { span: 0.3 })!;
    for (let index = 0; index < trend.x.length; index += 1) {
      close(trend.fitted[index] as number, 4 - 0.75 * (trend.x[index] as number), 1e-9, 1e-9);
      close(trend.slope[index] as number, -0.75, 1e-9, 1e-9);
    }
    expect(trend.residualStandardError).toBeLessThan(1e-9);
  });

  it("reads its effective parameters between a straight line (2) and interpolation (n)", () => {
    const testCase = context.lowess.find((candidate) => candidate.name === "sine_bend")!;
    const trend = localLinearTrend(testCase.x, testCase.y, { span: testCase.span })!;
    expect(trend.effectiveParameters).toBeGreaterThan(2);
    expect(trend.effectiveParameters).toBeLessThan(testCase.x.length / 4);
    expect(trend.neighbours).toBe(Math.floor(testCase.span * testCase.x.length + 1e-10));
  });

  it("gives the local slope at the cursor from the nearest grid point", () => {
    const testCase = context.lowess.find((candidate) => candidate.name === "sine_bend")!;
    const trend = localLinearTrend(testCase.x, testCase.y, { span: testCase.span })!;
    const at = trendAt(trend, trend.x[10] as number)!;
    expect(at.fitted).toBe(trend.fitted[10]);
    expect(at.slopeStandardError).toBeGreaterThan(0);
    expect(at.lower).toBeLessThan(at.fitted);
    expect(at.upper).toBeGreaterThan(at.fitted);
  });
});

describe("densityGrid", () => {
  // Two groups of unequal spread: the binned-and-blurred grid must match the
  // exact product-Gaussian kernel density evaluated cell by cell.
  const x: number[] = [];
  const y: number[] = [];
  for (let index = 0; index < 1200; index += 1) {
    const u = Math.sin(index * 78.233) * 43758.5453;
    const v = Math.sin(index * 12.9898) * 24634.6345;
    const a = (u - Math.floor(u)) * 2 - 1;
    const b = (v - Math.floor(v)) * 2 - 1;
    const second = index % 3 === 0;
    x.push((second ? 6 : 0) + a * (second ? 0.8 : 2));
    y.push((second ? 3 : 0) + b * (second ? 0.5 : 1.5));
  }
  const grid = densityGrid(x, y, { columns: 48, rows: 40 })!;

  it("holds unit mass and Scott bandwidths", () => {
    let total = 0;
    for (const value of grid.values) total += value;
    close(total, 1, 1e-12, 1e-12);
    const deviation = (values: number[]) => {
      const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
      return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1));
    };
    close(grid.bandwidthX, Math.pow(1200, -1 / 6) * deviation(x), 1e-12);
    close(grid.bandwidthY, Math.pow(1200, -1 / 6) * deviation(y), 1e-12);
  });

  it("matches the exact product-kernel density (correlation >= 0.99)", () => {
    const exact: number[] = [];
    const cellX = (grid.maximumX - grid.minimumX) / grid.columns;
    const cellY = (grid.maximumY - grid.minimumY) / grid.rows;
    for (let j = 0; j < grid.rows; j += 1) {
      for (let i = 0; i < grid.columns; i += 1) {
        const cx = grid.minimumX + (i + 0.5) * cellX;
        const cy = grid.minimumY + (j + 0.5) * cellY;
        let sum = 0;
        for (let index = 0; index < x.length; index += 1) {
          sum += Math.exp(-0.5 * (((x[index] as number) - cx) / grid.bandwidthX) ** 2 - 0.5 * (((y[index] as number) - cy) / grid.bandwidthY) ** 2);
        }
        exact.push(sum);
      }
    }
    const binned = Array.from(grid.values);
    const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
    const ma = mean(exact);
    const mb = mean(binned);
    let covariance = 0;
    let va = 0;
    let vb = 0;
    for (let index = 0; index < exact.length; index += 1) {
      covariance += ((exact[index] as number) - ma) * ((binned[index] as number) - mb);
      va += ((exact[index] as number) - ma) ** 2;
      vb += ((binned[index] as number) - mb) ** 2;
    }
    expect(covariance / Math.sqrt(va * vb)).toBeGreaterThanOrEqual(0.99);
  });

  it("nests its highest-density regions and places the data inside them", () => {
    const [fifty, eighty, ninetyFive] = grid.levels;
    expect(fifty!.threshold).toBeGreaterThan(eighty!.threshold);
    expect(eighty!.threshold).toBeGreaterThan(ninetyFive!.threshold);
    // Hyndman's density quantiles: each contour holds its share of the actual bars.
    const inside = (level: number) => x.filter((value, index) => densityAt(grid, value, y[index] as number) >= level).length / x.length;
    close(inside(fifty!.threshold), 0.5, 0.01);
    close(inside(eighty!.threshold), 0.8, 0.01);
    close(inside(ninetyFive!.threshold), 0.95, 0.01);
    close(densityRegionAt(grid, x[0] as number, y[0] as number), 1 - (x.filter((value, index) => densityAt(grid, value, y[index] as number) < densityAt(grid, x[0] as number, y[0] as number)).length / x.length), 0.02, 0.02);
    expect(densityRegionAt(grid, 0, 0)).toBeLessThan(densityRegionAt(grid, 6, -4));
    expect(densityRegionAt(grid, 1e9, 1e9)).toBe(1);
  });

  it("declines a constant axis", () => {
    expect(densityGrid([1, 1, 1, 1], [1, 2, 3, 4])).toBeNull();
  });
});

describe("marginalHistogram matches numpy's bin count", () => {
  for (const testCase of context.histograms) {
    it(`${testCase.name} (numpy bins="${testCase.rule}")`, () => {
      const histogram = marginalHistogram(testCase.values)!;
      expect(histogram.counts.length).toBe(Math.min(MAXIMUM_MARGINAL_BINS, Math.max(MINIMUM_MARGINAL_BINS, testCase.binCount)));
      expect(Array.from(histogram.counts).reduce((sum, value) => sum + value, 0)).toBe(testCase.values.length);
      expect(histogram.rule).toBe(testCase.rule === "fd" ? "freedman_diaconis" : "sturges");
    });
  }

  it("falls back to Sturges when the middle half is one value", () => {
    const flag = Array.from({ length: 500 }, (_, index) => (index % 25 === 0 ? 1 : 0));
    const histogram = marginalHistogram(flag)!;
    expect(histogram.rule).toBe("sturges");
    expect(histogram.counts[0]).toBe(480);
    expect(histogram.counts[histogram.counts.length - 1]).toBe(20);
  });
});

describe("k-means parity with scikit-learn (lloyd, tol=0)", () => {
  for (const testCase of context.kMeans) {
    it(testCase.name, () => {
      const result = kMeans(testCase.x, testCase.y, testCase.initialX, testCase.initialY);
      expect(Array.from(result.labels)).toEqual(testCase.labels);
      close(result.inertia, testCase.inertia, 1e-9);
      closeArray(result.centersX, testCase.centersX, 1e-9, 1e-12);
      closeArray(result.centersY, testCase.centersY, 1e-9, 1e-12);
      close(silhouetteScore(testCase.x, testCase.y, testCase.labels), testCase.silhouette, 1e-9);
    });
  }

  it("finds the three planted groups and calls the structure strong or reasonable", () => {
    const blobs = context.kMeans.find((testCase) => testCase.name === "three_blobs")!;
    const summary = clusterPoints(blobs.x, blobs.y, { silhouetteSample: 280 })!;
    expect(summary.k).toBe(3);
    expect(["strong", "reasonable"]).toContain(summary.structure);
    expect(summary.sizes.reduce((sum, value) => sum + value, 0)).toBe(blobs.x.length);
  });

  it("calls a single Gaussian cloud unstructured or weak", () => {
    const cloud = context.kMeans.find((testCase) => testCase.name === "diffuse_cloud")!;
    const summary = clusterPoints(cloud.x, cloud.y)!;
    expect(["none", "weak"]).toContain(summary.structure);
  });

  it("is deterministic for the same data", () => {
    const blobs = context.kMeans[0]!;
    const first = clusterPoints(blobs.x, blobs.y)!;
    const second = clusterPoints(blobs.x, blobs.y)!;
    expect(Array.from(first.labels)).toEqual(Array.from(second.labels));
  });
});

describe("local spread of the straight line's misses", () => {
  it("rises with X when the noise does, and equals the overall spread on constant noise", () => {
    const n = 2000;
    const x = Array.from({ length: n }, (_, index) => (index / n) * 10);
    const unit = x.map((_, index) => (index % 2 === 0 ? 1 : -1));
    const growing = x.map((value, index) => (unit[index] as number) * (0.2 + value));
    const trend = localLinearTrend(x, growing, { span: 0.2, residuals: growing })!;
    const first = trend.residualSpread[5] as number;
    const last = trend.residualSpread[trend.x.length - 6] as number;
    expect(last).toBeGreaterThan(4 * first);
    const flat = localLinearTrend(x, unit, { span: 0.2, residuals: unit })!;
    for (const spread of flat.residualSpread) close(spread, 1, 1e-9);
    close(flat.overallResidualSpread, 1, 1e-12);
  });
});

describe("clusterPoints on a large window", () => {
  it("fits centres on a subsample and assigns every bar, matching a full fit's grouping", () => {
    const x: number[] = [];
    const y: number[] = [];
    for (let index = 0; index < 9000; index += 1) {
      const u = Math.sin(index * 78.233) * 43758.5453;
      const v = Math.sin(index * 12.9898) * 24634.6345;
      const group = index % 3;
      x.push([0, 5, 1][group]! + ((u - Math.floor(u)) - 0.5));
      y.push([0, 1, 5][group]! + ((v - Math.floor(v)) - 0.5));
    }
    const summary = clusterPoints(x, y)!;
    expect(summary.labels.length).toBe(9000);
    expect(summary.k).toBe(3);
    expect(summary.sizes.reduce((sum, size) => sum + size, 0)).toBe(9000);
    // Every bar sits with the others planted beside it.
    for (let index = 3; index < 9000; index += 1) expect(summary.labels[index]).toBe(summary.labels[index % 3]);
  });
});
