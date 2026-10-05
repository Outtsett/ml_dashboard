// @vitest-environment jsdom
/**
 * The chart-CNN direction study: the handler on a fake lake (empty state when the tables are not landed, the
 * newest recipe only, every view read and the recipe quoted), and the arithmetic the page runs on the rows
 * (the ROC rebuilt from score bins, rank correlation, the top-minus-bottom spread, the verdict bands, the filter tiling),
 * and the page rendered against a deterministic fixture of the same shape (every section, the formula legend, the 32 filter tiles).
 */

import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Page from "@/studies/pages/chart-cnn-direction-null-result/Page";
import handler from "../../studies/handlers/chart-cnn-direction-null-result";
import type { StudyContext, StudyLake } from "../../studies/types";
import {
  VERDICT_BANDS, binsOutsideBaseRate, filterTiles, rocFromBins, spearman, topMinusBottom, verdictFor,
  type DirectionNullBody, type ScoreBinRow,
} from "@shared/studies/chart-cnn-direction-null-result";

const PREFIX = "derived_study_chart_cnn_direction_null_result_";
const VIEWS = ["model_results", "model_comparison", "score_bins", "first_layer_filters"].map((name) => `${PREFIX}${name}`);

function fakeLake(views: readonly string[], respond: (sql: string) => Array<Record<string, unknown>>): StudyLake & { seen: string[] } {
  const seen: string[] = [];
  return {
    seen,
    async query<T>(sql: string): Promise<T[]> {
      seen.push(sql);
      return respond(sql) as T[];
    },
    async hasView(name) {
      return views.includes(name);
    },
    async columns() {
      return [];
    },
  };
}

const context = (lake: StudyLake): StudyContext => ({ lake, notes: [] });

describe("chart-cnn-direction-null-result handler", () => {
  it("names the four views it reads", () => {
    expect(handler.slug).toBe("chart-cnn-direction-null-result");
    expect(handler.datasets).toEqual(VIEWS);
  });

  it("returns empty tables with a note when nothing is landed, and reads nothing", async () => {
    const lake = fakeLake([], () => []);
    const ctx = context(lake);
    const body = (await handler.run({}, ctx)) as DirectionNullBody;
    expect(body).toEqual({ recipe: "", modelResults: [], comparisons: [], scoreBins: [], filters: [] });
    expect(lake.seen).toEqual([]);
    expect(ctx.notes[0]).toContain(`${PREFIX}model_results`);
  });

  it("reads every table for the newest recipe, with the recipe quoted", async () => {
    const lake = fakeLake(VIEWS, (sql) => {
      if (sql.includes("SELECT DISTINCT recipe")) return [{ recipe: "seed0_last_40_percent" }];
      if (sql.includes("model_results")) return [{ dataset_tag: "mnq5m", model_name: "2D image", area_under_curve: 0.505 }];
      if (sql.includes("first_layer_filters")) return [{ filter_number: 1, price_row: 1, time_column: 1, weight: 0.25 }];
      return [];
    });
    const ctx = context(lake);
    const body = (await handler.run({}, ctx)) as DirectionNullBody;
    expect(body.recipe).toBe("seed0_last_40_percent");
    expect(body.modelResults).toHaveLength(1);
    expect(body.filters).toHaveLength(1);
    const reads = lake.seen.filter((sql) => !sql.includes("SELECT DISTINCT recipe"));
    expect(reads).toHaveLength(4);
    for (const sql of reads) expect(sql).toContain("WHERE recipe = 'seed0_last_40_percent'");
    expect(ctx.notes).toEqual([]);
  });

  it("notes a defined but empty table", async () => {
    const lake = fakeLake(VIEWS, () => []);
    const ctx = context(lake);
    await handler.run({}, ctx);
    expect(ctx.notes.some((note) => note.includes("no rows"))).toBe(true);
  });
});

