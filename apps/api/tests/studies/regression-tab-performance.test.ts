// @vitest-environment jsdom
/**
 * The regression-tab-performance study: its handler on a fake lake (the SQL it
 * writes, the fallbacks, the not-landed empty body) and the pure compute it
 * shares with the page (pivots, budget rules, the stepped total variation).
 */

import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Page from "@/studies/pages/regression-tab-performance/Page";
import handler from "../../studies/handlers/regression-tab-performance";
import { eightNumberSummary } from "@shared/lens/stats";
import type { StudyLake } from "../../studies/types";
import {
  EMPTY_BODY,
  FAITHFUL_SHAPE_ERROR,
  canvasMilliseconds,
  coverageRisesEveryStep,
  isPublishedFigure,
  nearestLevel,
  pivotByBudget,
  pivotCanvas,
  seriesDropOutBudgets,
  smallestFaithfulBudget,
  totalVariationSteps,
  type BudgetSummary,
  type CanvasDrawRow,
  type RegressionTabPerformanceBody,
  type RenderSeriesRow,
} from "@shared/studies/regression-tab-performance";

function makeLake(options: { served?: boolean; geometries?: string[]; modes?: string[] } = {}) {
  const executed: string[] = [];
  const lake: StudyLake = {
    async query<T>(sql: string): Promise<T[]> {
      executed.push(sql);
      if (sql.includes("SELECT DISTINCT geometry")) return (options.geometries ?? ["detail@panel700", "thumbnail@panel700"]).map((geometry) => ({ geometry })) as T[];
      if (sql.includes("SELECT DISTINCT mode")) return (options.modes ?? ["difference", "level"]).map((mode) => ({ mode })) as T[];
      if (sql.includes("SELECT DISTINCT requested_budget")) return [{ requested_budget: 250 }, { requested_budget: 5000 }] as T[];
      if (sql.includes("AS series_label")) return [{ series_label: "MNQ_1m · level · close", requested_budget: 250, histogram_total_variation: 0.2 }] as T[];
      if (sql.includes("quantile_cont")) return [{ requested_budget: 250, median_coverage_fraction: 0.02, median_shape_error: 0.16, ninetieth_percentile_shape_error: 0.33, share_of_variables_faithful: 0.02, median_points_drawn: 249, series_count: 45 }] as T[];
      if (sql.includes("median(microseconds_per_point)")) return [{ median: 0.81, minimum: 0.52, maximum: 1.35 }] as T[];
      if (sql.includes("FROM \"derived_regression_tab_performance_cache_option_reference\"")) return [{ option: "in-process LRU hit (measured)", payload_megabytes: 0.88, milliseconds: 11.7, source: "this machine" }] as T[];
      return [];
    },
    async hasView(name) {
      return options.served !== false && name.startsWith("derived_regression_tab_performance_");
    },
    async columns() {
      return [];
    },
  };
  return { lake, executed };
}

