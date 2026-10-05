// @vitest-environment jsdom
/**
 * The label-overlay study: the handler's SQL run for real on an in-memory
 * DuckDB whose two tables carry the lake views' names and columns
 * (mnq_labels_1m, mnq_ohlcv_1m) and hold labels derived from their own bars.
 * It checks the notebook's window rule (rolling sum of bar ranges, busiest and
 * median activity, the window ending one row before the chosen index), the
 * whole-dataset alignment checks with their negative control (a flipped label
 * must be caught), the absolute-row exit audit, the exact column profiles, and
 * the missing-view degradation, then the shared pure computation (regime runs,
 * barrier boxes with the exit fix, class shares, the mismatch terms), and the
 * page rendered in jsdom from those bodies so every panel's drawing code runs.
 */

import { createElement } from "react";
import { DuckDBInstance } from "@duckdb/node-api";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import Page from "@/studies/pages/label-overlay/Page";
import handler, { BARS_VIEW, LABELS_VIEW } from "../../studies/handlers/label-overlay";
import { plainRow } from "../../studies/sql";
import type { StudyLake } from "../../studies/types";
import { eightNumberSummary } from "@shared/lens/stats";
import {
  DIRECTION_HORIZONS,
  FORWARD_RETURN_HORIZONS,
  LABEL_COLUMNS,
  VOLATILITY_HORIZONS,
  barrierBoxes,
  classShares,
  directionMismatchTerms,
  majorityBaseline,
  pointsTravelled,
  rebin,
  regimeRuns,
  trailingMeanMinOne,
  type DatasetBody,
  type WindowBody,
  type WindowRow,
} from "@shared/studies/label-overlay";

const ROWS = 400;
const EXTRA_BARS = 4;
const BARS = 60;

let instance: DuckDBInstance;

async function run(sql: string): Promise<Array<Record<string, unknown>>> {
  const connection = await instance.connect();
  try {
    return (await connection.runAndReadAll(sql)).getRowObjectsJS().map((row) => plainRow(row as Record<string, unknown>));
  } finally {
    connection.closeSync();
  }
}

const lake: StudyLake = {
  async query<T>(sql: string): Promise<T[]> {
    return (await run(sql)) as T[];
  },
  async hasView(name) {
    return Number((await run(`SELECT count(*) AS n FROM information_schema.tables WHERE table_name = '${name}'`))[0]?.n) > 0;
  },
  async columns() {
    return [];
  },
};

const emptyLake: StudyLake = { async query() { return []; }, async hasView() { return false; }, async columns() { return []; } };

const NAN = "'NaN'::DOUBLE";

/** A label that is NaN where its bar ahead does not exist, as the real dataset's tail is. */
const ahead = (horizon: number, expression: string): string => `CASE WHEN LEAD(close, ${horizon}) OVER bars IS NULL THEN ${NAN} ELSE ${expression} END`;

function labelExpression(stored: string): string {
  const horizon = Number(stored.match(/_h(\d+)$/)?.[1] ?? 0);
  if (stored.startsWith("dir_h")) return ahead(horizon, `CAST(LEAD(close, ${horizon}) OVER bars > close AS DOUBLE)`);
  if (stored.startsWith("dir_delta_pts_h")) return ahead(horizon, `LEAD(close, ${horizon}) OVER bars - close`);
  if (stored.startsWith("fwd_ret_h")) return ahead(horizon, `ln(LEAD(close, ${horizon}) OVER bars) - ln(close)`);
  if (stored.startsWith("vol_logrange_h")) return `CASE WHEN LEAD(high - low, ${horizon}) OVER bars > 0 THEN ln(LEAD(high - low, ${horizon}) OVER bars) ELSE ${NAN} END`;
  switch (stored) {
    case "range_pts": return "high - low";
    case "zero_range": return "high = low";
    case "logrange": return `CASE WHEN high - low > 0 THEN ln(high - low) ELSE ${NAN} END`;
    case "rng_bucket_h1": return "CAST(10 + 10 * sin(i / 5.0) AS DOUBLE)";
    case "tbl_label": return "CAST((i % 3) - 1 AS DOUBLE)";
    case "tbl_ret_pts": return "CAST(sin(i / 3.0) * 4 AS DOUBLE)";
    // Absolute row number of the exit: one to five bars after the entry; the last rows are unresolved (-1).
    case "tbl_exit_bar": return `CASE WHEN i + 1 + (i % 5) > ${ROWS - 1} THEN -1.0 ELSE CAST(i + 1 + (i % 5) AS DOUBLE) END`;
    case "swing_label": return "CAST((i % 3) - 1 AS DOUBLE)";
    case "swing_ret_pts": return "CAST(abs(sin(i / 4.0)) * 9 AS DOUBLE)";
    case "vol_regime": return "CAST((i / 40) % 3 AS DOUBLE)";
    case "meta_armed": return "CAST(i % 2 AS DOUBLE)";
    case "meta_side": return "CAST((i % 3) - 1 AS DOUBLE)";
    case "meta_label": return "CAST(i % 2 AS DOUBLE)";
    case "meta_ret_pts": return "CAST(0 AS DOUBLE)";
    default: return `CAST(sin(i / 2.0) + ${stored.length} AS DOUBLE)`;
  }
}

