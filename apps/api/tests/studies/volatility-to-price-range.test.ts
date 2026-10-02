/**
 * Volatility value to price range: the pure computation against numbers the
 * notebook's own Python produced (volatility_scale.nine_stats,
 * empirical_range_calibration, ewma_log_range_forecast, residual_sigma_from,
 * statistics.NormalDist.inv_cdf), the handler's SQL, and the handler end to
 * end through the studies router with a fake lake of synthetic bars whose
 * range scales exactly as the square root of time.
 */

import type { Server } from "http";
import type { AddressInfo } from "net";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createStudiesRouter } from "../../studies/studies.router";
import { barsSql, createVolatilityHandler, volatilityQuery } from "../../studies/handlers/volatility-to-price-range";
import type { StudyLake } from "../../studies/types";
import {
  TIMEFRAMES, analyse, ewmaForecast, fitLine, inverseNormal, linspace, nineStatistics, quantileSorted, rangeCalibration,
  residualSigma, sampleRows, standardizedToLogRange, logRangeToQuantilePoints, volatilitySeries,
  type Bar, type StudyParameters, type Timeframe, type VolatilityStudyBody,
} from "@shared/studies/volatility-to-price-range";

const PARAMETERS: StudyParameters = {
  symbol: "MNQ", start: "2025-09-25", end: null, lambda: 0.94, binCount: 10, lowerQuantile: 0.1, upperQuantile: 0.9,
  sigmaFit: "window", trainFraction: 0.7, gapMultiple: null, quantilePlotPoints: 500,
};
const INSTRUMENT = { symbol: "MNQ", pointValue: 2, tickSize: 0.25, tickValue: 0.5 };

describe("statistics match NumPy and the notebook's nine_stats", () => {
  it("nine statistics of a fixed sample", () => {
    const stats = nineStatistics([1, 2, 2, 3, 7, 11.5, 0.5, Number.NaN]);
    expect(stats.count).toBe(7);
    expect(stats.mean).toBeCloseTo(3.857142857142857, 12);
    expect(stats.standardDeviation).toBeCloseTo(3.986584646393093, 12);
    expect(stats.skewness).toBeCloseTo(0.9084124102283678, 12);
    expect(stats.excessKurtosis).toBeCloseTo(-0.8916867330191769, 12);
    expect(stats.percentile25).toBe(1.5);
    expect(stats.percentile75).toBe(5);
    expect(stats.median).toBe(2);
  });

  it("refuses moments the sample cannot support", () => {
    expect(Number.isNaN(nineStatistics([1, 2, 3]).excessKurtosis)).toBe(true);
    expect(Number.isNaN(nineStatistics([1, 2]).skewness)).toBe(true);
    expect(nineStatistics([]).count).toBe(0);
  });

  it("linear quantiles and linspace", () => {
    const sorted = [0.5, 1, 2, 2, 3, 7, 11.5];
    expect(quantileSorted(sorted, 0.1)).toBeCloseTo(0.8, 12);
    expect(quantileSorted(sorted, 0.33)).toBeCloseTo(1.98, 12);
    expect(quantileSorted(sorted, 0.9)).toBeCloseTo(8.8, 12);
    expect(linspace(0.05, 0.95, 10)[4]).toBe(0.44999999999999996);
    expect(linspace(0.05, 0.95, 10)[9]).toBe(0.95);
  });

  it("the normal quantile is AS241, bit-for-bit with Python's NormalDist", () => {
    expect(inverseNormal(0.9)).toBe(1.2815515655446008);
    expect(inverseNormal(0.975)).toBe(1.9599639845400536);
    expect(inverseNormal(0.3)).toBe(-0.5244005127080407);
    expect(inverseNormal(0.02)).toBe(-2.0537489106318225);
    expect(inverseNormal(1e-6)).toBe(-4.753424308822899);
    expect(inverseNormal(1e-12)).toBe(-7.034483825301132);
    expect(() => inverseNormal(1)).toThrow();
  });

  it("a straight line is recovered exactly", () => {
    const xs = [0, 1, 2, 3];
    const fit = fitLine(xs, xs.map((x) => 0.5 * x + 2));
    expect(fit.slope).toBeCloseTo(0.5, 12);
    expect(fit.intercept).toBeCloseTo(2, 12);
    expect(fit.rSquared).toBeCloseTo(1, 12);
  });
});

