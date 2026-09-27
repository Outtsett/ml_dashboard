// @vitest-environment jsdom
/**
 * Inside the model — the neural view (`src/client/src/cycle/inside/neural/`).
 *
 * Fixtures `tests/fixtures/cycle_explain_client_neural/{mlp,lstm,transformer}.json`
 * were produced by small REAL torch networks with the layer structure of
 * `src/ml/cycle/networks.py` (a two-hidden-layer perceptron, a 96-unit LSTM
 * over 32 bars, a two-layer two-head transformer encoder over 16 bars), so
 * every activation, attention row and logit is mutually consistent:
 * logit = head(last activation), P(up) = sigmoid(logit).
 */
import "./setup";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  cycleExplainBarSchema,
  cycleExplainManifestSchema,
  cycleExplainStructureSchema,
  type CycleExplainBar,
  type CycleExplainManifest,
  type CycleExplainStructure,
} from "../../src/shared/cycle/explain";
import { NeuralView, PLAY_STEP_MILLISECONDS } from "../../src/client/src/cycle/inside/neural/NeuralView";
import { CIVIDIS_RAMP, MISSING_COLOR, VIRIDIS_RAMP, rampColor } from "../../src/client/src/cycle/inside/neural/colorScale";
import {
  MAX_DRAWN_ROWS,
  binEdges,
  buildNeuralStages,
  cellAtPointer,
  classifyLayerKind,
  drawnGrid,
  formatActivation,
  sigmoid,
} from "../../src/client/src/cycle/inside/neural/stages";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

interface Fixture {
  manifest: CycleExplainManifest;
  structure: CycleExplainStructure;
  bar: CycleExplainBar;
}

function loadFixture(name: "mlp" | "lstm" | "transformer"): Fixture {
  const raw = JSON.parse(readFileSync(join(process.cwd(), "tests", "fixtures", "cycle_explain_client_neural", `${name}.json`), "utf8"));
  return {
    manifest: cycleExplainManifestSchema.parse(raw.manifest),
    structure: cycleExplainStructureSchema.parse(raw.structure),
    bar: cycleExplainBarSchema.parse(raw.bar),
  };
}

function renderFixture(fixture: Fixture, role: "direction" | "price" = "direction") {
  return render(
    <NeuralView
      manifest={fixture.manifest}
      structure={fixture.structure}
      bar={fixture.bar}
      role={role}
      featureNames={fixture.manifest.featureDisplayNames}
    />,
  );
}

function activeStage(): string | null {
  const active = document.querySelector('[data-active="true"]');
  return active?.getAttribute("data-stage-id") ?? null;
}

/** Point the pointer at fractions (fx, fy) of a heatmap's hit area. */
function hoverAt(testId: string, fractionX: number, fractionY: number) {
  const hit = screen.getByTestId(`${testId}-hit`);
  hit.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0, toJSON: () => ({}) });
  fireEvent.mouseMove(hit, { clientX: fractionX * 200, clientY: fractionY * 100 });
}

// ─── colours ────────────────────────────────────────────────────────────────

const OKABE_ITO = ["#E69F00", "#56B4E9", "#009E73", "#F0E442", "#0072B2", "#D55E00", "#CC79A7", "#000000"];
const ALLOWED = new Set([...OKABE_ITO, MISSING_COLOR, ...CIVIDIS_RAMP, ...VIRIDIS_RAMP].map((hex) => hex.toUpperCase()));
const IGNORED = new Set(["none", "transparent", "currentcolor", "inherit", ""]);