beforeAll(async () => {
  instance = await DuckDBInstance.create(":memory:");
  await run(`CREATE TABLE ${BARS_VIEW} AS
    SELECT TIMESTAMPTZ '2025-01-01 00:00:00+00' + i * INTERVAL 1 MINUTE AS timestamp, 'MNQ' AS symbol,
      c - 0.25 AS open, GREATEST(c, c - 0.25) + CASE WHEN i % 97 = 0 THEN 0 ELSE 0.5 + (i % 4) * 0.25 END AS high,
      LEAST(c, c - 0.25) - CASE WHEN i % 97 = 0 THEN 0 ELSE 0.5 + (i % 3) * 0.25 END AS low, c AS close, 100.0 + i AS volume
    FROM (SELECT i, 100 + sin(i / 7.0) * 10 + i * 0.01 AS c FROM range(${ROWS + EXTRA_BARS}) AS t(i))`);
  // A zero-range bar: make open, high, low and close equal on those rows.
  await run(`UPDATE ${BARS_VIEW} SET open = close, high = close, low = close WHERE epoch(timestamp) % (97 * 60) = 0`);
  const columns = LABEL_COLUMNS.map((column) => `${labelExpression(column.stored)} AS ${column.stored}`).join(",\n    ");
  await run(`CREATE TABLE ${LABELS_VIEW} AS
    SELECT timestamp, symbol, ${columns} FROM (
      SELECT row_number() OVER bars - 1 AS i, * FROM ${BARS_VIEW} WHERE timestamp < TIMESTAMPTZ '2025-01-01 00:00:00+00' + ${ROWS} * INTERVAL 1 MINUTE WINDOW bars AS (ORDER BY timestamp)
    ) WINDOW bars AS (ORDER BY timestamp)`);
});

afterAll(() => {
  instance.closeSync();
});

async function windowFor(query: Record<string, unknown>, notes: string[] = []): Promise<WindowBody> {
  const body = await handler.run(handler.query.parse({ section: "window", bars: BARS, ...query }), { lake, notes });
  if (body.section !== "window") throw new Error("expected the window section");
  return body.window;
}

async function datasetBody(notes: string[] = []): Promise<DatasetBody> {
  const body = await handler.run(handler.query.parse({ section: "dataset" }), { lake, notes });
  if (body.section !== "dataset") throw new Error("expected the dataset section");
  return body.dataset;
}

/** The notebook's rule over a plain array: rolling sum over `bars`, valid at indices [bars, length - 2], window ends one row before the chosen index. */
function expectedStarts(ranges: number[], bars: number): { busiest: number; median: number } {
  const rolling: Array<{ index: number; value: number }> = [];
  for (let index = bars; index <= ranges.length - 2; index += 1) {
    let sum = 0;
    for (let j = index - bars + 1; j <= index; j += 1) sum += ranges[j] as number;
    rolling.push({ index, value: sum });
  }
  const sorted = rolling.map((entry) => entry.value).sort((a, b) => a - b);
  const middle = (sorted.length - 1) / 2;
  const median = (sorted[Math.floor(middle)]! + sorted[Math.ceil(middle)]!) / 2;
  let busiest = rolling[0]!;
  let closest = rolling[0]!;
  for (const entry of rolling) {
    if (entry.value > busiest.value) busiest = entry;
    if (Math.abs(entry.value - median) < Math.abs(closest.value - median)) closest = entry;
  }
  return { busiest: Math.max(busiest.index - bars, 0), median: Math.max(closest.index - bars, 0) };
}