describe("the series and the forecast", () => {
  it("the EWMA carries a missing bar forward (ewma_log_range_forecast)", () => {
    const forecast = Array.from(ewmaForecast([1, Number.NaN, 2, 1.5, Number.NaN, 3], 0.9));
    const expected = [1, 1, 1.1, 1.14, 1.14, 1.326];
    forecast.forEach((value, index) => expect(value).toBeCloseTo(expected[index] as number, 12));
    const sigma = residualSigma(ewmaForecast([1, Number.NaN, 2, 1.5, Number.NaN, 3], 0.9), [Number.NaN, 2, 1.5, Number.NaN, 3, Number.NaN]);
    expect(sigma).toBeCloseTo(0.7338483040338332, 12);
  });

  it("masks a zero-range bar instead of flooring it, and labels the next bar", () => {
    const bars: Bar[] = [
      { t: 0, high: 101, low: 100, close: 100.5 },
      { t: 60_000, high: 100, low: 100, close: 100 },
      { t: 120_000, high: 103, low: 100, close: 101 },
      { t: 180_000, high: 104, low: 100, close: 102 },
    ];
    const series = volatilitySeries(bars);
    expect(series.zeroRangeCount).toBe(1);
    expect(Number.isNaN(series.logRange[1] as number)).toBe(true);
    expect(Number.isNaN(series.nextLogRange[0] as number)).toBe(true); // its next bar is the masked one
    expect(series.nextLogRange[1]).toBeCloseTo(Math.log(3), 6);
    expect(Number.isNaN(series.nextLogRange[3] as number)).toBe(true);
    expect(series.forwardLabelCount).toBe(2);
  });

  it("the gap rule drops a label that spans a session break, and only when asked", () => {
    const bars: Bar[] = [0, 1, 2, 3, 60, 61, 62].map((minute) => ({ t: minute * 60_000, high: 102, low: 100, close: 101 }));
    expect(volatilitySeries(bars).gapLabelCount).toBe(0);
    const gapped = volatilitySeries(bars, 3);
    expect(gapped.gapLabelCount).toBe(1);
    expect(Number.isNaN(gapped.nextLogRange[3] as number)).toBe(true);
    expect(gapped.forwardLabelCount).toBe(5);
  });

  it("un-standardises a z-score and gives the lognormal quantile", () => {
    expect(standardizedToLogRange(1.5, 2, 0.4)).toBeCloseTo(2.6, 12);
    expect(logRangeToQuantilePoints(2, 0.5, 0.9)).toBeCloseTo(Math.exp(2 + 0.5 * 1.2815515655446008), 12);
  });
});

describe("calibration reproduces empirical_range_calibration", () => {
  it("equal-count bins, analytic median and realised statistics", () => {
    const v = Array.from({ length: 40 }, (_, index) => 1.5 + 0.8 * Math.sin(index * 0.7));
    const r = v.map((value, index) => Math.exp(value) * (1 + 0.3 * Math.cos(index * 1.3)));
    const bins = rangeCalibration("1m", v, r, 4, 2);
    const expected = [
      { volatilityMean: 0.8046012418493225, analyticMedianPoints: 2.235804775663245, rangeMedian: 2.304653061994017, rangeMean: 2.2815132504825204, rangeExcessKurtosis: -1.1847275448611847, meanOverMedian: 0.989959524974455 },
      { volatilityMean: 1.2926223860795123, analyticMedianPoints: 3.6423256267433337, rangeMedian: 3.8043700646256147, rangeMean: 3.852198148754271, rangeExcessKurtosis: -1.3837375887480414, meanOverMedian: 1.0125718800527264 },
      { volatilityMean: 1.8726694343662096, analyticMedianPoints: 6.505639618667232, rangeMedian: 6.589725213178369, rangeMean: 6.583236809682288, rangeExcessKurtosis: -1.711849280311123, meanOverMedian: 0.9990153757120092 },
      { volatilityMean: 2.234334011542848, analyticMedianPoints: 9.340259275480221, rangeMedian: 9.426098747743811, rangeMean: 9.435793878796954, rangeExcessKurtosis: -1.7758625094204907, meanOverMedian: 1.0010285412144089 },
    ];
    expect(bins).toHaveLength(4);
    bins.forEach((bin, index) => {
      const want = expected[index]!;
      expect(bin.rangeCount).toBe(10);
      for (const key of Object.keys(want) as Array<keyof typeof want>) expect(bin[key]).toBeCloseTo(want[key], 10);
      expect(bin.biasPercent).toBeCloseTo((want.analyticMedianPoints / want.rangeMedian - 1) * 100, 10);
    });
  });
});

