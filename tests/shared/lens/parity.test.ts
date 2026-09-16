/**
 * Parity against the model's own evaluator.
 *
 * Two independent checks on the same model, xgb_baseline_post (MNQ 1m):
 *
 *  1. RECONSTRUCTED — rebuilds the close series from the model's original
 *     artifacts (oos_predictions.parquet + diagnostics.json) and runs the whole
 *     shared compute over it. This does not need the Python lens builder to
 *     have run. The row-selection, hit rate, Brier score and area under the
 *     curve assertions here are computed from prob_up and label alone and so
 *     are fully independent of the reconstruction; the dollar assertions
 *     confirm the arithmetic pipeline end to end.
 *
 *  2. BUILT — the same assertions against data/models/xgb_baseline_post/lens/
 *     bars.parquet, the artifact the Python builder writes. This is the gate
 *     the plan names. It FAILS, loudly, when the artifact is absent: a skipped
 *     parity check is indistinguishable from a passing one, and that is exactly
 *     the confusion this whole feature exists to remove.
 */

import { describe, expect, it } from "vitest";
import { clampLensParams, evaluateLens, isDefaultLensParams, type LensEvaluation } from "@shared/lens/index";
import {
  lensArtifactsExist,
  modelDataExists,
  loadLensManifest,
  loadLensSeries,
  modelDirectory,
  reconstructFromPredictions,
} from "./load";

const MODEL_ID = "xgb_baseline_post";

/** The numbers diagnostics.json records for this model's own evaluator run. */
const REFERENCE = {
  tradeCount: 264,
  longCount: 34,
  shortCount: 230,
  totalNetUsd: -549.7,
  hitRateAtHalf: 0.5423001949317738,
  winRate: 0.4128787878787879,
  profitFactor: 0.6097266595669156,
  areaUnderCurve: 0.5288663012642728,
  brierScore: 0.24981734893009763,
};

function assertParity(evaluation: LensEvaluation): void {
  expect(evaluation.headline.tradeCount).toBe(REFERENCE.tradeCount);
  expect(evaluation.headline.longCount).toBe(REFERENCE.longCount);
  expect(evaluation.headline.shortCount).toBe(REFERENCE.shortCount);
  expect(evaluation.headline.totalNetUsd).toBeCloseTo(REFERENCE.totalNetUsd, 2);
  expect(Math.abs(evaluation.headline.totalNetUsd - REFERENCE.totalNetUsd)).toBeLessThanOrEqual(0.01);
  expect(evaluation.headline.hitRate.value as number).toBeCloseTo(REFERENCE.hitRateAtHalf, 4);
  expect(evaluation.headline.winRate.value as number).toBeCloseTo(REFERENCE.winRate, 4);
  expect(evaluation.headline.profitFactor.value as number).toBeCloseTo(REFERENCE.profitFactor, 4);
  expect(evaluation.headline.areaUnderCurve as number).toBeCloseTo(REFERENCE.areaUnderCurve, 4);
  expect(evaluation.headline.brierScore as number).toBeCloseTo(REFERENCE.brierScore, 6);
  expect(evaluation.headline.hitRate.n).toBe(2565);
  expect(evaluation.headline.winRate.n).toBe(REFERENCE.tradeCount);
  // Every parity check the compute runs against the manifest must pass.
  expect(evaluation.verification.length).toBeGreaterThan(0);
  for (const check of evaluation.verification) {
    expect(`${check.name}: ${check.measured}`).toBe(check.passed ? `${check.name}: ${check.measured}` : "passed");
  }
  expect(evaluation.verification.every((check) => check.passed)).toBe(true);
}

