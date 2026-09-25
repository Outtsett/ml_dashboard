// @vitest-environment jsdom
/**
 * The five read-only Model Cycle panels (`src/client/src/cycle/{Terminal,
 * Scoreboard,Trades,Folds,Curves}.tsx`), all reading `useCycleStore`
 * directly. Every test seeds the store through `applyEvent` with realistic
 * envelope-shaped payloads (mirroring what `src/ml/shared/protocol.py`'s
 * `emit_cycle_*` functions actually send) and resets it in `beforeEach`.
 */
import "./setup";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CycleCurves } from "../../src/client/src/cycle/Curves";
import { CycleFolds } from "../../src/client/src/cycle/Folds";
import { categorizeLogLine, CycleTerminal } from "../../src/client/src/cycle/Terminal";
import { CycleScoreboard } from "../../src/client/src/cycle/Scoreboard";
import { CycleTrades } from "../../src/client/src/cycle/Trades";
import { useCycleStore } from "../../src/client/src/cycle/store";
import type {
  CycleDistribution,
  CycleEpoch,
  CycleFoldPlan,
  CyclePlan,
  CycleScoreboard as CycleScoreboardPayload,
  CycleTrade,
  CycleTrial,
} from "../../src/shared/cycle/schema";

afterEach(() => cleanup());

beforeEach(() => {
  useCycleStore.getState().reset();
  useCycleStore.setState({ follow: true, showOnChart: true, focusTimestamp: null });
});

// ─── Fixture builders ───────────────────────────────────────────────────────

const DAY = 86_400;
const T0 = 1_735_700_000;

function emptyDistribution(overrides: Partial<CycleDistribution> = {}): CycleDistribution {
  return {
    count: 0,
    mean: null,
    median: null,
    standardDeviation: null,
    skewness: null,
    kurtosis: null,
    percentile25: null,
    percentile75: null,
    minimum: null,
    maximum: null,
    ...overrides,
  };
}

function scoreboard(overrides: Partial<CycleScoreboardPayload> & Pick<CycleScoreboardPayload, "scope">): CycleScoreboardPayload {
  return {
    foldIndex: null,
    barsEvaluated: 100,
    barsScored: 95,
    metrics: {},
    tradeDistribution: emptyDistribution(),
    notes: [],
    ...overrides,
  };
}

function trade(overrides: Partial<CycleTrade> & Pick<CycleTrade, "tradeNumber">): CycleTrade {
  return {
    foldIndex: 0,
    side: "long",
    status: "closed",
    contracts: 1,
    entryTimestamp: T0,
    entryPrice: 21000,
    exitTimestamp: T0 + 900,
    exitPrice: 21010,
    barsHeld: 3,
    probabilityUpAtEntry: 0.6,
    grossProfitUsd: 20,
    costUsd: 2.8,
    netProfitUsd: 17.2,
    exitReason: "holding_period",
    ...overrides,
  };
}

function foldPlan(overrides: Partial<CycleFoldPlan> & Pick<CycleFoldPlan, "foldIndex">): CycleFoldPlan {
  const base = overrides.foldIndex * 20 * DAY;
  return {
    trainStart: T0 + base,
    trainEnd: T0 + base + 10 * DAY,
    validationStart: T0 + base + 10 * DAY,
    validationEnd: T0 + base + 14 * DAY,
    testStart: T0 + base + 14 * DAY,
    testEnd: T0 + base + 20 * DAY,
    trainBarCount: 2000,
    validationBarCount: 400,
    testBarCount: 800,
    ...overrides,
  };
}

