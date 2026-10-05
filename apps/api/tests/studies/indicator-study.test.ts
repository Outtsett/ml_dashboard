/**
 * The indicator-study handler (apps/api/studies/handlers/indicator-study.ts)
 * on a fake lake, and the pure compute it shares with the page
 * (packages/shared/src/studies/indicator-study.ts), checked against numpy's numbers.
 */

import type { Server } from "http";
import type { AddressInfo } from "net";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import handler from "../../studies/handlers/indicator-study";
import { createStudiesRouter } from "../../studies/studies.router";
import type { StudyHandler, StudyLake } from "../../studies/types";
import {
  predictabilityVerdict, prefixLocationWidth, runningLocationWidth, runningSteps, scoreTreatment, transformedExpression, walkForwardSummary,
  type ChartBody, type CorrelationBody, type WalkForwardFoldRow,
} from "@shared/studies/indicator-study";

// ── a fake lake: every view served, answers keyed on the SQL it is sent ─────

const executed: string[] = [];

const CATALOGUE = [
  { timeframe: "1h", column_name: "rsi_14", talib_function: "RSI", talib_output: "real", talib_group: "Momentum Indicators", parameters: "{}", lookback_bars: 14, feature_kind: "stationary", transformation_formula: "none", pattern_semantics: null, semantics_description: null, null_count: 14, infinite_count: 0, excluded_reason: null, duplicate_of: null },
  { timeframe: "1h", column_name: "ema_30", talib_function: "EMA", talib_output: "real", talib_group: "Overlap Studies", parameters: "{}", lookback_bars: 29, feature_kind: "price_level", transformation_formula: "x / close - 1", pattern_semantics: null, semantics_description: null, null_count: 29, infinite_count: 0, excluded_reason: null, duplicate_of: null },
  { timeframe: "1h", column_name: "candlestick_engulfing", talib_function: "CDLENGULFING", talib_output: "integer", talib_group: "Pattern Recognition", parameters: "{}", lookback_bars: 2, feature_kind: "candlestick_pattern", transformation_formula: "none", pattern_semantics: "signed_directional", semantics_description: "sign is the claimed direction", null_count: 0, infinite_count: 0, excluded_reason: null, duplicate_of: null },
];

function fakeLake(served: (name: string) => boolean): StudyLake {
  return {
    async query<T>(sql: string): Promise<T[]> {
      executed.push(sql);
      if (sql.includes("indicator_catalogue\" WHERE recipe") && sql.includes("LEFT JOIN")) return CATALOGUE as T[];
      if (sql.includes("count(*) AS bars FROM")) return [{ bars: 1451n }] as T[];
      if (sql.includes("UNPIVOT")) return [{ bar_index: 1449, pattern: "candlestick_engulfing", value: -100 }] as T[];
      if (sql.includes("timestamp_milliseconds") && sql.includes("bar_direction_targets")) {
        return [
          { bar_index: 1449, timestamp_milliseconds: 1_767_000_000_000, contract_symbol: "MNQH6", open: 1, high: 2, low: 0.5, close: 1.5, volume: 10, bars_since_contract_roll: 5, direction_binary: 1, exclusion_reason: null, rsi_14: 55.5 },
          { bar_index: 1450, timestamp_milliseconds: 1_767_003_600_000, contract_symbol: "MNQH6", open: 1.5, high: 2, low: 1, close: 1.25, volume: 12, bars_since_contract_roll: 6, direction_binary: null, exclusion_reason: "end of sample", rsi_14: null },
        ] as T[];
      }
      if (sql.includes("indicator_cluster_order")) {
        return [
          { column_name: "rsi_14", talib_group: "Momentum Indicators", feature_kind: "stationary", cluster_position: 0n, cluster_number: 1n },
          { column_name: "ema_30", talib_group: "Overlap Studies", feature_kind: "price_level", cluster_position: 1n, cluster_number: 2n },
        ] as T[];
      }
      if (sql.includes("indicator_correlation_pairs")) {
        return [
          { column_a: "rsi_14", column_b: "rsi_14", correlation: 1, pair_count: 1400 },
          { column_a: "rsi_14", column_b: "ema_30", correlation: 0.123456, pair_count: 1390 },
          { column_a: "ema_30", column_b: "rsi_14", correlation: 0.123456, pair_count: 1390 },
          { column_a: "unknown_column", column_b: "rsi_14", correlation: 0.5, pair_count: 3 },
        ] as T[];
      }
      return [] as T[];
    },
    async hasView(name: string) {
      return served(name);
    },
    async columns(name: string) {
      return name.startsWith("derived_mnq_talib") ? ["timestamp", "open", "high", "low", "close", "rsi_14", "ema_30", "candlestick_engulfing"] : ["independent_reimplementation_candlestick_engulfing"];
    },
  };
}