describe("label-overlay handler, window section", () => {
  it("picks the notebook's busiest and median-activity windows", async () => {
    const ranges = (await run(`SELECT range_pts FROM ${LABELS_VIEW} ORDER BY timestamp`)).map((row) => Number(row.range_pts));
    expect(ranges).toHaveLength(ROWS);
    const expected = expectedStarts(ranges, BARS);
    const body = await windowFor({ window: "busiest" });
    expect(body.datasetRows).toBe(ROWS);
    expect(body.busiest?.startRow).toBe(expected.busiest);
    expect(body.median?.startRow).toBe(expected.median);
    expect(body.window?.startRow).toBe(expected.busiest);
    expect(body.rows).toHaveLength(BARS);
    expect(body.rows[0]?.row_number).toBe(expected.busiest);
    expect(body.rows[BARS - 1]?.row_number).toBe(expected.busiest + BARS - 1);
    const medianBody = await windowFor({ window: "median" });
    expect(medianBody.window?.startRow).toBe(expected.median);
  });

  it("returns bars and labels joined on timestamp, under full-word names, with unknown labels as null", async () => {
    const body = await windowFor({ window: "latest" });
    expect(body.window?.startRow).toBe(ROWS - BARS);
    const last = body.rows[BARS - 1] as WindowRow;
    expect(last.row_number).toBe(ROWS - 1);
    expect(last.close).toBeGreaterThan(0);
    expect(last.direction_up_after_1_bars).toBeNull(); // the tail has no bar ahead: NaN in the lake, null here
    expect(last.triple_barrier_exit_row_number).toBe(-1);
    expect(Object.keys(last)).toContain("forward_log_return_1440_bars");
    expect(Object.keys(last).some((key) => /^dir_|^fwd_|^tbl_/.test(key))).toBe(false);
    const first = body.rows[0] as WindowRow;
    expect(first.direction_up_after_15_bars === 0 || first.direction_up_after_15_bars === 1).toBe(true);
  });

  it("starts a window at a date, clamped so it always holds the full bar count", async () => {
    const early = await windowFor({ window: "date", date: "2025-01-01" });
    expect(early.window?.startRow).toBe(0);
    const late = await windowFor({ window: "date", date: "2030-01-01" });
    expect(late.window?.startRow).toBe(ROWS - BARS);
    const notes: string[] = [];
    const missingDate = await windowFor({ window: "date" }, notes);
    expect(notes.join(" ")).toContain("Pick a date");
    expect(missingDate.window?.startRow).toBe(missingDate.busiest?.startRow);
  });

  it("refuses queries the page must never send", () => {
    expect(handler.query.safeParse({ bars: 59 }).success).toBe(false);
    expect(handler.query.safeParse({ bars: 2001 }).success).toBe(false);
    expect(handler.query.safeParse({ window: "constructor" }).success).toBe(false);
    expect(handler.query.safeParse({ window: "date", date: "2025-01-01'; DROP TABLE x; --" }).success).toBe(false);
    expect(handler.query.safeParse({ section: "everything" }).success).toBe(false);
    expect(handler.query.parse({})).toEqual({ section: "window", window: "busiest", bars: 240 });
  });

  it("degrades to empty bodies and a note when the views are not landed", async () => {
    const notes: string[] = [];
    const body = await handler.run(handler.query.parse({ section: "window" }), { lake: emptyLake, notes });
    expect(body.section === "window" && body.window.rows).toEqual([]);
    expect(notes.join(" ")).toContain("Not in the lake yet");
    const datasetNotes: string[] = [];
    const dataset = await handler.run(handler.query.parse({ section: "dataset" }), { lake: emptyLake, notes: datasetNotes });
    expect(dataset.section === "dataset" && dataset.dataset.profiles).toEqual([]);
  });
});

