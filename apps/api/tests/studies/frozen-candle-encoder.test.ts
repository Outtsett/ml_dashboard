/**
 * The frozen-candle-encoder study: the handler against a fake StudyLake (probe
 * rows split by feature_block, window SQL built from an allowlisted pattern and
 * integers only, degradation to notes) and the pure compute it shares with the
 * page.
 */

import { describe, expect, it } from "vitest";
import handler from "../../studies/handlers/frozen-candle-encoder";
import type { StudyContext, StudyLake } from "../../studies/types";
import {
  COORDINATE_BLOCK,
  coordinateSummary,
  horizonVerdicts,
  splitProbeRows,
  windowWidthShares,
  winnersAtHorizon,
  type ProbeRow,
} from "@shared/studies/frozen-candle-encoder";

function probeRow(partial: Partial<ProbeRow> & { feature_block: string }): ProbeRow {
  return {
    forward_candle_count: 1,
    feature_count: 256,
    train_row_count: 40762,
    test_row_count: 40106,
    test_up_rate: 0.5,
    area_under_curve_test: 0.5,
    permutation_null_95th_percentile: 0.505,
    permutation_null_median: 0.5,
    beats_permutation_null: false,
    area_above_null_95th: null,
    recipe: "frozen_candle_encoder_probe_v1",
    ...partial,
  };
}

const PROBE_ROWS: ProbeRow[] = [
  probeRow({ feature_block: "embedding_256", forward_candle_count: 1, area_under_curve_test: 0.4977 }),
  probeRow({ feature_block: "embedding_shuffled", forward_candle_count: 1, area_under_curve_test: 0.4967 }),
  probeRow({ feature_block: "embedding_256", forward_candle_count: 2, area_under_curve_test: 0.499 }),
  probeRow({ feature_block: "embedding_shuffled", forward_candle_count: 2, area_under_curve_test: 0.5057, beats_permutation_null: true }),
  ...[0.3, 0.1, 0.2].map((r2, index) =>
    probeRow({ feature_block: COORDINATE_BLOCK, forward_candle_count: 0, feature_count: index, area_under_curve_test: r2, permutation_null_95th_percentile: null, test_row_count: 40260 }),
  ),
];

function makeLake(views: string[]): { lake: StudyLake; queries: string[] } {
  const queries: string[] = [];
  const lake: StudyLake = {
    async query<T>(sql: string): Promise<T[]> {
      queries.push(sql);
      if (sql.includes("derived_mnq_frozen_encoder_probe")) return PROBE_ROWS as unknown as T[];
      if (sql.includes("count(*) AS firing_count")) return [{ firing_count: 1592 }] as unknown as T[];
      if (sql.includes("anchor_timestamp_milliseconds")) return [{ anchor_timestamp_milliseconds: 1735784100000, signal: 100 }] as unknown as T[];
      if (sql.includes("window_bars")) {
        return [
          { timestamp_milliseconds: 1735783800000, open: 21297.5, high: 21304.75, low: 21292.25, close: 21295.5, volume: 1281 },
          { timestamp_milliseconds: 1735784100000, open: 21295, high: 21301.25, low: 21288, close: 21300.5, volume: 1477 },
        ] as unknown as T[];
      }
      return [];
    },
    async hasView(name) {
      return views.includes(name);
    },
    async columns() {
      return [];
    },
  };
  return { lake, queries };
}

function contextFor(lake: StudyLake): StudyContext {
  return { lake, notes: [] };
}

const BOTH = ["derived_mnq_frozen_encoder_probe", "derived_mnq_next_candles_5m"];

