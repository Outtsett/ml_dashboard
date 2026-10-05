/**
 * The direction-labels-on-candles study: the handler on a fake lake (every part,
 * the preset resolution, the window bounds, a missing view) and the pure
 * geometry the page shares (anchor bars, arrows, marker lanes, the session picks).
 */

import { describe, expect, it } from "vitest";
import handler, {
  dayRankingSql, horizonHistogramSql, horizonStatsSql, proofSql, windowSql,
} from "../../studies/handlers/direction-labels-on-candles";
import type { StudyContext, StudyLake } from "../../studies/types";
import {
  DIRECTION_HORIZONS, addDays, anchorIndices, buildArrows, emptyBars, isCalendarDate, laneLevel, modalSpacingSeconds,
  parseHorizons, pickDays, runningUp, upRate, type DayRow, type OverviewBody, type ProofBody, type WindowBody,
} from "@shared/studies/direction-labels-on-candles";

const DAYS: DayRow[] = [
  { day: "2025-04-07", summedRangePoints: 52861, barCount: 1380 },
  { day: "2025-04-09", summedRangePoints: 47934.75, barCount: 1380 },
  { day: "2025-04-10", summedRangePoints: 42084.25, barCount: 1380 },
  { day: "2024-07-04", summedRangePoints: 2209, barCount: 1140 },
  { day: "2024-01-01", summedRangePoints: 930.75, barCount: 540 },
  { day: "2024-03-05", summedRangePoints: 8000, barCount: 1380 },
  { day: "2024-03-06", summedRangePoints: 9000, barCount: 1380 },
];

/** Three bars a minute apart; horizon-1 labels follow the closes, the rest are fixed. */
const WINDOW_ROWS = [
  { timestamp_seconds: 1_000_000, open: 10, high: 12, low: 9, close: 11, volume: 5, delta: 1 },
  { timestamp_seconds: 1_000_060, open: 11, high: 13, low: 10, close: 12, volume: null, delta: 1 },
  { timestamp_seconds: 1_000_120, open: 12, high: 12, low: 8, close: 9, volume: 7, delta: null },
].map((row, index) => {
  const labels: Record<string, number | null> = {};
  for (const horizon of DIRECTION_HORIZONS) labels[`label_${horizon}`] = horizon === 1 ? (index === 0 ? 1 : index === 1 ? 0 : null) : 1;
  return { ...labels, ...row, forward_change_points_horizon_15: row.delta };
});

const seen: string[] = [];

function fakeLake(present = true): StudyLake {
  return {
    async query<T>(sql: string): Promise<T[]> {
      seen.push(sql);
      if (sql.includes("time_bucket")) {
        return DAYS.map((d) => ({ day: d.day, summed_range_points: d.summedRangePoints, bar_count: d.barCount })) as T[];
      }
      if (sql.includes("lead(o.close")) {
        const row: Record<string, number | null> = { joined_rows: 100 };
        for (const horizon of DIRECTION_HORIZONS) {
          Object.assign(row, {
            [`compared_${horizon}`]: 100 - horizon, [`mismatches_${horizon}`]: 0, [`delta_compared_${horizon}`]: 100 - horizon,
            [`delta_error_${horizon}`]: 0, [`control_compared_${horizon}`]: 99 - horizon, [`control_mismatches_${horizon}`]: 40,
          });
        }
        return [row] as T[];
      }
      if (sql.includes("ORDER BY o.timestamp")) return WINDOW_ROWS as T[];
      if (sql.includes("quantile_cont(move, 0.5)")) {
        return [{
          labeled_rows: 99, up_rate: 0.5, move_count: 99, move_mean: 0.1, move_median: 0.25, move_standard_deviation: 20, move_skewness: -0.1,
          move_kurtosis: 70, move_percentile_25: -6, move_percentile_75: 7, move_minimum: -900, move_maximum: 1100, clip_low: -60, clip_high: 60,
          median_absolute_move: 7,
        }] as T[];
      }
      if (sql.includes("floor((")) return [{ bin: 0, count: 10 }, { bin: 39, count: 5 }] as T[];
      if (sql.includes("min(o.timestamp)")) return [{ joined_rows: 90, first_day: "2019-05-05", last_day: "2025-12-24" }] as T[];
      if (sql.includes("count(*) AS n")) return [{ n: sql.includes("mnq_ohlcv_1m") ? 100 : 95 }] as T[];
      throw new Error(`unexpected SQL: ${sql.slice(0, 80)}`);
    },
    async hasView() {
      return present;
    },
    async columns() {
      return [];
    },
  };
}

async function run<T>(query: Record<string, unknown>, lake: StudyLake = fakeLake()): Promise<{ body: T; context: StudyContext }> {
  const context: StudyContext = { lake, notes: [] };
  const parsed = handler.query.parse(query);
  return { body: (await handler.run(parsed, context)) as T, context };
}

