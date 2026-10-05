/**
 * The volume-candle-anatomy study: the shared compute (causal readings of a
 * volume bar, Spearman with ties, nats and equivalent correlation, hidden
 * dependence, control shift) and the handler against a fake StudyLake.
 */

import type { Server } from "http";
import type { AddressInfo } from "net";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import handler from "../../studies/handlers/volume-candle-anatomy";
import { createStudiesRouter } from "../../studies/studies.router";
import type { StudyLake } from "../../studies/types";
import {
  compareRankReading, controlShifts, correlatedCloud, equivalentCorrelation, fitLine, gaussianEquivalentNats, natsToBits, pairingPoints,
  pearsonCorrelation, seededNormals, spearmanCorrelation, volumeReadings,
  type BoardOverallRow, type RawBar,
} from "@shared/studies/volume-candle-anatomy";

function bar(index: number, volume: number, open = 100, close = 101): RawBar {
  return { timestamp: 1_700_000_000_000 + index * 300_000, open, high: Math.max(open, close) + 1, low: Math.min(open, close) - 1, close, volume };
}

describe("volumeReadings", () => {
  // Window of 4 so every number can be checked by hand.
  const volumes = [10, 20, 40, 80, 160, 40];
  const rows = volumes.map((volume, index) => bar(index, volume, 100, index % 2 === 0 ? 101 : 99));

  it("drops warmup rows and never lets a bar see itself", () => {
    const out = volumeReadings(rows, 10, 4);
    expect(out).toHaveLength(2); // rows 4 and 5 have four bars before them
    const first = out[0]!;
    // bar 4 (volume 160) against the previous four (10, 20, 40, 80)
    expect(first.volume_bar_height_in_window).toBeCloseTo(160 / 80, 12);
    expect(first.volume_rank_trailing).toBe(1);
    const logs = [10, 20, 40, 80].map(Math.log);
    const mean = logs.reduce((a, b) => a + b, 0) / 4;
    const sd = Math.sqrt(logs.reduce((a, b) => a + (b - mean) ** 2, 0) / 3);
    expect(first.volume_zscore_trailing).toBeCloseTo((Math.log(160) - mean) / sd, 12);
    // bar 5 (volume 40) against (20, 40, 80, 160): one strictly below
    const second = out[1]!;
    expect(second.volume_rank_trailing).toBe(0.25);
    expect(second.volume_bar_height_in_window).toBeCloseTo(40 / 160, 12);
  });

  it("signs volume by candle direction and keeps only the last `length` bars", () => {
    const out = volumeReadings(rows, 1, 4);
    expect(out).toHaveLength(1);
    expect(out[0]?.candle_direction).toBe("falling"); // index 5 closes at 99
    expect(out[0]?.volume_signed_by_candle_direction).toBe(-40);
  });

  it("gives a null z-score instead of infinity when the trailing volumes are all equal", () => {
    const flat = Array.from({ length: 6 }, (_, index) => bar(index, 50));
    const out = volumeReadings(flat, 5, 4);
    expect(out.every((entry) => entry.volume_zscore_trailing === null)).toBe(true);
    expect(out[0]?.volume_rank_trailing).toBe(0);
  });
});

describe("rank correlation", () => {
  it("handles ties with average ranks", () => {
    expect(spearmanCorrelation([1, 2, 2, 3], [1, 2, 2, 3])).toBeCloseTo(1, 12);
    expect(spearmanCorrelation([1, 2, 3, 4, 5], [5, 4, 3, 2, 1])).toBeCloseTo(-1, 12);
    // monotone but not linear: Spearman 1, Pearson below 1
    const xs = [1, 2, 3, 4, 5, 6];
    const ys = xs.map((x) => x ** 4);
    expect(spearmanCorrelation(xs, ys)).toBeCloseTo(1, 12);
    expect(pearsonCorrelation(xs, ys)).toBeLessThan(1);
  });

  it("is null when a series is constant or too short", () => {
    expect(spearmanCorrelation([1, 1, 1, 1], [1, 2, 3, 4])).toBeNull();
    expect(spearmanCorrelation([1, 2], [1, 2])).toBeNull();
  });
});

