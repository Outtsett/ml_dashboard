/**
 * Parity against the model's own evaluator.
 *
 * The fixture is a real model — a daily MNQ XGBoost direction classifier
 * trained by src/ml/xgb_classifier — committed under
 * tests/fixtures/lens/mnq_1d_xgboost_direction_classifier/ with its original
 * record (oos_predictions.parquet, checkpoint.json, diagnostics.json) and the
 * lens the Python builder wrote for it (lens/manifest.json, lens/bars.parquet).
 * Every expected number is READ from that model's diagnostics.json, never typed.
 *
 * That trainer scores trades H BARS ahead on the raw bar grid, and the builder
 * lays the record on the lake's bars (src/ml/lens/adapters.py
 * _probability_parquet_on_lake_grid): the bars whose label was dropped carry no
 * prediction and never trade. Three checks:
 *
 *  1. ORIGINAL — the model's own oos_predictions.parquet, read without the
 *     builder, gives back the hit rate and area under the curve its
 *     diagnostics record, and the lens record carries every one of those
 *     predictions at the same bar with the same probability, label and return.
 *  2. BUILT — the whole shared compute over lens/bars.parquet reproduces the
 *     evaluator's trade count, long / short split, net profit, trade-by-trade
 *     profit and loss, hit rate, win rate, profit factor, area under the curve
 *     and Brier score at default parameters.
 *  3. The views stay consistent with each other and move the right way when the
 *     threshold or the cost moves.
 */

import { describe, expect, it } from "vitest";
import { areaUnderCurve, clampLensParams, evaluateLens, isDefaultLensParams, type LensEvaluation } from "@shared/lens/index";
import {
  DAILY_CLASSIFIER_FIXTURE,
  loadLensManifest,
  loadLensSeries,
  readClassifierDiagnostics,
  readJson,
  readOutOfSamplePredictions,
} from "./load";
import path from "node:path";

const DIRECTORY = DAILY_CLASSIFIER_FIXTURE;
const diagnostics = readClassifierDiagnostics(DIRECTORY);
const checkpoint = readJson<{ params: { label_horizon_bars: number; pnl_threshold: number } }>(
  path.join(DIRECTORY, "checkpoint.json"),
);

function metric(name: string): number {
  const value = diagnostics.metrics[name]?.value;
  if (typeof value !== "number") throw new Error(`fixture diagnostics.json has no metric ${name}`);
  return value;
}

/** The numbers diagnostics.json records for this model's own evaluator run. */
const tradeNetUsd = diagnostics.pnl_curve.trade_pnl_dollars;
const REFERENCE = {
  tradeCount: tradeNetUsd.length,
  longCount: diagnostics.pnl_curve.n_long,
  shortCount: diagnostics.pnl_curve.n_short,
  totalNetUsd: metric("cum_pnl_dollars"),
  hitRateAtHalf: metric("hit_rate_50"),
  winRate: tradeNetUsd.filter((net) => net > 0).length / tradeNetUsd.length,
  profitFactor: metric("profit_factor"),
  areaUnderCurve: metric("auc"),
  brierScore: metric("brier_score"),
  horizonBars: checkpoint.params.label_horizon_bars,
  threshold: checkpoint.params.pnl_threshold,
};

function assertParity(evaluation: LensEvaluation, labelledRowCount: number): void {
  expect(evaluation.headline.tradeCount).toBe(REFERENCE.tradeCount);
  expect(evaluation.headline.longCount).toBe(REFERENCE.longCount);
  expect(evaluation.headline.shortCount).toBe(REFERENCE.shortCount);
  expect(Math.abs(evaluation.headline.totalNetUsd - REFERENCE.totalNetUsd)).toBeLessThanOrEqual(0.01);
  expect(evaluation.headline.hitRate.value as number).toBeCloseTo(REFERENCE.hitRateAtHalf, 10);
  expect(evaluation.headline.winRate.value as number).toBeCloseTo(REFERENCE.winRate, 10);
  expect(evaluation.headline.profitFactor.value as number).toBeCloseTo(REFERENCE.profitFactor, 6);
  expect(evaluation.headline.areaUnderCurve as number).toBeCloseTo(REFERENCE.areaUnderCurve, 4);
  expect(evaluation.headline.brierScore as number).toBeCloseTo(REFERENCE.brierScore, 6);
  expect(evaluation.headline.hitRate.n).toBe(labelledRowCount);
  expect(evaluation.headline.winRate.n).toBe(REFERENCE.tradeCount);
  // Every parity check the compute runs against the manifest must pass.
  expect(evaluation.verification.length).toBeGreaterThan(0);
  for (const check of evaluation.verification) {
    expect(`${check.name}: ${check.measured}`).toBe(check.passed ? `${check.name}: ${check.measured}` : "passed");
  }
}

