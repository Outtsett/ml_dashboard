/**
 * The multimodal-model study: the pure arithmetic it shares with its page
 * (gates, equity, quarters, histogram, profit-factor identity, deflated
 * Sharpe), the plan-directory parsers, and the handler against a fake lake:
 * scope choice, the canonical window, the holdout bound on every run-table
 * query, refusal of a gate_ recipe, per-section degradation, and the empty
 * body when nothing is landed.
 */

import { describe, expect, it } from "vitest";
import handler, { parseHoldoutStatus, parseTrialLedger } from "../../studies/handlers/multimodal-model";
import type { StudyContext, StudyLake } from "../../studies/types";
import {
  ablationMeans,
  bestTrialRecipe,
  binValues,
  breakevenWinRate,
  deflatedSharpeProbability,
  equityCurve,
  flattenSummary,
  gatePassedCount,
  headSummary,
  normalCdf,
  profitFactorFrom,
  quarterNet,
  sessionDate,
  trialLabel,
  winRateForProfitFactor,
  type TradeRow,
} from "@shared/studies/multimodal-model";

const RECIPE_A = "MNQ_5m_multimodal_fusion_bracket_meta_label_20260929T181434";
const RECIPE_B = "MNQ_5m_multimodal_fusion_bracket_meta_label_20260929T202613";

function summaryJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    session_count: 1066,
    trade_count: 2718,
    net_profit_points: -491.52,
    net_profit_usd: -983.04,
    sessions_traded_share: 1,
    trades_per_session: 2.55,
    forced_trade_share: 0.057,
    win_rate: 0.2627,
    average_win_points: 100.19,
    average_loss_points: 35.94,
    payoff_ratio: 2.7876,
    profit_factor: 0.9932,
    expectancy_points: -0.18,
    daily_sharpe_annualised: -0.067,
    maximum_drawdown_usd: 8013.78,
    bootstrap_total_points_lower_95: -7010.3,
    bootstrap_probability_profitable: 0.47,
    stressed_net_profit_usd: -3701,
    quarters_positive_share: 0.529,
    quarter_net_points: { "2021Q2": 249.87, "2021Q3": -962.77 },
    gate: { G1: false, G2: true, G3: false, G4: false, G5: false },
    ...overrides,
  });
}

function trade(overrides: Partial<TradeRow>): TradeRow {
  return {
    session: 18718,
    quarter: "2021Q2",
    head: "long_r3",
    forced: false,
    net_points: 10,
    probability: 0.3,
    expected_points: 4,
    stop_points: 20,
    target_points: 60,
    minutes_held: 12,
    ...overrides,
  };
}

describe("trial rows", () => {
  it("labels a recipe by its start time", () => {
    expect(trialLabel(RECIPE_A)).toBe("0929 18:14");
    expect(trialLabel("gate_holdout")).toBe("gate_holdout");
  });

  it("flattens a summary and counts the gates it passes", () => {
    const row = flattenSummary(RECIPE_A, "canonical_2021q2_2025q2", summaryJson(), { family: "gbdt", blocks: "time,price" });
    expect(row?.gate_passed_count).toBe(1);
    expect(row?.family).toBe("gbdt");
    expect(row?.profit_factor).toBe(0.9932);
    expect(row?.quarter_net_points["2021Q3"]).toBe(-962.77);
    expect(gatePassedCount({ G1: true, G2: true, G3: false })).toBe(2);
    expect(gatePassedCount(undefined)).toBe(0);
  });

  it("returns null for a summary that is not JSON and keeps unknown numbers null", () => {
    expect(flattenSummary(RECIPE_A, "x", "{not json")).toBeNull();
    const row = flattenSummary(RECIPE_A, "x", JSON.stringify({ win_rate: "n/a", gate: {} }));
    expect(row?.win_rate).toBeNull();
    expect(row?.gate_passed_count).toBe(0);
  });

  it("picks the highest profit factor, null last", () => {
    const a = flattenSummary(RECIPE_A, "x", summaryJson({ profit_factor: 0.95 }));
    const b = flattenSummary(RECIPE_B, "x", summaryJson({ profit_factor: 0.99 }));
    const c = flattenSummary("c", "x", summaryJson({ profit_factor: null }));
    expect(bestTrialRecipe([a, c, b].filter((row) => row !== null))).toBe(RECIPE_B);
    expect(bestTrialRecipe([])).toBeNull();
  });
});

