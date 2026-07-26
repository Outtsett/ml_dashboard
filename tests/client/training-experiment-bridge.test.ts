// @vitest-environment jsdom
/**
 * W4.d — useTrainingExperimentBridge unit tests.
 *
 * Drives the bridge through a synthetic SSE-event sequence
 * (training_started, 3x metric, fold_complete, done) by mutating the mocked
 * TrainingContext + MLStudioContext between rerenders, then asserts that
 * the right `updateExperiment` patches landed in the right order.
 */

import "./setup";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

import type { ExperimentRecord } from "../../src/client/src/pages/ml-studio/experimentTypes";

// --- Mocks for the three context hooks the bridge imports ------------------

type Patch = { id: string; patch: Partial<ExperimentRecord> };

interface MockMLStudio {
  state: { experiments: ExperimentRecord[] };
  dispatch: (a: unknown) => void;
}

interface MockTrainingControl {
  sessionId: string | null;
  modelId: string | null;
  isTraining: boolean;
  completedModelId: string | null;
  error: string | null;
}

interface MockTrainingLive {
  iterationHistory: Array<{ iteration: number; metrics: Record<string, number> }>;
  diagnostics: unknown;
}

let mockMLStudio: MockMLStudio;
let mockTrainingControl: MockTrainingControl;
let mockTrainingLive: MockTrainingLive;
let dispatchSpy: ReturnType<typeof vi.fn>;
const updatePatches: Patch[] = [];

vi.mock("../../src/client/src/pages/ml-studio/MLStudioContext", () => ({
  useMLStudio: () => mockMLStudio,
}));

vi.mock("../../src/client/src/contexts/TrainingContext", () => ({
  useTrainingControl: () => mockTrainingControl,
  useTrainingLive: () => mockTrainingLive,
}));

// Import AFTER mocks are wired so the hook resolves the mocked imports.
import { useTrainingExperimentBridge } from "../../src/client/src/pages/ml-studio/stages/train/useTrainingExperimentBridge";
import {
  applyFoldComplete,
  deriveSummaryFromFolds,
  mergeFoldMetric,
  parseFoldMetricKey,
} from "../../src/client/src/pages/ml-studio/experimentTypes";

// --- Helpers ---------------------------------------------------------------

function makeExperiment(overrides: Partial<ExperimentRecord> = {}): ExperimentRecord {
  return {
    id: "exp-1",
    catalogId: "random-forest",
    modelId: null,
    runnerKey: "sklearn+direction_classifier",
    hyperparameters: {},
    walkForward: { trainMonths: 12, testMonths: 3 },
    objectiveConfig: null,
    labelStrategy: "next_close_direction",
    labelParams: {},
    featurePipelineId: "ohlcv_basic",
    featureCategories: [],
    status: "queued",
    foldMetrics: [],
    summary: null,
    startedAt: null,
    completedAt: null,
    trainingSessionId: "abc",
    diagnosticsPath: null,
    errorMessage: null,
    source: "user",
    ...overrides,
  };
}

beforeEach(() => {
  updatePatches.length = 0;
  dispatchSpy = vi.fn((action: unknown) => {
    const a = action as { type: string };
    if (a.type === "updateExperiment") {
      const u = action as { id: string; patch: Partial<ExperimentRecord> };
      updatePatches.push({ id: u.id, patch: u.patch });
      // Apply the patch back into the mock state so subsequent rerenders
      // see the merged record (mirrors the real reducer's shallow-merge).
      const idx = mockMLStudio.state.experiments.findIndex((e) => e.id === u.id);
      if (idx !== -1) {
        mockMLStudio.state.experiments[idx] = {
          ...mockMLStudio.state.experiments[idx]!,
          ...u.patch,
        };
      }
    }
  });

  mockMLStudio = { state: { experiments: [makeExperiment()] }, dispatch: dispatchSpy };
  mockTrainingControl = {
    sessionId: "abc",
    modelId: "random_forest_v1",
    isTraining: false,
    completedModelId: null,
    error: null,
  };
  mockTrainingLive = { iterationHistory: [], diagnostics: null };
});

// --- Pure helpers ----------------------------------------------------------

