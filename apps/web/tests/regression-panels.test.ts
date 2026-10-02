/**
 * The pure halves of the regression tab that run where no test can watch
 * them live: the panel assembly the Web Worker runs, and the side panel's
 * width clamp.
 */

import { describe, expect, it } from "vitest";
import type { OhlcvData } from "@/market/components/types";
import {
  assemblePanelVariables,
  barEncodings,
  barsKey,
  computePanels,
  inflateTrend,
  TREND_EVALUATION_POINTS,
  panelBuffers,
  panelContext,
  selectLakeVariables,
  type AlignedColumns,
} from "@/market/regression/panels";
import { pointStyle } from "@/market/regression/encoding";
import { trendShape } from "@/market/regression/ScatterPanel";
import { buildPairs, fitSimpleRegression, localLinearTrend } from "@shared/regression/index";
import { createRandom } from "@shared/lens/bootstrap";
import {
  CHART_MINIMUM_PIXELS,
  SIDE_PANEL_MINIMUM_PIXELS,
  clampSidePanelWidth,
  maximumSidePanelWidth,
  minimumSidePanelWidth,
} from "../src/shared/layout/ResizableSidePanel";
import type { RegressionVariable } from "@shared/regression/types";

function makeBars(count: number): OhlcvData[] {
  return Array.from({ length: count }, (_, index) => {
    const close = 100 + Math.sin(index / 7) * 5 + index * 0.05;
    return {
      timestamp: 1_700_000_000_000 + index * 60_000,
      open: close - 0.3,
      high: close + 1 + (index % 3),
      low: close - 1 - (index % 2),
      close,
      volume: 1000 + ((index * 37) % 500),
    };
  });
}

const lakeVariable = (id: string, overrides: Partial<RegressionVariable> = {}): RegressionVariable => ({
  id,
  object: "mnq_indicators_norm_1m",
  column: id.split(":")[2] as string,
  label: id,
  family: "momentum",
  valueShape: "centered_unbounded",
  forwardLooking: false,
  priceLevel: false,
  objectTimeframe: "1m",
  nullFraction: 0,
  bucketing: "exact",
  bucketingNote: null,
  ...overrides,
});

describe("assemblePanelVariables", () => {
  const bars = makeBars(300);
  const lake = [lakeVariable("lake:mnq_indicators_norm_1m:rsi_14")];
  const aligned: AlignedColumns = {
    barsKey: barsKey(bars),
    columns: new Map([
      ["lake:mnq_indicators_norm_1m:rsi_14", { id: "lake:mnq_indicators_norm_1m:rsi_14", values: bars.map((_, index) => index % 50), matchedBars: 300 }],
    ]),
  };

  it("puts the bar variables first, then the lake columns aligned to these bars", () => {
    const variables = assemblePanelVariables(bars, lake, aligned);
    expect(variables.filter((variable) => variable.source === "bar").length).toBe(12);
    expect(variables.at(-1)?.id).toBe("lake:mnq_indicators_norm_1m:rsi_14");
  });

  it("refuses lake columns aligned to a different bar window", () => {
    const stale: AlignedColumns = { ...aligned, barsKey: barsKey(makeBars(299)) };
    const variables = assemblePanelVariables(bars, lake, stale);
    expect(variables.some((variable) => variable.source === "lake")).toBe(false);
  });

  it("carries the bucketing note into the label", () => {
    const noted = [lakeVariable("lake:mnq_indicators_norm_1m:rsi_14", { bucketing: "last", bucketingNote: "last 1m value in each 1h bar" })];
    const variables = assemblePanelVariables(bars, noted, aligned);
    expect(variables.at(-1)?.label).toBe("lake:mnq_indicators_norm_1m:rsi_14 (last 1m value in each 1h bar)");
  });

  it("filters forward-looking and price-level columns unless asked", () => {
    const all = [
      lakeVariable("lake:a:plain"),
      lakeVariable("lake:a:future", { forwardLooking: true }),
      lakeVariable("lake:a:price", { priceLevel: true }),
    ];
    expect(selectLakeVariables(all, { includeForwardLooking: false, includePriceLevel: false }).map((variable) => variable.id)).toEqual(["lake:a:plain"]);
    expect(selectLakeVariables(all, { includeForwardLooking: true, includePriceLevel: true })).toHaveLength(3);
  });
});

