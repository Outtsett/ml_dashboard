import { describe, expect, it } from "vitest";
import {
  buildBarWindow,
  clampLensParams,
  computeConfusion,
  computeDistribution,
  computeScatter,
  evaluateLens,
  proportionEstimate,
  resolveRange,
} from "@shared/lens/index";
import { makeManifest, makeSeries } from "./fixtures";

const QUANTILE_COUNT = 7;

function quantileGrid(length: number, warmup: number, values: number[]): Array<Array<number | null>> {
  return Array.from({ length: QUANTILE_COUNT }, (_, quantileIndex) =>
    Array.from({ length }, (_, row) => (row < warmup ? null : (values[quantileIndex] as number))),
  );
}

describe("computeDistribution", () => {
  it("spans the 0.5th to 99.5th percentile of the union and folds the tails into the edge bins", () => {
    const length = 101;
    const realized = Array.from({ length }, (_, index) => index);
    const series = makeSeries({
      close: Array.from({ length }, () => 100),
      probabilityUp: Array.from({ length }, (_, index) => index / length),
      realizedReturnBasisPoints: realized,
      horizonBars: 1,
    });
    const manifest = makeManifest(series);
    const params = clampLensParams({}, manifest);
    const distribution = computeDistribution(series, params, resolveRange(series, params));

    expect(distribution.histogram.edgesBasisPoints).toHaveLength(41);
    expect(distribution.histogram.edgesBasisPoints[0]).toBeCloseTo(0.5, 10);
    expect(distribution.histogram.edgesBasisPoints[40]).toBeCloseTo(99.5, 10);
    // Nothing is dropped: the two rows outside the span land in the edge bins.
    const total = distribution.histogram.realizedCounts.reduce((sum, count) => sum + count, 0);
    expect(total).toBe(length);
    expect(distribution.histogram.predictedCounts).toBeNull();
    expect(distribution.realized.count).toBe(length);
    expect(distribution.realized.mean).toBeCloseTo(50, 10);
    expect(distribution.predicted).toBeNull();
    expect(distribution.tailCoverage).toBeNull();
  });

  it("measures how often reality fell outside the interval the model claimed", () => {
    const length = 20;
    // A +/- 100 bp band; six rows out of twenty land outside it.
    const realized = [
      0, 10, -10, 250, -250, 20, 30, -300, 40, 50, -60, 400, 70, -80, 90, 500, -600, 5, 15, -25,
    ];
    const series = makeSeries({
      close: Array.from({ length }, () => 100),
      probabilityUp: Array.from({ length }, (_, index) => 0.3 + index * 0.02),
      realizedReturnBasisPoints: realized,
      quantilesBasisPoints: quantileGrid(length, 0, [-100, -80, -40, 0, 40, 80, 100]),
      horizonBars: 1,
    });
    const manifest = makeManifest(series);
    const params = clampLensParams({ intervalCoverage: 0.9 }, manifest);
    const distribution = computeDistribution(series, params, resolveRange(series, params));

    expect(distribution.tailCoverage?.n).toBe(length);
    expect(distribution.tailCoverage?.nominalOutsideShare).toBeCloseTo(0.1, 12);
    expect(distribution.tailCoverage?.belowLowerShare).toBeCloseTo(3 / 20, 12);
    expect(distribution.tailCoverage?.aboveUpperShare).toBeCloseTo(3 / 20, 12);
    expect(distribution.tailCoverage?.observedOutsideShare).toBeCloseTo(6 / 20, 12);

    // A flat band across every probability decile is exactly the "confidence
    // theatre" signature the view exists to expose.
    expect(distribution.intervalWidthByDecile).toHaveLength(10);
    for (const decile of distribution.intervalWidthByDecile) {
      expect(decile.count).toBe(2);
      expect(decile.meanWidthBasisPoints).toBeCloseTo(200, 6);
    }

    // Narrowing the coverage narrows the band it reads.
    const narrow = clampLensParams({ intervalCoverage: 0.5 }, manifest);
    const narrowed = computeDistribution(series, narrow, resolveRange(series, narrow));
    expect(narrowed.intervalWidthByDecile[0]?.meanWidthBasisPoints).toBeCloseTo(80, 6);
  });
});

