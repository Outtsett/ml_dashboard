/**
 * The from-bars-to-a-tensor handler (apps/api/studies/handlers/quant-bars-to-tensor.ts)
 * on a fake lake, and the pure compute it shares with the page
 * (packages/shared/src/studies/quant-bars-to-tensor.ts) checked against numbers from
 * quantlab's own data.distribution / data.persistence_baseline /
 * data.split_walk_forward run on the same inputs.
 */

import type { Server } from "http";
import type { AddressInfo } from "net";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import handler, { pipelineSql, rawCountSql, resetPipelineCache } from "../../studies/handlers/quant-bars-to-tensor";
import { createStudiesRouter } from "../../studies/studies.router";
import type { StudyContext, StudyLake } from "../../studies/types";
import {
  FEATURE_NAMES, distribution, fineHistogram, mergeBins, persistenceBaseline, splitWalkForward, trailingMoments,
  usableRowIndices, windowCountFor, windowTargets, windowsSpanningDroppedRows,
  type BarsBody, type SummaryBody, type WindowBody, type WindowUnavailable,
} from "@shared/studies/quant-bars-to-tensor";

// ── pure compute against quantlab's numbers ─────────────────────────────────

describe("distribution (data.distribution)", () => {
  it("matches quantlab on five values: n - 1 standard deviation, mixed-estimator skewness and kurtosis", () => {
    const summary = distribution([1, 2, 3, 4, 10]);
    expect(summary.count).toBe(5);
    expect(summary.mean).toBe(4);
    expect(summary.median).toBe(3);
    expect(summary.standardDeviation).toBeCloseTo(3.5355339059, 9);
    expect(summary.skewness).toBeCloseTo(0.8145870119, 9);
    expect(summary.kurtosis).toBeCloseTo(-1.21568, 9);
    expect(summary.percentile25).toBe(2);
    expect(summary.percentile75).toBe(4);
    expect(summary.minimum).toBe(1);
    expect(summary.maximum).toBe(10);
  });

  it("reports unknown moments as null, never omits the row", () => {
    const two = distribution([5, 7]);
    expect(two.standardDeviation).toBeCloseTo(1.4142135623730951, 12);
    expect(two.skewness).toBeNull();
    expect(two.kurtosis).toBeNull();
    expect(two.percentile25).toBe(5.5);
    const three = distribution([5, 7, 9]);
    expect(three.skewness).toBe(0);
    expect(three.kurtosis).toBeNull();
    expect(distribution([]).count).toBe(0);
    expect(distribution([]).mean).toBeNull();
  });

  it("ignores NaN and infinity, as the notebook's isfinite filter does", () => {
    expect(distribution([1, Number.NaN, 2, Number.POSITIVE_INFINITY, 3]).count).toBe(3);
  });
});

describe("persistenceBaseline (data.persistence_baseline)", () => {
  const last = [0.5, -1.0, 1.5, -0.5, 2.0, 1.0];
  const targets = [-0.25, 0.5, -0.5, 0.25, -1.0, 0.75];

  it("reproduces quantlab's three numbers on the same arrays", () => {
    const baseline = persistenceBaseline(last, targets);
    expect(baseline).not.toBeNull();
    expect(baseline!.persistenceMeanSquaredError).toBeCloseTo(1.3600679636001587, 6);
    expect(baseline!.zeroPredictionMeanSquaredError).toBeCloseTo(0.3645833432674408, 6);
    expect(baseline!.targetVariance).toBeCloseTo(0.3628472089767456, 6);
  });

  it("the least-squares copy can never score worse than the notebook's scaled copy", () => {
    const baseline = persistenceBaseline(last, targets)!;
    expect(baseline.bestScaledCopyMeanSquaredError).toBeLessThanOrEqual(baseline.persistenceMeanSquaredError);
    // anti-correlated here, so the best copy flips sign
    expect(baseline.bestScaledCopyScale).toBeLessThan(0);
    expect(baseline.lastReturnCorrelation).toBeLessThan(0);
  });

  it("returns null with nothing to score", () => {
    expect(persistenceBaseline([], [])).toBeNull();
  });
});

