// @vitest-environment jsdom
/**
 * Inside the model — the neural view on REAL explainer replies.
 *
 * `tests/fixtures/cycle_explain_client_neural/real_<key>.json` are
 * `{manifest, structure, bar}` written by the neural explainer
 * (`src/ml/cycle/explain/neural.py`) on the small real runs of
 * `tests/test_cycle_explain_neural.py` (regenerate with
 * `CYCLE_EXPLAIN_WRITE_FIXTURES=1` on that test), one per runnable neural key.
 * The view must caption every layer the explainer names, pair attention with
 * its layer by name, and time sequence layers by the input window.
 */
import "./setup";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  cycleExplainBarSchema,
  cycleExplainManifestSchema,
  cycleExplainStructureSchema,
  type CycleExplainBar,
  type CycleExplainManifest,
  type CycleExplainStructure,
} from "../../src/shared/cycle/explain";
import { NeuralView } from "../../src/client/src/cycle/inside/neural/NeuralView";
import { attentionLayers, buildNeuralStages, formatActivation, sigmoid, type LayerFamily } from "../../src/client/src/cycle/inside/neural/stages";

afterEach(cleanup);

interface Fixture {
  manifest: CycleExplainManifest;
  structure: CycleExplainStructure;
  bar: CycleExplainBar;
}

/** The layer families each network's recorded layers must be captioned as, in order. */
const FAMILIES: Record<string, LayerFamily[]> = {
  multilayer_perceptron: ["dense", "dense"],
  feedforward_network: ["dense", "dense"],
  recurrent_network: ["recurrent", "recurrent"],
  gated_recurrent_unit: ["gated_recurrent_unit"],
  lstm: ["lstm", "lstm"],
  attention_recurrent_network: ["gated_recurrent_unit", "attention"],
  temporal_convolution_network: ["convolution", "convolution"],
  transformer_encoder: ["projection", "transformer", "transformer", "normalization"],
  multilayer_perceptron_scikit_learn: ["dense", "dense"],
};
const KEYS = Object.keys(FAMILIES);

function load(key: string): Fixture {
  const raw = JSON.parse(readFileSync(join(process.cwd(), "tests", "fixtures", "cycle_explain_client_neural", `real_${key}.json`), "utf8"));
  return {
    manifest: cycleExplainManifestSchema.parse(raw.manifest),
    structure: cycleExplainStructureSchema.parse(raw.structure),
    bar: cycleExplainBarSchema.parse(raw.bar),
  };
}

describe("real neural explainer replies", () => {
  it.each(KEYS)("%s: the reply is consistent (logit = output.raw, sigmoid(logit) = P(up))", (key) => {
    const { bar, structure, manifest } = load(key);
    expect(manifest.modelKey).toBe(key);
    expect(bar.neural).not.toBeNull();
    expect(bar.output.raw).toBe(bar.neural!.logit);
    expect(Math.abs(sigmoid(bar.neural!.logit) - bar.output.probabilityUp!)).toBeLessThan(1e-6);
    expect(structure.neural!.layers.map((layer) => [layer.name, layer.kind, layer.outputShape])).toEqual(
      bar.neural!.layers.map((layer) => [layer.name, layer.kind, layer.shape]),
    );
    for (const layer of bar.neural!.layers) expect(layer.values).toHaveLength(layer.shape.reduce((a, b) => a * b, 1));
  });

  it.each(KEYS)("%s: every layer lands on its caption family, and sequence layers carry the window's timestamps", (key) => {
    const { bar, structure, manifest } = load(key);
    const stages = buildNeuralStages({ bar, structure, featureNames: manifest.featureDisplayNames, role: "direction" });
    expect(stages).toHaveLength(bar.neural!.layers.length + 2);
    expect(stages.slice(1, -1).map((stage) => stage.family)).toEqual(FAMILIES[key]);
    for (const stage of stages) {
      expect(stage.problem).toBeNull();
      expect(stage.caption.length).toBeGreaterThan(20);
    }
    const window = bar.inputs.window;
    expect(window === null).toBe(structure.neural!.sequenceLength === 1);
    for (const stage of stages.slice(1, -1)) {
      if (window && stage.grid && stage.grid.timeCount > 1) expect(stage.timestamps).toEqual(window.timestamps);
    }
  });

  it.each(KEYS)("%s: attention is paired with a recorded layer by name and spans the window", (key) => {
    const { bar, structure } = load(key);
    const groups = attentionLayers(bar);
    expect(groups.length > 0).toBe(structure.neural!.hasAttention);
    const names = bar.neural!.layers.map((layer) => layer.name);
    for (const group of groups) {
      expect(names).toContain(group.layer);
      for (const head of group.heads) {
        expect(head.weights).toHaveLength(bar.inputs.window!.timestamps.length);
        expect(head.weights.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
      }
    }
  });

  it.each(KEYS)("%s renders every stage with the logit", (key) => {
    const fixture = load(key);
    render(<NeuralView manifest={fixture.manifest} structure={fixture.structure} bar={fixture.bar} role="direction" featureNames={fixture.manifest.featureDisplayNames} />);
    expect(document.querySelectorAll('[data-testid^="neural-stage-"]')).toHaveLength(fixture.bar.neural!.layers.length + 2);
    expect(screen.getByTestId("neural-logit")).toHaveTextContent(formatActivation(fixture.bar.neural!.logit));
    expect(screen.queryByTestId("neural-attention") !== null).toBe(fixture.structure.neural!.hasAttention);
  });

  it("stepping onto the second encoder layer moves the attention chart to it", () => {
    const fixture = load("transformer_encoder");
    render(<NeuralView manifest={fixture.manifest} structure={fixture.structure} bar={fixture.bar} role="direction" featureNames={fixture.manifest.featureDisplayNames} />);
    // input, projection, encoder layer 1, encoder layer 2
    fireEvent.click(screen.getByTestId("neural-shape-3"));
    expect(document.querySelector('[data-active="true"]')?.getAttribute("data-stage-id")).toBe("Encoder layer 2");
    expect((screen.getByTestId("attention-layer-select") as HTMLSelectElement).value).toBe("Encoder layer 2");
    fireEvent.click(screen.getByTestId("attention-head-1"));
    const weights = screen.getAllByTestId("attention-bar").map((bar) => Number(bar.getAttribute("data-weight")));
    const expected = fixture.bar.neural!.attention.find((entry) => entry.layer === "Encoder layer 2" && entry.head === 1)!.weights;
    expect(weights).toEqual(expected);
  });
});
