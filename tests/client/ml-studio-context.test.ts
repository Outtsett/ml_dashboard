// @vitest-environment jsdom
/**
 * W4.c — MLStudioContext reducer + v1→v2 migration unit tests.
 *
 * Covers the §2.3 reducer behaviors that the W4 frontend plan calls out as
 * critical (auto-cap, auto-star, race-safe hydrate, preview invalidation,
 * dirty marker, sub-pick parent invalidation), plus the v1→v2 storage
 * migrator that runs once on first load after the schema bump.
 */

import "./setup";
import { describe, it, expect } from "vitest";

import {
  __INTERNAL_FOR_TESTS__,
  migrateV1ToV2,
  type ExperimentRecord,
  type GeneratedPreview,
  type MLStudioPipeline,
  type CompositionConfig,
} from "../../src/client/src/pages/ml-studio/MLStudioContext";

const { DEFAULT_STATE, reducer, EXPERIMENT_LOCAL_CAP } = __INTERNAL_FOR_TESTS__;

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function exp(overrides: Partial<ExperimentRecord> = {}): ExperimentRecord {
  return {
    id: "exp-base",
    catalogId: "random-forest",
    modelId: null,
    runnerKey: null,
    hyperparameters: {},
    walkForward: null,
    objectiveConfig: null,
    labelStrategy: "next_close_direction",
    labelParams: {},
    featurePipelineId: null,
    featureCategories: [],
    status: "queued",
    foldMetrics: [],
    summary: null,
    startedAt: null,
    completedAt: null,
    trainingSessionId: null,
    diagnosticsPath: null,
    errorMessage: null,
    source: "user",
    ...overrides,
  };
}

function preview(overrides: Partial<GeneratedPreview> = {}): GeneratedPreview {
  return {
    files: [
      { path: "src/ml/m/main.py", content: "# main", language: "python" },
      { path: "src/ml/m/manifest.json", content: "{}", language: "json" },
    ],
    templateId: "sklearn",
    templateVersion: "1.0.0",
    hash: "deadbeef",
    warnings: [],
    generatedAt: "2026-05-10T00:00:00.000Z",
    dirty: false,
    ...overrides,
  };
}

function composition(overrides: Partial<CompositionConfig> = {}): CompositionConfig {
  return {
    kind: "atomic",
    params: {},
    subPicks: [],
    ...overrides,
  };
}

// ─── addExperiment caps to EXPERIMENT_LOCAL_CAP ──────────────────────────────

describe("reducer / addExperiment", () => {
  it("prepends new experiments and caps the array at EXPERIMENT_LOCAL_CAP", () => {
    let state: MLStudioPipeline = {
      ...DEFAULT_STATE,
      experiments: Array.from({ length: EXPERIMENT_LOCAL_CAP }, (_, i) =>
        exp({ id: `seed-${i}` }),
      ),
    };
    expect(state.experiments.length).toBe(EXPERIMENT_LOCAL_CAP);

    state = reducer(state, {
      type: "addExperiment",
      record: exp({ id: "fresh" }),
    });

    expect(state.experiments.length).toBe(EXPERIMENT_LOCAL_CAP);
    expect(state.experiments[0]!.id).toBe("fresh"); // newest at head
    // Oldest seed (`seed-${EXPERIMENT_LOCAL_CAP - 1}`) was popped from the tail.
    expect(state.experiments.find((e) => e.id === `seed-${EXPERIMENT_LOCAL_CAP - 1}`))
      .toBeUndefined();
  });
});

// ─── updateExperiment auto-stars on new max sharpe ───────────────────────────

