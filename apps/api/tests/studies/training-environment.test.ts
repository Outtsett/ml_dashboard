/**
 * The Training environment study (apps/api/studies/handlers/training-environment.ts
 * and packages/shared/src/studies/training-environment.ts).
 *
 * The handler runs against a fake lake that answers by the view a query names.
 * The reference numbers for the moments are numpy's, computed with the
 * notebook's own code (np.nanstd(ddof=1), z = (x - mean) / sd, skewness =
 * nanmean(z**3), excess kurtosis = nanmean(z**4) - 3, np.nanpercentile) on the
 * deterministic series in `series()`.
 */

import { describe, expect, it } from "vitest";
import handler, { QuerySchema, blockStatisticsSql } from "../../studies/handlers/training-environment";
import type { StudyContext, StudyLake } from "../../studies/types";
import {
  COLLAPSED_BELOW, layerHealth, nearestEpoch, resolvedLabels, skillOverMajority, standardisedMoments,
  varianceExplainedByTwo, windowedFeatureMatrix, type LayerReadingRow, type TrainingEnvironmentBody,
} from "@shared/studies/training-environment";

/** 200 values with a spike every 17th: sin(i/3) + (i % 5) * 0.1 (+ 3 on the spikes). */
function series(): number[] {
  return Array.from({ length: 200 }, (_, i) => Math.sin(i / 3) + (i % 5) * 0.1 + (i % 17 === 0 ? 3 : 0));
}

describe("standardisedMoments", () => {
  it("matches numpy: sample standard deviation, mean of z^3, mean of z^4 minus 3", () => {
    const moments = standardisedMoments(series());
    expect(moments?.count).toBe(200);
    expect(moments?.mean).toBeCloseTo(0.4078892442456561, 12);
    expect(moments?.standardDeviation).toBeCloseTo(0.9987909668403736, 12);
    expect(moments?.skewness).toBeCloseTo(1.182306116653636, 12);
    expect(moments?.excessKurtosis).toBeCloseTo(2.26818011736194, 12);
  });

  it("follows the definition by hand (n = 4)", () => {
    // x = 1, 2, 3, 10: mean 4, s = sqrt(14) ; z^3 mean = 0.8 * ... computed here by hand from the same definition
    const values = [1, 2, 3, 10];
    const moments = standardisedMoments(values)!;
    const s = Math.sqrt(values.reduce((sum, v) => sum + (v - 4) ** 2, 0) / 3);
    const expected = values.reduce((sum, v) => sum + ((v - 4) / s) ** 3, 0) / 4;
    expect(moments.skewness).toBeCloseTo(expected, 12);
  });

  it("skips non-finite values, and a constant column has no z-score", () => {
    expect(standardisedMoments([1, null, 2, Number.NaN, 3])?.count).toBe(3);
    const constant = standardisedMoments([5, 5, 5, 5])!;
    expect(constant.skewness).toBeNull();
    expect(constant.excessKurtosis).toBeNull();
    expect(standardisedMoments([])).toBeNull();
    expect(standardisedMoments([7])?.standardDeviation).toBeNull();
  });
});

describe("the small computations", () => {
  it("picks the nearest epoch, the first of equals", () => {
    expect(nearestEpoch([1, 2, 3, 4], 2.4)).toBe(2);
    expect(nearestEpoch([2, 4], 3)).toBe(2);
    expect(nearestEpoch([1, 5], 99)).toBe(5);
    expect(nearestEpoch([], 3)).toBeNull();
  });

  it("scores skill as accuracy over the majority class and counts resolved labels", () => {
    // multimodal_MNQ_1h: best accuracy 0.5265497076023392 against a majority of 0.5155555605888367.
    expect(skillOverMajority(0.5265497076023392, 0.5155555605888367)).toBeCloseTo(0.010994147013502542, 12);
    expect(resolvedLabels({ up_label_count: 7302, down_label_count: 6976 })).toBe(14278);
  });

  it("explains variance from singular values: (s1^2 + s2^2) / sum of s^2", () => {
    expect(varianceExplainedByTwo([3, 2, 1])).toBeCloseTo(13 / 14, 12);
    expect(varianceExplainedByTwo([1])).toBeNull();
    expect(varianceExplainedByTwo([0, 0])).toBeNull();
  });

  it("calls a layer starved when it has parameters and no gradient, collapsed below 1e-4", () => {
    const row = (name: string, parameters: number, gradient: number, deviation: number): LayerReadingRow => ({
      epoch: 1, layer_order: 0, layer_name: name, module_type: "Linear", output_shape: "[1]", parameter_count: parameters,
      mean: 0, standard_deviation: deviation, minimum: 0, maximum: 0, zero_fraction: 0, saturated_fraction: 0, gradient_norm: gradient,
    });
    const health = layerHealth([row("a", 10, 0, 1), row("b", 0, 0, 1), row("c", 5, 0.3, 5e-5), row("d", 5, 0.3, COLLAPSED_BELOW)]);
    expect(health.starved.map((layer) => layer.layer_name)).toEqual(["a"]);
    expect(health.collapsed.map((layer) => layer.layer_name)).toEqual(["c"]);
  });

  it("windows a bar-major matrix into feature rows, averaging bars into at most the column budget", () => {
    const values = Array.from({ length: 10 }, (_, bar) => [bar, bar * 10]);
    const whole = windowedFeatureMatrix(values, 2, 0, 9, 100);
    expect(whole.matrix[0]).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(whole.matrix[1]?.[9]).toBe(90);
    const binned = windowedFeatureMatrix(values, 2, 0, 9, 5);
    expect(binned.matrix[0]).toEqual([0.5, 2.5, 4.5, 6.5, 8.5]);
    expect(binned.spans[0]).toEqual([0, 1]);
    expect(binned.spans[4]).toEqual([8, 9]);
    const tail = windowedFeatureMatrix(values, 2, 7, 99, 100);
    expect(tail.matrix[0]).toEqual([7, 8, 9]);
  });
});