function plan(overrides: Partial<CyclePlan> = {}): CyclePlan {
  return {
    symbol: "MNQ",
    timeframe: "5m",
    modelFamily: "xgboost",
    modelLabel: "XGBoost",
    parameters: {},
    device: "cpu",
    deviceName: null,
    dataStart: T0,
    dataEnd: T0 + 40 * DAY,
    barCount: 10000,
    barsPerYear: 70_000,
    featureNames: ["return_1"],
    labelHorizonBars: 6,
    labelThresholdTicks: 0,
    purgeBars: 6,
    embargoBars: 0,
    costModel: { tickSize: 0.25, tickValueUsd: 0.5, pointValueUsd: 2, costPerSideUsd: 1.4, roundTripCostUsd: 2.8, source: "cost_model.json" },
    trading: { entryProbability: 0.55, longOnly: false, holdingBars: 6, stopLossTicks: 0, takeProfitTicks: 0, contracts: 1 },
    tuning: null,
    folds: [foldPlan({ foldIndex: 0 }), foldPlan({ foldIndex: 1 })],
    barsPerSecond: 40,
    startPaused: false,
    artifactDirectory: "data/models/x",
    ...overrides,
  };
}

function epoch(overrides: Partial<CycleEpoch> & Pick<CycleEpoch, "epoch">): CycleEpoch {
  return {
    foldIndex: 0,
    trial: null,
    epochCount: 3,
    stepUnit: "epoch",
    trainLoss: 0.7 - overrides.epoch * 0.05,
    validationLoss: 0.72 - overrides.epoch * 0.04,
    validationAccuracy: 0.5 + overrides.epoch * 0.01,
    validationF1Score: 0.48 + overrides.epoch * 0.01,
    learningRate: 0.001,
    gradientNorm: 0.8,
    isBest: false,
    secondsElapsed: overrides.epoch * 2,
    ...overrides,
  };
}

function trial(overrides: Partial<CycleTrial> & Pick<CycleTrial, "trial">): CycleTrial {
  return {
    trialCount: 5,
    state: "complete",
    parameters: { learning_rate: 0.05 },
    objectiveName: "sharpe_ratio",
    objectiveValue: 1.0,
    bestValue: 1.0,
    bestTrial: 0,
    ...overrides,
  };
}

function apply(type: string, payload: unknown): void {
  useCycleStore.getState().applyEvent(type, payload);
}

// ─── Terminal ────────────────────────────────────────────────────────────────

