// @vitest-environment jsdom
import "../setup";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("lightweight-charts", () => {
  const makeSeries = () => ({ setData: vi.fn(), applyOptions: vi.fn(), createPriceLine: vi.fn(() => ({ applyOptions: vi.fn() })) });
  const makePane = () => ({ setStretchFactor: vi.fn() });
  const chart = {
    addSeries: vi.fn(() => makeSeries()),
    panes: vi.fn(() => [makePane(), makePane()]),
    applyOptions: vi.fn(),
    setCrosshairPosition: vi.fn(),
    clearCrosshairPosition: vi.fn(),
    remove: vi.fn(),
  };
  return {
    createChart: vi.fn(() => chart),
    LineSeries: "Line",
    AreaSeries: "Area",
    LineStyle: { Solid: 0, Dotted: 1, Dashed: 2 },
    ColorType: { Solid: "solid", VerticalGradient: "gradient" },
  };
});

import { EquityLens } from "../../../src/client/src/lens/charts/EquityLens";
import { FIXTURE_MODEL, makeEquity, makeHeadline, makeManifest } from "./fixtures";

afterEach(() => cleanup());

describe("EquityLens", () => {
  it("renders inside its own LensFrame with the question and a basis line carrying trade count, exposure and drawdown", () => {
    render(<EquityLens equity={makeEquity(5)} headline={makeHeadline()} manifest={makeManifest()} cursorTimestampSeconds={null} height={200} />);
    expect(screen.getByTestId("equity-lens")).toBeInTheDocument();
    expect(screen.getByText(/Would simply holding the contract have done better/)).toBeInTheDocument();
    const frame = screen.getByTestId("equity-lens").textContent ?? "";
    expect(frame).toContain(`${FIXTURE_MODEL.tradeCount.toLocaleString()} trades`);
    expect(frame).toContain("exposure");
    expect(frame).toContain("max drawdown");
    expect(screen.getByTestId("equity-lens-chart")).toBeInTheDocument();
  });

  it("shows the model-vs-buy-and-hold edge with a glyph, not color alone", () => {
    render(<EquityLens equity={makeEquity(3)} headline={makeHeadline({ buyHoldNetUsd: 0 })} manifest={makeManifest()} cursorTimestampSeconds={null} height={200} />);
    const text = screen.getByTestId("equity-lens").textContent ?? "";
    expect(text).toMatch(/[▲▼]/);
    expect(text).toContain("vs holding");
  });
});