describe("direction-labels-on-candles handler", () => {
  it("lists both lake views it reads", () => {
    expect(handler.slug).toBe("direction-labels-on-candles");
    expect(handler.datasets).toEqual(["mnq_ohlcv_1m", "mnq_labels_1m"]);
  });

  it("refuses a bar count outside 240 to 6000 and a date that is not a calendar day", () => {
    expect(handler.query.safeParse({ bars: 100 }).success).toBe(false);
    expect(handler.query.safeParse({ bars: 6001 }).success).toBe(false);
    expect(handler.query.safeParse({ preset: "date", date: "2025-02-30" }).success).toBe(false);
    expect(handler.query.safeParse({ preset: "date", date: "2025-04-07'; DROP" }).success).toBe(false);
    expect(handler.query.parse({}).bars).toBe(2600);
  });

  it("overview: table sizes, the dropped bars, one summary per horizon and the ranked sessions", async () => {
    const { body, context } = await run<OverviewBody>({ part: "overview" });
    expect(body.ohlcvRows).toBe(100);
    expect(body.labelRows).toBe(95);
    expect(body.joinedRows).toBe(90);
    expect(body.droppedBars).toBe(10);
    expect(body.firstDay).toBe("2019-05-05");
    expect(body.horizons.map((h) => h.horizon)).toEqual([...DIRECTION_HORIZONS]);
    const first = body.horizons[0];
    expect(first?.upRate).toBe(0.5);
    expect(first?.move.kurtosis).toBe(70);
    expect(first?.medianAbsoluteMovePoints).toBe(7);
    expect(first?.histogram).toHaveLength(40);
    expect(first?.histogram[0]?.count).toBe(10);
    expect(first?.histogram[39]?.count).toBe(5);
    expect(body.busiest.map((d) => d.day)).toEqual(["2025-04-07", "2025-04-09", "2025-04-10"]);
    expect(body.calmest?.day).toBe("2024-07-04");
    expect(body.median?.day).toBe("2025-04-10");
    expect(body.roundTripCostUsd).toBeGreaterThan(0);
    expect(context.notes.join(" ")).toContain("Pacific wall clock");
  });

  it("window: the busiest preset starts at the top-ranked session and returns columnar bars with labels", async () => {
    const { body } = await run<WindowBody>({ part: "window", bars: 2600 });
    expect(body.day).toBe("2025-04-07");
    expect(body.dayRow?.summedRangePoints).toBe(52861);
    expect(body.barCount).toBe(3);
    expect(body.bars.close).toEqual([11, 12, 9]);
    expect(body.bars.volume).toEqual([5, null, 7]);
    expect(body.bars.directionLabels["1"]).toEqual([1, 0, null]);
    expect(body.bars.directionLabels["60"]).toEqual([1, 1, 1]);
    expect(body.bars.forwardChangePointsHorizon15).toEqual([1, 1, null]);
    expect(body.modalSpacingSeconds).toBe(60);
    const horizonOne = body.upRates.find((r) => r.horizon === 1);
    expect(horizonOne).toEqual({ horizon: 1, labeledBars: 2, upRate: 0.5 });
  });

  it("window: the calmest and median presets pick among sessions with enough bars; a date is used as given", async () => {
    expect((await run<WindowBody>({ part: "window", preset: "calmest" })).body.day).toBe("2024-07-04");
    expect((await run<WindowBody>({ part: "window", preset: "median" })).body.day).toBe("2025-04-10");
    const dated = await run<WindowBody>({ part: "window", preset: "date", date: "2024-07-04" });
    expect(dated.body.day).toBe("2024-07-04");
    expect(dated.body.dayRow?.barCount).toBe(1140);
  });

  it("window: a date preset with no date answers empty with a note, not an error", async () => {
    const { body, context } = await run<WindowBody>({ part: "window", preset: "date" });
    expect(body.barCount).toBe(0);
    expect(context.notes[0]).toContain("Pick a date");
  });

  it("window SQL is bounded by the start, the end and the bar limit, all from validated values", () => {
    const sql = windowSql("2025-04-07", "2025-04-11", 2600);
    expect(sql).toContain("TIMESTAMPTZ '2025-04-07 00:00:00+00'");
    expect(sql).toContain("TIMESTAMPTZ '2025-04-11 00:00:00+00'");
    expect(sql).toContain("ORDER BY o.timestamp LIMIT 2600");
    expect(sql).toContain('l."dir_h1440" AS "label_1440"');
    expect(dayRankingSql()).toContain("TIMESTAMP '2024-01-01'");
    expect(horizonStatsSql(60)).toContain('"dir_delta_pts_h60"');
    expect(horizonHistogramSql(60, -10, 10)).toContain("floor((");
    expect(() => windowSql("2025-04-07'", "2025-04-11", 10)).not.toThrow(); // quoted by text(), so a quote is doubled, never executed
    expect(windowSql("2025-04-07'", "2025-04-11", 10)).toContain("2025-04-07'' 00:00:00+00");
  });

  it("proof: every horizon reports compared, mismatches, delta error and the negative control", async () => {
    const { body } = await run<ProofBody>({ part: "proof" });
    expect(body.joinedRows).toBe(100);
    expect(body.horizons).toHaveLength(7);
    const fifteen = body.horizons.find((h) => h.horizon === 15);
    expect(fifteen).toMatchObject({ compared: 85, mismatches: 0, deltaMaxAbsoluteErrorPoints: 0, negativeControlMismatches: 40 });
    expect(proofSql()).toContain("lead(o.close, 1440) OVER w");
    expect(proofSql()).toContain('lag(l."dir_h15", 1) OVER w');
  });

  it("a missing view degrades to an empty body and a note for every part", async () => {
    for (const part of ["overview", "window", "proof"] as const) {
      const { body, context } = await run<Record<string, unknown>>({ part }, fakeLake(false));
      expect(context.notes[0]).toContain("Not in the lake yet");
      expect(body).toBeTruthy();
    }
    const { body } = await run<WindowBody>({ part: "window" }, fakeLake(false));
    expect(body.barCount).toBe(0);
  });
});

