/**
 * The vector-space explainer: the handler on a fake lake (pivot of the
 * z-scored matrix, block ordering, a short series dropped with a note, a
 * missing dataset degrading to an empty body) and the pure maths the page
 * shares with it (pair direction and shadows, Jacobi eigen, principal
 * components, the HNSW walk, recall summary).
 */

import { describe, expect, it } from "vitest";
import handler from "../../studies/handlers/vector-space-explained";
import type { StudyContext, StudyLake } from "../../studies/types";
import {
  EMPTY_BODY, basisColumns, blockShares, buildWalkWorld, componentsForShare, greedyWalk, isAtBest, jacobiEigen, modulo,
  nearestLinks, pairAnalysis, parseSeries, principalComponents, queriesPerMiss, recallSummary, termSum, varianceAtAngle,
  type RecallRow, type VectorSpaceBody,
} from "@shared/studies/vector-space-explained";

const PREFIX = "derived_study_vector_space_explained_";
const ALL_VIEWS = ["standardized_features", "component_spectrum", "component_loadings", "neighbour_index_recall", "walk_node_layers", "run_information"].map((t) => `${PREFIX}${t}`);

function fakeLake(present: readonly string[], seriesRows: Array<{ feature_name: string; block_name: string; series: string }>): { lake: StudyLake; queries: string[] } {
  const queries: string[] = [];
  const lake: StudyLake = {
    async query<T>(sql: string): Promise<T[]> {
      queries.push(sql);
      if (sql.includes("GROUP BY feature_name")) return seriesRows as T[];
      if (sql.includes("DISTINCT bar_index")) return [{ series: "0,1,2,3" }] as T[];
      if (sql.includes("component_spectrum")) return [{ basis: "continuous", component_number: 1, eigenvalue: 1.5, variance_share: 0.75, cumulative_variance_share: 0.75 }] as T[];
      if (sql.includes("component_loadings")) return [{ basis: "continuous", component_number: 1, feature_name: "geometry.a", block_name: "geometry", loading: 0.7 }] as T[];
      if (sql.includes("neighbour_index_recall")) return [{ basis: "continuous", neighbour_count: 12, ef_search: 0, recall_at_k: 1, mean_query_milliseconds: 1.2 }] as T[];
      if (sql.includes("walk_node_layers")) return [{ node_index: 0, layer: 2 }, { node_index: 1, layer: 0 }] as T[];
      if (sql.includes("run_information")) return [{ source_run: "multimodal_MNQ_1h", bar_count: 4 }] as T[];
      return [];
    },
    async hasView(name) {
      return present.includes(name);
    },
    async columns() {
      return [];
    },
  };
  return { lake, queries };
}

async function run(present: readonly string[], rows: Array<{ feature_name: string; block_name: string; series: string }>) {
  const { lake, queries } = fakeLake(present, rows);
  const context: StudyContext = { lake, notes: [] };
  const body = (await handler.run(handler.query.parse({}), context)) as VectorSpaceBody;
  return { body, notes: context.notes, queries };
}

