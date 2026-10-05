// @vitest-environment jsdom
/**
 * The EURUSD bars and labels study (apps/api/studies/handlers/eurusd-bars-and-labels.ts)
 * on a fake lake: the three sections of its endpoint, the SQL it writes, and
 * the pure arithmetic it shares with the page
 * (packages/shared/src/studies/eurusd-bars-and-labels.ts).
 */

import "../../../web/tests/setup";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Page from "@/studies/pages/eurusd-bars-and-labels/Page";
import handler, { barsSql, returnHistogramSql, returnStatisticsSql, windowSql } from "../../studies/handlers/eurusd-bars-and-labels";
import type { StudyContext, StudyLake } from "../../studies/types";
import {
  MARKER_OFFSET_ABOVE,
  developmentStop,
  logReturnBasisPoints,
  windowCounts,
  windowStartIndex,
  type LabelsBody,
  type ReturnsBody,
  type WindowBody,
} from "@shared/studies/eurusd-bars-and-labels";

const ALL_VIEWS = [
  "bars",
  "derived_study_eurusd_bars_and_labels_forward_direction_bars",
  "derived_study_eurusd_bars_and_labels_label_catalog",
  "derived_study_eurusd_bars_and_labels_label_class_balance",
  "derived_study_eurusd_bars_and_labels_label_distributions",
  "derived_study_eurusd_bars_and_labels_label_histograms",
  "derived_study_eurusd_bars_and_labels_label_horizon_grid",
  "derived_study_eurusd_bars_and_labels_label_run_information",
];

function fakeLake(views: readonly string[], answer: (sql: string) => Record<string, unknown>[], executed: string[] = []): StudyLake {
  return {
    async query<T>(sql: string): Promise<T[]> {
      executed.push(sql);
      return answer(sql) as T[];
    },
    async hasView(name) {
      return views.includes(name);
    },
    async columns() {
      return [];
    },
  };
}

function context(lake: StudyLake): StudyContext {
  return { lake, notes: [] };
}

const parse = (raw: Record<string, string | number> = {}) => handler.query.parse(raw);

const WINDOW_ROWS = [
  { timestamp: 1_000, open: 1.1, high: 1.11, low: 1.09, close: 1.1, volume: 10n, bar_index: 7n, bar_count: 10n, first_timestamp: 0, last_timestamp: 9_000, forward_direction: 1 },
  { timestamp: 2_000, open: 1.1, high: 1.12, low: 1.1, close: 1.11, volume: 12n, bar_index: 8n, bar_count: 10n, first_timestamp: 0, last_timestamp: 9_000, forward_direction: 0 },
  { timestamp: 3_000, open: 1.11, high: 1.12, low: 1.08, close: 1.09, volume: 9n, bar_index: 9n, bar_count: 10n, first_timestamp: 0, last_timestamp: 9_000, forward_direction: -1 },
  { timestamp: 4_000, open: 1.09, high: 1.1, low: 1.08, close: 1.09, volume: 9n, bar_index: 10n, bar_count: 10n, first_timestamp: 0, last_timestamp: 9_000, forward_direction: null },
].map((row) => ({ ...row, volume: Number(row.volume), bar_index: Number(row.bar_index), bar_count: Number(row.bar_count) }));

describe("shared arithmetic", () => {
  it("cuts development at int(n * 0.8), as forexmodel split.dev_oos_split", () => {
    expect(developmentStop(2_447_021)).toBe(1_957_616);
    expect(developmentStop(41_404)).toBe(33_123);
    expect(developmentStop(10)).toBe(8);
  });

  it("places the window: the latest by default, otherwise clamped to the last full window", () => {
    expect(windowStartIndex(1000, 120, -1)).toBe(880);
    expect(windowStartIndex(1000, 120, 100)).toBe(100);
    expect(windowStartIndex(1000, 120, 990)).toBe(880);
    expect(windowStartIndex(50, 120, -1)).toBe(0);
  });

  it("computes a log return in basis points and refuses a non-positive close", () => {
    expect(logReturnBasisPoints(1.1, 1.1)).toBe(0);
    expect(logReturnBasisPoints(1.0, Math.E)).toBeCloseTo(10_000, 6);
    expect(logReturnBasisPoints(1.1, 1.0)).toBeCloseTo(-(Math.log(1.1)) * 10_000, 9);
    expect(logReturnBasisPoints(0, 1)).toBeNull();
    expect(logReturnBasisPoints(1, -1)).toBeNull();
  });

  it("counts up, ranging, down and unlabelled bars, null being unlabelled and never ranging", () => {
    const counts = windowCounts([{ forwardDirection: 1 }, { forwardDirection: 0 }, { forwardDirection: 0 }, { forwardDirection: -1 }, { forwardDirection: null }]);
    expect(counts).toEqual({ up: 1, ranging: 2, down: 1, unlabelled: 1 });
    expect(MARKER_OFFSET_ABOVE).toBe(1.0004);
  });
});