async function loadFixture() {
  const manifest = loadLensManifest(DIRECTORY);
  const series = await loadLensSeries(DIRECTORY, manifest);
  return { manifest, series };
}

describe("lens parity — the model's original record, read without the builder", () => {
  it("gives back the hit rate and area under the curve the model's diagnostics record", async () => {
    const original = await readOutOfSamplePredictions(DIRECTORY);
    const count = original.probabilityUp.length;
    let hits = 0;
    for (let index = 0; index < count; index += 1) {
      if (((original.probabilityUp[index] as number) >= 0.5) === (original.label[index] === 1)) hits += 1;
    }
    expect(hits / count).toBeCloseTo(REFERENCE.hitRateAtHalf, 12);
    const auc = areaUnderCurve(Float64Array.from(original.probabilityUp), Float64Array.from(original.label));
    expect(auc as number).toBeCloseTo(REFERENCE.areaUnderCurve, 4);
  });

  it("finds every prediction in the lens record at its own bar, unchanged", async () => {
    const original = await readOutOfSamplePredictions(DIRECTORY);
    const { series, manifest } = await loadFixture();
    expect(manifest.horizonBars).toBe(REFERENCE.horizonBars);
    expect(manifest.defaultThreshold).toBe(REFERENCE.threshold);

    const rowOf = new Map<number, number>();
    for (let row = 0; row < series.length; row += 1) rowOf.set(series.timestampSeconds[row] as number, row);

    let predicted = 0;
    for (let index = 0; index < original.timestampSeconds.length; index += 1) {
      const row = rowOf.get(original.timestampSeconds[index] as number);
      expect(row, `prediction ${index} has no bar in the lens record`).toBeDefined();
      const at = row as number;
      expect(series.probabilityUp[at]).toBe(Math.fround(original.probabilityUp[index] as number));
      expect(series.label[at]).toBe(original.label[index]);
      expect(Math.abs((series.realizedReturnBasisPoints[at] as number) - (original.realizedReturnBasisPoints[index] as number))).toBeLessThan(1e-3);
      predicted += 1;
    }
    // Bars between predictions carry none: no probability, label or return.
    let withoutPrediction = 0;
    for (let row = 0; row < series.length; row += 1) {
      if (Number.isFinite(series.probabilityUp[row] as number)) continue;
      withoutPrediction += 1;
      expect(series.label[row]).toBe(-1);
      expect(Number.isFinite(series.realizedReturnBasisPoints[row] as number)).toBe(false);
    }
    expect(predicted + withoutPrediction).toBe(series.length);
    expect(series.length).toBe(manifest.barCount);
  });
});

describe("lens parity — the artifact written by the Python builder", () => {
  it("reproduces the evaluator's trades, net profit and scores at default parameters", async () => {
    const { series, manifest } = await loadFixture();
    const original = await readOutOfSamplePredictions(DIRECTORY);

    const params = clampLensParams({}, manifest);
    expect(isDefaultLensParams(params, manifest)).toBe(true);
    expect(params.threshold).toBe(REFERENCE.threshold);
    expect(params.costMultiplier).toBe(1);

    const evaluation = evaluateLens(series, null, manifest, params);
    assertParity(evaluation, original.probabilityUp.length);
    expect(manifest.verification.every((check) => check.passed)).toBe(true);

    // Trade by trade, not just in aggregate.
    expect(evaluation.trades).toHaveLength(tradeNetUsd.length);
    let worst = 0;
    for (let index = 0; index < tradeNetUsd.length; index += 1) {
      const difference = Math.abs((evaluation.trades[index]?.netUsd as number) - (tradeNetUsd[index] as number));
      if (difference > worst) worst = difference;
    }
    expect(worst).toBeLessThan(1e-9);
  });
});

