/**
 * `packages/shared/src/runs`: the verdict rules and the run view built from a
 * Model Cycle snapshot. The numbers in `COLLAPSED` are a real recorded run
 * (MNQ 5m XGBoost, 2026-10-04): a model that called "up" on every bar.
 */
import { describe, it, expect } from "vitest";

import type { CycleLogLine, CycleSnapshot, CycleTrial } from "@shared/cycle/schema";
import { emptyBarColumns } from "@shared/cycle/schema";
import type { RunEpochPoint } from "@shared/runs/types";
import { COIN_FLIP_LOG_LOSS, foldCurves, headlineOf, judgeRun, type VerdictInput } from "@shared/runs/verdicts";
import { buildRunView, finalFitEpochs, logsAfter, tilesOf } from "@shared/runs/view";

const COLLAPSED: Record<string, number | null> = {
  net_profit_usd: -2191.34,
  sharpe_ratio: -2.4069,
  maximum_drawdown_usd: 5307.06,
  profit_factor: 0.349,
  win_rate: 0.3333,
  trade_count: 3,
  exposure_fraction: 0.9995,
  gross_profit_usd: 1175.22,
  total_cost_usd: 8.34,
  accuracy: 0.50328,
  balanced_accuracy: 0.5,
  recall: 1,
  roc_auc: 0.48007,
  log_loss: 0.69628,
  brier_score: 0.25156,
  majority_class_accuracy: 0.50328,
  buy_and_hold_net_profit_usd: -2068.34,
  price_forecast_mean_absolute_error_points: 33.5211,
  persistence_mean_absolute_error_points: 33.4411,
  price_forecast_skill: -0.00239,
};

const HEALTHY: Record<string, number | null> = {
  net_profit_usd: 4200,
  sharpe_ratio: 1.4,
  maximum_drawdown_usd: 900,
  trade_count: 180,
  exposure_fraction: 0.42,
  gross_profit_usd: 9000,
  total_cost_usd: 500,
  accuracy: 0.56,
  balanced_accuracy: 0.555,
  recall: 0.58,
  roc_auc: 0.59,
  log_loss: 0.672,
  brier_score: 0.24,
  majority_class_accuracy: 0.51,
  buy_and_hold_net_profit_usd: 1100,
  price_forecast_skill: 0.03,
};

function input(overrides: Partial<VerdictInput>): VerdictInput {
  return { status: "complete", error: null, metrics: {}, epochs: [], trials: [], folds: [], ...overrides };
}

function rules(verdicts: ReturnType<typeof judgeRun>): string[] {
  return verdicts.map((verdict) => verdict.rule);
}

function curve(foldIndex: number, validation: number[], train: number[]): RunEpochPoint[] {
  return validation.map((validationLoss, step) => ({
    foldIndex,
    modelRole: "direction" as const,
    step,
    trainLoss: train[step]!,
    validationLoss,
    validationAccuracy: null,
  }));
}

function trial(foldIndex: number, number: number, objectiveValue: number): CycleTrial {
  return {
    trial: number,
    trialCount: 20,
    state: "complete",
    parameters: {},
    objectiveName: "sharpe_ratio",
    objectiveValue,
    bestValue: objectiveValue,
    bestTrial: number,
    foldIndex,
  } as CycleTrial;
}

