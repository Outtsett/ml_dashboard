/**
 * quant-oos-results: the handler on a fake lake (views missing -> empty body
 * and a note; views present -> the notebook's own conviction query and the
 * latest recipe only), and the pure arithmetic against the numbers the
 * notebook's `quant.data.distribution` printed for the landed run.
 */

import { describe, expect, it } from "vitest";
import handler, { OOS_VIEWS } from "../../studies/handlers/quant-oos-results";
import type { StudyContext, StudyLake } from "../../studies/types";
import { breakEven, distribution, headlineCounts } from "@shared/studies/quant-oos-results";
import type { OosFoldRow } from "@shared/studies/quant-oos-results";

const R_SQUARED = [-0.0019254458035216082, -0.0017716136273768779, -0.00038389936613292264, -0.0022527124907463225, -0.00029058153440475465, -0.0007944860167128365];
const ACCURACY = [0.49872319585825725, 0.5110825592743152, 0.5124179453944893, 0.5058089738630712, 0.5047854276011114, 0.5066911825697459];
const INFORMATION = [-0.0037975612924183383, 0.015588895385673969, 0.018489724309281586, 0.008999189329066206, 0.009407797571098917, 0.007005860915802296];

function fakeLake(present: boolean): { lake: StudyLake; sql: string[] } {
  const sql: string[] = [];
  const lake: StudyLake = {
    async query<T>(statement: string): Promise<T[]> {
      sql.push(statement);
      if (statement.includes("GROUP BY traded_fraction")) return [{ traded_fraction: 1, trade_count: 10, directional_accuracy: 0.5, gross_mean_return_per_trade: 1e-6, net_mean_return_per_trade: -7e-5 }] as T[];
      if (statement.includes(OOS_VIEWS.folds)) return [{ fold_index: 0, recipe: "walk_forward_2026_09_16", test_window_count: 149816 }] as T[];
      if (statement.includes(OOS_VIEWS.summary)) return [{ fold_count: 6 }] as T[];
      return [] as T[];
    },
    async hasView() {
      return present;
    },
    async columns() {
      return [];
    },
  };
  return { lake, sql };
}

function contextOf(lake: StudyLake): StudyContext {
  return { lake, notes: [] };
}

function fold(index: number): OosFoldRow {
  return { fold_index: index, test_window_count: 100 + index, out_of_sample_r_squared: R_SQUARED[index], directional_accuracy: ACCURACY[index] } as OosFoldRow;
}

describe("quant-oos-results handler", () => {
  it("reads the four landed tables", () => {
    expect(handler.datasets).toEqual([
      "derived_study_quant_oos_results_folds",
      "derived_study_quant_oos_results_conviction",
      "derived_study_quant_oos_results_summary",
      "derived_study_quant_oos_results_fold_targets",
    ]);
  });

  it("returns an empty body and a note when the dataset is not landed", async () => {
    const { lake, sql } = fakeLake(false);
    const context = contextOf(lake);
    const body = await handler.run({}, context);
    expect(body.folds).toEqual([]);
    expect(body.summary).toBeNull();
    expect(body.recipe).toBeNull();
    expect(body.pointValueUsd).toBeGreaterThan(0);
    expect(sql).toEqual([]);
    expect(context.notes[0]).toContain("derived_study_quant_oos_results_folds");
  });

  it("aggregates conviction by the notebook's query and keeps only the latest recipe", async () => {
    const { lake, sql } = fakeLake(true);
    const body = await handler.run({}, contextOf(lake));
    expect(body.recipe).toBe("walk_forward_2026_09_16");
    expect(body.folds[0]).not.toHaveProperty("recipe");
    expect(body.conviction).toHaveLength(1);
    const aggregate = sql.find((statement) => statement.includes("GROUP BY traded_fraction")) as string;
    expect(aggregate).toContain("sum(trade_count)");
    expect(aggregate).toContain("avg(directional_accuracy)");
    expect(aggregate).toContain("ORDER BY traded_fraction DESC");
    for (const statement of sql) expect(statement).toContain("SELECT max(recipe)");
  });
});