describe("regression-tab-performance handler", () => {
  it("reads all five frozen tables and aggregates per budget in SQL with the notebook's rules", async () => {
    const { lake, executed } = makeLake();
    const notes: string[] = [];
    const body = await handler.run(handler.query.parse({}), { lake, notes });
    expect(notes).toEqual([]);
    expect(body.geometry).toBe("thumbnail@panel700");
    expect(body.mode).toBe("all");
    expect(body.budgets).toEqual([250, 5000]);
    expect(body.byBudget[0]?.median_shape_error).toBe(0.16);
    expect(body.steadyMicrosecondsPerPoint).toBe(0.81);
    expect(body.steadyRange).toEqual({ minimum: 0.52, maximum: 1.35 });
    const aggregate = executed.find((sql) => sql.includes("quantile_cont")) ?? "";
    expect(aggregate).toContain("quantile_cont(histogram_total_variation, 0.9)");
    expect(aggregate).toContain(`histogram_total_variation < ${FAITHFUL_SHAPE_ERROR}`);
    expect(aggregate).toContain("geometry = 'thumbnail@panel700'");
    expect(aggregate).not.toContain("AND mode");
    const steady = executed.find((sql) => sql.includes("median(microseconds_per_point)")) ?? "";
    expect(steady).toContain("surface = 'thumbnail' AND run_index > 1");
    const rules = executed.find((sql) => sql.includes("measurement_set IN")) ?? "";
    expect(rules).toContain("timeframe = '1d'");
    expect(rules).toContain("'regression_columns_all'");
  });

  it("narrows to one Y axis when asked", async () => {
    const { lake, executed } = makeLake();
    const body = await handler.run(handler.query.parse({ geometry: "detail@panel700", mode: "level" }), { lake, notes: [] });
    expect(body.geometry).toBe("detail@panel700");
    expect(body.mode).toBe("level");
    expect(executed.find((sql) => sql.includes("quantile_cont"))).toContain("AND mode = 'level'");
  });

  it("falls back, with a note, when the panel or Y axis was never measured", async () => {
    const { lake } = makeLake();
    const notes: string[] = [];
    const body = await handler.run(handler.query.parse({ geometry: "thumbnail@panel9999", mode: "sideways" }), { lake, notes });
    expect(body.geometry).toBe("thumbnail@panel700");
    expect(body.mode).toBe("all");
    expect(notes.join(" ")).toContain("thumbnail@panel9999");
    expect(notes.join(" ")).toContain("sideways");
  });

  it("refuses a query that could carry SQL", () => {
    expect(() => handler.query.parse({ geometry: "x'; DROP TABLE y; --" })).toThrow();
    expect(() => handler.query.parse({ mode: "level'--" })).toThrow();
  });

  it("returns the empty body and a note when the tables are not landed", async () => {
    const { lake, executed } = makeLake({ served: false });
    const notes: string[] = [];
    const body = await handler.run(handler.query.parse({}), { lake, notes });
    expect(body).toEqual(EMPTY_BODY);
    expect(executed).toEqual([]);
    expect(notes[0]).toContain("derived_regression_tab_performance_render_threshold");
  });
});

function renderRow(overrides: Partial<RenderSeriesRow>): RenderSeriesRow {
  return {
    series_label: "MNQ_1m · level · close",
    bar_series: "MNQ_1m",
    timeframe: "1m",
    mode: "level",
    variable: "close",
    geometry: "thumbnail@panel700",
    plot_width_pixels: 276,
    plot_height_pixels: 126,
    radius_pixels: 1.4,
    series_points: 20000,
    requested_budget: 250,
    points_drawn: 250,
    covered_pixels: 100,
    coverage_fraction: 0.02,
    marginal_new_pixels_per_added_point: null,
    histogram_total_variation: 0.2,
    ...overrides,
  };
}

function summary(requested_budget: number, shape: number, coverage: number, seriesCount = 45): BudgetSummary {
  return { requested_budget, median_coverage_fraction: coverage, median_shape_error: shape, ninetieth_percentile_shape_error: null, share_of_variables_faithful: null, median_points_drawn: requested_budget, series_count: seriesCount };
}