describe("CycleTerminal", () => {
  const LINES: { message: string; level?: "info" | "warn" | "error" | "debug" }[] = [
    { message: "[data] loaded 5,000 bars from the lake" },
    { message: "[tune trial 3/20] running" },
    { message: "[fold 1/2][train] epoch 3/20 batch 120/412 loss=0.6912 lr=3.0e-04 grad_norm=0.84 samples/s=18432" },
    { message: "[fold 1/2][validate] epoch 3/20 val_loss=0.6930 val_accuracy=0.521 val_f1=0.498 best=0.6921@2 patience=1/5" },
    { message: "[fold 1/2][test] 2025-11-04 09:35 bar 1834/2760 close=21034.25 p_up=0.612 signal=LONG position=LONG equity=+$412.60" },
    { message: "[trade #41] ENTER LONG 1 @ 21034.25 2025-11-04 09:40 p_up=0.612" },
    { message: "[trade #41] EXIT LONG @ 21041.50 2025-11-04 09:55 bars=3 reason=holding_period gross=+$14.50 cost=$2.80 net=+$11.70" },
    { message: "[trade #42] ENTER SHORT 1 @ 21000.00 2025-11-04 10:00 p_up=0.42" },
    { message: "[control] paused" },
    { message: "[fold 1/2][validate] patience 4/5, close to early stop", level: "warn" },
    { message: "[data] lake connection reset, retrying", level: "error" },
  ];

  beforeEach(() => {
    for (const line of LINES) apply("log", { level: line.level ?? "info", message: line.message });
  });

  it("categorizes every prefix in the terminal log grammar", () => {
    expect(categorizeLogLine("[data] x")).toBe("data");
    expect(categorizeLogLine("[features] x")).toBe("data");
    expect(categorizeLogLine("[plan] x")).toBe("data");
    expect(categorizeLogLine("[device] x")).toBe("data");
    expect(categorizeLogLine("[tune] x")).toBe("tuning");
    expect(categorizeLogLine("[tune trial 3/20] x")).toBe("tuning");
    expect(categorizeLogLine("[fold 2/3][train] x")).toBe("training");
    expect(categorizeLogLine("[fold 2/3][validate] x")).toBe("validation");
    expect(categorizeLogLine("[fold 2/3][test] x")).toBe("testing");
    expect(categorizeLogLine("[trade #12] x")).toBe("trades");
    expect(categorizeLogLine("[control] x")).toBe("control");
    expect(categorizeLogLine("[save] x")).toBe("control");
    expect(categorizeLogLine("[done] x")).toBe("control");
    expect(categorizeLogLine("something else")).toBe("other");
  });

  it("shows every seeded line and the running total", () => {
    render(<CycleTerminal />);
    expect(screen.getAllByTestId("terminal-line")).toHaveLength(LINES.length);
    expect(screen.getByTestId("terminal-count").textContent).toBe(`showing ${LINES.length} of ${LINES.length}`);
  });

  it("filters to one category per chip", () => {
    render(<CycleTerminal />);
    fireEvent.click(screen.getByTestId("terminal-filter-training"));
    expect(screen.getAllByTestId("terminal-line")).toHaveLength(1);
    expect(screen.getByTestId("terminal-line").textContent).toContain("batch 120/412");

    fireEvent.click(screen.getByTestId("terminal-filter-trades"));
    expect(screen.getAllByTestId("terminal-line")).toHaveLength(3);

    fireEvent.click(screen.getByTestId("terminal-filter-warnings_errors"));
    const lines = screen.getAllByTestId("terminal-line");
    expect(lines).toHaveLength(2);
    expect(lines.map((el) => el.dataset.level).sort()).toEqual(["error", "warn"]);
    expect(screen.getByText("ERR")).toBeInTheDocument();
    expect(screen.getByText("WRN")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("terminal-filter-all"));
    expect(screen.getAllByTestId("terminal-line")).toHaveLength(LINES.length);
  });

  it("search narrows to lines containing the query, case-insensitively", () => {
    render(<CycleTerminal />);
    fireEvent.change(screen.getByTestId("terminal-search"), { target: { value: "21034" } });
    expect(screen.getAllByTestId("terminal-line")).toHaveLength(2);
    expect(screen.getByTestId("terminal-count").textContent).toBe(`showing 2 of ${LINES.length}`);
  });

  it("tints the trade side word with a glyph, long orange and short blue", () => {
    render(<CycleTerminal />);
    expect(screen.getAllByText("▲ LONG").length).toBeGreaterThan(0);
    expect(screen.getByText("▼ SHORT")).toBeInTheDocument();
  });
});

// ─── Scoreboard ──────────────────────────────────────────────────────────────

describe("CycleScoreboard", () => {
  beforeEach(() => {
    apply(
      "cycle_scoreboard",
      scoreboard({
        scope: "running",
        barsEvaluated: 200,
        barsScored: 190,
        metrics: { net_profit_usd: 80, accuracy: 0.55, majority_class_accuracy: 0.52, profit_factor: null },
      }),
    );
    apply(
      "cycle_scoreboard",
      scoreboard({
        scope: "fold",
        foldIndex: 0,
        barsEvaluated: 800,
        barsScored: 780,
        metrics: { net_profit_usd: 120, accuracy: 0.6, majority_class_accuracy: 0.5 },
      }),
    );
    apply(
      "cycle_scoreboard",
      scoreboard({
        scope: "final",
        barsEvaluated: 1600,
        barsScored: 1560,
        metrics: {
          net_profit_usd: 260.5,
          accuracy: 0.58,
          majority_class_accuracy: 0.52,
          buy_and_hold_net_profit_usd: -40,
          profit_factor: null,
        },
      }),
    );
  });

  it("defaults to the final scoreboard when one exists", () => {
    render(<CycleScoreboard />);
    expect(screen.getByTestId("metric-value-net_profit_usd").textContent).toBe("+$260.50");
  });

  it("renders — for a null metric with a tooltip explaining why", () => {
    render(<CycleScoreboard />);
    const tile = screen.getByTestId("metric-tile-profit_factor");
    expect(within(tile).getByTestId("metric-value-profit_factor").textContent).toBe("—");
    expect(tile.title).toContain("no losing trade has closed yet");
  });

  it("shows the baseline comparison in words and a glyph, never color alone", () => {
    render(<CycleScoreboard />);
    const comparison = screen.getByTestId("metric-comparison-accuracy");
    expect(comparison.textContent).toContain("▲");
    expect(comparison.textContent).toContain("6.0 points above always-predict-majority");
  });

  it("switching scope changes every tile to that scoreboard's values", () => {
    render(<CycleScoreboard />);
    fireEvent.click(screen.getByTestId("scoreboard-scope-running"));
    expect(screen.getByTestId("metric-value-net_profit_usd").textContent).toBe("+$80.00");
    expect(screen.getByTestId("scoreboard-coverage").textContent).toContain("200 bars evaluated / 190 bars scored");

    fireEvent.click(screen.getByTestId("scoreboard-scope-fold-0"));
    expect(screen.getByTestId("metric-value-net_profit_usd").textContent).toBe("+$120.00");
  });
});

