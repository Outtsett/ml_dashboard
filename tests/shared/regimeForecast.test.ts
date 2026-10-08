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
import {
  REGIME_DEFINITIONS,
  REGIME_FEATURE_WORDS,
  REGIME_NAMES,
  REGIME_STYLES,
  isRegimeName,
  regimeLabel,
  regimePosition,
  regimeStyleAt,
} from "@shared/runs/regimeDefinitions";
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

describe("cycle_regime_forecast", () => {
  it("accepts the line the Python emitter wrote, nulls where Kronos had no value", () => {
    const forecast = fixtureForecast();
    expect(forecast.regimeCount).toBe(3);
    expect(forecast.regimeNames).toEqual(["flat", "uptrend", "downtrend"]);
    expect(forecast.regimes.map((regime) => regime.name)).toEqual(forecast.regimeNames);
    expect(forecast.regimes[0]!.featureMeans).toHaveLength(8);
    expect(forecast.regimes[0]!.expectedBarsPerVisit).toBeCloseTo(1 / (1 - forecast.regimes[0]!.stayProbability), 9);
    expect(forecast.regimes[0]!.description).toMatch(/^flat: on average/);
    expect(forecast.timestamps).toHaveLength(2);
    expect(forecast.monteCarloPercentile10Points[0]).toHaveLength(forecast.horizonBars);
    expect(forecast.kronosHigh[1]![2]).toBeNull();
    expect(forecast.mostLikelyRegime).toEqual(["flat", "downtrend"]);
  });

  it("still reads a run recorded before the regimes had names (numbered regimes, no regimeNames)", () => {
    const legacy = numberedRegimes(fixtureForecast(), [1, 3]);
    const parsed = cycleRegimeForecastSchema.safeParse(legacy);
    expect(parsed.success).toBe(true);
    expect(parsed.data!.regimeNames).toBeUndefined();
    expect(regimePosition(parsed.data!.regimeNames, parsed.data!.mostLikelyRegime[1])).toBe(2);
    expect(regimeStyleAt(parsed.data!.regimeNames, 2).word).toBe("regime 3");
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
      regimeProbabilities: [[0.1, 0.8, 0.1]],
      mostLikelyRegime: ["uptrend"],
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
      "regime_probability", "regime_most_likely", "regime_features", "regime_training", "monte_carlo_fan", "monte_carlo_probability_up", "monte_carlo_expected_move_points",
      "kronos_candles", "kronos_predicted_move_points", "decision_probability_up", "trade_gate", "feature_weight",
      "regime_summary", "transition_matrix",
    ]) {
      expect(REGIME_DEFINITIONS[name]?.how.length ?? 0).toBeGreaterThan(80);
      expect(REGIME_DEFINITIONS[name]?.formula.length ?? 0).toBeGreaterThan(5);
    }
  });
});

describe("the three regimes", () => {
  it("are exactly flat, uptrend, downtrend, in the engine's order", () => {
    expect([...REGIME_NAMES]).toEqual(["flat", "uptrend", "downtrend"]);
    expect(Object.keys(REGIME_STYLES)).toEqual(["flat", "uptrend", "downtrend"]);
    expect(isRegimeName("uptrend")).toBe(true);
    expect(isRegimeName("regime 1")).toBe(false);
  });

  it("carry fixed Okabe-Ito colours, each with its own glyph and word", () => {
    expect(REGIME_STYLES.flat).toMatchObject({ color: "#56B4E9", glyph: "—", word: "flat" });
    expect(REGIME_STYLES.uptrend).toMatchObject({ color: "#E69F00", glyph: "▲", word: "uptrend" });
    expect(REGIME_STYLES.downtrend).toMatchObject({ color: "#0072B2", glyph: "▼", word: "downtrend" });
    // three distinct colours and three distinct glyphs: neither is ever the only signal
    expect(new Set(REGIME_NAMES.map((name) => REGIME_STYLES[name].color)).size).toBe(3);
    expect(new Set(REGIME_NAMES.map((name) => REGIME_STYLES[name].glyph)).size).toBe(3);
    expect(regimeLabel(REGIME_STYLES.downtrend)).toBe("▼ downtrend");
    for (const name of REGIME_NAMES) expect(REGIME_STYLES[name].meaning.length).toBeGreaterThan(40);
  });

  it("resolve by name wherever a forecast names them, and by number for an older run", () => {
    const names = ["flat", "uptrend", "downtrend"];
    expect(regimeStyleAt(names, 1)).toBe(REGIME_STYLES.uptrend);
    expect(regimePosition(names, "downtrend")).toBe(2);
    expect(regimePosition(names, null)).toBeNull();
    expect(regimePosition(names, "sideways")).toBeNull();
    expect(regimePosition(undefined, 2)).toBe(1);
    expect(regimeStyleAt(undefined, 0)).toMatchObject({ word: "regime 1", glyph: "1" });
  });

  it("put every observation feature of the model into words with a unit", () => {
    const fixture = fixtureForecast();
    for (const item of fixture.regimes[0]!.featureMeans!) {
      expect(REGIME_FEATURE_WORDS[item.name]?.words.length ?? 0).toBeGreaterThan(10);
      expect(REGIME_FEATURE_WORDS[item.name]?.unit.length ?? 0).toBeGreaterThan(2);
    }
    expect(Object.keys(REGIME_FEATURE_WORDS)).toHaveLength(8);
  });
});