describe("fold-level distribution (the notebook's eight numbers)", () => {
  it("reproduces quant.data.distribution on the out-of-sample R-squared of the six folds", () => {
    const summary = distribution(R_SQUARED);
    expect(summary.count).toBe(6);
    expect(summary.mean).toBeCloseTo(-0.00123646, 8);
    expect(summary.median).toBeCloseTo(-0.00128305, 8);
    expect(summary.standard_deviation).toBeCloseTo(0.00084979, 8);
    expect(summary.skewness).toBeCloseTo(0.00607663, 8);
    expect(summary.kurtosis).toBeCloseTo(-2.12402682, 7);
    expect(summary.percentile_25).toBeCloseTo(-0.00188699, 8);
    expect(summary.percentile_75).toBeCloseTo(-0.00048655, 8);
    expect(summary.minimum).toBeCloseTo(-0.00225271, 8);
    expect(summary.maximum).toBeCloseTo(-0.00029058, 8);
  });

  it("reproduces it on directional accuracy and the information coefficient", () => {
    const accuracy = distribution(ACCURACY);
    expect(accuracy.mean).toBeCloseTo(0.50658488, 8);
    expect(accuracy.standard_deviation).toBeCloseTo(0.00489717, 8);
    expect(accuracy.skewness).toBeCloseTo(-0.28770994, 7);
    expect(accuracy.kurtosis).toBeCloseTo(-1.43584194, 7);
    const information = distribution(INFORMATION);
    expect(information.median).toBeCloseTo(0.00920349, 8);
    expect(information.skewness).toBeCloseTo(-0.43486395, 7);
    expect(information.kurtosis).toBeCloseTo(-1.24837034, 7);
  });

  it("reports NaN, never omits the row, when n is too small for a moment", () => {
    const two = distribution([1, 2]);
    expect(two.skewness).toBeNaN();
    expect(two.kurtosis).toBeNaN();
    expect(distribution([1, 2, 4]).kurtosis).toBeNaN();
    expect(distribution([]).count).toBeNaN();
  });

  it("drops non-finite values before anything is computed", () => {
    expect(distribution([1, Number.NaN, 3, Number.POSITIVE_INFINITY]).count).toBe(2);
  });
});

describe("headline counts and break-even", () => {
  it("counts folds with positive R-squared and accuracy above one half, and sums windows", () => {
    const counts = headlineCounts(R_SQUARED.map((_, index) => fold(index)));
    expect(counts).toEqual({ foldCount: 6, positiveRSquared: 0, accuracyAboveHalf: 5, totalWindows: 615 });
  });

  it("solves q* = 1/2 + c / (2 E|y|) at the notebook's defaults", () => {
    const result = breakEven({ costPoints: 1.40055, indexLevel: 19808, meanAbsoluteTarget: 1.8344e-4, measuredAccuracy: 0.506579 });
    expect(result.costLogReturn).toBeCloseTo(7.0705e-5, 8);
    expect(result.breakEvenAccuracy).toBeCloseTo(0.5 + 7.0705e-5 / (2 * 1.8344e-4), 4);
    expect(result.shortfallPercentagePoints).toBeCloseTo((result.breakEvenAccuracy - 0.506579) * 100, 10);
    expect(result.edgeRatio).toBeCloseTo((result.breakEvenAccuracy - 0.5) / 0.006579, 8);
  });

  it("has zero expected net return exactly at the break-even cost", () => {
    const input = { costPoints: 1, indexLevel: 20000, meanAbsoluteTarget: 1.8344e-4, measuredAccuracy: 0.506579 };
    const cost = breakEven(input).breakEvenCostPoints;
    expect(breakEven({ ...input, costPoints: cost }).expectedNetPerTrade).toBeCloseTo(0, 12);
    expect(breakEven({ ...input, costPoints: cost }).breakEvenAccuracy).toBeCloseTo(0.506579, 10);
  });
});
