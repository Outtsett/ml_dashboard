// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  deriveArchGraph,
  SUPPORTED_ALGORITHMS,
  TUNABLE_HPS,
} from "@/system/architecture-explorer/graph/derive";
import { LAYER_PALETTE } from "@/system/architecture-explorer/graph/palette";
import type { ArchGraph } from "@/system/architecture-explorer/graph/types";

function nonNull(id: string, hp: Record<string, number | string | boolean> = {}): ArchGraph {
  const g = deriveArchGraph(id, hp);
  expect(g, `deriveArchGraph(${id}) should be non-null`).not.toBeNull();
  return g as ArchGraph;
}

describe("deriveArchGraph — structural invariants", () => {
  it("every supported id derives a coherent graph", () => {
    for (const id of SUPPORTED_ALGORITHMS) {
      const g = nonNull(id);

      // (a) at least 3 nodes.
      expect(g.nodes.length, `${id}: >=3 nodes`).toBeGreaterThanOrEqual(3);

      // node ids are unique.
      const ids = new Set(g.nodes.map((n) => n.id));
      expect(ids.size, `${id}: unique node ids`).toBe(g.nodes.length);

      // (a) every edge references existing node ids.
      for (const e of g.edges) {
        expect(ids.has(e.from), `${id}: edge.from ${e.from} exists`).toBe(true);
        expect(ids.has(e.to), `${id}: edge.to ${e.to} exists`).toBe(true);
      }

      // (a) columns / lanes consistent with node coords.
      const maxCol = Math.max(...g.nodes.map((n) => n.column));
      const maxLane = Math.max(...g.nodes.map((n) => n.lane));
      expect(g.columns, `${id}: columns == max(column)+1`).toBe(maxCol + 1);
      expect(g.lanes, `${id}: lanes == max(lane)+1`).toBe(maxLane + 1);
      for (const n of g.nodes) {
        expect(n.column).toBeGreaterThanOrEqual(0);
        expect(n.lane).toBeGreaterThanOrEqual(0);
      }

      // totalParams == sum of node params.
      const sum = g.nodes.reduce((s, n) => s + (n.params ?? 0), 0);
      expect(g.totalParams, `${id}: totalParams == Σ node params`).toBe(sum);

      // no orphan nodes: every node participates in at least one edge.
      const touched = new Set<string>();
      for (const e of g.edges) {
        touched.add(e.from);
        touched.add(e.to);
      }
      for (const n of g.nodes) {
        expect(touched.has(n.id), `${id}: ${n.id} participates in an edge`).toBe(true);
      }
    }
  });

  it("(e) every node kind exists in LAYER_PALETTE", () => {
    for (const id of SUPPORTED_ALGORITHMS) {
      const g = nonNull(id);
      for (const n of g.nodes) {
        expect(LAYER_PALETTE[n.kind], `${id}: palette has kind ${n.kind}`).toBeDefined();
        expect(typeof LAYER_PALETTE[n.kind].token).toBe("string");
        expect(LAYER_PALETTE[n.kind].token.startsWith("--data-")).toBe(true);
      }
    }
  });

  it("(d) unsupported ids return null", () => {
    expect(deriveArchGraph("primitives_cnn", {})).toBeNull();
    expect(deriveArchGraph("not_a_real_model", {})).toBeNull();
    expect(deriveArchGraph("", {})).toBeNull();
    // primitives_cnn is deliberately not in SUPPORTED_ALGORITHMS.
    expect(SUPPORTED_ALGORITHMS).not.toContain("primitives_cnn");
  });
});

describe("deriveArchGraph — faithful parameter counts", () => {
  it("(b) transformer_2s at defaults totals ~793,680 params (±5%)", () => {
    const g = nonNull("transformer_2s");
    const expected = 793_680;
    const rel = Math.abs(g.totalParams - expected) / expected;
    expect(rel, `totalParams=${g.totalParams} within 5% of ${expected}`).toBeLessThan(0.05);
  });

  it("two-stream encoder body reproduces the exact 793,680 layer math", () => {
    // The encoder body without the head must equal exactly 793,680: the four
    // TransformerEncoderLayer(128, 512) blocks + the two input projections.
    const g = nonNull("transformer_2s");
    const encoderNodes = g.nodes.filter(
      (n) => n.id.startsWith("enc") || n.id === "price_proj" || n.id === "vol_proj",
    );
    const encParams = encoderNodes.reduce((s, n) => s + (n.params ?? 0), 0);
    expect(encParams).toBe(793_680);
  });

  it("transformer_tiny is a small (~10-20k param) two-stream variant", () => {
    const g = nonNull("transformer_tiny");
    expect(g.totalParams).toBeGreaterThan(8_000);
    expect(g.totalParams).toBeLessThan(30_000);
  });
});

