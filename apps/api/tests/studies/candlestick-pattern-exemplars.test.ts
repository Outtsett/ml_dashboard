// @vitest-environment jsdom
/**
 * candlestick-pattern-exemplars: the handler against a fake lake (which SQL it
 * writes, what it does when the tables are not landed, the pattern fallback)
 * and the pure arithmetic the handler and the page share.
 */

import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../../../web/tests/setup";
import Page from "@/studies/pages/candlestick-pattern-exemplars/Page";
import handler, { DAILY_BARS_VIEW, EXEMPLARS_VIEW, RULES_VIEW } from "../../studies/handlers/candlestick-pattern-exemplars";
import {
  WINDOW_BARS_BEFORE, archetypeDistance, filterByContext, gatedCounts, groupWindows, measurePriorTrend, patternNeedsTrend,
  scopeContextRows, sharePercent,
  type ContextRow, type ExemplarsBody, type FiringRow, type WindowBar,
} from "@shared/studies/candlestick-pattern-exemplars";
import type { StudyContext, StudyLake } from "../../studies/types";

function fakeLake(present: readonly string[], log: string[]): StudyLake {
  return {
    async hasView(name) {
      return present.includes(name);
    },
    async columns() {
      return [];
    },
    async query<T>(sql: string): Promise<T[]> {
      log.push(sql);
      const rows: unknown[] =
        sql.includes("GROUP BY talib_function ORDER BY firings DESC") ? [{ talib_function: "CDLDOJI", firings: 338 }, { talib_function: "CDLHAMMER", firings: 66 }]
        : sql.includes("AS pattern_count") ? [{ pattern_count: 61, patterns_needing_prior_trend: 47, patterns_talib_verifies_prior_trend: 0, fired_pattern_count: 44, firing_count: 4528, gated_firing_count: 1378, gated_held_count: 531, symbol: "MNQ", timeframe: "1d", first_bar_date: "2019-05-13", last_bar_date: "2025-12-28" }]
        : sql.includes("WITH fired AS") ? [{ talib_function: "CDLHAMMER", bars_the_rule_reads: 2, firings: 66, context_required: 66, context_held: 10, context_held_percent: 15.15 }]
        : sql.includes("AS timestamp_ms") ? [{ timestamp_ms: 1, talib_function: "CDLHAMMER", body: 0.3, upper: 0.1, lower: 0.6 }, { timestamp_ms: 2, talib_function: "CDLDOJI", body: 0.02, upper: 0.5, lower: 0.48 }]
        : sql.includes("emitted_values") ? [{ talib_function: "CDLHAMMER", bars_the_rule_reads: 2, pattern_type: "reversal" }]
        : sql.includes("median(") ? [{ body_fraction_of_range: 0.27, upper_shadow_fraction_of_range: 0.07, lower_shadow_fraction_of_range: 0.65 }]
        : sql.includes("WITH ordered AS") ? [
            { firing_timestamp_ms: 100, bar_offset: 0, bar_timestamp_ms: 100, absolute_open_price: 1, absolute_high_price: 2, absolute_low_price: 0, absolute_close_price: 1.5 },
            { firing_timestamp_ms: 100, bar_offset: -1, bar_timestamp_ms: 99, absolute_open_price: 1, absolute_high_price: 2, absolute_low_price: 0, absolute_close_price: 1.2 },
          ]
        : sql.includes("AS bar_date") ? [{ bar_timestamp_ms: 100, bar_date: "2019-01-01", prototypicality_rank: 1 }]
        : [];
      return rows as T[];
    },
  };
}

async function run(present: readonly string[], input: Record<string, unknown> = {}) {
  const log: string[] = [];
  const context: StudyContext = { lake: fakeLake(present, log), notes: [] };
  const body = await handler.run(handler.query.parse(input), context);
  return { body, log, notes: context.notes };
}

const ALL_VIEWS = [EXEMPLARS_VIEW, RULES_VIEW, DAILY_BARS_VIEW];