describe("nats, bits and the equivalent correlation", () => {
  it("converts 0.0616 nats as the notebook's table does", () => {
    expect(natsToBits(0.0616)).toBeCloseTo(0.0889, 4);
    expect(equivalentCorrelation(0.0616)).toBeCloseTo(0.34, 2);
    expect(equivalentCorrelation(0)).toBe(0);
  });

  it("inverts the Gaussian formula", () => {
    for (const rho of [0.05, 0.3, 0.8]) expect(equivalentCorrelation(gaussianEquivalentNats(rho))).toBeCloseTo(rho, 10);
  });

  it("draws the same cloud every time, and its correlation follows the slider", () => {
    expect(seededNormals(10, 7)).toEqual(seededNormals(10, 7));
    const cloud = correlatedCloud(0.6, 1200);
    expect(cloud).toHaveLength(1200);
    expect(pearsonCorrelation(cloud.map((p) => p.x), cloud.map((p) => p.y))).toBeGreaterThan(0.5);
    expect(fitLine(cloud).slope).toBeGreaterThan(0.4);
    expect(correlatedCloud(0, 1200).map((p) => p.x)).toEqual(cloud.map((p) => p.x)); // x never moves
  });
});

function overall(partial: Partial<BoardOverallRow>): BoardOverallRow {
  return {
    timeframe: "5m", bar_population: "closes_inside_range", volume_encoding: "volume_rank_trailing", anatomy_measure: "upper_wick_in_average_ranges", bar_count: 1000,
    pearson_correlation: 0.3, spearman_correlation: 0.3, mutual_information_nats: 0.05, gaussian_equivalent_mutual_information_nats: 0.047,
    mutual_information_excess_ratio: 1.06, relationship_is_nonlinear: false, pairing_shares_a_construction_term: false,
    anatomy_mean: 0, anatomy_median: 0, anatomy_standard_deviation: 1, anatomy_skewness: 0, anatomy_kurtosis: 0,
    anatomy_percentile_25: -1, anatomy_percentile_75: 1, anatomy_minimum: -3, anatomy_maximum: 3,
    ...partial,
  };
}

describe("views over the landed rows", () => {
  it("flags dependence hidden from a linear feature and drops non-finite ratios and tautologies", () => {
    const rows = [
      overall({ anatomy_measure: "a", pearson_correlation: -0.011, mutual_information_nats: 0.0616, gaussian_equivalent_mutual_information_nats: 0.00006, mutual_information_excess_ratio: 980 }),
      overall({ anatomy_measure: "b" }),
      overall({ anatomy_measure: "c", mutual_information_excess_ratio: Number.NaN }),
      overall({ anatomy_measure: "d", pairing_shares_a_construction_term: true }),
    ];
    const shown = pairingPoints(rows, true);
    expect(shown.map((p) => p.anatomy_measure)).toEqual(["a", "b"]);
    expect(shown.find((p) => p.anatomy_measure === "a")?.hidden).toBe(true);
    expect(shown.find((p) => p.anatomy_measure === "b")?.hidden).toBe(false);
    expect(pairingPoints(rows, false).map((p) => p.anatomy_measure)).toEqual(["a", "b", "d"]);
  });

  it("pairs each cell's two populations and reports the shift", () => {
    const rows = [
      overall({ bar_population: "all_bars", spearman_correlation: 0.4 }),
      overall({ bar_population: "closes_inside_range", spearman_correlation: 0.1 }),
      overall({ anatomy_measure: "lonely", bar_population: "all_bars", spearman_correlation: 0.9 }),
      overall({ anatomy_measure: "circular", bar_population: "all_bars", pairing_shares_a_construction_term: true }),
    ];
    const shifts = controlShifts(rows);
    expect(shifts).toHaveLength(1);
    expect(shifts[0]?.shift).toBeCloseTo(-0.3, 12);
  });

  it("counts the cells where the rank reading beats the raw count and the bar height", () => {
    const cell = (measure: string, rank: number, raw: number, height: number) => [
      overall({ anatomy_measure: measure, volume_encoding: "volume_rank_trailing", spearman_correlation: rank }),
      overall({ anatomy_measure: measure, volume_encoding: "volume_contracts", spearman_correlation: raw }),
      overall({ anatomy_measure: measure, volume_encoding: "volume_bar_height_in_window", spearman_correlation: -height }),
    ];
    const result = compareRankReading([...cell("x", 0.5, 0.3, 0.4), ...cell("y", 0.2, 0.3, 0.1)]);
    expect(result.cellCount).toBe(2);
    expect(result.rankBeatsBoth).toBe(1);
    expect(result.exceptions[0]?.anatomy_measure).toBe("y");
  });
});