describe("computePanels, as the worker runs it", () => {
  const bars = makeBars(400);
  const variables = assemblePanelVariables(bars, [], undefined);
  const panels = computePanels(
    bars.map((bar) => bar.close),
    variables,
    { mode: "forward_return", horizonBars: 3, confidenceLevel: 0.95, cookCutoff: "four_over_n", refitWithoutFlagged: true },
    { timestampsMilliseconds: bars.map((bar) => bar.timestamp), barMilliseconds: 60_000 },
  );

  it("returns one panel per variable, without the raw values, with the bar count", () => {
    expect(panels).toHaveLength(variables.length);
    for (const panel of panels) {
      expect("values" in panel.variable).toBe(false);
      expect(panel.variable.barCount).toBe(400);
    }
  });

  it("gives every fitted panel a q-value", () => {
    const fitted = panels.filter((panel) => panel.result.ok);
    expect(fitted.length).toBeGreaterThan(0);
    for (const panel of fitted) expect(panel.qValue).not.toBeNull();
  });

  it("lists every typed-array buffer once, for a zero-copy transfer", () => {
    const buffers = panelBuffers(panels);
    expect(new Set(buffers).size).toBe(buffers.length);
    expect(buffers.length).toBeGreaterThan(panels.length * 3);
  });
});

describe("side panel width clamp", () => {
  it("keeps the panel at least its minimum and the chart at least its minimum", () => {
    expect(clampSidePanelWidth(100, 1600)).toBe(SIDE_PANEL_MINIMUM_PIXELS);
    expect(clampSidePanelWidth(5000, 1600)).toBe(1600 - CHART_MINIMUM_PIXELS);
    expect(clampSidePanelWidth(800, 1600)).toBe(800);
  });

  it("shares a row too narrow for both minimums evenly", () => {
    // 600 px cannot hold 380 + 360: each side gets half.
    expect(minimumSidePanelWidth(600)).toBe(300);
    expect(maximumSidePanelWidth(600)).toBe(300);
    expect(clampSidePanelWidth(900, 600)).toBe(300);
    expect(clampSidePanelWidth(100, 600)).toBe(300);
  });

  it("keeps both minimums at the Electron floor (1024 px window, 256 px nav)", () => {
    const available = 1024 - 256;
    expect(minimumSidePanelWidth(available)).toBe(SIDE_PANEL_MINIMUM_PIXELS);
    expect(available - maximumSidePanelWidth(available)).toBe(CHART_MINIMUM_PIXELS);
  });
});

