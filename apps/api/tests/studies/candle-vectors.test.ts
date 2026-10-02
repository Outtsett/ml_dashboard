/**
 * The candle-vectors study: its handler (apps/api/studies/handlers/candle-vectors.ts)
 * against a fake lake, and the pure computations the page shares with it
 * (packages/shared/src/studies/candle-vectors.ts).
 */

import type { Server } from "http";
import type { AddressInfo } from "net";
import express from "express";
import { describe, expect, it } from "vitest";
import handler, { firingCondition, resultView, sideCondition, windowsView } from "../../studies/handlers/candle-vectors";
import { createStudiesRouter } from "../../studies/studies.router";
import type { StudyLake } from "../../studies/types";
import {
  confusionAtThreshold, largestGap, meanPath, median, middleSpan, overviewTiles, shapeVector,
  type Candle, type EvaluationRow, type RecognizerMetricRow,
} from "@shared/studies/candle-vectors";

type Responder = (sql: string) => unknown[];

function fakeLake(present: (name: string) => boolean, respond: Responder, columns: string[] = []): StudyLake & { seen: string[] } {
  const seen: string[] = [];
  return {
    seen,
    async query<T>(sql: string): Promise<T[]> {
      seen.push(sql);
      return respond(sql) as T[];
    },
    async hasView(name) {
      return present(name);
    },
    async columns() {
      return columns;
    },
  };
}

const run = (lake: StudyLake, raw: Record<string, string>) => {
  const notes: string[] = [];
  return handler.run(handler.query.parse(raw), { lake, notes }).then((data) => ({ data: data as Record<string, unknown>, notes }));
};

const metric = (model: string, set: string, ap: number, auc: number): RecognizerMetricRow => ({
  model_name: model, pattern: "hammer", evaluation_set: set, timeframe: "1m", window_count: 100, pattern_count: 5, prevalence: 0.05,
  area_under_roc_curve: auc, average_precision: ap, threshold: 0.5, true_positive_count: 4, false_positive_count: 1, false_negative_count: 1,
  precision: 0.8, recall: 0.8, f1_score: 0.8, area_under_roc_curve_day_block_lower_95: null, area_under_roc_curve_day_block_upper_95: null,
  average_precision_day_block_lower_95: null, average_precision_day_block_upper_95: null,
});

describe("candle-vectors query", () => {
  it("defaults to the notebook's controls and refuses values outside them", () => {
    const parsed = handler.query.parse({});
    expect(parsed).toMatchObject({ section: "overview", timeframe: "1h", pattern: "hammer", horizon: 4, nearest: 50, bins: 40, nextTimeframe: "15m", split: "discovery", candle: 3, tail: 98 });
    expect(handler.query.safeParse({ horizon: "5" }).success).toBe(false);
    expect(handler.query.safeParse({ nearest: "7" }).success).toBe(false);
    expect(handler.query.safeParse({ hidden: "0,5" }).success).toBe(false);
    expect(handler.query.safeParse({ hidden: "0,1,2" }).success).toBe(true);
    expect(handler.query.safeParse({ patternSide: "engulfing|bullish'; DROP" }).success).toBe(false);
    expect(handler.query.safeParse({ section: "constructor" }).success).toBe(false);
  });

  it("lists every lake view it reads", () => {
    expect(handler.datasets).toContain(resultView("neighbour_lists"));
    expect(handler.datasets).toContain(windowsView("1m"));
    expect(handler.datasets).toContain("derived_mnq_next_candles_15m");
  });
});

describe("candle-vectors SQL fragments", () => {
  it("fires a signed pattern on its sign and doji on any value", () => {
    expect(firingCondition("hammer")).toBe('sign("candlestick_hammer") = 1');
    expect(firingCondition("bearish_engulfing")).toBe('sign("candlestick_engulfing") = -1');
    expect(firingCondition("doji")).toBe('"candlestick_doji" <> 0');
  });

  it("masks each TA-Lib side as the notebook does and returns null for an unknown side", () => {
    expect(sideCondition("confirmed, bearish", "candlestick_hikkake")).toBe('coalesce("candlestick_hikkake", 0) = -200');
    expect(sideCondition("fires", "candlestick_doji")).toBe('coalesce("candlestick_doji", 0) <> 0');
    expect(sideCondition("constructor", "candlestick_doji")).toBeNull();
  });
});