describe("splitWalkForward (data.split_walk_forward)", () => {
  it("reproduces the notebook's MNQ Jun-Aug 2024 split: 87,598 windows, 61,318 train, 25,992 validation", () => {
    const split = splitWalkForward(87_598, 32, 256);
    expect(split.trainEnd).toBe(61_318);
    expect(split.purge).toBe(288);
    expect(split.validationStart).toBe(61_606);
    expect(split.validationWindowCount).toBe(25_992);
  });

  it("takes the slider's normalization window into the purge, and never runs past the end", () => {
    expect(splitWalkForward(1_000, 32, 1_024).purge).toBe(1_056);
    const tight = splitWalkForward(1_000, 32, 1_024);
    expect(tight.validationStart).toBe(1_000);
    expect(tight.validationWindowCount).toBe(0);
  });
});

describe("window bookkeeping", () => {
  it("counts windows: the last has no bar after it, too few rows give none", () => {
    expect(windowCountFor(100, 32)).toBe(68);
    expect(windowCountFor(33, 32)).toBe(0);
    expect(windowCountFor(34, 32)).toBe(2);
  });

  it("targets are the log return on the usable row after the window's last row", () => {
    const close = [100, 101, 102, 104, 103];
    const usable = Int32Array.from([0, 1, 2, 3, 4]);
    const targets = windowTargets(usable, close, 2);
    expect(targets.length).toBe(3);
    expect(targets[0]).toBeCloseTo(Math.log(102 / 101), 12);
    expect(targets[1]).toBeCloseTo(Math.log(104 / 102), 12);
    expect(targets[2]).toBeCloseTo(Math.log(103 / 104), 12);
  });

  it("counts windows that span a dropped raw row", () => {
    // usable raw rows 0,1,2,3,5,6,7,8,9: row 4 was dropped
    expect(windowsSpanningDroppedRows(Int32Array.from([0, 1, 2, 3, 5, 6, 7, 8, 9]), 3)).toBe(3);
    expect(windowsSpanningDroppedRows(Int32Array.from([0, 1, 2, 3, 4, 5, 6]), 3)).toBe(0);
  });

  it("keeps only rows whose six z-scores are all known", () => {
    const columns = [[1, Number.NaN, 3], [1, 2, 3]];
    expect(Array.from(usableRowIndices(columns, 3))).toEqual([0, 2]);
  });

  it("trailing moments are population moments and unknown when any value in the window is", () => {
    const moments = trailingMoments([1, 2, 3, 4], 3, 4)!;
    expect(moments.mean).toBe(2.5);
    expect(moments.standardDeviation).toBeCloseTo(Math.sqrt(1.25), 12);
    expect(trailingMoments([1, Number.NaN, 3, 4], 3, 4)).toBeNull();
    expect(trailingMoments([1, 2], 1, 4)).toBeNull();
  });

  it("histogram bins account for every finite value and merge exactly", () => {
    const values = Array.from({ length: 1000 }, (_, i) => Math.sin(i) * 3);
    const histogram = fineHistogram(values)!;
    const binned = histogram.counts.reduce((a, b) => a + b, 0);
    expect(binned + histogram.below + histogram.above).toBe(1000);
    const merged = mergeBins(histogram.counts, 30);
    expect(merged).toHaveLength(30);
    expect(merged.reduce((a, b) => a + b, 0)).toBe(binned);
    expect(fineHistogram([])).toBeNull();
  });
});

// ── the SQL ─────────────────────────────────────────────────────────────────

describe("pipeline SQL", () => {
  const sql = pipelineSql("MNQ", 1_717_200_000, 1_725_148_800, 256);

  it("rolls per UTC day by volume, guards the trailing window by its count and the spread by 1e-12", () => {
    expect(sql).toContain('FROM "bars"');
    expect(sql).toContain("root = 'MNQ'");
    expect(sql).toContain("timeframe = '1m'");
    expect(sql).toContain("to_timestamp(1717200000)");
    expect(sql).toContain("ROWS BETWEEN 255 PRECEDING AND CURRENT ROW");
    expect(sql).toContain("stddev_pop(log_return_close) OVER w");
    expect(sql).toContain("log_return_close_known = 256 AND log_return_close_spread > 1e-12");
    expect(sql).toContain("ORDER BY total_volume DESC, symbol ASC");
    for (const name of FEATURE_NAMES) expect(sql).toContain(`${name}_zscore`);
  });

  it("puts only numbers and quoted literals into the text", () => {
    expect(rawCountSql("ES", 1, 2)).toContain("root = 'ES'");
    expect(() => pipelineSql("MNQ", Number.NaN, 2, 256)).toThrow();
  });
});