let server: Server;
let base = "";
let emptyServer: Server;
let emptyBase = "";

async function listen(lake: StudyLake): Promise<[Server, string]> {
  const app = express();
  app.use("/api", createStudiesRouter([handler as StudyHandler], lake));
  const instance = app.listen(0);
  await new Promise<void>((resolve) => instance.once("listening", () => resolve()));
  return [instance, `http://127.0.0.1:${(instance.address() as AddressInfo).port}/api`];
}

beforeAll(async () => {
  [server, base] = await listen(fakeLake(() => true));
  [emptyServer, emptyBase] = await listen(fakeLake(() => false));
});

afterAll(() => {
  server.close();
  emptyServer.close();
});

describe("indicator-study handler", () => {
  it("lists every lake view it reads", () => {
    expect(handler.slug).toBe("indicator-study");
    expect(handler.datasets).toContain("derived_mnq_talib_1m");
    expect(handler.datasets).toContain("derived_study_indicator_study_indicator_directional_predictability");
    expect(handler.datasets).toContain("derived_study_indicator_study_mnq_talib_4h_bars");
  });

  it("answers a study that is not landed with a note and an empty body", async () => {
    const response = await fetch(`${emptyBase}/studies/indicator-study?part=predictability`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual({ empty: true });
    expect(body.notes[0]).toContain("derived_study_indicator_study_indicator_directional_predictability");
  });

  it("refuses a column name that is not a plain identifier, and a horizon it did not compute", async () => {
    expect((await fetch(`${base}/studies/indicator-study?part=chart&overlays=rsi_14,x%22;DROP`)).status).toBe(400);
    expect((await fetch(`${base}/studies/indicator-study?part=chart&horizon=2`)).status).toBe(400);
    expect((await fetch(`${base}/studies/indicator-study?part=nothing`)).status).toBe(400);
  });

  it("windows the chart, drops a column the bar set lacks with a note, and reads the direction label", async () => {
    const response = await fetch(`${base}/studies/indicator-study?part=chart&windowLength=20&overlays=ema_30,not_a_column&panels=rsi_14`);
    const body = (await response.json()) as { notes: string[]; data: ChartBody };
    expect(body.data.barCount).toBe(1451);
    expect(body.data.lastBarIndex).toBe(1450);
    expect(body.data.firstBarIndex).toBe(1431);
    expect(body.data.overlays).toEqual(["ema_30"]);
    expect(body.data.panels).toEqual(["rsi_14"]);
    expect(body.notes.join(" ")).toContain("not_a_column");
    expect(body.data.bars[0]?.values.rsi_14).toBe(55.5);
    expect(body.data.bars[1]?.exclusion_reason).toBe("end of sample");
    expect(body.data.markers).toEqual([{ bar_index: 1449, pattern: "candlestick_engulfing", value: -100 }]);
    const windowSql = executed.find((sql) => sql.includes("bar_direction_targets") && sql.includes("BETWEEN"));
    expect(windowSql).toContain("BETWEEN 1431 AND 1450");
    expect(windowSql).toContain("horizon_bars = 1");
  });

  it("builds the correlation matrix in cluster order and ignores pairs outside the catalogue", async () => {
    const body = (await (await fetch(`${base}/studies/indicator-study?part=correlation`)).json()) as { data: CorrelationBody };
    expect(body.data.columns.map((column) => column.column_name)).toEqual(["rsi_14", "ema_30"]);
    expect(body.data.correlations).toEqual([1, 0.1235, 0.1235, null]);
    expect(body.data.pairCounts).toEqual([1400, 1390, 1390, null]);
  });
});

describe("indicator-study compute", () => {
  it("gives the notebook's verdicts", () => {
    expect(predictabilityVerdict(0.2, 0.1, 0.5)).toBe("clears the family-wise threshold");
    expect(predictabilityVerdict(-0.2, 0.1, 0.5)).toBe("clears the family-wise threshold");
    expect(predictabilityVerdict(0.05, 0.1, 0.05)).toBe("q < 0.10 only (false-discovery screen)");
    expect(predictabilityVerdict(0.05, 0.1, 0.2)).toBe("indistinguishable from the null");
    expect(predictabilityVerdict(null, null, null)).toBe("indistinguishable from the null");
    expect(scoreTreatment("stationary")).toBe("scored as-is (raw = transformed)");
    expect(scoreTreatment("price_level")).toBe("transformed before scoring");
  });

  it("transforms each kind as the notebook does", () => {
    expect(transformedExpression("price_level", "x", "l")).toBe("(x / close - 1)");
    expect(transformedExpression("signed_price_level", "x", "l")).toBe("(abs(x) / close - 1)");
    expect(transformedExpression("price_level_sum_of_period", "x", "l")).toBe("(x / (30 * close) - 1)");
    expect(transformedExpression("cumulative", "x", "l")).toBe("(x - l)");
    expect(transformedExpression("array_index", "x", "l")).toBe("(bar_index - x)");
    expect(transformedExpression("stationary", "x", "l")).toBe("(x)");
  });

  it("matches numpy on location and width (linear quantiles, nulls skipped)", () => {
    const prefix = prefixLocationWidth([0.1, 0.4, 0.35, 0.9, null, 0.7], 6);
    expect(prefix.count).toBe(5);
    expect(prefix.location).toBeCloseTo(-1.0, 10);
    expect(prefix.width).toBeCloseTo(35.0, 10);
    const single = prefixLocationWidth([0.3], 1);
    expect(single.location).toBeCloseTo(-20, 10);
    expect(single.width).toBeNull();
    expect(prefixLocationWidth([], 3)).toEqual({ location: null, width: null, count: 0 });
  });

  it("steps the running line exactly as numpy.linspace, truncated and unique", () => {
    expect(runningSteps(1)).toEqual([2]);
    expect(runningSteps(3)).toEqual([2, 3]);
    expect(runningSteps(10)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const thousand = runningSteps(1000);
    expect(thousand.length).toBe(300);
    expect(thousand.slice(0, 5)).toEqual([2, 5, 8, 12, 15]);
    expect(thousand.reduce((a, b) => a + b, 0)).toBe(150151);
    const doji = runningSteps(11865);
    expect(doji.slice(0, 5)).toEqual([2, 41, 81, 121, 160]);
    expect(doji.reduce((a, b) => a + b, 0)).toBe(1779901);
    expect(runningLocationWidth([0.5, 0.5, 0.5])).toEqual([{ firings_so_far: 2, location: 0, width: 0 }, { firings_so_far: 3, location: 0, width: 0 }]);
  });

  it("summarises the walk-forward folds per model, sorted by mean log loss", () => {
    const fold = (model: string, number: number, auc: number, loss: number): WalkForwardFoldRow => ({
      fold_number: number, model_name: model, train_bar_count: 100, test_bar_count: 20, independent_window_count: 20, test_start_timestamp: 0, test_end_timestamp: 1,
      test_base_rate_up: 0.5, area_under_roc_curve: auc, area_under_roc_curve_null_95th_percentile: 0.6, area_under_roc_curve_permutation_p_value: 0.4,
      log_loss: loss, accuracy: 0.5, chosen_inverse_regularization: null, feature_count: 1,
    });
    const summary = walkForwardSummary(
      [fold("base rate", 1, 0.5, 0.69), fold("base rate", 2, 0.5, 0.7), fold("logistic on every indicator", 1, 0.55, 0.72), fold("logistic on every indicator", 2, 0.45, 0.74)],
      [{ model_name: "logistic on every indicator", null_mean_area_under_roc_curve_95th_percentile: 0.56, mean_area_under_roc_curve_permutation_p_value: 0.5, null_rule: "shift" }],
    );
    expect(summary.map((row) => row.model_name)).toEqual(["base rate", "logistic on every indicator"]);
    expect(summary[1]?.mean_area_under_roc_curve).toBeCloseTo(0.5, 12);
    expect(summary[1]?.worst_fold_area_under_roc_curve).toBe(0.45);
    expect(summary[1]?.independent_window_count).toBe(40);
    expect(summary[1]?.null_mean_area_under_roc_curve_95th_percentile).toBe(0.56);
    expect(summary[0]?.null_rule).toBeNull();
  });
});
