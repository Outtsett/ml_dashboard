/**
 * The model-cycle-runs study (apps/api/studies/handlers/model-cycle-runs.ts)
 * on a fake lake, plus the pure pieces it shares with the page
 * (packages/shared/src/studies/model-cycle-runs.ts): scope labels, the metric matrix,
 * the all-run comparison, thinning, grouped bins, the running Sharpe ratio and
 * the expected calibration error terms.
 */

import type { Server } from "http";
import type { AddressInfo } from "net";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createStudiesRouter } from "../../studies/studies.router";
import handler, {
  binsFromRows, comparisonSql, histogramSql, modelCycleRunsQuery, summarySql,
} from "../../studies/handlers/model-cycle-runs";
import type { StudyHandler, StudyLake } from "../../studies/types";
import {
  COMPARISON_METRICS, PREDICTION_COLUMNS, calibrationTerms, cividis, comparisonWide, groupedBins, parametersUsed, pivotMatrix,
  runningSharpe, scopeLabel, thin,
  type CalibrationBin, type MetricRow, type ModelCycleRunsBody,
} from "@shared/studies/model-cycle-runs";

const RECIPE = "MNQ_5m_xgboost_walk_forward_cycle_20260928T185403";

const executed: string[] = [];
const missingViews = new Set<string>();

function answer(sql: string): Record<string, unknown>[] {
  if (sql.includes("UNPIVOT") && sql.includes("quantile_cont")) {
    return ["probability_up", "forecast_error_points"].map((column) => ({
      column_name: column, count: 100, mean: 0.5, median: 0.5, standard_deviation: 0.1, skewness: 0.1, kurtosis: -1,
      percentile_25: 0.4, percentile_75: 0.6, minimum: 0, maximum: 1,
    }));
  }
  if (sql.includes("UNPIVOT")) {
    return [{ column_name: "probability_up", lo: 0, hi: 1, bin: 0, rows: 40 }, { column_name: "probability_up", lo: 0, hi: 1, bin: 9, rows: 60 }];
  }
  if (sql.includes("count(\"forecast_error_points\") AS resolved_forecast_count")) {
    return [{ count: 5, forecast_count: 4, resolved_forecast_count: 3, on_grid_fraction: 1, first_timestamp: 1000, last_timestamp: 5000 }];
  }
  if (sql.includes('"equity_usd"') && sql.includes('ORDER BY "timestamp"') && !sql.includes("AS move")) {
    return Array.from({ length: 5 }, (_, index) => ({ timestamp: 1000 + index * 1000, fold_index: 0, equity_usd: index * 10, position_held: 1, bar_net_profit_usd: index === 0 ? 0 : 10 }));
  }
  if (sql.includes('AS move')) return [{ move: 0.25, error: -1, forecast: 100.25, close: 100 }];
  if (sql.includes("FROM \"derived_model_cycle_runs_bars\"")) return [{ role: "processed", bars: 5, first_bar: 1000, last_bar: 5000, roll_adjusted_bars: 0 }];
  if (sql.includes("AS kind")) {
    const kind = sql.includes("'model' AS kind") ? "model" : "trading";
    return [
      { kind, scope: "run", fold_index: null, metric_family: "f", metric_name: "m", metric_label: "M", metric_value: 1.5, unit: "ratio", better: "higher", sample_count: 5, note: null, definition: "d", formula: "x", metric_order: 0 },
      { kind, scope: "fold", fold_index: 0, metric_family: "f", metric_name: "m", metric_label: "M", metric_value: null, unit: "ratio", better: "higher", sample_count: 5, note: "reason", definition: "d", formula: "x", metric_order: 0 },
    ];
  }
  if (sql.includes("UNION ALL")) {
    return [
      { recipe: RECIPE, metric_name: "sharpe_ratio", metric_value: 0.1 },
      { recipe: "older", metric_name: "sharpe_ratio", metric_value: 2 },
      { recipe: "older", metric_name: "probabilistic_sharpe_ratio", metric_value: 0.9 },
    ];
  }
  if (sql.includes("max(\"timestamp\") AS last_bar") || sql.includes('ORDER BY max("timestamp") DESC')) return [{ recipe: RECIPE }];
  if (sql.includes("count(*) AS fold_count")) {
    return [
      { recipe: RECIPE, fold_count: 3, first_test: 10, last_test: 90, test_bars: 5307 },
      { recipe: "older", fold_count: 2, first_test: 5, last_test: 50, test_bars: 100 },
    ];
  }
  if (sql.includes("FROM \"derived_model_cycle_runs_runs\"")) {
    return [{ recipe: RECIPE, status: "complete", model_label: "XGBoost", tick_size: 0.25, bars_per_year: 70007.05, net_profit_usd: 60.66, sharpe_ratio: 0.1056, trade_count: 3, accuracy: 0.5 }];
  }
  if (sql.includes("FROM \"derived_model_cycle_runs_trades\"")) {
    return [{ trade_number: 1, fold_index: 0, side: "long", net_profit_usd: 5, entry_timestamp: 1000 }];
  }
  if (sql.includes("FROM \"derived_model_cycle_runs_folds\"")) {
    return [{ fold_index: 0, status: "complete", train_bar_count: 10, parameters: JSON.stringify({ depth: 4, rate: 0.1 }), metrics: "{}", model_path: "x.json" }];
  }
  if (sql.includes("derived_model_cycle_audit_findings")) return [{ finding_number: 1, area: "a", severity: "high", location: "x", finding: "f", status: "fixed", what_was_done: "w" }];
  if (sql.includes("GROUP BY status")) return [{ status: "runnable", specs: 40 }];
  if (sql.includes("derived_model_cycle_audit_coverage")) return [{ catalog_spec_id: "s", status: "runnable" }];
  if (sql.includes("derived_model_cycle_audit_record")) return [{ table_name: "runs", one_row_per: "run", columns: "x", landed_at_every_fold: true }];
  return [];
}

