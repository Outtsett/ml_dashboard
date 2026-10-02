/**
 * Leaderboard ranking.
 *
 * The rules worth pinning are the ones that stop the board from lying: only
 * completed runs are ranked, the headline is cost-adjusted rather than gross,
 * ties break toward the more trustworthy result, and a result carried by one
 * lucky fold is flagged rather than presented as stable.
 */

import { describe, it, expect } from "vitest";
import {
  rankExperiments,
  rankDelta,
  rankSnapshot,
  sharpeCurve,
  fragility,
  FRAGILITY_THRESHOLD,
} from "@/ml/experiments/ranking";
import type {
  ExperimentRecord,
  ExperimentStatus,
  FoldMetric,
} from "@/ml/MLStudioContext";

function fold(n: number, sharpe: number | null): FoldMetric {
  return {
    fold: n,
    sharpe,
    profitFactor: null,
    ece: null,
    trainLoss: null,
    valLoss: null,
    trades: null,
  };
}

function experiment(
  id: string,
  opts: {
    status?: ExperimentStatus;
    sharpe?: number | null;
    dispersion?: number | null;
    folds?: number[];
    completedAt?: string | null;
  } = {},
): ExperimentRecord {
  const {
    status = "done",
    sharpe = 1,
    dispersion = 0,
    folds = [],
    completedAt = null,
  } = opts;

  return {
    id,
    catalogId: `model-${id}`,
    modelId: null,
    runnerKey: null,
    hyperparameters: {},
    walkForward: null,
    objectiveConfig: null,
    labelStrategy: "triple_barrier" as ExperimentRecord["labelStrategy"],
    labelParams: {},
    featurePipelineId: null,
    featureCategories: [],
    status,
    foldMetrics: folds.map((s, i) => fold(i, s)),
    summary:
      sharpe === null
        ? null
        : {
            sharpe,
            profitFactor: null,
            winRate: null,
            maxDrawdown: null,
            ece: null,
            meanTradePnl: null,
            foldDispersion: dispersion,
            isStarred: false,
          },
    startedAt: null,
    completedAt,
    trainingSessionId: null,
    diagnosticsPath: null,
    errorMessage: null,
    source: "user",
  };
}

describe("eligibility", () => {
  it("ranks only completed experiments", () => {
    // A running experiment's partial folds would be ranked against complete
    // ones on a different amount of evidence.
    const ranked = rankExperiments([
      experiment("a", { status: "done", sharpe: 1.0 }),
      experiment("b", { status: "running", sharpe: 9.9 }),
      experiment("c", { status: "failed", sharpe: 9.9 }),
      experiment("d", { status: "queued", sharpe: 9.9 }),
      experiment("e", { status: "cancelled", sharpe: 9.9 }),
    ]);
    expect(ranked.map((r) => r.experiment.id)).toEqual(["a"]);
  });

  it("excludes an experiment with no summary at all", () => {
    const ranked = rankExperiments([experiment("a", { sharpe: null })]);
    expect(ranked).toHaveLength(0);
  });

  it("excludes a non-finite headline rather than sorting it to an end", () => {
    const ranked = rankExperiments([
      experiment("nan", { sharpe: NaN }),
      experiment("inf", { sharpe: Infinity }),
      experiment("ok", { sharpe: 0.4 }),
    ]);
    expect(ranked.map((r) => r.experiment.id)).toEqual(["ok"]);
  });
});