describe("experimentTypes pure helpers", () => {
  it("parseFoldMetricKey recognises common alias spellings", () => {
    expect(parseFoldMetricKey("fold_0_sharpe")).toEqual({ foldIdx: 0, field: "sharpe" });
    expect(parseFoldMetricKey("fold_2_profit_factor")).toEqual({ foldIdx: 2, field: "profitFactor" });
    expect(parseFoldMetricKey("fold-3-val_loss")).toEqual({ foldIdx: 3, field: "valLoss" });
    expect(parseFoldMetricKey("epoch_5_loss")).toBeNull();
    expect(parseFoldMetricKey("fold_0_unknown_metric")).toBeNull();
  });

  it("mergeFoldMetric appends a new fold when none exists", () => {
    const next = mergeFoldMetric([], 0, "sharpe", 0.42);
    expect(next).toHaveLength(1);
    expect(next[0]!.fold).toBe(0);
    expect(next[0]!.sharpe).toBe(0.42);
  });

  it("mergeFoldMetric updates in place without mutating input", () => {
    const initial = mergeFoldMetric([], 0, "sharpe", 0.4);
    const next = mergeFoldMetric(initial, 0, "ece", 0.05);
    expect(initial[0]!.ece).toBeNull(); // unmutated
    expect(next[0]!.sharpe).toBe(0.4);
    expect(next[0]!.ece).toBe(0.05);
  });

  it("applyFoldComplete merges a structured metrics dict", () => {
    const out = applyFoldComplete([], 1, { sharpe: 0.5, profit_factor: 1.8, ece: 0.04, n_trades: 42 });
    expect(out).toHaveLength(1);
    expect(out[0]!).toMatchObject({ fold: 1, sharpe: 0.5, profitFactor: 1.8, ece: 0.04, trades: 42 });
  });

  it("deriveSummaryFromFolds averages cross-fold values + computes dispersion", () => {
    const folds = [
      mergeFoldMetric([], 0, "sharpe", 0.4)[0]!,
      mergeFoldMetric([], 1, "sharpe", 0.6)[0]!,
    ];
    const summary = deriveSummaryFromFolds(folds);
    expect(summary.sharpe).toBeCloseTo(0.5, 6);
    expect(summary.foldDispersion).toBeCloseTo(Math.sqrt(0.02), 6); // sd = sqrt(((0.4-0.5)^2+(0.6-0.5)^2)/1)
  });
});

// --- Bridge end-to-end -----------------------------------------------------