const lake: StudyLake = {
  async query<T>(sql: string): Promise<T[]> {
    executed.push(sql);
    return answer(sql) as T[];
  },
  async hasView(name) {
    return name.startsWith("derived_model_cycle_") && !missingViews.has(name);
  },
  async columns(name) {
    if (name.endsWith("_predictions")) return [...PREDICTION_COLUMNS];
    if (name.endsWith("_runs")) return ["recipe", "status", "model_label", "tick_size", "bars_per_year", "net_profit_usd", "sharpe_ratio", "trade_count", "accuracy", "started_at_timestamp"];
    return [];
  },
};

let server: Server;
let base = "";

beforeAll(async () => {
  const app = express();
  app.use("/api", createStudiesRouter([{ ...handler, cacheSeconds: 0 } as StudyHandler], lake));
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(() => {
  server.close();
});

async function get(query: string) {
  const response = await fetch(`${base}/studies/model-cycle-runs${query}`);
  return { status: response.status, body: await response.json() };
}

describe("model-cycle-runs handler", () => {
  it("lists the runs, every recipe with folds, the comparison and the audit", async () => {
    const { status, body } = await get("");
    expect(status).toBe(200);
    const data = (body.data as ModelCycleRunsBody).overview;
    expect(data?.runs).toHaveLength(1);
    // the run with a full record first, then the folds-only recipe
    expect(data?.recipes.map((option) => [option.recipe, option.status, option.hasFullRecord])).toEqual([[RECIPE, "complete", true], ["older", "folds only", false]]);
    expect(data?.recipes[0]).toMatchObject({ foldCount: 3, testBars: 5307, firstTest: 10, lastTest: 90 });
    expect(data?.defaultRecipe).toBe(RECIPE);
    expect(data?.comparison).toHaveLength(3);
    expect(data?.audit.findings).toHaveLength(1);
    expect(data?.audit.coverageByStatus).toEqual([{ status: "runnable", specs: 40 }]);
    expect(data?.audit.record[0]).toMatchObject({ table_name: "runs", landed_at_every_fold: true });
  });

  it("returns one recipe's panels with exact profiles and a thinned series", async () => {
    const { status, body } = await get(`?part=run&recipe=${RECIPE}&bins=10`);
    expect(status).toBe(200);
    const run = (body.data as ModelCycleRunsBody).run;
    expect(run?.recipe).toBe(RECIPE);
    expect(run?.record).toMatchObject({ net_profit_usd: 60.66, sharpe_ratio: 0.1056 });
    expect(run?.predictionSummary).toMatchObject({ count: 5, forecastCount: 4, resolvedForecastCount: 3, onGridFraction: 1, tickSize: 0.25 });
    expect(run?.equity).toHaveLength(5);
    expect(run?.barNetProfitUsd).toEqual([0, 10, 10, 10, 10]);
    expect(run?.forecastScatter).toEqual([{ move: 0.25, error: -1, forecast: 100.25, close: 100 }]);
    expect(run?.predictionProfile.map((profile) => profile.column)).toEqual(["probability_up", "forecast_error_points"]);
    const probability = run?.predictionProfile[0];
    expect(probability?.summary).toMatchObject({ count: 100, mean: 0.5, standardDeviation: 0.1, minimum: 0, maximum: 1 });
    expect(probability?.bins).toHaveLength(10);
    expect(probability?.bins[0]).toMatchObject({ lower: 0, count: 40 });
    expect(probability?.bins[9]).toMatchObject({ upper: 1, count: 60 });
    expect(run?.trades[0]).toMatchObject({ trade_number: 1, side: "long" });
    // the folds table keeps the notebook's columns and unpacks the parameter JSON
    expect(run?.folds[0]).toEqual({ fold_index: 0, status: "complete", train_bar_count: 10, parameters_used: "depth=4, rate=0.1", metrics: "{}" });
    expect(run?.metrics.filter((row) => row.kind === "trading")).toHaveLength(2);
    expect(run?.metrics.find((row) => row.fold_index === 0)?.note).toBe("reason");
    expect(run?.barsSummary).toEqual([{ role: "processed", bars: 5, first_bar: 1000, last_bar: 5000, roll_adjusted_bars: 0 }]);
  });

  it("opens the newest run with predictions when no recipe is asked for", async () => {
    const { body } = await get("?part=run");
    expect((body.data as ModelCycleRunsBody).run?.recipe).toBe(RECIPE);
  });

  it("says why a panel is empty and which view is missing instead of failing", async () => {
    missingViews.add("derived_model_cycle_runs_epochs");
    missingViews.add("derived_model_cycle_runs_model_metrics");
    missingViews.add("derived_model_cycle_runs_trading_metrics");
    try {
      const { status, body } = await get(`?part=run&recipe=${RECIPE}`);
      expect(status).toBe(200);
      const run = (body.data as ModelCycleRunsBody).run;
      expect(run?.epochs).toEqual([]);
      expect(run?.absent.epochs).toMatch(/No training epoch landed/);
      expect(run?.absent.metrics).toMatch(/back-fills/);
      expect(body.notes.join(" ")).toContain("derived_model_cycle_runs_epochs");
    } finally {
      missingViews.clear();
    }
  });

  it("refuses a recipe that is not a plain name and bad bins, before any SQL", async () => {
    const before = executed.length;
    expect((await get("?part=run&recipe=x'%20OR%201=1--")).status).toBe(400);
    expect((await get("?part=run&recipe=" + RECIPE + "&bins=500")).status).toBe(400);
    expect((await get("?part=everything")).status).toBe(400);
    expect(executed.length).toBe(before);
  });

  it("quotes the recipe, takes the bin count as a number and compares only the named metrics", () => {
    const sql = summarySql("it's", ["probability_up"]);
    expect(sql).toContain(`"recipe" = 'it''s'`);
    expect(histogramSql(RECIPE, ["probability_up"], 25)).toMatch(/\/ 25\)\) AS BIGINT\), 25 - 1\)/);
    const comparison = comparisonSql(["trading_metrics", "model_metrics"]);
    expect(comparison).toContain("UNION ALL");
    for (const name of COMPARISON_METRICS) expect(comparison).toContain(`'${name}'`);
    expect(modelCycleRunsQuery.parse({}).bins).toBe(40);
  });
});

