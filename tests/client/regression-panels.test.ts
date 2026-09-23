/**
 * The pure halves of the regression tab that run where no test can watch
 * them live: the panel assembly the Web Worker runs, and the side panel's
 * width clamp.
 */

import { describe, expect, it } from "vitest";
import type { OhlcvData } from "../../src/client/src/market/components/types";
import {
  assemblePanelVariables,
  barsKey,
  computePanels,
  panelBuffers,
  selectLakeVariables,
  type AlignedColumns,
} from "../../src/client/src/market/regression/panels";
import {
  CHART_MINIMUM_PIXELS,
  SIDE_PANEL_MINIMUM_PIXELS,
  clampSidePanelWidth,
  maximumSidePanelWidth,
  minimumSidePanelWidth,
} from "../../src/client/src/shared/layout/ResizableSidePanel";
import type { RegressionVariable } from "../../src/shared/regression/types";

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