describe("lens parity — reconstructed from the model's own artifacts", () => {
  it("reproduces 264 trades, 34 long / 230 short and -$549.70 at default parameters", async () => {
    const { series, manifest, maximumSeedDisagreementPoints, referenceTradeNetUsd } =
      await reconstructFromPredictions(MODEL_ID);

    // The reconstruction is over-determined: 264 independent trade anchors
    // against 5 unknown scale factors, all agreeing to well inside one tick.
    expect(maximumSeedDisagreementPoints).toBeLessThan(0.01);
    expect(series.length).toBe(2565);
    expect(manifest.horizonBars).toBe(5);
    expect(manifest.defaultThreshold).toBe(0.55);

    const params = clampLensParams({}, manifest);
    expect(isDefaultLensParams(params, manifest)).toBe(true);
    expect(params.threshold).toBe(0.55);
    expect(params.costMultiplier).toBe(1);

    const evaluation = evaluateLens(series, null, manifest, params);
    assertParity(evaluation);

    // Trade by trade, not just in aggregate.
    expect(evaluation.trades).toHaveLength(referenceTradeNetUsd.length);
    let worst = 0;
    for (let index = 0; index < referenceTradeNetUsd.length; index += 1) {
      const difference = Math.abs((evaluation.trades[index]?.netUsd as number) - (referenceTradeNetUsd[index] as number));
      if (difference > worst) worst = difference;
    }
    expect(worst).toBeLessThan(1e-9);
  });

  it("keeps the record self-consistent across the views", async () => {
    const { series, manifest } = await reconstructFromPredictions(MODEL_ID);
    const params = clampLensParams({}, manifest);
    const evaluation = evaluateLens(series, null, manifest, params);

    // The mark-to-market equity curve lands on the realised total.
    const finalEquity = evaluation.equity[evaluation.equity.length - 1]?.modelCumulativeUsd as number;
    expect(finalEquity).toBeCloseTo(evaluation.headline.totalNetUsd, 6);
    expect(evaluation.headline.maxDrawdownUsd).toBeLessThan(0);
    expect(evaluation.headline.exposureShare).toBeCloseTo((264 * 5) / 2565, 6);

    // Confusion on all rows agrees with the headline hit rate.
    const { truePositive, trueNegative } = evaluation.confusion.allRows.counts;
    expect((truePositive + trueNegative) / evaluation.confusion.allRows.n).toBeCloseTo(
      REFERENCE.hitRateAtHalf,
      10,
    );
    expect(evaluation.confusion.explanation).toContain("264");

    // Rolling window of 100 rows on a 2,565-row record.
    expect(evaluation.rolling.windowBars).toBe(100);
    expect(evaluation.rolling.effectiveSampleSizePerWindow).toBeCloseTo(20, 12);
    expect(evaluation.rolling.points.length).toBeGreaterThan(0);
    expect(evaluation.rolling.points.length).toBeLessThanOrEqual(2000);

    // Every regime is reported, each trade-level estimate carrying its own n.
    expect(evaluation.regimes.performance.map((entry) => entry.regime)).toEqual(["bull", "bear", "sideways"]);
    const tradesByRegime = evaluation.regimes.performance.reduce((sum, entry) => sum + entry.tradeCount, 0);
    expect(tradesByRegime).toBeLessThanOrEqual(264);
    for (const entry of evaluation.regimes.performance) {
      expect(entry.meanTradeNetUsd.n).toBe(entry.tradeCount);
      if (entry.tradeCount > 0) expect(entry.meanTradeNetUsd.method).toContain("moving-block bootstrap");
    }
    expect(evaluation.regimes.definition).toContain("50 rows");

    // The verdict names the real numbers.
    expect(evaluation.headline.verdict).toContain("264 trades");
    expect(evaluation.headline.verdict).toContain("$549.70");
  });

  it("raising the threshold takes fewer trades, and raising the cost lowers the total", async () => {
    const { series, manifest } = await reconstructFromPredictions(MODEL_ID);
    const base = evaluateLens(series, null, manifest, clampLensParams({}, manifest));
    const strict = evaluateLens(series, null, manifest, clampLensParams({ threshold: 0.7 }, manifest));
    const free = evaluateLens(series, null, manifest, clampLensParams({ costMultiplier: 0 }, manifest));

    expect(strict.headline.tradeCount).toBeLessThan(base.headline.tradeCount);
    expect(free.headline.totalNetUsd).toBeGreaterThan(base.headline.totalNetUsd);
    // With no cost the difference is exactly the round trip on every trade.
    expect(free.headline.totalNetUsd - base.headline.totalNetUsd).toBeCloseTo(264 * 1.4 * 2, 6);
    // Parity checks only run at default parameters.
    expect(strict.verification).toEqual([]);
  });
});

describe("lens parity — the artifact written by the Python builder", () => {
  it("reproduces the same numbers from data/models/xgb_baseline_post/lens/bars.parquet", async (context) => {
    if (!modelDataExists(MODEL_ID)) {
      // `data/` is gitignored: a fresh checkout has no models to build a lens
      // from. Nothing to verify here, and nothing is wrong.
      context.skip(`data/models/${MODEL_ID} is not present in this checkout`);
      return;
    }
    if (!lensArtifactsExist(MODEL_ID)) {
      throw new Error(
        `Lens artifacts missing for ${MODEL_ID}. Expected ` +
          `${modelDirectory(MODEL_ID)}\\lens\\bars.parquet and manifest.json, written by the Python ` +
          "builder in src/ml/lens. This check is not skipped when the artifact is absent: run the " +
          "builder, then re-run this test.",
      );
    }
    const manifest = loadLensManifest(MODEL_ID);
    const series = await loadLensSeries(MODEL_ID, manifest);
    expect(series.length).toBe(manifest.barCount);
    expect(manifest.horizonBars).toBe(5);

    const params = clampLensParams({}, manifest);
    expect(isDefaultLensParams(params, manifest)).toBe(true);
    const evaluation = evaluateLens(series, null, manifest, params);
    assertParity(evaluation);
  });
});
