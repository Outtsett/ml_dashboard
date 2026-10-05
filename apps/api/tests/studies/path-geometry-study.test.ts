/**
 * The path-geometry-study handler on a fake lake (query parsing, SQL shape,
 * row mapping, degradation when views are missing) and the pure arithmetic
 * the page and server share (efficiency ratio against the notebook's own
 * function, forward labels, symmetric-log axis, skill identity on a landed fold).
 */

import type { Server } from "http";
import type { AddressInfo } from "net";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import handler, {
  alignmentSql, availableSql, barsCte, deltaSql, efficiencyCte, extremesSql, frameSql, histogramSql, hourSql, labelSummarySql,
  landedCheckSql, pathGeometryQuery, statisticsSql, windowClosesSql, FOLDS_VIEW, LABELS_VIEW, TARGETS_VIEW,
} from "../../studies/handlers/path-geometry-study";
import { createStudiesRouter } from "../../studies/studies.router";
import type { StudyContext, StudyLake } from "../../studies/types";
import {
  DELTA_BINS, HISTOGRAM_BINS, candleAgreement, densityFromCounts, efficiencySeries, forwardLabels, intervalVerdict, inverseSymlog,
  mergeBins, randomWalkExpectations, randomWalkNull, skillOverBaseline, symlog, windowGeometry,
} from "@shared/studies/path-geometry-study";

// ── the query ──────────────────────────────────────────────────────────────

describe("path geometry query", () => {
  it("defaults to the notebook's settings", () => {
    const query = pathGeometryQuery.parse({});
    expect(query.bars).toBe(400_000);
    expect(query.windows).toEqual([15, 60, 240, 1440]);
    expect(query.extremeWindow).toBe(60);
    expect(query.horizon).toBe(60);
    expect(query.showHorizon).toBe(10);
    expect(query.showBars).toBe(45);
    expect(query.flatThreshold).toBe(0);
  });

  it("parses a window list, sorted and without repeats", () => {
    expect(pathGeometryQuery.parse({ windows: "240,15,15,60" }).windows).toEqual([15, 60, 240]);
  });

  it("refuses text, windows out of range and more than six windows", () => {
    expect(pathGeometryQuery.safeParse({ windows: "abc" }).success).toBe(false);
    expect(pathGeometryQuery.safeParse({ windows: "1,15" }).success).toBe(false);
    expect(pathGeometryQuery.safeParse({ windows: "5000" }).success).toBe(false);
    expect(pathGeometryQuery.safeParse({ windows: "5,10,15,20,25,30,35" }).success).toBe(false);
    expect(pathGeometryQuery.safeParse({ windows: "15; DROP TABLE bars" }).success).toBe(false);
  });

  it("refuses a horizon of zero and bars below the loader's floor", () => {
    expect(pathGeometryQuery.safeParse({ horizon: 0 }).success).toBe(false);
    expect(pathGeometryQuery.safeParse({ bars: 100 }).success).toBe(false);
    expect(pathGeometryQuery.safeParse({ flatThreshold: -1 }).success).toBe(false);
  });
});

// ── the SQL ────────────────────────────────────────────────────────────────