describe("computeScatter", () => {
  it("builds ten equal-count deciles by rank of probability and an exact fit", () => {
    const length = 100;
    const probability = Array.from({ length }, (_, index) => (index + 0.5) / length);
    // realized = 2 * predicted + 1, so the fit must recover slope 2, intercept 1.
    const predicted = Array.from({ length }, (_, index) => index - 50);
    const realized = predicted.map((value) => 2 * value + 1);
    const quantiles = Array.from({ length: QUANTILE_COUNT }, (_, quantileIndex) =>
      quantileIndex === 3 ? predicted : Array.from({ length }, () => null),
    );
    const series = makeSeries({
      close: Array.from({ length }, () => 100),
      probabilityUp: probability,
      realizedReturnBasisPoints: realized,
      label: Array.from({ length }, (_, index) => (index >= 50 ? 1 : 0)),
      quantilesBasisPoints: quantiles as Array<Array<number | null>>,
      horizonBars: 1,
    });
    const manifest = makeManifest(series);
    const params = clampLensParams({}, manifest);
    const scatter = computeScatter(series, resolveRange(series, params));

    expect(scatter.points).toHaveLength(length);
    expect(scatter.sampled).toBe(false);
    expect(scatter.deciles).toHaveLength(10);
    expect(scatter.deciles.every((decile) => decile.count === 10)).toBe(true);
    expect(scatter.deciles[0]?.upRate).toBe(0);
    expect(scatter.deciles[9]?.upRate).toBe(1);
    expect(scatter.fit?.slope).toBeCloseTo(2, 10);
    expect(scatter.fit?.intercept).toBeCloseTo(1, 10);
    expect(scatter.fit?.rSquared).toBeCloseTo(1, 10);
    expect(scatter.fit?.n).toBe(length);
    // bias = mean(realized - predicted) = mean(predicted + 1) = -0.5 + 1.
    expect(scatter.fit?.bias.value).toBeCloseTo(0.5, 10);
    expect(scatter.reliability).toHaveLength(10);
    expect(scatter.reliability.reduce((sum, bin) => sum + bin.count, 0)).toBe(length);
  });

  it("thins the points with a deterministic stride once there are too many", () => {
    const length = 9000;
    const series = makeSeries({
      close: Array.from({ length }, () => 100),
      probabilityUp: Array.from({ length }, (_, index) => (index % 100) / 100),
      realizedReturnBasisPoints: Array.from({ length }, (_, index) => index % 37),
      horizonBars: 1,
    });
    const manifest = makeManifest(series);
    const params = clampLensParams({}, manifest);
    const first = computeScatter(series, resolveRange(series, params));
    const second = computeScatter(series, resolveRange(series, params));
    expect(first.sampled).toBe(true);
    expect(first.points.length).toBeLessThanOrEqual(4000);
    expect(first.points.map((point) => point.rowIndex)).toEqual(second.points.map((point) => point.rowIndex));
  });
});

describe("computeConfusion", () => {
  it("separates every labelled row from the rows the threshold would have acted on", () => {
    const probability = [0.9, 0.8, 0.55, 0.45, 0.2, 0.1];
    const label: Array<0 | 1> = [1, 0, 1, 0, 0, 1];
    const series = makeSeries({
      close: [100, 101, 102, 103, 104, 105],
      probabilityUp: probability,
      label,
      horizonBars: 1,
    });
    // 0.75 rather than 0.80: probabilityUp is a Float32Array, so a value
    // written as 0.2 is stored as 0.20000000298 and a `<= 0.2` gate would miss
    // it. Thresholds are never compared against an exactly representable edge.
    const manifest = makeManifest(series, { defaultThreshold: 0.75 });
    const params = clampLensParams({}, manifest);
    const winRate = proportionEstimate(1, 2, 1);
    const confusion = computeConfusion(series, params, resolveRange(series, params), winRate, 2, -3.5);

    expect(confusion.allRows.n).toBe(6);
    expect(confusion.allRows.counts).toEqual({
      truePositive: 2,
      falsePositive: 1,
      trueNegative: 2,
      falseNegative: 1,
    });
    expect(confusion.allRows.precisionUp).toBeCloseTo(2 / 3, 12);
    expect(confusion.allRows.recallUp).toBeCloseTo(2 / 3, 12);

    // Gated at 0.80: up on rows 0 and 1, down on rows 4 and 5.
    expect(confusion.gatedRows.n).toBe(4);
    expect(confusion.gatedRows.counts).toEqual({
      truePositive: 1,
      falsePositive: 1,
      trueNegative: 1,
      falseNegative: 1,
    });
    expect(confusion.explanation).toContain("win rate");
    expect(confusion.explanation).toContain("-$3.50");
  });
});

