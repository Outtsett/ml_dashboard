/**
 * Parity of the lens against a Model Cycle run's own scoreboard.
 *
 * The lens reads a run from its own record (src/ml/lens/runs.py): the bars the
 * run walked, its P(up), and the direction each bar resolved to. So the
 * DIRECTION scoreboard is the same arithmetic over the same scored bars and
 * must match the run's scoreboard.json exactly: accuracy (the lens hit rate),
 * area under the curve, Brier score, and the number of scored bars.
 *
 * The TRADE scoreboard legitimately differs, and this test pins why rather than
 * hiding it. The run decides at a bar's close and fills at the next bar's open,
 * holding and reversing per its plan; the lens replays one fixed rule over every
 * model (enter at the close of a bar whose P(up) clears the threshold, exit at
 * the close H rows later, one trade at a time). So the manifest leaves
 * reference.tradeCount / cumulativeNetUsd empty and names the run's own trade
 * count and net profit in its notes.
 *
 * Runs: the committed fixture tests/fixtures/lens/mnq_5m_xgboost_cycle_run/
 * (always), plus two real runs under data/models/ when present — one from
 * before the entry threshold was removed (trades at P(up) >= 0.55) and one that
 * trades every prediction. A real run whose directory is absent is skipped; one
 * that is present without a built lens fails, because a skipped parity check is
 * indistinguishable from a passing one.
 */

import { describe, expect, it } from "vitest";
import { clampLensParams, evaluateLens, isDefaultLensParams } from "@shared/lens/index";
import {
  CYCLE_RUN_FIXTURE,
  directoryExists,
  lensArtifactsExist,
  loadLensManifest,
  loadLensSeries,
  modelDirectory,
  readCycleScoreboard,
} from "./load";

const RUNS: Array<{ name: string; directory: string; committed: boolean }> = [
  { name: "fixture MNQ 5m XGBoost cycle run (entry threshold 0.55)", directory: CYCLE_RUN_FIXTURE, committed: true },
  {
    name: "MNQ_5m_xgboost+walk_forward_cycle_20260928T185403 (trades every prediction)",
    directory: modelDirectory("MNQ_5m_xgboost+walk_forward_cycle_20260928T185403"),
    committed: false,
  },
  {
    name: "MNQ_5m_xgboost+walk_forward_cycle_20260925T104424 (entry threshold 0.55)",
    directory: modelDirectory("MNQ_5m_xgboost+walk_forward_cycle_20260925T104424"),
    committed: false,
  },
];

describe.each(RUNS)("lens parity with a Model Cycle run — $name", ({ directory, committed }) => {
  it("reproduces the run's direction scoreboard and names the run's own trades", async (context) => {
    if (!committed && !directoryExists(directory)) {
      context.skip(`${directory} is not present in this checkout (data/ is gitignored)`);
      return;
    }
    if (!lensArtifactsExist(directory)) {
      if (!committed) {
        context.skip(`${directory} has no built lens in this checkout (data/ is gitignored)`);
        return;
      }
      throw new Error(
        `Lens artifacts missing under ${directory}\\lens. Build them with the Python builder ` +
          "(python -m ml.lens.main --model-id <id>), then re-run this test.",
      );
    }
    const manifest = loadLensManifest(directory);
    const series = await loadLensSeries(directory, manifest);
    const scoreboard = readCycleScoreboard(directory);
    const metrics = scoreboard.metrics;

    expect(manifest.sourceSchema).toBe("cycle_run");
    expect(series.length).toBe(manifest.barCount);
    expect(series.length).toBe(scoreboard.barsEvaluated);
    // Every check the builder ran against the run's own record passed.
    for (const check of manifest.verification) {
      expect(`${check.name}: ${check.measured}`).toBe(check.passed ? `${check.name}: ${check.measured}` : "passed");
    }

    const params = clampLensParams({}, manifest);
    expect(isDefaultLensParams(params, manifest)).toBe(true);
    const evaluation = evaluateLens(series, null, manifest, params);

    // The direction scoreboard is the run's.
    expect(evaluation.headline.hitRate.n).toBe(scoreboard.barsScored);
    expect(evaluation.headline.hitRate.value as number).toBeCloseTo(metrics["accuracy"] as number, 12);
    expect(evaluation.headline.areaUnderCurve as number).toBeCloseTo(metrics["roc_auc"] as number, 6);
    expect(evaluation.headline.brierScore as number).toBeCloseTo(metrics["brier_score"] as number, 6);
    expect(evaluation.verification.map((check) => check.name).sort()).toEqual([
      "area_under_curve_matches_model_diagnostics",
      "hit_rate_at_half_matches_model_diagnostics",
    ]);
    expect(evaluation.verification.every((check) => check.passed)).toBe(true);

    // The trade scoreboard follows the lens rule; the run's own numbers are named, not compared.
    expect(manifest.reference.tradeCount).toBeNull();
    expect(manifest.reference.cumulativeNetUsd).toBeNull();
    const runTradeCount = metrics["trade_count"] as number;
    const runNetUsd = metrics["net_profit_usd"] as number;
    const ownTrades = manifest.notes.find((note) => note.startsWith("Under its own rule the run closed"));
    expect(ownTrades).toContain(`${runTradeCount.toLocaleString("en-US")} trades`);
    expect(ownTrades).toContain(Math.abs(runNetUsd).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

    // The cost is the run's own copy of the cost model, per round trip per contract.
    expect(manifest.cost.source).toContain("config.json plan.costModel");
  });
});