// ---------------------------------------------------------------------------
// Synthetic bars: log-range = ln(3) + 0.5·ln(minutes) + AR(1) noise, so the
// range scales exactly as the square root of time plus noise.
// ---------------------------------------------------------------------------

const MINUTES: Record<Timeframe, number> = { "1m": 1, "5m": 5, "15m": 15, "30m": 30, "45m": 45, "1h": 60 };

function syntheticBars(minutes: number, count: number, seed: number): Bar[] {
  let state = seed;
  const uniform = () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return (state + 0.5) / 2_147_483_648;
  };
  const start = Date.UTC(2025, 8, 25);
  let noise = 0;
  const bars: Bar[] = [];
  for (let index = 0; index < count; index += 1) {
    noise = 0.6 * noise + 0.4 * inverseNormal(uniform());
    const range = Math.round(Math.exp(Math.log(3) + 0.5 * Math.log(minutes) + noise) * 4) / 4 || 0.25;
    bars.push({ t: start + index * minutes * 60_000, high: 20_000 + range, low: 20_000, close: 20_000 + range / 2 });
  }
  return bars;
}

function barsByTimeframe(): Record<Timeframe, Bar[]> {
  const out = {} as Record<Timeframe, Bar[]>;
  TIMEFRAMES.forEach((timeframe, index) => {
    out[timeframe] = syntheticBars(MINUTES[timeframe], Math.max(400, Math.round(12_000 / MINUTES[timeframe])), 11 + index);
  });
  return out;
}

describe("analyse", () => {
  const body = analyse(barsByTimeframe(), { instrument: INSTRUMENT, parameters: PARAMETERS, availableSymbols: ["MNQ"], sources: {} });

  it("covers every timeframe with every table", () => {
    expect(body.timeframes).toEqual([...TIMEFRAMES]);
    expect(body.ladder).toHaveLength(60);
    expect(body.calibration).toHaveLength(60);
    expect(body.distributions).toHaveLength(12);
    expect(body.quantilePlots.every((plot) => plot.normalQuantile.length === Math.min(500, plot.observedLogRange.length))).toBe(true);
  });

  it("recovers the square-root-of-time exponent it was built with", () => {
    expect(body.scaling?.exponentOnMean).toBeCloseTo(0.5, 1);
    expect(body.scaling?.rSquaredOnMean ?? 0).toBeGreaterThan(0.99);
  });

  it("converts exactly: median points = e^v, dollars = points × point value", () => {
    for (const row of body.ladder) {
      expect(row.medianPoints).toBeCloseTo(Math.exp(row.logRange), 10);
      expect(row.medianUsd).toBeCloseTo(row.medianPoints * 2, 10);
      expect(row.medianTicks).toBeCloseTo(row.medianPoints / 0.25, 10);
      expect(row.meanPoints).toBeGreaterThanOrEqual(row.medianPoints);
      expect(row.lowerQuantilePoints).toBeLessThan(row.medianPoints);
      expect(row.upperQuantilePoints).toBeGreaterThan(row.medianPoints);
    }
  });

  it("fits σ on the first part only when asked, on fewer pairs", () => {
    const train = analyse(barsByTimeframe(), { instrument: INSTRUMENT, parameters: { ...PARAMETERS, sigmaFit: "train", trainFraction: 0.5 }, availableSymbols: ["MNQ"], sources: {} });
    const whole = body.residuals.find((row) => row.timeframe === "1m")!;
    const part = train.residuals.find((row) => row.timeframe === "1m")!;
    expect(part.fittedPairCount).toBeLessThan(whole.fittedPairCount);
    expect(part.fittedPairCount).toBeGreaterThan(whole.fittedPairCount * 0.45);
  });

  it("thins the sample and restores it as rows", () => {
    const frame = body.samples.find((sample) => sample.timeframe === "1m")!;
    const rows = sampleRows(frame);
    expect(rows.length).toBeLessThanOrEqual(800);
    expect(Object.keys(rows[0]!)).toEqual(["timestamp", "close", "range_points", "log_range", "next_bar_log_range", "ewma_forecast", "forecast_error"]);
  });
});