describe("buildBarWindow", () => {
  const length = 12;
  function windowSeries() {
    const series = makeSeries({
      close: Array.from({ length }, () => 100),
      probabilityUp: Array.from({ length }, (_, index) => (index === 0 ? 0.95 : 0.5)),
      quantilesBasisPoints: quantileGrid(length, 5, [-50, -40, -20, 0, 20, 40, 50]),
      horizonBars: 2,
    });
    const manifest = makeManifest(series, { defaultThreshold: 0.6 });
    return { series, manifest };
  }

  it("turns the selected coverage into prices and keeps the warmup null", () => {
    const { series, manifest } = windowSeries();
    const params = clampLensParams({ intervalCoverage: 0.9 }, manifest);
    const view = buildBarWindow(series, null, manifest, params, { startRowIndex: 0, endRowIndex: 11 }, 5000);

    expect(view.bars).toHaveLength(length);
    expect(view.totalBarsInRange).toBe(length);
    expect(view.truncated).toBe(false);
    expect(view.features).toBeNull();

    expect(view.bars[0]?.intervalLowerPrice).toBeNull();
    expect(view.bars[0]?.predictedQuantilesBasisPoints).toBeNull();
    expect(view.bars[5]?.intervalLowerPrice).toBeCloseTo(100 * Math.exp(-50 / 1e4), 8);
    expect(view.bars[5]?.intervalUpperPrice).toBeCloseTo(100 * Math.exp(50 / 1e4), 8);
    expect(view.bars[5]?.intervalMedianPrice).toBeCloseTo(100, 8);
    expect(view.bars[5]?.predictedQuantilesBasisPoints).toEqual([-50, -40, -20, 0, 20, 40, 50]);

    const half = clampLensParams({ intervalCoverage: 0.5 }, manifest);
    const halfView = buildBarWindow(series, null, manifest, half, { startRowIndex: 5, endRowIndex: 5 }, 5000);
    expect(halfView.bars[0]?.intervalLowerPrice).toBeCloseTo(100 * Math.exp(-20 / 1e4), 8);
    expect(halfView.bars[0]?.intervalUpperPrice).toBeCloseTo(100 * Math.exp(20 / 1e4), 8);
  });

  it("slices the derived state out of the full record instead of restarting it", () => {
    const { series, manifest } = windowSeries();
    const params = clampLensParams({}, manifest);
    const whole = buildBarWindow(series, null, manifest, params, { startRowIndex: 0, endRowIndex: 11 }, 5000);
    const slice = buildBarWindow(series, null, manifest, params, { startRowIndex: 1, endRowIndex: 3 }, 5000);

    expect(whole.bars[0]?.decision).toBe("enter_long");
    expect(slice.bars.map((bar) => bar.rowIndex)).toEqual([1, 2, 3]);
    // The trade opened on row 0, outside the slice, and the slice still knows it.
    expect(slice.bars[0]?.position).toBe(1);
    expect(slice.bars[1]?.decision).toBe("exit");
    expect(slice.bars.map((bar) => bar.cumulativeNetUsd)).toEqual(
      whole.bars.slice(1, 4).map((bar) => bar.cumulativeNetUsd),
    );
  });

  it("truncates the tail at maxBars and clamps a window that runs off the record", () => {
    const { series, manifest } = windowSeries();
    const params = clampLensParams({}, manifest);
    const view = buildBarWindow(series, null, manifest, params, { startRowIndex: -5, endRowIndex: 999 }, 4);
    expect(view.rowWindow).toEqual({ startRowIndex: 0, endRowIndex: 11 });
    expect(view.totalBarsInRange).toBe(12);
    expect(view.bars).toHaveLength(4);
    expect(view.truncated).toBe(true);
    expect(view.bars[3]?.rowIndex).toBe(3);
  });
});