// ─── Trades ──────────────────────────────────────────────────────────────────

describe("CycleTrades", () => {
  beforeEach(() => {
    apply("cycle_trade", trade({ tradeNumber: 1, side: "long", entryTimestamp: T0, netProfitUsd: 50, grossProfitUsd: 55, costUsd: 5 }));
    apply("cycle_trade", trade({ tradeNumber: 2, side: "short", entryTimestamp: T0 + 600, netProfitUsd: -20, grossProfitUsd: -15, costUsd: 5 }));
    apply(
      "cycle_trade",
      trade({ tradeNumber: 3, side: "long", status: "open", entryTimestamp: T0 + 1200, exitTimestamp: null, exitPrice: null, netProfitUsd: null, grossProfitUsd: null, costUsd: null, exitReason: null }),
    );
    apply("cycle_trade", trade({ tradeNumber: 4, side: "short", entryTimestamp: T0 + 1800, netProfitUsd: 30, grossProfitUsd: 35, costUsd: 5 }));
    apply(
      "cycle_scoreboard",
      scoreboard({
        scope: "final",
        tradeDistribution: emptyDistribution({ count: 3, mean: 20, median: 30, standardDeviation: 29.44, percentile25: -20, percentile75: 40, minimum: -20, maximum: 50 }),
      }),
    );
  });

  it("lists every trade newest-first with a glyph-and-word side badge", () => {
    render(<CycleTrades />);
    const rows = screen.getAllByTestId("trade-row");
    expect(rows).toHaveLength(4);
    expect(rows[0]!.dataset.tradeNumber).toBe("4");
    expect(screen.getAllByText("▲ Long").length).toBeGreaterThan(0);
    expect(screen.getAllByText("▼ Short").length).toBeGreaterThan(0);
  });

  it("filters to winning trades only", () => {
    render(<CycleTrades />);
    fireEvent.click(screen.getByTestId("trades-filter-winners"));
    const rows = screen.getAllByTestId("trade-row");
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.dataset.tradeNumber).sort()).toEqual(["1", "4"]);
  });

  it("clicking a row focuses the chart on that trade's entry timestamp", () => {
    render(<CycleTrades />);
    const rows = screen.getAllByTestId("trade-row");
    fireEvent.click(rows[0]!); // trade #4
    expect(useCycleStore.getState().focusTimestamp).toBe(T0 + 1800);
  });

  it("shows the eight-number summary from the scoreboard's tradeDistribution", () => {
    render(<CycleTrades />);
    expect(screen.getByTestId("trade-distribution-mean").textContent).toContain("+$20.00");
    expect(screen.getByTestId("trade-distribution-count").textContent).toContain("3");
  });

  it("shows the lake wall-clock time note", () => {
    render(<CycleTrades />);
    expect(screen.getByText(/Times as stored in the lake/)).toBeInTheDocument();
  });
});