describe("the statistics SQL", () => {
  it("uses the sample standard deviation and explicit z powers, not DuckDB's bias-adjusted skewness()", () => {
    const sql = blockStatisticsSql("run_a", "snapshot_1", "geometry");
    expect(sql).toContain("stddev_samp(value)");
    expect(sql).toContain("pow((base.value - moments.mean) / NULLIF(moments.deviation, 0), 3)");
    expect(sql).toContain("- 3 AS excess_kurtosis");
    expect(sql).not.toMatch(/\bskewness\(|\bkurtosis\(/);
    expect(sql).toContain("quantile_cont(base.value, 0.25)");
    expect(sql).toContain("recipe = 'snapshot_1'");
  });

  it("quotes a run name instead of interpolating it", () => {
    expect(blockStatisticsSql("o'hara", "r", "b")).toContain("run_name = 'o''hara'");
  });
});

describe("the query", () => {
  it("defaults to the overview and refuses a run name that could leave the pattern", () => {
    expect(QuerySchema.parse({}).part).toBe("overview");
    expect(QuerySchema.safeParse({ run: "a'; DROP" }).success).toBe(false);
    expect(QuerySchema.safeParse({ part: "nope" }).success).toBe(false);
    expect(QuerySchema.safeParse({ layer: "encoder.geometry_norm" }).success).toBe(true);
  });
});

// ── the handler, against a fake lake ─────────────────────────────────────────

const PREFIX = "derived_study_training_environment_";

function runRow(name: string, modified: number, recipe = "snapshot_2") {
  return {
    run_name: name, recipe, status: "finished", symbol: "MNQ", timeframe: "1h", maximum_bars: 40000, window_bars: 32, horizon_bars: 12,
    barrier_points: 25, epochs_configured: 2, batch_size: 256, learning_rate: 0.0003, model_dimension: 64, modality_dropout: 0.1,
    train_fraction: 0.7, up_label_count: 7302, down_label_count: 6976, unresolved_label_count: 2321, epochs_seen: 2, batches_streamed: 10,
    event_count: 24, latest_epoch: 2, best_direction_accuracy: 0.5265, best_epoch: 1, majority_baseline_accuracy: 0.5156, skill: 0.011,
    parameter_count: 170152, elapsed_seconds: 9.86, stream_modified_ms: modified, landed_at_ms: 1, snapshot_format: "parquet",
  };
}

function fakeLake(seen: string[] = []): StudyLake {
  const catalogue = [
    { block: "geometry", block_index: 0, feature: "open_norm", feature_index: 0, bar_count: 3 },
    { block: "geometry", block_index: 0, feature: "close_norm", feature_index: 1, bar_count: 3 },
    { block: "volume", block_index: 1, feature: "volume_causal_zscore", feature_index: 0, bar_count: 3 },
  ];
  return {
    async query<T>(sql: string): Promise<T[]> {
      seen.push(sql);
      const rows = (() => {
        if (sql.includes(`${PREFIX}runs`)) return [runRow("multimodal_MNQ_5m", 100), runRow("multimodal_MNQ_1h", 200)];
        if (sql.includes(`${PREFIX}blocks`)) return catalogue;
        if (sql.includes(`${PREFIX}block_features`) && sql.includes("WITH base")) {
          return [{ feature: "open_norm", count: 3, mean: 0.5, median: 0.5, standard_deviation: 0.1, skewness: 0, excess_kurtosis: -1.5, percentile_25: 0.45, percentile_75: 0.55, minimum: 0.4, maximum: 0.6 }];
        }
        if (sql.includes(`${PREFIX}block_features`)) {
          return [
            { bar_index: 0, feature_index: 0, value: 0.4 }, { bar_index: 0, feature_index: 1, value: null },
            { bar_index: 2, feature_index: 0, value: 0.6 }, { bar_index: 2, feature_index: 1, value: 0.9 },
          ];
        }
        if (sql.includes(`${PREFIX}embedding_points`) && sql.includes("GROUP BY epoch")) {
          return [{ epoch: 1, variance_explained: 0.52, point_count: 2 }, { epoch: 4, variance_explained: 0.61, point_count: 2 }];
        }
        if (sql.includes(`${PREFIX}embedding_points`)) return [{ component_1: 0.1, component_2: 0.2, barrier_outcome: "up first", pattern_fired: "fired" }];
        if (sql.includes("SELECT DISTINCT epoch")) return [{ epoch: 1 }, { epoch: 2 }];
        if (sql.includes(`${PREFIX}layer_readings`) && sql.includes("SELECT layer_name")) return [{ layer_name: "encoder.geometry_norm" }, { layer_name: "transformer.head.0" }];
        if (sql.includes(`${PREFIX}layer_activations`)) {
          return [
            { row_index: 0, unit_index: 0, activation: 1 }, { row_index: 0, unit_index: 1, activation: null },
            { row_index: 1, unit_index: 0, activation: 3 }, { row_index: 1, unit_index: 1, activation: 4 },
          ];
        }
        return [];
      })();
      return rows as T[];
    },
    async hasView() {
      return true;
    },
    async columns() {
      return [];
    },
  };
}

async function run(query: Record<string, unknown>, lake: StudyLake): Promise<{ body: TrainingEnvironmentBody; notes: string[] }> {
  const context: StudyContext = { lake, notes: [] };
  const body = await handler.run(handler.query.parse(query), context);
  return { body, notes: context.notes };
}

describe("the handler", () => {
  it("answers every part with an empty body and a note when nothing is landed", async () => {
    const lake: StudyLake = { ...fakeLake(), hasView: async () => false };
    for (const part of ["overview", "bars", "block", "embedding", "activations"]) {
      const { body, notes } = await run({ part }, lake);
      expect(body.part).toBe(part);
      expect(notes[0]).toContain("Not in the lake yet");
    }
  });

  it("chooses the newest run and pins every query to its recipe", async () => {
    const seen: string[] = [];
    const { body } = await run({}, fakeLake(seen));
    expect(body.part).toBe("overview");
    if (body.part !== "overview") return;
    expect(body.run).toBe("multimodal_MNQ_1h");
    expect(body.runs.map((row) => row.run_name)).toEqual(["multimodal_MNQ_5m", "multimodal_MNQ_1h"]);
    expect(Object.keys(body.runs[0] ?? {})).not.toContain("recipe");
    const perRun = seen.filter((sql) => !sql.includes("QUALIFY"));
    expect(perRun.length).toBeGreaterThan(5);
    for (const sql of perRun) expect(sql).toContain("run_name = 'multimodal_MNQ_1h' AND recipe = 'snapshot_2'");
    expect(body.blocks[0]?.block).toBe("geometry");
    expect(body.embeddingEpochs.length).toBe(2);
  });

  it("opens the run asked for", async () => {
    const { body } = await run({ run: "multimodal_MNQ_5m" }, fakeLake());
    expect(body.part === "overview" && body.run).toBe("multimodal_MNQ_5m");
  });

  it("assembles a block into bar-major rows, with a null where a number was not finite", async () => {
    const { body } = await run({ part: "block", block: "geometry" }, fakeLake());
    if (body.part !== "block") throw new Error("wrong part");
    expect(body.block).toBe("geometry");
    expect(body.features).toEqual(["open_norm", "close_norm"]);
    expect(body.values).toEqual([[0.4, null], [null, null], [0.6, 0.9]]);
    expect(body.statistics[0]?.feature).toBe("open_norm");
  });

  it("falls back to the first block for a block the run does not have", async () => {
    const { body } = await run({ part: "block", block: "nonexistent" }, fakeLake());
    expect(body.part === "block" && body.block).toBe("geometry");
  });

  it("serves the snapshot epoch nearest the one asked for, the newest when none was", async () => {
    const near = (await run({ part: "embedding", epoch: 3 }, fakeLake())).body;
    if (near.part !== "embedding") throw new Error("wrong part");
    expect(near.epoch).toBe(4);
    expect(near.variance_explained).toBe(0.61);
    expect(near.points).toHaveLength(1);
    const newest = (await run({ part: "embedding" }, fakeLake())).body;
    expect(newest.part === "embedding" && newest.epoch).toBe(4);
  });

  it("returns the layer's stored activation slice as rows by units", async () => {
    const { body } = await run({ part: "activations", epoch: 99, layer: "transformer.head.0" }, fakeLake());
    if (body.part !== "activations") throw new Error("wrong part");
    expect(body.epoch).toBe(2);
    expect(body.layer).toBe("transformer.head.0");
    expect(body.values).toEqual([[1, null], [3, 4]]);
  });

  it("uses the first layer when the asked-for one is not in that epoch", async () => {
    const { body } = await run({ part: "activations", layer: "no.such.layer" }, fakeLake());
    expect(body.part === "activations" && body.layer).toBe("encoder.geometry_norm");
  });
});