// ── the handler on a fake lake ──────────────────────────────────────────────

const WINDOW = 16;
const SEQUENCE = 4;

/** A deterministic random walk with zero-range bars, carried through the same formulas the SQL uses. */
function syntheticRows(count: number, window: number) {
  let seed = 12345;
  const random = () => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    return seed / 2_147_483_648;
  };
  const bars: Array<{ open: number; high: number; low: number; close: number; volume: number; symbol: string; ts: number }> = [];
  let price = 20_000;
  for (let i = 0; i < count; i += 1) {
    const open = price;
    const close = open + (random() - 0.5) * 20;
    const flat = i === 40;
    const high = flat ? open : Math.max(open, close) + random() * 4;
    const low = flat ? open : Math.min(open, close) - random() * 4;
    bars.push({ open, high, low: flat ? open : low, close: flat ? open : close, volume: Math.round(50 + random() * 400), symbol: i < count / 2 ? "MNQU4" : "MNQZ4", ts: 1_717_200_000_000 + i * 60_000 });
    price = flat ? open : close;
  }
  const raw = bars.map((bar, i) => {
    const previous = i > 0 ? (bars[i - 1] as (typeof bars)[number]) : null;
    const span = bar.high - bar.low;
    const positive = span > 0;
    return [
      previous ? Math.log(bar.close / previous.close) : null,
      positive ? (bar.close - bar.open) / span : null,
      positive ? (bar.high - Math.max(bar.open, bar.close)) / span : null,
      positive ? (Math.min(bar.open, bar.close) - bar.low) / span : null,
      (bar.high - bar.low) / bar.close,
      previous ? Math.log((bar.volume + 1) / (previous.volume + 1)) : null,
    ];
  });
  return bars.map((bar, i) => {
    const row: Record<string, unknown> = {
      bar_index: BigInt(i), timestamp_milliseconds: BigInt(bar.ts), contract_symbol: bar.symbol,
      open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume,
    };
    FEATURE_NAMES.forEach((name, column) => {
      row[name] = (raw[i] as Array<number | null>)[column];
      const windowValues: Array<number | null> = [];
      for (let k = i - window + 1; k <= i; k += 1) windowValues.push(k >= 0 ? ((raw[k] as Array<number | null>)[column] ?? null) : null);
      if (windowValues.some((v) => v === null)) {
        row[`${name}_zscore`] = null;
        return;
      }
      const values = windowValues as number[];
      const mean = values.reduce((a, b) => a + b, 0) / window;
      const spread = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / window);
      row[`${name}_zscore`] = spread > 1e-12 ? ((raw[i] as number[])[column]! - mean) / spread : null;
    });
    return row;
  });
}

interface FakeLake extends StudyLake {
  executed: string[];
}

function fakeLake(options: { served?: boolean; rawCount?: number; rows?: Array<Record<string, unknown>> } = {}): FakeLake {
  const executed: string[] = [];
  const rows = options.rows ?? syntheticRows(400, WINDOW);
  return {
    executed,
    async query<T>(sql: string): Promise<T[]> {
      executed.push(sql);
      if (sql.includes("raw_bar_count")) return [{ raw_bar_count: BigInt(options.rawCount ?? rows.length * 2) }] as T[];
      return rows as T[];
    },
    async hasView() {
      return options.served ?? true;
    },
    async columns() {
      return [];
    },
  };
}

const PARAMETERS = { root: "MNQ", startDate: "2024-06-01", endDate: "2024-09-01", normalizationWindow: WINDOW, sequenceLength: SEQUENCE, windowIndex: -1, barOffset: 0, barRows: 25 } as const;

async function run(lake: StudyLake, overrides: Record<string, unknown> = {}) {
  const context: StudyContext = { lake, notes: [] };
  const parsed = handler.query.parse({ ...PARAMETERS, ...overrides });
  const body = await handler.run(parsed, context);
  return { body, notes: context.notes };
}