// ---------------------------------------------------------------------------
// The handler on a fake lake.
// ---------------------------------------------------------------------------

function fakeLake(options: { views: string[]; statements: string[] }): StudyLake {
  const holdoutBars = Array.from({ length: 400 }, (_, index) => bar(index, 100 + (index % 37) * 10, 100, index % 3 ? 101 : 99));
  return {
    async query<T>(sql: string): Promise<T[]> {
      options.statements.push(sql);
      if (sql.includes("max(recipe)")) return [{ recipe: "recipe_v1" }] as T[];
      if (sql.includes("count(*) AS n") && sql.includes("next_candles")) return [{ n: holdoutBars.length }] as T[];
      if (sql.includes("count(*) AS n")) return [{ n: 8800 }] as T[];
      if (sql.includes("epoch_ms(timestamp)")) {
        const offset = Number(/OFFSET (\d+)/.exec(sql)?.[1] ?? 0);
        const limit = Number(/LIMIT (\d+)\s*$/.exec(sql.trim())?.[1] ?? 0);
        return holdoutBars.slice(offset, offset + limit) as T[];
      }
      if (sql.includes("GROUP BY volume_encoding")) {
        return [{ volume_encoding: "volume_rank_trailing", mean_absolute_spearman: 0.21, pairing_count: 40 }] as T[];
      }
      if (sql.includes("GROUP BY anatomy_measure")) {
        return [{ anatomy_measure: "total_range_in_average_ranges", best_absolute_spearman: 0.83, best_volume_encoding: "volume_zscore_trailing" }] as T[];
      }
      if (sql.includes("volume_decile >= 0")) return [{ volume_decile: 0, anatomy_measure: "x", bar_population: "closes_inside_range" }] as T[];
      if (sql.includes("volume_decile = -1")) return [overall({})] as T[];
      return [];
    },
    async hasView(name: string) {
      return options.views.includes(name);
    },
    async columns() {
      return [];
    },
  };
}