describe("frozen-candle-encoder handler", () => {
  it("splits the overloaded probe table by feature_block", async () => {
    const { lake } = makeLake(BOTH);
    const body = await handler.run(handler.query.parse({}), contextFor(lake));
    expect(body.recipe).toBe("frozen_candle_encoder_probe_v1");
    expect(body.direction.every((row) => row.feature_block !== COORDINATE_BLOCK)).toBe(true);
    expect(body.direction).toHaveLength(4);
    expect(body.coordinates.map((row) => row.embedding_coordinate)).toEqual([0, 1, 2]);
    expect(body.coordinates.map((row) => row.share_explained_by_the_61_labels)).toEqual([0.3, 0.1, 0.2]);
    expect(body.coordinates[0]?.test_row_count).toBe(40260);
  });

  it("finds the anchor inside SQL by firing number and never interpolates a timestamp", async () => {
    const { lake, queries } = makeLake(BOTH);
    const query = handler.query.parse({ pattern: "engulfing", index: "3", context: "12" });
    const body = await handler.run(query, contextFor(lake));
    expect(body.window?.pattern).toBe("engulfing");
    expect(body.window?.firing_index).toBe(3);
    expect(body.window?.firing_count).toBe(1592);
    expect(body.window?.signal).toBe(100);
    expect(body.window?.bars).toHaveLength(2);
    const windowSql = queries.find((sql) => sql.includes("window_bars")) ?? "";
    expect(windowSql).toContain('"candlestick_engulfing"');
    expect(windowSql).toContain("LIMIT 12");
    expect(windowSql).toContain("firing_number = 4");
    expect(windowSql).not.toMatch(/TIMESTAMPTZ\s+'/i);
    expect(windowSql).not.toContain("1735784100000");
  });

  it("refuses a pattern outside the allowlist and out-of-range integers", () => {
    expect(handler.query.safeParse({ pattern: 'hammer"; DROP TABLE x; --' }).success).toBe(false);
    expect(handler.query.safeParse({ pattern: "constructor" }).success).toBe(false);
    expect(handler.query.safeParse({ index: "30" }).success).toBe(false);
    expect(handler.query.safeParse({ context: "4" }).success).toBe(false);
    expect(handler.query.safeParse({ context: "49" }).success).toBe(false);
    expect(handler.query.parse({})).toEqual({ pattern: "hammer", index: 0, context: 5 });
  });

  it("clamps a firing index past the firings that exist", async () => {
    const queries: string[] = [];
    const lake: StudyLake = {
      async query<T>(sql: string): Promise<T[]> {
        queries.push(sql);
        if (sql.includes("count(*) AS firing_count")) return [{ firing_count: 4 }] as unknown as T[];
        if (sql.includes("anchor_timestamp_milliseconds")) return [{ anchor_timestamp_milliseconds: 1, signal: -100 }] as unknown as T[];
        return [];
      },
      async hasView(name) {
        return name === "derived_mnq_next_candles_5m";
      },
      async columns() {
        return [];
      },
    };
    const body = await handler.run(handler.query.parse({ index: "25" }), contextFor(lake));
    expect(body.window?.firing_index).toBe(3);
    expect(queries.find((sql) => sql.includes("window_bars"))).toContain("firing_number = 4");
  });

  it("returns empty data with notes when nothing is landed", async () => {
    const { lake, queries } = makeLake([]);
    const context = contextFor(lake);
    const body = await handler.run(handler.query.parse({}), context);
    expect(body).toEqual({ recipe: null, direction: [], coordinates: [], window: null });
    expect(queries).toHaveLength(0);
    expect(context.notes.join(" ")).toContain("derived_mnq_frozen_encoder_probe");
    expect(context.notes.join(" ")).toContain("derived_mnq_next_candles_5m");
  });

  it("notes a pattern that never fires in the holdout", async () => {
    const lake: StudyLake = {
      async query<T>(sql: string): Promise<T[]> {
        return (sql.includes("count(*) AS firing_count") ? [{ firing_count: 0 }] : []) as unknown as T[];
      },
      async hasView(name) {
        return name === "derived_mnq_next_candles_5m";
      },
      async columns() {
        return [];
      },
    };
    const context = contextFor(lake);
    const body = await handler.run(handler.query.parse({ pattern: "morningstar" }), context);
    expect(body.window).toBeNull();
    expect(context.notes.join(" ")).toContain("morningstar never fires");
  });
});

describe("frozen-candle-encoder compute", () => {
  it("skips coordinate rows without an R-squared and sorts the rest", () => {
    const split = splitProbeRows([
      probeRow({ feature_block: COORDINATE_BLOCK, feature_count: 5, area_under_curve_test: 0.5 }),
      probeRow({ feature_block: COORDINATE_BLOCK, feature_count: 1, area_under_curve_test: null }),
      probeRow({ feature_block: COORDINATE_BLOCK, feature_count: 2, area_under_curve_test: 0.25 }),
    ]);
    expect(split.direction).toHaveLength(0);
    expect(split.coordinates.map((row) => row.embedding_coordinate)).toEqual([2, 5]);
  });

  it("summarises coordinates: mean, median, extremes", () => {
    const summary = coordinateSummary([0.1, 0.2, 0.3, 0.6]);
    expect(summary.count).toBe(4);
    expect(summary.mean).toBeCloseTo(0.3, 12);
    expect(summary.median).toBeCloseTo(0.25, 12);
    expect(summary.minimum).toBe(0.1);
    expect(summary.maximum).toBe(0.6);
    expect(coordinateSummary([])).toEqual({ count: 0, mean: null, median: null, minimum: null, maximum: null });
  });

  it("computes the encoder's advantage over the shuffled control at each horizon", () => {
    const verdicts = horizonVerdicts(splitProbeRows(PROBE_ROWS).direction);
    expect(verdicts.map((entry) => entry.forward_candle_count)).toEqual([1, 2]);
    expect(verdicts[0]?.advantage).toBeCloseTo(0.4977 - 0.4967, 12);
    expect(verdicts[1]?.advantage).toBeCloseTo(0.499 - 0.5057, 12);
    expect(verdicts.every((entry) => entry.encoderBeatsNull === false)).toBe(true);
    expect(verdicts[1]?.controlBeatsNull).toBe(true);
  });

  it("lists the blocks that clear their null in drawing order", () => {
    const direction = splitProbeRows(PROBE_ROWS).direction;
    expect(winnersAtHorizon(direction, 1)).toEqual([]);
    expect(winnersAtHorizon(direction, 2)).toEqual(["embedding_shuffled"]);
  });

  it("turns the recorded window counts into shares that sum to one", () => {
    const shares = windowWidthShares([
      { candles: 1, windows: 37264 },
      { candles: 2, windows: 20717 },
      { candles: 3, windows: 21050 },
      { candles: 4, windows: 6266 },
      { candles: 5, windows: 5769 },
    ]);
    expect(shares.reduce((sum, entry) => sum + entry.windows, 0)).toBe(91066);
    expect(shares[0]?.share).toBeCloseTo(37264 / 91066, 12);
    expect(shares.reduce((sum, entry) => sum + entry.share, 0)).toBeCloseTo(1, 12);
  });
});
