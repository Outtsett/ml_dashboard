/**
 * Parity of src/shared/regression against statsmodels / scipy.
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
  benjaminiHochberg,
  buildPairs,
  fitSimpleRegression,
  midranks,
  quantileBuckets,
  refitWithout,
  studentTQuantile,
  studentTUpperTail,
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