describe("judgeRun", () => {
  it("names a model that calls one direction on every bar, with the numbers", () => {
    const verdicts = judgeRun(input({ metrics: COLLAPSED }));
    const found = verdicts.find((verdict) => verdict.rule === "one_direction");
    expect(found?.severity).toBe("critical");
    expect(found?.title).toContain('"up"');
    expect(found?.evidence).toContain("Recall 100.0%");
    expect(found?.evidence).toContain("50.3%");
  });

  it("flags every failure the recorded run has and none of the passes", () => {
    const found = rules(judgeRun(input({ metrics: COLLAPSED })));
    expect(found).toEqual(
      expect.arrayContaining([
        "one_direction",
        "no_ranking_skill",
        "probabilities_worse_than_coin_flip",
        "price_forecast_loses_to_last_close",
        "too_few_trades",
        "always_in_market",
        "lost_money",
      ]),
    );
    expect(found).not.toContain("accuracy_edge");
    expect(found).not.toContain("beat_buy_and_hold");
  });

  it("passes a run with an edge and enough trades", () => {
    const verdicts = judgeRun(input({ metrics: HEALTHY }));
    expect(verdicts.every((verdict) => verdict.severity === "pass")).toBe(true);
    expect(rules(verdicts)).toEqual(
      expect.arrayContaining(["accuracy_edge", "ranking_skill", "price_forecast_beats_last_close", "beat_buy_and_hold"]),
    );
  });

  it("puts critical findings first, then warnings, then passes", () => {
    const order = judgeRun(input({ metrics: COLLAPSED })).map((verdict) => verdict.severity);
    const rank = { critical: 0, warning: 1, pass: 2 } as const;
    expect(order).toEqual([...order].sort((a, b) => rank[a] - rank[b]));
  });

  it("reports a failed run with its error", () => {
    const verdicts = judgeRun(input({ status: "failed", error: "CUDA out of memory" }));
    expect(verdicts[0]).toMatchObject({ rule: "run_failed", severity: "critical", evidence: "CUDA out of memory" });
  });

  it("does not call a profitable run on few trades a pass", () => {
    const found = rules(judgeRun(input({ metrics: { ...HEALTHY, trade_count: 12 } })));
    expect(found).toContain("too_few_trades");
    expect(found).not.toContain("beat_buy_and_hold");
  });

  it("flags a Sharpe ratio too high to take on trust", () => {
    expect(rules(judgeRun(input({ metrics: { ...HEALTHY, sharpe_ratio: 4.2 } })))).toContain("too_good");
  });

  it("flags costs above half of gross profit", () => {
    expect(rules(judgeRun(input({ metrics: { ...HEALTHY, total_cost_usd: 5000 } })))).toContain("costs_eat_the_edge");
  });

  it("says nothing about a metric the run did not report", () => {
    expect(judgeRun(input({ metrics: {} }))).toEqual([]);
  });
});

describe("learning verdicts", () => {
  it("reads overfitting off a validation loss that turns up while training loss falls", () => {
    const epochs = curve(0, [0.69, 0.66, 0.65, 0.67, 0.7], [0.69, 0.6, 0.5, 0.4, 0.3]);
    const verdicts = judgeRun(input({ epochs }));
    const found = verdicts.find((verdict) => verdict.rule === "overfitting");
    expect(found?.severity).toBe("warning");
    expect(found?.evidence).toContain("bottomed at 0.650 on step 2");
    expect(found?.evidence).toContain("ended at 0.700 on step 4");
  });

  it("is critical when validation loss never gets under a coin flip", () => {
    const epochs = curve(0, [0.72, 0.71, 0.7], [0.69, 0.66, 0.6]);
    expect(rules(judgeRun(input({ epochs })))).toContain("validation_never_beat_coin_flip");
    expect(0.7).toBeGreaterThan(COIN_FLIP_LOG_LOSS);
  });

  it("passes a curve that falls below a coin flip and stays down", () => {
    const epochs = curve(0, [0.69, 0.67, 0.66, 0.655], [0.69, 0.66, 0.64, 0.63]);
    expect(rules(judgeRun(input({ epochs })))).toEqual(["learning_ok"]);
  });

  it("builds one curve per fold from unordered points", () => {
    const epochs = [...curve(1, [0.6, 0.5], [0.6, 0.4]), ...curve(0, [0.7, 0.65, 0.68], [0.7, 0.6, 0.5])].reverse();
    const curves = foldCurves(epochs, "direction");
    expect(curves.map((entry) => entry.foldIndex)).toEqual([0, 1]);
    expect(curves[0]).toMatchObject({ bestStep: 1, bestValidationLoss: 0.65, lastStep: 2, lastValidationLoss: 0.68 });
  });
});

