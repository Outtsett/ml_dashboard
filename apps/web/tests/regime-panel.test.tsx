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
    expect(text).toContain("regime 2 probability");
    expect(text).toContain("finbert sentiment decayed short");
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
  });
});