describe("label-overlay handler, dataset section", () => {
  it("reproduces every stored label from its bars and catches the shifted control", async () => {
    const dataset = await datasetBody();
    expect(dataset.datasetRows).toBe(ROWS);
    expect(dataset.barRows).toBe(ROWS + EXTRA_BARS);
    expect(dataset.joinedRows).toBe(ROWS);
    const byName = new Map(dataset.alignmentChecks.map((check) => [check.stored, check]));
    expect(dataset.alignmentChecks).toHaveLength(DIRECTION_HORIZONS.length + VOLATILITY_HORIZONS.length + FORWARD_RETURN_HORIZONS.length);
    for (const check of dataset.alignmentChecks) expect(check.mismatches).toBe(0);
    // Compared counts follow the rows that have a bar ahead; a horizon past the dataset compares nothing.
    expect(byName.get("dir_h15")?.compared).toBe(ROWS - 15);
    expect(byName.get("dir_h1")?.compared).toBe(ROWS - 1);
    expect(byName.get("fwd_ret_h240")?.compared).toBe(ROWS - 240);
    expect(byName.get("dir_h1440")?.compared).toBe(0);
    expect(dataset.negativeControl?.compared).toBeGreaterThan(300);
    expect(dataset.negativeControl?.mismatches).toBeGreaterThan(0);
  });

  it("audits the barrier exit as an absolute row number", async () => {
    const dataset = await datasetBody();
    let unresolved = 0;
    for (let i = 0; i < ROWS; i += 1) if (i + 1 + (i % 5) > ROWS - 1) unresolved += 1;
    expect(dataset.exitBarAudit).toEqual({ resolvedRows: ROWS - unresolved, exitNotAfterEntry: 0, minimumBarsToExit: 1, maximumBarsToExit: 5, unresolvedRows: unresolved });
  });

  it("counts every class column and profiles every continuous column exactly", async () => {
    const dataset = await datasetBody();
    for (const column of dataset.classBalance) expect(column.counts.reduce((sum, entry) => sum + entry.count, 0)).toBe(ROWS);
    const swing = dataset.classBalance.find((column) => column.stored === "swing_label");
    expect(swing?.counts.map((entry) => entry.value)).toEqual([-1, 0, 1]);
    const direction = dataset.classBalance.find((column) => column.stored === "dir_h15");
    expect(direction?.counts.find((entry) => entry.value === null)?.count).toBe(15);
    expect(majorityBaseline(direction?.counts ?? []).majorityRate).toBeGreaterThanOrEqual(0.5);

    const continuous = LABEL_COLUMNS.filter((column) => column.kind === "continuous" && column.stored !== "tbl_exit_bar");
    expect(dataset.profiles.map((profile) => profile.stored)).toEqual(continuous.map((column) => column.stored));
    for (const profile of dataset.profiles) {
      expect(profile.bins).toHaveLength(100);
      expect(profile.bins.reduce((a, b) => a + b, 0) + profile.belowRange + profile.aboveRange).toBe(profile.count);
      expect(profile.histogramHigh).toBeGreaterThan(profile.histogramLow);
    }
    // The eight numbers equal the shared client-side estimators on the same values.
    const values = (await run(`SELECT range_pts AS v FROM ${LABELS_VIEW} ORDER BY timestamp`)).map((row) => Number(row.v));
    const expected = eightNumberSummary(values);
    const profile = dataset.profiles.find((entry) => entry.stored === "range_pts")!;
    expect(profile.count).toBe(expected.count);
    for (const [key, actual] of [
      ["mean", profile.mean], ["median", profile.median], ["standardDeviation", profile.standardDeviation], ["skewness", profile.skewness],
      ["kurtosis", profile.kurtosis], ["percentile25", profile.percentile25], ["percentile75", profile.percentile75], ["minimum", profile.minimum], ["maximum", profile.maximum],
    ] as const) {
      expect(actual, key).toBeCloseTo(expected[key] as number, 8);
    }
    // A constant column still gets a drawable range.
    const constant = dataset.profiles.find((entry) => entry.stored === "meta_ret_pts")!;
    expect(constant.standardDeviation).toBe(0);
    expect(constant.histogramHigh).toBeGreaterThan(constant.histogramLow);
    expect(constant.bins.reduce((a, b) => a + b, 0)).toBe(ROWS);
  });

  it("fails loudly on a label that no longer reproduces (the check can fail)", async () => {
    await run(`UPDATE ${LABELS_VIEW} SET dir_h5 = 1 - dir_h5 WHERE isfinite(dir_h5) AND epoch(timestamp) % 7 = 0`);
    const dataset = await datasetBody();
    const flipped = dataset.alignmentChecks.find((check) => check.stored === "dir_h5");
    expect(flipped?.mismatches).toBeGreaterThan(0);
    expect(dataset.alignmentChecks.filter((check) => check.mismatches > 0).map((check) => check.stored)).toEqual(["dir_h5"]);
  });
});