describe("shared compute", () => {
  it("pivots series by budget, leaving a budget a series was not measured at null", () => {
    const pivot = pivotByBudget(
      [
        renderRow({ requested_budget: 250, coverage_fraction: 0.02 }),
        renderRow({ requested_budget: 500, coverage_fraction: 0.03 }),
        renderRow({ series_label: "MNQ_1d · level · close", bar_series: "MNQ_1d", requested_budget: 250, coverage_fraction: 0.05 }),
      ],
      "coverage_fraction",
    );
    expect(pivot.series.map((item) => item.label)).toEqual(["MNQ_1m · level · close", "MNQ_1d · level · close"]);
    expect(pivot.data).toEqual([
      { requested_budget: 250, series_0: 0.02, series_1: 0.05 },
      { requested_budget: 500, series_0: 0.03, series_1: null },
    ]);
  });

  it("pivots canvas runs by points drawn", () => {
    const row = (run_index: number, points_drawn: number, ms: number): CanvasDrawRow => ({ run_index, surface: "thumbnail", plot_width_pixels: 276, plot_height_pixels: 126, radius_pixels: 1.4, points_drawn, median_draw_milliseconds: ms, microseconds_per_point: 1, note: "" });
    const pivot = pivotCanvas([row(2, 700, 0.9), row(2, 1000, 0.9), row(3, 700, 0.9)]);
    expect(pivot.keys.map((key) => key.key)).toEqual(["thumbnail · run 2", "thumbnail · run 3"]);
    expect(pivot.data[1]).toEqual({ points_drawn: 1000, "thumbnail · run 2": 0.9, "thumbnail · run 3": null });
  });

  it("finds the smallest faithful budget and the coverage and series-count facts", () => {
    const rows = [summary(250, 0.16, 0.021), summary(2000, 0.0616, 0.0615), summary(3000, 0.0356, 0.0508, 30), summary(5000, 0.0257, 0.0676, 30)];
    expect(smallestFaithfulBudget(rows)).toBe(3000);
    expect(smallestFaithfulBudget([summary(250, 0.16, 0.02)])).toBeNull();
    expect(coverageRisesEveryStep(rows)).toBe(false);
    expect(seriesDropOutBudgets(rows)).toEqual([3000]);
    expect(coverageRisesEveryStep([summary(250, 0.1, 0.02), summary(500, 0.1, 0.03)])).toBe(true);
  });

  it("snaps a stale budget to a measured level", () => {
    expect(nearestLevel([250, 500, 700, 5000], 5200)).toBe(5000);
    expect(nearestLevel([], 5000)).toBeNull();
  });

  it("prices the canvas per point and per frame", () => {
    const cost = canvasMilliseconds(0.81, 5000, 8);
    expect(cost.panel).toBeCloseTo(4.05, 6);
    expect(cost.frame).toBeCloseTo(32.4, 6);
  });

  it("steps the total variation term by term: half the sum of absolute share differences", () => {
    const steps = totalVariationSteps([1, 1, 2], [2, 1, 1]);
    // p = [.25, .25, .5], q = [.5, .25, .25]: terms .25, 0, .25
    expect(steps.map((step) => step.term)).toEqual([0.25, 0, 0.25]);
    expect(steps[2]?.runningSum).toBeCloseTo(0.5, 12);
    expect(steps[2]?.runningTotalVariation).toBeCloseTo(0.25, 12);
    const identical = totalVariationSteps([3, 4, 5], [3, 4, 5]);
    expect(identical[2]?.runningTotalVariation).toBe(0);
    const disjoint = totalVariationSteps([1, 0], [0, 1]);
    expect(disjoint[1]?.runningTotalVariation).toBe(1);
  });

  it("marks the published Redis rows and reproduces the notebook's eight numbers (polars, bias=False)", () => {
    expect(isPublishedFigure("Redis GET on localhost, value only (published)")).toBe(true);
    expect(isPublishedFigure("in-process LRU hit, full HTTP response (measured)")).toBe(false);
    const summaryOfFive = eightNumberSummary([0.02, 0.03, 0.05, 0.08, 0.4]);
    expect(summaryOfFive.mean).toBeCloseTo(0.116, 12);
    expect(summaryOfFive.median).toBeCloseTo(0.05, 12);
    expect(summaryOfFive.standardDeviation).toBeCloseTo(0.16040573555830231, 12);
    expect(summaryOfFive.skewness).toBeCloseTo(2.1252461454349056, 9);
    expect(summaryOfFive.kurtosis).toBeCloseTo(4.585628599424588, 9);
    expect(summaryOfFive.percentile25).toBeCloseTo(0.03, 12);
    expect(summaryOfFive.percentile75).toBeCloseTo(0.08, 12);
  });
});