describe("rocFromBins", () => {
  it("rebuilds the AUC of two bins exactly as the pairwise count gives it", () => {
    // 10 rows per bin; the high bin holds 8 ups and 2 not-ups, the low bin 2 ups and 8 not-ups.
    // Pairs (up, not-up) of 100: 8 high ups beat the 8 low not-ups (64) and tie with the 2 high not-ups (16 pairs, half = 8); 2 low ups tie with 8 low not-ups (16 pairs, half = 8): (64 + 8 + 8) / 100 = 0.8.
    const roc = rocFromBins([
      { binNumber: 1, observationCount: 10, upRate: 0.2 },
      { binNumber: 2, observationCount: 10, upRate: 0.8 },
    ]);
    expect(roc.positiveTotal).toBe(10);
    expect(roc.negativeTotal).toBe(10);
    expect(roc.steps[0]?.binNumber).toBe(2);
    expect(roc.steps[0]?.area).toBeCloseTo(0.08, 12);
    expect(roc.steps[1]?.area).toBeCloseTo(0.72, 12);
    expect(roc.areaUnderCurve).toBeCloseTo(0.8, 12);
    expect(roc.steps[1]?.cumulativeArea).toBeCloseTo(0.8, 12);
  });

  it("gives 0.5 when every bin has the same up-rate", () => {
    const bins = Array.from({ length: 10 }, (_, index) => ({ binNumber: index + 1, observationCount: 100, upRate: 0.5 }));
    expect(rocFromBins(bins).areaUnderCurve).toBeCloseTo(0.5, 12);
  });

  it("walks from the highest-scoring bin whatever the input order", () => {
    const roc = rocFromBins([
      { binNumber: 3, observationCount: 4, upRate: 0.75 },
      { binNumber: 1, observationCount: 4, upRate: 0.25 },
      { binNumber: 2, observationCount: 4, upRate: 0.5 },
    ]);
    expect(roc.steps.map((step) => step.binNumber)).toEqual([3, 2, 1]);
    const last = roc.steps[2];
    expect(last?.truePositiveRate).toBeCloseTo(1, 12);
    expect(last?.falsePositiveRate).toBeCloseTo(1, 12);
  });

  it("returns a zero area when there are no rows", () => {
    expect(rocFromBins([]).areaUnderCurve).toBe(0);
  });
});

describe("spearman", () => {
  it("is 1 for a rising series and -1 for a falling one", () => {
    expect(spearman([1, 2, 3, 4], [0.1, 0.2, 0.3, 0.9])).toBeCloseTo(1, 12);
    expect(spearman([1, 2, 3, 4], [9, 7, 3, 1])).toBeCloseTo(-1, 12);
  });

  it("averages tied ranks and refuses a constant series", () => {
    expect(spearman([1, 2, 3, 4], [5, 5, 5, 5])).toBeNull();
    expect(spearman([1, 2], [1, 2])).toBeNull();
  });
});

function bin(partial: Partial<ScoreBinRow>): ScoreBinRow {
  return {
    dataset_tag: "t", model_name: "m", bin_count_requested: 10, bin_number: 1, observation_count: 100, mean_score: 0.5,
    score_minimum: 0.4, score_maximum: 0.6, up_rate: 0.5, up_rate_interval_low: 0.4, up_rate_interval_high: 0.6, base_up_rate: 0.5,
    mean_return_atr_multiples: 0, mean_return_standard_error_atr_multiples: 0.1, ...partial,
  };
}

describe("bin statistics", () => {
  it("takes the top bin minus the bottom bin with a 95% half-width from both standard errors", () => {
    const spread = topMinusBottom([
      bin({ bin_number: 10, mean_return_atr_multiples: 0.08, mean_return_standard_error_atr_multiples: 0.03 }),
      bin({ bin_number: 1, mean_return_atr_multiples: -0.05, mean_return_standard_error_atr_multiples: 0.04 }),
      bin({ bin_number: 5, mean_return_atr_multiples: 0.5 }),
    ]);
    expect(spread?.difference).toBeCloseTo(0.13, 12);
    expect(spread?.halfWidth).toBeCloseTo(1.959963984540054 * 0.05, 12);
    expect(topMinusBottom([bin({})])).toBeNull();
  });

  it("counts bins whose interval excludes the base rate", () => {
    expect(binsOutsideBaseRate([
      bin({ up_rate_interval_low: 0.45, up_rate_interval_high: 0.55 }),
      bin({ up_rate_interval_low: 0.51, up_rate_interval_high: 0.56 }),
      bin({ up_rate_interval_low: 0.4, up_rate_interval_high: 0.49 }),
    ])).toBe(2);
  });
});

describe("verdict bands", () => {
  it("classifies an AUC by the notebook's 0.53 and 0.58 lines", () => {
    expect(verdictFor(0.505)).toBe("null");
    expect(verdictFor(0.53)).toBe("weak");
    expect(verdictFor(0.58)).toBe("weak");
    expect(verdictFor(0.581)).toBe("real");
    expect(VERDICT_BANDS.map((band) => band.verdict)).toEqual(["null", "weak", "real"]);
  });
});

describe("filterTiles", () => {
  it("lays each filter's weights out by price row and time column and measures its length", () => {
    const rows = [
      { filter_number: 2, price_row: 1, time_column: 1, weight: -3 },
      { filter_number: 2, price_row: 2, time_column: 2, weight: 4 },
      { filter_number: 1, price_row: 1, time_column: 2, weight: 1 },
      { filter_number: 1, price_row: 2, time_column: 1, weight: 0 },
    ];
    const tiles = filterTiles(rows);
    expect(tiles.map((tile) => tile.filterNumber)).toEqual([1, 2]);
    expect(tiles[0]?.weights).toEqual([[0, 1], [0, 0]]);
    expect(tiles[1]?.weights).toEqual([[-3, 0], [0, 4]]);
    expect(tiles[1]?.norm).toBeCloseTo(5, 12);
    expect(tiles[1]?.positiveShare).toBeCloseTo(0.5, 12);
  });
});