// ─── Folds ───────────────────────────────────────────────────────────────────

describe("CycleFolds", () => {
  beforeEach(() => {
    apply("cycle_plan", plan());
    apply(
      "cycle_cursor",
      {
        phase: "testing",
        foldIndex: 1,
        foldCount: 2,
        spanStart: null,
        spanEnd: null,
        barTimestamp: T0 + 100,
        barIndex: 50,
        barCount: 800,
        epoch: null,
        epochCount: null,
        batch: null,
        batchCount: null,
        stepUnit: null,
        trial: null,
        trialCount: null,
        phaseFraction: 0.2,
        overallFraction: 0.6,
        barsPerSecond: 40,
        paused: false,
        elapsedSeconds: 30,
      },
    );
    apply(
      "cycle_scoreboard",
      scoreboard({ scope: "fold", foldIndex: 0, barsEvaluated: 800, barsScored: 780, metrics: { accuracy: 0.6, net_profit_usd: 140 } }),
    );
    apply(
      "cycle_scoreboard",
      scoreboard({ scope: "running", barsEvaluated: 160, barsScored: 150, metrics: { accuracy: 0.53, net_profit_usd: 25 } }),
    );
    apply("cycle_scoreboard", scoreboard({ scope: "final", metrics: { net_profit_usd: 165, accuracy: 0.57 } }));
  });

  it("joins the plan with each fold's finished scoreboard, and shows the in-progress fold live", () => {
    render(<CycleFolds />);
    const rows = screen.getAllByTestId("fold-row");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByTestId("fold-status").dataset.status).toBe("done");
    expect(within(rows[0]!).getByTestId("fold-0-net_profit_usd").textContent).toContain("+$140.00");

    expect(within(rows[1]!).getByTestId("fold-status").dataset.status).toBe("testing");
    expect(within(rows[1]!).getByTestId("fold-1-net_profit_usd").textContent).toContain("+$25.00");
    expect(within(rows[1]!).getByTestId("fold-1-net_profit_usd").textContent).toContain("(live)");
  });

  it("clicking a row focuses the chart on that fold's test start", () => {
    render(<CycleFolds />);
    fireEvent.click(screen.getAllByTestId("fold-row")[0]!);
    expect(useCycleStore.getState().focusTimestamp).toBe(plan().folds[0]!.testStart);
  });

  it("shows the final scoreboard in the totals row", () => {
    render(<CycleFolds />);
    expect(screen.getByTestId("fold-totals-net_profit_usd").textContent).toContain("+$165.00");
  });
});

// ─── Curves ──────────────────────────────────────────────────────────────────

describe("CycleCurves", () => {
  beforeEach(() => {
    apply("cycle_epoch", epoch({ epoch: 1 }));
    apply("cycle_epoch", epoch({ epoch: 2, isBest: true }));
    apply("cycle_epoch", epoch({ epoch: 3 }));
  });

  it("renders loss curves for the fold with recorded epochs", () => {
    render(<CycleCurves />);
    expect(screen.getByTestId("curves-loss-chart")).toBeInTheDocument();
    expect(screen.getByTestId("curves-accuracy-chart")).toBeInTheDocument();
  });

  it("shows no tuning section until trials exist, then shows the scatter and table", () => {
    render(<CycleCurves />);
    expect(screen.queryByTestId("curves-tuning-scatter")).not.toBeInTheDocument();

    act(() => {
      apply("cycle_trial", trial({ trial: 0, state: "complete", objectiveValue: 0.8, bestTrial: 1 }));
      apply("cycle_trial", trial({ trial: 1, state: "complete", objectiveValue: 1.4, bestTrial: 1 }));
      apply("cycle_trial", trial({ trial: 2, state: "pruned", objectiveValue: null, bestTrial: 1 }));
    });

    expect(screen.getByTestId("curves-tuning-scatter")).toBeInTheDocument();
    expect(screen.getAllByTestId("tuning-trial-row")).toHaveLength(3);
  });
});