describe("candlestick-pattern-exemplars handler", () => {
  it("declares every view it reads", () => {
    expect(handler.slug).toBe("candlestick-pattern-exemplars");
    expect(handler.datasets).toEqual(ALL_VIEWS);
  });

  it("answers an empty body and a note when the tables are not landed", async () => {
    const { body, log, notes } = await run([EXEMPLARS_VIEW]);
    expect(body.landed).toBe(false);
    expect(body.firings).toEqual([]);
    expect(log).toEqual([]);
    expect(notes[0]).toContain(RULES_VIEW);
  });

  it("reads the chosen pattern and keeps the headline, context table and shapes", async () => {
    const { body, log } = await run(ALL_VIEWS, { pattern: "CDLHAMMER" });
    expect(body.landed).toBe(true);
    expect(body.pattern).toBe("CDLHAMMER");
    expect(body.headline?.patterns_needing_prior_trend).toBe(47);
    expect(body.headline?.gated_held_count).toBe(531);
    expect(body.contextRows).toHaveLength(1);
    expect(body.archetype?.lower_shadow_fraction_of_range).toBeCloseTo(0.65);
    expect(body.firings[0]?.bar_date).toBe("2019-01-01");
    expect(Object.keys(body.windows)).toEqual(["100"]);
    expect(body.windows["100"]?.map((bar) => bar.bar_offset)).toEqual([-1, 0]);
    expect(body.shapes.patterns).toEqual(["CDLDOJI", "CDLHAMMER"]);
    expect(body.shapes.pattern_index).toEqual([1, 0]);
    expect(log.every((sql) => !sql.includes("DROP") && !sql.includes("INSERT"))).toBe(true);
    expect(log.some((sql) => sql.includes(`"${EXEMPLARS_VIEW}"`) && sql.includes("talib_function = 'CDLHAMMER'"))).toBe(true);
  });

  it("reads timestamps in UTC so a session time zone cannot shift a date", async () => {
    const { log } = await run(ALL_VIEWS);
    const firingSql = log.find((sql) => sql.includes("AS bar_date")) ?? "";
    expect(firingSql).toContain("timezone('UTC', bar_timestamp)");
  });

  it("writes the notebook's context filter into the firings and the exemplar windows", async () => {
    const confirmed = await run(ALL_VIEWS, { context: "confirmed" });
    const confirmedSql = confirmed.log.filter((sql) => sql.includes("IS NOT DISTINCT FROM"));
    expect(confirmedSql).toHaveLength(2);
    expect(confirmedSql.some((sql) => sql.includes("e.prior_trend_direction IS NOT DISTINCT FROM e.required_prior_trend"))).toBe(true);
    const contradicted = await run(ALL_VIEWS, { context: "contradicted" });
    expect(contradicted.log.filter((sql) => sql.includes("IS DISTINCT FROM") && !sql.includes("IS NOT DISTINCT"))).toHaveLength(2);
    const every = await run(ALL_VIEWS, { context: "all" });
    expect(every.log.some((sql) => sql.includes("DISTINCT FROM"))).toBe(false);
  });

  it("falls back to the first fired pattern, with a note, when the requested one never fired", async () => {
    const { body, notes } = await run(ALL_VIEWS, { pattern: "CDLMATHOLD" });
    expect(body.pattern).toBe("CDLDOJI");
    expect(notes[0]).toContain("CDLMATHOLD");
  });

  it("refuses a pattern name that is not a TA-Lib function name", () => {
    for (const bad of ["x'; DROP TABLE t; --", "cdlhammer", "CDL HAMMER", "CDL", ""]) {
      expect(handler.query.safeParse({ pattern: bad }).success, bad).toBe(false);
    }
    expect(handler.query.safeParse({ context: "sometimes" }).success).toBe(false);
    expect(handler.query.parse({})).toEqual({ pattern: "CDLHAMMER", context: "all" });
  });
});

function firing(prior: string, required: string): FiringRow {
  return { prior_trend_direction: prior, required_prior_trend: required } as FiringRow;
}

describe("context arithmetic", () => {
  const rows = [firing("down", "down"), firing("up", "down"), firing("sideways", "down"), firing("up", "none"), firing("up", "up")];

  it("filters as the notebook does: contradicts includes firings that need no trend", () => {
    expect(filterByContext(rows, "all")).toHaveLength(5);
    expect(filterByContext(rows, "confirmed")).toHaveLength(2);
    expect(filterByContext(rows, "contradicted")).toHaveLength(3);
  });

  it("counts gated firings (required up or down) and how many found their trend", () => {
    expect(gatedCounts(rows)).toEqual({ gated: 4, held: 2 });
    expect(gatedCounts([])).toEqual({ gated: 0, held: 0 });
  });

  it("shares: a percent of rows, 0 for none", () => {
    expect(sharePercent(rows, (row) => row.prior_trend_direction === "up")).toBeCloseTo(60);
    expect(sharePercent([], () => true)).toBe(0);
  });

  it("scopes the context table", () => {
    const base = { bars_the_rule_reads: 1, pattern_type: "reversal", talib_verifies_prior_trend: false, context_required: 0, context_held: 0, context_held_percent: null };
    const table: ContextRow[] = [
      { ...base, talib_function: "A", required_prior_trend_for_bullish_signal: "down", required_prior_trend_for_bearish_signal: "none", firings: 3 },
      { ...base, talib_function: "B", required_prior_trend_for_bullish_signal: "none", required_prior_trend_for_bearish_signal: "not_applicable", firings: 0 },
      { ...base, talib_function: "C", required_prior_trend_for_bullish_signal: "none", required_prior_trend_for_bearish_signal: "up", firings: 5 },
    ];
    expect(patternNeedsTrend(table[1] as ContextRow)).toBe(false);
    expect(scopeContextRows(table, "all").map((row) => row.talib_function)).toEqual(["A", "B", "C"]);
    expect(scopeContextRows(table, "needs_context").map((row) => row.talib_function)).toEqual(["A", "C"]);
    expect(scopeContextRows(table, "fired").map((row) => row.talib_function)).toEqual(["A", "C"]);
  });
});