describe("tuning and fold verdicts", () => {
  it("is critical when no trial in a fold has a positive Sharpe ratio", () => {
    const trials = [trial(0, 0, -1.2), trial(0, 1, -0.4), trial(1, 0, 0.8), trial(1, 1, 1.5)];
    const found = judgeRun(input({ trials })).find((verdict) => verdict.rule === "search_found_nothing_profitable");
    expect(found?.title).toContain("1 of 2 folds");
    expect(found?.evidence).toContain("-0.40, 1.50");
  });

  it("keys trials by fold: trial numbers restart in every fold", () => {
    const trials = [trial(0, 0, 0.5), trial(0, 1, 0.9), trial(1, 0, 2.1), trial(1, 1, 1.1)];
    const found = judgeRun(input({ trials })).find((verdict) => verdict.rule === "search_found_profitable_settings");
    expect(found?.evidence).toContain("0.90, 2.10");
  });

  it("calls a result carried by one window unstable", () => {
    const folds = [
      { foldIndex: 0, metrics: { net_profit_usd: -2086 } },
      { foldIndex: 1, metrics: { net_profit_usd: -1281 } },
      { foldIndex: 2, metrics: { net_profit_usd: 1175 } },
    ];
    const found = judgeRun(input({ folds })).find((verdict) => verdict.rule === "unstable_across_folds");
    expect(found?.title).toContain("1 of 3");
    expect(found?.evidence).toBe("Net profit per fold: -$2,086, -$1,281, $1,175.");
  });
});

describe("headlineOf", () => {
  it("leads with the critical count", () => {
    const headline = headlineOf("complete", judgeRun(input({ metrics: COLLAPSED })));
    expect(headline.tone).toBe("critical");
    expect(headline.text).toMatch(/^Do not trade this: \d+ critical findings/);
  });

  it("says so far while the run is live", () => {
    expect(headlineOf("running", judgeRun(input({ status: "running", metrics: COLLAPSED }))).text).toContain("so far");
  });

  it("is pending before any number arrives", () => {
    expect(headlineOf("running", [])).toMatchObject({ tone: "pending" });
  });
});

// ─── the view ───────────────────────────────────────────────────────────────

function line(receivedAt: number, seq: number | null, message = "line"): CycleLogLine {
  return { receivedAt, seq, level: "info", message };
}

function snapshot(overrides: Partial<CycleSnapshot>): CycleSnapshot {
  return {
    modelId: "MNQ_5m_xgboost+walk_forward_cycle_20261004T231807",
    modelType: "xgboost+walk_forward_cycle",
    status: "complete",
    startedAt: 1_000,
    finishedAt: 2_000,
    error: null,
    lastSequence: 10,
    plan: null,
    cursor: null,
    bars: emptyBarColumns(),
    trades: [],
    scoreboards: { running: null, folds: [], final: null },
    epochs: [],
    trials: [],
    parameters: [],
    logs: [],
    ...overrides,
  };
}

describe("logsAfter", () => {
  const logs = [line(100, 1), line(100, 2), line(101, 3), line(102, null), line(103, 4)];

  it("sends the tail to a client with no place", () => {
    expect(logsAfter(logs, null)).toEqual({ lines: logs, reset: true });
  });

  it("sends only the lines after the client's last one", () => {
    expect(logsAfter(logs, { receivedAt: 101, seq: 3 })).toEqual({ lines: logs.slice(3), reset: false });
  });

  it("tells two lines of the same millisecond apart by sequence", () => {
    expect(logsAfter(logs, { receivedAt: 100, seq: 1 }).lines).toHaveLength(4);
  });

  it("finds a line with no sequence (a stderr line)", () => {
    expect(logsAfter(logs, { receivedAt: 102, seq: null })).toEqual({ lines: logs.slice(4), reset: false });
  });

  it("sends nothing new to a client that is up to date", () => {
    expect(logsAfter(logs, { receivedAt: 103, seq: 4 })).toEqual({ lines: [], reset: false });
  });

  it("resets a client whose last line has left the buffer", () => {
    expect(logsAfter(logs, { receivedAt: 50, seq: 0 })).toEqual({ lines: logs, reset: true });
  });
});

describe("tilesOf", () => {
  it("sets accuracy against the majority-class share of the same run", () => {
    const accuracy = tilesOf(COLLAPSED).find((tile) => tile.name === "accuracy");
    expect(accuracy?.baseline).toEqual({ value: 0.50328, label: "always the common direction" });
  });

  it("leaves out a metric the run did not report", () => {
    expect(tilesOf({ sharpe_ratio: 1 }).map((tile) => tile.name)).toEqual(["sharpe_ratio"]);
  });
});