describe("vector-space-explained handler", () => {
  it("reads every dataset it declares", () => {
    expect(handler.slug).toBe("vector-space-explained");
    expect(handler.datasets).toEqual(ALL_VIEWS);
  });

  it("answers an empty body and a note when a dataset is not landed", async () => {
    const { body, notes, queries } = await run(ALL_VIEWS.slice(1), []);
    expect(body).toEqual(EMPTY_BODY);
    expect(notes[0]).toContain(`${PREFIX}standardized_features`);
    expect(queries).toHaveLength(0);
  });

  it("pivots the matrix to one series per feature, in block order, and passes the landed tables through", async () => {
    const { body, notes } = await run(ALL_VIEWS, [
      { feature_name: "pattern_multihot.doji", block_name: "pattern_multihot", series: "-0.5,-0.5,2,-0.5" },
      { feature_name: "volume.b", block_name: "volume", series: "1e-05,-1,0,1" },
      { feature_name: "geometry.a", block_name: "geometry", series: "0.1,0.2,0.3,0.4" },
    ]);
    expect(notes).toEqual([]);
    expect(body.featureNames).toEqual(["geometry.a", "volume.b", "pattern_multihot.doji"]);
    expect(body.featureBlocks).toEqual(["geometry", "volume", "pattern_multihot"]);
    expect(body.barIndex).toEqual([0, 1, 2, 3]);
    expect(body.values[1]).toEqual([0.00001, -1, 0, 1]);
    expect(body.spectrum[0]?.variance_share).toBe(0.75);
    expect(body.loadings[0]?.feature_name).toBe("geometry.a");
    expect(body.recall[0]?.ef_search).toBe(0);
    expect(body.nodeLayers).toEqual([2, 0]);
    expect(body.run?.source_run).toBe("multimodal_MNQ_1h");
  });

  it("leaves out a feature whose series is the wrong length, with a note", async () => {
    const { body, notes } = await run(ALL_VIEWS, [
      { feature_name: "geometry.a", block_name: "geometry", series: "0.1,0.2,0.3,0.4" },
      { feature_name: "geometry.short", block_name: "geometry", series: "0.1,0.2" },
    ]);
    expect(body.featureNames).toEqual(["geometry.a"]);
    expect(notes[0]).toContain("geometry.short");
  });

  it("sends no value from the browser into SQL: the query has no parameters", () => {
    expect(handler.query.parse({ anything: "x" })).toEqual({});
  });
});

describe("a feature pair and its shadows", () => {
  const x = Array.from({ length: 200 }, (_, i) => Math.sin(i * 0.37) * 2 + (i % 7) * 0.1);
  const y = x.map((value, i) => value * 0.8 + Math.cos(i * 1.3) * 0.3);

  it("finds the direction that carries the most variance and that variance", () => {
    const pair = pairAnalysis(x, y);
    const atBest = varianceAtAngle(pair, pair.bestAngleDegrees);
    expect(atBest).toBeCloseTo(pair.bestVariance, 9);
    for (let angle = 0; angle < 180; angle += 1) expect(varianceAtAngle(pair, angle)).toBeLessThanOrEqual(pair.bestVariance + 1e-9);
    // at right angles to the best direction the variance is the smaller eigenvalue
    const other = varianceAtAngle(pair, pair.bestAngleDegrees + 90);
    expect(atBest + other).toBeCloseTo(pair.varianceX + pair.varianceY, 9);
  });

  it("puts two identical features on 45 degrees and none on the perpendicular", () => {
    const pair = pairAnalysis(x, x);
    expect(pair.bestAngleDegrees).toBeCloseTo(45, 9);
    expect(pair.correlation).toBeCloseTo(1, 9);
    expect(varianceAtAngle(pair, 135)).toBeCloseTo(0, 9);
  });

  it("puts two opposed features on 135 degrees", () => {
    expect(pairAnalysis(x, x.map((v) => -v)).bestAngleDegrees).toBeCloseTo(135, 9);
  });

  it("treats directions as lines when asking whether the slider is at the best angle", () => {
    expect(isAtBest(179.5, 0.5)).toBe(true);
    expect(isAtBest(0.5, 179.5)).toBe(true);
    expect(isAtBest(179, 1)).toBe(false); // exactly 2 degrees apart: the notebook's bound is strict
    expect(isAtBest(45, 47.5)).toBe(false);
    expect(isAtBest(45, 46.9)).toBe(true);
    expect(modulo(-1, 180)).toBe(179);
  });

  it("makes the running total equal the full variance once every bar is included", () => {
    const pair = pairAnalysis(x, y);
    const sum = termSum(pair, 20, pair.count, 400);
    expect(sum.running).toBeCloseTo(sum.full, 9);
    expect(sum.terms).toHaveLength(pair.count);
    const partial = termSum(pair, 20, 5, 400);
    expect(partial.running).toBeCloseTo(partial.terms.slice(0, 5).reduce((a, b) => a + b, 0) / 4, 12);
    expect(partial.peak).toBe(Math.max(...partial.terms.slice(0, 5)));
  });

  it("pins the axis limit to 1.15 times the 99.5th percentile of the centred magnitudes", () => {
    const pair = pairAnalysis([-1, 0, 1], [-1, 0, 1]);
    expect(pair.axisLimit).toBeGreaterThan(0);
    expect(pair.axisLimit).toBeLessThan(1.15 * 1.0001);
  });
});