describe("deriveArchGraph — HP monotonicity", () => {
  it("(c) transformer_seq node count + params grow monotonically with n_layers", () => {
    let prevNodes = -1;
    let prevParams = -1;
    for (const nLayers of [1, 2, 3, 4]) {
      const g = nonNull("transformer_seq", { n_layers: nLayers });
      expect(g.nodes.length, `n_layers=${nLayers}: more nodes`).toBeGreaterThan(prevNodes);
      expect(g.totalParams, `n_layers=${nLayers}: more params`).toBeGreaterThan(prevParams);
      prevNodes = g.nodes.length;
      prevParams = g.totalParams;
    }
  });

  it("(c) transformer_seq collapses to a single stacked node past the unroll cap", () => {
    const g4 = nonNull("transformer_seq", { n_layers: 4 });
    const g8 = nonNull("transformer_seq", { n_layers: 8 });
    // 8 layers unrolls to fewer nodes than 4 (one '× N' node), but more params.
    expect(g8.nodes.some((n) => n.id === "enc_stack")).toBe(true);
    expect(g8.totalParams).toBeGreaterThan(g4.totalParams);
  });

  it("(c) temporal_fusion_transformer params grow monotonically with d_model", () => {
    let prev = -1;
    for (const dModel of [16, 32, 64, 128]) {
      const g = nonNull("temporal_fusion_transformer", { d_model: dModel });
      expect(g.totalParams, `d_model=${dModel}: more params`).toBeGreaterThan(prev);
      prev = g.totalParams;
    }
  });

  it("(c) TFT params grow monotonically with lstm_layers", () => {
    let prev = -1;
    for (const L of [1, 2, 3, 4]) {
      const g = nonNull("temporal_fusion_transformer", { lstm_layers: L });
      expect(g.totalParams, `lstm_layers=${L}: more params`).toBeGreaterThan(prev);
      prev = g.totalParams;
    }
  });
});

describe("deriveArchGraph — xgboost tree rule", () => {
  it("(f) node count responds to num_boost_round up to the display cap", () => {
    const g1 = nonNull("xgboost", { n_estimators: 1 });
    const g2 = nonNull("xgboost", { n_estimators: 2 });
    const g3 = nonNull("xgboost", { n_estimators: 3 });
    const g4 = nonNull("xgboost", { n_estimators: 4 });
    const g500 = nonNull("xgboost", { n_estimators: 500 });

    const trees = (g: ArchGraph) => g.nodes.filter((n) => n.kind === "tree").length;
    expect(trees(g1)).toBe(1);
    expect(trees(g2)).toBe(2);
    expect(trees(g3)).toBe(3);
    expect(trees(g4)).toBe(4);
    // Past the cap the tree count saturates (a summarizing "Trees N…M" node).
    expect(trees(g500)).toBe(4);

    expect(g1.nodes.length).toBeLessThan(g3.nodes.length);
    expect(g3.nodes.length).toBeLessThan(g4.nodes.length);
    expect(g4.nodes.length).toBe(g500.nodes.length);

    // The alias num_boost_round is honored identically to n_estimators.
    expect(trees(nonNull("xgboost", { num_boost_round: 2 }))).toBe(2);
  });

  it("(f) the summarizing tree node names the full round count", () => {
    const g = nonNull("xgboost", { n_estimators: 500 });
    const lastTree = g.nodes.filter((n) => n.kind === "tree").at(-1)!;
    expect(lastTree.label).toContain("500");
    const sum = g.nodes.find((n) => n.id === "sum")!;
    expect(sum.sublabel).toContain("500");
  });

  it("xgboost carries no backprop params (tree ensemble)", () => {
    const g = nonNull("xgboost");
    expect(g.totalParams).toBe(0);
  });
});

describe("TUNABLE_HPS", () => {
  it("every supported id has a tunable-HP entry with valid slider specs", () => {
    for (const id of SUPPORTED_ALGORITHMS) {
      const hps = TUNABLE_HPS[id];
      expect(hps, `${id} has TUNABLE_HPS`).toBeDefined();
      for (const hp of hps) {
        expect(hp.min).toBeLessThan(hp.max);
        expect(hp.step).toBeGreaterThan(0);
        expect(hp.name.length).toBeGreaterThan(0);
        expect(hp.label.length).toBeGreaterThan(0);
      }
    }
  });
});