describe("buildRunView", () => {
  it("keeps a fold's final fit and drops its tuning trials' curves", () => {
    const base = { epochCount: 400, stepUnit: "boosting_round", trainLoss: 0.6, validationLoss: 0.7, validationAccuracy: 0.5, validationF1Score: null, learningRate: null, gradientNorm: null, isBest: false, secondsElapsed: 1 };
    const epochs = [
      { ...base, foldIndex: 0, trial: 3, epoch: 10, modelRole: "direction" },
      { ...base, foldIndex: 0, trial: null, epoch: 10, modelRole: "direction" },
      { ...base, foldIndex: 0, trial: null, epoch: 20, modelRole: "price" },
    ] as CycleSnapshot["epochs"];
    const points = finalFitEpochs({ epochs });
    expect(points).toHaveLength(2);
    expect(points.map((point) => point.modelRole)).toEqual(["direction", "price"]);
  });

  it("reads the final scoreboard when there is one and says which it read", () => {
    const board = (metrics: Record<string, number | null>) => ({
      scope: "final" as const,
      foldIndex: null,
      barsEvaluated: 5961,
      barsScored: 5796,
      metrics,
      tradeDistribution: { count: 0, mean: null, median: null, standardDeviation: null, skewness: null, kurtosis: null, percentile25: null, percentile75: null, minimum: null, maximum: null },
      notes: [],
    });
    const view = buildRunView(
      snapshot({ scoreboards: { running: { ...board({ sharpe_ratio: 9 }), scope: "running" }, folds: [], final: board(COLLAPSED) } }),
      null,
      null,
    );
    expect(view.scoreScope).toBe("final");
    expect(view.barsEvaluated).toBe(5961);
    expect(view.tiles.find((tile) => tile.name === "sharpe_ratio")?.value).toBeCloseTo(-2.4069);
    expect(view.verdicts.some((verdict) => verdict.rule === "one_direction")).toBe(true);
  });

  it("keeps only the run-scope rows of the report tables", () => {
    const view = buildRunView(
      snapshot({}),
      {
        calibrationBins: [
          { scope: "run", binNumber: 2, probabilityLower: 0.1, probabilityUpper: 0.2, scoredBarCount: 5, meanProbabilityUp: 0.15, observedUpFraction: 0.4 },
          { scope: "fold", binNumber: 1, probabilityLower: 0, probabilityUpper: 0.1, scoredBarCount: 9, meanProbabilityUp: 0.05, observedUpFraction: 0.1 },
          { scope: "run", binNumber: 1, probabilityLower: 0, probabilityUpper: 0.1, scoredBarCount: 0, meanProbabilityUp: null, observedUpFraction: null },
        ],
        confusionMatrix: [{ scope: "run", actualDirection: "up", predictedDirection: "up", barCount: 2917, shareOfScoredBars: 0.5033 }],
        dailyResults: [
          { sessionDay: "2025-10-30", foldIndex: 0, netProfitUsd: -10, cumulativeNetProfitUsd: -101, accuracy: 0.5, tradeCount: 0 },
          { sessionDay: "2025-10-29", foldIndex: 0, netProfitUsd: -91, cumulativeNetProfitUsd: -91, accuracy: 0.54, tradeCount: 0 },
        ],
      },
      null,
    );
    expect(view.calibration.map((bin) => bin.binNumber)).toEqual([1, 2]);
    expect(view.confusion).toHaveLength(1);
    expect(view.daily.map((row) => row.sessionDay)).toEqual(["2025-10-29", "2025-10-30"]);
  });

  it("carries a run with no plan and no scoreboard as an empty view, not an error", () => {
    const view = buildRunView(snapshot({ status: "running", finishedAt: null, logs: [line(1, 1)] }), null, null);
    expect(view).toMatchObject({ setup: null, progress: null, scoreScope: null, tiles: [], verdicts: [], logsReset: true });
    expect(view.logs).toHaveLength(1);
  });
});
