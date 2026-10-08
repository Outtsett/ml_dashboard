/**
 * `cycle_regime_forecast` on the TypeScript side: the schema accepts what the
 * Python emitter writes (the fixture line was made by
 * `protocol.emit_cycle_regime_forecast`), stretches of one fold merge exactly as
 * the engine merges them into `regime_forecasts.json`, the run view strips the
 * envelope and orders folds, the run page gives the model its own family, and
 * every number the panel shows has a written computation.
 */
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

import { cycleRegimeForecastSchema, mergeRegimeForecast, REGIME_FORECAST_COLUMNS, type CycleRegimeForecast } from "@shared/cycle/schema";
import { regimeForecastsOf } from "@shared/runs/view";
import { REGIME_DEFINITIONS } from "@shared/runs/regimeDefinitions";
import { analyticsFamilyOf, FAMILY_PANELS } from "../../apps/web/src/runs/analytics/families";

const FIXTURE = path.join(__dirname, "..", "fixtures", "cycle-events.jsonl");

function fixtureForecast(): CycleRegimeForecast {
  const line = fs
    .readFileSync(FIXTURE, "utf8")
    .trim()
    .split("\n")
    .map((text) => JSON.parse(text) as { type: string })
    .find((event) => event.type === "cycle_regime_forecast");
  expect(line).toBeDefined();
  const parsed = cycleRegimeForecastSchema.safeParse(line);
  expect(parsed.success).toBe(true);
  return parsed.data!;
}

describe("cycle_regime_forecast", () => {
  it("accepts the line the Python emitter wrote, nulls where Kronos had no value", () => {
    const forecast = fixtureForecast();
    expect(forecast.regimeCount).toBe(2);
    expect(forecast.timestamps).toHaveLength(2);
    expect(forecast.monteCarloPercentile10Points[0]).toHaveLength(forecast.horizonBars);
    expect(forecast.kronosHigh[1]![2]).toBeNull();
    expect(forecast.mostLikelyRegime).toEqual([1, 2]);
  });

  it("refuses a stretch whose gate column is not a list of booleans", () => {
    const broken = { ...fixtureForecast(), gateOpen: [1, 0] };
    expect(cycleRegimeForecastSchema.safeParse(broken).success).toBe(false);
  });

  it("merges stretches of a fold in arrival order and keeps folds apart", () => {
    const first = fixtureForecast();
    const second: CycleRegimeForecast = {
      ...first,
      decisionThreshold: 0.05,
      timestamps: [1735701900],
      close: [21510],
      regimeProbabilities: [[0.1, 0.9]],
      mostLikelyRegime: [2],
      monteCarloProbabilityUp: [0.4],
      monteCarloExpectedMovePoints: [-2],
      monteCarloPercentile10Points: [[-1, -2, -3]],
      monteCarloPercentile50Points: [[0, 0, 0]],
      monteCarloPercentile90Points: [[1, 2, 3]],
      kronosOpen: [[1, 2, 3]],
      kronosHigh: [[1, 2, 3]],
      kronosLow: [[1, 2, 3]],
      kronosClose: [[1, 2, 3]],
      kronosPredictedMovePoints: [-1],
      decisionProbabilityUp: [0.45],
      gateOpen: [true],
    };
    const otherFold: CycleRegimeForecast = { ...first, foldIndex: 1 };
    const folds: CycleRegimeForecast[] = [];
    mergeRegimeForecast(folds, first);
    mergeRegimeForecast(folds, second);
    mergeRegimeForecast(folds, otherFold);
    expect(folds).toHaveLength(2);
    for (const column of REGIME_FORECAST_COLUMNS) expect(folds[0]![column]).toHaveLength(3);
    expect(folds[0]!.timestamps).toEqual([...first.timestamps, 1735701900]);
    expect(folds[0]!.decisionThreshold).toBe(0.05); // constants follow the latest stretch
    expect(first.timestamps).toHaveLength(2); // the first stretch itself is never mutated
  });

  it("enters the run view without its envelope, folds in order", () => {
    const forecast = fixtureForecast();
    const view = regimeForecastsOf({ regimeForecasts: [{ ...forecast, foldIndex: 2 }, forecast] });
    expect(view.map((fold) => fold.foldIndex)).toEqual([0, 2]);
    expect("seq" in view[0]!).toBe(false);
    expect("run_id" in view[0]!).toBe(false);
    expect(regimeForecastsOf({})).toEqual([]);
  });

  it("gives the model its own run-page family with the regime panel", () => {
    expect(analyticsFamilyOf("Regime simulation decision stack", "regime_montecarlo_decision")).toBe("regime");
    expect(FAMILY_PANELS.regime[0]).toBe("regime_forecast");
    expect(analyticsFamilyOf("Trees", "xgboost")).toBe("trees");
  });

  it("writes down how every number on the panel is computed", () => {
    for (const name of [
      "regime_probability", "monte_carlo_fan", "monte_carlo_probability_up", "monte_carlo_expected_move_points",
      "kronos_candles", "kronos_predicted_move_points", "decision_probability_up", "trade_gate", "feature_weight",
      "regime_summary", "transition_matrix",
    ]) {
      expect(REGIME_DEFINITIONS[name]?.how.length ?? 0).toBeGreaterThan(80);
      expect(REGIME_DEFINITIONS[name]?.formula.length ?? 0).toBeGreaterThan(5);
    }
  });
});
