// @vitest-environment jsdom
import "../setup";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

// jsdom has no canvas, so lightweight-charts (which draws to canvas on
// construction) cannot run here. This mock proves PriceLens wires its data
// into the chart/series API correctly without asking jsdom to rasterize.
const addSeriesCalls: unknown[] = [];
const setDataCalls: Array<{ callIndex: number; data: unknown }> = [];
let seriesCallIndex = 0;

vi.mock("lightweight-charts", () => {
  const makeSeries = () => {
    const index = seriesCallIndex++;
    return {
      setData: vi.fn((data: unknown) => setDataCalls.push({ callIndex: index, data })),
      applyOptions: vi.fn(),
      createPriceLine: vi.fn(() => ({ applyOptions: vi.fn() })),
      // The volume histogram sets its own scale margins (PriceLens.tsx).
      priceScale: vi.fn(() => ({ applyOptions: vi.fn() })),
    };
  };
  const makePane = () => ({ setStretchFactor: vi.fn() });
  const chart = {
    addSeries: vi.fn((...args: unknown[]) => {
      addSeriesCalls.push(args);
      return makeSeries();
    }),
    panes: vi.fn(() => [makePane(), makePane(), makePane()]),
    subscribeClick: vi.fn(),
    unsubscribeClick: vi.fn(),
    applyOptions: vi.fn(),
    setCrosshairPosition: vi.fn(),
    clearCrosshairPosition: vi.fn(),
    remove: vi.fn(),
  };
  return {
    createChart: vi.fn(() => chart),
    createSeriesMarkers: vi.fn(() => ({ setMarkers: vi.fn() })),
    CandlestickSeries: "Candlestick",
    LineSeries: "Line",
    HistogramSeries: "Histogram",
    AreaSeries: "Area",
    LineStyle: { Solid: 0, Dotted: 1, Dashed: 2 },
    ColorType: { Solid: "solid", VerticalGradient: "gradient" },
  };
});

import { PriceLens, type LensPriceLayers } from "@/lens/charts/PriceLens";
import { makeBar, makeBarWindow, makeManifest, makeRegimes, makeTrade } from "./fixtures";

afterEach(() => cleanup());

const ALL_LAYERS: LensPriceLayers = { interval: true, trades: true, regimes: true, probability: true };

describe("PriceLens", () => {
  it("mounts, creates the three panes' worth of series, and pushes candle data through", () => {
    const bars = [
      makeBar({ rowIndex: 0, timestampSeconds: 1000, decision: "enter_long" }),
      makeBar({ rowIndex: 1, timestampSeconds: 1060 }),
    ];
    const barWindow = makeBarWindow({}, bars);
    render(
      <PriceLens
        window={barWindow}
        trades={[makeTrade({ entryRowIndex: 0 })]}
        regimes={makeRegimes()}
        manifest={makeManifest()}
        layers={ALL_LAYERS}
        cursorRowIndex={0}
        height={300}
      />,
    );

    expect(screen.getByTestId("price-lens-chart")).toBeInTheDocument();
    // candle + 3 interval lines + probability + regime = 6 series, at minimum.
    expect(addSeriesCalls.length).toBeGreaterThanOrEqual(6);
    expect(setDataCalls.length).toBeGreaterThan(0);
  });

  it("renders the legend naming every series and its encoding", () => {
    const barWindow = makeBarWindow();
    render(
      <PriceLens
        window={barWindow}
        trades={[]}
        regimes={makeRegimes()}
        manifest={makeManifest()}
        layers={ALL_LAYERS}
        cursorRowIndex={null}
        height={300}
      />,
    );
    const legend = screen.getByTestId("price-lens").textContent ?? "";
    expect(legend).toContain("up bar");
    expect(legend).toContain("down bar");
    expect(legend).toContain("interval for price");
    expect(legend).toContain("P(up)");
    expect(legend).toContain("enter long");
    expect(legend).toContain("enter short");
    expect(legend).toContain("bull regime");
    expect(legend).toContain("bear regime");
    expect(legend).toContain("sideways regime");
    expect(legend).toContain("Time axis: UTC");
  });
});