describe("the volume-candle-anatomy handler", () => {
  it("lists both lake views it reads and parses its query", () => {
    expect(handler.slug).toBe("volume-candle-anatomy");
    expect(handler.datasets).toEqual(["derived_mnq_volume_candle_anatomy", "derived_mnq_next_candles_5m"]);
    expect(handler.query.parse({}).part).toBe("board");
    expect(() => handler.query.parse({ timeframe: "2m" })).toThrow();
    expect(() => handler.query.parse({ windowLength: 500 })).toThrow();
    expect(() => handler.query.parse({ encoding: "volume'; DROP TABLE x; --" })).toThrow();
  });

  it("returns the board with the SQL-computed answer tables from the newest recipe", async () => {
    const statements: string[] = [];
    const notes: string[] = [];
    const lake = fakeLake({ views: ["derived_mnq_volume_candle_anatomy"], statements });
    const body = await handler.run(handler.query.parse({}), { lake, notes });
    expect(body.part).toBe("board");
    expect(body.board?.recipe).toBe("recipe_v1");
    expect(body.board?.rowCount).toBe(8800);
    expect(body.board?.overall).toHaveLength(1);
    expect(body.board?.byEncoding[0]?.volume_encoding).toBe("volume_rank_trailing");
    expect(body.board?.byMeasure[0]?.best_volume_encoding).toBe("volume_zscore_trailing");
    expect(statements.some((sql) => sql.includes("recipe = 'recipe_v1'") && sql.includes("NOT pairing_shares_a_construction_term"))).toBe(true);
    expect(notes).toEqual([]);
  });

  it("degrades to an empty body and a note when the study is not landed", async () => {
    const notes: string[] = [];
    const lake = fakeLake({ views: [], statements: [] });
    const body = await handler.run(handler.query.parse({}), { lake, notes });
    expect(body.board).toBeNull();
    expect(notes[0]).toContain("derived_mnq_volume_candle_anatomy");
    const window = await handler.run(handler.query.parse({ part: "window" }), { lake, notes: [] });
    expect(window.window).toBeNull();
  });

  it("asks for the deciles of one timeframe and reading, plus the two candle colours", async () => {
    const statements: string[] = [];
    const lake = fakeLake({ views: ["derived_mnq_volume_candle_anatomy"], statements });
    const body = await handler.run(handler.query.parse({ part: "deciles", timeframe: "15m", encoding: "volume_contracts", population: "all_bars" }), { lake, notes: [] });
    expect(body.deciles?.rows).toHaveLength(1);
    const sql = statements.find((entry) => entry.includes("volume_decile >= 0")) ?? "";
    expect(sql).toContain("timeframe = '15m'");
    expect(sql).toContain("volume_encoding = 'volume_contracts'");
    expect(sql).toContain("'all_bars'");
    expect(sql).toContain("'rising_candles_inside_range'");
    expect(sql).toContain("'falling_candles_inside_range'");
  });

  it("pages the holdout by timestamp and keeps the notebook's window (length + 140 rows read, `length` shown)", async () => {
    const statements: string[] = [];
    const lake = fakeLake({ views: ["derived_mnq_next_candles_5m"], statements });
    const body = await handler.run(handler.query.parse({ part: "window", windowStart: 50, windowLength: 70 }), { lake, notes: [] });
    const window = body.window!;
    expect(window.holdoutBarCount).toBe(400);
    expect(window.bars).toHaveLength(70);
    expect(window.windowStart).toBe(50);
    // the first bar shown is row 50 + 140 of the holdout, exactly as the notebook's tail(length) on LIMIT length+140 OFFSET start
    expect(window.bars[0]?.timestamp).toBe(bar(50 + 140, 0).timestamp);
    const sql = statements.find((entry) => entry.includes("epoch_ms(timestamp)")) ?? "";
    expect(sql).toContain("sample_split = 'holdout'");
    expect(sql).toContain("timestamp >= (SELECT timestamp");
    expect(sql).toContain("OFFSET 50");
    expect(sql).toMatch(/LIMIT 210\s*$/);
    expect(window.spearmanRawAgainstHeight).not.toBeNull();
  });

  it("clamps a scroll position past the end of the holdout and says so", async () => {
    const notes: string[] = [];
    const lake = fakeLake({ views: ["derived_mnq_next_candles_5m"], statements: [] });
    const body = await handler.run(handler.query.parse({ part: "window", windowStart: 9000, windowLength: 100 }), { lake, notes });
    expect(body.window?.windowStart).toBe(400 - 240);
    expect(body.window?.bars).toHaveLength(100);
    expect(notes[0]).toContain("past the end");
  });
});

describe("GET /api/studies/volume-candle-anatomy", () => {
  let server: Server;
  let base = "";
  beforeAll(async () => {
    const app = express();
    app.use("/api", createStudiesRouter([handler], fakeLake({ views: ["derived_mnq_volume_candle_anatomy", "derived_mnq_next_candles_5m"], statements: [] })));
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  });
  afterAll(() => {
    server.close();
  });

  it("answers the board, refuses a bad timeframe, and lists both datasets as served", async () => {
    const ok = await (await fetch(`${base}/studies/volume-candle-anatomy`)).json();
    expect(ok.slug).toBe("volume-candle-anatomy");
    expect(ok.data.board.rowCount).toBe(8800);
    const bad = await fetch(`${base}/studies/volume-candle-anatomy?part=deciles&timeframe=3m`);
    expect(bad.status).toBe(400);
    const listing = await (await fetch(`${base}/studies`)).json();
    expect(listing.studies[0].datasets.every((entry: { served: boolean }) => entry.served)).toBe(true);
  });
});