describe("handler SQL", () => {
  it("reads a native view with arg_max and explicit UTC instants", () => {
    const sql = barsSql("5m", "MNQ", "2025-09-25", "2025-12-30");
    expect(sql).toContain('FROM "ohlcv_5m"');
    expect(sql).toContain("arg_max(close, timestamp)");
    expect(sql).toContain("TIMESTAMPTZ '2025-09-25 00:00:00+00'");
    expect(sql).toContain("TIMESTAMPTZ '2025-12-31 00:00:00+00'");
    expect(sql).not.toMatch(/\blast\(|\bfirst\(/);
  });

  it("builds 45m from 1m in midnight-aligned 45-minute buckets", () => {
    const sql = barsSql("45m", "MNQ", "2025-09-25", "");
    expect(sql).toContain('FROM "ohlcv_1m"');
    expect(sql).toContain("// 2700000) * 2700000");
    expect(sql).not.toContain("timestamp <");
  });

  it("parses the query with the notebook's defaults and refuses the rest", () => {
    const parsed = volatilityQuery.parse({});
    expect(parsed).toMatchObject({ symbol: "MNQ", start: "2025-09-25", lambda: 0.94, bins: 10, lowerQuantile: 0.1, sigmaFit: "window", gapRule: "false" });
    expect(volatilityQuery.safeParse({ symbol: "'; DROP" }).success).toBe(false);
    expect(volatilityQuery.safeParse({ start: "2025-9-1" }).success).toBe(false);
    expect(volatilityQuery.safeParse({ lambda: "1.5" }).success).toBe(false);
  });
});

describe("handler through the studies router", () => {
  const synthetic = barsByTimeframe();
  let queries = 0;
  let viewsPresent = true;
  const lake: StudyLake = {
    async query<T>(sql: string): Promise<T[]> {
      queries += 1;
      if (sql.includes("DISTINCT symbol")) return [{ symbol: "MNQ" }] as T[];
      const timeframe = sql.includes("2700000") ? "45m" : (TIMEFRAMES.find((entry) => sql.includes(`"ohlcv_${entry === "1h" ? "1h_v" : entry}"`)) ?? "1m");
      return synthetic[timeframe].map((bar) => ({ t: BigInt(bar.t), high: bar.high, low: bar.low, close: bar.close })) as unknown as T[];
    },
    async hasView() {
      return viewsPresent;
    },
    async columns() {
      return [];
    },
  };

  let server: Server;
  let base = "";

  beforeAll(async () => {
    const app = express();
    app.use("/api", createStudiesRouter([createVolatilityHandler()], lake));
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  });

  afterAll(() => {
    server.close();
  });

  it("answers the whole body for the default query", async () => {
    const response = await fetch(`${base}/studies/volatility-to-price-range`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: VolatilityStudyBody; notes: string[] };
    expect(body.data.timeframes).toEqual([...TIMEFRAMES]);
    expect(body.data.availableSymbols).toEqual(["MNQ"]);
    expect(body.data.instrument.pointValue).toBe(2);
    expect(body.data.load.find((row) => row.timeframe === "45m")?.source).toBe("ohlcv_1m in 45-minute buckets");
    expect(body.notes.some((note) => note.includes("whole window"))).toBe(true);
  });

  it("re-reads nothing from the lake when only λ moves", async () => {
    await fetch(`${base}/studies/volatility-to-price-range?lambda=0.9`);
    const before = queries;
    const response = await fetch(`${base}/studies/volatility-to-price-range?lambda=0.97`);
    expect(response.status).toBe(200);
    expect(queries).toBe(before);
  });

  it("refuses a query outside its schema", async () => {
    expect((await fetch(`${base}/studies/volatility-to-price-range?bins=99`)).status).toBe(400);
  });

  it("degrades to a note and an empty body when the views are missing", async () => {
    viewsPresent = false;
    const response = await fetch(`${base}/studies/volatility-to-price-range?start=2024-01-02`);
    viewsPresent = true;
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: VolatilityStudyBody; notes: string[] };
    expect(body.data.timeframes).toEqual([]);
    expect(body.notes[0]).toContain("ohlcv_1m");
  });
});