describe("shape arithmetic", () => {
  it("is the Euclidean distance over body, upper shadow and lower shadow", () => {
    expect(archetypeDistance({ body: 0.3, upper: 0.1, lower: 0.6 }, { body: 0.3, upper: 0.1, lower: 0.6 })).toBe(0);
    expect(archetypeDistance({ body: 0.3, upper: 0.1, lower: 0.6 }, { body: 0, upper: 0.1, lower: 0.2 })).toBeCloseTo(0.5);
  });
});

function bars(closes: number[], range: number): WindowBar[] {
  // closes[0] sits at offset -WINDOW_BARS_BEFORE; the firing bar (offset 0) is appended.
  const list = closes.map((close, position) => ({
    bar_offset: position - WINDOW_BARS_BEFORE,
    bar_timestamp_ms: position,
    absolute_open_price: close,
    absolute_high_price: close + range / 2,
    absolute_low_price: close - range / 2,
    absolute_close_price: close,
  }));
  list.push({ bar_offset: 0, bar_timestamp_ms: 99, absolute_open_price: 0, absolute_high_price: 1, absolute_low_price: 0, absolute_close_price: 0 });
  return list;
}

describe("prior trend, as the build stamps it", () => {
  const eleven = (step: number) => Array.from({ length: WINDOW_BARS_BEFORE }, (_, position) => 100 + step * position);

  it("is up when the ten-bar move clears the median range, down when negative, else sideways", () => {
    expect(measurePriorTrend(bars(eleven(2), 10))).toMatchObject({ direction: "up", move: 20, typicalRange: 10, threshold: 10 });
    expect(measurePriorTrend(bars(eleven(-2), 10)).direction).toBe("down");
    expect(measurePriorTrend(bars(eleven(0.5), 10)).direction).toBe("sideways");
  });

  it("calls a move of exactly the threshold a trend (the build's test is strictly less-than)", () => {
    expect(measurePriorTrend(bars(eleven(1), 10)).direction).toBe("up");
  });

  it("is sideways on a zero range and unknown when the window is short", () => {
    expect(measurePriorTrend(bars(eleven(3), 0)).direction).toBe("sideways");
    expect(measurePriorTrend(bars(eleven(3), 10).slice(2)).direction).toBe("unknown");
  });

  it("ignores the firing bar itself", () => {
    const window = bars(eleven(2), 10);
    window[window.length - 1] = { ...(window[window.length - 1] as WindowBar), absolute_close_price: -5000 };
    expect(measurePriorTrend(window).direction).toBe("up");
  });
});

describe("window grouping", () => {
  it("groups by firing and orders each window by offset", () => {
    const grouped = groupWindows([
      { firing_timestamp_ms: 5, bar_offset: 0, bar_timestamp_ms: 5, absolute_open_price: 1, absolute_high_price: 1, absolute_low_price: 1, absolute_close_price: 1 },
      { firing_timestamp_ms: 5, bar_offset: -1, bar_timestamp_ms: 4, absolute_open_price: 1, absolute_high_price: 1, absolute_low_price: 1, absolute_close_price: 1 },
      { firing_timestamp_ms: 9, bar_offset: 0, bar_timestamp_ms: 9, absolute_open_price: 1, absolute_high_price: 1, absolute_low_price: 1, absolute_close_price: 1 },
    ]);
    expect(Object.keys(grouped)).toEqual(["5", "9"]);
    expect(grouped["5"]?.map((bar) => bar.bar_offset)).toEqual([-1, 0]);
    expect(grouped["5"]?.[0]).not.toHaveProperty("firing_timestamp_ms");
  });
});

// ── the page, rendered on a small synthetic body ───────────────────────────