describe("trade roll-ups", () => {
  const trades = [
    trade({ session: 18718, quarter: "2021Q2", net_points: -30 }),
    trade({ session: 18718, quarter: "2021Q2", net_points: 60, head: "short_r2", forced: true }),
    trade({ session: 18722, quarter: "2021Q2", net_points: 10 }),
    trade({ session: 18900, quarter: "2021Q3", net_points: -5 }),
  ];

  it("dates a session counted in epoch days", () => {
    expect(sessionDate(18718)).toBe("2021-04-01");
  });

  it("sums net USD per session and accumulates it", () => {
    const curve = equityCurve(trades, 2);
    expect(curve.map((point) => point.netUsd)).toEqual([60, 20, -10]);
    expect(curve.map((point) => point.cumulativeNetUsd)).toEqual([60, 80, 70]);
    expect(curve[0]?.tradeCount).toBe(2);
  });

  it("rolls trades up by quarter and by head", () => {
    expect(quarterNet(trades, 2)).toEqual([
      { quarter: "2021Q2", netPoints: 40, netUsd: 80, tradeCount: 3 },
      { quarter: "2021Q3", netPoints: -5, netUsd: -10, tradeCount: 1 },
    ]);
    const heads = headSummary(trades);
    const long = heads.find((row) => row.head === "long_r3");
    expect(long?.tradeCount).toBe(3);
    expect(long?.winRate).toBeCloseTo(1 / 3, 10);
    expect(heads.find((row) => row.head === "short_r2")?.forcedShare).toBe(1);
  });

  it("bins the full range with no trimming", () => {
    const bins = binValues([-10, -5, 0, 5, 10], 4);
    expect(bins).toHaveLength(4);
    expect(bins.reduce((sum, bin) => sum + bin.count, 0)).toBe(5);
    expect(bins[0]?.lower).toBe(-10);
    expect(bins[3]?.upper).toBe(10);
    expect(binValues([], 10)).toEqual([]);
    expect(binValues([3, 3], 10)).toHaveLength(1);
  });
});

describe("the arithmetic behind G3 and G4", () => {
  it("reproduces the profit factor the lake landed from win rate and payoff", () => {
    // The 2026-09-29 20:26 trial: win rate 0.26269, payoff 2.78757, landed profit factor 0.99318.
    const factor = profitFactorFrom(0.26269315673289184, 2.7875699920976897);
    expect(factor).toBeCloseTo(0.9931761349090571, 3);
  });

  it("puts PF 2 at a 40% win rate for a 3:1 payoff and 50% for 2:1", () => {
    expect(winRateForProfitFactor(3, 2)).toBeCloseTo(0.4, 10);
    expect(winRateForProfitFactor(2, 2)).toBeCloseTo(0.5, 10);
    expect(breakevenWinRate(3)).toBeCloseTo(0.25, 10);
    expect(profitFactorFrom(1, 2)).toBeNull();
  });

  it("recomputes the landed deflated Sharpe probability from its stored inputs", () => {
    const value = deflatedSharpeProbability(-0.020738051940523344, 0.027984515419502465, 1095, 1.3050819243298621, 6.234372489976202);
    expect(value).toBeCloseTo(0.05594884316943319, 4);
    expect(deflatedSharpeProbability(0.1, 0.02, 1, 0, 3)).toBeNull();
    expect(normalCdf(0)).toBeCloseTo(0.5, 7);
    expect(normalCdf(1.959963984540054)).toBeCloseTo(0.975, 6);
  });

  it("averages the ablation per block and head", () => {
    const means = ablationMeans([
      { fold: "2021Q2", head: "long_r2", modality: "price", auc_full: 0.55, auc_without: 0.54, auc_drop: 0.01 },
      { fold: "2021Q3", head: "long_r2", modality: "price", auc_full: 0.55, auc_without: 0.56, auc_drop: -0.01 },
      { fold: "2021Q2", head: "long_r2", modality: "flow", auc_full: 0.55, auc_without: 0.5, auc_drop: 0.05 },
    ]);
    expect(means).toEqual([
      { modality: "flow", head: "long_r2", meanAucDrop: 0.05, foldCount: 1 },
      { modality: "price", head: "long_r2", meanAucDrop: 0, foldCount: 2 },
    ]);
  });
});