describe("evaluateLens", () => {
  it("fills every view, marks what is unavailable and says why", () => {
    const length = 60;
    const series = makeSeries({
      close: Array.from({ length }, (_, index) => 100 + Math.sin(index / 3) * 2 + index * 0.05),
      probabilityUp: Array.from({ length }, (_, index) => 0.5 + Math.sin(index) * 0.3),
      label: Array.from({ length }, (_, index) => ((index % 3 === 0 ? 1 : 0) as 0 | 1)),
      realizedReturnBasisPoints: Array.from({ length }, (_, index) => Math.cos(index) * 12),
      horizonBars: 3,
      roundTripPoints: 1,
      pointValueUsd: 2,
    });
    const manifest = makeManifest(series, { defaultThreshold: 0.65 });
    const params = clampLensParams({}, manifest);
    const evaluation = evaluateLens(series, null, manifest, params);

    expect(evaluation.modelId).toBe("fixture");
    expect(evaluation.range.barCount).toBe(length);
    expect(evaluation.headline.barCount).toBe(length);
    expect(evaluation.headline.effectiveSampleSize).toBeCloseTo(length / 3, 12);
    expect(evaluation.headline.tradeCount).toBe(evaluation.headline.longCount + evaluation.headline.shortCount);
    expect(evaluation.headline.verdict.length).toBeGreaterThan(20);
    expect(evaluation.headline.hitRate.n).toBe(length);
    expect(evaluation.headline.winRate.method).toContain("moving-block bootstrap");
    expect(evaluation.trades.length).toBe(evaluation.headline.tradeCount);
    expect(evaluation.tradesTruncated).toBe(false);
    expect(evaluation.equity.length).toBe(length);
    expect(evaluation.equityDownsampled).toBe(false);
    expect(evaluation.availability.attribution.available).toBe(false);
    expect(evaluation.availability.attribution.reason).toContain("fixture");
    expect(evaluation.availability.prediction.available).toBe(false);
    expect(evaluation.availability.trades.available).toBe(true);
    expect(evaluation.attribution.families).toHaveLength(5);
    expect(evaluation.attribution.families.find((family) => family.family === "macro")?.featureCount).toBe(0);
    // No reference numbers on the fixture manifest, so no parity checks run.
    expect(evaluation.verification).toEqual([]);
  });

  it("is deterministic: the same inputs give the same intervals every call", () => {
    const length = 80;
    const series = makeSeries({
      close: Array.from({ length }, (_, index) => 100 + Math.sin(index / 5) * 4),
      probabilityUp: Array.from({ length }, (_, index) => 0.5 + Math.cos(index / 2) * 0.35),
      label: Array.from({ length }, (_, index) => ((index % 2 === 0 ? 1 : 0) as 0 | 1)),
      realizedReturnBasisPoints: Array.from({ length }, (_, index) => Math.sin(index) * 8),
      horizonBars: 2,
    });
    const manifest = makeManifest(series, { defaultThreshold: 0.7 });
    const params = clampLensParams({}, manifest);
    const first = evaluateLens(series, null, manifest, params);
    const second = evaluateLens(series, null, manifest, params);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("says plainly when no row cleared the threshold", () => {
    const series = makeSeries({
      close: [100, 101, 102, 103, 104, 105],
      probabilityUp: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
      horizonBars: 2,
    });
    const manifest = makeManifest(series, { defaultThreshold: 0.9 });
    const params = clampLensParams({}, manifest);
    const evaluation = evaluateLens(series, null, manifest, params);
    expect(evaluation.headline.tradeCount).toBe(0);
    expect(evaluation.headline.verdict).toContain("never traded");
    expect(evaluation.availability.trades.available).toBe(false);
    expect(evaluation.headline.winRate.value).toBeNull();
    expect(evaluation.headline.profitFactor.value).toBeNull();
  });
});