describe("direction-labels-on-candles geometry", () => {
  it("modal spacing is the most common gap and the smallest wins a tie", () => {
    expect(modalSpacingSeconds([0, 60, 120, 180, 600])).toBe(60);
    expect(modalSpacingSeconds([0, 60, 180])).toBe(60);
    expect(modalSpacingSeconds([5])).toBeNull();
  });

  it("anchors reproduce numpy.linspace(0, usable - 1, count).astype(int)", () => {
    // 2600 bars, horizon 1440: usable = 1159, stop = 1158, five anchors.
    expect(anchorIndices(2600, 1440, 5)).toEqual([0, 289, 579, 868, 1158]);
    expect(anchorIndices(2600, 1440, 1)).toEqual([0]);
    // A window too short for the horizon folds every anchor onto bar 0 and they are de-duplicated.
    expect(anchorIndices(100, 1440, 4)).toEqual([0]);
  });

  it("an arrow runs close[t] to close[t+H], is skipped past the window, and carries the label's agreement", () => {
    const bars = emptyBars();
    bars.close = [10, 11, 9, 12, 8, 13];
    bars.directionLabels = { "2": [0, 1, 0, 1, null, null], "9": [1, 1, 1, 1, 1, 1] };
    const arrows = buildArrows(bars, [2, 9], [0, 1]);
    expect(arrows.map((a) => [a.anchorIndex, a.horizon, a.targetIndex])).toEqual([[0, 2, 2], [1, 2, 3]]);
    expect(arrows[0]).toMatchObject({ fromClose: 10, toClose: 9, changePoints: -1, realisedUp: false, label: 0, labelAgrees: true });
    expect(arrows[1]).toMatchObject({ realisedUp: true, label: 1, labelAgrees: true });
    bars.directionLabels["2"] = [1, 1, 0, 1, null, null];
    expect(buildArrows(bars, [2], [0])[0]?.labelAgrees).toBe(false);
  });

  it("lanes stack below the lowest low, one step of 3.5% of the span each", () => {
    expect(laneLevel(100, 200, 0)).toBeCloseTo(95, 10);
    expect(laneLevel(100, 200, 1)).toBeCloseTo(91.5, 10);
    expect(laneLevel(100, 200, 2)).toBeCloseTo(88, 10);
  });

  it("the up-rate skips unlabeled bars and the running sum steps one bar at a time", () => {
    expect(upRate([1, 0, null, 1])).toEqual({ labeled: 3, upRate: 2 / 3 });
    expect(upRate([null, null])).toEqual({ labeled: 0, upRate: null });
    expect(runningUp([1, 0, null, 1], 2)).toEqual({ sum: 1, labeled: 2 });
    expect(runningUp([1, 0, null, 1], 4)).toEqual({ sum: 2, labeled: 3 });
    expect(runningUp([1, 0], 99)).toEqual({ sum: 1, labeled: 2 });
  });

  it("horizons parse to the stored ones, ascending, and ignore anything else", () => {
    expect(parseHorizons("1440, 60,7,abc,240,60")).toEqual([60, 240, 1440]);
    expect(parseHorizons("")).toEqual([]);
  });

  it("session picks: the three busiest, and calm and median only among full-ish sessions", () => {
    const picked = pickDays(DAYS);
    expect(picked.busiest.map((d) => d.day)).toEqual(["2025-04-07", "2025-04-09", "2025-04-10"]);
    expect(picked.eligibleDayCount).toBe(6);
    expect(picked.calmest?.day).toBe("2024-07-04");
    expect(picked.median?.day).toBe("2025-04-10");
    expect(pickDays([]).calmest).toBeNull();
  });

  it("date helpers", () => {
    expect(addDays("2025-04-07", 4)).toBe("2025-04-11");
    expect(addDays("2025-12-30", 3)).toBe("2026-01-02");
    expect(isCalendarDate("2024-02-29")).toBe(true);
    expect(isCalendarDate("2025-02-29")).toBe(false);
    expect(isCalendarDate("20250407")).toBe(false);
  });
});