describe("the SQL", () => {
  it("reads the 1-minute bars as stored and buckets coarser timeframes with arg_min / arg_max, never first() / last()", () => {
    const minute = barsSql("1m");
    expect(minute).not.toContain("time_bucket");
    expect(minute).toContain("timeframe = '1m'");
    expect(minute).toContain("root = 'EURUSD'");
    const hour = barsSql("1h");
    expect(hour).toContain("time_bucket(INTERVAL '1 hour'");
    expect(hour).toContain("arg_min(open, bar_time)");
    expect(hour).toContain("arg_max(close, bar_time)");
    expect(hour).not.toMatch(/\bfirst\(|\blast\(/);
    expect(barsSql("4h")).toContain("INTERVAL '4 hours'");
    expect(barsSql("1d")).toContain("INTERVAL '1 day'");
  });

  it("selects the window by bar index with the notebook's clamp, and joins labels only when they are landed", () => {
    const joined = windowSql(parse({ timeframe: "1h", barsShown: 120, start: -1, horizon: 24 }), 24);
    expect(joined).toContain("d.horizon_bars = 24");
    expect(joined).toContain("d.timeframe = '1h'");
    expect(joined).toContain("bar_count - 120");
    const unjoined = windowSql(parse({ timeframe: "1h" }), null);
    expect(unjoined).not.toContain("forward_direction_bars");
    expect(unjoined).toContain("CAST(NULL AS TINYINT) AS forward_direction");
  });

  it("splits returns at int(n * 0.8) by the return's own index and computes the notebook's moments", () => {
    const statistics = returnStatisticsSql("1h");
    expect(statistics).toContain("bar_index - 1 < CAST(floor(bar_count * 0.8) AS BIGINT)");
    expect(statistics).toContain("stddev_samp");
    expect(statistics).toContain("quantile_cont(basis_points, [0.01, 0.05, 0.25, 0.5, 0.75, 0.95, 0.99])");
    expect(statistics).toContain("power((u.basis_points - m.mean_value) / m.standard_deviation, 3)");
    const histogram = returnHistogramSql("1h");
    expect(histogram).toContain("quantile_cont(basis_points, 0.005)");
    expect(histogram).toContain("quantile_cont(basis_points, 0.995)");
  });

  it("parses only known sections, timeframes and window sizes", () => {
    expect(handler.query.safeParse({ section: "drop table" }).success).toBe(false);
    expect(handler.query.safeParse({ timeframe: "2h" }).success).toBe(false);
    expect(handler.query.safeParse({ barsShown: 10 }).success).toBe(false);
    expect(handler.query.safeParse({ barsShown: 500 }).success).toBe(false);
    expect(handler.query.safeParse({ start: "1; DROP" }).success).toBe(false);
    expect(parse({})).toEqual({ section: "window", timeframe: "1h", barsShown: 120, start: -1, horizon: 0 });
  });
});

describe("the window section", () => {
  const answer = (sql: string) => {
    if (sql.includes("label_run_information")) return [{ label_horizons_bars: "6,12,24,48" }];
    return WINDOW_ROWS;
  };

  it("returns the bars with log returns, labels and the smallest landed horizon when none is asked for", async () => {
    const executed: string[] = [];
    const ctx = context(fakeLake(ALL_VIEWS, answer, executed));
    const body = (await handler.run(parse({ timeframe: "1h", barsShown: 20 }), ctx)) as WindowBody;
    expect(body.horizons).toEqual([6, 12, 24, 48]);
    expect(body.horizon).toBe(6);
    expect(body.labelsLanded).toBe(true);
    expect(body.barCount).toBe(10);
    expect(body.developmentBarCount).toBe(8);
    expect(body.sealedBarCount).toBe(2);
    expect(body.windowStartIndex).toBe(7);
    expect(body.bars).toHaveLength(4);
    expect(body.bars[0]?.logReturnBasisPoints).toBeNull();
    expect(body.bars[1]?.logReturnBasisPoints).toBeCloseTo((Math.log(1.11) - Math.log(1.1)) * 10_000, 9);
    expect(body.bars.map((bar) => bar.forwardDirection)).toEqual([1, 0, -1, null]);
    expect(windowCounts(body.bars)).toEqual({ up: 1, ranging: 1, down: 1, unlabelled: 1 });
    expect(executed.some((sql) => sql.includes("d.horizon_bars = 6"))).toBe(true);
  });

  it("uses the horizon asked for when it is landed, and falls back when it is not", async () => {
    const executed: string[] = [];
    const ctx = context(fakeLake(ALL_VIEWS, answer, executed));
    expect(((await handler.run(parse({ horizon: 24 }), ctx)) as WindowBody).horizon).toBe(24);
    expect(((await handler.run(parse({ horizon: 999 }), ctx)) as WindowBody).horizon).toBe(6);
  });

  it("still draws the candles when the labels are not landed, and says so", async () => {
    const ctx = context(fakeLake(["bars"], () => WINDOW_ROWS.map((row) => ({ ...row, forward_direction: null }))));
    const body = (await handler.run(parse({}), ctx)) as WindowBody;
    expect(body.labelsLanded).toBe(false);
    expect(body.horizon).toBeNull();
    expect(body.bars).toHaveLength(4);
    expect(body.bars.every((bar) => bar.forwardDirection === null)).toBe(true);
    expect(ctx.notes.join(" ")).toContain("Not in the lake yet");
  });

  it("reports a timeframe no horizon labels (1d) as bars without labels", async () => {
    const ctx = context(fakeLake(ALL_VIEWS, (sql) => (sql.includes("label_run_information") ? [{ label_horizons_bars: "" }] : WINDOW_ROWS)));
    const body = (await handler.run(parse({ timeframe: "1d" }), ctx)) as WindowBody;
    expect(body.labelsLanded).toBe(false);
    expect(body.horizons).toEqual([]);
    expect(ctx.notes.join(" ")).toContain("No trend labels are landed at 1d");
  });

  it("answers an empty body, not an error, when the lake has no bars", async () => {
    const empty = context(fakeLake(ALL_VIEWS, () => []));
    expect(((await handler.run(parse({}), empty)) as WindowBody).bars).toEqual([]);
    expect(empty.notes.join(" ")).toContain("no EURUSD 1-minute bars");
    const missing = context(fakeLake([], () => []));
    expect(((await handler.run(parse({}), missing)) as WindowBody).barCount).toBe(0);
    expect(missing.notes.join(" ")).toContain("bars view is not defined");
  });
});

describe("the returns section", () => {
  const statisticRows = [
    { group_name: "development", bar_count: 11, observation_count: 8, mean_value: 0.01, standard_deviation: 10, minimum_value: -100, maximum_value: 120, percentile_1: -30, percentile_5: -15, percentile_25: -4, median_value: 0, percentile_75: 4, percentile_95: 15, percentile_99: 30, skewness: -0.03, excess_kurtosis: 14.5, dropped_count: 0 },
    { group_name: "sealed", bar_count: 11, observation_count: 2, mean_value: 0.03, standard_deviation: 8, minimum_value: -50, maximum_value: 60, percentile_1: -20, percentile_5: -12, percentile_25: -3.7, median_value: 0, percentile_75: 3.6, percentile_95: 12, percentile_99: 24, skewness: 0.5, excess_kurtosis: 17, dropped_count: 0 },
  ];
  const binRows = [
    { bin_position: -1, group_name: "development", bin_count: 1, lower_edge: -30, upper_edge: 30 },
    { bin_position: 0, group_name: "development", bin_count: 2, lower_edge: -30, upper_edge: 30 },
    { bin_position: 30, group_name: "development", bin_count: 5, lower_edge: -30, upper_edge: 30 },
    { bin_position: 30, group_name: "sealed", bin_count: 1, lower_edge: -30, upper_edge: 30 },
    { bin_position: 60, group_name: "sealed", bin_count: 1, lower_edge: -30, upper_edge: 30 },
  ];

  it("returns both groups' numbers and shared-bin shares, with the tails counted outside the bins", async () => {
    const ctx = context(fakeLake(ALL_VIEWS, (sql) => (sql.includes("placed AS") ? binRows : statisticRows)));
    const body = (await handler.run(parse({ section: "returns", timeframe: "1h" }), ctx)) as ReturnsBody;
    expect(body.statistics.map((row) => row.group)).toEqual(["development", "sealed"]);
    expect(body.statistics[0]?.excessKurtosis).toBe(14.5);
    expect(body.statistics[1]?.standardDeviation).toBe(8);
    expect(body.barCount).toBe(11);
    expect(body.developmentBarCount).toBe(8);
    expect(body.histogram).toHaveLength(60);
    expect(body.histogramLower).toBe(-30);
    expect(body.histogramUpper).toBe(30);
    expect(body.histogram[0]?.developmentCount).toBe(2);
    expect(body.histogram[0]?.developmentShare).toBeCloseTo(2 / 8, 12);
    expect(body.histogram[30]?.sealedShare).toBeCloseTo(1 / 2, 12);
    expect(body.belowRangeCount).toEqual({ development: 1, sealed: 0 });
    expect(body.aboveRangeCount).toEqual({ development: 0, sealed: 1 });
    const totalShare = body.histogram.reduce((sum, bin) => sum + bin.developmentShare, 0) + body.belowRangeCount.development / 8 + body.aboveRangeCount.development / 8;
    expect(totalShare).toBeCloseTo(1, 12);
  });

  it("answers an empty body with a note when there are no bars", async () => {
    const ctx = context(fakeLake(ALL_VIEWS, () => []));
    const body = (await handler.run(parse({ section: "returns" }), ctx)) as ReturnsBody;
    expect(body.statistics).toEqual([]);
    expect(ctx.notes.join(" ")).toContain("no EURUSD 1-minute bars");
  });
});

describe("the labels section", () => {
  const answer = (sql: string): Record<string, unknown>[] => {
    if (sql.includes("label_run_information")) {
      return [{ bar_count: 100, first_ms: 1_000, last_ms: 9_000, development_bar_count: 80, label_column_count: 53, label_horizons_bars: "6,12", built_ms: 5_000 }];
    }
    if (sql.includes("label_catalog")) {
      return [{ label_column: "dir_h6", label_display_name: "forward direction, 6 bars ahead", label_family: "trend/label", label_role: "target", data_type: "Int8", value_set: "-1 / 0 / +1", horizon_or_window_bars: 6, row_count: 100, known_count: 95, known_share: 0.95, distinct_count: 4, meaning: "h=6: +1 up / 0 ranging / -1 down" }];
    }
    if (sql.includes("label_class_balance")) {
      return [-1, 0, 1].map((value, index) => ({ label_column: "dir_h6", label_display_name: "forward direction, 6 bars ahead", class_value: value, class_count: [4, 91, 5][index], known_count: 100, class_share: [0.04, 0.91, 0.05][index] }));
    }
    if (sql.includes("label_distributions")) {
      return [{ label_column: "fwd_t_h6", label_display_name: "forward slope t-statistic, 6 bars ahead", count: 90, mean: 0.1, median: 0.2, standard_deviation: 2, skewness: 0, excess_kurtosis: 0.3, percentile_25: -1, percentile_75: 1, minimum: -9, maximum: 9, dropped_count: 6, percentile_1: -5, percentile_5: -3, percentile_95: 3, percentile_99: 5, count_below_histogram_range: 1, count_above_histogram_range: 2 }];
    }
    if (sql.includes("label_histograms")) {
      return [1, 2].map((position) => ({ label_column: "fwd_t_h6", bin_position: position, bin_lower_edge: position - 1, bin_upper_edge: position, bin_count: 10 * position }));
    }
    if (sql.includes("label_horizon_grid")) {
      return [{ horizon_bars: 6, horizon_trading_days: 0.25, class_boundary_t_statistic_upper: 5.44, class_boundary_t_statistic_lower: 1.2, magnitude_boundary_volatility_units: 3, abstain_share: 0.2, large_move_share: 0.1, labelled_bar_share: 0.95, up_share: 0.05, ranging_share: 0.91, down_share: 0.04, trending_share: 0.09, shuffled_series_trending_share: 0.1, trending_share_excess_over_shuffle: -0.01, horizon_kept: true }];
    }
    return [];
  };

  it("maps every landed table for the timeframe, with each column's bins attached", async () => {
    const executed: string[] = [];
    const ctx = context(fakeLake(ALL_VIEWS, answer, executed));
    const body = (await handler.run(parse({ section: "labels", timeframe: "1h" }), ctx)) as LabelsBody;
    expect(body.landed).toBe(true);
    expect(body.run).toEqual({ barCount: 100, firstBarTimestamp: 1_000, lastBarTimestamp: 9_000, developmentBarCount: 80, labelColumnCount: 53, horizons: [6, 12], builtAt: 5_000 });
    expect(body.catalog[0]?.labelColumn).toBe("dir_h6");
    expect(body.classBalance.map((row) => row.classShare)).toEqual([0.04, 0.91, 0.05]);
    expect(body.distributions[0]?.bins).toEqual([{ lower: 0, upper: 1, count: 10 }, { lower: 1, upper: 2, count: 20 }]);
    expect(body.distributions[0]?.droppedCount).toBe(6);
    expect(body.grid[0]?.upperBoundaryTStatistic).toBe(5.44);
    expect(body.grid[0]?.kept).toBe(true);
    expect(executed.every((sql) => !sql.includes("timeframe = '1h'") || sql.includes("derived_study_eurusd_bars_and_labels_"))).toBe(true);
  });

  it("says the timeframe has no labels when its catalog is empty (1d)", async () => {
    const ctx = context(fakeLake(ALL_VIEWS, (sql) => (sql.includes("label_horizon_grid") ? [{ horizon_bars: 5, horizon_trading_days: 5, horizon_kept: false, labelled_bar_share: 0.16 }] : [])));
    const body = (await handler.run(parse({ section: "labels", timeframe: "1d" }), ctx)) as LabelsBody;
    expect(body.landed).toBe(false);
    expect(body.grid[0]?.kept).toBe(false);
    expect(ctx.notes.join(" ")).toContain("No trend labels are landed at 1d");
  });

  it("answers an empty body with a note when the label tables are not landed", async () => {
    const ctx = context(fakeLake(["bars"], () => []));
    const body = (await handler.run(parse({ section: "labels" }), ctx)) as LabelsBody;
    expect(body).toMatchObject({ landed: false, catalog: [], classBalance: [], distributions: [], grid: [] });
    expect(ctx.notes.join(" ")).toContain("Not in the lake yet");
  });
});

describe("the page", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  const bins = Array.from({ length: 60 }, (_, index) => ({ lower: index - 30, upper: index - 29, developmentCount: 10 + index, sealedCount: 3 + index, developmentShare: 0.01, sealedShare: 0.01 }));
  const statistics = (group: "development" | "sealed") => ({
    group, count: 100, mean: 0.01, median: 0, standardDeviation: 9, skewness: 0.1, excessKurtosis: 14, percentile25: -4, percentile75: 4,
    minimum: -100, maximum: 100, droppedCount: 0, percentile1: -30, percentile5: -14, percentile95: 14, percentile99: 29,
  });
  const windowBars = Array.from({ length: 30 }, (_, index) => {
    const close = 1.1 + Math.sin(index / 4) * 0.004;
    return {
      timestamp: Date.UTC(2026, 7, 1, index), open: close - 0.0005, high: close + 0.001, low: close - 0.001, close, volume: 1000 + index,
      logReturnBasisPoints: index === 0 ? null : Math.sin(index) * 5, forwardDirection: index % 3 === 0 ? 1 : index % 3 === 1 ? 0 : -1,
    };
  });
  const bodies: Record<string, unknown> = {
    window: { timeframe: "1h", barCount: 500, firstTimestamp: 0, lastTimestamp: 1, developmentBarCount: 400, sealedBarCount: 100, windowStartIndex: 470, bars: windowBars, horizons: [6, 12], horizon: 6, labelsLanded: true },
    returns: { timeframe: "1h", barCount: 500, developmentBarCount: 400, sealedBarCount: 100, statistics: [statistics("development"), statistics("sealed")], histogram: bins, histogramLower: -30, histogramUpper: 30, belowRangeCount: { development: 1, sealed: 0 }, aboveRangeCount: { development: 0, sealed: 1 } },
    labels: {
      timeframe: "1h", landed: true,
      run: { barCount: 500, firstBarTimestamp: 0, lastBarTimestamp: 1, developmentBarCount: 400, labelColumnCount: 3, horizons: [6, 12], builtAt: 2 },
      catalog: [{ labelColumn: "fwd_t_h6", displayName: "forward slope t-statistic, 6 bars ahead", family: "trend/forward", role: "target", dataType: "Float64", valueSet: "real", horizonOrWindowBars: 6, rowCount: 500, knownCount: 480, knownShare: 0.96, distinctCount: 480, meaning: "slope over its standard error" }],
      classBalance: [-1, 0, 1].map((value) => ({ labelColumn: "dir_h6", displayName: "forward direction, 6 bars ahead", classValue: value, classCount: 10, knownCount: 30, classShare: 1 / 3 })),
      distributions: [{ labelColumn: "fwd_t_h6", displayName: "forward slope t-statistic, 6 bars ahead", count: 480, mean: 0, median: 0, standardDeviation: 2, skewness: 0, excessKurtosis: 0, percentile25: -1, percentile75: 1, minimum: -6, maximum: 6, droppedCount: 20, percentile1: -4, percentile5: -3, percentile95: 3, percentile99: 4, countBelowHistogramRange: 2, countAboveHistogramRange: 2, bins: bins.map((bin) => ({ lower: bin.lower, upper: bin.upper, count: bin.developmentCount })) }],
      grid: [{ horizonBars: 6, horizonTradingDays: 0.25, upperBoundaryTStatistic: 5.4, lowerBoundaryTStatistic: 1, magnitudeBoundary: 3, abstainShare: 0.2, largeMoveShare: 0.1, labelledBarShare: 0.95, upShare: 0.05, rangingShare: 0.91, downShare: 0.04, trendingShare: 0.09, shuffledTrendingShare: 0.1, trendingExcessOverShuffle: -0.01, kept: true }],
    },
  };

  it("draws the chart, both distributions and every label panel from the three sections", async () => {
    const requested: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      requested.push(url);
      const section = new URL(url, "http://localhost").searchParams.get("section") ?? "window";
      return new Response(JSON.stringify({ slug: "eurusd-bars-and-labels", notes: [], data: bodies[section] }), { status: 200 });
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(createElement(QueryClientProvider, { client }, createElement(Page)));
    await waitFor(() => expect(screen.getAllByText(/forward slope t-statistic, 6 bars ahead/).length).toBeGreaterThan(0));
    expect(requested.some((url) => url.includes("section=window"))).toBe(true);
    expect(requested.some((url) => url.includes("section=returns"))).toBe(true);
    expect(requested.some((url) => url.includes("section=labels"))).toBe(true);
    // The window of 30 bars: 30 wicks and 30 return bars, and one marker per up or down label (20 of 30).
    expect(container.querySelectorAll('svg[role="img"] polygon')).toHaveLength(20);
    expect(screen.getByText(/in this window/).textContent).toContain("10");
    expect(screen.getAllByText("development (first 80%)", { exact: false }).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/forward direction, 6 bars ahead/).length).toBeGreaterThan(0);
  });
});
