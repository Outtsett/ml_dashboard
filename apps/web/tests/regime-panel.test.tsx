// @vitest-environment jsdom
/**
 * `apps/web/src/runs/analytics/RegimePanel.tsx` — the regime Monte Carlo
 * decision stack's panel, rendered from the real emitter's fixture line
 * (`tests/fixtures/cycle-events.jsonl`, `cycle_regime_forecast`): the fan and
 * Kronos' candles at the chosen bar, the gate's words, the feature weights, the
 * regime table, the scrubber moving the shared focus, and the hover text that
 * says how each number is computed.
 */
import "./setup";
import fs from "fs";
import path from "path";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { cycleRegimeForecastSchema } from "@shared/cycle/schema";
import { regimeForecastsOf } from "@shared/runs/view";
import { RegimePanel } from "@/runs/analytics/RegimePanel";

function forecasts() {
  const line = fs
    .readFileSync(path.join(__dirname, "..", "..", "..", "tests", "fixtures", "cycle-events.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((text) => JSON.parse(text) as { type: string })
    .find((event) => event.type === "cycle_regime_forecast");
  return regimeForecastsOf({ regimeForecasts: [cycleRegimeForecastSchema.parse(line)] });
}

/** The forecast as a run recorded before the regimes had names wrote it: numbered regimes, no names, no feature means. */
function numberedRegimes<T extends { regimeNames?: string[]; regimes: object[]; mostLikelyRegime: unknown[] }>(forecast: T, numbers: number[]) {
  const legacy: Record<string, unknown> = { ...forecast, mostLikelyRegime: numbers };
  delete legacy.regimeNames;
  legacy.regimes = forecast.regimes.map((regime) => {
    const plain: Record<string, unknown> = { ...regime };
    for (const key of ["name", "featureMeans", "expectedBarsPerVisit", "description"]) delete plain[key];
    return plain;
  });
  return legacy as unknown as T;
}

describe("RegimePanel", () => {
  it("says what it would show when the model sends no regime forecasts", () => {
    render(<RegimePanel forecasts={[]} modelLabel="XGBoost" focusTime={null} onFocusTime={() => undefined} />);
    expect(screen.getByTestId("regime-forecast").textContent).toContain("XGBoost sends no regime forecasts");
  });

  it("draws the fan with Kronos' candles, the gate, the weights and the regimes at the chosen bar", () => {
    const folds = forecasts();
    const { container } = render(<RegimePanel forecasts={folds} modelLabel="Regime Monte Carlo decision stack" focusTime={folds[0]!.timestamps[0]!} onFocusTime={() => undefined} />);
    const text = screen.getByTestId("regime-forecast").textContent ?? "";
    expect(text).toContain("bar 1 of 2");
    expect(text).toContain("● open: the engine may enter");
    expect(text).toContain("downtrend regime probability");
    expect(text).toContain("finbert sentiment decayed short");
    // the three regimes by name, each with its glyph, in the legend, the table and the transition matrix
    for (const label of ["— flat", "▲ uptrend", "▼ downtrend"]) expect(text).toContain(label);
    expect(screen.getByTestId("regime-now").textContent).toContain("— flat");
    const table = screen.getByTestId("regime-table");
    expect([...table.querySelectorAll("tbody tr")].map((row) => row.querySelector("td")!.textContent)).toEqual(["— flat", "▲ uptrend", "▼ downtrend"]);
    expect(table.textContent).toContain("bars per visit");
    const means = screen.getByTestId("regime-feature-means");
    expect(means.querySelectorAll("tbody tr")).toHaveLength(8);
    expect(means.textContent).toContain("Average directional index (ADX 14)");
    expect(means.textContent).toContain("16.40");                       // the flat regime's mean ADX in the fixture
    const matrix = screen.getByTestId("regime-transition-matrix");
    expect(matrix.textContent).toContain("from — flat");
    expect(matrix.textContent).toContain("to ▼ downtrend");
    // fixed Okabe-Ito colours: flat sky, uptrend orange, downtrend blue
    const swatches = [...table.querySelectorAll("tbody tr td:first-child span.inline-block")].map((node) => (node as HTMLElement).style.backgroundColor);
    expect(swatches).toEqual(["rgb(86, 180, 233)", "rgb(230, 159, 0)", "rgb(0, 114, 178)"]);
    const svg = container.querySelector('svg[aria-label="Monte Carlo fan and Kronos candles"]');
    expect(svg).not.toBeNull();
    expect(svg!.querySelectorAll("rect")).toHaveLength(3);              // one candle body per step of the horizon
    expect(svg!.querySelector("polygon")).not.toBeNull();               // the 10th-90th percentile band
    const hovers = [...container.querySelectorAll("[title]")].map((node) => node.getAttribute("title") ?? "");
    expect(hovers.some((title) => title.includes("How it is computed") && title.includes("forward-filtered"))).toBe(true);
    expect(hovers.some((title) => title.startsWith("Trade gate") && title.includes("≥ decision_threshold"))).toBe(true);
  });

  it("moves the shared focus when the scrubber moves, and shows the closed gate in words", () => {
    const folds = forecasts();
    const onFocusTime = vi.fn();
    const { rerender } = render(<RegimePanel forecasts={folds} modelLabel={null} focusTime={null} onFocusTime={onFocusTime} />);
    fireEvent.change(screen.getByLabelText("chosen bar"), { target: { value: "0" } });
    expect(onFocusTime).toHaveBeenCalledWith(folds[0]!.timestamps[0]);
    rerender(<RegimePanel forecasts={folds} modelLabel={null} focusTime={folds[0]!.timestamps[1]!} onFocusTime={onFocusTime} />);
    expect(screen.getByTestId("regime-forecast").textContent).toContain("○ closed: the engine stands aside");
    expect(screen.getByTestId("regime-now").textContent).toContain("▼ downtrend");
  });

  it("still draws a run recorded before the regimes had names", () => {
    const legacy = numberedRegimes(forecasts()[0]!, [1, 3]);
    render(<RegimePanel forecasts={[legacy]} modelLabel={null} focusTime={legacy.timestamps[1]!} onFocusTime={() => undefined} />);
    const text = screen.getByTestId("regime-forecast").textContent ?? "";
    expect(text).toContain("1 regime 1");
    expect(screen.getByTestId("regime-now").textContent).toContain("3 regime 3");
    expect(screen.queryByTestId("regime-feature-means")).toBeNull();
  });
});