describe("the scatter's context and encodings", () => {
  const bars = makeBars(600);
  const close = bars.map((bar) => bar.close);
  const volume = bars.map((bar) => bar.volume);
  const pairs = buildPairs(close, volume, { mode: "level", horizonBars: 1 });
  const result = fitSimpleRegression(pairs.x, pairs.y, { confidenceLevel: 0.95 });
  if (!result.ok) throw new Error(result.reason);
  const fit = result.fit;

  it("builds density, local trend and both marginals; groups only on request", () => {
    const context = panelContext(pairs, fit, false);
    expect(context.density).not.toBeNull();
    expect(context.trend).not.toBeNull();
    expect(context.marginalX?.total).toBe(pairs.x.length);
    expect(context.marginalY?.total).toBe(pairs.y.length);
    expect(context.clusters).toBeNull();
    expect(context.autocorrelationInflation).toBeGreaterThanOrEqual(1);
    const grouped = panelContext(pairs, fit, true);
    expect(grouped.clusters?.labels.length).toBe(pairs.x.length);
  });

  it("widens the local band and slope errors by the autocorrelation factor, around the same curve", () => {
    const trend = localLinearTrend(pairs.x, pairs.y)!;
    const wide = inflateTrend(trend, 2);
    expect(wide.fitted).toEqual(trend.fitted);
    const index = 20;
    expect((wide.upper[index] as number) - (wide.fitted[index] as number)).toBeCloseTo(2 * ((trend.upper[index] as number) - (trend.fitted[index] as number)), 9);
    expect(wide.slopeStandardError[index]).toBeCloseTo(2 * (trend.slopeStandardError[index] as number), 12);
    expect(inflateTrend(trend, 0.7)).toBe(trend);
  });

  it("ranks volatility and volume per bar, leaving volatility's warm-up missing", () => {
    const encodings = barEncodings(bars);
    expect(encodings.volume.length).toBe(bars.length);
    expect(Number.isNaN(encodings.volatility[5] as number)).toBe(true);
    expect(Number.isNaN(encodings.volatilityRank[5] as number)).toBe(true);
    const finite = Array.from(encodings.volumeRank).filter(Number.isFinite);
    // Tied volumes share a midrank, so the ends sit just inside 0 and 1.
    expect(Math.min(...finite)).toBeGreaterThanOrEqual(0);
    expect(Math.min(...finite)).toBeLessThan(0.01);
    expect(Math.max(...finite)).toBeLessThanOrEqual(1);
    expect(Math.max(...finite)).toBeGreaterThan(0.99);
  });

  it("colours by time in bar order, by residual around the line, by group from the labels", () => {
    const encodings = barEncodings(bars);
    const byTime = pointStyle({ colorBy: "time", sizeBy: "none", encodings }, pairs, fit, null);
    expect(byTime.bucketOf(0)).toBe(0);
    expect(byTime.bucketOf(pairs.x.length - 1)).toBe(byTime.bucketCount - 1);
    const byResidual = pointStyle({ colorBy: "residual", sizeBy: "residual", encodings }, pairs, fit, null);
    const middle = (byResidual.bucketCount - 1) / 2;
    const above = Array.from(fit.studentizedExternal).findIndex((value) => value > 3);
    if (above >= 0) expect(byResidual.bucketOf(above)).toBe(byResidual.bucketCount - 1);
    const onLine = Array.from(fit.studentizedExternal).findIndex((value) => Math.abs(value) < 0.01);
    if (onLine >= 0) expect(byResidual.bucketOf(onLine)).toBe(middle);
    expect(byResidual.sizeOf(0)).toBeGreaterThan(0);
    const clusters = panelContext(pairs, fit, true).clusters!;
    const byGroup = pointStyle({ colorBy: "cluster", sizeBy: "none", encodings }, pairs, fit, clusters);
    expect(byGroup.bucketCount).toBe(clusters.k);
    expect(byGroup.bucketOf(7)).toBe(clusters.labels[7]);
  });

  it("calls a V-shaped relationship reversing and a fanning one uneven", () => {
    const x = Array.from({ length: 800 }, (_, index) => (index / 800) * 10 - 5);
    const unit = x.map((_, index) => (index % 2 === 0 ? 1 : -1));
    const vShape = x.map((value, index) => Math.abs(value) + 0.05 * (unit[index] as number));
    const flat = fitSimpleRegression(x, vShape, { confidenceLevel: 0.95 });
    if (!flat.ok) throw new Error(flat.reason);
    const shape = trendShape(localLinearTrend(x, vShape, { residuals: flat.fit.residuals }));
    expect(shape?.reverses).toBe(true);
    const fanning = x.map((value, index) => 0.3 * value + (unit[index] as number) * (0.1 + Math.abs(value + 5)));
    const fanFit = fitSimpleRegression(x, fanning, { confidenceLevel: 0.95 });
    if (!fanFit.ok) throw new Error(fanFit.reason);
    const fan = trendShape(localLinearTrend(x, fanning, { residuals: fanFit.fit.residuals }));
    expect(fan?.reverses).toBe(false);
    expect(fan?.spreadRatio).toBeGreaterThan(2.5);
  });
});

describe("the reverses badge on noise", () => {
  it("fires on under 6% of panels where X and Y are independent", () => {
    const random = createRandom(20260923);
    const normal = () => Math.sqrt(-2 * Math.log(Math.max(1e-12, random()))) * Math.cos(2 * Math.PI * random());
    const runs = 250;
    let fired = 0;
    for (let run = 0; run < runs; run += 1) {
      const x = Float64Array.from({ length: 2000 }, normal);
      const y = Float64Array.from({ length: 2000 }, normal);
      const fit = fitSimpleRegression(x, y, { confidenceLevel: 0.95 });
      if (!fit.ok) continue;
      const trend = localLinearTrend(x, y, { residuals: fit.fit.residuals, parameterSamples: 32, evaluationPoints: TREND_EVALUATION_POINTS });
      if (trendShape(trend)?.reverses) fired += 1;
    }
    expect(fired / runs).toBeLessThan(0.06);
  }, 60_000);
});