describe("quant-bars-to-tensor handler", () => {
  beforeEach(() => resetPipelineCache());

  it("summary: stages, drops, windows, split and baselines agree with each other", async () => {
    const lake = fakeLake();
    const { body } = await run(lake);
    const summary = body as SummaryBody;
    expect(summary.landed).toBe(true);
    expect(summary.bars?.count).toBe(400);
    expect(summary.bars?.contracts.map((c) => c.contractSymbol)).toEqual(["MNQU4", "MNQZ4"]);
    expect(summary.bars?.zeroRangeBarCount).toBe(1);
    // 5 raw + 6 features + 6 z-scored + the target
    expect(summary.stages).toHaveLength(18);
    expect(summary.stages.map((s) => s.stage)).toEqual([
      ...Array(5).fill("raw bars"), ...Array(6).fill("feature vector"), ...Array(6).fill("z-scored features"), "windowed target",
    ]);
    const norm = summary.normalization!;
    expect(norm.droppedRowCount + norm.usableRowCount).toBe(400);
    expect(norm.warmupRowCount).toBe(WINDOW);
    expect(norm.unknownInsideWindowCount).toBe(norm.droppedRowCount - WINDOW);
    // the zero-range bar (row 40) poisons the next WINDOW rows of three features
    expect(norm.unknownInsideWindowCount).toBeGreaterThan(0);

    expect(summary.tensor?.windowCount).toBe(norm.usableRowCount - SEQUENCE);
    expect(summary.tensor?.windowsSpanningDroppedRows).toBeGreaterThan(0);
    const split = summary.split!;
    expect(split.trainWindowCount).toBe(Math.trunc(summary.tensor!.windowCount * 0.7));
    expect(split.purgeWindowCount).toBe(SEQUENCE + WINDOW);
    expect(split.notebookPurgeWindowCount).toBe(SEQUENCE + 256);
    expect(split.validationStart + split.validationWindowCount).toBe(summary.tensor!.windowCount);
    expect(summary.baseline?.validationWindowCount).toBe(split.validationWindowCount);
    expect(summary.baseline!.zeroPredictionMeanSquaredError).toBeGreaterThan(0);
    // each z-scored feature's count is its own number of finite z-scores
    const body1 = summary.stages.find((s) => s.name === "body_fraction_of_range_zscore")!;
    const log1 = summary.stages.find((s) => s.name === "log_return_close_zscore")!;
    expect(log1.summary.count).toBeGreaterThan(body1.summary.count);
    expect(summary.timeline.length).toBeGreaterThan(10);
    for (const point of summary.timeline) expect(point.usableShare).toBeGreaterThanOrEqual(0);
  });

  it("the z-scored columns come out standardised: mean near 0 and standard deviation near 1", async () => {
    const { body } = await run(fakeLake());
    const summary = body as SummaryBody;
    const z = summary.stages.find((s) => s.name === "normalized_range_zscore")!;
    expect(Math.abs(z.summary.mean ?? 9)).toBeLessThan(0.5);
    expect(z.summary.standardDeviation ?? 0).toBeGreaterThan(0.5);
    expect(z.summary.standardDeviation ?? 9).toBeLessThan(1.6);
  });

  it("scans the lake once for the same range, however the sequence length moves", async () => {
    const lake = fakeLake();
    await run(lake, { sequenceLength: 4 });
    const after = lake.executed.length;
    await run(lake, { sequenceLength: 8 });
    await run(lake, { part: "window", sequenceLength: 8 });
    await run(lake, { part: "bars" });
    expect(lake.executed.length).toBe(after);
    await run(lake, { normalizationWindow: 24 });
    expect(lake.executed.length).toBeGreaterThan(after);
  });

  it("window: one window's rows, its target and its partition, consistent with the summary", async () => {
    const lake = fakeLake();
    const summary = (await run(lake)).body as SummaryBody;
    const middle = summary.tensor!.defaultWindowIndex;
    const { body } = await run(lake, { part: "window" });
    const window = body as WindowBody;
    expect(window.landed).toBe(true);
    expect(window.windowIndex).toBe(middle);
    expect(window.values).toHaveLength(SEQUENCE);
    expect(window.values[0]).toHaveLength(6);
    expect(window.timestampsMs).toHaveLength(SEQUENCE);
    expect(window.targetLogReturn).toBeCloseTo(Math.log(window.targetClose / window.endClose), 12);
    expect(window.lastBar.trailingMean).toHaveLength(6);
    expect(window.lastBar.trailingValues[4]).toHaveLength(WINDOW);
    const trailing = window.lastBar.trailingValues[4]!;
    expect(trailing[trailing.length - 1]).toBe(window.lastBar.featureValues[4]);
    expect(trailing.reduce((a, b) => a + b, 0) / WINDOW).toBeCloseTo(window.lastBar.trailingMean[4]!, 12);
    // the window's last z-score is (x - trailing mean) / trailing spread
    const x = window.lastBar.featureValues[4]!;
    const mean = window.lastBar.trailingMean[4]!;
    const spread = window.lastBar.trailingStandardDeviation[4]!;
    expect((x - mean) / spread).toBeCloseTo(window.lastBar.zscores[4]!, 9);
    expect(window.partition).toBe(middle < summary.split!.trainEnd ? "train" : "validation");
    expect(window.errorTerms).toBeNull();

    const last = (await run(lake, { part: "window", windowIndex: 100_000 })).body as WindowBody;
    expect(last.windowIndex).toBe(summary.tensor!.windowCount - 1);
    expect(last.partition).toBe("validation");
    expect(last.errorTerms?.zeroSquaredError).toBeCloseTo(last.targetLogReturn ** 2, 18);
    const purge = (await run(lake, { part: "window", windowIndex: summary.split!.trainEnd })).body as WindowBody;
    expect(purge.partition).toBe("purge");
  });

  it("bars: a page of raw rows from the offset", async () => {
    const { body } = await run(fakeLake(), { part: "bars", barOffset: 10, barRows: 5 });
    const page = body as BarsBody;
    expect(page.total).toBe(400);
    expect(page.rows.map((r) => r.barIndex)).toEqual([10, 11, 12, 13, 14]);
    expect(page.rows[0]?.contractSymbol).toBe("MNQU4");
  });

  it("degrades to an empty body and a note when `bars` is not served", async () => {
    const { body, notes } = await run(fakeLake({ served: false }));
    expect((body as SummaryBody).landed).toBe(false);
    expect(notes.join(" ")).toContain("Not in the lake yet: bars");
    const window = (await run(fakeLake({ served: false }), { part: "window" })).body as WindowUnavailable;
    expect(window.landed).toBe(false);
  });

  it("refuses a range with more than a million raw rows, and says so", async () => {
    const lake = fakeLake({ rawCount: 1_000_001 });
    const { body, notes } = await run(lake);
    expect((body as SummaryBody).landed).toBe(false);
    expect(notes.join(" ")).toContain("Shorten the range");
    expect(lake.executed.every((sql) => sql.includes("raw_bar_count"))).toBe(true);
  });

  it("says so when the range holds no bars, and when the dates are backwards or not real", async () => {
    expect((await run(fakeLake({ rawCount: 0 }))).notes.join(" ")).toContain("no 1-minute MNQ bars");
    expect((await run(fakeLake(), { startDate: "2024-09-01", endDate: "2024-06-01" })).notes.join(" ")).toContain("end date must come after");
    expect((await run(fakeLake(), { startDate: "2024-02-31" })).notes.join(" ")).toContain("not a real calendar day");
  });

  it("too few usable rows for one window leaves the tensor empty with a note", async () => {
    const rows = syntheticRows(30, WINDOW);
    const { body, notes } = await run(fakeLake({ rows }), { sequenceLength: 20 });
    expect((body as SummaryBody).tensor).toBeNull();
    expect(notes.join(" ")).toContain("not enough");
  });

  it("rejects a root outside the eight and a window outside its range", () => {
    expect(handler.query.safeParse({ root: "XX" }).success).toBe(false);
    expect(handler.query.safeParse({ normalizationWindow: 4 }).success).toBe(false);
    expect(handler.query.safeParse({ startDate: "June 1" }).success).toBe(false);
    expect(handler.query.parse({}).sequenceLength).toBe(32);
  });
});

describe("GET /api/studies/quant-bars-to-tensor", () => {
  let server: Server;
  let base = "";
  beforeAll(async () => {
    resetPipelineCache();
    const app = express();
    app.use("/api", createStudiesRouter([handler], fakeLake()));
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  });
  afterAll(() => server.close());

  it("serves the summary through the router with the controls in the query string", async () => {
    const response = await fetch(`${base}/studies/quant-bars-to-tensor?normalizationWindow=${WINDOW}&sequenceLength=${SEQUENCE}`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.slug).toBe("quant-bars-to-tensor");
    expect(body.data.part).toBe("summary");
    expect(body.data.stages).toHaveLength(18);
  });

  it("answers a bad control with a client error, not a scan", async () => {
    const response = await fetch(`${base}/studies/quant-bars-to-tensor?root=XX`);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
  });
});