describe("candle-vectors handler", () => {
  it("degrades to landed: false with a note when the results are not landed", async () => {
    const lake = fakeLake(() => false, () => []);
    const { data, notes } = await run(lake, { section: "overview" });
    expect(data).toEqual({ landed: false, tiles: null });
    expect(notes[0]).toContain(resultView("recognizer_metrics"));
    expect(lake.seen).toHaveLength(0);
  });

  it("computes the headline tiles from the three tables", async () => {
    const lake = fakeLake(() => true, (sql) => {
      if (sql.includes("recognizer_metrics")) {
        return [metric("neural network", "1m 2025 (held out)", 0.96, 0.99), metric("neural network", "1m 2025 (held out)", 0.99, 0.999),
          metric("neural network", "4h 2021-2025 (never seen)", 0.8, 0.991), metric("logistic regression", "1m 2025 (held out)", 0.1, 0.6)];
      }
      if (sql.includes("neighbour_forecast_evaluation")) {
        return [0.49, 0.5, 0.52].map((auc, index) => ({ timeframe: "1m", population: index ? "hammer" : "random 2025 bars", horizon_bars: 1, nearest_k: 50,
          area_under_roc_curve: auc, benjamini_hochberg_q_value: index === 2 ? 0.05 : 0.5, last_bar_reversal_area_under_roc_curve: 0.515 }));
      }
      return [{ recall_at_50_mean: 0.97 }, { recall_at_50_mean: 0.99 }];
    });
    const { data } = await run(lake, { section: "overview" });
    expect(data.tiles).toMatchObject({
      heldOutAveragePrecision: [0.96, 0.99], transferAreaUnderCurve: [0.991, 0.991], neighbourMedianAreaUnderCurve: 0.5,
      neighbourTests: 3, neighbourSignificant: 1, reversalAreaUnderCurve: [0.515, 0.515], worstRecallAt50: 0.97,
    });
  });

  it("returns a firing's 26 bars oldest first and clamps the occurrence", async () => {
    const lake = fakeLake(() => true, (sql) => {
      if (sql.startsWith("SELECT count(*)")) return [{ n: 3 }];
      if (sql.includes("pattern_average_window")) return [];
      return Array.from({ length: 26 }, (_, index) => ({
        timestamp_milliseconds: 1000 * (26 - index), time_label: `t${26 - index}`, open: 1, high: 2, low: 0, close: 1,
        bar_minus_0_close_from_last_close_in_average_ranges: index === 0 ? 0 : 9,
      }));
    });
    const { data } = await run(lake, { section: "anatomy", occurrence: "10" });
    expect(data.occurrence).toBe(3);
    expect(lake.seen.some((sql) => sql.includes("OFFSET 2"))).toBe(true);
    const bars = data.bars as Array<{ timestamp_milliseconds: number }>;
    expect(bars[0]?.timestamp_milliseconds).toBe(1000);
    expect(bars[25]?.timestamp_milliseconds).toBe(26_000);
    const stored = data.storedVector as Array<Array<number | null>>;
    expect(stored).toHaveLength(16);
    expect(stored[15]?.[3]).toBe(0);
  });

  it("puts the firing first in the neighbour list and asks for the chosen vector and count", async () => {
    const lake = fakeLake(() => true, (sql) => {
      if (sql.startsWith("SELECT count(*)")) return [{ n: 5 }];
      return [{ rank: -1, squared_distance: null, timestamp_milliseconds: 1, time_label: "a", close_1_bars_later_from_last_close_in_average_ranges: 0.5 },
        { rank: 0, squared_distance: 2.5, timestamp_milliseconds: 2, time_label: "b" }];
    });
    const { data } = await run(lake, { section: "neighbours", vector: "market", neighbours: "12", occurrence: "2" });
    const members = data.members as Array<{ rank: number; path: Array<number | null> }>;
    expect(members.map((member) => member.rank)).toEqual([-1, 0]);
    expect(members[0]?.path[0]).toBe(0.5);
    expect(data.pathBars).toBe(24);
    const sql = lake.seen.find((statement) => statement.includes("neighbour_lists")) ?? "";
    expect(sql).toContain("l.vector = 'market'");
    expect(sql).toContain("LIMIT 12");
    expect(sql).toContain("occurrence = 2");
  });

  it("builds each column's histogram and population skewness and kurtosis", async () => {
    const lake = fakeLake(() => true, (sql) => {
      if (sql.startsWith("SELECT count(*)")) return [{ n: 1000 }];
      return [0, 3].map((bin) => ({
        column_name: "rsi_14", bin, bin_count: bin === 0 ? 6 : 4, lower_edge: 0, upper_edge: 40, count: 10, mean: 1, median: 1,
        standard_deviation: 1, percentile_25: 0, percentile_75: 2, minimum: 0, maximum: 3, m2: 4, m3: 8, m4: 48,
      }));
    }, ["rsi_14", "timestamp"]);
    const { data, notes } = await run(lake, { section: "columns", bins: "10" });
    const profile = (data.profiles as Array<Record<string, unknown>>)[0] as { bins: Array<{ lower: number; count: number }>; skewness: number; excess_kurtosis: number };
    expect(profile.bins).toHaveLength(10);
    expect(profile.bins[3]).toMatchObject({ lower: 12, count: 4 });
    expect(profile.skewness).toBeCloseTo(1);
    expect(profile.excess_kurtosis).toBeCloseTo(0);
    expect(notes).toHaveLength(0);
  });

  it("trades a bearish side short and reports too few trades", async () => {
    const lake = fakeLake(() => true, (sql) => {
      if (sql.includes("firing_counts")) return [{ pattern: "engulfing", side: "bearish", testable: true, firings: 40 }];
      if (sql.includes("run_information")) return [{ round_trip_cost_ticks: 5.6 }];
      if (sql.includes("pattern_candle_counts")) return [{ column_name: "candlestick_engulfing", candles: 2, hikkake_confirmation_bars: 3 }];
      return [{ population: "firings", finite_count: 12, low: -10, high: 10 }];
    }, ["candlestick_engulfing"]);
    const { data } = await run(lake, { section: "nextTrades", patternSide: "engulfing|bearish" });
    expect(data).toMatchObject({ landed: true, enoughTrades: false, direction: -1, costTicks: 5.6, firingTrades: 12 });
    const tradeSql = lake.seen.find((sql) => sql.includes("base AS")) ?? "";
    expect(tradeSql).toContain('coalesce("candlestick_engulfing", 0) < 0');
    expect(tradeSql).toContain("bars_since_session_break >= 1");
  });

  it("notes a side or a column it cannot draw instead of failing the request", async () => {
    const respond = (sql: string) => {
      if (sql.includes("firing_counts")) return [{ pattern: "engulfing", side: "sideways", testable: true, firings: 40 }];
      if (sql.includes("run_information")) return [{ round_trip_cost_ticks: 5.6 }];
      if (sql.includes("pattern_candle_counts")) return [{ column_name: "candlestick_engulfing", candles: 2, hikkake_confirmation_bars: 3 }];
      return [];
    };
    const unknownSide = await run(fakeLake(() => true, respond, ["candlestick_engulfing"]), { section: "nextTrades", patternSide: "engulfing|sideways" });
    expect(unknownSide.data).toMatchObject({ landed: true, enoughTrades: false, histogram: [], summary: [] });
    expect(unknownSide.notes[0]).toContain("sideways");
    const noColumn = await run(fakeLake(() => true, respond, ["timestamp"]), { section: "nextTrades", patternSide: "engulfing|sideways" });
    expect(noColumn.data).toMatchObject({ landed: true, enoughTrades: false });
    expect(noColumn.notes[0]).toContain("No TA-Lib column");
  });

  it("is served by the studies router", async () => {
    const lake = fakeLake(() => false, () => []);
    const app = express();
    app.use("/api", createStudiesRouter([handler], lake));
    const server: Server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    try {
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
      const body = await (await fetch(`${base}/studies/candle-vectors?section=paths`)).json();
      expect(body.data).toEqual({ landed: false, paths: [], context: [] });
      expect((await fetch(`${base}/studies/candle-vectors?section=nope`)).status).toBe(400);
    } finally {
      server.close();
    }
  });
});