function makeBody(): RegressionTabPerformanceBody {
  const budgets = [250, 700, 1000, 5000, 10000];
  const renderRows: RenderSeriesRow[] = [];
  for (const [barSeries, limit] of [["MNQ_1m", 20000], ["MNQ_1d", 2000]] as const) {
    for (const mode of ["level", "difference"]) {
      for (const budget of budgets) {
        if (budget > limit) continue;
        renderRows.push(renderRow({ series_label: `${barSeries} · ${mode} · close`, bar_series: barSeries, mode, requested_budget: budget, points_drawn: budget, coverage_fraction: 0.02 + budget / 150000, histogram_total_variation: 0.4 / (budget / 250) }));
      }
    }
  }
  const byBudget = budgets.map((budget) => summary(budget, 0.4 / (budget / 250), 0.02 + budget / 150000, budget > 2000 ? 2 : 4));
  const canvas = (run_index: number, surface: string, points_drawn: number, ms: number): CanvasDrawRow => ({ run_index, surface, plot_width_pixels: 276, plot_height_pixels: 126, radius_pixels: 1.4, points_drawn, median_draw_milliseconds: ms, microseconds_per_point: (ms * 1000) / points_drawn, note: run_index === 1 ? "first run, page busy" : "steady" });
  return {
    ...EMPTY_BODY,
    geometries: ["thumbnail@panel700"],
    modes: ["level", "difference"],
    budgets,
    renderRows,
    byBudget,
    canvasDraw: [canvas(1, "thumbnail", 700, 1.4), canvas(2, "thumbnail", 700, 0.9), canvas(2, "thumbnail", 5000, 2.9), canvas(3, "detail", 5000, 6.2)],
    steadyMicrosecondsPerPoint: 0.81,
    steadyRange: { minimum: 0.52, maximum: 1.35 },
    latencyRows: [{ layer: "regression_columns_object", endpoint: "/api/charts/regression/columns", symbol: "MNQ", timeframe: "1d", bars_requested: 2074, object: "candle_anatomy", cache_state: "cold", run_index: 1, time_to_first_byte_milliseconds: 1958, total_milliseconds: 1960, payload_bytes: 900000, measurement_set: "original_rule_reads_one_second_table" }],
    latencyGroups: [{ layer: "regression_columns_object", measurement_set: "original_rule_reads_one_second_table", object: "candle_anatomy", cache_state: "cold", timeframe: "1d", measurement_count: 3, median_total_milliseconds: 1958.63, median_time_to_first_byte_milliseconds: 1950 }],
    latencyByObject: [{ object: "candle_anatomy", cache_state: "cold", median_milliseconds: 1958.63 }, { object: "candle_anatomy_1m", cache_state: "cold", median_milliseconds: 162.497 }],
    latencyByRule: [{ measurement_set: "regression_columns_all_current_rule", cache_state: "cold", median_milliseconds: 2468.1 }, { measurement_set: "regression_columns_all_current_rule", cache_state: "warm", median_milliseconds: 11.7 }],
    clientFit: [{ where: "main_thread_benchmark", bars: 20000, variables: 49, milliseconds: 851.9, note: "tsx" }, { where: "web_worker_live", bars: 2074, variables: 44, milliseconds: 62, note: "live" }],
    cacheOptions: [{ option: "in-process LRU hit, full HTTP response (measured)", payload_megabytes: 0.88, milliseconds: 11.7, source: "this machine" }, { option: "Redis GET on localhost, value only (published)", payload_megabytes: 1, milliseconds: 1.2, source: "redis-benchmark" }],
  };
}

describe("regression-tab-performance page", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders the stat strip, findings, formula legend and every section from the body", async () => {
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ slug: "regression-tab-performance", notes: [], data: makeBody() })));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(createElement(QueryClientProvider, { client }, createElement(Page)));
    expect(await screen.findByText("Median shape error")).toBeTruthy();
    expect(screen.getByText(/1. How many points to draw/)).toBeTruthy();
    expect(screen.getByText(/Step through the sum on a toy grid/)).toBeTruthy();
    expect(screen.getByText(/2. Where the time goes/)).toBeTruthy();
    expect(screen.getByText(/4. Every column of every measurement table/)).toBeTruthy();
    expect(screen.getByText(/The cloud reads true/)).toBeTruthy();
    expect(screen.getAllByText(/A budget of 5,000 points per panel/).length).toBeGreaterThan(0);
  });

  it("explains an unlanded dataset instead of drawing empty charts", async () => {
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ slug: "regression-tab-performance", notes: ["Not in the lake yet: derived_x"], data: EMPTY_BODY })));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(createElement(QueryClientProvider, { client }, createElement(Page)));
    expect(await screen.findByText(/are not served yet/)).toBeTruthy();
    expect(screen.getByText(/Not in the lake yet/)).toBeTruthy();
  });
});