describe("label-overlay shared computation", () => {
  const row = (index: number, overrides: Partial<WindowRow> = {}): WindowRow => ({
    row_number: 1000 + index, timestamp: index * 60_000, open: 100, high: 101, low: 99, close: 100 + index, volume: 10,
    bar_range_points: 2, volatility_regime: 1, next_swing_pivot_direction: 1, triple_barrier_outcome: 1, triple_barrier_exit_row_number: 1000 + index + 2,
    log_bar_range: 0.7, log_bar_range_1_bars_ahead: 0.7, zero_range_bar: 0, next_bar_range_bucket: 10, close_change_points_after_1_bars: 1, direction_up_after_1_bars: 1,
    ...overrides,
  });

  it("turns consecutive equal regimes into runs, skipping unknown ones, as the notebook does", () => {
    expect(regimeRuns([0, 0, 1, 1, null, 2])).toEqual([{ from: 0, to: 2, regime: 0 }, { from: 2, to: 4, regime: 1 }, { from: 5, to: 5, regime: 2 }]);
    expect(regimeRuns([])).toEqual([]);
    expect(regimeRuns([null, null])).toEqual([]);
  });

  it("puts each barrier exit at its ABSOLUTE row minus the window's first row", () => {
    const rows = Array.from({ length: 40 }, (_, index) => row(index));
    const boxes = barrierBoxes(rows, 12);
    expect(boxes.map((box) => box.index)).toEqual([0, 12, 24]);
    for (const box of boxes) {
      expect(box.exitResolved).toBe(true);
      expect(box.exitIndex).toBe(box.index + 2);
      expect(box.rightIndex).toBe(box.index + 5);
    }
    // The notebook's rule (subtract 0, clamp to the last bar) would put every exit on the last bar.
    const notebookExit = (box: { index: number }) => Math.min((rows[box.index]?.triple_barrier_exit_row_number as number) - 0, rows.length - 1);
    expect(boxes.every((box) => notebookExit(box) === rows.length - 1)).toBe(true);
    expect(boxes.every((box) => notebookExit(box) !== box.exitIndex)).toBe(true);
  });

  it("falls back to the right edge when the exit is unresolved, and skips unlabelled bars", () => {
    const rows = Array.from({ length: 20 }, (_, index) => row(index, index === 0 ? { triple_barrier_exit_row_number: -1 } : index === 6 ? { triple_barrier_outcome: null } : {}));
    const boxes = barrierBoxes(rows, 3);
    expect(boxes[0]).toMatchObject({ index: 0, exitResolved: false, exitIndex: 5 });
    expect(boxes.some((box) => box.index === 6)).toBe(false);
    expect(barrierBoxes(rows, 0)).toEqual([]);
    expect(barrierBoxes([], 12)).toEqual([]);
  });

  it("sizes a box by 1.5 times the trailing 14-bar mean range", () => {
    const rows = Array.from({ length: 30 }, (_, index) => row(index, { bar_range_points: index + 1 }));
    const box = barrierBoxes(rows, 20)[0]!;
    expect(box.upper - box.entry).toBeCloseTo(1.5 * 1, 10); // bar 0 has only itself: mean 1
    expect(trailingMeanMinOne([1, 2, 3, 4], 2)).toEqual([1, 1.5, 2.5, 3.5]);
    expect(trailingMeanMinOne([null, 2, null, 4], 2)).toEqual([null, 2, 2, 4]);
  });

  it("shares classes over all bars, travels highest high minus lowest low, and rebins a histogram", () => {
    expect(classShares([1, 1, -1, 0, null])).toEqual({ positive: 0.4, negative: 0.2, zero: 0.2 });
    expect(classShares([])).toEqual({ positive: 0, negative: 0, zero: 0 });
    expect(pointsTravelled([row(0, { high: 110, low: 90 }), row(1, { high: 105, low: 80 })])).toBe(30);
    expect(rebin([1, 2, 3, 4, 5, 6, 7, 8], 4)).toEqual([3, 7, 11, 15]);
    expect(rebin([1, 2, 3], 2)).toEqual([1, 2, 3]);
  });

  it("steps the direction mismatch sum with a running total, and sees a flipped label", () => {
    const rows = Array.from({ length: 10 }, (_, index) => row(index, { direction_up_after_5_bars: 1 })); // closes rise: recomputed is 1
    const clean = directionMismatchTerms(rows, 5);
    expect(clean).toHaveLength(10);
    expect(clean[4]).toMatchObject({ recomputed: 1, mismatch: 0, runningMismatches: 0, runningCompared: 5 });
    expect(clean[5]).toMatchObject({ recomputed: null, mismatch: null });
    const flipped = rows.map((entry, index) => (index === 2 ? { ...entry, direction_up_after_5_bars: 0 } : entry));
    const terms = directionMismatchTerms(flipped, 5);
    expect(terms[2]?.mismatch).toBe(1);
    expect(terms[9]?.runningMismatches).toBe(1);
  });
});