describe("the plan directory", () => {
  it("reads family and blocks from the ledger, keyed by the lake's recipe spelling", () => {
    const ledger = [
      JSON.stringify({ model_id: "MNQ_5m_multimodal_fusion+bracket_meta_label_20260929T181434", configuration: { family: "gbdt", blocks: "time,price" } }),
      "",
      "{broken",
      JSON.stringify({ model_id: "other", configuration: {} }),
    ].join("\n");
    const { configurations, lines } = parseTrialLedger(ledger);
    expect(lines).toBe(3);
    expect(configurations.get(RECIPE_A)).toEqual({ family: "gbdt", blocks: "time,price" });
    expect(configurations.get("other")).toEqual({ family: null, blocks: null });
  });

  it("reads only the look counters and the phase of state.json", () => {
    const status = parseHoldoutStatus(
      JSON.stringify({ phase: "P5", step: "loop", last_checkpoint: "CP-010", holdout: { looks: 0, look_budget: 1 }, forward: { looks: 0, look_budget: 1 }, secret: "x" }),
      9,
    );
    expect(status).toEqual({ looks: 0, lookBudget: 1, forwardLooks: 0, forwardLookBudget: 1, phase: "P5", step: "loop", lastCheckpoint: "CP-010", ledgerLines: 9 });
    expect(parseHoldoutStatus(null, null).looks).toBeNull();
    expect(parseHoldoutStatus("{oops", 2).ledgerLines).toBe(2);
  });
});

// ── the handler, against a fake lake ──────────────────────────────────────

interface FakeLakeOptions {
  views?: string[];
  gateRows?: Array<{ recipe: string; scope: string; summary_json: string }>;
  failOn?: string;
}

const ALL_VIEWS = [
  "derived_multimodal_runs_summary",
  "derived_multimodal_runs_trades",
  "derived_multimodal_runs_predictions",
  "derived_multimodal_runs_importance",
  "derived_multimodal_runs_folds",
  "derived_multimodal_runs_policies",
  "derived_multimodal_labels_base_rates",
  "derived_multimodal_notebook_audit_notebooks",
  "derived_multimodal_notebook_audit_edge_verdicts",
  "derived_multimodal_overfitting_summary",
  "derived_multimodal_overfitting_trials",
];

function fakeLake(options: FakeLakeOptions = {}): { lake: StudyLake; sql: string[] } {
  const sql: string[] = [];
  const views = new Set(options.views ?? ALL_VIEWS);
  const lake: StudyLake = {
    async query<T>(statement: string): Promise<T[]> {
      sql.push(statement);
      if (options.failOn && statement.includes(options.failOn)) throw new Error("fake failure");
      if (statement.includes("rank_in_recipe")) {
        return [
          { recipe: RECIPE_A, scope: "canonical_2021q2_2025q2", summary_json: summaryJson({ profit_factor: 0.95 }) },
          { recipe: RECIPE_B, scope: "canonical_2021q2_2025q2", summary_json: summaryJson({ profit_factor: 0.993 }) },
        ] as T[];
      }
      if (statement.includes("starts_with(recipe, 'gate_') ORDER BY")) return (options.gateRows ?? []) as T[];
      if (statement.includes("FROM \"derived_multimodal_runs_trades\"")) return [trade({}), trade({ session: 18722, net_points: -12 })] as T[];
      if (statement.includes("UNION ALL")) return [{ head: "long_r2", decile: 0, predicted_probability: 0.27, realised_win_rate: 0.31, mean_net_points: -1.5, row_count: 7020 }] as T[];
      if (statement.includes("count(*) AS row_count")) return [{ row_count: 100 }] as T[];
      if (statement.includes("auc_drop")) return [{ fold: "2021Q2", head: "long_r2", modality: "price", auc_full: 0.55, auc_without: 0.54, auc_drop: 0.01 }] as T[];
      if (statement.includes("derived_multimodal_overfitting_summary")) {
        return [{ summary_json: JSON.stringify({ sessions: 1095, trials: 6, deflated_sharpe_probability: 0.056, pbo: 0.55 }) }] as T[];
      }
      if (statement.includes("derived_multimodal_overfitting_trials")) return [{ trial: RECIPE_A, daily_sharpe: -0.02, annualised_sharpe: -0.3, net_points: -1500 }] as T[];
      if (statement.includes("derived_multimodal_labels_base_rates")) return [{ breakdown: "all", recipe: "bracket_atr1_r2_r3_v1", side: 1, reward_multiple: 2 }] as T[];
      return [];
    },
    async hasView(name) {
      return views.has(name);
    },
    async columns() {
      return [];
    },
  };
  return { lake, sql };
}

function context(lake: StudyLake): StudyContext {
  return { lake, notes: [] };
}