describe("eigen-decomposition", () => {
  it("diagonalises a symmetric matrix", () => {
    const { values, vectors } = jacobiEigen([[2, 1], [1, 2]]);
    expect([...values].sort((a, b) => b - a).map((v) => Number(v.toFixed(9)))).toEqual([3, 1]);
    // columns are orthonormal
    const dot = vectors[0]![0]! * vectors[0]![1]! + vectors[1]![0]! * vectors[1]![1]!;
    expect(Math.abs(dot)).toBeLessThan(1e-12);
  });

  it("gives principal components whose eigenvalues sum to the total variance, in order, with the largest loading positive", () => {
    const n = 300;
    const a = Array.from({ length: n }, (_, i) => Math.sin(i * 0.11) + 0.3 * Math.cos(i * 0.7));
    const b = a.map((v, i) => 0.9 * v + 0.2 * Math.sin(i * 1.9));
    const c = Array.from({ length: n }, (_, i) => Math.cos(i * 0.053));
    const pcs = principalComponents([a, b, c]);
    const total = [a, b, c].reduce((sum, column) => {
      const mean = column.reduce((s, v) => s + v, 0) / n;
      return sum + column.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1);
    }, 0);
    expect(pcs.eigenvalues.reduce((s, v) => s + v, 0)).toBeCloseTo(total, 9);
    expect(pcs.eigenvalues[0]!).toBeGreaterThanOrEqual(pcs.eigenvalues[1]!);
    expect(pcs.eigenvalues[1]!).toBeGreaterThanOrEqual(pcs.eigenvalues[2]!);
    expect(pcs.cumulativeShares[2]).toBeCloseTo(1, 12);
    for (const component of pcs.components) {
      expect(component.reduce((s, v) => s + v * v, 0)).toBeCloseTo(1, 9);
      const peak = component.reduce((best, v) => (Math.abs(v) > Math.abs(best) ? v : best), 0);
      expect(peak).toBeGreaterThan(0);
    }
    const dot = pcs.components[0]!.reduce((s, v, j) => s + v * pcs.components[1]![j]!, 0);
    expect(Math.abs(dot)).toBeLessThan(1e-9);
  });

  it("counts the components needed to reach a share the way the notebook does", () => {
    expect(componentsForShare([0.5, 0.8, 0.95, 1], 0.9)).toBe(3);
    expect(componentsForShare([0.5, 0.8], 0.9)).toBe(2);
  });

  it("gives each block its share of a component's squared loadings", () => {
    const shares = blockShares([0.6, 0.8, 0], ["a", "b", "c"]);
    expect(shares[0]?.block).toBe("b");
    expect(shares[0]?.share).toBeCloseTo(0.64, 12);
    expect(shares.reduce((s, e) => s + e.share, 0)).toBeCloseTo(1, 12);
  });

  it("selects a basis's columns by block", () => {
    const body = { featureNames: ["geometry.a", "pattern_multihot.doji"], featureBlocks: ["geometry", "pattern_multihot"], values: [[1, 2], [3, 4]] };
    expect(basisColumns(body, "continuous").names).toEqual(["geometry.a"]);
    expect(basisColumns(body, "full").names).toHaveLength(2);
  });
});