describe("reducer / updateExperiment auto-star", () => {
  it("sets isStarred when the patched summary.sharpe exceeds peer max for same catalogId", () => {
    const initial: MLStudioPipeline = {
      ...DEFAULT_STATE,
      experiments: [
        exp({
          id: "old-1",
          catalogId: "random-forest",
          status: "done",
          summary: {
            sharpe: 0.30,
            profitFactor: null,
            winRate: null,
            maxDrawdown: null,
            ece: null,
            meanTradePnl: null,
            foldDispersion: null,
            isStarred: false,
          },
        }),
        exp({
          id: "new",
          catalogId: "random-forest",
          status: "running",
          summary: {
            sharpe: null,
            profitFactor: null,
            winRate: null,
            maxDrawdown: null,
            ece: null,
            meanTradePnl: null,
            foldDispersion: null,
            isStarred: false,
          },
        }),
      ],
    };

    const next = reducer(initial, {
      type: "updateExperiment",
      id: "new",
      patch: {
        status: "done",
        summary: {
          sharpe: 0.55,
          profitFactor: null,
          winRate: null,
          maxDrawdown: null,
          ece: null,
          meanTradePnl: null,
          foldDispersion: null,
          isStarred: false,
        },
      },
    });

    const updated = next.experiments.find((e) => e.id === "new")!;
    expect(updated.summary?.sharpe).toBe(0.55);
    expect(updated.summary?.isStarred).toBe(true); // new max
  });

  it("does NOT star a worse update", () => {
    const initial: MLStudioPipeline = {
      ...DEFAULT_STATE,
      experiments: [
        exp({
          id: "old-1",
          catalogId: "random-forest",
          status: "done",
          summary: {
            sharpe: 0.50,
            profitFactor: null,
            winRate: null,
            maxDrawdown: null,
            ece: null,
            meanTradePnl: null,
            foldDispersion: null,
            isStarred: true,
          },
        }),
        exp({
          id: "new",
          catalogId: "random-forest",
          status: "running",
          summary: null,
        }),
      ],
    };

    const next = reducer(initial, {
      type: "updateExperiment",
      id: "new",
      patch: {
        summary: {
          sharpe: 0.10,
          profitFactor: null,
          winRate: null,
          maxDrawdown: null,
          ece: null,
          meanTradePnl: null,
          foldDispersion: null,
          isStarred: false,
        },
      },
    });

    const updated = next.experiments.find((e) => e.id === "new")!;
    expect(updated.summary?.isStarred).toBe(false);
  });
});

// ─── hydrateExperiments prefers running local copy ───────────────────────────

describe("reducer / hydrateExperiments", () => {
  it("keeps the local copy when local.status === 'running' (race protection)", () => {
    const localRunning = exp({
      id: "shared",
      status: "running",
      foldMetrics: [
        { fold: 0, sharpe: 0.42, profitFactor: null, ece: null, trainLoss: null, valLoss: null, trades: null },
      ],
    });
    const incomingStale = exp({
      id: "shared",
      status: "queued",       // server hasn't seen the running flip yet
      foldMetrics: [],        // would clobber live fold metrics
    });

    const initial: MLStudioPipeline = {
      ...DEFAULT_STATE,
      experiments: [localRunning],
    };
    const next = reducer(initial, {
      type: "hydrateExperiments",
      records: [incomingStale],
    });

    const merged = next.experiments.find((e) => e.id === "shared")!;
    expect(merged.status).toBe("running");
    expect(merged.foldMetrics).toEqual(localRunning.foldMetrics);
  });

  it("merges server fields when local status is not running", () => {
    const local = exp({ id: "shared", status: "done", summary: null });
    const incoming = exp({
      id: "shared",
      status: "done",
      summary: {
        sharpe: 0.25,
        profitFactor: null,
        winRate: null,
        maxDrawdown: null,
        ece: null,
        meanTradePnl: null,
        foldDispersion: null,
        isStarred: false,
      },
    });
    const next = reducer(
      { ...DEFAULT_STATE, experiments: [local] },
      { type: "hydrateExperiments", records: [incoming] },
    );
    expect(next.experiments[0]!.summary?.sharpe).toBe(0.25);
  });
});

// ─── setComposition clears the generated preview ─────────────────────────────

describe("reducer / setComposition clears preview", () => {
  it("nulls generatedPreview whenever composition changes", () => {
    const initial: MLStudioPipeline = {
      ...DEFAULT_STATE,
      compositionConfig: composition({ kind: "atomic" }),
      generatedPreview: preview(),
    };
    const next = reducer(initial, {
      type: "setComposition",
      config: composition({ kind: "moe" }),
    });
    expect(next.generatedPreview).toBeNull();
  });
});

// ─── setSubPick clears parent's preview ──────────────────────────────────────

describe("reducer / setSubPick clears parent preview", () => {
  it("clears generatedPreview AND adds the slot to compositionConfig.subPicks", () => {
    const initial: MLStudioPipeline = {
      ...DEFAULT_STATE,
      compositionConfig: composition({ kind: "moe" }),
      generatedPreview: preview(),
    };
    const next = reducer(initial, {
      type: "setSubPick",
      slotId: "expert_0",
      catalogId: "random-forest",
      hyperparameters: { n_estimators: 200 },
    });
    expect(next.generatedPreview).toBeNull();
    expect(next.compositionConfig?.subPicks).toHaveLength(1);
    expect(next.compositionConfig?.subPicks[0]).toMatchObject({
      slotId: "expert_0",
      catalogId: "random-forest",
      hyperparameters: { n_estimators: 200 },
    });
  });
});

// ─── patchGeneratedFile sets dirty=true ──────────────────────────────────────