// ---------------------------------------------------------------- the page, rendered against a fixture

function fixtureBody(): DirectionNullBody {
  const tags = ["mnq1h", "mnq1m", "mnq5m"];
  const models = ["2D image", "1D sequence"];
  const modelResults: DirectionNullBody["modelResults"] = [];
  const comparisons: DirectionNullBody["comparisons"] = [];
  const scoreBins: ScoreBinRow[] = [];
  tags.forEach((tag, tagIndex) => {
    const n = 20_000 * (tagIndex + 1);
    models.forEach((model, modelIndex) => {
      const auc = 0.5 + 0.004 * (modelIndex + tagIndex);
      modelResults.push({
        dataset_tag: tag, model_name: model, test_observation_count: n, area_under_curve: auc,
        area_under_curve_interval_low: auc - 0.01, area_under_curve_interval_high: auc + 0.01,
        long_top_20_percent_mean_return_atr_multiples: 0.05, short_bottom_20_percent_mean_return_atr_multiples: -0.01,
        naive_long_mean_return_atr_multiples: 0.02, base_up_rate: 0.51, return_standard_deviation_atr_multiples: 1.9,
      });
      for (const binCount of [5, 10, 20]) {
        for (let number = 1; number <= binCount; number += 1) {
          const rate = 0.5 + 0.01 * Math.sin(number + modelIndex);
          scoreBins.push({
            dataset_tag: tag, model_name: model, bin_count_requested: binCount, bin_number: number, observation_count: Math.floor(n / binCount),
            mean_score: 0.5, score_minimum: 0.4, score_maximum: 0.6, up_rate: rate, up_rate_interval_low: rate - 0.01, up_rate_interval_high: rate + 0.01,
            base_up_rate: 0.51, mean_return_atr_multiples: 0.05 * Math.cos(number), mean_return_standard_error_atr_multiples: 0.02,
          });
        }
      }
    });
    comparisons.push({
      dataset_tag: tag, test_observation_count: n, image_area_under_curve: 0.5, sequence_area_under_curve: 0.504,
      area_under_curve_difference_image_minus_sequence: -0.004, difference_interval_low: -0.01, difference_interval_high: 0.002, difference_z_statistic: -1.2,
    });
  });
  const filters: DirectionNullBody["filters"] = [];
  for (let filter = 1; filter <= 32; filter += 1) {
    for (let row = 1; row <= 5; row += 1) {
      for (let column = 1; column <= 3; column += 1) filters.push({ filter_number: filter, price_row: row, time_column: column, weight: Math.sin(filter * row - column) / 4 });
    }
  }
  return { recipe: "seed0_last_40_percent", modelResults, comparisons, scoreBins, filters };
}

describe("chart-cnn-direction-null-result page", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders every section from a landed body, with the formula legend and all 32 filter tiles", async () => {
    class Observer {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal("ResizeObserver", Observer);
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ slug: "chart-cnn-direction-null-result", notes: [], data: fixtureBody() }), { status: 200 }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(createElement(QueryClientProvider, { client }, createElement(Page)));
    await waitFor(() => expect(screen.getByText(/A\. Out-of-sample AUC/)).toBeTruthy(), { timeout: 10000 });
    for (const heading of [/B\. Predicted score/, /C\. Trading the extremes/, /D\. Where an AUC/, /E\. What the 2D model looks for/, /F\. Every column/, /G\. How to read an AUC/]) {
      expect(screen.getByText(heading)).toBeTruthy();
    }
    expect(container.querySelectorAll(".katex").length).toBeGreaterThan(5);
    expect(container.querySelectorAll("figure").length).toBe(32);
    expect(container.textContent).toContain("seed0_last_40_percent");
    expect(container.textContent).toContain("0 of 6");
  });

  it("shows the not-landed explanation when the tables are empty", async () => {
    class Observer {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal("ResizeObserver", Observer);
    const empty: DirectionNullBody = { recipe: "", modelResults: [], comparisons: [], scoreBins: [], filters: [] };
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ slug: "chart-cnn-direction-null-result", notes: ["Not in the lake yet: x"], data: empty }), { status: 200 }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(createElement(QueryClientProvider, { client }, createElement(Page)));
    await waitFor(() => expect(screen.getByText(/are not in the lake yet/)).toBeTruthy(), { timeout: 10000 });
    expect(screen.getByText(/Not in the lake yet: x/)).toBeTruthy();
  });
});