describe("useTrainingExperimentBridge", () => {
  it("dispatches the canonical sequence: running -> foldMetrics -> done", () => {
    const { rerender } = renderHook(() => useTrainingExperimentBridge());

    // Initial render: session present, isTraining still false. No patch yet.
    expect(updatePatches).toHaveLength(0);

    // 1. training_started equivalent: server flipped isTraining true.
    act(() => {
      mockTrainingControl = { ...mockTrainingControl, isTraining: true };
    });
    rerender();

    expect(updatePatches.at(-1)).toBeDefined();
    expect(updatePatches.at(-1)!.id).toBe("exp-1");
    expect(updatePatches.at(-1)!.patch.status).toBe("running");
    expect(typeof updatePatches.at(-1)!.patch.startedAt).toBe("string");
    expect(updatePatches.at(-1)!.patch.modelId).toBe("random_forest_v1");

    const startedPatchCount = updatePatches.length;

    // 2. Three per-iteration metric events. Each adds a fold's sharpe value.
    act(() => {
      mockTrainingLive = {
        iterationHistory: [
          { iteration: 0, metrics: { fold_0_sharpe: 0.42 } },
        ],
        diagnostics: null,
      };
    });
    rerender();
    expect(updatePatches.length).toBeGreaterThan(startedPatchCount);
    expect(updatePatches.at(-1)!.patch.foldMetrics).toEqual([
      expect.objectContaining({ fold: 0, sharpe: 0.42 }),
    ]);

    act(() => {
      mockTrainingLive = {
        iterationHistory: [
          { iteration: 0, metrics: { fold_0_sharpe: 0.42 } },
          { iteration: 1, metrics: { fold_1_sharpe: 0.31 } },
        ],
        diagnostics: null,
      };
    });
    rerender();
    expect(updatePatches.at(-1)!.patch.foldMetrics).toEqual([
      expect.objectContaining({ fold: 0, sharpe: 0.42 }),
      expect.objectContaining({ fold: 1, sharpe: 0.31 }),
    ]);

    act(() => {
      mockTrainingLive = {
        iterationHistory: [
          { iteration: 0, metrics: { fold_0_sharpe: 0.42 } },
          { iteration: 1, metrics: { fold_1_sharpe: 0.31 } },
          { iteration: 2, metrics: { fold_2_sharpe: 0.55 } },
        ],
        diagnostics: null,
      };
    });
    rerender();
    expect(updatePatches.at(-1)!.patch.foldMetrics).toEqual([
      expect.objectContaining({ fold: 0, sharpe: 0.42 }),
      expect.objectContaining({ fold: 1, sharpe: 0.31 }),
      expect.objectContaining({ fold: 2, sharpe: 0.55 }),
    ]);

    // 3. fold_complete event for fold 2 carries structured PF+ECE.
    act(() => {
      mockTrainingLive = {
        iterationHistory: [
          { iteration: 0, metrics: { fold_0_sharpe: 0.42 } },
          { iteration: 1, metrics: { fold_1_sharpe: 0.31 } },
          { iteration: 2, metrics: { fold_2_sharpe: 0.55 } },
          {
            iteration: 3,
            metrics: {
              fold_2_complete: 1,
              fold_2_profit_factor: 1.9,
              fold_2_ece: 0.04,
              fold_2_n_trades: 80,
            },
          },
        ],
        diagnostics: null,
      };
    });
    rerender();
    const foldsAfterComplete = updatePatches.at(-1)!.patch.foldMetrics!;
    const fold2 = foldsAfterComplete.find((f) => f.fold === 2)!;
    expect(fold2.profitFactor).toBe(1.9);
    expect(fold2.ece).toBe(0.04);
    expect(fold2.trades).toBe(80);
    // Sharpe value from earlier per-iteration metric must be preserved.
    expect(fold2.sharpe).toBe(0.55);

    // 4. Server emits `done`: completedModelId set + diagnostics carries path.
    act(() => {
      mockTrainingControl = {
        ...mockTrainingControl,
        completedModelId: "random_forest_v1",
        isTraining: false,
      };
      mockTrainingLive = {
        ...mockTrainingLive,
        diagnostics: { diagnostics_path: "data/models/random_forest_v1/diagnostics.json" },
      };
    });
    rerender();

    const finalPatch = updatePatches.at(-1)!.patch;
    expect(finalPatch.status).toBe("done");
    expect(typeof finalPatch.completedAt).toBe("string");
    expect(finalPatch.modelId).toBe("random_forest_v1");
    expect(finalPatch.diagnosticsPath).toBe("data/models/random_forest_v1/diagnostics.json");
    expect(finalPatch.summary).toBeDefined();
    // 3 fold sharpes (0.42, 0.31, 0.55) -> mean ~0.4267
    expect(finalPatch.summary!.sharpe).toBeCloseTo((0.42 + 0.31 + 0.55) / 3, 6);

    // Dispatch must NOT happen again on re-render with the same final state.
    const finalCount = updatePatches.length;
    rerender();
    expect(updatePatches.length).toBe(finalCount);
  });

  it("never dispatches against an experiment whose trainingSessionId differs from currentSessionId", () => {
    mockMLStudio.state.experiments = [
      makeExperiment({ id: "exp-other", trainingSessionId: "other-session" }),
    ];

    const { rerender } = renderHook(() => useTrainingExperimentBridge());
    act(() => {
      mockTrainingControl = { ...mockTrainingControl, isTraining: true };
    });
    rerender();
    act(() => {
      mockTrainingLive = {
        iterationHistory: [{ iteration: 0, metrics: { fold_0_sharpe: 0.42 } }],
        diagnostics: null,
      };
    });
    rerender();
    expect(updatePatches).toHaveLength(0);
  });

  it("dispatches a failed transition when training.error becomes non-null", () => {
    const { rerender } = renderHook(() => useTrainingExperimentBridge());
    act(() => {
      mockTrainingControl = { ...mockTrainingControl, isTraining: true };
    });
    rerender();

    act(() => {
      mockTrainingControl = { ...mockTrainingControl, error: "boom: feature pipeline missing" };
    });
    rerender();

    const lastPatch = updatePatches.at(-1)!.patch;
    expect(lastPatch.status).toBe("failed");
    expect(lastPatch.errorMessage).toBe("boom: feature pipeline missing");
    expect(typeof lastPatch.completedAt).toBe("string");
  });

  it("resets cursor + transition flags when sessionId changes (new run)", () => {
    const { rerender } = renderHook(() => useTrainingExperimentBridge());
    act(() => {
      mockTrainingControl = { ...mockTrainingControl, isTraining: true };
    });
    rerender();
    act(() => {
      mockTrainingControl = { ...mockTrainingControl, completedModelId: "random_forest_v1" };
    });
    rerender();
    const firstRunPatchCount = updatePatches.length;

    // New session for the same experiment row (re-train).
    mockMLStudio.state.experiments = [
      makeExperiment({ id: "exp-2", trainingSessionId: "session-2", status: "queued" }),
    ];
    act(() => {
      mockTrainingControl = {
        sessionId: "session-2",
        modelId: "random_forest_v2",
        isTraining: false,
        completedModelId: null,
        error: null,
      };
      mockTrainingLive = { iterationHistory: [], diagnostics: null };
    });
    rerender();
    act(() => {
      mockTrainingControl = { ...mockTrainingControl, isTraining: true };
    });
    rerender();

    // A second running transition fired for the new sessionId.
    expect(updatePatches.length).toBeGreaterThan(firstRunPatchCount);
    const lastPatch = updatePatches.at(-1)!;
    expect(lastPatch.id).toBe("exp-2");
    expect(lastPatch.patch.status).toBe("running");
  });
});