function syntheticBody(): ExemplarsBody {
  const firingAt = (rank: number, stamp: number, prior: string): FiringRow => ({
    bar_timestamp_ms: stamp,
    bar_date: `2020-01-0${rank}`,
    prototypicality_rank: rank,
    signal_direction: "bullish",
    emitted_value: 100,
    body_fraction_of_range: 0.25 + 0.01 * rank,
    upper_shadow_fraction_of_range: 0.1,
    lower_shadow_fraction_of_range: 0.65 - 0.01 * rank,
    close_versus_open: rank % 2 ? "above" : "below",
    close_versus_previous_close: "above",
    prior_trend_direction: prior,
    required_prior_trend: "down",
    archetype_distance: 0.01 * rank,
    body_size_points: 10 * rank,
    total_range_points: 40,
    volume: 1000 * rank,
  });
  const firings = [firingAt(1, 1000, "down"), firingAt(2, 2000, "up"), firingAt(3, 3000, "sideways")];
  const windows: Record<string, WindowBar[]> = {};
  for (const firing of firings) {
    windows[String(firing.bar_timestamp_ms)] = Array.from({ length: WINDOW_BARS_BEFORE + 1 }, (_, position) => {
      const offset = position - WINDOW_BARS_BEFORE;
      const close = 100 - position * 3;
      return { bar_offset: offset, bar_timestamp_ms: firing.bar_timestamp_ms + offset, absolute_open_price: close + 1, absolute_high_price: close + 4, absolute_low_price: close - 4, absolute_close_price: close };
    });
  }
  const contextRow = (name: string, required: number, held: number): ContextRow => ({
    talib_function: name, bars_the_rule_reads: 2, pattern_type: "reversal",
    required_prior_trend_for_bullish_signal: "down", required_prior_trend_for_bearish_signal: "up", talib_verifies_prior_trend: false,
    firings: required, context_required: required, context_held: held, context_held_percent: required ? (100 * held) / required : null,
  });
  return {
    landed: true,
    headline: { pattern_count: 61, patterns_needing_prior_trend: 47, patterns_talib_verifies_prior_trend: 0, fired_pattern_count: 44, firing_count: 4528, gated_firing_count: 1378, gated_held_count: 531, symbol: "MNQ", timeframe: "1d", first_bar_date: "2019-05-13", last_bar_date: "2025-12-28" },
    patterns: [{ talib_function: "CDLHAMMER", firings: 3 }],
    pattern: "CDLHAMMER",
    context: "all",
    rule: { talib_function: "CDLHAMMER", bars_the_rule_reads: 2, pattern_type: "reversal", required_prior_trend_for_bullish_signal: "down", required_prior_trend_for_bearish_signal: "not_applicable", talib_verifies_prior_trend: false, emitted_values: "+100 only", shape_conditions: "small real body | long lower shadow", adaptive_settings_used: "BodyShort" },
    archetype: { body_fraction_of_range: 0.27, upper_shadow_fraction_of_range: 0.1, lower_shadow_fraction_of_range: 0.63 },
    firings,
    windows,
    contextRows: [contextRow("CDLHAMMER", 66, 16), contextRow("CDLDOJI", 0, 0), contextRow("CDLENGULFING", 200, 120)],
    shapes: { patterns: ["CDLHAMMER"], timestamp_ms: [1000, 2000, 3000], pattern_index: [0, 0, 0], body: [0.26, 0.27, 0.28], upper: [0.1, 0.1, 0.1], lower: [0.64, 0.63, 0.62] },
  };
}

function renderPage(body: ExemplarsBody) {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ slug: "candlestick-pattern-exemplars", notes: [], data: body }), { status: 200 }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(createElement(QueryClientProvider, { client }, createElement(Page)));
  return fetchMock;
}

describe("candlestick-pattern-exemplars page", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("asks for the default pattern and shows the headline the body carries", async () => {
    const fetchMock = renderPage(syntheticBody());
    await waitFor(() => expect(screen.getByText("47 of 61")).toBeTruthy());
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("/api/studies/candlestick-pattern-exemplars?pattern=CDLHAMMER&context=all");
    expect(screen.getByText("What the rule actually tests")).toBeTruthy();
    expect(screen.getByText(/531 \(38\.5%\)/)).toBeTruthy();
  });

  it("draws the exemplars with their ranks and lets a click choose the one the formulas use", async () => {
    renderPage(syntheticBody());
    await waitFor(() => expect(screen.getByText("#1 · 2020-01-01")).toBeTruthy());
    expect(screen.getByText("#3 · 2020-01-03")).toBeTruthy();
    expect(screen.getByText("Exemplar #1 of CDLHAMMER, 2020-01-01. Step through the drawn exemplars and watch every number move.")).toBeTruthy();
    fireEvent.click(screen.getByText("#2 · 2020-01-02"));
    await waitFor(() => expect(screen.getByText(/Exemplar #2 of CDLHAMMER, 2020-01-02/)).toBeTruthy());
  });

  it("says the tables are not landed instead of failing", async () => {
    renderPage({ ...syntheticBody(), landed: false, headline: null, firings: [], rule: null, archetype: null, contextRows: [] });
    await waitFor(() => expect(screen.getByText(/exemplar tables are not in the lake yet/)).toBeTruthy());
  });
});