describe("lens parity — the views agree with each other", () => {
  it("keeps the record self-consistent across the views", async () => {
    const { series, manifest } = await loadFixture();
    const params = clampLensParams({}, manifest);
    const evaluation = evaluateLens(series, null, manifest, params);
    const tradeCount = REFERENCE.tradeCount;

    // The mark-to-market equity curve lands on the realised total.
    const finalEquity = evaluation.equity[evaluation.equity.length - 1]?.modelCumulativeUsd as number;
    expect(finalEquity).toBeCloseTo(evaluation.headline.totalNetUsd, 6);
    expect(evaluation.headline.maxDrawdownUsd).toBeLessThan(0);
    expect(evaluation.headline.exposureShare).toBeCloseTo((tradeCount * manifest.horizonBars) / manifest.barCount, 6);

    // Confusion on all rows agrees with the headline hit rate.
    const { truePositive, trueNegative } = evaluation.confusion.allRows.counts;
    expect((truePositive + trueNegative) / evaluation.confusion.allRows.n).toBeCloseTo(REFERENCE.hitRateAtHalf, 10);
    expect(evaluation.confusion.explanation).toContain(String(tradeCount));

    // Rolling window of 100 rows.
    expect(evaluation.rolling.windowBars).toBe(100);
    // Sized on the labelled rows a window holds (the median window), never its bar count.
    const labelledCounts = evaluation.rolling.points.map((point) => point.labelledCount).sort((x, y) => x - y);
    const typicalLabelled = labelledCounts[Math.floor(labelledCounts.length / 2)] as number;
    expect(typicalLabelled).toBeLessThanOrEqual(100);
    expect(evaluation.rolling.effectiveSampleSizePerWindow).toBeCloseTo(typicalLabelled / manifest.horizonBars, 12);
    expect(evaluation.rolling.points.length).toBeGreaterThan(0);
    expect(evaluation.rolling.points.length).toBeLessThanOrEqual(2000);

    // Every regime is reported, each trade-level estimate carrying its own n.
    expect(evaluation.regimes.performance.map((entry) => entry.regime)).toEqual(["bull", "bear", "sideways"]);
    const tradesByRegime = evaluation.regimes.performance.reduce((sum, entry) => sum + entry.tradeCount, 0);
    expect(tradesByRegime).toBeLessThanOrEqual(tradeCount);
    for (const entry of evaluation.regimes.performance) {
      expect(entry.meanTradeNetUsd.n).toBe(entry.tradeCount);
      if (entry.tradeCount > 0) expect(entry.meanTradeNetUsd.method).toContain("moving-block bootstrap");
    }
    expect(evaluation.regimes.definition).toContain("50 rows");

    // The verdict names the real numbers.
    expect(evaluation.headline.verdict).toContain(`${tradeCount} trades`);
    expect(evaluation.headline.verdict).toContain(`$${Math.abs(REFERENCE.totalNetUsd).toFixed(2)}`);
  });

  it("raising the threshold takes fewer trades, and raising the cost lowers the total", async () => {
    const { series, manifest } = await loadFixture();
    const base = evaluateLens(series, null, manifest, clampLensParams({}, manifest));
    const strict = evaluateLens(series, null, manifest, clampLensParams({ threshold: 0.7 }, manifest));
    const free = evaluateLens(series, null, manifest, clampLensParams({ costMultiplier: 0 }, manifest));

    expect(strict.headline.tradeCount).toBeLessThan(base.headline.tradeCount);
    expect(free.headline.totalNetUsd).toBeGreaterThan(base.headline.totalNetUsd);
    // With no cost the difference is exactly the round trip on every trade.
    const roundTripUsd = manifest.cost.roundTripPoints * manifest.cost.pointValueUsd;
    expect(free.headline.totalNetUsd - base.headline.totalNetUsd).toBeCloseTo(REFERENCE.tradeCount * roundTripUsd, 6);
    // Parity checks only run at default parameters.
    expect(strict.verification).toEqual([]);
  });
});
