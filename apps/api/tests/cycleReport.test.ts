/**
 * Model Cycle metric tables read back from the lake (apps/api/training/cycleReport.ts):
 * lake columns become the wire keys of packages/shared/src/cycle/report.ts, bigints become
 * numbers, and a run with no tables yet reads as null. The lake is mocked.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  views: [] as string[],
  rows: {} as Record<string, Record<string, unknown>[]>,
  refreshes: 0,
  queries: [] as string[],
}));

vi.mock("../infrastructure/database/lake", () => ({
  derivedViews: () => state.views.map((viewName) => ({ viewName })),
  queryLake: async (sql: string) => {
    state.queries.push(sql);
    const table = /FROM derived_model_cycle_runs_(\w+)/.exec(sql)?.[1] ?? "";
    return state.rows[table] ?? [];
  },
  refreshDerivedViews: async () => {
    state.refreshes += 1;
    return [];
  },
}));

import { camelKey, loadCycleReport, REPORT_TABLES, wireRow } from "../training/cycleReport";

const MODEL_ID = "MNQ_5m_xgboost+walk_forward_cycle_20260927T094307";

function metricRow(name: string, value: number | null, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    model_id: MODEL_ID, recipe: "MNQ_5m_xgboost_walk_forward_cycle_20260927T094307", scope: "run", fold_index: null,
    segment_kind: "all", segment_value: "all", metric_family: "returns", metric_name: name, metric_label: "Net profit",
    metric_value: value, unit: "usd", better: "higher", sample_count: 2164n, note: value === null ? "no bars" : null,
    definition: "Profit after every cost.", formula: "sum of per-bar net profit", metric_order: 40n, ...extra,
  };
}

beforeEach(() => {
  state.views = REPORT_TABLES.map((table) => `derived_model_cycle_runs_${table}`);
  state.rows = {};
  state.refreshes = 0;
  state.queries = [];
});

describe("cycle report rows", () => {
  it("renames lake columns to wire keys", () => {
    expect(camelKey("metric_value")).toBe("value");
    expect(camelKey("percentile_25")).toBe("percentile25");
    expect(camelKey("intraday_maximum_drawdown_usd")).toBe("intradayMaximumDrawdownUsd");
    expect(wireRow({ model_id: "x", recipe: "y", sample_count: 12n, fold_index: null })).toEqual({ sampleCount: 12, foldIndex: null });
  });

  it("reads one run's tables into the wire shape, filtered by its recipe", async () => {
    state.rows.trading_metrics = [metricRow("net_profit_usd", -839.6)];
    state.rows.model_metrics = [metricRow("accuracy", 0.49, { metric_family: "classification", unit: "fraction" })];
    state.rows.distributions = [{
      model_id: MODEL_ID, scope: "fold", fold_index: 0n, quantity_name: "trade_net_profit_usd", quantity_label: "Trade net profit",
      unit: "usd", segment_value: "all trades", count: 115n, mean: -5.9, median: 2.1, standard_deviation: 60, skewness: -3.1,
      kurtosis: 20.4, percentile_25: -20, percentile_75: 25, minimum: -971.78, maximum: 409.72,
    }];
    const report = await loadCycleReport(MODEL_ID);
    expect(report).not.toBeNull();
    expect(report!.tradingMetrics[0]).toMatchObject({ name: "net_profit_usd", value: -839.6, sampleCount: 2164, order: 40, unit: "usd" });
    expect(report!.distributions[0]).toMatchObject({ foldIndex: 0, count: 115, percentile25: -20 });
    expect(state.queries.every((sql) => sql.includes("recipe = 'MNQ_5m_xgboost_walk_forward_cycle_20260927T094307'"))).toBe(true);
    expect(state.refreshes).toBe(0);
  });

  it("is null when the lake holds none of the run's tables", async () => {
    expect(await loadCycleReport(MODEL_ID)).toBeNull();
  });

  it("redefines the views once when a report view is missing, then reads what exists", async () => {
    state.views = ["derived_model_cycle_runs_trading_metrics"];
    state.rows.trading_metrics = [metricRow("net_profit_usd", null)];
    const report = await loadCycleReport(MODEL_ID);
    expect(state.refreshes).toBe(1);
    expect(report!.tradingMetrics[0]!.value).toBeNull();
    expect(report!.tradingMetrics[0]!.note).toBe("no bars");
    expect(report!.modelMetrics).toEqual([]);
  });
});