describe("the HNSW walk", () => {
  it("links each node to its nearest others, nearest first", () => {
    const links = nearestLinks({ x: Float64Array.from([0, 1, 3, 7]), y: Float64Array.from([0, 0, 0, 0]) }, 2);
    expect(links[0]).toEqual([1, 2]);
    expect(links[3]).toEqual([2, 1]);
  });

  it("descends layer by layer and ends on the true nearest, counting every distance it computes", () => {
    const world = { x: Float64Array.from([0, 1, 2, 3, 4]), y: new Float64Array(5), bars: [0, 1, 2, 3, 4], queryX: 3.9, queryY: 0, queryBar: 99, queryIndex: 0, stride: 1 };
    const adjacency = [[1, 2], [0, 2], [1, 3], [2, 4], [3, 2]];
    const walk = greedyWalk(world, adjacency, [2, 0, 1, 0, 0]);
    expect(walk.path.map((step) => step.layer)).toEqual([2, 1, 1, 0, 0, 0]);
    expect(walk.path[walk.path.length - 1]?.node).toBe(4);
    expect(walk.exactNearest).toBe(4);
    expect(walk.computations).toBe(7);
    // distances along the path never get worse within a layer
    expect(walk.path[2]!.distance).toBeLessThan(walk.path[1]!.distance);
  });

  it("samples 220 evenly spaced bars and takes the query from between them", () => {
    const pair = pairAnalysis(Array.from({ length: 4000 }, (_, i) => Math.sin(i)), Array.from({ length: 4000 }, (_, i) => Math.cos(i * 0.3)));
    const world = buildWalkWorld(pair, Array.from({ length: 4000 }, (_, i) => i), 220);
    expect(world.stride).toBe(18);
    expect(world.x).toHaveLength(220);
    expect(world.bars[1]).toBe(18);
    expect(world.queryIndex).toBe(9 + 18 * 140);
    expect(world.bars).not.toContain(world.queryBar);
  });
});

describe("recall", () => {
  const rows: RecallRow[] = [
    { basis: "continuous", neighbour_count: 12, ef_search: 0, recall_at_k: 1, mean_query_milliseconds: 1.3 },
    { basis: "continuous", neighbour_count: 12, ef_search: 8, recall_at_k: 0.9972222, mean_query_milliseconds: 1.1 },
    { basis: "continuous", neighbour_count: 12, ef_search: 16, recall_at_k: 1, mean_query_milliseconds: 1.2 },
    { basis: "full", neighbour_count: 12, ef_search: 0, recall_at_k: 1, mean_query_milliseconds: 2 },
    { basis: "full", neighbour_count: 12, ef_search: 8, recall_at_k: 0.99, mean_query_milliseconds: 1 },
  ];

  it("separates the exact scan from the indexed settings and finds the first perfect one", () => {
    const summary = recallSummary(rows, "continuous");
    expect(summary.brute?.mean_query_milliseconds).toBe(1.3);
    expect(summary.indexed.map((row) => row.ef_search)).toEqual([8, 16]);
    expect(summary.worst?.ef_search).toBe(8);
    expect(summary.reachesPerfect).toBe(true);
    expect(summary.firstPerfectEf).toBe(16);
    expect(summary.fastestMilliseconds).toBe(1.1);
  });

  it("says when no setting is perfect", () => {
    const summary = recallSummary(rows, "full");
    expect(summary.reachesPerfect).toBe(false);
    expect(summary.firstPerfectEf).toBeNull();
    expect(queriesPerMiss(0.99, 12)).toBeCloseTo(100 / 12, 6);
  });

  it("parses a comma-joined series and refuses a bad one", () => {
    expect(parseSeries("1,2.5,-3e-05")).toEqual([1, 2.5, -0.00003]);
    expect(parseSeries("1,x")).toBeNull();
    expect(parseSeries("")).toBeNull();
  });
});