describe("multimodal-model handler", () => {
  it("parses its query: a recipe-shaped trial and one of two windows", () => {
    expect(handler.query.parse({})).toEqual({ window: "canonical" });
    expect(handler.query.parse({ trial: RECIPE_A, window: "all" })).toEqual({ trial: RECIPE_A, window: "all" });
    expect(handler.query.safeParse({ trial: "x'; DROP TABLE t; --" }).success).toBe(false);
    expect(handler.query.safeParse({ window: "holdout" }).success).toBe(false);
  });

  it("lists every view it reads", () => {
    expect(handler.datasets).toEqual(ALL_VIEWS);
  });

  it("returns the trials, defaults to the highest profit factor and reads the canonical window", async () => {
    const { lake, sql } = fakeLake();
    const ctx = context(lake);
    const body = await handler.run({ window: "canonical" }, ctx);
    expect(body.trials.map((row) => row.recipe)).toEqual([RECIPE_A, RECIPE_B]);
    expect(body.selectedRecipe).toBe(RECIPE_B);
    expect(body.detail?.trades).toHaveLength(2);
    expect(body.detail?.calibration).toHaveLength(1);
    expect(body.detail?.ablationRows).toHaveLength(1);
    expect(body.gates).toEqual([]);
    expect(body.pointValueUsd).toBe(2);
    const tradeSql = sql.find((statement) => statement.includes("FROM \"derived_multimodal_runs_trades\""));
    expect(tradeSql).toContain(`recipe = '${RECIPE_B}'`);
    expect(tradeSql).toContain(`"quarter" >= '2021Q2'`);
  });

  it("bounds every run-table query at the last development quarter, in either window", async () => {
    for (const window of ["canonical", "all"] as const) {
      const { lake, sql } = fakeLake();
      await handler.run({ window, trial: RECIPE_A }, context(lake));
      const runQueries = sql.filter((statement) => /derived_multimodal_runs_(trades|predictions|importance|folds|policies)/.test(statement));
      expect(runQueries.length).toBeGreaterThanOrEqual(8);
      for (const statement of runQueries) expect(statement).toMatch(/"(quarter|fold)" <= '2025Q2'/);
      const tradeSql = runQueries.find((statement) => statement.includes("runs_trades"));
      if (window === "all") expect(tradeSql).not.toContain("2021Q2");
    }
  });

  it("refuses a gate_ recipe and an unknown trial, with a note, and shows the best one instead", async () => {
    const { lake } = fakeLake();
    const ctx = context(lake);
    const body = await handler.run({ window: "canonical", trial: "gate_holdout_look" }, ctx);
    expect(body.selectedRecipe).toBe(RECIPE_B);
    expect(ctx.notes.some((note) => note.includes("gate_holdout_look is not a development trial"))).toBe(true);
    const other = context(fakeLake().lake);
    const unknown = await handler.run({ window: "canonical", trial: "some_other_run" }, other);
    expect(unknown.selectedRecipe).toBe(RECIPE_B);
  });

  it("reads a landed gate record and parses it", async () => {
    const { lake } = fakeLake({ gateRows: [{ recipe: "gate_holdout", scope: "holdout_2025h2", summary_json: summaryJson() }] });
    const body = await handler.run({ window: "canonical" }, context(lake));
    expect(body.gates).toHaveLength(1);
    expect(body.gates[0]?.recipe).toBe("gate_holdout");
    expect((body.gates[0]?.summary.gate as Record<string, boolean>).G2).toBe(true);
  });

  it("answers an empty body and a note when the run record is not landed", async () => {
    const { lake, sql } = fakeLake({ views: [] });
    const ctx = context(lake);
    const body = await handler.run({ window: "canonical" }, ctx);
    expect(body.trials).toEqual([]);
    expect(body.detail).toBeNull();
    expect(body.selectedRecipe).toBeNull();
    expect(ctx.notes[0]).toContain("derived_multimodal_runs_summary");
    expect(sql).toEqual([]);
  });

  it("degrades one failing section to a note and keeps the rest", async () => {
    const { lake } = fakeLake({ failOn: "derived_multimodal_labels_base_rates" });
    const ctx = context(lake);
    const body = await handler.run({ window: "canonical" }, ctx);
    expect(body.baseRates).toEqual([]);
    expect(body.trials).toHaveLength(2);
    expect(body.detail?.trades).toHaveLength(2);
    expect(ctx.notes.some((note) => note.includes("The base rates could not be read"))).toBe(true);
  });

  it("skips the detail when a run table is missing but still serves the scoreboard", async () => {
    const { lake } = fakeLake({ views: ALL_VIEWS.filter((view) => view !== "derived_multimodal_runs_predictions") });
    const ctx = context(lake);
    const body = await handler.run({ window: "canonical" }, ctx);
    expect(body.trials).toHaveLength(2);
    expect(body.detail).toBeNull();
    expect(ctx.notes[0]).toContain("derived_multimodal_runs_predictions");
  });
});