describe("reducer / patchGeneratedFile flips dirty", () => {
  it("rewrites file content + sets dirty true", () => {
    const initial: MLStudioPipeline = {
      ...DEFAULT_STATE,
      generatedPreview: preview(),
    };
    expect(initial.generatedPreview?.dirty).toBe(false);
    const next = reducer(initial, {
      type: "patchGeneratedFile",
      path: "src/ml/m/main.py",
      content: "# edited",
    });
    expect(next.generatedPreview?.dirty).toBe(true);
    const file = next.generatedPreview!.files.find(
      (f) => f.path === "src/ml/m/main.py",
    )!;
    expect(file.content).toBe("# edited");
    // Untouched file unchanged
    const manifest = next.generatedPreview!.files.find(
      (f) => f.path === "src/ml/m/manifest.json",
    )!;
    expect(manifest.content).toBe("{}");
  });

  it("is a no-op when the path doesn't exist in the preview", () => {
    const initial: MLStudioPipeline = {
      ...DEFAULT_STATE,
      generatedPreview: preview(),
    };
    const next = reducer(initial, {
      type: "patchGeneratedFile",
      path: "src/ml/m/missing.py",
      content: "ignored",
    });
    expect(next).toBe(initial);
  });
});

// ─── v1 → v2 migrator ─────────────────────────────────────────────────────────

describe("migrateV1ToV2", () => {
  it("returns DEFAULT_STATE when given undefined / null / non-object", () => {
    expect(migrateV1ToV2(undefined)).toEqual(DEFAULT_STATE);
    expect(migrateV1ToV2(null)).toEqual(DEFAULT_STATE);
    expect(migrateV1ToV2(42)).toEqual(DEFAULT_STATE);
  });

  it("preserves existing v1 fields and back-fills new v2 fields with safe defaults", () => {
    const v1 = {
      symbol: "ES",
      timeframe: "5m",
      modelType: "xgb_classifier",
      hyperparameters: { n_estimators: 500 },
      labelStrategy: "next_close_direction",
      labelParams: {},
      walkForward: { trainMonths: 12, testMonths: 3 },
      activeStage: "train",
      // No experiments / evalSelection / runIdByExperiment etc.
    };

    const out = migrateV1ToV2(v1);
    expect(out.symbol).toBe("ES");
    expect(out.timeframe).toBe("5m");
    expect(out.modelType).toBe("xgb_classifier");
    expect(out.hyperparameters).toEqual({ n_estimators: 500 });
    expect(out.activeStage).toBe("train");

    // New v2 fields land at safe defaults
    expect(out.experiments).toEqual([]);
    expect(out.evalSelection).toEqual([]);
    expect(out.runIdByExperiment).toEqual({});
    expect(out.generatedPreview).toBeNull();
    expect(out.compositionConfig).toBeNull();
    expect(out.objectiveConfig).toBeNull();
    expect(out.selectedExperimentId).toBeNull();
    expect(out.selectedVersionId).toBeNull();
    expect(out.drawerMode).toBeNull();
    expect(out.agentPanel).toEqual({ stage: null, agentId: null, open: false });
    expect(out.evalCollapsed).toEqual({
      matrix: false,
      folds: false,
      regime: true,
      calibration: true,
      bootstrap: true,
      baseline: true,
    });
    expect(out.registryFilters.symbol).toBe("ES");
    expect(out.registryFilters.timeframe).toBe("5m");
  });

  it("never throws on malformed payloads (missing types, junk fields)", () => {
    const malformed = {
      symbol: 42,                       // wrong type
      timeframe: "doesnotexist",        // not in Timeframe union
      experiments: "not an array",
      runIdByExperiment: "garbage",
      evalSelection: { not: "an array" },
    };
    const out = migrateV1ToV2(malformed);
    expect(out.symbol).toBe(DEFAULT_STATE.symbol);
    // timeframe is taken as-is when typeof === "string" — caller is expected
    // to repair if it's outside the union; we just verify no throw.
    expect(typeof out.timeframe).toBe("string");
    expect(out.experiments).toEqual([]);
    expect(out.runIdByExperiment).toEqual({});
    expect(out.evalSelection).toEqual([]);
  });

  it("preserves a stored experiments[] array verbatim (capped later by reducer)", () => {
    const v1 = {
      symbol: "MNQ",
      timeframe: "1m",
      experiments: [exp({ id: "e1" }), exp({ id: "e2" })],
    };
    const out = migrateV1ToV2(v1);
    expect(out.experiments).toHaveLength(2);
    expect(out.experiments.map((e) => e.id)).toEqual(["e1", "e2"]);
  });
});