function toHex(color: string): string | null {
  const value = color.trim().toLowerCase();
  if (IGNORED.has(value)) return null;
  if (/^#[0-9a-f]{6}$/.test(value)) return value.toUpperCase();
  const rgb = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(value);
  if (rgb) return `#${[rgb[1], rgb[2], rgb[3]].map((part) => Number(part).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
  return `UNPARSED:${value}`;
}

function paintedColors(root: HTMLElement): string[] {
  const found: string[] = [];
  for (const element of root.querySelectorAll("*")) {
    for (const attribute of ["fill", "stroke"]) {
      const value = element.getAttribute(attribute);
      if (value !== null) {
        const hex = toHex(value);
        if (hex) found.push(hex);
      }
    }
    const style = element.getAttribute("style") ?? "";
    for (const match of style.match(/#[0-9a-fA-F]{6}|rgba?\([^)]*\)/g) ?? []) {
      const hex = toHex(match);
      if (hex) found.push(hex);
    }
  }
  return found;
}

// ─── fixtures ───────────────────────────────────────────────────────────────

describe("neural fixtures", () => {
  it.each(["mlp", "lstm", "transformer"] as const)("%s is schema-valid and internally consistent", (name) => {
    const { bar, structure } = loadFixture(name);
    expect(bar.neural).not.toBeNull();
    expect(bar.neural!.logit).toBe(bar.output.raw);
    expect(Math.abs(sigmoid(bar.neural!.logit) - bar.output.probabilityUp!)).toBeLessThan(1e-12);
    expect(structure.neural!.layers.map((layer) => layer.name)).toEqual(bar.neural!.layers.map((layer) => layer.name));
    for (const layer of bar.neural!.layers) expect(layer.values).toHaveLength(layer.shape.reduce((a, b) => a * b, 1));
  });
});

// ─── pure helpers ───────────────────────────────────────────────────────────

describe("stages helpers", () => {
  it("classifies layer kinds by the words they contain", () => {
    expect(classifyLayerKind("lstm")).toBe("lstm");
    expect(classifyLayerKind("gated_recurrent_unit")).toBe("gated_recurrent_unit");
    expect(classifyLayerKind("gru")).toBe("gated_recurrent_unit");
    expect(classifyLayerKind("recurrent")).toBe("recurrent");
    expect(classifyLayerKind("attention")).toBe("attention");
    expect(classifyLayerKind("transformer_encoder_layer")).toBe("transformer");
    expect(classifyLayerKind("causal_convolution_block")).toBe("convolution");
    expect(classifyLayerKind("projection")).toBe("projection");
    expect(classifyLayerKind("layer_norm")).toBe("normalization");
    expect(classifyLayerKind("dense")).toBe("dense");
    expect(classifyLayerKind("linear_gelu")).toBe("dense");
    expect(classifyLayerKind("head")).toBe("head");
    expect(classifyLayerKind("input")).toBe("input");
    expect(classifyLayerKind("something_new")).toBe("other");
  });

  it("builds input → layers → output stages for each fixture", () => {
    const lstm = loadFixture("lstm");
    const stages = buildNeuralStages({ bar: lstm.bar, structure: lstm.structure, featureNames: lstm.manifest.featureDisplayNames, role: "direction" });
    expect(stages.map((stage) => stage.id)).toEqual(["input", "lstm", "head", "output"]);
    expect(stages[0].grid).toMatchObject({ timeCount: 32, unitCount: 8 });
    expect(stages[1].grid).toMatchObject({ timeCount: 32, unitCount: 96 });
    expect(stages[1].caption).toContain("The LSTM reads the 32 bars in order");
    expect(stages[1].timestamps).toEqual(lstm.bar.inputs.window!.timestamps);
    const mlp = loadFixture("mlp");
    const dense = buildNeuralStages({ bar: mlp.bar, structure: mlp.structure, featureNames: mlp.manifest.featureDisplayNames, role: "direction" });
    expect(dense[0].grid).toMatchObject({ timeCount: 1, unitCount: 8 });
    expect(dense[1].grid).toMatchObject({ timeCount: 1, unitCount: 24 });
  });

  it("downsamples for drawing but maps a pointer to the exact cell", () => {
    expect(binEdges(96, 48)).toHaveLength(49);
    expect(binEdges(5, 48)).toEqual([0, 1, 2, 3, 4, 5]);
    const grid = { timeCount: 2, unitCount: 96, values: Array.from({ length: 192 }, (_, i) => i) };
    const drawn = drawnGrid(grid);
    expect(drawn.rows).toBe(MAX_DRAWN_ROWS);
    expect(drawn.downsampled).toBe(true);
    // Drawn row 0, column 0 is the mean of units 0 and 1 at time 0.
    expect(drawn.cells[0]).toBe(0.5);
    expect(cellAtPointer(0.99, 0.505, grid)).toEqual({ time: 1, unit: 48 });
    expect(cellAtPointer(1, 1, grid)).toEqual({ time: 1, unit: 95 });
  });

  it("colour ramps are matplotlib's cividis and viridis", () => {
    expect(CIVIDIS_RAMP[0]).toBe("#00224E");
    expect(CIVIDIS_RAMP[CIVIDIS_RAMP.length - 1]).toBe("#FEE838");
    expect(VIRIDIS_RAMP[0]).toBe("#440154");
    expect(VIRIDIS_RAMP[VIRIDIS_RAMP.length - 1]).toBe("#FDE725");
    expect(rampColor(CIVIDIS_RAMP, 0, { low: 0, high: 1 })).toBe("#00224E");
    expect(rampColor(CIVIDIS_RAMP, 1, { low: 0, high: 1 })).toBe("#FEE838");
    expect(rampColor(CIVIDIS_RAMP, null, { low: 0, high: 1 })).toBe(MISSING_COLOR);
  });
});

// ─── the view ───────────────────────────────────────────────────────────────

describe("NeuralView", () => {
  it.each(["mlp", "lstm", "transformer"] as const)("%s: renders every stage; logit and P(up) match the fixture", (name) => {
    const fixture = loadFixture(name);
    renderFixture(fixture);
    const layerCount = fixture.bar.neural!.layers.length;
    expect(document.querySelectorAll('[data-testid^="neural-stage-"]')).toHaveLength(layerCount + 2);
    expect(screen.getByTestId("neural-logit")).toHaveTextContent(formatActivation(fixture.bar.neural!.logit));
    const probability = fixture.bar.output.probabilityUp!;
    const probabilityText = screen.getByTestId("neural-probability").textContent ?? "";
    expect(probabilityText).toContain(`${(probability * 100).toFixed(2)}%`);
    expect(probabilityText).toContain(probability >= 0.5 ? "▲" : "▼");
    expect(probabilityText).toContain(probability >= 0.5 ? "up" : "down");
    expect(Number(screen.getByTestId("neural-sigmoid").textContent)).toBeCloseTo(probability, 6);
    expect(screen.getByText(/is the P\(up\) the chart shows/)).toBeInTheDocument();
  });

  it("stepping and play move the highlighted layer and its caption", () => {
    vi.useFakeTimers();
    renderFixture(loadFixture("lstm"));
    expect(activeStage()).toBe("input");
    expect(screen.getByTestId("neural-caption")).toHaveTextContent("The window: the 32 bars the model reads");
    fireEvent.click(screen.getByTestId("neural-step-forward"));
    expect(activeStage()).toBe("lstm");
    expect(screen.getByTestId("neural-caption")).toHaveTextContent("The LSTM reads the 32 bars in order, oldest first, and keeps a running memory");
    expect(screen.getByTestId("neural-step-counter")).toHaveTextContent("Step 2 of 4");
    fireEvent.click(screen.getByTestId("neural-step-back"));
    expect(activeStage()).toBe("input");
    fireEvent.click(screen.getByTestId("neural-shape-3"));
    expect(activeStage()).toBe("output");
    expect(screen.getByTestId("neural-caption")).toHaveTextContent("sigmoid");
    // Play from the end restarts at the input and walks to the output, then stops.
    fireEvent.click(screen.getByTestId("neural-play"));
    expect(activeStage()).toBe("input");
    act(() => vi.advanceTimersByTime(PLAY_STEP_MILLISECONDS));
    expect(activeStage()).toBe("lstm");
    act(() => vi.advanceTimersByTime(PLAY_STEP_MILLISECONDS * 5));
    expect(activeStage()).toBe("output");
    expect(screen.getByTestId("neural-play")).toHaveTextContent("Play");
  });

  it("large layers are downsampled for drawing while hover stays exact", () => {
    const fixture = loadFixture("lstm");
    renderFixture(fixture);
    const heatmap = screen.getByTestId("neural-heatmap-1");
    expect(heatmap.getAttribute("data-downsampled")).toBe("true");
    expect(Number(heatmap.getAttribute("data-drawn-rows"))).toBe(MAX_DRAWN_ROWS);
    hoverAt("neural-heatmap-1", 0.999, 0.505);
    const values = fixture.bar.neural!.layers[0].values;
    const exact = values[31 * 96 + 48];
    const readout = screen.getByTestId("neural-hover").textContent ?? "";
    expect(readout).toContain("unit 49 of 96");
    expect(readout).toContain("bar 32 of 32, the bar being predicted");
    expect(readout).toContain(formatActivation(exact));
    expect(screen.getByTestId("heatmap-hover-outline")).toBeInTheDocument();
  });

  it("input hover names the feature and shows a warm-up value as missing", () => {
    const fixture = loadFixture("lstm");
    renderFixture(fixture);
    // time 0 of 32, feature 3 of 8 is null in the fixture (z-score warm-up).
    hoverAt("neural-heatmap-0", 0.01, 3.5 / 8);
    const readout = screen.getByTestId("neural-hover").textContent ?? "";
    expect(readout).toContain(fixture.manifest.featureDisplayNames[3]);
    expect(readout).toContain("input (rolling z-score) missing");
    hoverAt("neural-heatmap-0", 0.999, 0.5 / 8);
    expect(screen.getByTestId("neural-hover")).toHaveTextContent(formatActivation(fixture.bar.inputs.window!.values[31][0]));
  });

  it("the scale toggle repaints the heatmaps and the legend", () => {
    renderFixture(loadFixture("transformer"));
    const fills = () => [...screen.getByTestId("neural-heatmap-0").querySelectorAll("rect[fill]")].map((rect) => rect.getAttribute("fill")).join(",");
    const perLayer = fills();
    const perLayerLegend = screen.getByTestId("neural-legend").textContent;
    fireEvent.click(screen.getByTestId("neural-scale-raw"));
    expect(screen.getByTestId("neural-scale-raw")).toHaveAttribute("aria-pressed", "true");
    expect(fills()).not.toBe(perLayer);
    expect(screen.getByTestId("neural-legend").textContent).not.toBe(perLayerLegend);
    expect(screen.getByTestId("neural-legend")).toHaveTextContent("every layer");
  });

  it("a dense network draws one column per layer and no attention", () => {
    renderFixture(loadFixture("mlp"));
    expect(screen.getByTestId("neural-heatmap-0").getAttribute("data-drawn-columns")).toBe("1");
    expect(screen.getByTestId("neural-heatmap-1").getAttribute("data-drawn-rows")).toBe("24");
    expect(within(screen.getByTestId("neural-heatmap-0")).getByText("Realized volatility over 20 bars")).toBeInTheDocument();
    expect(screen.getByTestId("neural-caption")).toHaveTextContent("a dense network sees only this one bar");
    expect(screen.queryByTestId("neural-attention")).toBeNull();
    fireEvent.click(screen.getByTestId("neural-step-forward"));
    expect(screen.getByTestId("neural-caption")).toHaveTextContent("mixes every number coming in into 24 new numbers");
  });

  it("the head selector changes the attention bars; stepping follows the attention layer", () => {
    const fixture = loadFixture("transformer");
    renderFixture(fixture);
    const weights = () => screen.getAllByTestId("attention-bar").map((bar) => Number(bar.getAttribute("data-weight")));
    const byKey = (layer: string, head: number) => fixture.bar.neural!.attention.find((entry) => entry.layer === layer && entry.head === head)!.weights;
    expect(weights()).toEqual(byKey("encoder_layer_1", 0));
    fireEvent.click(screen.getByTestId("attention-head-1"));
    expect(weights()).toEqual(byKey("encoder_layer_1", 1));
    expect(weights()).not.toEqual(byKey("encoder_layer_1", 0));
    fireEvent.click(screen.getByTestId("attention-head-average"));
    const average = byKey("encoder_layer_1", 0).map((weight, index) => (weight + byKey("encoder_layer_1", 1)[index]) / 2);
    weights().forEach((weight, index) => expect(weight).toBeCloseTo(average[index], 12));
    // Stepping to the second encoder layer moves the attention chart to it.
    fireEvent.click(screen.getByTestId("neural-shape-3"));
    expect(activeStage()).toBe("encoder_layer_2");
    expect((screen.getByTestId("attention-layer-select") as HTMLSelectElement).value).toBe("encoder_layer_2");
    fireEvent.click(screen.getByTestId("attention-head-0"));
    expect(weights()).toEqual(byKey("encoder_layer_2", 0));
    // Hover gives the exact weight.
    const bars = screen.getAllByTestId("attention-bar");
    fireEvent.mouseEnter(bars[bars.length - 1]);
    const last = byKey("encoder_layer_2", 0)[15];
    expect(screen.getByTestId("attention-readout")).toHaveTextContent(`${(last * 100).toFixed(2)}%`);
    expect(screen.getByTestId("attention-readout")).toHaveTextContent("the bar being predicted");
  });

  it.each(["mlp", "lstm", "transformer"] as const)("%s paints only cividis, viridis or Okabe-Ito colours", (name) => {
    const { container } = renderFixture(loadFixture(name));
    fireEvent.click(screen.getByTestId("neural-scale-raw"));
    if (name === "lstm") hoverAt("neural-heatmap-1", 0.5, 0.5);
    const colors = paintedColors(container);
    expect(colors.length).toBeGreaterThan(20);
    const outside = [...new Set(colors)].filter((color) => !ALLOWED.has(color));
    expect(outside).toEqual([]);
  });

  it("a price head shows the predicted move with a sign and a glyph", () => {
    const fixture = loadFixture("mlp");
    const logit = fixture.bar.neural!.logit;
    const bar: CycleExplainBar = {
      ...fixture.bar,
      role: "price",
      link: "identity",
      output: { ...fixture.bar.output, probabilityUp: null, targetUnits: logit, scale: 12.5, movePoints: logit * 12.5, predictedClose: fixture.bar.output.close + logit * 12.5 },
    };
    renderFixture({ ...fixture, bar }, "price");
    const move = screen.getByTestId("neural-move");
    expect(move).toHaveTextContent(`${logit < 0 ? "▼" : "▲"}`);
    expect(move).toHaveTextContent(`${(logit * 12.5).toFixed(2)} points`);
    expect(screen.getByTestId("neural-logit")).toHaveTextContent(formatActivation(logit));
    expect(within(screen.getByTestId("neural-output")).queryByTestId("neural-probability")).toBeNull();
  });
});