describe("path geometry SQL", () => {
  const all = [
    availableSql(), barsCte(400_000), efficiencyCte([15, 60]), statisticsSql(400_000, [15, 60]), histogramSql(400_000, [15, 60]),
    extremesSql(400_000, 60), windowClosesSql(400_000, 60, [10, 500]), frameSql(400_000, [15], 60, 100), labelSummarySql(400_000, 60, 10, 0),
    alignmentSql(400_000, 60, 0), hourSql(400_000, 60, 0), deltaSql(400_000, 60), landedCheckSql(400_000, "direction_MNQ_1m_abc", 12),
  ];

  it("takes the most recent bars with the loader's filters, in time order", () => {
    const sql = barsCte(400_000);
    expect(sql).toContain("LIMIT 400000");
    expect(sql).toContain("ORDER BY timestamp DESC");
    expect(sql).toContain("volume > 0 AND open > 0 AND high > 0 AND low > 0 AND close > 0");
    expect(sql).toContain("row_number() OVER (ORDER BY t)");
  });

  it("builds one trailing window per requested length, with a full-window guard", () => {
    const sql = efficiencyCte([15, 240]);
    expect(sql).toContain("w15 AS (ORDER BY i ROWS BETWEEN 14 PRECEDING AND CURRENT ROW)");
    expect(sql).toContain("w240 AS (ORDER BY i ROWS BETWEEN 239 PRECEDING AND CURRENT ROW)");
    expect(sql).toContain("count(step) OVER w15 = 15");
    expect(sql).toContain("> 1e-12");
  });

  it("never uses the order-unspecified first() and last()", () => {
    for (const sql of all) {
      expect(sql).not.toMatch(/\bfirst\(/i);
      expect(sql).not.toMatch(/\blast\(/i);
    }
  });

  it("histograms over 0 to 4 in 120 bins, the last bin closed on the right", () => {
    const sql = histogramSql(400_000, [60]);
    expect(sql).toContain("(4.0 / 120)");
    expect(sql).toContain("least(");
    expect(sql).toContain("119)");
  });

  it("picks the first occurrence of the extreme, as idxmax and idxmin do", () => {
    const sql = extremesSql(400_000, 60);
    expect(sql).toContain("ORDER BY er_60 DESC, i ASC LIMIT 1");
    expect(sql).toContain("ORDER BY er_60 ASC, i ASC LIMIT 1");
  });

  it("reads the wall-clock hour without a time zone", () => {
    expect(hourSql(400_000, 60, 0)).toContain("(t // 3600000) % 24");
  });

  it("re-derives the label by joining on position and against a shift of one more bar", () => {
    const sql = alignmentSql(400_000, 60, 0);
    expect(sql).toContain("b2.i = l.i + 60");
    expect(sql).toContain("b3.i = l.i + 61");
  });

  it("refuses an unsafe number before it reaches SQL", () => {
    expect(() => barsCte(Number.NaN)).toThrow();
    expect(() => efficiencyCte([Number.POSITIVE_INFINITY])).toThrow();
  });
});

// ── the handler on a fake lake ─────────────────────────────────────────────

function distribution(alias: string, median: number) {
  return {
    [`${alias}_count`]: 1000, [`${alias}_mean`]: median + 0.1, [`${alias}_median`]: median, [`${alias}_sd`]: 0.7, [`${alias}_skew`]: 1.1,
    [`${alias}_kurt`]: 1.4, [`${alias}_p25`]: median / 2, [`${alias}_p75`]: median * 1.7, [`${alias}_p95`]: median * 2.9, [`${alias}_min`]: 0, [`${alias}_max`]: 6,
  };
}

const TARGET = {
  target: "fwd_er_vs_rw", horizon_bars: 60, training_row_count: 2321989, feature_count: 34, fold_count: 5, purge_bars: 1440, fold_months: 6,
  verdict_best_model: "ridge", verdict_beats_baseline_fold_level: false, verdict_beats_baseline_bar_level: false, verdict_persistence_r_squared: -1.0058, verdict_note: "note",
  ridge_skill_median: -0.0005623, ridge_diebold_mariano_interval_low: -0.0011949, ridge_diebold_mariano_interval_high: 0.0000728,
};

interface FakeOptions {
  served?: readonly string[];
  log?: string[];
}

function fakeLake(options: FakeOptions = {}): StudyLake {
  const served = new Set(options.served ?? ["mnq_ohlcv_1m", TARGETS_VIEW, FOLDS_VIEW, LABELS_VIEW]);
  return {
    async hasView(name) {
      return served.has(name);
    },
    async columns() {
      return [];
    },
    async query<T>(sql: string): Promise<T[]> {
      options.log?.push(sql);
      let rows: unknown[] = [];
      if (sql.includes("AS available")) rows = [{ available: 2_344_645 }];
      else if (sql.includes("quantile_cont(er_15, 0.5) AS e15_median")) rows = [{ ...distribution("e15", 0.22), ...distribution("n15", 0.86), ...distribution("e60", 0.11), ...distribution("n60", 0.85) }];
      else if (sql.includes("AS w, least(")) rows = [{ w: 15, bin: 20, c: 500 }, { w: 15, bin: 21, c: 300 }, { w: 60, bin: 40, c: 100 }];
      else if (sql.includes("'straightest' AS kind")) rows = [{ kind: "straightest", i: 10, t: 2000, er: 0.79 }, { kind: "choppiest", i: 30, t: 4000, er: 0 }];
      else if (sql.includes("SELECT i, t, close FROM bars WHERE")) {
        rows = [];
        for (let i = 5; i <= 10; i += 1) rows.push({ i, t: i * 100, close: 100 + i });
        for (let i = 25; i <= 30; i += 1) rows.push({ i, t: i * 100, close: 120 - (i % 2) });
      } else if (sql.includes("efficiency_ratio_")) rows = [{ open: 1, close: 2, close_to_close_log_return: 0.0001, efficiency_ratio_15_bars: 0.2 }];
      else if (sql.includes("AS bar_count")) rows = [{ bar_count: 20000, first_ms: 1000, last_ms: 9000, finite_count: 19940, up_count: 10000, down_count: 9940, flat_count: 0, tail_labelled_count: 0, median_absolute_move: 20.5, agreement_checked: 19990, agreement_count: 9900 }];
      else if (sql.includes("AS off_by_one_checked")) rows = [{ checked: 19940, mismatches: 0, off_by_one_checked: 19939, off_by_one_mismatches: 800 }];
      else if (sql.includes("AS hour")) rows = [{ hour: 0, n: 100, up: 52 }, { hour: 1, n: 100, up: 48 }];
      else if (sql.includes("AS bin, count(*) AS c") && sql.includes("BETWEEN -150")) rows = [{ bin: 0, c: 3 }, { bin: 199, c: 4 }];
      else if (sql.includes("SELECT t, open, high, low, close FROM bars")) rows = [{ t: 1, open: 10, high: 12, low: 9, close: 11 }, { t: 2, open: 11, high: 13, low: 10, close: 12 }];
      else if (sql.includes("GROUP BY recipe")) rows = [{ recipe: "direction_MNQ_1m_abc", horizon: 12 }];
      else if (sql.includes("AS directional")) rows = [{ directional: 1000, disagreements: 0 }];
      else if (sql.includes(`FROM "${TARGETS_VIEW}"`)) rows = [TARGET];
      else if (sql.includes(`FROM "${FOLDS_VIEW}"`)) rows = [{ target: "fwd_er_vs_rw", fold: 1, ridge_skill: -0.0005623 }];
      return rows as T[];
    },
  };
}

async function runHandler(query: Record<string, unknown>, options: FakeOptions = {}) {
  const context: StudyContext = { lake: fakeLake(options), notes: [] };
  const body = await handler.run(pathGeometryQuery.parse(query), context);
  return { body, notes: context.notes };
}

describe("path geometry handler", () => {
  it("maps every query's rows into the body", async () => {
    const { body, notes } = await runHandler({ bars: 20_000, windows: "15,60", extremeWindow: 5 });
    expect(notes).toEqual([]);
    expect(body.bars).toEqual({ requested: 20_000, loaded: 20_000, available: 2_344_645, firstMs: 1000, lastMs: 9000 });
    expect(body.windows).toEqual([15, 60]);
    expect(body.statistics.map((entry) => entry.window)).toEqual([15, 60]);
    expect(body.statistics[0]?.nullRatio).toBeCloseTo(1 / Math.sqrt(15), 12);
    expect(body.statistics[0]?.normalized.median).toBe(0.86);
    expect(body.statistics[0]?.efficiency.percentile95).toBeCloseTo(0.22 * 2.9, 12);
    expect(body.histograms[0]?.counts).toHaveLength(HISTOGRAM_BINS);
    expect(body.histograms[0]?.counts[20]).toBe(500);
    expect(body.histograms[0]?.inRangeCount).toBe(800);
    expect(body.histograms[1]?.counts[40]).toBe(100);
    expect(body.extremes.window).toBe(5);
    expect(body.extremes.straightest?.index).toBe(9);
    expect(body.extremes.straightest?.closes).toEqual([105, 106, 107, 108, 109, 110]);
    expect(body.extremes.choppiest?.efficiency).toBe(0);
    expect(body.extremes.choppiest?.closes).toHaveLength(6);
    expect(body.labels?.upCount).toBe(10000);
    expect(body.labels?.alignmentMismatches).toBe(0);
    expect(body.labels?.offByOneMismatches).toBe(800);
    expect(body.hourRates).toEqual([{ hour: 0, count: 100, upCount: 52 }, { hour: 1, count: 100, upCount: 48 }]);
    expect(body.deltaCounts).toHaveLength(DELTA_BINS);
    expect(body.deltaCounts[0]).toBe(3);
    expect(body.deltaCounts[DELTA_BINS - 1]).toBe(4);
    expect(body.lakeLabelCheck).toEqual({ recipe: "direction_MNQ_1m_abc", horizon: 12, directionalChecked: 1000, signDisagreements: 0 });
    expect(body.slice?.rows).toEqual([[1, 10, 12, 9, 11], [2, 11, 13, 10, 12]]);
    expect(body.targets).toHaveLength(1);
    expect(body.folds).toHaveLength(1);
  });

  it("thins the frame to at most about 4,000 bars", async () => {
    const log: string[] = [];
    await runHandler({ bars: 400_000 }, { log });
    const frame = log.find((sql) => sql.includes("efficiency_ratio_"));
    expect(frame).toContain("i % 100 = 0");
  });

  it("answers with an empty body and a note when the bar view is not served", async () => {
    const { body, notes } = await runHandler({}, { served: [TARGETS_VIEW, FOLDS_VIEW] });
    expect(body.bars.loaded).toBe(0);
    expect(body.statistics).toEqual([]);
    expect(body.targets).toHaveLength(1);
    expect(notes.join(" ")).toContain("mnq_ohlcv_1m");
  });

  it("keeps the live sections when the landed results are missing", async () => {
    const { body, notes } = await runHandler({ bars: 20_000, windows: "15" }, { served: ["mnq_ohlcv_1m"] });
    expect(body.targets).toEqual([]);
    expect(body.folds).toEqual([]);
    expect(body.statistics).toHaveLength(1);
    expect(notes.join(" ")).toContain(TARGETS_VIEW);
  });

  it("notes a missing landed label set instead of failing", async () => {
    const { body, notes } = await runHandler({ bars: 20_000, windows: "15" }, { served: ["mnq_ohlcv_1m", TARGETS_VIEW, FOLDS_VIEW] });
    expect(body.lakeLabelCheck).toBeNull();
    expect(notes.join(" ")).toContain(LABELS_VIEW);
  });

  it("clamps the slice to the bars that exist", async () => {
    const log: string[] = [];
    await runHandler({ bars: 20_000, position: 0.95, segmentBars: 1000, horizon: 240 }, { log });
    const slice = log.find((sql) => sql.includes("SELECT t, open, high, low, close FROM bars"));
    // 20,000 bars, 1,240 needed: the start is clamped so the slice ends at the last bar.
    expect(slice).toContain("i > 18760 AND i <= 20000");
  });
});

describe("the route", () => {
  let server: Server;
  let base = "";
  beforeAll(async () => {
    const app = express();
    app.use("/api", createStudiesRouter([handler], fakeLake()));
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  });
  afterAll(() => {
    server.close();
  });

  it("answers 400 to a window list that is not numbers", async () => {
    const response = await fetch(`${base}/studies/path-geometry-study?windows=abc`);
    expect(response.status).toBe(400);
  });

  it("serves the body for the default query", async () => {
    const response = await fetch(`${base}/studies/path-geometry-study?bars=20000&windows=15,60&extremeWindow=5`);
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.slug).toBe("path-geometry-study");
    expect(json.data.statistics).toHaveLength(2);
  });
});

// ── the shared arithmetic ──────────────────────────────────────────────────

const CLOSES = [100.0, 101.5, 101.0, 102.25, 101.75, 103.0, 102.5, 102.5, 101.0, 104.0, 103.25, 105.5];
// scripts/path_geometry.py efficiency_ratio(log p, 5) on CLOSES, run by the notebook's own function.
const NOTEBOOK_ER = [null, null, null, null, null, 0.6003090662457267, 0.24999436789737084, 0.4300724292665779, 0.3349693661551029, 0.3580361197412276, 0.04320017650406092, 0.3962220301431307];

describe("efficiency ratio", () => {
  it("reproduces the notebook's function", () => {
    const series = efficiencySeries(CLOSES, 5);
    NOTEBOOK_ER.forEach((expected, index) => {
      if (expected === null) expect(series[index]).toBeNull();
      else expect(series[index]).toBeCloseTo(expected, 12);
    });
  });

  it("is 1 for a straight walk and 0 for a return to the start", () => {
    expect(windowGeometry([100, 101, 102, 103])?.efficiency).toBeCloseTo(1, 12);
    expect(windowGeometry([100, 105, 95, 100])?.efficiency).toBeCloseTo(0, 12);
    expect(windowGeometry([100, 100, 100])?.efficiency).toBeNull();
  });

  it("is causal: truncating the series leaves every earlier value unchanged", () => {
    const full = efficiencySeries(CLOSES, 5);
    const truncated = efficiencySeries(CLOSES.slice(0, 9), 5);
    truncated.forEach((value, index) => expect(value).toEqual(full[index]));
  });

  it("the truncation check can fail: a centred window is caught by it", () => {
    // Negative control: a non-causal variant that looks W/2 bars ahead changes earlier values when the tail is cut.
    const centred = (closes: number[]) => efficiencySeries(closes, 5).map((value, index) => (index + 2 < closes.length ? value : null));
    const full = centred(CLOSES);
    const truncated = centred(CLOSES.slice(0, 9));
    expect(truncated.some((value, index) => value !== full[index])).toBe(true);
  });

  it("centres a driftless random walk on 1 after the square-root correction", () => {
    let seed = 12345;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const gaussian = () => Math.sqrt(-2 * Math.log(random() + 1e-12)) * Math.cos(2 * Math.PI * random());
    const closes: number[] = [100];
    for (let i = 0; i < 60_000; i += 1) closes.push((closes[closes.length - 1] as number) * Math.exp(0.001 * gaussian()));
    const series = efficiencySeries(closes, 60).filter((value): value is number => value !== null);
    const mean = series.reduce((sum, value) => sum + value, 0) / series.length;
    expect(mean * Math.sqrt(60)).toBeGreaterThan(0.95);
    expect(mean * Math.sqrt(60)).toBeLessThan(1.1);
  });

  it("has the closed-form random-walk expectations", () => {
    for (const window of [15, 60, 240, 1440]) {
      const { net, path, ratio } = randomWalkExpectations(window, 0.0004);
      expect(ratio).toBeCloseTo(randomWalkNull(window), 12);
      expect(net / path).toBeCloseTo(1 / Math.sqrt(window), 12);
    }
  });
});

describe("forward labels", () => {
  it("labels close[t+H] > close[t] and leaves the last H bars unlabelled", () => {
    const { labels, delta } = forwardLabels([10, 11, 9, 9, 12], 2);
    expect(labels).toEqual([0, 0, 1, null, null]);
    expect(delta).toEqual([-1, -2, 3, null, null]);
  });

  it("drops moves inside the flat threshold", () => {
    const { labels } = forwardLabels([10, 10.25, 10.5, 12], 1, 0.3);
    expect(labels).toEqual([null, null, 1, null]);
  });

  it("rounds the change to 32 bits as the project's labeller does", () => {
    const { delta } = forwardLabels([0.1, 0.3], 1);
    expect(delta[0]).toBe(Math.fround(0.3 - 0.1));
  });

  it("agrees with a label derived by position: the alignment check and its negative control", () => {
    const closes = Array.from({ length: 200 }, (_, i) => 100 + Math.sin(i / 5) * 4 + (i % 7) * 0.25);
    const horizon = 12;
    const { labels } = forwardLabels(closes, horizon);
    let mismatches = 0;
    let offByOne = 0;
    for (let i = 0; i + horizon + 1 < closes.length; i += 1) {
      const label = labels[i] as 0 | 1;
      if (label !== ((closes[i + horizon] as number) > (closes[i] as number) ? 1 : 0)) mismatches += 1;
      if (label !== ((closes[i + horizon + 1] as number) > (closes[i] as number) ? 1 : 0)) offByOne += 1;
    }
    expect(mismatches).toBe(0);
    expect(offByOne).toBeGreaterThan(0);
  });

  it("counts candle colour against arrow over labelled bars only", () => {
    const result = candleAgreement([10, 10, 10], [11, 9, 11], [1, 1, null]);
    expect(result).toEqual({ checked: 2, agreeing: 1 });
  });
});

describe("histogram and axis helpers", () => {
  it("normalises counts to a density over the in-range total", () => {
    const density = densityFromCounts([10, 30, 60], 0.5);
    expect(density.reduce((sum, value) => sum + value * 0.5, 0)).toBeCloseTo(1, 12);
  });

  it("merges adjacent bins and keeps the total", () => {
    const merged = mergeBins([1, 2, 3, 4, 5, 6], 3);
    expect(merged).toEqual([6, 15]);
  });

  it("symlog matches matplotlib's transform and inverts", () => {
    expect(symlog(0)).toBe(0);
    expect(symlog(1e-4)).toBeCloseTo(1 / 0.9, 12);
    expect(symlog(1)).toBeCloseTo(1 / 0.9 + 4, 12);
    expect(symlog(-0.01)).toBeCloseTo(-(1 / 0.9 + 2), 12);
    for (const value of [-0.3, -1e-4, -3e-5, 0, 2e-6, 1e-4, 0.05, 2]) expect(inverseSymlog(symlog(value))).toBeCloseTo(value, 12);
  });

  it("reads an interval against zero", () => {
    expect(intervalVerdict(-0.1, -0.01)).toBe("below zero");
    expect(intervalVerdict(0.01, 0.1)).toBe("above zero");
    expect(intervalVerdict(-0.1, 0.1)).toBe("spans zero");
    expect(intervalVerdict(null, 0.1)).toBe("missing");
  });
});

describe("skill over the best trivial predictor", () => {
  it("reproduces the stored skill of fold 1 of fwd_er_vs_rw (ridge)", () => {
    // per_fold[0] of MNQ_1m_path_geometry_fwd_er_vs_rw_h60/best_meta.json
    const skill = skillOverBaseline(-0.0016089624834918492, -1.005769559060202, -0.001046644467205704);
    expect(skill).toBeCloseTo(-0.0005623180162861452, 12);
  });

  it("does not hand a constant a free +1 by scoring against persistence alone", () => {
    const persistence = -1;
    const trainMean = -0.001;
    expect(skillOverBaseline(trainMean, persistence, trainMean)).toBe(0);
    expect(trainMean - persistence).toBeCloseTo(0.999, 12);
  });
});