describe("pure computations", () => {
  it("labels scopes as the notebook did (folds counted from 1)", () => {
    expect(scopeLabel("run", null)).toBe("run");
    expect(scopeLabel("fold", 0)).toBe("fold 1");
    expect(scopeLabel("fold", 2)).toBe("fold 3");
  });

  it("pivots whole-scope metric rows to one row per metric and one column per scope, run first", () => {
    const rows: MetricRow[] = [
      { kind: "trading", scope: "fold", fold_index: 1, metric_family: "returns", metric_name: "net_profit_usd", metric_label: "Net profit", metric_value: 5, unit: "usd", better: "higher", sample_count: 10, note: null, definition: "d", formula: "f", metric_order: 2 },
      { kind: "trading", scope: "run", fold_index: null, metric_family: "returns", metric_name: "net_profit_usd", metric_label: "Net profit", metric_value: 9, unit: "usd", better: "higher", sample_count: 30, note: null, definition: "d", formula: "f", metric_order: 2 },
      { kind: "trading", scope: "fold", fold_index: 0, metric_family: "returns", metric_name: "net_profit_usd", metric_label: "Net profit", metric_value: null, unit: "usd", better: "higher", sample_count: 10, note: "no trade", definition: "d", formula: "f", metric_order: 2 },
      { kind: "trading", scope: "run", fold_index: null, metric_family: "costs", metric_name: "total_cost_usd", metric_label: "Cost", metric_value: 1, unit: "usd", better: "lower", sample_count: 30, note: null, definition: "d", formula: "f", metric_order: 1 },
      { kind: "model", scope: "run", fold_index: null, metric_family: "classification", metric_name: "accuracy", metric_label: "Accuracy", metric_value: 0.5, unit: "probability", better: "higher", sample_count: 30, note: null, definition: "d", formula: "f", metric_order: 0 },
    ];
    const trading = pivotMatrix(rows, "trading");
    expect(trading.scopes).toEqual(["run", "fold 1", "fold 2"]);
    expect(trading.rows.map((row) => row.metricName)).toEqual(["total_cost_usd", "net_profit_usd"]);
    expect(trading.rows[1]?.values).toEqual({ "run": 9, "fold 1": null, "fold 2": 5 });
    expect(trading.rows[1]?.notes["fold 1"]).toBe("no trade");
    expect(pivotMatrix(rows, "model").rows).toHaveLength(1);
  });

  it("widens the comparison per recipe, in the notebook's metric order, Sharpe descending with nulls last", () => {
    const table = comparisonWide([
      { recipe: "b", metric_name: "net_profit_usd", metric_value: 5 },
      { recipe: "a", metric_name: "sharpe_ratio", metric_value: 1 },
      { recipe: "a", metric_name: "net_profit_usd", metric_value: 3 },
      { recipe: "c", metric_name: "sharpe_ratio", metric_value: 2 },
    ]);
    expect(table.columns).toEqual(["recipe", "net_profit_usd", "sharpe_ratio"]);
    expect(table.rows.map((row) => row.recipe)).toEqual(["c", "a", "b"]);
    expect(table.rows[2]).toEqual({ recipe: "b", net_profit_usd: 5 });
  });

  it("thins at a fixed stride, keeping the first and last", () => {
    const values = Array.from({ length: 1001 }, (_, index) => index);
    const thinned = thin(values, 101);
    expect(thinned).toHaveLength(101);
    expect(thinned[0]).toBe(0);
    expect(thinned[100]).toBe(1000);
    expect(thinned[1]).toBe(10);
    expect(thin([1, 2, 3], 10)).toEqual([1, 2, 3]);
  });

  it("bins equal-width from minimum to maximum per group, the maximum in the last bin", () => {
    const bins = groupedBins([
      { value: 0, group: "long" }, { value: 10, group: "short" }, { value: 5, group: "long" }, { value: 10, group: "long" },
    ], 2, ["long", "short"]);
    expect(bins).toHaveLength(2);
    expect(bins[0]?.counts).toEqual({ long: 1, short: 0 });
    expect(bins[1]?.counts).toEqual({ long: 2, short: 1 });
    expect(bins[1]?.total).toBe(3);
    expect(groupedBins([{ value: 3, group: "long" }], 5, ["long"])).toHaveLength(1);
    expect(groupedBins([], 5, ["long"])).toEqual([]);
  });

  it("rebuilds histogram bins from sparse (bin, rows) pairs", () => {
    const bins = binsFromRows([{ lo: 0, hi: 10, bin: 0, rows: 3 }, { lo: 0, hi: 10, bin: 4, rows: 2 }], 5);
    expect(bins.map((bin) => bin.count)).toEqual([3, 0, 0, 0, 2]);
    expect(bins[4]).toMatchObject({ lower: 8, upper: 10 });
    expect(binsFromRows([{ lo: 7, hi: 7, bin: 0, rows: 4 }], 10)).toEqual([{ lower: 7, upper: 7, count: 4 }]);
    expect(binsFromRows([], 10)).toEqual([]);
  });

  it("computes the running Sharpe ratio with the sample standard deviation and the yearly scale", () => {
    const profits = [1, 3, 1, 3];
    const all = runningSharpe(profits, 100, 4);
    expect(all.mean).toBe(2);
    expect(all.standardDeviation).toBeCloseTo(Math.sqrt(4 / 3), 12);
    expect(all.sharpe).toBeCloseTo((2 / Math.sqrt(4 / 3)) * 10, 12);
    expect(runningSharpe(profits, 100, 1).sharpe).toBeNull();
    expect(runningSharpe([2, 2, 2], 100, 3).sharpe).toBeNull();
  });

  it("sums the expected calibration error as bar-weighted absolute gaps of the run-scope bins", () => {
    const bin = (scope: string, number: number, bars: number, predicted: number, observed: number): CalibrationBin => ({
      scope, fold_index: scope === "run" ? null : 0, bin_number: number, probability_lower: 0, probability_upper: 1,
      scored_bar_count: bars, mean_probability_up: predicted, observed_up_fraction: observed, calibration_gap: observed - predicted,
    });
    const { terms, scoredBars, total } = calibrationTerms([bin("run", 2, 30, 0.6, 0.5), bin("run", 1, 10, 0.4, 0.5), bin("fold", 1, 99, 0.1, 0.9), bin("run", 3, 0, 0.5, 0.5)]);
    expect(scoredBars).toBe(40);
    expect(terms.map((term) => term.binNumber)).toEqual([1, 2]);
    expect(terms[0]?.term).toBeCloseTo((10 / 40) * 0.1, 12);
    expect(total).toBeCloseTo((10 / 40) * 0.1 + (30 / 40) * 0.1, 12);
    expect(terms[1]?.running).toBeCloseTo(total, 12);
  });

  it("unpacks fold parameters, shades cividis and tolerates bad JSON", () => {
    expect(parametersUsed('{"a":1,"b":"x","c":[1,2]}')).toBe("a=1, b=x, c=[1,2]");
    expect(parametersUsed("not json")).toBe("");
    expect(parametersUsed(null)).toBe("");
    expect(cividis(0)).toBe("rgb(0,32,77)");
    expect(cividis(1)).toBe("rgb(255,234,70)");
    expect(cividis(5)).toBe(cividis(1));
  });
});
