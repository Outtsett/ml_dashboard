/**
 * The regimes of a run on the Market chart: `apps/web/src/cycle/regimes.ts`
 * (the per-bar most likely regime the candles are painted with), the cycle
 * store feeding it from the live `cycle_regime_forecast` stretches, a server
 * snapshot and a recorded run's forecasts, and the candle width the repaint
 * uses. The fixture line was made by the Python emitter
 * (`tests/fixtures/cycle-events.jsonl`).
 */
import fs from "fs";
import path from "path";
import { beforeEach, describe, expect, it } from "vitest";

import { cycleRegimeForecastSchema, type CycleRegimeForecast, type CycleSnapshot } from "@shared/cycle/schema";
import { REGIME_STYLES } from "@shared/runs/regimeDefinitions";
import { candleBodyWidth } from "@/cycle/chartBands";
import { appendRegimeForecast, emptyRunRegimes, regimeShares, regimeStyleOfBar, regimesOf } from "@/cycle/regimes";
import { useCycleStore } from "@/cycle/store";

function fixtureForecast(): CycleRegimeForecast {
  const line = fs
    .readFileSync(path.join(__dirname, "..", "..", "..", "tests", "fixtures", "cycle-events.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((text) => JSON.parse(text) as { type: string })
    .find((event) => event.type === "cycle_regime_forecast");
  return cycleRegimeForecastSchema.parse(line);
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

function stretch(forecast: CycleRegimeForecast, timestamps: number[], regimes: (string | null)[], seq: number): CycleRegimeForecast {
  return { ...forecast, seq, timestamps, mostLikelyRegime: regimes };
}

describe("run regimes", () => {
  it("map every walked bar to its named regime's fixed colour, glyph and word", () => {
    const forecast = fixtureForecast();
    const regimes = regimesOf([forecast]);
    expect(regimes.names).toEqual(["flat", "uptrend", "downtrend"]);
    expect(regimeStyleOfBar(regimes, forecast.timestamps[0]!)).toBe(REGIME_STYLES.flat);
    expect(regimeStyleOfBar(regimes, forecast.timestamps[1]!)).toBe(REGIME_STYLES.downtrend);
    expect(regimeStyleOfBar(regimes, 1)).toBeNull();                    // a bar no regime model spoke for keeps the chart's colour
    expect(regimeShares(regimes).map((row) => [row.style.word, row.barCount, row.share])).toEqual([
      ["flat", 1, 0.5], ["uptrend", 0, 0], ["downtrend", 1, 0.5],
    ]);
  });

  it("append stretches in place, count a re-sent bar once and skip a bar with no regime", () => {
    const forecast = fixtureForecast();
    const regimes = emptyRunRegimes();
    expect(appendRegimeForecast(regimes, stretch(forecast, [100, 200, 300], ["uptrend", null, "uptrend"], 20))).toBe(2);
    expect(appendRegimeForecast(regimes, stretch(forecast, [300, 400], ["uptrend", "flat"], 21))).toBe(1);   // 300 re-sent
    expect(appendRegimeForecast(regimes, stretch(forecast, [400], ["downtrend"], 22))).toBe(1);              // corrected
    expect(regimes.byTimestamp.size).toBe(3);
    expect(regimes.byTimestamp.has(200)).toBe(false);
    expect(regimeShares(regimes).map((row) => row.barCount)).toEqual([0, 2, 1]);
  });

  it("read the numbered regimes of a run recorded before they had names", () => {
    const forecast = numberedRegimes(fixtureForecast(), [1, 3]);
    const regimes = regimesOf([forecast]);
    expect(regimes.names).toEqual(["regime 1", "regime 2", "regime 3"]);
    expect(regimeStyleOfBar(regimes, forecast.timestamps[1]!)!.word).toBe("regime 3");
  });
});

describe("the cycle store's regimes", () => {
  beforeEach(() => {
    useCycleStore.getState().reset();
  });

  it("fill from the live cycle_regime_forecast stretches, once per event", () => {
    const forecast = fixtureForecast();
    const store = useCycleStore.getState();
    store.begin("model_a", "regime_montecarlo_decision+walk_forward_cycle");
    expect(useCycleStore.getState().regimes.byTimestamp.size).toBe(0);
    store.applyEvent("cycle_regime_forecast", forecast);
    const after = useCycleStore.getState();
    expect(after.regimes.byTimestamp.size).toBe(2);
    expect(after.regimesVersion).toBe(1);
    expect(after.showRegimeColors).toBe(true);
    store.applyEvent("cycle_regime_forecast", forecast);               // the stream replays its buffer: same seq, ignored
    expect(useCycleStore.getState().regimesVersion).toBe(1);
    store.applyEvent("cycle_regime_forecast", stretch(forecast, [1735701900], ["uptrend"], forecast.seq + 1));
    expect(useCycleStore.getState().regimes.byTimestamp.size).toBe(3);
    expect(useCycleStore.getState().regimesVersion).toBe(2);
  });

  it("come with a server snapshot, and start empty for the next run", () => {
    const forecast = fixtureForecast();
    const snapshot = {
      modelId: "model_b", modelType: "regime_montecarlo_decision+walk_forward_cycle", status: "complete", error: null,
      lastSequence: 99, plan: null, cursor: null,
      bars: { timestamps: [], open: [], high: [], low: [], close: [], volume: [], role: [], span: [], foldIndex: [], probabilityUp: [],
        predictedDirection: [], position: [], positionHeld: [], equityUsd: [], predictedClose: [], forecastTimestamp: [],
        actualDirection: [], correct: [] },
      trades: [], scoreboards: { running: null, folds: [], final: null }, epochs: [], trials: [], parameters: [], logs: [],
      regimeForecasts: [forecast],
    } as unknown as CycleSnapshot;
    useCycleStore.getState().loadSnapshot(snapshot);
    expect(regimeStyleOfBar(useCycleStore.getState().regimes, forecast.timestamps[1]!)).toBe(REGIME_STYLES.downtrend);
    useCycleStore.getState().begin("model_c", "xgboost+walk_forward_cycle");
    expect(useCycleStore.getState().regimes.byTimestamp.size).toBe(0);
  });

  it("take a recorded run's forecasts and switch the candle colours on and off", () => {
    const forecast = fixtureForecast();
    useCycleStore.getState().setRegimeForecasts([forecast]);
    expect(useCycleStore.getState().regimes.byTimestamp.size).toBe(2);
    useCycleStore.getState().setShowRegimeColors(false);
    expect(useCycleStore.getState().showRegimeColors).toBe(false);
    expect(useCycleStore.getState().regimes.byTimestamp.size).toBe(2);   // the regimes stay; only the paint goes
  });
});

describe("candleBodyWidth", () => {
  it("is lightweight-charts' own candle width, so a repainted candle covers the chart's", () => {
    expect(candleBodyWidth(1, 1)).toBe(1);
    expect(candleBodyWidth(3, 1)).toBe(3);            // the 2.5..4 special case
    expect(candleBodyWidth(3, 2)).toBe(6);
    expect(candleBodyWidth(6, 1)).toBe(5);            // floor(6 × (1 − 0.2 × atan(2) / (π / 2)))
    expect(candleBodyWidth(20, 1)).toBe(16);
    expect(candleBodyWidth(20, 2)).toBe(32);
    for (const spacing of [0.5, 2, 5, 9, 14, 40]) expect(candleBodyWidth(spacing, 1)).toBeLessThanOrEqual(Math.max(1, Math.floor(spacing)));
  });
});