describe("candle-vectors pure computations", () => {
  const bars: Candle[] = Array.from({ length: 26 }, (_, index) => ({ open: 100 + index, high: 102 + index, low: 99 + index, close: 101 + index }));

  it("measures every price from the last close in average ranges, unchanged by rescale and shift", () => {
    const plain = shapeVector(bars);
    const moved = shapeVector(bars, 2.5, 1000);
    expect(plain?.averageRange).toBe(3);
    expect(plain?.lastClose).toBe(126);
    expect(plain?.vector[15]).toEqual([(125 - 126) / 3, (127 - 126) / 3, (124 - 126) / 3, 0]);
    expect(moved?.averageRange).toBe(7.5);
    moved?.vector.forEach((row, i) => row.forEach((value, j) => expect(value).toBeCloseTo(plain?.vector[i]?.[j] ?? Number.NaN, 12)));
    expect(largestGap(plain?.vector ?? [], plain?.vector ?? [])).toBe(0);
    expect(shapeVector(bars.slice(0, 10))).toBeNull();
  });

  it("counts alarms from the score histogram at a threshold", () => {
    const rows = [
      { population: "pattern", bin_lower: 0.1, bin_upper: 0.2, window_count: 2 },
      { population: "pattern", bin_lower: 0.9, bin_upper: 1, window_count: 8 },
      { population: "not the pattern", bin_lower: 0, bin_upper: 0.1, window_count: 90 },
      { population: "not the pattern", bin_lower: 0.9, bin_upper: 1, window_count: 2 },
    ];
    expect(confusionAtThreshold(rows, 0.5)).toEqual({ truePositive: 8, falseNegative: 2, falsePositive: 2, trueNegative: 90, precision: 0.8, recall: 0.8 });
  });

  it("averages neighbour paths over the neighbours that have a value, and spans the middle share", () => {
    expect(meanPath([[1, 2], [3, null]], 2)).toEqual([0, 2, 2]);
    expect(median([3, 1, 2, 10])).toBe(2.5);
    expect(middleSpan([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 80)).toEqual([1, 9]);
  });

  it("reports empty tiles as nulls", () => {
    const tiles = overviewTiles([], [] as EvaluationRow[], []);
    expect(tiles).toMatchObject({ heldOutAveragePrecision: null, neighbourMedianAreaUnderCurve: null, neighbourTests: 0, worstRecallAt50: null });
  });
});