describe("ordering", () => {
  it("ranks by cost-adjusted Sharpe, descending", () => {
    const ranked = rankExperiments([
      experiment("mid", { sharpe: 1.2 }),
      experiment("high", { sharpe: 2.4 }),
      experiment("low", { sharpe: 0.3 }),
    ]);
    expect(ranked.map((r) => r.experiment.id)).toEqual(["high", "mid", "low"]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it("ranks negative Sharpe below positive", () => {
    const ranked = rankExperiments([
      experiment("bad", { sharpe: -0.8 }),
      experiment("good", { sharpe: 0.1 }),
    ]);
    expect(ranked[0]!.experiment.id).toBe("good");
  });

  it("breaks ties toward the less fold-dependent result", () => {
    const ranked = rankExperiments([
      experiment("erratic", { sharpe: 2.0, dispersion: 1.8 }),
      experiment("steady", { sharpe: 2.0, dispersion: 0.1 }),
    ]);
    expect(ranked[0]!.experiment.id).toBe("steady");
  });

  it("does not let unknown fragility win a tie against known-good", () => {
    const ranked = rankExperiments([
      experiment("unknown", { sharpe: 2.0, dispersion: null }),
      experiment("known", { sharpe: 2.0, dispersion: 0.2 }),
    ]);
    expect(ranked[0]!.experiment.id).toBe("known");
  });

  it("breaks a remaining tie toward more folds of evidence", () => {
    const ranked = rankExperiments([
      experiment("thin", { sharpe: 1.5, dispersion: 0.2, folds: [1.5, 1.5] }),
      experiment("thick", {
        sharpe: 1.5,
        dispersion: 0.2,
        folds: [1.5, 1.5, 1.5, 1.5, 1.5],
      }),
    ]);
    expect(ranked[0]!.experiment.id).toBe("thick");
  });

  it("is stable for fully equal entries", () => {
    const a = experiment("a", { sharpe: 1, dispersion: 0, completedAt: "2026-01-01T00:00:00Z" });
    const b = experiment("b", { sharpe: 1, dispersion: 0, completedAt: "2026-01-02T00:00:00Z" });
    expect(rankExperiments([b, a]).map((r) => r.experiment.id)).toEqual(["a", "b"]);
    expect(rankExperiments([a, b]).map((r) => r.experiment.id)).toEqual(["a", "b"]);
  });
});

describe("fragility", () => {
  it("is dispersion relative to the mean magnitude", () => {
    expect(fragility(experiment("a", { sharpe: 2.0, dispersion: 1.0 }))).toBeCloseTo(0.5);
  });

  it("uses magnitude, so a negative mean does not flip the sign", () => {
    const f = fragility(experiment("a", { sharpe: -2.0, dispersion: 1.0 }));
    expect(f).toBeCloseTo(0.5);
    expect(f).toBeGreaterThan(0);
  });

  it("returns null near a zero mean instead of exploding", () => {
    // Dispersion / ~0 would otherwise produce an enormous ratio and flag every
    // break-even strategy as maximally fragile.
    expect(fragility(experiment("a", { sharpe: 0, dispersion: 0.4 }))).toBeNull();
  });

  it("flags a result carried by a minority of folds", () => {
    const ranked = rankExperiments([
      experiment("lucky", { sharpe: 2.0, dispersion: 2.0 }),
      experiment("solid", { sharpe: 2.0, dispersion: 0.1 }),
    ]);
    const lucky = ranked.find((r) => r.experiment.id === "lucky")!;
    const solid = ranked.find((r) => r.experiment.id === "solid")!;
    expect(lucky.isFragile).toBe(true);
    expect(solid.isFragile).toBe(false);
    expect(lucky.fragility).toBeGreaterThanOrEqual(FRAGILITY_THRESHOLD);
  });
});

describe("sharpeCurve", () => {
  it("returns fold Sharpes in fold order", () => {
    const e = experiment("a", { folds: [0.5, 1.5, 1.0] });
    expect(sharpeCurve(e)).toEqual([0.5, 1.5, 1.0]);
  });

  it("sorts by fold index rather than trusting array order", () => {
    const e = experiment("a");
    e.foldMetrics = [fold(2, 3), fold(0, 1), fold(1, 2)];
    expect(sharpeCurve(e)).toEqual([1, 2, 3]);
  });

  it("drops folds with no Sharpe rather than rendering gaps as zero", () => {
    const e = experiment("a");
    e.foldMetrics = [fold(0, 1), fold(1, null), fold(2, 3)];
    expect(sharpeCurve(e)).toEqual([1, 3]);
  });
});

describe("rank movement", () => {
  it("reports upward movement as positive", () => {
    const before = new Map([["a", 3]]);
    const now = rankExperiments([experiment("a", { sharpe: 5 })]);
    expect(rankDelta(now, before).get("a")).toBe(2);
  });

  it("reports a drop as negative", () => {
    const before = new Map([["a", 1]]);
    const now = rankExperiments([
      experiment("b", { sharpe: 9 }),
      experiment("a", { sharpe: 1 }),
    ]);
    expect(rankDelta(now, before).get("a")).toBe(-1);
  });

  it("reports null for a new entrant rather than a large jump", () => {
    const now = rankExperiments([experiment("new", { sharpe: 1 })]);
    expect(rankDelta(now, new Map()).get("new")).toBeNull();
  });

  it("round-trips through a snapshot with no movement", () => {
    const now = rankExperiments([
      experiment("a", { sharpe: 2 }),
      experiment("b", { sharpe: 1 }),
    ]);
    const deltas = rankDelta(now, rankSnapshot(now));
    expect([...deltas.values()]).toEqual([0, 0]);
  });
});