describe("label-overlay page", () => {
  afterEach(() => cleanup());

  async function renderPage() {
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    // jsdom has no PointerEvent; a MouseEvent carries the coordinates the chart reads.
    vi.stubGlobal("PointerEvent", class extends MouseEvent {});
    const box = { width: 900, height: 420, left: 0, top: 0, right: 900, bottom: 420, x: 0, y: 0, toJSON: () => ({}) };
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue(box as DOMRect);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const bars = 240;
    const windowKey = (window: string) => ["study", "label-overlay", { section: "window", window, bars }];
    const busiest = await windowFor({ window: "busiest", bars });
    const median = await windowFor({ window: "median", bars });
    const dataset = await datasetBody();
    client.setQueryData(windowKey("busiest"), { slug: "label-overlay", notes: [], data: { section: "window", window: busiest } });
    client.setQueryData(windowKey("median"), { slug: "label-overlay", notes: [], data: { section: "window", window: median } });
    client.setQueryData(["study", "label-overlay", { section: "dataset" }], { slug: "label-overlay", notes: [], data: { section: "dataset", dataset } });
    return { ...render(createElement(QueryClientProvider, { client }, createElement(Page))), busiest, dataset };
  }

  it("draws the master chart, the strip, the three target panels, the alignment table and every column", async () => {
    const { container, dataset } = await renderPage();
    const charts = container.querySelectorAll('svg[role="img"]');
    expect(charts.length).toBe(5);
    const master = charts[0] as SVGSVGElement;
    // 240 candles: a wick line and a body rect each (plus the grid lines).
    expect(master.querySelectorAll("rect").length).toBeGreaterThan(240);
    expect(master.querySelectorAll("path").length).toBeGreaterThan(0);
    const text = container.textContent ?? "";
    expect(text).toContain("The master chart");
    expect(text).toContain("1 of 15 checks disagree"); // dir_h5 was flipped by the previous test
    expect(text).toContain("PASS: the check can fail");
    expect(text).toContain("direction_up_after_15_bars");
    // Every continuous column and every class column has its own panel.
    const titles = Array.from(container.querySelectorAll("[title]")).map((element) => element.getAttribute("title") ?? "");
    for (const profile of dataset.profiles) expect(titles.some((title) => title.startsWith(profile.name))).toBe(true);
    for (const column of dataset.classBalance) expect(titles.some((title) => title.startsWith(column.name))).toBe(true);
  });

  it("reads the exact values of the bar under the pointer", async () => {
    const { container } = await renderPage();
    expect(container.textContent).toContain("Hover a bar to read its exact values");
    const master = container.querySelectorAll('svg[role="img"]')[0] as SVGSVGElement;
    fireEvent.pointerMove(master, { clientX: 300, clientY: 100 });
    expect(container.textContent).toMatch(/bar \d+ \(row [\d,]+\)/);
    expect(container.textContent).toContain("close");
  });

  it("switches the layers off", async () => {
    const { container } = await renderPage();
    const master = () => container.querySelectorAll('svg[role="img"]')[0] as SVGSVGElement;
    const withAll = master().querySelectorAll("path").length;
    const switches = Array.from(container.querySelectorAll('button[role="switch"]'));
    const swing = switches.find((element) => element.closest("label")?.textContent?.includes("Swing pivots"));
    expect(swing).toBeTruthy();
    fireEvent.click(swing as Element);
    expect(master().querySelectorAll("path").length).toBeLessThan(withAll);
  });
});
